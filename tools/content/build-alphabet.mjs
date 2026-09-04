/**
 * Plantillas del abecedario LSC desde el video fuente (gitignorado).
 *
 * El video (content/ical-2026-09/raw-content/abecedarioLSC.mp4, ~4 min)
 * presenta las 27 letras en orden A…Z con Ñ tras N, cada una rotulada con la
 * letra gigante en la franja derecha del cuadro y una tarjeta de título al
 * inicio. La segmentación aprovecha ese rótulo: la extracción trae una firma
 * de luminancia 8×8 de la franja derecha por frame (sig=1) y un cambio
 * brusco de firma marca el paso a la siguiente letra — mucho más fiable que
 * segmentar por quietud de la mano.
 *
 * Por letra: las estáticas toman la ventana de frames más quieta del
 * segmento (plantilla estática promediada, como hace /plantillas con 3
 * muestras); las dinámicas (J, Ñ, X, Z según el catálogo) usan la secuencia
 * completa del segmento (plantilla DTW).
 *
 * Del video nunca sale nada commiteable salvo estas plantillas JSON.
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../avatar/extract-lib.mjs';
import { chooseHand, frameVector } from './common.mjs';
import {
  buildDynamicTemplate,
  buildStaticTemplate,
  euclideanDistance,
} from '../../packages/cv-model/src/index.ts';

const VIDEO = 'content/ical-2026-09/raw-content/abecedarioLSC.mp4';

/** Orden del video = orden del catálogo (alfabeto-1: A–M, alfabeto-2: N–Z). */
// prettier-ignore
const LETTERS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M',
  'N', 'Ñ', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
];
const DYNAMIC_LETTERS = new Set(['J', 'Ñ', 'X', 'Z']);
const signIdFor = (i) => (i < 13 ? `lsc-alfabeto-1-${i}` : `lsc-alfabeto-2-${i - 13}`);

// Umbrales calibrados con el diagnóstico de corridas del video real:
// firmas del MISMO rótulo difieren <1 entre sí; rótulos de letras distintas
// difieren ≥24; las transiciones animadas cambian gradualmente (pasos <25,
// p. ej. D→E e I→J no superaban el umbral alto y se fusionaban).
const SIG_BOUNDARY = 8; // dif. media frame a frame que rompe una corrida estable
const SIG_SAME = 10; // dif. entre representativas bajo la cual dos corridas son el mismo rótulo
const MIN_SEGMENT_S = 3; // cada letra dura ~8 s; descarta grupos espurios
const MIN_HAND_RATIO = 0.5; // segmentos sin mano (intro/outro) no son letras
const MIN_CAPTION_LUMA = 200; // el rótulo es blanco: sin píxel brillante no hay letra en pantalla
const STATIC_WINDOW = 6; // frames de la ventana quieta para plantillas estáticas

/**
 * Correcciones verificadas a ojo contra el video: en 152–165 s el rótulo de
 * la Q se sostiene en DOS posiciones estables (entra deslizándose y se
 * re-ancla a los ~7 s), que la firma ve como dos segmentos distintos de la
 * misma letra. Los segmentos contenidos en cada rango se fusionan.
 */
const MERGE_SPANS_S = [[151.8, 165.2]];

function sigDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/**
 * Corta la línea de tiempo en segmentos de rótulo constante.
 *
 * No basta cortar donde la firma cambia frame a frame: la mano del señante
 * entra a la franja del rótulo en las letras con movimiento (p. ej. la J) y
 * genera ruido continuo que o inventa cortes o enmascara los reales
 * (comprobado: I+J salían fusionadas y Q partida en dos). En cambio:
 * 1) se detectan "corridas estables" (frames consecutivos con firma casi
 *    idéntica) — la mano en tránsito nunca forma una corrida larga;
 * 2) corridas consecutivas con la MISMA firma representativa se fusionan
 *    (el rótulo no cambió: solo pasó la mano o hubo animación);
 * 3) cada grupo resultante es una letra, del primer al último frame.
 */
export function segmentByCaption(frames) {
  const runs = [];
  let start = 0;
  for (let i = 1; i <= frames.length; i++) {
    const broken =
      i === frames.length || sigDistance(frames[i].sig, frames[i - 1].sig) >= SIG_BOUNDARY;
    if (!broken) continue;
    if (i - start >= 3) runs.push({ start, end: i });
    start = i;
  }

  // Firma representativa: media por píxel de la corrida.
  const repSig = (run) => {
    const rep = new Array(64).fill(0);
    for (let i = run.start; i < run.end; i++) {
      for (let p = 0; p < 64; p++) rep[p] += frames[i].sig[p];
    }
    return rep.map((v) => v / (run.end - run.start));
  };

  const groups = [];
  for (const run of runs) {
    const rep = repSig(run);
    const last = groups[groups.length - 1];
    if (last && sigDistance(last.rep, rep) < SIG_SAME) {
      last.end = run.end;
      // La corrida más larga manda en la firma del grupo (menos ruido).
      if (run.end - run.start > last.repLen) {
        last.rep = rep;
        last.repLen = run.end - run.start;
      }
    } else {
      groups.push({ start: run.start, end: run.end, rep, repLen: run.end - run.start });
    }
  }

  const segments = [];
  for (const g of groups) {
    const slice = frames.slice(g.start, g.end);
    if (slice.length === 0) continue;
    const duration = slice[slice.length - 1].t - slice[0].t;
    if (duration < MIN_SEGMENT_S) continue;
    const withHand = slice.filter((f) => f.leftHand || f.rightHand).length;
    if (withHand / slice.length < MIN_HAND_RATIO) continue;
    // Hay tramos entre letras donde el rótulo desaparece pero el señante
    // sigue en cámara: sin píxeles blancos de rótulo no es una letra.
    if (Math.max(...g.rep) < MIN_CAPTION_LUMA) continue;
    const span = MERGE_SPANS_S.find(
      ([a, b]) => slice[0].t >= a && slice[slice.length - 1].t <= b,
    );
    const last = segments[segments.length - 1];
    if (span && last && last[0].t >= span[0]) {
      last.push(...slice);
    } else {
      segments.push(slice);
    }
  }
  return segments;
}

/** Ventana de `size` vectores consecutivos con menor movimiento interno. */
function stillestWindow(vectors, size) {
  if (vectors.length <= size) return vectors;
  let best = 0;
  let bestCost = Infinity;
  for (let i = 0; i + size <= vectors.length; i++) {
    let cost = 0;
    for (let j = i + 1; j < i + size; j++) {
      cost += euclideanDistance(vectors[j], vectors[j - 1]);
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  }
  return vectors.slice(best, best + size);
}

export async function buildAlphabet(extractor) {
  if (!fs.existsSync(path.join(repoRoot, VIDEO))) {
    console.warn(`Abecedario: falta ${VIDEO} (gitignorado) — se omite.`);
    return [];
  }
  // Caché de extracción junto al video (carpeta gitignorada): permite iterar
  // la segmentación sin volver a procesar ~4 min de video.
  const cacheFile = path.join(repoRoot, `${VIDEO}.landmarks.json`);
  let result;
  if (fs.existsSync(cacheFile)) {
    console.log('Abecedario: usando extracción cacheada.');
    result = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  } else {
    console.log('Abecedario: extrayendo landmarks (~4 min de video a velocidad real)...');
    result = await extractor.extract(VIDEO, { rate: '1', sig: '1' });
    fs.writeFileSync(cacheFile, JSON.stringify(result));
  }
  const segments = segmentByCaption(result.frames);

  const describe = (s) => `${s[0].t.toFixed(1)}–${s[s.length - 1].t.toFixed(1)}s`;
  if (segments.length !== LETTERS.length) {
    throw new Error(
      `Se esperaban ${LETTERS.length} segmentos de letra y salieron ${segments.length}:\n` +
        segments.map((s, i) => `  ${i}: ${describe(s)}`).join('\n') +
        '\nAjusta SIG_BOUNDARY/MIN_SEGMENT_S o revisa el video.',
    );
  }

  const templates = [];
  for (let i = 0; i < LETTERS.length; i++) {
    const letter = LETTERS[i];
    const segment = segments[i];
    const side = chooseHand(segment);
    const vectors = segment.map((f) => frameVector(f, side)).filter(Boolean);
    if (vectors.length < STATIC_WINDOW) {
      throw new Error(`Letra ${letter} (${describe(segment)}): solo ${vectors.length} frames con mano.`);
    }
    const signId = signIdFor(i);
    templates.push(
      DYNAMIC_LETTERS.has(letter)
        ? buildDynamicTemplate(signId, vectors)
        : buildStaticTemplate(signId, stillestWindow(vectors, STATIC_WINDOW)),
    );
    console.log(
      `  ${signId} ← ${letter} (${describe(segment)}, mano ${side === 'right' ? 'derecha' : 'izquierda'}, ` +
        `${vectors.length} frames, ${DYNAMIC_LETTERS.has(letter) ? 'dinámica' : 'estática'})`,
    );
  }
  return templates;
}
