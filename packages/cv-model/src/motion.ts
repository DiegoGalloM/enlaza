import { LANDMARK_COUNT, MIDDLE_MCP, WRIST } from './types';
import type { Handedness, Landmark } from './types';

/**
 * Movimiento de la muñeca en la imagen, como complemento de la forma de la
 * mano en las señas dinámicas.
 *
 * Las features de forma (toFeatureVector) son relativas a la propia muñeca:
 * no saben si la mano se mueve. En señas donde la forma casi no cambia (Por
 * favor: un puño que hace círculos en el pecho) eso bastaba para que un puño
 * QUIETO validara (D35). La trayectoria de la muñeca agrega el "cómo se
 * mueve", sin cambiar de detector: HandLandmarker ya da la posición.
 *
 * Normalización, para que no dependa de dónde está la persona en el cuadro ni
 * de su distancia a la cámara:
 * - x escalada por la proporción de la imagen (mismo criterio que D33) y
 *   espejada en manos izquierdas (mismo criterio que la forma);
 * - dividida por el largo de la mano (muñeca → nudillo medio), mediana de la
 *   ventana;
 * - centrada en su promedio después de remuestrear: importa la forma del
 *   recorrido, no el punto del cuadro donde ocurre.
 *
 * La comparación (peso, remuestreo y centrado) vive en dynamicClassifier.ts.
 *
 * NO captura dónde está la mano respecto al cuerpo (pecho, frente): para eso
 * haría falta pose del cuerpo (D35, opción 2): hacer círculos con el puño en
 * cualquier lugar valida Por favor.
 */

/** Posición de la muñeca y largo de la mano en un frame, en unidades de alto de imagen. */
export interface WristSample {
  x: number;
  y: number;
  handLength: number;
}

export function wristSample(
  landmarks: Landmark[],
  handedness: Handedness,
  aspect: number,
): WristSample {
  if (landmarks.length !== LANDMARK_COUNT) {
    throw new Error(`Expected ${LANDMARK_COUNT} landmarks, got ${landmarks.length}`);
  }
  const wrist = landmarks[WRIST]!;
  const middle = landmarks[MIDDLE_MCP]!;
  const mirror = handedness === 'Left' ? -1 : 1;
  return {
    x: mirror * aspect * wrist.x,
    y: wrist.y,
    handLength:
      Math.hypot(
        aspect * (middle.x - wrist.x),
        middle.y - wrist.y,
        aspect * (middle.z - wrist.z),
      ) || 1,
  };
}

/**
 * Frames del promedio móvil que suaviza la trayectoria. El temblor del
 * detector con la mano quieta es aleatorio frame a frame (medido: ~0.005 del
 * alto de imagen por frame) y un promedio de N frames lo reduce ~√N; los
 * movimientos de una seña (círculos de Por favor, ~1.5 Hz) son lentos y casi
 * no cambian. Sin esto, el temblor sumaba "cantidad de movimiento" comparable
 * a los círculos pequeños (D36).
 */
export const MOTION_SMOOTHING_FRAMES = 5;

/** Trayectoria de la muñeca en largos de mano, suavizada (sin centrar ni remuestrear). */
export function motionTrajectory(samples: WristSample[]): number[][] {
  if (samples.length === 0) return [];
  const lengths = samples.map((s) => s.handLength).sort((a, b) => a - b);
  const scale = lengths[Math.floor(lengths.length / 2)]!;
  const half = Math.floor(MOTION_SMOOTHING_FRAMES / 2);
  return samples.map((_, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(samples.length - 1, i + half);
    let x = 0;
    let y = 0;
    for (let k = from; k <= to; k++) {
      x += samples[k]!.x;
      y += samples[k]!.y;
    }
    const count = to - from + 1;
    return [x / count / scale, y / count / scale];
  });
}
