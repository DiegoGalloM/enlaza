import { euclideanDistance } from './normalize';
import type { ClassifyResult, DynamicTemplate } from './types';

/** Frames per resampled sequence — all DTW comparisons use this length. */
export const SEQUENCE_LENGTH = 16;

/** Default acceptance threshold for dynamic signs (DTW similarity). */
export const DYNAMIC_THRESHOLD = 0.6;

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

/** Classic dynamic time warping cost between two sequences of vectors. */
export function dtwDistance(a: number[][], b: number[][]): number {
  const n = a.length;
  const m = b.length;
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(INF));
  cost[0]![0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const d = euclideanDistance(a[i - 1]!, b[j - 1]!);
      cost[i]![j] = d + Math.min(cost[i - 1]![j]!, cost[i]![j - 1]!, cost[i - 1]![j - 1]!);
    }
  }
  // Normalize by path length so longer sequences aren't penalized.
  return cost[n]![m]! / (n + m);
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
): ClassifyResult[] {
  const seq = resampleSequence(frames);
  return templates
    .map((t) => ({ signId: t.signId, score: dtwSimilarity(dtwDistance(seq, t.frames)) }))
    .sort((a, b) => b.score - a.score);
}

export function buildDynamicTemplate(
  signId: string,
  frames: number[][],
  sourceMs?: number,
): DynamicTemplate {
  const template: DynamicTemplate = { signId, type: 'dynamic', frames: resampleSequence(frames) };
  if (sourceMs !== undefined) template.sourceMs = sourceMs;
  return template;
}

/** Convenience: does this sequence match the target sign above the threshold? */
export function matchesDynamic(
  frames: number[][],
  targetSignId: string,
  templates: DynamicTemplate[],
  threshold = DYNAMIC_THRESHOLD,
): { correct: boolean; best: ClassifyResult | null } {
  const ranked = classifyDynamic(frames, templates);
  const best = ranked[0] ?? null;
  return {
    correct: best !== null && best.signId === targetSignId && best.score >= threshold,
    best,
  };
}
