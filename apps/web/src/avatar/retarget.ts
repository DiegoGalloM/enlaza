import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { cleanAnimation, type RawTrack } from './cleanup';

/**
 * Retargeting de landmarks de MediaPipe Holistic a un humanoide VRM.
 *
 * Trabaja sobre el rig NORMALIZADO de three-vrm: en reposo es una T-pose con
 * las rotaciones locales en identidad y los ejes locales alineados al mundo
 * (brazo izquierdo hacia +X, derecho hacia -X, palmas hacia abajo, personaje
 * mirando a +Z). Eso permite calcular cada rotación como "lleva la dirección
 * de reposo a la dirección observada" sin conocer el rig concreto del modelo.
 *
 * Convención de ejes: MediaPipe world usa x-derecha-de-imagen, y-abajo,
 * z-hacia-la-cámara-negativo; three/VRM usa y-arriba y el personaje de frente
 * a +Z. El mapeo (x, y, z) → (x, -y, -z) es una rotación propia que hace
 * coincidir ambas convenciones (mano izquierda de la persona → +X del modelo).
 *
 * Es un PoC: solo se animan brazos, muñecas, dedos y cabeza. Torso y piernas
 * quedan en reposo. El reconocimiento de la app sigue siendo solo de manos —
 * esto es presentación, no análisis.
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

/** Índices de HandLandmarker: [muñeca, 4 puntos por dedo (MCP→tip)]. */
const HAND_CHAINS: { bones: string[]; points: number[] }[] = [
  { bones: ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'], points: [0, 1, 2, 3, 4] },
  { bones: ['IndexProximal', 'IndexIntermediate', 'IndexDistal'], points: [0, 5, 6, 7, 8] },
  { bones: ['MiddleProximal', 'MiddleIntermediate', 'MiddleDistal'], points: [0, 9, 10, 11, 12] },
  { bones: ['RingProximal', 'RingIntermediate', 'RingDistal'], points: [0, 13, 14, 15, 16] },
  { bones: ['LittleProximal', 'LittleIntermediate', 'LittleDistal'], points: [0, 17, 18, 19, 20] },
];

const MIN_VISIBILITY = 0.5;
const MAX_CURL = 2.0; // rad por articulación; los dedos no hiperextienden

type BoneRotations = Map<string, THREE.Quaternion>;

const toThree = (p: number[]) => new THREE.Vector3(p[0], -p[1], -p[2]);

function poseLandmark(frame: LandmarkFrame, index: number): THREE.Vector3 | null {
  const p = frame.poseWorld?.[index];
  if (!p || p[3] < MIN_VISIBILITY) return null;
  return toThree(p);
}

/** Rotación mundial que lleva una base ortonormal de reposo a la observada. */
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

function retargetArm(frame: LandmarkFrame, side: 'left' | 'right', out: BoneRotations): void {
  const sgn = side === 'left' ? 1 : -1;
  const shoulder = poseLandmark(frame, POSE[`${side}Shoulder`]);
  const elbow = poseLandmark(frame, POSE[`${side}Elbow`]);
  const wrist = poseLandmark(frame, POSE[`${side}Wrist`]);
  if (!shoulder || !elbow || !wrist) return;

  const rest = new THREE.Vector3(sgn, 0, 0);
  const dUpper = elbow.clone().sub(shoulder).normalize();
  const dLower = wrist.clone().sub(elbow).normalize();
  // El hombro (padre de upperArm) no se anima, así que la rotación mundial
  // del brazo es directamente su rotación local en el rig normalizado.
  const qUpper = new THREE.Quaternion().setFromUnitVectors(rest, dUpper);
  const qLower = new THREE.Quaternion().setFromUnitVectors(rest, dLower);
  out.set(`${side}UpperArm`, qUpper);
  out.set(`${side}LowerArm`, qUpper.clone().invert().multiply(qLower));

  const hand = frame[`${side}HandWorld`];
  if (!hand) return;
  const handWrist = toThree(hand[0]);
  const forward = toThree(hand[9]).sub(handWrist).normalize(); // muñeca → MCP medio
  const vIndex = toThree(hand[5]).sub(handWrist);
  const vPinky = toThree(hand[17]).sub(handWrist);
  // Normal del dorso de la mano (+Y en reposo, palmas abajo); el orden del
  // producto cruz se invierte entre manos para conservar la orientación.
  const back =
    side === 'left' ? vIndex.clone().cross(vPinky) : vPinky.clone().cross(vIndex);
  if (back.lengthSq() < 1e-8) return;
  const qHand = quatFromBases(
    [rest, new THREE.Vector3(0, 1, 0)],
    [forward, back.normalize()],
  );
  out.set(`${side}Hand`, qLower.clone().invert().multiply(qHand));

  // Dedos: curl por articulación como ángulo entre segmentos consecutivos,
  // alrededor del eje de flexión en reposo. Ignora abducción y el eje real
  // del pulgar — suficiente para un PoC, no para configuración manual fina.
  const curlAxis = new THREE.Vector3(0, 0, -sgn);
  const thumbAxis = new THREE.Vector3(0, sgn, 0);
  for (const { bones, points } of HAND_CHAINS) {
    const axis = bones[0].startsWith('Thumb') ? thumbAxis : curlAxis;
    for (let j = 0; j < bones.length; j++) {
      const a = toThree(hand[points[j + 1]]).sub(toThree(hand[points[j]]));
      const b = toThree(hand[points[j + 2]]).sub(toThree(hand[points[j + 1]]));
      const angle = Math.min(a.angleTo(b), MAX_CURL);
      out.set(`${side}${bones[j]}`, new THREE.Quaternion().setFromAxisAngle(axis, angle));
    }
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
export function retargetFrame(frame: LandmarkFrame): BoneRotations {
  const out: BoneRotations = new Map();
  retargetArm(frame, 'left', out);
  retargetArm(frame, 'right', out);
  retargetHead(frame, out);
  return out;
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

/**
 * Retargetea cada frame, limpia la animación (huecos, jitter, espaciado
 * irregular, quietud y cierre del bucle; ver cleanup.ts) y la reproduce
 * interpolada sobre el rig normalizado.
 */
export function createSignPlayer(vrm: VRM, data: LandmarksFile): SignPlayer {
  const perFrame = data.frames.map(retargetFrame);
  const bones = new Set(perFrame.flatMap((rotations) => [...rotations.keys()]));
  const rawTracks = new Map<string, RawTrack>();
  for (const bone of bones) {
    rawTracks.set(bone, perFrame.map((rotations) => rotations.get(bone) ?? null));
  }
  const clip = cleanAnimation(
    data.frames.map((f) => f.t),
    rawTracks,
    restRotation,
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
