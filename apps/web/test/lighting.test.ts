import { describe, expect, it } from 'vitest';
import {
  applyTable,
  blendCorrection,
  correctionTable,
  lightCorrection,
  lightHint,
  measureLight,
} from '../src/cv/lighting';

const W = 64;
const H = 48;

/** Imagen RGBA gris cuyo valor depende de la posición. */
function image(value: (x: number, y: number) => number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = value(x, y);
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

/** Degradado de `from` a `to` de izquierda a derecha (con algo de textura vertical). */
const gradient = (from: number, to: number) =>
  image((x, y) => from + ((to - from) * x) / (W - 1) + ((y % 4) - 1.5));

describe('lighting (D48)', () => {
  it('con buena luz no corrige nada', () => {
    // Una escena con buen contraste también en el centro (ropa oscura, pared clara).
    const stats = measureLight(image((x, y) => 10 + (235 * ((x * 7 + y * 3) % 32)) / 31), W, H);
    expect(stats.mean).toBeGreaterThan(100);
    expect(lightCorrection(stats)).toBeNull();
    expect(lightHint(stats)).toBeNull();
  });

  it('aclara una imagen oscura hacia el gris medio', () => {
    const data = gradient(2, 60);
    const stats = measureLight(data, W, H);
    const correction = lightCorrection(stats)!;
    expect(correction).not.toBeNull();
    expect(correction.gamma).toBeLessThanOrEqual(1);
    applyTable(data, correctionTable(correction));
    const after = measureLight(data, W, H);
    expect(after.mean).toBeGreaterThan(90);
    expect(after.mean).toBeLessThan(160);
  });

  it('oscurece una imagen lavada sin pasar de la gamma máxima', () => {
    const stats = measureLight(gradient(185, 255), W, H);
    const correction = lightCorrection(stats)!;
    expect(correction.gamma).toBeGreaterThan(1);
    expect(correction.gamma).toBeLessThanOrEqual(1.5);
  });

  it('no amplifica más de 4 veces (el ruido del sensor crece igual)', () => {
    const correction = lightCorrection(measureLight(gradient(0, 20), W, H))!;
    expect(correction.hi - correction.lo).toBeGreaterThanOrEqual(255 / 4);
  });

  it('reconoce el contraluz: el centro oscuro y alrededor muy claro', () => {
    // La persona (oscura) ocupa el centro; la ventana (clara), el resto.
    const data = image((x, y) => (Math.abs(x / W - 0.5) < 0.3 && y / H > 0.1 ? 30 + (x % 7) : 240));
    const stats = measureLight(data, W, H);
    expect(stats.mean).toBeLessThan(stats.frameMean * 0.6);
    expect(lightHint(stats)).toBe('contraluz');
    // Y la corrección mira el centro, no el promedio de la imagen.
    expect(lightCorrection(stats)).not.toBeNull();
  });

  it('avisa poca luz solo cuando es mucha la falta', () => {
    expect(lightHint(measureLight(gradient(0, 50), W, H))).toBe('oscuro');
    expect(lightHint(measureLight(gradient(20, 140), W, H))).toBeNull();
  });

  it('la tabla es creciente y va de 0 a 255', () => {
    const table = correctionTable({ lo: 20, hi: 120, gamma: 0.7 });
    expect(table[0]).toBe(0);
    expect(table[255]).toBe(255);
    for (let v = 1; v < 256; v++) expect(table[v]!).toBeGreaterThanOrEqual(table[v - 1]!);
  });

  it('suaviza los cambios de corrección y la suelta cuando la luz se arregla', () => {
    const a = { lo: 0, hi: 100, gamma: 0.6 };
    const b = { lo: 20, hi: 200, gamma: 1 };
    const mixed = blendCorrection(a, b)!;
    expect(mixed.hi).toBeGreaterThan(100);
    expect(mixed.hi).toBeLessThan(200);
    expect(blendCorrection(a, null)).toBeNull();
    expect(blendCorrection(null, b)).toEqual(b);
  });
});
