import * as THREE from 'three';
import type { VRM, VRMHumanBoneName } from '@pixiv/three-vrm';
import { cleanAnimation, DEFAULT_CLEANUP, type RawTrack } from './cleanup';
import { bodyPenetration, type AvatarRig, type BodyProfile } from './rig';
import { blinkWeight, createSignFace, type FaceExpression } from './face';

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
 * - Colisión: si brazo, antebrazo o dedos quedan dentro del volumen medido
 *   del torso o la cabeza, se gira el codo alrededor del eje hombro–muñeca y,
 *   si no basta, se adelanta la mano (solveArmClearance).
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
  mouthLeft: 9,
  mouthRight: 10,
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

/**
 * Configuraciones manuales que se REGISTRAN por seña (animations.ts) cuando
 * MediaPipe no las capta. En un puño apoyado en el pecho los dedos quedan
 * ocultos contra la palma y el cuerpo: la detección los da a medio doblar y el
 * avatar mostraba un gancho abierto en vez de un puño (Por favor, A32). Igual
 * que el tramo y la cara, qué configuración lleva la seña es una decisión
 * lingüística y se revisa con ICAL.
 *
 * Cada una fija la flexión [base, media, distal] de los cuatro dedos largos,
 * en radianes, con abducción cero. El pulgar sigue lo observado (su posición
 * distingue, p. ej., A de S) y el contacto con los dedos se preserva igual.
 */
export type Handshape = 'puño' | 'plana';
const HANDSHAPE_FLEX: Record<Handshape, [number, number, number]> = {
  // Dentro de FINGER_LIMITS: base ~85°, media ~100°, distal ~60°. Más que eso
  // mete las yemas en la palma de este modelo.
  puño: [1.5, 1.75, 1.05],
  // Mano plana (B), dedos juntos y rectos (Gracias). MediaPipe los daba
  // curvados con la mano de canto frente a la cámara (A35); apenas
  // flexionados, como una mano estirada sin tensión, no rígidos en 0.
  plana: [0.08, 0.06, 0.04],
};
/**
 * Contacto del pulgar: si en el video la punta del pulgar está a menos de esta
 * fracción del largo de la mano de alguna articulación de los dedos, se
 * considera contacto y se preserva (ver preserveThumbContact).
 */
const THUMB_CONTACT_RATIO = 0.45;
const THUMB_CONTACT_FADE = 0.15;
/**
 * Puntos de los dedos que puede tocar el pulgar: landmark → [dedo, cuántas
 * falanges recorrer desde la base]. 1 = articulación PIP, 2 = DIP, 3 = yema.
 * Las yemas hacen falta para contactos como el de Hola (pulgar con meñique).
 */
const THUMB_CONTACT_JOINTS: [number, string, number][] = [
  [6, 'Index', 1], [7, 'Index', 2], [8, 'Index', 3],
  [10, 'Middle', 1], [11, 'Middle', 2], [12, 'Middle', 3],
  [14, 'Ring', 1], [15, 'Ring', 2], [16, 'Ring', 3],
  [18, 'Little', 1], [19, 'Little', 2], [20, 'Little', 3],
];

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
  /** Configuración manual registrada por mano, si la seña la fija. */
  handshape?: Partial<Record<Side, Handshape>>;
  /** Tramos (s del video) en que la yema del dedo medio toca la cara (A35). */
  faceContact?: Partial<Record<Side, [number, number]>>;
  /** Tramos (s del video) en que la mano va con la palma hacia arriba (A36). */
  palmUp?: Partial<Record<Side, [number, number]>>;
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

/** Pronación máxima antes de leer el giro como supinación (desde palma abajo). */
const MAX_PRONATION = THREE.MathUtils.degToRad(100);

/**
 * Ángulo del giro del antebrazo alrededor de su eje, elegido en el rango
 * anatómico. Desde el reposo (palma abajo), la palma arriba es ~180° de
 * supinación, justo donde `twistAround` da +180° o −180° según el ruido del
 * frame: repartido 50/50 con la muñeca (A15), el antebrazo saltaba de +90° a
 * −90° (Gracias: 170 rad/s en la mano izquierda). La pronación llega a ~90° y
 * la supinación pasa de 180°, así que un giro del lado de la pronación más
 * allá de MAX_PRONATION se toma como supinación (A36).
 */
export function supinationAngle(twist: THREE.Quaternion, axis: THREE.Vector3, side: Side): number {
  const s = twist.x * axis.x + twist.y * axis.y + twist.z * axis.z;
  let angle = 2 * Math.atan2(s, twist.w);
  if (angle > Math.PI) angle -= 2 * Math.PI;
  if (angle <= -Math.PI) angle += 2 * Math.PI;
  // Con palma abajo y el pulgar al frente, supinar lleva el pulgar hacia
  // arriba: giro negativo alrededor del eje del brazo izquierdo (+x) y
  // positivo alrededor del derecho (−x).
  const supination = side === 'left' ? -1 : 1;
  if (angle * supination < -MAX_PRONATION) angle += supination * 2 * Math.PI;
  return angle;
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

/**
 * Holgura de nudillos y yemas: el radio de un dedo (~1 cm) y un poco más. Con
 * la de la muñeca (2.5 cm) el puño de Por favor quedaba flotando frente al pecho.
 */
const FINGER_MARGIN = 0.012;
/**
 * Holgura del antebrazo con el cuerpo: su radio en el modelo (~3 cm) más ~1 cm
 * para el mechón del frente, que queda entre el antebrazo y el pecho cuando el
 * brazo cruza (Por favor). Con 3 cm el mechón atravesaba el codo.
 */
const FOREARM_MARGIN = 0.04;
/**
 * Holgura del brazo: menor que su radio porque junto al costado la manga y la
 * camisa holgadas se enciman también en reposo; lo que se evita es que el
 * codo quede metido en el torso.
 */
const UPPER_ARM_MARGIN = 0.015;
/** Tramo del brazo que se prueba: cerca del hombro siempre está "dentro". */
const UPPER_ARM_SAMPLES = [0.75, 1];
const FOREARM_SAMPLES = [0.2, 0.4, 0.6, 0.8, 1];
/**
 * Sin detección de mano no hay dedos: muñeca, nudillos y mitad de los dedos
 * extendidos, en largos de mano.
 */
const HAND_SAMPLES_WITHOUT_FINGERS = [0, 1, 1.8];
/**
 * Costo de alejarse de lo observado frente al de atravesar el cuerpo. Girar
 * el codo alrededor del eje hombro–muñeca no cambia dónde está la mano, así
 * que es lo primero que se usa; adelantar la mano la despega del contacto
 * (el puño de Por favor sobre el pecho) y cuesta más.
 */
const PENETRATION_COST = 1000;
const SWIVEL_COST = 0.05;
const PUSH_COST = 20;
const MAX_SWIVEL = Math.PI / 2;
const MAX_PUSH = 0.06;

/**
 * IK del brazo sin atravesar el cuerpo. `handPoints` son puntos de la mano
 * relativos a la muñeca (ya orientados). Antes solo se probaba la mano y se
 * adelantaba; el codo quedaba libre y en Por favor (puño en el pecho con el
 * codo al costado) quedaba 12 cm dentro del torso, con el antebrazo saliendo
 * de la camisa. Se buscan dos correcciones a la vez: girar el codo alrededor
 * del eje hombro–muñeca (la mano no se mueve) y adelantar la muñeca, con el
 * menor costo total entre penetración y distancia a la pose observada.
 * Búsqueda en rejilla gruesa y luego fina: son dos parámetros acotados y
 * evita los mínimos locales de un descenso.
 */
export function solveArmClearance(
  body: BodyProfile,
  shoulder: THREE.Vector3,
  target: THREE.Vector3,
  l1: number,
  l2: number,
  pole: THREE.Vector3,
  handPoints: THREE.Vector3[],
  maxPush = MAX_PUSH,
): { elbow: THREE.Vector3; wrist: THREE.Vector3; cost: number } {
  const axis = target.clone().sub(shoulder).normalize();
  const solve = (swivel: number, push: number) => {
    const t = target.clone();
    t.z += push;
    const p = pole.clone().applyAxisAngle(axis, swivel);
    return solveTwoBoneIK(shoulder, t, l1, l2, p);
  };
  const penetration = ({ elbow, wrist }: { elbow: THREE.Vector3; wrist: THREE.Vector3 }) => {
    let sum = 0;
    const add = (point: THREE.Vector3, margin: number) => {
      sum += bodyPenetration(body, point, margin) ** 2;
    };
    for (const s of UPPER_ARM_SAMPLES) add(shoulder.clone().lerp(elbow, s), UPPER_ARM_MARGIN);
    for (const s of FOREARM_SAMPLES) add(elbow.clone().lerp(wrist, s), FOREARM_MARGIN);
    // El primer punto es la muñeca; el resto, dedos, que son más delgados.
    handPoints.forEach((offset, i) => add(wrist.clone().add(offset), i === 0 ? BODY_MARGIN : FINGER_MARGIN));
    return sum;
  };
  const cost = (swivel: number, push: number) =>
    PENETRATION_COST * penetration(solve(swivel, push)) + SWIVEL_COST * swivel ** 2 + PUSH_COST * push ** 2;

  if (penetration(solve(0, 0)) === 0) return { ...solve(0, 0), cost: 0 };
  let best = { swivel: 0, push: 0, cost: cost(0, 0) };
  const search = (swivels: number[], pushes: number[]) => {
    for (const swivel of swivels) {
      for (const push of pushes) {
        const c = cost(swivel, push);
        if (c < best.cost) best = { swivel, push, cost: c };
      }
    }
  };
  const range = (from: number, to: number, step: number) => {
    const out: number[] = [];
    for (let x = from; x <= to + 1e-9; x += step) out.push(x);
    return out;
  };
  const coarse = MAX_SWIVEL / 18;
  search(range(-MAX_SWIVEL, MAX_SWIVEL, coarse), range(0, maxPush, 0.005));
  const { swivel, push } = best;
  search(
    range(Math.max(swivel - coarse, -MAX_SWIVEL), Math.min(swivel + coarse, MAX_SWIVEL), coarse / 10),
    range(Math.max(push - 0.005, 0), Math.min(push + 0.005, maxPush), 0.0005),
  );
  return { ...solve(best.swivel, best.push), cost: best.cost };
}

/**
 * Adelantamiento máximo del hombro (giro de la clavícula hacia el frente) y
 * cuánto baja con él. Una persona que lleva la mano al pecho del lado
 * contrario adelanta el hombro; sin eso, en el avatar el alcance no daba para
 * bajar el codo y el antebrazo quedaba horizontal con el codo alto, cuando en
 * el video de Por favor cuelga y el antebrazo sube en diagonal (A33).
 * Medido: con 25° y 10° el antebrazo pasa de 11° a ~25° de inclinación.
 */
const MAX_PROTRACTION = THREE.MathUtils.degToRad(25);
const MAX_DEPRESSION = THREE.MathUtils.degToRad(10);
/** Cuánto cruza la mano hacia el otro lado, desde el hombro, para empezar y para el máximo. */
const CROSS_START = 0.05;
const CROSS_FULL = 0.2;

/**
 * Rotación del hueso del hombro (clavícula) según cuánto cruza la mano hacia
 * el lado contrario, medido desde la articulación del hombro. Mano de su lado
 * (Hola, en la frente): casi nada.
 */
export function shoulderGirdle(side: Side, restShoulder: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
  const toward = side === 'right' ? 1 : -1; // el lado contrario está hacia +x para el brazo derecho
  const cross = (target.x - restShoulder.x) * toward;
  const amount = smoothstep((cross - CROSS_START) / (CROSS_FULL - CROSS_START));
  if (amount <= 0) return new THREE.Quaternion();
  // Brazo derecho en reposo hacia -x: girar en +y lo adelanta, en +z lo baja.
  const forward = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), toward * MAX_PROTRACTION * amount);
  const down = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), toward * MAX_DEPRESSION * amount);
  return forward.multiply(down);
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

  const restS = rig.position(`${side}UpperArm`);
  const l1 = restS.distanceTo(rig.position(`${side}LowerArm`));
  const l2 = rig.position(`${side}LowerArm`).distanceTo(rig.position(`${side}Hand`));
  const scale = ctx.armScale[side];
  // Palma arriba registrada: en ese tramo la detección de la mano no se usa
  // (es la razón de registrarla) y la orientación sale del antebrazo.
  const palmWeight = spanWeight(ctx.palmUp?.[side], frame.t);
  const hand = palmWeight < 1 ? frame[`${side}HandWorld`] : null;
  const qDetected = hand ? handWorldRotation(frame, side, rig) : null;
  const qPalm = palmWeight > 0 ? palmUpRotation(rig, side, wrist.clone().sub(elbow)) : null;
  const qHandDetected = qPalm ? (qDetected ? qDetected.slerp(qPalm, palmWeight) : qPalm) : qDetected;

  // Objetivo de muñeca en el espacio del avatar, relativo a su hombro en reposo.
  const observedTarget = restS.clone().addScaledVector(wrist.clone().sub(shoulder), scale);
  const observedElbow = elbow.clone().sub(shoulder).multiplyScalar(scale).add(restS);

  // Los dedos no dependen del brazo (la mano termina con la orientación
  // observada, sea cual sea el codo): se resuelven primero para probar la
  // colisión donde de verdad quedan y para saber dónde queda la yema.
  if (qHandDetected) retargetFingers(hand, side, qHandDetected, rig, out, ctx.handshape?.[side]);
  const contact = qHandDetected ? faceContactTarget(frame, side, ctx, qHandDetected, out) : null;
  const handLocalPoints = qHandDetected ? handSurfacePoints(rig, side, out) : null;
  // Adelantar la mano despega la yema de la cara: con contacto registrado
  // solo se gira el codo (medido en Gracias: la yema quedaba ~7 cm delante de
  // los labios porque la muñeca rozaba la camisa; A35).
  const maxPush = MAX_PUSH * (1 - (contact?.weight ?? 0));
  const girdle = rig.position(`${side}Shoulder`);

  // Brazo con una inclinación dada de la mano alrededor de la yema (solo con
  // contacto; sin él hay un solo candidato, el de siempre).
  const solveWithTilt = (tilt: number) => {
    const tilted = contact ? tiltedContact(contact, tilt) : null;
    const target = tilted ? observedTarget.clone().lerp(tilted.wrist, contact!.weight) : observedTarget;
    // La inclinación se aplica entera: mezclada con la orientación observada
    // (inclinada ~35° hacia atrás por la profundidad de MediaPipe) metía el
    // antebrazo en el pecho en las rampas y el codo subía (A35).
    const qHand = tilted ? tilted.hand : qHandDetected;
    // Polo del codo desde el objetivo final: con contacto, la muñeca corregida
    // queda ~15 cm detrás de la observada, y medido desde la observada el codo
    // quedaba "detrás" de la mano, dentro del torso (A35). Sin contacto es el
    // mismo objetivo.
    const pole = observedElbow.clone().sub(target);

    // La clavícula acompaña al brazo que cruza el cuerpo (ver shoulderGirdle):
    // el hombro se adelanta y el IK parte de ahí, sin mover el objetivo.
    const qShoulder = shoulderGirdle(side, restS, target);
    const S = restS.clone().sub(girdle).applyQuaternion(qShoulder).add(girdle);

    // Colisión de brazo y mano con el cuerpo (ver solveArmClearance): en un
    // puño los dedos apuntan hacia el pecho, no al frente. Con la mano en la
    // cara solo se prueba la muñeca: la silueta del cuerpo a la altura de los
    // labios incluye la nariz y despegaba la yema; el contacto ya la pone
    // sobre la piel medida (A35).
    let handPoints: THREE.Vector3[];
    if (qHand && handLocalPoints) {
      handPoints = handLocalPoints.map((p) => p.clone().applyQuaternion(qHand));
      if (contact) handPoints = handPoints.slice(0, 1);
    } else {
      const forward = wrist.clone().sub(elbow).normalize();
      const handLength = rig.position(`${side}Hand`).distanceTo(rig.position(`${side}MiddleProximal`));
      handPoints = HAND_SAMPLES_WITHOUT_FINGERS.map((k) => forward.clone().multiplyScalar(handLength * k));
    }
    const ik = solveArmClearance(rig.body, S, target, l1, l2, pole, handPoints, maxPush);
    return { qHand, qShoulder, S, ik, cost: ik.cost + CONTACT_TILT_COST * tilt * tilt };
  };
  // Con la yema fija en la cara, una persona inclina la mano para que el
  // antebrazo baje por delante del pecho con el codo colgando. Probar solo la
  // muñeca dejaba el antebrazo horizontal y el codo a la altura del hombro:
  // se elige la inclinación junto con el brazo, por el costo total.
  let best = solveWithTilt(0);
  if (contact) {
    for (let tilt = CONTACT_TILT_STEP; tilt <= CONTACT_MAX_TILT + 1e-9; tilt += CONTACT_TILT_STEP) {
      const candidate = solveWithTilt(tilt);
      if (candidate.cost < best.cost) best = candidate;
    }
  }
  const { qHand: qHandObserved, qShoulder, S, ik } = best;
  out.set(`${side}Shoulder`, qShoulder);
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
  // qUpper es la orientación en el mundo; el hueso es hijo del hombro.
  out.set(`${side}UpperArm`, qShoulder.clone().invert().multiply(qUpper));

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
  const angle = supinationAngle(twistAround(qWrist, restLower), restLower, side);
  const forearmTwist = new THREE.Quaternion().setFromAxisAngle(restLower, angle * FOREARM_TWIST_SHARE);
  out.set(`${side}LowerArm`, qElbow.clone().multiply(forearmTwist));
  out.set(`${side}Hand`, forearmTwist.clone().invert().multiply(qWrist));
}

/**
 * Puntos de la mano que no deben entrar al cuerpo, relativos al hueso de la
 * mano en orientación de reposo: muñeca, y nudillos, articulaciones y yemas de
 * cada dedo con las rotaciones ya calculadas.
 */
/**
 * Rampa de entrada y salida de un tramo registrado, en segundos. Con 0.15 s,
 * soltar el contacto de Gracias deshacía ~15 cm de profundidad de golpe
 * (tirón de 479 rad/s² en la muñeca).
 */
const CONTACT_RAMP = 0.25;
/**
 * Distancia de la yema a la boca, en el plano de la cara, con contacto pleno
 * y sin contacto. En Gracias la yema está a 0–5 cm mientras toca la boca y se
 * aleja a 16 cm en 0.12 s al bajar.
 */
const CONTACT_NEAR = 0.06;
const CONTACT_FAR = 0.15;
/** Peso de un tramo registrado en el instante `t`: 1 dentro, con rampas afuera. */
export function spanWeight(span: [number, number] | undefined, t: number): number {
  if (!span) return 0;
  const [from, to] = span;
  return smoothstep((t - from) / CONTACT_RAMP + 1) * smoothstep((to - t) / CONTACT_RAMP + 1);
}

/**
 * Mano con la palma hacia arriba y los dedos siguiendo el antebrazo (sin
 * doblar la muñeca), en el plano horizontal. En Gracias las dos manos quedan
 * una sobre otra, palmas arriba: MediaPipe las confunde (anchos de nudillos de
 * 1–4 cm en vez de 6.5, normales que se voltean de un frame a otro) y la mano
 * derecha se descartaba entera y volvía al reposo. La pose del cuerpo sí es
 * estable ahí: el antebrazo da hacia dónde apuntan los dedos (A36).
 */
function palmUpRotation(rig: AvatarRig, side: Side, forearm: THREE.Vector3): THREE.Quaternion {
  const forward = new THREE.Vector3(forearm.x, 0, forearm.z).normalize();
  // El dorso mira hacia abajo.
  return quatFromBases(restHandBasis(rig, side), [forward, new THREE.Vector3(0, -1, 0)]);
}

/**
 * Inclinación de la mano alrededor de la yema que se prueba con contacto, y su
 * costo: el mismo que girar el codo, para que solo se incline lo que evita
 * atravesar el cuerpo.
 */
const CONTACT_MAX_TILT = THREE.MathUtils.degToRad(90);
const CONTACT_TILT_STEP = THREE.MathUtils.degToRad(5);
const CONTACT_TILT_COST = 0.05;

/**
 * Contacto registrado de la yema del dedo medio con la cara (Gracias: dedos
 * en los labios y el mentón). En el video la yema está a la altura de la boca,
 * pero MediaPipe la pone 13–17 cm por delante (su profundidad no es fiable
 * con la mano frente a la cara) y el avatar dejaba la mano flotando. Se
 * conserva lo que sí es fiable, dónde está la yema respecto a la boca en el
 * plano de la cara (escalado), y la profundidad se toma de la piel medida del
 * modelo más el radio del dedo. Todo en el marco de la cabeza, que gira con
 * la seña.
 *
 * La orientación observada de la mano tiene el mismo problema de profundidad:
 * con la yema en los labios dejaba la muñeca contra el cuello y el antebrazo
 * 13 cm dentro del torso. Una persona apoya la yema y deja la muñeca delante
 * del mentón, así que la mano se inclina alrededor de la yema (giro en x, la
 * muñeca hacia el frente); cuánto, lo decide retargetArm junto con el brazo.
 */
function faceContactTarget(
  frame: LandmarkFrame,
  side: Side,
  ctx: RetargetContext,
  qHand: THREE.Quaternion,
  out: BoneRotations,
): FaceContact | null {
  const span = ctx.faceContact?.[side];
  const face = ctx.rig.face;
  const hand = frame[`${side}HandWorld`];
  const wrist = poseLandmark(frame, POSE[`${side}Wrist`]);
  const mouthL = poseLandmark(frame, POSE.mouthLeft);
  const mouthR = poseLandmark(frame, POSE.mouthRight);
  if (!span || !face || !hand || !wrist || !mouthL || !mouthR) return null;
  const gate = spanWeight(span, frame.t);
  if (gate <= 0) return null;

  const { rig } = ctx;
  const headPos = rig.position('head');
  const qHead = out.get('head') ?? new THREE.Quaternion();
  // Yema observada respecto a la boca, en el marco de la cabeza.
  const tipObserved = wrist.clone().add(toThree(hand[12]).sub(toThree(hand[0])));
  const mouth = mouthL.add(mouthR).multiplyScalar(0.5);
  const offset = tipObserved
    .sub(mouth)
    .multiplyScalar(ctx.armScale[side])
    .applyQuaternion(qHead.clone().invert());
  // El contacto dura lo que la yema está en la cara en el plano de la imagen
  // (x, y), que sí es fiable: al soltarse con una rampa de tiempo la muñeca
  // bajaba por delante del pecho con la profundidad del contacto, y el codo
  // subía y bajaba 5 cm para no atravesarlo (tirón de 398 rad/s² en el brazo).
  const weight = gate * smoothstep((CONTACT_FAR - Math.hypot(offset.x, offset.y)) / (CONTACT_FAR - CONTACT_NEAR));
  if (weight <= 0) return null;
  // Punto de la piel en reposo, con la yema apoyada (radio del dedo).
  const x = face.mouth.x + offset.x;
  const y = face.mouth.y + offset.y;
  const z = face.frontZ(x, y);
  if (Number.isNaN(z)) return null;
  const tipTarget = new THREE.Vector3(x, y, z + FINGER_MARGIN).sub(headPos).applyQuaternion(qHead).add(headPos);

  const tipOnHand = handChainPositions(rig, side, PHALANGES.map((p) => 'Middle' + p), out).at(-1)!;
  return { tip: tipTarget, tipOnHand, hand: qHand, weight };
}

export interface FaceContact {
  /** Dónde va la yema, en mundo en reposo. */
  tip: THREE.Vector3;
  /** Yema en el marco de la mano (orientación de reposo). */
  tipOnHand: THREE.Vector3;
  /** Orientación observada de la mano. */
  hand: THREE.Quaternion;
  weight: number;
}

const X_TILT_AXIS = new THREE.Vector3(1, 0, 0);

/**
 * Mano inclinada `tilt` rad alrededor de la yema (giro en x negativo: lo que
 * está bajo la yema, la muñeca, va hacia el frente) y el objetivo de muñeca
 * que deja la yema en su lugar.
 */
export function tiltedContact(contact: FaceContact, tilt: number): { wrist: THREE.Vector3; hand: THREE.Quaternion } {
  const hand = new THREE.Quaternion().setFromAxisAngle(X_TILT_AXIS, -tilt).multiply(contact.hand);
  return { wrist: contact.tip.clone().sub(contact.tipOnHand.clone().applyQuaternion(hand)), hand };
}

function handSurfacePoints(rig: AvatarRig, side: Side, out: BoneRotations): THREE.Vector3[] {
  const points = [new THREE.Vector3()];
  for (const { name } of FINGERS) {
    points.push(...handChainPositions(rig, side, PHALANGES.map((p) => name + p), out));
  }
  points.push(...handChainPositions(rig, side, ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'], out).slice(2));
  return points;
}

/**
 * Dedos: para cada falange, dirección observada expresada en el marco de su
 * hueso padre, descompuesta en flexión y abducción, limitada y convertida en
 * rotación. Se encadena para que cada falange sea relativa a la anterior.
 */
function retargetFingers(
  hand: number[][] | null,
  side: Side,
  qHand: THREE.Quaternion,
  rig: AvatarRig,
  out: BoneRotations,
  handshape?: Handshape,
): void {
  // Sin landmarks (orientación registrada) solo hay dedos si la configuración
  // también está registrada; el pulgar parte del reposo y va a su objetivo.
  if (!hand && !handshape) return;
  const toHandLocal = qHand.clone().invert();
  const localDir = (from: number, to: number) =>
    toThree(hand![to]).sub(toThree(hand![from])).normalize().applyQuaternion(toHandLocal);
  // Normal de la palma (hacia donde flexionan los dedos) en reposo.
  const palm = restHandBasis(rig, side)[1].clone().negate();

  for (const { name, points } of FINGERS) {
    const parent = new THREE.Quaternion();
    for (let j = 0; j < 3; j++) {
      const bone = `${side}${name}${PHALANGES[j]}`;
      const limits = FINGER_LIMITS[PHALANGES[j]];
      const rest = rig.direction(bone);
      const d = hand ? localDir(points[j], points[j + 1]).applyQuaternion(parent.clone().invert()) : rest;

      const y = palm.clone().addScaledVector(rest, -palm.dot(rest)).normalize();
      const z = rest.clone().cross(y); // eje de flexión
      const flex = handshape
        ? HANDSHAPE_FLEX[handshape][j]
        : THREE.MathUtils.clamp(Math.atan2(d.dot(y), d.dot(rest)), limits.flex[0], limits.flex[1]);
      const abduction = handshape
        ? 0
        : THREE.MathUtils.clamp(
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
    // Con configuración registrada el pulgar parte del reposo: lo observado es
    // ruido (A32), y partir a veces de lo observado y a veces del reposo (sin
    // landmarks) hacía saltar la solución del IK (A36).
    const d =
      hand && !handshape ? localDir(thumbPoints[j], thumbPoints[j + 1]).applyQuaternion(parent.clone().invert()) : rest;
    const q = new THREE.Quaternion().setFromUnitVectors(rest, d);
    const angle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    if (angle > THUMB_MAX_SWING) q.slerp(new THREE.Quaternion(), 1 - THUMB_MAX_SWING / angle);
    out.set(bone, q);
    parent.multiply(q);
  }

  preserveThumbContact(hand, side, toHandLocal, rig, out, handshape);
}

/**
 * Posiciones de una cadena de huesos en el marco de la mano (origen en el
 * hueso de la mano, orientación de reposo), dadas sus rotaciones locales.
 * Devuelve el origen de cada hueso y, al final, la punta del último.
 */
function handChainPositions(
  rig: AvatarRig,
  side: Side,
  bones: string[],
  out: BoneRotations,
): THREE.Vector3[] {
  const origin = rig.position(`${side}Hand`);
  const q = new THREE.Quaternion();
  let pos = rig.position(`${side}${bones[0]}`).clone().sub(origin);
  const points = [pos.clone()];
  for (const part of bones) {
    const bone = `${side}${part}`;
    q.multiply(out.get(bone) ?? new THREE.Quaternion());
    const offset = rig.tip(bone).sub(rig.position(bone)).applyQuaternion(q);
    pos = pos.clone().add(offset);
    points.push(pos.clone());
  }
  return points;
}

/**
 * Punto de los dedos del avatar al que va la yema del pulgar según el video:
 * la articulación más cercana a la yema observada más el desplazamiento
 * observado, escalado por el largo de mano. Peso 0 si no hay contacto.
 */
function observedThumbTarget(
  hand: number[][],
  side: Side,
  toHandLocal: THREE.Quaternion,
  rig: AvatarRig,
  out: BoneRotations,
): { target: THREE.Vector3; weight: number } | null {
  const observed = (i: number) =>
    toThree(hand[i]).sub(toThree(hand[0])).applyQuaternion(toHandLocal);
  const observedHandLength = observed(9).length();
  const avatarHandLength = rig.position(`${side}MiddleProximal`).distanceTo(rig.position(`${side}Hand`));
  if (observedHandLength < 1e-6) return null;

  const tipObserved = observed(4);
  let nearest = THUMB_CONTACT_JOINTS[0];
  for (const candidate of THUMB_CONTACT_JOINTS) {
    if (tipObserved.distanceTo(observed(candidate[0])) < tipObserved.distanceTo(observed(nearest[0]))) {
      nearest = candidate;
    }
  }
  const ratio = tipObserved.distanceTo(observed(nearest[0])) / observedHandLength;
  const weight = smoothstep((THUMB_CONTACT_RATIO - ratio) / THUMB_CONTACT_FADE);
  if (weight <= 0) return null;

  const [landmark, finger, phalanges] = nearest;
  const chain = PHALANGES.slice(0, phalanges).map((p) => finger + p);
  const joint = handChainPositions(rig, side, chain, out).at(-1)!;
  const target = joint.add(
    tipObserved.sub(observed(landmark)).multiplyScalar(avatarHandLength / observedHandLength),
  );
  return { target, weight };
}

/** Grosor de un dedo del modelo: separa la yema del pulgar del costado del índice. */
const FINGER_THICKNESS = 0.012;

/**
 * Pulgar de una configuración registrada. En el puño va cerrado junto al
 * costado del índice, a la altura de su falange media (configuración A, la del
 * video de Por favor). La detección lo daba levantado, porque en el puño la
 * yema queda lejos de las articulaciones que usa observedThumbTarget.
 */
function handshapeThumbTarget(
  rig: AvatarRig,
  side: Side,
  out: BoneRotations,
  handshape: Handshape,
): { target: THREE.Vector3; weight: number } {
  const [mcp, pip, dip] = handChainPositions(rig, side, ['IndexProximal', 'IndexIntermediate'], out);
  const radial = rig.position(`${side}IndexProximal`).clone().sub(rig.position(`${side}LittleProximal`)).normalize();
  // Mano plana (B de Gracias): pulgar pegado al costado del índice, con la
  // yema a la altura de su falange proximal.
  const joint = handshape === 'plana' ? mcp.lerp(pip, 0.6) : pip.lerp(dip, 0.5);
  return { target: joint.addScaledVector(radial, FINGER_THICKNESS), weight: 1 };
}

/**
 * Preserva el contacto del pulgar con los dedos. Seguir solo la dirección de
 * cada falange no basta: el pulgar de VRoid es más largo y nace en otro punto
 * que el de una persona, así que con las mismas direcciones su punta quedaba
 * separada del puño (Por favor: hasta 0.49 largos de mano del índice, contra
 * 0.32 en el video). Si en el video la punta del pulgar está cerca de una
 * articulación de los dedos, se lleva la punta del avatar al mismo punto
 * relativo con IK (CCD) sobre metacarpo y falange proximal, con peso que se
 * apaga a medida que el pulgar se aleja para no forzar contactos que no hay.
 */
function preserveThumbContact(
  hand: number[][] | null,
  side: Side,
  toHandLocal: THREE.Quaternion,
  rig: AvatarRig,
  out: BoneRotations,
  handshape?: Handshape,
): void {
  const contact = handshape
    ? handshapeThumbTarget(rig, side, out, handshape)
    : observedThumbTarget(hand!, side, toHandLocal, rig, out);
  if (!contact) return;
  const { target, weight } = contact;
  // Con configuración registrada la falange distal observada no es confiable
  // (en el puño la daba estirada): también entra al IK.
  const joints = handshape ? [2, 1, 0] : [1, 0];

  const thumb = ['ThumbMetacarpal', 'ThumbProximal', 'ThumbDistal'];
  const original = thumb.map((part) => (out.get(`${side}${part}`) ?? new THREE.Quaternion()).clone());
  for (let iteration = 0; iteration < 8; iteration++) {
    for (const j of joints) {
      const points = handChainPositions(rig, side, thumb, out);
      const toEnd = points[3].clone().sub(points[j]);
      const toTarget = target.clone().sub(points[j]);
      if (toEnd.lengthSq() < 1e-12 || toTarget.lengthSq() < 1e-12) continue;
      // Rotación en el marco de la mano, llevada al marco local del hueso.
      const parentQ = new THREE.Quaternion();
      for (let k = 0; k < j; k++) parentQ.multiply(out.get(`${side}${thumb[k]}`)!);
      const delta = new THREE.Quaternion().setFromUnitVectors(toEnd.normalize(), toTarget.normalize());
      const bone = `${side}${thumb[j]}`;
      const local = parentQ.clone().invert().multiply(delta).multiply(parentQ).multiply(out.get(bone)!);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(local.w)));
      if (angle > THUMB_MAX_SWING) local.slerp(new THREE.Quaternion(), 1 - THUMB_MAX_SWING / angle);
      out.set(bone, local);
    }
  }
  thumb.forEach((part, i) => {
    const bone = `${side}${part}`;
    out.set(bone, original[i].clone().slerp(out.get(bone)!, weight));
  });
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
  // La cabeza primero: un contacto con la cara la sigue (faceContactTarget).
  retargetHead(frame, out);
  retargetArm(frame, 'left', ctx, out);
  retargetArm(frame, 'right', ctx, out);
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

/** Fracción de la mediana del ancho de nudillos bajo la cual una mano es implausible. */
const MIN_KNUCKLE_SPAN = 0.8;

/**
 * Descarta las detecciones de mano geométricamente imposibles. El ancho entre
 * los nudillos del índice y del meñique (landmarks 5 y 17) de una persona no
 * cambia; si en un frame "encoge" muy por debajo de su mediana en el clip,
 * MediaPipe estimó mal la mano (típico en un puño) y su orientación salta. En
 * Por favor: 6.5 → 4.6 cm en un frame, con un giro falso de 24° que se veía
 * como un latigazo de la muñeca. Esos frames quedan sin mano y la limpieza
 * los rellena interpolando entre vecinos.
 */
export function dropImplausibleHands(frames: LandmarkFrame[]): LandmarkFrame[] {
  const span = (h: number[][]) => Math.hypot(h[5][0] - h[17][0], h[5][1] - h[17][1], h[5][2] - h[17][2]);
  const medians = {} as Record<Side, number>;
  for (const side of ['left', 'right'] as const) {
    medians[side] = median(frames.flatMap((f) => (f[`${side}HandWorld`] ? [span(f[`${side}HandWorld`]!)] : [])));
  }
  return frames.map((f) => {
    let out = f;
    for (const side of ['left', 'right'] as const) {
      const hand = f[`${side}HandWorld`];
      if (hand && span(hand) < MIN_KNUCKLE_SPAN * medians[side]) {
        out = { ...out, [`${side}HandWorld`]: null };
      }
    }
    return out;
  });
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

/**
 * Respiración: el pecho se inclina apenas hacia atrás al inhalar. Sin ella el
 * torso quedaba congelado y el avatar se veía como maniquí aunque las manos se
 * movieran bien (A34). Depende del tiempo absoluto, no del ciclo de la seña:
 * no se reinicia al repetir (no hay salto) y con `?t=` queda fija. Brazos y
 * cabeza cuelgan del pecho, así que la mano apoyada se mueve con él.
 */
const BREATH_SECONDS = 3.6;
const BREATH_RADIANS = 0.012;
const X_AXIS = new THREE.Vector3(1, 0, 0);
export function breathing(elapsedSeconds: number): number {
  return -BREATH_RADIANS * 0.5 * (1 - Math.cos((2 * Math.PI * elapsedSeconds) / BREATH_SECONDS));
}

export interface SignPlayer {
  /**
   * Aplica la pose interpolada para el tiempo dado (en segundos, en loop).
   * `weight` < 1 la mezcla con la pose de reposo (0 = reposo), para entrar a
   * la seña de forma gradual.
   */
  update(elapsedSeconds: number, weight?: number): void;
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
  /** Expresión de la cara durante la seña (ver face.ts). */
  face?: FaceExpression;
  /** Configuración manual registrada por mano (ver HANDSHAPE_FLEX). */
  handshape?: Partial<Record<Side, Handshape>>;
  /** Contacto registrado de la yema con la cara, por mano (ver faceContactTarget). */
  faceContact?: Partial<Record<Side, [number, number]>>;
  /** Palma hacia arriba registrada, por mano (ver palmUpRotation). */
  palmUp?: Partial<Record<Side, [number, number]>>;
  /**
   * Instante (s del video) hasta el cual una mano se queda en la pose que tiene
   * en él: la mano de apoyo empieza ya en su lugar en vez de subir desde el
   * regazo, que es preparación y no seña (A37).
   */
  holdUntil?: Partial<Record<Side, number>>;
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
  const ctx: RetargetContext = {
    rig,
    armScale: armScales(rig, data.frames),
    handshape: options.handshape,
    faceContact: options.faceContact,
    palmUp: options.palmUp,
  };
  const { frames: detected } = data;
  const frames = dropImplausibleHands(detected);
  const [from, to] = options.window ?? [-Infinity, Infinity];

  // Una mano que nunca se detecta en la seña está fuera de cuadro (en el
  // regazo): la pose estima ese brazo a ciegas y lo dejaba flotando frente al
  // vientre. Ese brazo va en reposo durante todo el clip.
  const unseen = (['left', 'right'] as const).filter((side) =>
    detected.every((f) => f.t < from || f.t > to || !f[`${side}HandWorld`]),
  );
  const perFrame = frames.map((f, i) => {
    const rotations = retargetFrame(f, ctx);
    // Mano descartada por implausible: el antebrazo tampoco se usa ese frame,
    // porque su giro sale de la mano. Ambos se interpolan con los vecinos.
    for (const side of ['left', 'right'] as const) {
      if (detected[i][`${side}HandWorld`] && !f[`${side}HandWorld`] && !spanWeight(ctx.palmUp?.[side], f.t)) {
        rotations.delete(`${side}LowerArm`);
      }
    }
    for (const side of unseen) {
      for (const bone of rotations.keys()) if (bone.startsWith(side)) rotations.delete(bone);
    }
    return rotations;
  });
  // Mano que empieza ya en su lugar (ver SignPlayerOptions.holdUntil): antes
  // de ese instante, su brazo copia la pose que tiene en él.
  for (const side of ['left', 'right'] as const) {
    const until = options.holdUntil?.[side];
    if (until === undefined) continue;
    const k = frames.findIndex((f) => f.t >= until);
    if (k < 0) continue;
    for (let i = 0; i < k; i++) {
      for (const part of ARM_PARTS) {
        const bone = `${side}${part}`;
        const held = perFrame[k].get(bone);
        if (held) perFrame[i].set(bone, held.clone());
        else perFrame[i].delete(bone);
      }
      const shoulder = perFrame[k].get(`${side}Shoulder`);
      if (shoulder) perFrame[i].set(`${side}Shoulder`, shoulder.clone());
    }
  }
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

  const face = createSignFace(vrm, options.face);
  const chest = vrm.humanoid.getNormalizedBoneNode('upperChest') ?? vrm.humanoid.getNormalizedBoneNode('chest');
  const duration = clip.frameCount / clip.fps;
  const returnStart = clip.returnStartFrame / clip.fps;
  return {
    duration,
    update(elapsedSeconds: number, weight = 1) {
      const t = ((elapsedSeconds % duration) + duration) % duration;
      const cycle = Math.floor(elapsedSeconds / duration);
      face.apply(weight, weight < 1 ? 0 : blinkWeight(t, cycle, returnStart, duration));
      const exact = t * clip.fps;
      const i = Math.floor(exact) % clip.frameCount;
      // El último frame es la pose inicial (cierre del bucle): envolver a 0 es continuo.
      const next = (i + 1) % clip.frameCount;
      const alpha = exact - Math.floor(exact);
      for (const [bone, node] of nodes) {
        const track = clip.tracks.get(bone)!;
        node.quaternion.slerpQuaternions(track[i], track[next], alpha);
        if (weight < 1) node.quaternion.copy(restRotation(bone).slerp(node.quaternion, weight));
      }
      chest?.quaternion.setFromAxisAngle(X_AXIS, breathing(elapsedSeconds));
    },
  };
}
