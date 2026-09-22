import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { blinkWeight } from '../src/avatar/face';
import { DEFAULT_CLEANUP, cleanAnimation } from '../src/avatar/cleanup';

// Ciclo como el de Por favor: 1.7 s de seña + 0.4 s de regreso al inicio.
const RETURN_START = 1.7;
const DURATION = 2.1;
const samples = (cycle: number) =>
  Array.from({ length: 211 }, (_, i) => i / 100).map((t) => ({
    t,
    w: blinkWeight(t, cycle, RETURN_START, DURATION),
  }));

describe('blinkWeight', () => {
  it('parpadea solo durante el regreso al inicio, nunca durante la seña', () => {
    const blinking = samples(1).filter((s) => s.w > 0);
    expect(blinking.length).toBeGreaterThan(0);
    for (const { t } of blinking) {
      expect(t).toBeGreaterThan(RETURN_START);
      expect(t).toBeLessThan(DURATION);
    }
  });

  it('cierra por completo el ojo y lo vuelve a abrir', () => {
    const weights = samples(1).map((s) => s.w);
    expect(Math.max(...weights)).toBeGreaterThan(0.95);
    expect(weights.at(-1)).toBe(0);
  });

  it('no parpadea en todos los ciclos (sería cada ~2 s, más de lo natural)', () => {
    expect(samples(0).every((s) => s.w === 0)).toBe(true);
    expect(samples(2).every((s) => s.w === 0)).toBe(true);
    expect(samples(3).some((s) => s.w > 0)).toBe(true);
  });
});

describe('cleanAnimation: returnStartFrame', () => {
  it('marca dónde termina la seña y empieza el regreso al inicio', () => {
    const t = Array.from({ length: 61 }, (_, i) => i / 30); // 2 s
    const raw = new Map([
      ['rightUpperArm', t.map((x) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), x))],
    ]);
    const clip = cleanAnimation(t, raw, () => new THREE.Quaternion(), {
      ...DEFAULT_CLEANUP,
      window: [0.5, 1.5],
    });
    expect(clip.returnStartFrame / clip.fps).toBeCloseTo(1, 1); // 1 s de seña
    expect(clip.frameCount - clip.returnStartFrame).toBe(
      Math.round(DEFAULT_CLEANUP.returnSeconds * clip.fps),
    );
  });
});
