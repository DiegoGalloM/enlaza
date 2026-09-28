import { LANDMARK_COUNT, MIDDLE_MCP } from './types';

/**
 * Forma de la mano separada de su orientación (D39).
 *
 * El vector de features (toFeatureVector) guarda los 21 puntos relativos a la
 * muñeca, sin quitar la rotación: la orientación es distintiva en LSC (palma
 * arriba o abajo). Pero compararlo tal cual hacía que inclinar la mano 15° en
 * la imagen costara más de la mitad de la distancia entre Gracias y una seña
 * completamente distinta (medido con tools/content/stress-sign.mjs): una
 * persona que no pone la mano exactamente con el ángulo de la señante de
 * referencia no validaba nunca.
 *
 * Aquí la comparación se divide en dos:
 * - configuración: los puntos en el marco de la propia mano (eje "arriba" =
 *   muñeca → nudillo medio; eje "a lo ancho" = nudillo del índice → nudillo del
 *   meñique), que no cambia al girar la mano entera;
 * - orientación: el ángulo de la rotación entre los marcos de las dos manos,
 *   que solo cuesta por encima de una zona muerta (inclinaciones naturales) y
 *   crece de ahí en adelante: la palma abajo en vez de arriba (180°) sigue
 *   separando señas.
 *
 * Se calcula desde el vector que ya se guarda (plantillas empaquetadas y de
 * /plantillas), así que no cambia FEATURE_VERSION ni hay que regenerar nada.
 */

/** Rotación (grados) que no cuesta nada: la variación natural entre personas. */
export const ORIENTATION_DEADZONE_DEG = 25;
/** Costo por radián de rotación más allá de la zona muerta, en largos de mano. */
export const ORIENTATION_WEIGHT = 2;

const INDEX_MCP = 5;
const PINKY_MCP = 17;

export interface HandShape {
  /** El vector de features tal cual (para comparar si algún marco es degenerado). */
  raw: number[];
  /** Puntos en el marco de la mano (63 valores, largos de mano). */
  config: number[];
  /** Marco de la mano: filas = ejes x (ancho), y (arriba), z (normal de la palma). */
  frame: [number[], number[], number[]] | null;
}

function point(v: number[], i: number): number[] {
  return [v[i * 3]!, v[i * 3 + 1]!, v[i * 3 + 2]!];
}
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const norm = (a: number[]) => Math.hypot(a[0]!, a[1]!, a[2]!);
const cross = (a: number[], b: number[]) => [
  a[1]! * b[2]! - a[2]! * b[1]!,
  a[2]! * b[0]! - a[0]! * b[2]!,
  a[0]! * b[1]! - a[1]! * b[0]!,
];

/** Marco ortonormal de la mano, o null si es degenerado (nudillos alineados con el eje). */
function handFrame(v: number[]): [number[], number[], number[]] | null {
  const up = point(v, MIDDLE_MCP);
  const upLen = norm(up);
  if (upLen < 1e-6) return null;
  const y = up.map((c) => c / upLen);
  const across = point(v, INDEX_MCP).map((c, i) => c - point(v, PINKY_MCP)[i]!);
  const proj = dot(across, y);
  const xRaw = across.map((c, i) => c - proj * y[i]!);
  const xLen = norm(xRaw);
  if (xLen < 1e-3) return null;
  const x = xRaw.map((c) => c / xLen);
  return [x, y, cross(x, y)];
}

/** Descompone un vector de features en configuración y orientación. */
export function handShape(vector: number[]): HandShape {
  if (vector.length !== LANDMARK_COUNT * 3) {
    throw new Error(`Expected ${LANDMARK_COUNT * 3} values, got ${vector.length}`);
  }
  const frame = handFrame(vector);
  if (!frame) return { raw: vector, config: vector, frame: null };
  const config: number[] = new Array(vector.length);
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    const p = point(vector, i);
    config[i * 3] = dot(p, frame[0]);
    config[i * 3 + 1] = dot(p, frame[1]);
    config[i * 3 + 2] = dot(p, frame[2]);
  }
  return { raw: vector, config, frame };
}

/** Ángulo (radianes) de la rotación que lleva un marco al otro. */
export function orientationAngle(
  a: [number[], number[], number[]],
  b: [number[], number[], number[]],
): number {
  // traza(Aᵀ·B) = suma de productos punto de los ejes correspondientes.
  const trace = dot(a[0], b[0]) + dot(a[1], b[1]) + dot(a[2], b[2]);
  return Math.acos(Math.min(1, Math.max(-1, (trace - 1) / 2)));
}

/**
 * Distancia entre dos manos: configuración (euclidiana, invariante a rotación)
 * combinada con el exceso de orientación sobre la zona muerta. Si alguno de los
 * marcos es degenerado, se compara el vector crudo, como antes.
 */
export function handShapeDistance(a: HandShape, b: HandShape): number {
  const both = a.frame !== null && b.frame !== null;
  const va = both ? a.config : a.raw;
  const vb = both ? b.config : b.raw;
  let sum = 0;
  for (let i = 0; i < va.length; i++) {
    const d = va[i]! - vb[i]!;
    sum += d * d;
  }
  const config = Math.sqrt(sum);
  if (!both) return config;
  const excess = Math.max(
    0,
    orientationAngle(a.frame!, b.frame!) - (ORIENTATION_DEADZONE_DEG * Math.PI) / 180,
  );
  return Math.hypot(config, ORIENTATION_WEIGHT * excess);
}
