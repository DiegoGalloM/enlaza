import { describe, expect, it } from 'vitest';
import { handShape, handShapeDistance, orientationAngle } from '../src/orientation';
import { classifyDynamic, buildDynamicTemplate } from '../src/dynamicClassifier';
import { toFeatureVector } from '../src/normalize';
import { dynamicFeedback } from '../src/feedback';
import type { Landmark } from '../src/types';
import { mulberry32, randomPose } from './synthetic';

/** Rota una pose alrededor de la muñeca: en el plano de la imagen (xy) o alrededor del eje vertical (xz). */
function rotate(pose: Landmark[], deg: number, plane: 'xy' | 'xz'): Landmark[] {
  const w = pose[0]!;
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return pose.map((p) => {
    const x = p.x - w.x;
    const y = p.y - w.y;
    const z = p.z - w.z;
    return plane === 'xy'
      ? { x: w.x + x * c - y * s, y: w.y + x * s + y * c, z: p.z }
      : { x: w.x + x * c + z * s, y: p.y, z: w.z - x * s + z * c };
  });
}

/** Gira 180° alrededor del eje muñeca → nudillo medio: la palma mira al lado contrario. */
function flipPalm(pose: Landmark[]): Landmark[] {
  const w = pose[0]!;
  const m = pose[9]!;
  const axis = [m.x - w.x, m.y - w.y, m.z - w.z];
  const n = Math.hypot(...axis);
  const u = axis.map((a) => a / n);
  return pose.map((p) => {
    const v = [p.x - w.x, p.y - w.y, p.z - w.z];
    const d = 2 * (u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!);
    return { x: w.x + d * u[0]! - v[0]!, y: w.y + d * u[1]! - v[1]!, z: w.z + d * u[2]! - v[2]! };
  });
}

const rng = mulberry32(99);
const pose = randomPose(rng);
const other = randomPose(rng);
const shape = (p: Landmark[]) => handShape(toFeatureVector(p, 'Right', 1));

describe('orientación de la mano (D39)', () => {
  it('la configuración no cambia al girar la mano entera', () => {
    const a = shape(pose);
    for (const [deg, plane] of [[15, 'xy'], [-30, 'xy'], [30, 'xz']] as const) {
      const b = shape(rotate(pose, deg, plane));
      a.config.forEach((v, i) => expect(b.config[i]).toBeCloseTo(v, 9));
    }
  });

  it('el ángulo entre marcos es la rotación aplicada', () => {
    const a = shape(pose);
    expect((orientationAngle(a.frame!, shape(rotate(pose, 40, 'xy')).frame!) * 180) / Math.PI).toBeCloseTo(40, 6);
  });

  it('inclinaciones dentro de la zona muerta no cuestan; la palma volteada sí', () => {
    const a = shape(pose);
    expect(handShapeDistance(a, shape(rotate(pose, 20, 'xy')))).toBeLessThan(1e-9);
    expect(handShapeDistance(a, shape(flipPalm(pose)))).toBeGreaterThan(4);
  });

  it('una mano con otra configuración sigue lejos aunque tenga la misma orientación', () => {
    expect(handShapeDistance(shape(pose), shape(other))).toBeGreaterThan(0.5);
  });
});

describe('desglose y retroalimentación de señas dinámicas (D40)', () => {
  const seq = Array.from({ length: 12 }, (_, i) =>
    pose.map((p) => ({ ...p, y: p.y - i * 0.01 })),
  );
  const vectors = seq.map((p) => toFeatureVector(p, 'Right', 1));
  const template = buildDynamicTemplate('s', vectors);

  it('una seña inclinada 20° valida igual que la original; la palma volteada no', () => {
    const tilted = seq.map((p) => toFeatureVector(rotate(p, 20, 'xy'), 'Right', 1));
    const flipped = seq.map((p) => toFeatureVector(flipPalm(p), 'Right', 1));
    const [same] = classifyDynamic(tilted, [template]);
    const [wrong] = classifyDynamic(flipped, [template]);
    expect(same!.score).toBeGreaterThan(0.99);
    expect(wrong!.score).toBeLessThan(0.3);
    expect(wrong!.detail!.orientationDeg).toBeGreaterThan(170);
    expect(dynamicFeedback(wrong!.detail!).kind).toBe('orientacion');
  });

  it('la retroalimentación nombra la parte que más falta', () => {
    const base = { shape: 0.5, locationFactor: 1, motionFactor: 1 };
    expect(dynamicFeedback({ ...base, motionFactor: 0.3 }).kind).toBe('movimiento');
    expect(
      dynamicFeedback({ ...base, locationFactor: 0.5, locationOffset: [0.1, 0.9] }).message,
    ).toContain('más arriba');
    expect(
      dynamicFeedback({ ...base, locationFactor: 0.5, locationOffset: [0.1, -0.9] }).message,
    ).toContain('más abajo');
    expect(dynamicFeedback({ ...base, orientationDeg: 60 }).kind).toBe('orientacion');
    expect(dynamicFeedback({ ...base, orientationDeg: 10 }).kind).toBe('forma');
  });
});
