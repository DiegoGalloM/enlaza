import { describe, expect, it } from 'vitest';
import { HandTracker, signHand } from '../src/hands';
import type { DetectedHand, Handedness, HandsFrame, Landmark } from '../src/types';

/** Mano de largo 0.1 (muñeca → nudillo medio) con la muñeca en (x, y). */
function handAt(x: number, y: number, handedness: Handedness): DetectedHand {
  const landmarks: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
    x: x + 0.005 * i,
    y: y - 0.004 * i,
    z: 0,
  }));
  landmarks[0] = { x, y, z: 0 };
  landmarks[9] = { x, y: y - 0.1, z: 0 };
  return { landmarks, handedness };
}

function frame(t: number, ...hands: DetectedHand[]): HandsFrame {
  return { hands, timestampMs: t, aspect: 1 };
}

const wristX = (f: { landmarks: Landmark[] } | null) => f?.landmarks[0]!.x;

describe('HandTracker (D38)', () => {
  it('con dos manos empieza por la mano registrada', () => {
    const tracker = new HandTracker('Right');
    const picked = tracker.pick(frame(0, handAt(0.7, 0.8, 'Left'), handAt(0.3, 0.3, 'Right')));
    expect(wristX(picked)).toBe(0.3);
    expect(picked?.handedness).toBe('Right');
  });

  it('sigue a la mano que se mueve aunque se acerque a la otra y se volteen las etiquetas', () => {
    const tracker = new HandTracker('Right');
    const still = (label: Handedness) => handAt(0.5, 0.8, label);
    // La derecha baja de la boca (y=0.3) a apoyarse sobre la izquierda (y=0.75).
    const path = [0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.75];
    const picked = path.map((y, i) => {
      // En el contacto MediaPipe voltea las etiquetas de las dos manos.
      const swapped = y >= 0.7;
      return tracker.pick(
        frame(i * 33, still(swapped ? 'Right' : 'Left'), handAt(0.45, y, swapped ? 'Left' : 'Right')),
      );
    });
    expect(picked.map((p) => p?.landmarks[0]!.y)).toEqual(path);
    // La etiqueta es la del seguimiento: las features no se espejan a mitad de la seña.
    expect(picked.every((p) => p?.handedness === 'Right')).toBe(true);
  });

  it('si la mano seguida queda tapada, el frame cuenta como vacío (no mete la otra)', () => {
    const tracker = new HandTracker('Right');
    tracker.pick(frame(0, handAt(0.5, 0.8, 'Left'), handAt(0.3, 0.8, 'Right')));
    // Solo se ve la izquierda, a 2 largos de mano de donde estaba la derecha.
    expect(tracker.pick(frame(33, handAt(0.5, 0.8, 'Left')))).toBeNull();
    // La derecha reaparece y se retoma.
    expect(wristX(tracker.pick(frame(66, handAt(0.5, 0.8, 'Left'), handAt(0.32, 0.8, 'Right'))))).toBe(0.32);
  });

  it('con una sola mano, un error de etiqueta en el mismo lugar no la espeja', () => {
    const tracker = new HandTracker();
    tracker.pick(frame(0, handAt(0.4, 0.5, 'Right')));
    const picked = tracker.pick(frame(33, handAt(0.41, 0.5, 'Left')));
    expect(wristX(picked)).toBe(0.41);
    expect(picked?.handedness).toBe('Right');
  });

  it('sin mano registrada acepta cualquier mano (zurdos en señas de una mano)', () => {
    const tracker = new HandTracker();
    expect(tracker.pick(frame(0, handAt(0.4, 0.5, 'Left')))?.handedness).toBe('Left');
  });

  it('si solo estaba la otra mano, cambia a la registrada en cuanto aparece', () => {
    const tracker = new HandTracker('Right');
    expect(tracker.pick(frame(0, handAt(0.6, 0.8, 'Left')))?.handedness).toBe('Left');
    const picked = tracker.pick(frame(33, handAt(0.6, 0.8, 'Left'), handAt(0.3, 0.3, 'Right')));
    expect(wristX(picked)).toBe(0.3);
  });

  it('tras perder la mano un rato se vuelve a elegir desde cero', () => {
    const tracker = new HandTracker(undefined, { lostAfterMs: 400 });
    tracker.pick(frame(0, handAt(0.2, 0.5, 'Right')));
    expect(tracker.pick(frame(33, handAt(0.8, 0.5, 'Right')))).toBeNull(); // salto imposible
    expect(wristX(tracker.pick(frame(500, handAt(0.8, 0.5, 'Right'))))).toBe(0.8);
  });

  it('signHand lee la mano registrada en las plantillas', () => {
    const templates = [
      { signId: 'a' },
      { signId: 'b', hand: 'Right' as const },
    ];
    expect(signHand('b', templates)).toBe('Right');
    expect(signHand('a', templates)).toBeUndefined();
  });
});
