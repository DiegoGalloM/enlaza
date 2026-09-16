import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLEANUP,
  cleanAnimation,
  fillGaps,
  smoothResample,
} from '../src/avatar/cleanup';

const aroundZ = (rad: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad);
const angleOf = (q: THREE.Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(q.w)));
const times = (n: number, dt = 1 / 30) => Array.from({ length: n }, (_, i) => i * dt);
const gapOpts = { maxGapSeconds: 0.3, restBlendSeconds: 0.25 };

describe('fillGaps', () => {
  it('interpola huecos cortos por tiempo entre las detecciones vecinas', () => {
    const t = [0, 0.1, 0.2];
    const filled = fillGaps(t, [aroundZ(0), null, aroundZ(1)], aroundZ(-1), gapOpts);
    expect(angleOf(filled[1])).toBeCloseTo(0.5, 5);
  });

  it('lleva a la pose de reposo los tramos sin detección en los extremos, con rampa', () => {
    const t = times(31); // 1 s
    const track = t.map((_, i) => (i === 30 ? aroundZ(1) : null));
    const filled = fillGaps(t, track, aroundZ(0), gapOpts);
    expect(angleOf(filled[0])).toBeCloseTo(0, 5); // lejos: reposo
    expect(angleOf(filled[29])).toBeGreaterThan(0.9); // junto a la detección: casi ella
    for (let i = 1; i < 31; i++) {
      // sin saltos: la rampa es monótona
      expect(angleOf(filled[i])).toBeGreaterThanOrEqual(angleOf(filled[i - 1]) - 1e-9);
    }
  });
});

describe('smoothResample', () => {
  it('reduce el jitter alrededor de una pose constante', () => {
    const t = times(60);
    const noisy = t.map((_, i) => aroundZ(0.5 + (i % 2 ? 0.1 : -0.1)));
    const smooth = smoothResample(t, noisy, t.slice(10, 50), 0.05);
    for (const q of smooth) expect(angleOf(q)).toBeCloseTo(0.5, 2);
  });

  it('respeta el tiempo real de cada muestra aunque el espaciado sea irregular', () => {
    const t = [0, 0.032, 0.064, 0.128, 0.16, 0.192, 0.256];
    const ramp = t.map((x) => aroundZ(x)); // ángulo = tiempo
    const [q] = smoothResample(t, ramp, [0.1], 0.02);
    // Reproducir por índice (como antes) daría la muestra 3 → 0.128. El kernel
    // queda a <10 ms: el sesgo residual viene del hueco de 64 ms, no del índice.
    expect(Math.abs(angleOf(q) - 0.1)).toBeLessThan(0.01);
  });
});

describe('cleanAnimation', () => {
  it('cierra el bucle: el último frame es la pose del primero', () => {
    const t = times(40);
    const raw = new Map([['rightUpperArm', t.map((x) => aroundZ(Math.sin(x * 6)))]]);
    const clip = cleanAnimation(t, raw, () => new THREE.Quaternion(), DEFAULT_CLEANUP);
    const track = clip.tracks.get('rightUpperArm')!;
    expect(track).toHaveLength(clip.frameCount);
    expect(track[clip.frameCount - 1].angleTo(track[0])).toBeLessThan(1e-6);
    for (let i = 1; i < clip.frameCount; i++) {
      expect(track[i].angleTo(track[i - 1])).toBeLessThan(0.3); // sin brincos
    }
  });

  it('recorta la quietud del final dejando un margen', () => {
    const t = times(90); // 3 s: 1 s de movimiento y 2 s quieto
    const raw = new Map([['rightUpperArm', t.map((x) => aroundZ(Math.sin(Math.min(x, 1) * 6)))]]);
    const clip = cleanAnimation(t, raw, () => new THREE.Quaternion(), {
      ...DEFAULT_CLEANUP,
      returnSeconds: 0,
      holdSeconds: 0,
    });
    const seconds = clip.frameCount / clip.fps;
    expect(seconds).toBeGreaterThan(1);
    expect(seconds).toBeLessThan(1.5);
  });
});
