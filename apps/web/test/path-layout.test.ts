import { describe, expect, it } from 'vitest';
import { pathColumns, pathLayout } from '../src/pages/pathLayout';

describe('pathLayout (D47)', () => {
  it('acomoda cualquier cantidad de lecciones sin encimar nodos', () => {
    for (const columns of [2, 3, 4]) {
      for (const count of [1, 5, 7, 8, 13]) {
        const { nodes, segments, width, height } = pathLayout(count, columns);
        expect(nodes).toHaveLength(count);
        expect(segments).toHaveLength(Math.max(0, count - 1));
        const keys = new Set(nodes.map((n) => `${Math.round(n.x)},${Math.round(n.y / 100)}`));
        expect(keys.size).toBe(count);
        for (const n of nodes) {
          expect(n.x).toBeGreaterThan(0);
          expect(n.x).toBeLessThan(width);
          expect(n.y).toBeGreaterThan(0);
          expect(n.y).toBeLessThan(height);
        }
      }
    }
  });

  it('va en serpentina: la segunda fila vuelve de derecha a izquierda', () => {
    const { nodes } = pathLayout(8, 4);
    expect(nodes[3]!.x).toBeGreaterThan(nodes[0]!.x);
    // La lección 5 queda debajo de la 4 (misma columna) y la 8 debajo de la 1.
    expect(nodes[4]!.x).toBe(nodes[3]!.x);
    expect(nodes[7]!.x).toBe(nodes[0]!.x);
    expect(nodes[4]!.y).toBeGreaterThan(nodes[3]!.y);
  });

  it('usa menos columnas cuanto más angosto es el mapa', () => {
    expect(pathColumns(360)).toBe(2);
    expect(pathColumns(700)).toBe(3);
    expect(pathColumns(1100)).toBe(4);
    // Con menos lecciones que columnas, una sola fila de su largo.
    expect(pathLayout(3, 4).width).toBe(pathLayout(3, 3).width);
  });
});
