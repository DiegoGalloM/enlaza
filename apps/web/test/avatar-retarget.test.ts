import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { dropImplausibleHands, solveTwoBoneIK, type LandmarkFrame } from '../src/avatar/retarget';
import { forwardPushOut, type BodyProfile } from '../src/avatar/rig';

describe('solveTwoBoneIK', () => {
  const shoulder = new THREE.Vector3(0, 0, 0);

  it('alcanza el objetivo respetando el largo de ambos segmentos', () => {
    const target = new THREE.Vector3(-0.2, 0.3, 0.25);
    const { elbow, wrist } = solveTwoBoneIK(shoulder, target, 0.25, 0.23, new THREE.Vector3(0, -1, 0));
    expect(wrist.distanceTo(target)).toBeLessThan(1e-6);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(0.25, 6);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(0.23, 6);
  });

  it('dobla el codo hacia el polo (el codo de la persona)', () => {
    const target = new THREE.Vector3(0, 0.3, 0.2);
    const down = solveTwoBoneIK(shoulder, target, 0.25, 0.23, new THREE.Vector3(0, -1, 0));
    const side = solveTwoBoneIK(shoulder, target, 0.25, 0.23, new THREE.Vector3(-1, 0, 0));
    expect(down.elbow.y).toBeLessThan(0.15);
    expect(side.elbow.x).toBeLessThan(-0.05);
  });

  it('con un objetivo fuera de alcance estira el brazo hacia él sin romperse', () => {
    const target = new THREE.Vector3(0, 0, 2);
    const { elbow, wrist } = solveTwoBoneIK(shoulder, target, 0.25, 0.23, new THREE.Vector3(0, -1, 0));
    expect(wrist.z).toBeCloseTo(0.48, 3);
    expect(Number.isFinite(elbow.x + elbow.y + elbow.z)).toBe(true);
  });
});

describe('forwardPushOut', () => {
  // Torso de 30 cm de ancho y 20 cm de fondo centrado en z = 0, de y = 0 a 1.
  const bins = 50;
  const body: BodyProfile = {
    minY: 0,
    step: 0.02,
    centerZ: new Array(bins).fill(0),
    halfWidth: new Array(bins).fill(0.15),
    halfDepth: new Array(bins).fill(0.1),
  };

  it('saca hacia el frente un punto dentro del cuerpo, con holgura', () => {
    const p = new THREE.Vector3(0, 0.5, 0.05);
    const push = forwardPushOut(body, p, 0.02);
    expect(push).toBeCloseTo(0.12 - 0.05, 3);
  });

  it('no mueve puntos que ya están afuera (al frente, a los lados o fuera de altura)', () => {
    expect(forwardPushOut(body, new THREE.Vector3(0, 0.5, 0.2), 0.02)).toBe(0);
    expect(forwardPushOut(body, new THREE.Vector3(0.3, 0.5, 0), 0.02)).toBe(0);
    expect(forwardPushOut(body, new THREE.Vector3(0, 2, 0), 0.02)).toBe(0);
  });

  it('sigue la sección elíptica: cerca del costado el frente está menos adelante', () => {
    const center = forwardPushOut(body, new THREE.Vector3(0, 0.5, 0), 0);
    const edge = forwardPushOut(body, new THREE.Vector3(0.13, 0.5, 0), 0);
    expect(edge).toBeLessThan(center);
    expect(edge).toBeGreaterThan(0);
  });
});

describe('dropImplausibleHands', () => {
  /** Mano de 21 puntos con los nudillos de índice (5) y meñique (17) a `span` metros. */
  const hand = (span: number) =>
    Array.from({ length: 21 }, (_, i) => {
      if (i === 5) return [span / 2, 0, 0];
      if (i === 17) return [-span / 2, 0, 0];
      return [0, i * 0.01, 0];
    });
  const frame = (t: number, span: number | null): LandmarkFrame => ({
    t,
    poseWorld: null,
    leftHandWorld: null,
    rightHandWorld: span === null ? null : hand(span),
  });

  it('descarta la mano de un frame cuyo ancho de nudillos "encoge" (MediaPipe la estimó mal)', () => {
    const frames = [frame(0, 0.065), frame(0.03, 0.064), frame(0.06, 0.046), frame(0.1, 0.066)];
    const kept = dropImplausibleHands(frames);
    expect(kept.map((f) => f.rightHandWorld !== null)).toEqual([true, true, false, true]);
    // No toca los frames originales ni lo demás del frame.
    expect(frames[2].rightHandWorld).not.toBeNull();
    expect(kept[2].t).toBe(0.06);
  });

  it('respeta variaciones normales y frames sin mano', () => {
    const frames = [frame(0, 0.06), frame(0.03, null), frame(0.06, 0.055), frame(0.1, 0.065)];
    expect(dropImplausibleHands(frames).map((f) => f.rightHandWorld !== null)).toEqual([
      true,
      false,
      true,
      true,
    ]);
  });
});
