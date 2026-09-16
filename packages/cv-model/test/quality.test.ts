import { describe, expect, it } from 'vitest';
import { SCORE_LEVEL_LABEL, scoreLevel } from '../src/quality';
import { DYNAMIC_THRESHOLD } from '../src/dynamicClassifier';
import { STATIC_THRESHOLD } from '../src/staticClassifier';

describe('scoreLevel', () => {
  it('dinámicas: se mide entre el umbral (0.60) y el techo de la referencia (0.72)', () => {
    expect(scoreLevel(DYNAMIC_THRESHOLD, 'dynamic')).toBe('bien');
    expect(scoreLevel(0.63, 'dynamic')).toBe('bien');
    expect(scoreLevel(0.66, 'dynamic')).toBe('muy-bien');
    expect(scoreLevel(0.7, 'dynamic')).toBe('excelente');
    expect(scoreLevel(0.8, 'dynamic')).toBe('excelente');
  });

  it('estáticas usan su propio rango (coseno)', () => {
    expect(scoreLevel(STATIC_THRESHOLD, 'static')).toBe('bien');
    expect(scoreLevel(0.95, 'static')).toBe('muy-bien');
    expect(scoreLevel(0.99, 'static')).toBe('excelente');
    // El mismo número significa cosas distintas según el tipo.
    expect(scoreLevel(0.66, 'static')).toBe('bien');
  });

  it('tiene una etiqueta para cada nivel', () => {
    expect(Object.values(SCORE_LEVEL_LABEL)).toEqual(['Bien', 'Muy bien', 'Excelente']);
  });
});
