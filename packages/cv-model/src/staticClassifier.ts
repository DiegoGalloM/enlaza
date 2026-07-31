import { cosineSimilarity, meanVector } from './normalize';
import type { ClassifyResult, StaticTemplate } from './types';

/** Default acceptance threshold for static signs (cosine similarity). */
export const STATIC_THRESHOLD = 0.92;

/** Build a template from several normalized sample vectors of the same sign. */
export function buildStaticTemplate(signId: string, samples: number[][]): StaticTemplate {
  return { signId, type: 'static', vector: meanVector(samples) };
}

/**
 * Rank templates by similarity to the given feature vector.
 * Returns results sorted best-first; empty array if no templates.
 */
export function classifyStatic(
  vector: number[],
  templates: StaticTemplate[],
): ClassifyResult[] {
  return templates
    .map((t) => ({ signId: t.signId, score: cosineSimilarity(vector, t.vector) }))
    .sort((a, b) => b.score - a.score);
}

/** Convenience: does this vector match the target sign above the threshold? */
export function matchesStatic(
  vector: number[],
  targetSignId: string,
  templates: StaticTemplate[],
  threshold = STATIC_THRESHOLD,
): { correct: boolean; best: ClassifyResult | null } {
  const ranked = classifyStatic(vector, templates);
  const best = ranked[0] ?? null;
  return {
    correct: best !== null && best.signId === targetSignId && best.score >= threshold,
    best,
  };
}
