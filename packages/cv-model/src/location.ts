import { LANDMARK_COUNT, MIDDLE_MCP, WRIST } from './types';
import type { FaceBox, Handedness, Landmark } from './types';
import { MOTION_SMOOTHING_FRAMES } from './motion';

/**
 * Lugar de la seña: dónde está la mano respecto a la cara.
 *
 * La forma de la mano (normalize.ts) y su movimiento (motion.ts) son relativos
 * a la propia mano: no saben si la mano está en el pecho o frente a la cara.
 * En LSC el lugar de articulación es distintivo, y Por favor (puño en círculos
 * sobre el pecho) validaba haciendo los círculos en cualquier parte (D35, D37).
 *
 * La cara se usa SOLO como punto de referencia: la caja de un detector de caras
 * (la app usa BlazeFace), no su expresión. Es la referencia más barata y
 * estable que ve una webcam de frente, y su tamaño da la escala: medir en
 * altos de cara hace que no importe la distancia a la cámara.
 *
 * Normalización, con el mismo criterio que la forma y el movimiento:
 * - x escalada por la proporción de la imagen (D33) y espejada en manos
 *   izquierdas: una persona zurda hace la seña en espejo;
 * - centro de la mano (entre muñeca y nudillo medio) relativo al centro de la
 *   caja de la cara, dividido por el alto de la caja.
 *
 * Sin cara detectada (persona fuera de cuadro, plantillas grabadas antes de
 * esto) no hay lugar y la seña se compara como antes, por forma y movimiento.
 */

/** Frames sin cara tolerados en una ventana: con más, no se evalúa el lugar. */
export const MIN_FACE_FRACTION = 0.5;

export function locationSample(
  landmarks: Landmark[],
  handedness: Handedness,
  aspect: number,
  face: FaceBox | undefined,
): [number, number] | null {
  if (!face || !(face.height > 0)) return null;
  if (landmarks.length !== LANDMARK_COUNT) {
    throw new Error(`Expected ${LANDMARK_COUNT} landmarks, got ${landmarks.length}`);
  }
  const wrist = landmarks[WRIST]!;
  const middle = landmarks[MIDDLE_MCP]!;
  const mirror = handedness === 'Left' ? -1 : 1;
  return [
    (mirror * aspect * ((wrist.x + middle.x) / 2 - face.x)) / face.height,
    ((wrist.y + middle.y) / 2 - face.y) / face.height,
  ];
}

/**
 * Trayectoria del lugar de la mano, con los frames sin cara rellenados con el
 * vecino más cercano y el mismo promedio móvil que el movimiento (el temblor
 * de la caja de la cara se suma al de la mano). Devuelve undefined si la cara
 * falta en más de la mitad de los frames: el lugar no sería confiable.
 */
export function locationTrajectory(samples: ([number, number] | null)[]): number[][] | undefined {
  const known = samples.flatMap((s, i) => (s ? [i] : []));
  if (known.length === 0 || known.length < samples.length * MIN_FACE_FRACTION) return undefined;
  let k = 0;
  const filled = samples.map((s, i) => {
    if (s) return s;
    while (k < known.length - 1 && Math.abs(known[k + 1]! - i) <= Math.abs(known[k]! - i)) k++;
    return samples[known[k]!]!;
  });
  const half = Math.floor(MOTION_SMOOTHING_FRAMES / 2);
  return filled.map((_, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(filled.length - 1, i + half);
    let x = 0;
    let y = 0;
    for (let j = from; j <= to; j++) {
      x += filled[j]![0];
      y += filled[j]![1];
    }
    const count = to - from + 1;
    return [x / count, y / count];
  });
}
