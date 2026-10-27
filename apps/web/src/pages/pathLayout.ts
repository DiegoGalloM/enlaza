/**
 * Mapa de la ruta de aprendizaje para cualquier cantidad de lecciones (D47).
 *
 * Antes había 7 posiciones fijas dibujadas a mano: la lección 8 caía encima
 * de la 7, y en un celular los nodos se montaban. Aquí las lecciones se
 * acomodan en serpentina (fila de izquierda a derecha, la siguiente de
 * derecha a izquierda), con las columnas que quepan en el ancho disponible,
 * y el camino se genera uniendo los nodos.
 */

/** Ancho de una columna y alto de una fila, en unidades del viewBox del SVG. */
const COLUMN_WIDTH = 225;
const ROW_HEIGHT = 230;
/** Desfase vertical alterno dentro de una fila: el camino ondula como en el mockup. */
const WAVE = 18;

export interface PathNode {
  x: number;
  y: number;
}

export interface PathLayout {
  width: number;
  height: number;
  nodes: PathNode[];
  /** Un tramo `d` de SVG por cada par de lecciones seguidas (i → i+1). */
  segments: string[];
}

/** Columnas del mapa según su ancho en píxeles: nodos de ~150 px como mínimo. */
export function pathColumns(widthPx: number): number {
  if (widthPx < 560) return 2;
  if (widthPx < 860) return 3;
  return 4;
}

export function pathLayout(count: number, columns: number): PathLayout {
  const cols = Math.max(1, Math.min(columns, count || 1));
  const rows = Math.max(1, Math.ceil(count / cols));
  const nodes: PathNode[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const inRow = i % cols;
    const col = row % 2 === 0 ? inRow : cols - 1 - inRow;
    nodes.push({
      x: col * COLUMN_WIDTH + COLUMN_WIDTH / 2,
      y: row * ROW_HEIGHT + ROW_HEIGHT / 2 + (i % 2 === 0 ? WAVE : -WAVE),
    });
  }

  const segments: string[] = [];
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    if (Math.floor(i / cols) === Math.floor((i + 1) / cols)) {
      // Misma fila: curva en S horizontal.
      const mid = (a.x + b.x) / 2;
      segments.push(`M${a.x},${a.y} C${mid},${a.y} ${mid},${b.y} ${b.x},${b.y}`);
    } else {
      // Cambio de fila: el camino baja por fuera del borde en que quedó.
      const side = a.x > (cols * COLUMN_WIDTH) / 2 ? 1 : -1;
      const bulge = side * COLUMN_WIDTH * 0.45;
      segments.push(`M${a.x},${a.y} C${a.x + bulge},${a.y} ${b.x + bulge},${b.y} ${b.x},${b.y}`);
    }
  }

  return { width: cols * COLUMN_WIDTH, height: rows * ROW_HEIGHT, nodes, segments };
}
