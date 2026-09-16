import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { cleanAnimation, DEFAULT_CLEANUP, type RawTrack } from './cleanup';
import { forwardPushOut, type AvatarRig } from './rig';

/**
 * Retargeting de landmarks de MediaPipe Holistic a un humanoide VRM.
 *
 * Trabaja sobre el rig NORMALIZADO de three-vrm: en reposo es una T-pose con
 * las rotaciones locales en identidad y los ejes locales alineados al mundo
 * (brazo izquierdo hacia +X, palmas hacia abajo, personaje mirando a +Z). Las
 * direcciones de reposo de cada hueso se MIDEN del modelo (rig.ts) en vez de
 * suponerlas.
 *
 * Convención de ejes: MediaPipe world usa x-derecha-de-imagen, y-abajo,
 * z-hacia-la-cámara-negativo; three/VRM usa y-arriba y el personaje de frente
 * a +Z. El mapeo (x, y, z) → (x, -y, -z) es una rotación propia que hace
 * coincidir ambas convenciones (mano izquierda de la persona → +X del modelo).
 *
 * Qué se transfiere y cómo (el porqué, en docs/AVATAR-DECISIONES.md):
 * - Brazo: POSICIÓN de la muñeca relativa al hombro, escalada por el largo de
 *   brazo, resuelta con IK de dos huesos usando el codo de la persona como
 *   polo. Copiar solo direcciones metía las manos en la cara o el vientre
 *   porque el avatar no tiene las proporciones de la persona.
 * - Colisión: la mano se empuja hacia el frente si queda dentro del volumen
 *   medido del torso o la cabeza.
 * - Giro del antebrazo: se reparte mitad en el antebrazo y mitad en la muñeca,
 *   en vez de cargarlo todo en la muñeca (que se torcía como envoltura).
 * - Dedos: dirección real de cada falange con límites anatómicos (flexión,
 *   abducción solo en la base, sin hiperextensión).
 *
 * Solo se animan brazos, manos, dedos y cabeza. Torso y piernas quedan en
 * reposo. Esto es presentación, no análisis.
 */

/** Formato del JSON que produce tools/avatar/extract-landmarks.mjs. */
export interface LandmarksFile {
  source: string;
  fps: number;
  duration: number;
  frames: LandmarkFrame[];
}

export interface LandmarkFrame {
  t: number;
  /** 33 × [x, y, z, visibility] en metros, origen en las caderas. */
  poseWorld: number[][] | null;
  /** 21 × [x, y, z] en metros, origen en la mano. */
  leftHandWorld: number[][] | null;
  rightHandWorld: number[][] | null;
}

type Side = 'left' | 'right';

const POSE = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
} as const;

/** Dedos largos: huesos y landmarks [MCP, PIP, DIP, punta]. */
const FINGERS: { name: string; points: [number, number, number, number] }[] = [
  { name: 'Index', points: [5, 6, 7, 8] },
  { name: 'Middle', points: [9, 10, 11, 12] },
  { name: 'Ring', points: [13, 14, 15, 16] },
  { name: 'Little', points: [17, 18, 19, 20] },
];
const PHALANGES = ['Proximal', 'Intermediate', 'Distal'] as const;
const ARM_PARTS = [
  'UpperArm',
  'LowerArm',
  'Hand',
  'ThumbMetacarpal',
  'ThumbProximal',
  'ThumbDistal',
  ...FINGERS.flatMap(({ name }) => PHALANGES.map((p) => name + p)),
];

/**
 * Límites por falange, en radianes. Flexión positiva = hacia la palma.
 * Valores anatómicos redondeados (MCP ~90°, PIP ~110°, DIP ~80°), con un poco
 * de hiperextensión solo en la base. La abducción solo existe en la base.
 */
const FINGER_LIMITS = {
  Proximal: { flex: [-0.25, 1.6], abduction: 0.3 },
  Intermediate: { flex: [0, 1.9], abduction: 0 },
  Distal: { flex: [0, 1.4], abduction: 0 },
} as const;
const THUMB_MAX_SWING = 1.1;

const MIN_VISIBILITY = 0.5;
/** Holgura entre la mano y la superficie del cuerpo. */
const BODY_MARGIN = 0.025;
/** Fracción del giro del antebrazo que absorbe el antebrazo (el resto, la muñeca). */
const FOREARM_TWIST_SHARE = 0.5;

type BoneRotations = Map<string, THREE.Quaternion>;

/** Datos del clip completo que el retargeting de un frame necesita. */
export interface RetargetContext {
  rig: AvatarRig;
  /** Largo de brazo del avatar / largo de brazo de la persona, por lado. */
  armScale: Record<Side, number>;
}

const toThree = (p: number[]) => new THREE.Vector3(p[0], -p[1], -p[2]);
const smoothstep = (x: number) => {
  const c = Math.min(Math.max(x, 0), 1);
  return c * c * (3 - 2 * c);
};

function poseLandmark(frame: LandmarkFrame, index: number): THREE.Vector3 | null {
  const p = frame.poseWorld?.[index];
  if (!p || p[3] < MIN_VISIBILITY) return null;
  return toThree(p);
}

/** Rotación que lleva una base (dirección + referencia) de reposo a la observada. */
function quatFromBases(
  rest: [THREE.Vector3, THREE.Vector3],
  target: [THREE.Vector3, THREE.Vector3],
): THREE.Quaternion {
  const [r1, r2raw] = rest;
  const [t1, t2raw] = target;
  const r2 = r2raw.clone().addScaledVector(r1, -r1.dot(r2raw)).normalize();
  const t2 = t2raw.clone().addScaledVector(t1, -t1.dot(t2raw)).normalize();
  const mRest = new THREE.Matrix4().makeBasis(r1, r2, r1.clone().cross(r2));
  const mTarget = new THREE.Matrix4().makeBasis(t1, t2, t1.clone().cross(t2));
  return new THREE.Quaternion().setFromRotationMatrix(mTarget.multiply(mRest.transpose()));
}

/** Parte de `q` que gira alrededor de `axis` (descomposición swing-twist). */
function twistAround(q: THREE.Quaternion, axis: THREE.Vector3): THREE.Quaternion {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  const twist = new THREE.Quaternion(axis.x * d, axis.y * d, axis.z * d, q.w);
  return twist.lengthSq() < 1e-12 ? new THREE.Quaternion() : twist.normalize();
}

/** Base de la mano: [muñeca → nudillo medio, normal del dorso]. */
function handBasis(
  side: Side,
  wrist: THREE.Vector3,
  indexBase: THREE.Vector3,
  middleBase: THREE.Vector3,
  littleBase: THREE.Vector3,
): [THREE.Vector3, THREE.Vector3] | null {
  const forward = middleBase.clone().sub(wrist).normalize();
  const vIndex = indexBase.clone().sub(wrist);
  const vLittle = littleBase.clone().sub(wrist);
  // El orden del producto cruz se invierte entre manos para que en ambas
  // apunte al dorso (+Y en reposo, palmas abajo).
  const back = side === 'left' ? vIndex.cross(vLittle) : vLittle.cross(vIndex);
  return back.lengthSq() < 1e-10 ? null : [forward, back.normalize()];
}

function restHandBasis(rig: AvatarRig, side: Side) {
  return handBasis(
    side,
    rig.position(`${side}Hand`),
    rig.position(`${side}IndexProximal`),
    rig.position(`${side}MiddleProximal`),
    rig.position(`${side}LittleProximal`),
  )!;
}

/** Rotación mundial de la mano a partir de sus landmarks, o null sin detección. */
function handWorldRotation(frame: LandmarkFrame, side: Side, rig: AvatarRig) {
  const hand = frame[`${side}HandWorld`];
  if (!hand) return null;
  const observed = handBasis(
    side,
    toThree(hand[0]),
    toThree(hand[5]),
    toThree(hand[9]),
    toThree(hand[17]),
  );
  return observed ? quatFromBases(restHandBasis(rig, side), observed) : null;
}

/**
 * IK de dos huesos: posición del codo para alcanzar `target` desde `shoulder`
 * con segmentos `l1`, `l2`, doblando hacia `pole`.
 */
export function solveTwoBoneIK(
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
): { elbow: THREE.Vector3; wrist: THREE.Vector3 } {
  const toTarget = target.clone().sub(shoulder);
  const reach = THREE.MathUtils.clamp(toTarget.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4);
  const dir = toTarget.normalize();
  const along = (l1 * l1 - l2 * l2 + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(l1 * l1 - along * along, 0));
  let bend = pole.clone().addScaledVector(dir, -pole.dot(dir));
  if (bend.lengthSq() < 1e-8) bend = new THREE.Vector3(0, -1, 0).addScaledVector(dir, -dir.y);
  bend.normalize();
  const elbow = shoulder.clone().addScaledVector(dir, along).addScaledVector(bend, height);
  return { elbow, wrist: shoulder.clone().addScaledVector(dir, reach) };
}

function retargetArm(
  frame: LandmarkFrame,
  side: Side,
  ctx: RetargetContext,
  out: BoneRotations,
): void {
  const { rig } = ctx;
  const shoulder = poseLandmark(frame, POSE[`${side}Shoulder`]);
  const elbow = poseLandmark(frame, POSE[`${side}Elbow`]);
  const wrist = poseLandmark(frame, POSE[`${side}Wrist`]);
  if (!shoulder || !elbow || !wrist) return;

  const S = rig.position(`${side}UpperArm`);
  const l1 = S.distanceTo(rig.position(`${side}LowerArm`));
  const l2 = rig.position(`${side}LowerArm`).distanceTo(rig.position(`${side}Hand`));
  const scale = ctx.armScale[side];
  const qHandObserved = handWorldRotation(frame, side, rig);

  // Objetivo de muñeca en el espacio del avatar, relativo a su hombro.
  const target = S.clone().addScaledVector(wrist.clone().sub(shoulder), scale);
  const pole = elbow.clone().sub(shoulder).multiplyScalar(scale).add(S).sub(target);

  // Colisión: se prueban muñeca, base de los dedos y mitad de los dedos. Si
  // alguno queda dentro del cuerpo, la mano completa se adelanta.
  const restForward = rig.direction(`${side}Hand`);
  const handLength = rig.position(`${side}Hand`).distanceTo(rig.position(`${side}MiddleProximal`));
  const forward = qHandObserved
    ? restForward.clone().applyQuaternion(qHandObserved)
    : wrist.clone().sub(elbow).normalize();
  let push = 0;
  for (let pass = 0; pass < 2; pass++) {
    const { wrist: reached } = solveTwoBoneIK(S, target, l1, l2, pole);
    push = 0;
    for (const k of [0, 1, 1.8]) {
      const p = reached.clone().addScaledVector(forward, handLength * k);
      push = Math.max(push, forwardPushOut(rig.body, p, BODY_MARGIN));
    }
    if (push === 0) break;
    target.z += push;
  }

  const ik = solveTwoBoneIK(S, target, l1, l2, pole);
  const dUpper = ik.elbow.clone().sub(S).normalize();
  const dLower = ik.wrist.clone().sub(ik.elbow).normalize();

  // Brazo: la dirección del hueso fija dos grados de libertad; el tercero (giro
  // sobre su eje) lo fija el plano en que se dobla el codo. Con el brazo casi
  // recto ese plano no está definido y se usa el giro mínimo.
  const restUpper = rig.direction(`${side}UpperArm`);
  const bendDir = dLower.clone().addScaledVector(dUpper, -dLower.dot(dUpper));
  const bendAngle = dUpper.angleTo(dLower);
  const qSwing = new THREE.Quaternion().setFromUnitVectors(restUpper, dUpper);
  let qUpper = qSwing;
  if (bendDir.lengthSq() > 1e-8) {
    // En T-pose con palmas abajo el codo dobla hacia el frente (+Z).
    const qPlane = quatFromBases([restUpper, new THREE.Vector3(0, 0, 1)], [dUpper, bendDir]);
    qUpper = qSwing.clone().slerp(qPlane, smoothstep((bendAngle - 0.15) / 0.35));
  }
  out.set(`${side}UpperArm`, qUpper);

  const restLower = rig.direction(`${side}LowerArm`);
  const qElbow = new THREE.Quaternion().setFromUnitVectors(
    restLower,
    dLower.clone().applyQuaternion(qUpper.clone().invert()),
  );
  const qForearm = qUpper.clone().multiply(qElbow);
  if (!qHandObserved) {
    out.set(`${side}LowerArm`, qElbow);
    return;
  }

  // Giro del antebrazo (pronación/supinación) repartido entre antebrazo y muñeca.
  const qWrist = qForearm.clone().invert().multiply(qHandObserved);
  const twist = twistAround(qWrist, restLower);
  const forearmTwist = new THREE.Quaternion().slerp(twist, FOREARM_TWIST_SHARE);
  out.set(`${side}LowerArm`, qElbow.clone().multiply(forearmTwist));
  out.set(`${side}Hand`, forearmTwist.clone().invert().multiply(qWrist));

  retargetFingers(frame, side, qHandObserved, rig, out);
}

/**
 * Dedos: para cada falange, dirección observada expresada en el marco de su
 * hueso padre, descompuesta en flexión y abducción, limitada y convertida en
 * rotación. Se encadena para que cada falange sea relativa a la anterior.
 */
function retargetFingers(
  frame: LandmarkFrame,
  side: Side,
  qHand: THREE.Quaternion,
  rig: AvatarRig,
  out: BoneRotations,
): void {
  const hand = frame[`${side}HandWorld`]!;
  const toHandLocal = qHand.clone().invert();
  const localDir = (from: number, to: number) =>
    toThree(hand[to]).sub(toThree(hand[from])).normalize().applyQuaternion(toHandLocal);
  // Normal de la palma (hacia donde flexionan los dedos) en reposo.
  const palm = restHandBasis(rig, side)[1].clone().negate();

  for (const { name, points } of FINGERS) {
    const parent = new THREE.Quaternion();
    for (let j = 0; j < 3; j++) {
      const bone = `${side}${name}${PHALANGES[j]}`;
      const limits = FINGER_LIMITS[PHALANGES[j]];
      const rest = rig.direction(bone);
      const d = localDir(points[j], points[j + 1]).applyQuaternion(parent.clone().invert());

      const y = palm.clone().addScaledVector(rest, -palm.dot(rest)).normalize();
      const z = rest.clone().cross(y); // eje de flexión
      const flex = THREE.MathUtils.clamp(
        Math.atan2(d.dot(y), d.dot(rest)),
        limits.flex[0],
        limits.flex[1],
      );
      const abduction = THREE.MathUtils.clamp(
        Math.asin(THREE.MathUtils.clamp(d.dot(z), -1, 1)),
        -limits.abduction,
        limits.abduction,
      );
      const constrained = rest
        .clone()
        .multiplyScalar(Math.cos(flex))
        .addScaledVector(y, Math.sin(flex))
        .multiplyScalar(Math.cos(abduction))
        .addScaledVector(z, Math.sin(abduction));
      const q = new THREE.Quaternion().setFromUnitVectors(rest, constrained.normalize());
      out.set(bone, q);
      parent.multiply(q);
    }
  }

  // Pulgar: su eje de flexión es oblicuo y varía entre personas; en vez de
  // suponerlo, se sigue la dirección observada de cada falange con un tope de
  // desviación respecto al reposo.
  const thumb = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'];
  const thumbPoints = [1, 2, 3, 4];
  const parent = new THREE.Quaternion();
  for (let j = 0; j < 3; j++) {
    const bone = `${side}${thumb[j]}`;
    const rest = rig.direction(bone);
    const d = localDir(thumbPoints[j], thumbPoints[j + 1]).applyQuaternion(parent.clone().invert());
    const q = new THREE.Quaternion().setFromUnitVectors(rest, d);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    if (angle > THUMB_MAX_SWING) q.slerp(new THREE.Quaternion(), 1 - THUMB_MAX_SWING / angle);
    out.set(bone, q);
    parent.multiply(q);
  }
}

function retargetHead(frame: LandmarkFrame, out: BoneRotations): void {
  const earL = poseLandmark(frame, POSE.leftEar);
  const earR = poseLandmark(frame, POSE.rightEar);
  const nose = poseLandmark(frame, POSE.nose);
  if (!earL || !earR || !nose) return;
  const across = earL.clone().sub(earR).normalize();
  const forward = nose.clone().sub(earL.clone().add(earR).multiplyScalar(0.5)).normalize();
  out.set(
    'head',
    quatFromBases(
      [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1)],
      [across, forward],
    ),
  );
}

/** Calcula las rotaciones de huesos de un frame de landmarks. */
export function retargetFrame(frame: LandmarkFrame, ctx: RetargetContext): BoneRotations {
  const out: BoneRotations = new Map();
  retargetArm(frame, 'left', ctx, out);
  retargetArm(frame, 'right', ctx, out);
  retargetHead(frame, out);
  return out;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN;
};

/**
 * Largo de brazo del avatar dividido entre el de la persona (mediana del clip,
 * robusta a frames con mala detección).
 */
export function armScales(rig: AvatarRig, frames: LandmarkFrame[]): Record<Side, number> {
  const scaleFor = (side: Side) => {
    const lengths = frames.flatMap((f) => {
      const s = poseLandmark(f, POSE[`${side}Shoulder`]);
      const e = poseLandmark(f, POSE[`${side}Elbow`]);
      const w = poseLandmark(f, POSE[`${side}Wrist`]);
      return s && e && w ? [s.distanceTo(e) + e.distanceTo(w)] : [];
    });
    const avatar =
      rig.position(`${side}UpperArm`).distanceTo(rig.position(`${side}LowerArm`)) +
      rig.position(`${side}LowerArm`).distanceTo(rig.position(`${side}Hand`));
    const person = median(lengths);
    return Number.isFinite(person) && person > 0 ? avatar / person : 1;
  };
  return { left: scaleFor('left'), right: scaleFor('right') };
}

/**
 * Pose de reposo por hueso, para los tramos sin detección (p. ej. la mano
 * que cuelga fuera de cuadro). Brazos abajo junto al cuerpo, dedos
 * ligeramente flexionados como una mano relajada; el resto en identidad.
 */
export function restRotation(bone: string): THREE.Quaternion {
  const side = bone.startsWith('left') ? 'left' : bone.startsWith('right') ? 'right' : null;
  if (!side) return new THREE.Quaternion();
  const sgn = side === 'left' ? 1 : -1;
  const part = bone.slice(side.length);
  if (part === 'UpperArm') {
    return new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(sgn, 0, 0),
      new THREE.Vector3(sgn * 0.2, -1, 0.05).normalize(),
    );
  }
  if (/^(Index|Middle|Ring|Little)/.test(part)) {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -sgn), 0.25);
  }
  return new THREE.Quaternion();
}

export interface SignPlayer {
  /** Aplica la pose interpolada para el tiempo dado (en segundos, en loop). */
  update(elapsedSeconds: number): void;
  /** Duración de un ciclo, incluida la transición de regreso al inicio. */
  duration: number;
}

export interface SignPlayerOptions {
  /**
   * Tramo del video que es la seña, en segundos. Fuera de él suele haber
   * preparación y regreso a reposo (manos que bajan y se juntan) que no son
   * parte de la seña. Sin tramo, se recorta la quietud automáticamente.
   */
  window?: [number, number];
}

/**
 * Retargetea cada frame, limpia la animación (huecos, jitter, espaciado
 * irregular, cierre del bucle; ver cleanup.ts) y la reproduce interpolada
 * sobre el rig normalizado.
 */
export function createSignPlayer(
  vrm: VRM,
  rig: AvatarRig,
  data: LandmarksFile,
  options: SignPlayerOptions = {},
): SignPlayer {
  const ctx: RetargetContext = { rig, armScale: armScales(rig, data.frames) };
  const { frames } = data;
  const [from, to] = options.window ?? [-Infinity, Infinity];

  // Una mano que nunca se detecta en la seña está fuera de cuadro (en el
  // regazo): la pose estima ese brazo a ciegas y lo dejaba flotando frente al
  // vientre. Ese brazo va en reposo durante todo el clip.
  const unseen = (['left', 'right'] as const).filter((side) =>
    frames.every((f) => f.t < from || f.t > to || !f[`${side}HandWorld`]),
  );
  const perFrame = frames.map((f) => {
    const rotations = retargetFrame(f, ctx);
    for (const side of unseen) {
      for (const bone of rotations.keys()) if (bone.startsWith(side)) rotations.delete(bone);
    }
    return rotations;
  });
  const bones = new Set(perFrame.flatMap((rotations) => [...rotations.keys()]));
  for (const side of unseen) {
    for (const part of ARM_PARTS) bones.add(`${side}${part}`);
  }
  const rawTracks = new Map<string, RawTrack>();
  for (const bone of bones) {
    rawTracks.set(bone, perFrame.map((rotations) => rotations.get(bone) ?? null));
  }
  const clip = cleanAnimation(
    frames.map((f) => f.t),
    rawTracks,
    restRotation,
    { ...DEFAULT_CLEANUP, window: options.window },
  );

  const nodes = new Map<string, THREE.Object3D>();
  for (const bone of clip.tracks.keys()) {
    const node = vrm.humanoid.getNormalizedBoneNode(bone as VRMHumanBoneName);
    if (node) nodes.set(bone, node);
  }

  const duration = clip.frameCount / clip.fps;
  return {
    duration,
    update(elapsedSeconds: number) {
      const exact = (((elapsedSeconds % duration) + duration) % duration) * clip.fps;
      const i = Math.floor(exact) % clip.frameCount;
      // El último frame es la pose inicial (cierre del bucle): envolver a 0 es continuo.
      const next = (i + 1) % clip.frameCount;
      const alpha = exact - Math.floor(exact);
      for (const [bone, node] of nodes) {
        const track = clip.tracks.get(bone)!;
        node.quaternion.slerpQuaternions(track[i], track[next], alpha);
      }
    },
  };
}
