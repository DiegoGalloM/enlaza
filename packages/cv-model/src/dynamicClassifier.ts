import { euclideanDistance } from './normalize';
import type { ClassifyResult, DynamicTemplate } from './types';

/** Frames per resampled sequence — all DTW comparisons use this length. */
export const SEQUENCE_LENGTH = 16;

/** Default acceptance threshold for dynamic signs (DTW similarity). */
export const DYNAMIC_THRESHOLD = 0.6;

/**
 * Peso de la forma del recorrido de la muñeca frente a la forma de la mano en
 * la distancia DTW (ver motion.ts). Aporta poco por sí solo: con los círculos
 * pequeños de Por favor, ni con peso 4 dejaba de validar un puño quieto, y
 * pesos altos tumbaban la seña real a 1.25×. Lo que evita el puño quieto es
 * la compuerta MIN_MOTION_RATIO. Se deja un peso bajo para que la forma del
 * recorrido cuente algo entre señas de misma configuración y distinto
 * movimiento. Medido con tools/content/tune-motion.mjs (D36).
 */
export const MOTION_WEIGHT = 0.5;

/**
 * Compuerta de cantidad de movimiento: si la plantilla se mueve (más que
 * MOTION_NOISE_FLOOR) y la captura se mueve menos que esta fracción de lo que
 * se mueve la plantilla, el puntaje se escala hacia abajo en proporción. El
 * término DTW solo no bastaba: los círculos de Por favor son tan pequeños que
 * un puño quieto seguía cerca de ellos (D36).
 *
 * 0.4: con 0.3–0.5 la seña real valida igual (cámaras 16:9 y 4:3, 0.8×–1.25×)
 * y la mano quieta con el temblor medido del detector no valida.
 */
export const MIN_MOTION_RATIO = 0.4;

/** Movimiento (RMS, en largos de mano) por debajo del cual se considera ruido del detector. */
export const MOTION_NOISE_FLOOR = 0.05;

/**
 * Compuerta de lugar (D37): error medio, en altos de cara, entre el lugar de
 * la mano en la captura y en la plantilla, sobre los pares de frames que
 * alinea DTW. Hasta LOCATION_TOLERANCE el puntaje no cambia; de ahí baja en
 * línea recta hasta 0 en LOCATION_TOLERANCE + LOCATION_FADE. Medido con
 * tools/content/tune-motion.mjs (lugar desplazado frente a la seña real).
 */
export const LOCATION_TOLERANCE = 0.6;
export const LOCATION_FADE = 0.6;

export interface DynamicMotionOptions {
  /** Trayectoria de la muñeca de la captura (motionTrajectory, sin preparar). */
  motion?: number[][];
  motionWeight?: number;
  minMotionRatio?: number;
  /** Lugar de la mano respecto a la cara en la captura (locationTrajectory). */
  location?: number[][];
  /** Tolerancia de lugar en altos de cara (Infinity = sin compuerta de lugar). */
  locationTolerance?: number;
}

/** Factor de la compuerta de lugar para un error medio dado (1 = sin castigo). */
export function locationFactor(error: number, tolerance = LOCATION_TOLERANCE): number {
  return Math.min(1, Math.max(0, 1 - (error - tolerance) / LOCATION_FADE));
}

/** Cantidad de movimiento de una trayectoria preparada: distancia RMS al centro. */
export function motionAmount(prepared: number[][]): number {
  if (prepared.length === 0) return 0;
  let sum = 0;
  for (const point of prepared) sum += point[0]! ** 2 + point[1]! ** 2;
  return Math.sqrt(sum / prepared.length);
}

/**
 * Linearly resample a sequence of feature vectors to `n` frames, so
 * sequences signed at different speeds become comparable.
 */
export function resampleSequence(frames: number[][], n = SEQUENCE_LENGTH): number[][] {
  if (frames.length === 0) throw new Error('Cannot resample an empty sequence');
  if (frames.length === 1) return Array.from({ length: n }, () => [...frames[0]!]);

  const result: number[][] = [];
  const dim = frames[0]!.length;
  for (let i = 0; i < n; i++) {
    const pos = (i / (n - 1)) * (frames.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.min(lo + 1, frames.length - 1);
    const t = pos - lo;
    const frame = new Array<number>(dim);
    for (let d = 0; d < dim; d++) {
      frame[d] = frames[lo]![d]! * (1 - t) + frames[hi]![d]! * t;
    }
    result.push(frame);
  }
  return result;
}

/**
 * Remuestrea una trayectoria de muñeca (motionTrajectory) a SEQUENCE_LENGTH y
 * la centra en su promedio: importa la forma del recorrido, no en qué parte
 * del cuadro ocurre.
 */
export function prepareMotion(trajectory: number[][]): number[][] {
  const resampled = resampleSequence(trajectory);
  let meanX = 0;
  let meanY = 0;
  for (const point of resampled) {
    meanX += point[0]! / resampled.length;
    meanY += point[1]! / resampled.length;
  }
  return resampled.map((point) => [point[0]! - meanX, point[1]! - meanY]);
}

/**
 * Classic dynamic time warping cost between two sequences of vectors.
 * Si se pasan trayectorias de muñeca (ya preparadas) para ambas secuencias, el
 * costo de cada par de frames combina forma y movimiento:
 * raíz(forma² + (peso · movimiento)²).
 */
export function dtwDistance(
  a: number[][],
  b: number[][],
  motionA?: number[][],
  motionB?: number[][],
  motionWeight = MOTION_WEIGHT,
): number {
  return dtwAlign(a, b, motionA, motionB, motionWeight).distance;
}

/**
 * DTW con el camino de alineación: pares [i, j] de frames de `a` y `b` que
 * quedaron emparejados, del inicio al final. El camino sirve para comparar el
 * lugar de la mano frame a frame ya alineados en tiempo (D37).
 */
export function dtwAlign(
  a: number[][],
  b: number[][],
  motionA?: number[][],
  motionB?: number[][],
  motionWeight = MOTION_WEIGHT,
): { distance: number; path: [number, number][] } {
  const withMotion = motionA !== undefined && motionB !== undefined;
  const n = a.length;
  const m = b.length;
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(INF));
  cost[0]![0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const shape = euclideanDistance(a[i - 1]!, b[j - 1]!);
      const d = withMotion
        ? Math.hypot(shape, motionWeight * euclideanDistance(motionA[i - 1]!, motionB[j - 1]!))
        : shape;
      cost[i]![j] = d + Math.min(cost[i - 1]![j]!, cost[i]![j - 1]!, cost[i - 1]![j - 1]!);
    }
  }
  const path: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1]);
    const diagonal = cost[i - 1]![j - 1]!;
    const up = cost[i - 1]![j]!;
    const left = cost[i]![j - 1]!;
    if (diagonal <= up && diagonal <= left) {
      i--;
      j--;
    } else if (up <= left) {
      i--;
    } else {
      j--;
    }
  }
  path.reverse();
  // Normalize by path length so longer sequences aren't penalized.
  return { distance: cost[n]![m]! / (n + m), path };
}

/** Error medio de lugar a lo largo de un camino DTW, en altos de cara. */
export function locationError(
  path: [number, number][],
  locationA: number[][],
  locationB: number[][],
): number {
  let sum = 0;
  for (const [i, j] of path) sum += euclideanDistance(locationA[i]!, locationB[j]!);
  return path.length > 0 ? sum / path.length : 0;
}

/** Map a DTW distance to a similarity score in (0, 1]. */
export function dtwSimilarity(distance: number): number {
  return 1 / (1 + distance);
}

/**
 * Rank dynamic templates against a captured sequence.
 * The input sequence is resampled internally; templates are assumed to be
 * stored already resampled (see `buildDynamicTemplate`).
 */
export function classifyDynamic(
  frames: number[][],
  templates: DynamicTemplate[],
  options: DynamicMotionOptions = {},
): ClassifyResult[] {
  const {
    motion,
    motionWeight = MOTION_WEIGHT,
    minMotionRatio = MIN_MOTION_RATIO,
    location,
    locationTolerance = LOCATION_TOLERANCE,
  } = options;
  const seq = resampleSequence(frames);
  // Lugar: solo si la captura lo trae (hubo cara) y la plantilla también.
  const seqLocation =
    location && location.length > 0 && Number.isFinite(locationTolerance)
      ? resampleSequence(location)
      : undefined;
  // El movimiento solo se usa contra plantillas que también lo traen; las
  // demás (p. ej. grabadas en /plantillas antes de D36) se comparan solo por
  // forma, como antes.
  const seqMotion = motion && motion.length > 0 ? prepareMotion(motion) : undefined;
  const seqAmount = seqMotion ? motionAmount(seqMotion) : 0;
  return templates
    .map((t) => {
      const templateMotion = seqMotion ? t.motion : undefined;
      const aligned = dtwAlign(seq, t.frames, seqMotion, templateMotion, motionWeight);
      let score = dtwSimilarity(aligned.distance);
      if (seqLocation && t.location) {
        score *= locationFactor(
          locationError(aligned.path, seqLocation, t.location),
          locationTolerance,
        );
      }
      if (templateMotion) {
        const templateAmount = motionAmount(templateMotion);
        if (templateAmount > MOTION_NOISE_FLOOR && minMotionRatio > 0) {
          score *= Math.min(1, seqAmount / (minMotionRatio * templateAmount));
        }
      }
      return { signId: t.signId, score };
    })
    .sort((a, b) => b.score - a.score);
}

export function buildDynamicTemplate(
  signId: string,
  frames: number[][],
  sourceMs?: number,
  motion?: number[][],
  location?: number[][],
): DynamicTemplate {
  const template: DynamicTemplate = { signId, type: 'dynamic', frames: resampleSequence(frames) };
  if (sourceMs !== undefined) template.sourceMs = sourceMs;
  if (motion && motion.length > 0) template.motion = prepareMotion(motion);
  if (location && location.length > 0) template.location = resampleSequence(location);
  return template;
}

/** Convenience: does this sequence match the target sign above the threshold? */
export function matchesDynamic(
  frames: number[][],
  targetSignId: string,
  templates: DynamicTemplate[],
  threshold = DYNAMIC_THRESHOLD,
  motion?: number[][],
): { correct: boolean; best: ClassifyResult | null } {
  const ranked = classifyDynamic(frames, templates, { motion });
  const best = ranked[0] ?? null;
  return {
    correct: best !== null && best.signId === targetSignId && best.score >= threshold,
    best,
  };
}
