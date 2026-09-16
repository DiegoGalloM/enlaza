import { describe, expect, it } from 'vitest';
import {
  cosineSimilarity,
  euclideanDistance,
  meanVector,
  migrateFeatureVector,
  toFeatureVector,
} from '../src/normalize';
import { migrateTemplate } from '../src/migrate';
import { buildDynamicTemplate, buildStaticTemplate } from '../src/index';
import type { Landmark } from '../src/types';
import { mirrorPose, mulberry32, randomPose, transformPose } from './synthetic';

describe('toFeatureVector', () => {
  const rng = mulberry32(42);
  const pose = randomPose(rng);

  it('rejects wrong landmark counts', () => {
    expect(() => toFeatureVector(pose.slice(0, 5), 'Right', 1)).toThrow();
  });

  it('is invariant to translation', () => {
    const moved = transformPose(pose, 0.2, -0.1, 1);
    const a = toFeatureVector(pose, 'Right', 1);
    const b = toFeatureVector(moved, 'Right', 1);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.999);
  });

  it('is invariant to scale (distance from camera)', () => {
    const scaled = transformPose(pose, 0, 0, 0.55);
    const a = toFeatureVector(pose, 'Right', 1);
    const b = toFeatureVector(scaled, 'Right', 1);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.999);
  });

  it('maps a mirrored left hand onto the canonical right hand', () => {
    const a = toFeatureVector(pose, 'Right', 1);
    const b = toFeatureVector(mirrorPose(pose), 'Left', 1);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.999);
  });

  it('distinguishes different poses', () => {
    const other = randomPose(rng);
    const a = toFeatureVector(pose, 'Right', 1);
    const b = toFeatureVector(other, 'Right', 1);
    expect(cosineSimilarity(a, b)).toBeLessThan(0.98);
  });
});

/**
 * La misma mano física vista por una cámara de proporción `aspect`: MediaPipe
 * normaliza x por el ancho (y z en escala de x), así que se comprime en x y z.
 */
function seenByCamera(pose: Landmark[], aspect: number): Landmark[] {
  return pose.map((p) => ({ x: 0.5 + (p.x - 0.5) / aspect, y: p.y, z: p.z / aspect }));
}

/** Features v1: las de antes, sin corrección de proporción. */
const legacyVector = (pose: Landmark[]) => toFeatureVector(pose, 'Right', 1);

describe('proporción de la cámara (features v2)', () => {
  const rng = mulberry32(11);
  const pose = randomPose(rng);

  it('la misma mano da las mismas features en cámaras 16:9 y 4:3', () => {
    const wide = toFeatureVector(seenByCamera(pose, 16 / 9), 'Right', 16 / 9);
    const classic = toFeatureVector(seenByCamera(pose, 4 / 3), 'Right', 4 / 3);
    expect(euclideanDistance(wide, classic)).toBeLessThan(1e-9);
  });

  it('sin corregir, cambiar de cámara deforma la mano (el problema que resuelve v2)', () => {
    const wide = legacyVector(seenByCamera(pose, 16 / 9));
    const classic = legacyVector(seenByCamera(pose, 4 / 3));
    expect(euclideanDistance(wide, classic)).toBeGreaterThan(0.05);
  });

  it('migrar un vector v1 da exactamente el vector v2 de esa cámara', () => {
    for (const aspect of [16 / 9, 4 / 3, 1]) {
      const seen = seenByCamera(pose, aspect);
      const migrated = migrateFeatureVector(legacyVector(seen), aspect);
      const direct = toFeatureVector(seen, 'Right', aspect);
      expect(euclideanDistance(migrated, direct)).toBeLessThan(1e-9);
    }
  });

  it('migra plantillas estáticas y dinámicas grabadas con otra cámara', () => {
    const aspect = 16 / 9;
    const other = randomPose(rng);
    const staticV1 = buildStaticTemplate('a', [legacyVector(seenByCamera(pose, aspect))]);
    const dynamicV1 = buildDynamicTemplate('b', [pose, other].map((p) => legacyVector(seenByCamera(p, aspect))));
    const staticV2 = migrateTemplate(staticV1, aspect);
    const dynamicV2 = migrateTemplate(dynamicV1, aspect);
    const expected = toFeatureVector(seenByCamera(pose, aspect), 'Right', aspect);
    expect(staticV2.type === 'static' && euclideanDistance(staticV2.vector, expected)).toBeLessThan(1e-9);
    // Dinámica: el primer frame remuestreado es exactamente el primer frame original.
    expect(dynamicV2.type === 'dynamic' && euclideanDistance(dynamicV2.frames[0]!, expected)).toBeLessThan(1e-9);
    expect(dynamicV2.type === 'dynamic' && dynamicV2.frames).toHaveLength(16);
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
