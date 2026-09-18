import { describe, expect, it } from 'vitest';
import { toFeatureVector } from '../src/normalize';
import {
  buildDynamicTemplate,
  classifyDynamic,
  DYNAMIC_THRESHOLD,
  dtwAlign,
  locationFactor,
  LOCATION_TOLERANCE,
} from '../src/dynamicClassifier';
import { locationSample, locationTrajectory } from '../src/location';
import { motionTrajectory, wristSample } from '../src/motion';
import { SessionValidator } from '../src/session';
import type { FaceBox, HandFrame, Landmark } from '../src/types';
import { mulberry32, randomPose, transformPose } from './synthetic';

const rng = mulberry32(37);
const fist = randomPose(rng);
const FRAMES = 48;
const RADIUS = 0.03;
/** Cara arriba al centro; la mano de randomPose queda debajo, como en el pecho. */
const FACE: FaceBox = { x: 0.5, y: 0.2, width: 0.12, height: 0.15 };

/** Círculos del puño, con la mano desplazada `shift` altos de cara. */
function circling(shift: [number, number] = [0, 0]): Landmark[][] {
  return Array.from({ length: FRAMES }, (_, i) => {
    const angle = (4 * Math.PI * i) / FRAMES;
    return transformPose(
      fist,
      RADIUS * Math.cos(angle) + shift[0] * FACE.height,
      RADIUS * Math.sin(angle) + shift[1] * FACE.height,
      1,
    );
  });
}
const vectors = (seq: Landmark[][]) => seq.map((p) => toFeatureVector(p, 'Right', 1));
const motion = (seq: Landmark[][]) => motionTrajectory(seq.map((p) => wristSample(p, 'Right', 1)));
const location = (seq: Landmark[][], face: FaceBox | null = FACE) =>
  locationTrajectory(seq.map((p) => locationSample(p, 'Right', 1, face ?? undefined)));

describe('locationSample', () => {
  it('mide en altos de cara: bajar la mano un alto de cara suma 1 en y', () => {
    const a = locationSample(fist, 'Right', 1, FACE)!;
    const b = locationSample(transformPose(fist, 0, FACE.height, 1), 'Right', 1, FACE)!;
    expect(b[1] - a[1]).toBeCloseTo(1, 9);
    expect(b[0]).toBeCloseTo(a[0], 9);
  });

  it('escala x por la proporción y espeja las manos izquierdas, como la forma', () => {
    const right = locationSample(fist, 'Right', 16 / 9, FACE)!;
    const left = locationSample(fist, 'Left', 16 / 9, FACE)!;
    expect(left[0]).toBeCloseTo(-right[0], 9);
    expect(left[1]).toBeCloseTo(right[1], 9);
  });

  it('sin cara no hay lugar', () => {
    expect(locationSample(fist, 'Right', 1, undefined)).toBeNull();
  });
});

describe('locationTrajectory', () => {
  it('rellena los frames sin cara con el vecino más cercano', () => {
    const samples: ([number, number] | null)[] = [[0, 1], null, null, [0, 1], [0, 1]];
    const trajectory = locationTrajectory(samples)!;
    expect(trajectory).toHaveLength(5);
    for (const [x, y] of trajectory) {
      expect(x).toBeCloseTo(0, 9);
      expect(y).toBeCloseTo(1, 9);
    }
  });

  it('sin cara en la mayoría de los frames no hay lugar (no sería confiable)', () => {
    expect(locationTrajectory([[0, 1], null, null])).toBeUndefined();
    expect(locationTrajectory([])).toBeUndefined();
  });
});

describe('dtwAlign', () => {
  it('el camino empareja inicio con inicio y final con final, sin saltos', () => {
    const seq = vectors(circling());
    const { path, distance } = dtwAlign(seq.slice(0, 16), seq.slice(0, 16));
    expect(distance).toBe(0);
    expect(path[0]).toEqual([0, 0]);
    expect(path.at(-1)).toEqual([15, 15]);
    for (let k = 1; k < path.length; k++) {
      const [i, j] = path[k]!;
      const [pi, pj] = path[k - 1]!;
      expect(i - pi).toBeLessThanOrEqual(1);
      expect(j - pj).toBeLessThanOrEqual(1);
    }
  });
});

describe('classifyDynamic con lugar (D37)', () => {
  const template = buildDynamicTemplate(
    'por-favor',
    vectors(circling()),
    1600,
    motion(circling()),
    location(circling()),
  );
  const score = (seq: Landmark[][], face: FaceBox | null = FACE) =>
    classifyDynamic(vectors(seq), [template], { motion: motion(seq), location: location(seq, face) })[0]!
      .score;

  it('los círculos en el mismo lugar validan', () => {
    expect(score(circling())).toBeGreaterThan(DYNAMIC_THRESHOLD);
  });

  it('los mismos círculos en otro lugar NO validan (el límite de D35)', () => {
    const [withoutGate] = classifyDynamic(vectors(circling([0, -1.5])), [template], {
      motion: motion(circling([0, -1.5])),
      location: location(circling([0, -1.5])),
      locationTolerance: Infinity,
    });
    expect(withoutGate!.score).toBeGreaterThan(DYNAMIC_THRESHOLD); // antes de D37 validaba
    expect(score(circling([0, -1.5]))).toBeLessThan(DYNAMIC_THRESHOLD); // frente a la cara
    expect(score(circling([1.5, 0]))).toBeLessThan(DYNAMIC_THRESHOLD); // a un lado
  });

  it('tolera diferencias pequeñas de lugar entre personas', () => {
    expect(score(circling([0, LOCATION_TOLERANCE * 0.8]))).toBeGreaterThan(DYNAMIC_THRESHOLD);
  });

  it('sin cara en la captura se compara como antes, sin lugar', () => {
    expect(score(circling([0, -1.5]), null)).toBeGreaterThan(DYNAMIC_THRESHOLD);
  });

  it('el factor de lugar baja de 1 a 0 pasando la tolerancia', () => {
    expect(locationFactor(0)).toBe(1);
    expect(locationFactor(LOCATION_TOLERANCE)).toBe(1);
    expect(locationFactor(10)).toBe(0);
  });
});

describe('SessionValidator con lugar', () => {
  const template = buildDynamicTemplate(
    'por-favor',
    vectors(circling()),
    1600,
    motion(circling()),
    location(circling()),
  );
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
          face: FACE,
        };
        if (validator.feed(frame).status === 'correct') correct = true;
      });
    }
    return correct;
  };

  it('valida en el lugar de la plantilla y no en otro', () => {
    expect(feedAll(circling())).toBe(true);
    expect(feedAll(circling([0, 1.5]))).toBe(false);
  });
});
