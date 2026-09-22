import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  breathing,
  dropImplausibleHands,
  shoulderGirdle,
  solveArmClearance,
  solveTwoBoneIK,
  type LandmarkFrame,
} from '../src/avatar/retarget';
import { bodyPenetration, type BodyProfile } from '../src/avatar/rig';

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

describe('bodyPenetration', () => {
  // Torso de 30 cm de ancho y 20 cm de fondo centrado en z = 0, de y = 0 a 1.
  const bins = 50;
  const body: BodyProfile = {
    minY: 0,
    step: 0.02,
    centerZ: new Array(bins).fill(0),
    halfWidth: new Array(bins).fill(0.15),
    halfDepth: new Array(bins).fill(0.1),
  };

  it('es mayor cuanto más adentro está el punto, contando la holgura', () => {
    const center = bodyPenetration(body, new THREE.Vector3(0, 0.5, 0), 0.02);
    const near = bodyPenetration(body, new THREE.Vector3(0, 0.5, 0.09), 0.02);
    expect(center).toBeCloseTo(0.12, 3);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(center);
  });

  it('es cero afuera: al frente, a los lados o fuera de altura', () => {
    expect(bodyPenetration(body, new THREE.Vector3(0, 0.5, 0.2), 0.02)).toBe(0);
    expect(bodyPenetration(body, new THREE.Vector3(0.3, 0.5, 0), 0.02)).toBe(0);
    expect(bodyPenetration(body, new THREE.Vector3(0, 2, 0), 0.02)).toBe(0);
  });
});

describe('solveArmClearance', () => {
  // Mismo torso; hombro derecho por dentro de la camisa, como en VRoid.
  const bins = 50;
  const body: BodyProfile = {
    minY: 0,
    step: 0.02,
    centerZ: new Array(bins).fill(0),
    halfWidth: new Array(bins).fill(0.15),
    halfDepth: new Array(bins).fill(0.1),
  };
  const shoulder = new THREE.Vector3(-0.11, 0.8, -0.02);
  const inside = (p: THREE.Vector3, margin: number) => bodyPenetration(body, p, margin);

  it('saca el codo y el antebrazo del torso sin mover la mano (puño en el pecho)', () => {
    // Puño al frente del pecho del lado contrario; el codo de la persona,
    // abajo y atrás, dejaría el antebrazo atravesando el torso.
    const target = new THREE.Vector3(0.05, 0.72, 0.14);
    const pole = new THREE.Vector3(-0.1, 0.6, 0).sub(target);
    const naive = solveTwoBoneIK(shoulder, target, 0.22, 0.21, pole);
    const forearmInside = (e: THREE.Vector3, w: THREE.Vector3) =>
      Math.max(...[0.2, 0.5, 0.8].map((s) => inside(e.clone().lerp(w, s), 0.03)));
    expect(forearmInside(naive.elbow, naive.wrist)).toBeGreaterThan(0.02);

    const { elbow, wrist } = solveArmClearance(body, shoulder, target, 0.22, 0.21, pole, [new THREE.Vector3()]);
    expect(forearmInside(elbow, wrist)).toBeLessThan(0.005);
    expect(elbow.distanceTo(shoulder)).toBeCloseTo(0.22, 6);
    expect(elbow.distanceTo(wrist)).toBeCloseTo(0.21, 6);
    // La mano sigue en el pecho: prefiere girar el codo antes que adelantarla.
    expect(wrist.distanceTo(target)).toBeLessThan(0.02);
  });

  it('adelanta la mano si sus puntos quedan dentro del cuerpo', () => {
    const target = new THREE.Vector3(0.02, 0.72, 0.1);
    const pole = new THREE.Vector3(-0.3, 0.7, 0.1).sub(target);
    const knuckles = new THREE.Vector3(0.02, 0, -0.03);
    const { wrist } = solveArmClearance(body, shoulder, target, 0.22, 0.21, pole, [new THREE.Vector3(), knuckles]);
    expect(wrist.z).toBeGreaterThan(target.z);
    // Los puntos después de la muñeca son dedos: holgura de 1.2 cm.
    expect(inside(wrist.clone().add(knuckles), 0.012)).toBeLessThan(0.002);
  });

  it('no toca un brazo que ya está afuera del cuerpo', () => {
    const target = new THREE.Vector3(-0.3, 0.9, 0.3);
    const pole = new THREE.Vector3(0, -1, 0);
    const free = solveArmClearance(body, shoulder, target, 0.22, 0.21, pole, [new THREE.Vector3()]);
    const naive = solveTwoBoneIK(shoulder, target, 0.22, 0.21, pole);
    expect(free.elbow.distanceTo(naive.elbow)).toBeLessThan(1e-9);
  });
});

describe('shoulderGirdle', () => {
  const restShoulder = new THREE.Vector3(-0.11, 1.27, -0.02);
  const armTip = (q: THREE.Quaternion) => new THREE.Vector3(-1, 0, 0).applyQuaternion(q);

  it('no mueve el hombro si la mano queda de su lado (Hola, en la frente)', () => {
    const q = shoulderGirdle('right', restShoulder, new THREE.Vector3(-0.12, 1.5, 0.1));
    expect(q.angleTo(new THREE.Quaternion())).toBe(0);
  });

  it('adelanta y baja el hombro cuando la mano cruza al otro lado (Por favor)', () => {
    const tip = armTip(shoulderGirdle('right', restShoulder, new THREE.Vector3(0.1, 1.18, 0.2)));
    expect(tip.z).toBeGreaterThan(0.3);
    expect(tip.y).toBeLessThan(-0.1);
  });

  it('es simétrico para el brazo izquierdo', () => {
    const left = shoulderGirdle('left', restShoulder.clone().setX(0.11), new THREE.Vector3(-0.1, 1.18, 0.2));
    const tip = new THREE.Vector3(1, 0, 0).applyQuaternion(left);
    expect(tip.z).toBeGreaterThan(0.3);
    expect(tip.y).toBeLessThan(-0.1);
  });
});

describe('breathing', () => {
  it('parte de cero, inclina el pecho hacia atrás y es periódica (no salta al repetir la seña)', () => {
    expect(breathing(0)).toBeCloseTo(0, 9);
    expect(breathing(1.8)).toBeLessThan(0);
    expect(breathing(1.3)).toBeCloseTo(breathing(1.3 + 3.6), 9);
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
