import { LANDMARK_COUNT, MIDDLE_MCP, WRIST } from './types';
import type { Handedness, Landmark } from './types';

/**
 * Versión de la definición de features. Plantillas de otra versión no son
 * comparables y deben migrarse (ver migrateFeatureVector).
 * - v1: coordenadas normalizadas tal cual (0–1 por ancho y por alto).
 * - v2: x y z escaladas por la proporción de la imagen (ancho/alto).
 */
export const FEATURE_VERSION = 2;

/**
 * Convert raw landmarks into a translation/scale/mirror-invariant feature
 * vector (63 dims = 21 × xyz):
 *
 * - x and z are multiplied by the image aspect ratio (width / height):
 *   MediaPipe normalizes x by the image width and y by its height (z uses
 *   roughly the scale of x), so the same hand yields a differently squashed
 *   shape on a 16:9 camera than on a 4:3 one. Scaling by the aspect puts all
 *   three axes in the same unit (image heights) and makes features
 *   independent of the camera's proportions;
 * - left hands are mirrored to a canonical right hand, so users can sign
 *   with either hand;
 * - the wrist is moved to the origin, so position in frame doesn't matter;
 * - distances are scaled by wrist→middle-MCP length, so distance to the
 *   camera doesn't matter.
 *
 * In-plane rotation is intentionally NOT removed: some signs are
 * distinguished mainly by hand orientation, and collapsing rotation would
 * make them identical.
 */
export function toFeatureVector(
  landmarks: Landmark[],
  handedness: Handedness,
  aspect: number,
): number[] {
  if (landmarks.length !== LANDMARK_COUNT) {
    throw new Error(`Expected ${LANDMARK_COUNT} landmarks, got ${landmarks.length}`);
  }
  const wrist = landmarks[WRIST]!;
  const middle = landmarks[MIDDLE_MCP]!;
  const mirror = handedness === 'Left' ? -1 : 1;

  const scale =
    Math.hypot(
      aspect * (middle.x - wrist.x),
      middle.y - wrist.y,
      aspect * (middle.z - wrist.z),
    ) || 1;

  const vector: number[] = new Array(LANDMARK_COUNT * 3);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = landmarks[i]!;
    vector[i * 3] = (mirror * aspect * (p.x - wrist.x)) / scale;
    vector[i * 3 + 1] = (p.y - wrist.y) / scale;
    vector[i * 3 + 2] = (aspect * (p.z - wrist.z)) / scale;
  }
  return vector;
}

/**
 * Convierte un vector v1 (sin corrección de proporción) a v2, conociendo la
 * proporción de la cámara con que se grabó.
 *
 * Es exacto para un vector de un frame: v1 guarda (p − muñeca) / escala, así
 * que escalar x y z por la proporción y renormalizar por el nuevo largo
 * muñeca→nudillo medio (que se lee del propio vector, landmark 9) da lo mismo
 * que recalcular desde los landmarks. La escala original se cancela. Para
 * promedios (estáticas) o secuencias remuestreadas (dinámicas) es una
 * aproximación muy cercana, porque se promediaron antes de renormalizar.
 */
export function migrateFeatureVector(vector: number[], aspect: number): number[] {
  const scaled = vector.map((value, i) => (i % 3 === 1 ? value : value * aspect));
  const k = MIDDLE_MCP * 3;
  const scale = Math.hypot(scaled[k]!, scaled[k + 1]!, scaled[k + 2]!) || 1;
  return scaled.map((value) => value / scale);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector length mismatch');
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector length mismatch');
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/** Element-wise mean of several feature vectors (template centroid). */
export function meanVector(vectors: number[][]): number[] {
  if (vectors.length === 0) throw new Error('Cannot average zero vectors');
  const dim = vectors[0]!.length;
  const mean = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) throw new Error('Vector length mismatch');
    for (let i = 0; i < dim; i++) mean[i]! += v[i]!;
  }
  for (let i = 0; i < dim; i++) mean[i]! /= vectors.length;
  return mean;
}
