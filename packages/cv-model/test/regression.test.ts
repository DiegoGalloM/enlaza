/**
 * Model regression suite (README §7): a fixed validation set is classified on
 * every run and accuracy must stay ≥ 90% — the honest target agreed with the
 * technical mentor (README §5). If a change to normalization or the
 * classifiers silently degrades accuracy, this suite fails.
 *
 * NOTE: until a real labeled LSC dataset exists (README §4.3 — the alphabet
 * video still needs frame extraction + labeling), the fixtures are synthetic
 * poses from a seeded PRNG. They verify the *pipeline's* discrimination
 * ability and invariances, NOT real-world accuracy. Replace `buildDataset`
 * with loaded fixtures (data/processed/) once recordings exist — keep the
 * same assertions.
 */
import { describe, expect, it } from 'vitest';
import { toFeatureVector } from '../src/normalize';
import { buildStaticTemplate, classifyStatic, matchesStatic } from '../src/staticClassifier';
import { buildDynamicTemplate, matchesDynamic } from '../src/dynamicClassifier';
import type { Landmark, StaticTemplate } from '../src/types';
import {
  jitterPose,
  mirrorPose,
  mulberry32,
  randomPose,
  randomSequence,
  timeWarp,
  transformPose,
} from './synthetic';

const ACCURACY_THRESHOLD = 0.9;
const CLASSES = 27; // full LSC alphabet size
const TRAIN_PER_CLASS = 6;
const TEST_PER_CLASS = 20;

const vec = (p: Landmark[]) => toFeatureVector(p, 'Right', 1);

describe('model regression: static signs (alphabet-sized)', () => {
  const rng = mulberry32(2026);
  const prototypes = Array.from({ length: CLASSES }, () => randomPose(rng));

  const templates: StaticTemplate[] = prototypes.map((proto, c) =>
    buildStaticTemplate(
      `letra-${c}`,
      Array.from({ length: TRAIN_PER_CLASS }, () => vec(jitterPose(proto, rng))),
    ),
  );

  it(`accuracy ≥ ${ACCURACY_THRESHOLD * 100}% on jittered/translated/scaled samples`, () => {
    let correct = 0;
    let total = 0;
    prototypes.forEach((proto, c) => {
      for (let s = 0; s < TEST_PER_CLASS; s++) {
        // Vary position and camera distance, plus jitter.
        const moved = transformPose(
          jitterPose(proto, rng),
          (rng() - 0.5) * 0.3,
          (rng() - 0.5) * 0.3,
          0.6 + rng() * 0.8,
        );
        const ranked = classifyStatic(vec(moved), templates);
        if (ranked[0]!.signId === `letra-${c}`) correct++;
        total++;
      }
    });
    const accuracy = correct / total;
    // eslint-disable-next-line no-console
    console.info(`[regression] static accuracy: ${(accuracy * 100).toFixed(1)}%`);
    expect(accuracy).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD);
  });

  it('left-handed samples classify equally well (mirror invariance)', () => {
    let correct = 0;
    prototypes.forEach((proto, c) => {
      const mirrored = mirrorPose(jitterPose(proto, rng));
      const sample = toFeatureVector(mirrored, 'Left', 1);
      const ranked = classifyStatic(sample, templates);
      if (ranked[0]!.signId === `letra-${c}`) correct++;
    });
    expect(correct / CLASSES).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD);
  });

  it('an unknown pose is not falsely accepted as the target', () => {
    let falseAccepts = 0;
    const trials = 50;
    for (let t = 0; t < trials; t++) {
      const stranger = randomPose(rng); // never trained
      const { correct: accepted } = matchesStatic(vec(stranger), 'letra-0', templates);
      if (accepted) falseAccepts++;
    }
    expect(falseAccepts / trials).toBeLessThanOrEqual(0.1);
  });
});

describe('model regression: dynamic signs', () => {
  const rng = mulberry32(4048);
  const DYN_CLASSES = 10;
  const sequences = Array.from({ length: DYN_CLASSES }, () => randomSequence(rng, 24));
  const templates = sequences.map((seq, c) =>
    buildDynamicTemplate(`palabra-${c}`, seq.map((f) => vec(f))),
  );

  it(`accuracy ≥ ${ACCURACY_THRESHOLD * 100}% on time-warped performances`, () => {
    let correct = 0;
    let total = 0;
    sequences.forEach((seq, c) => {
      for (let s = 0; s < 10; s++) {
        const performance = timeWarp(seq, rng).map((f) => vec(jitterPose(f, rng, 0.004)));
        const { correct: ok } = matchesDynamic(performance, `palabra-${c}`, templates);
        if (ok) correct++;
        total++;
      }
    });
    const accuracy = correct / total;
    // eslint-disable-next-line no-console
    console.info(`[regression] dynamic accuracy: ${(accuracy * 100).toFixed(1)}%`);
    expect(accuracy).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD);
  });
});
