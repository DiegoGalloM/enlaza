import { LANDMARK_COUNT, MIDDLE_MCP, WRIST } from './types';
import type { Handedness, Landmark } from './types';

/**
 * Convert raw landmarks into a translation/scale/mirror-invariant feature
 * vector (63 dims = 21 × xyz):
 *
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
export function toFeatureVector(landmarks: Landmark[], handedness: Handedness): number[] {
  if (landmarks.length !== LANDMARK_COUNT) {
    throw new Error(`Expected ${LANDMARK_COUNT} landmarks, got ${landmarks.length}`);
  }
  const wrist = landmarks[WRIST]!;
  const middle = landmarks[MIDDLE_MCP]!;
  const mirror = handedness === 'Left' ? -1 : 1;

  const scale =
    Math.hypot(middle.x - wrist.x, middle.y - wrist.y, middle.z - wrist.z) || 1;

  const vector: number[] = new Array(LANDMARK_COUNT * 3);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = landmarks[i]!;
    vector[i * 3] = (mirror * (p.x - wrist.x)) / scale;
    vector[i * 3 + 1] = (p.y - wrist.y) / scale;
    vector[i * 3 + 2] = (p.z - wrist.z) / scale;
  }
  return vector;
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
