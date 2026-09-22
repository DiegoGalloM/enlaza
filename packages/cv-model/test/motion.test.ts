import { describe, expect, it } from 'vitest';
import { toFeatureVector } from '../src/normalize';
import {
  buildDynamicTemplate,
  classifyDynamic,
  DYNAMIC_THRESHOLD,
  motionAmount,
  prepareMotion,
} from '../src/dynamicClassifier';
import { motionTrajectory, wristSample } from '../src/motion';
import { SessionValidator } from '../src/session';
import type { HandFrame, Landmark } from '../src/types';
import { mulberry32, randomPose, transformPose } from './synthetic';

const rng = mulberry32(21);
const fist = randomPose(rng); // forma constante, como el puño de Por favor
const FRAMES = 48; // ~1.6 s a 30 fps
const RADIUS = 0.03; // en alto de imagen: ~0.2 largos de mano, como sus círculos

/** La misma forma haciendo `turns` círculos (o quieta si turns = 0). */
function circling(turns: number, radius = RADIUS): Landmark[][] {
  return Array.from({ length: FRAMES }, (_, i) => {
    const angle = (2 * Math.PI * turns * i) / FRAMES;
    return transformPose(fist, radius * Math.cos(angle), radius * Math.sin(angle), 1);
  });
}

const vectors = (seq: Landmark[][]) => seq.map((p) => toFeatureVector(p, 'Right', 1));
const trajectory = (seq: Landmark[][]) =>
  motionTrajectory(seq.map((p) => wristSample(p, 'Right', 1)));

describe('wristSample', () => {
  it('escala x por la proporción y espeja las manos izquierdas, como la forma', () => {
    const right = wristSample(fist, 'Right', 16 / 9);
    const left = wristSample(fist, 'Left', 16 / 9);
    expect(right.x).toBeCloseTo((fist[0]!.x * 16) / 9, 9);
    expect(left.x).toBeCloseTo(-right.x, 9);
    expect(right.y).toBe(fist[0]!.y);
    expect(right.handLength).toBeGreaterThan(0);
  });
});

describe('motionTrajectory', () => {
  it('mide en largos de mano: acercarse a la cámara no cambia la trayectoria', () => {
    const near = circling(1).map((p) => transformPose(p, 0, 0, 2)); // mano el doble de grande
    const far = circling(1);
    const a = prepareMotion(trajectory(far));
    // Al doble de tamaño el radio en imagen es el mismo, así que en largos de mano es la mitad.
    const b = prepareMotion(trajectory(near));
    expect(motionAmount(b)).toBeCloseTo(motionAmount(a) / 2, 2);
  });

  it('el suavizado reduce el temblor de frame a frame', () => {
    const shaky = Array.from({ length: FRAMES }, (_, i) =>
      transformPose(fist, i % 2 ? 0.004 : -0.004, 0, 1),
    );
    const raw = shaky.map((p) => wristSample(p, 'Right', 1));
    const rawAmplitude = 0.004 / raw[0]!.handLength;
    expect(motionAmount(prepareMotion(motionTrajectory(raw)))).toBeLessThan(rawAmplitude / 2);
  });

  it('prepareMotion centra la trayectoria', () => {
    const prepared = prepareMotion(trajectory(circling(1)));
    const mean = prepared.reduce((acc, [x, y]) => [acc[0]! + x!, acc[1]! + y!], [0, 0]);
    expect(Math.abs(mean[0]!) + Math.abs(mean[1]!)).toBeLessThan(1e-9);
  });
});

describe('classifyDynamic con movimiento', () => {
  const template = buildDynamicTemplate('por-favor', vectors(circling(2)), 1600, trajectory(circling(2)));

  it('la seña con sus círculos valida', () => {
    const [best] = classifyDynamic(vectors(circling(2)), [template], { motion: trajectory(circling(2)) });
    expect(best!.score).toBeGreaterThan(DYNAMIC_THRESHOLD);
  });

  it('la misma forma quieta NO valida (el problema de D35)', () => {
    const still = circling(0);
    const [withoutGate] = classifyDynamic(vectors(still), [template], { motion: trajectory(still), minMotionRatio: 0 });
    const [withGate] = classifyDynamic(vectors(still), [template], { motion: trajectory(still) });
    expect(withoutGate!.score).toBeGreaterThan(DYNAMIC_THRESHOLD); // antes de D36 validaba
    expect(withGate!.score).toBeLessThan(DYNAMIC_THRESHOLD);
  });

  it('círculos más chicos que la fracción mínima no validan; un poco más chicos sí', () => {
    const tiny = circling(2, RADIUS * 0.2);
    const smaller = circling(2, RADIUS * 0.6);
    const score = (seq: Landmark[][]) =>
      classifyDynamic(vectors(seq), [template], { motion: trajectory(seq) })[0]!.score;
    expect(score(tiny)).toBeLessThan(DYNAMIC_THRESHOLD);
    expect(score(smaller)).toBeGreaterThan(DYNAMIC_THRESHOLD);
  });

  it('plantillas sin movimiento (grabadas antes de D36) se comparan solo por forma', () => {
    const legacy = buildDynamicTemplate('por-favor', vectors(circling(2)));
    const still = circling(0);
    const [best] = classifyDynamic(vectors(still), [legacy], { motion: trajectory(still) });
    expect(legacy.motion).toBeUndefined();
    expect(best!.score).toBeGreaterThan(DYNAMIC_THRESHOLD);
  });
});

describe('SessionValidator con movimiento', () => {
  const template = buildDynamicTemplate('por-favor', vectors(circling(2)), 1600, trajectory(circling(2)));
  const feedAll = (seq: Landmark[][]) => {
    const validator = new SessionValidator('por-favor', 'dynamic', [template]);
    let correct = false;
    for (let round = 0; round < 2; round++) {
      seq.forEach((landmarks, i) => {
        const frame: HandFrame = {
          landmarks,
          handedness: 'Right',
          timestampMs: (round * FRAMES + i) * 33,
          aspect: 1,
        };
        if (validator.feed(frame).status === 'correct') correct = true;
      });
    }
    return correct;
  };

  it('valida la seña con movimiento y no la mano quieta', () => {
    expect(feedAll(circling(2))).toBe(true);
    expect(feedAll(circling(0))).toBe(false);
  });
});
