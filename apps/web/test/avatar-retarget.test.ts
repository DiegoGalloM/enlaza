import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { solveTwoBoneIK } from '../src/avatar/retarget';
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
