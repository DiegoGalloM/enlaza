import { toFeatureVector } from '../../packages/cv-model/src/index.ts';

/**
 * Elige la mano activa de la seña: la que más recorre en imagen (con la
 * cantidad de frames como desempate). El cv-model es de una sola mano.
 */
export function chooseHand(frames) {
  const stats = {
    left: { travel: 0, count: 0, prev: null },
    right: { travel: 0, count: 0, prev: null },
  };
  for (const frame of frames) {
    for (const side of ['left', 'right']) {
      const lm = frame[`${side}Hand`];
      if (!lm) continue;
      const s = stats[side];
      s.count++;
      const wrist = lm[0];
      if (s.prev) s.travel += Math.hypot(wrist[0] - s.prev[0], wrist[1] - s.prev[1]);
      s.prev = wrist;
    }
  }
  if (stats.left.count === 0 && stats.right.count === 0) return null;
  if (Math.abs(stats.left.travel - stats.right.travel) > 1e-6) {
    return stats.left.travel > stats.right.travel ? 'left' : 'right';
  }
  return stats.left.count > stats.right.count ? 'left' : 'right';
}

/**
 * Vector de features de un frame extraído, con la MISMA etiqueta de mano que
 * daría HandLandmarker en la app: tasks-vision reporta handedness asumiendo
 * imagen espejada (selfie), así que en video sin espejar la mano anatómica
 * derecha se etiqueta 'Left' y viceversa. Holistic en cambio asigna
 * leftHand/rightHand anatómicamente (verificado con hola.mp4: la señante alza
 * su mano derecha y aparece como rightHand). Igualamos la convención de la
 * app para que el espejado a mano canónica coincida en ambos lados.
 */
export function frameVector(frame, side) {
  const lm = frame[`${side}Hand`];
  if (!lm) return null;
  const landmarks = lm.map(([x, y, z]) => ({ x, y, z }));
  return toFeatureVector(landmarks, side === 'right' ? 'Left' : 'Right');
}
