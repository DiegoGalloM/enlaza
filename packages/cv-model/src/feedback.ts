import type { DynamicDetail } from './types';

/**
 * Qué decirle a la persona cuando una seña dinámica no valida (D40): la parte
 * del puntaje que más le falta, en palabras. No cambia ningún umbral; solo
 * explica el que ya hay.
 */
export type DynamicFeedbackKind = 'movimiento' | 'lugar' | 'orientacion' | 'forma';

export interface DynamicFeedback {
  kind: DynamicFeedbackKind;
  message: string;
}

/**
 * Rotación media (grados) desde la que se avisa de la orientación. Con la
 * palma abajo en el apoyo de Gracias la media es ~45°; las inclinaciones
 * naturales que sí validan quedan en ≤ 30° (stress-sign.mjs).
 */
export const ORIENTATION_HINT_DEG = 35;

export function dynamicFeedback(detail: DynamicDetail): DynamicFeedback {
  if (detail.motionFactor < 1) {
    return {
      kind: 'movimiento',
      message: 'Haz el movimiento completo: tu mano casi no se movió.',
    };
  }
  if (detail.locationFactor < 1 && detail.locationOffset) {
    const [x, y] = detail.locationOffset;
    let where: string;
    if (Math.abs(y) >= Math.abs(x)) where = y > 0 ? 'más arriba' : 'más abajo';
    // x crece hacia el otro lado del cuerpo (ya espejado para la mano izquierda).
    else where = x > 0 ? 'más hacia el lado de tu mano' : 'más hacia el centro';
    return { kind: 'lugar', message: `Haz la seña ${where}, a la altura que muestra el avatar.` };
  }
  if ((detail.orientationDeg ?? 0) >= ORIENTATION_HINT_DEG) {
    return {
      kind: 'orientacion',
      message: 'Revisa hacia dónde mira tu palma y hacia dónde apuntan tus dedos, como el avatar.',
    };
  }
  return {
    kind: 'forma',
    message: 'Revisa la forma de la mano (dedos juntos o separados, pulgar): compárala con el avatar.',
  };
}
