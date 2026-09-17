import { describe, expect, it } from 'vitest';
import { toFeatureVector } from '../src/normalize';
import { buildStaticTemplate, classifyStatic, matchesStatic } from '../src/staticClassifier';
import {
  buildDynamicTemplate,
  classifyDynamic,
  dtwDistance,
  matchesDynamic,
  resampleSequence,
} from '../src/dynamicClassifier';
import { jitterPose, mulberry32, randomPose, randomSequence, timeWarp } from './synthetic';

describe('static classifier', () => {
  const rng = mulberry32(7);
  const poseA = randomPose(rng);
  const poseB = randomPose(rng);
  const vec = (p: ReturnType<typeof randomPose>) => toFeatureVector(p, 'Right', 1);

  const templates = [
    buildStaticTemplate('sign-a', [vec(poseA), vec(jitterPose(poseA, rng))]),
    buildStaticTemplate('sign-b', [vec(poseB), vec(jitterPose(poseB, rng))]),
  ];

  it('matches a jittered sample of the same sign', () => {
    const sample = vec(jitterPose(poseA, rng));
    const { correct, best } = matchesStatic(sample, 'sign-a', templates);
    expect(correct).toBe(true);
    expect(best?.signId).toBe('sign-a');
  });

  it('does not validate the wrong target sign', () => {
    const sample = vec(jitterPose(poseA, rng));
    const { correct } = matchesStatic(sample, 'sign-b', templates);
    expect(correct).toBe(false);
  });

  it('ranks all templates best-first', () => {
    const ranked = classifyStatic(vec(poseA), templates);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[1]!.score);
    expect(ranked[0]!.signId).toBe('sign-a');
  });
});

describe('dynamic classifier', () => {
  const rng = mulberry32(11);
  const seqA = randomSequence(rng);
  const seqB = randomSequence(rng);
  const toVectors = (frames: ReturnType<typeof randomSequence>) =>
    frames.map((f) => toFeatureVector(f, 'Right', 1));

  const templates = [
    buildDynamicTemplate('word-a', toVectors(seqA)),
    buildDynamicTemplate('word-b', toVectors(seqB)),
  ];

  it('resamples to the requested length', () => {
    expect(resampleSequence(toVectors(seqA), 16)).toHaveLength(16);
    expect(resampleSequence([toVectors(seqA)[0]!], 16)).toHaveLength(16);
  });

  it('rejects empty sequences', () => {
    expect(() => resampleSequence([])).toThrow();
  });

  it('DTW distance of a sequence to itself is ~0', () => {
    const v = resampleSequence(toVectors(seqA));
    expect(dtwDistance(v, v)).toBeLessThan(1e-9);
  });

  it('matches a time-warped performance of the same sign', () => {
    const warped = toVectors(timeWarp(seqA, rng));
    const { correct, best } = matchesDynamic(warped, 'word-a', templates);
    expect(correct).toBe(true);
    expect(best?.signId).toBe('word-a');
  });

  it('does not validate the wrong dynamic sign', () => {
    const warped = toVectors(timeWarp(seqA, rng));
    const { correct } = matchesDynamic(warped, 'word-b', templates);
    expect(correct).toBe(false);
  });

  it('ranks the correct template first', () => {
    const ranked = classifyDynamic(toVectors(seqB), templates);
    expect(ranked[0]!.signId).toBe('word-b');
  });
});
