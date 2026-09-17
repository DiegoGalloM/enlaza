import { STATIC_THRESHOLD } from './staticClassifier';
import { DYNAMIC_THRESHOLD } from './dynamicClassifier';
import type { SignType } from './types';

/**
 * Nivel de ejecución de una seña ya validada, para mostrar en palabras.
 *
 * El puntaje crudo NO es un porcentaje de certeza: en dinámicas es
 * 1 / (1 + distancia DTW), que nunca llega a 1 con landmarks reales, y en
 * estáticas es un coseno que casi siempre ronda 0.9–1. Mostrarlo como "66%"
 * se leía como una nota baja cuando está cerca de lo mejor alcanzable.
 *
 * Por eso el nivel se calcula relativo al tramo útil: del umbral de
 * aceptación (lo mínimo para validar) al techo práctico (lo que saca la
 * propia referencia), dividido en tercios.
 */
export type ScoreLevel = 'bien' | 'muy-bien' | 'excelente';

export const SCORE_LEVEL_LABEL: Record<ScoreLevel, string> = {
  bien: 'Bien',
  'muy-bien': 'Muy bien',
  excelente: 'Excelente',
};

/**
 * Techo práctico por tipo de seña.
 * - dinámica 0.72: la señante del video de Hola contra su propia plantilla,
 *   con el detector de la app y features v2, igual en cámara 16:9 y 4:3
 *   (tools/content/diagnose-practice.mjs, sept 2026).
 * - estática 0.99: hipótesis sin medir todavía — una pose sostenida contra la
 *   plantilla grabada por la misma persona. Calibrar con datos reales.
 */
const SCORE_RANGE: Record<SignType, { threshold: number; ceiling: number }> = {
  dynamic: { threshold: DYNAMIC_THRESHOLD, ceiling: 0.72 },
  static: { threshold: STATIC_THRESHOLD, ceiling: 0.99 },
};

export function scoreLevel(score: number, signType: SignType): ScoreLevel {
  const { threshold, ceiling } = SCORE_RANGE[signType];
  const progress = (score - threshold) / (ceiling - threshold);
  if (progress >= 2 / 3) return 'excelente';
  if (progress >= 1 / 3) return 'muy-bien';
  return 'bien';
}
