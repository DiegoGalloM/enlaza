import { describe, expect, it } from 'vitest';
import { cosineSimilarity, euclideanDistance, meanVector, toFeatureVector } from '../src/normalize';
import { mirrorPose, mulberry32, randomPose, transformPose } from './synthetic';

describe('toFeatureVector', () => {
  const rng = mulberry32(42);
  const pose = randomPose(rng);

  it('rejects wrong landmark counts', () => {
    expect(() => toFeatureVector(pose.slice(0, 5), 'Right')).toThrow();
  });

  it('is invariant to translation', () => {
    const moved = transformPose(pose, 0.2, -0.1, 1);
    const a = toFeatureVector(pose, 'Right');
    const b = toFeatureVector(moved, 'Right');
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.999);
  });

  it('is invariant to scale (distance from camera)', () => {
    const scaled = transformPose(pose, 0, 0, 0.55);
    const a = toFeatureVector(pose, 'Right');
    const b = toFeatureVector(scaled, 'Right');
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.999);
  });

  it('maps a mirrored left hand onto the canonical right hand', () => {
    const a = toFeatureVector(pose, 'Right');
    const b = toFeatureVector(mirrorPose(pose), 'Left');
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.999);
  });

  it('distinguishes different poses', () => {
    const other = randomPose(rng);
    const a = toFeatureVector(pose, 'Right');
    const b = toFeatureVector(other, 'Right');
    expect(cosineSimilarity(a, b)).toBeLessThan(0.98);
  });
});

describe('vector helpers', () => {
  it('euclideanDistance is zero for identical vectors', () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });

  it('meanVector averages element-wise', () => {
    expect(meanVector([[0, 2], [2, 4]])).toEqual([1, 3]);
  });

  it('meanVector rejects empty input', () => {
    expect(() => meanVector([])).toThrow();
  });
});
