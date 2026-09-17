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
 * Etiqueta de mano que da el HandLandmarker de la app para la mano que
 * Holistic reporta como `side`. Tiene que coincidir: toFeatureVector espeja
 * las manos 'Left', y si la plantilla y la cámara no usan la misma etiqueta,
 * la plantilla queda espejada respecto a lo que ve la app y nunca coincide.
 *
 * MEDIDO, no supuesto (tools/content/diagnose-practice.mjs, sept 2026): con
 * tasks-vision 1.0.0 y hand_landmarker float16/1 sobre hola.mp4, la mano que
 * Holistic llama rightHand llega a la app como 'Right' en 72/72 frames. Antes
 * se suponía lo contrario por la documentación (handedness "asumiendo imagen
 * espejada") y la plantilla de Hola quedó espejada: puntaje 0.25 contra su
 * propio video con el detector de la app.
 */
export function appHandedness(side) {
  return side === 'right' ? 'Right' : 'Left';
}

/** Proporción (ancho/alto) del video del que salió una extracción. */
export function videoAspect(result) {
  if (!result.videoWidth || !result.videoHeight) {
    throw new Error('La extracción no trae videoWidth/videoHeight: vuelve a extraer el video');
  }
  return result.videoWidth / result.videoHeight;
}

/**
 * Vector de features de un frame extraído, con la etiqueta de mano de la app
 * y la proporción del video fuente (features v2, ver toFeatureVector).
 */
export function frameVector(frame, side, aspect) {
  const lm = frame[`${side}Hand`];
  if (!lm) return null;
  const landmarks = lm.map(([x, y, z]) => ({ x, y, z }));
  return toFeatureVector(landmarks, appHandedness(side), aspect);
}
