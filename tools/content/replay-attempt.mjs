/**
 * Reproduce un intento real descargado de la práctica (?detalle=1 →
 * "Descargar intento") y dice qué lo hace fallar (D45).
 *
 * Uso: npx vite-node tools/content/replay-attempt.mjs <intento.json> [signId] [--plantillas=<json>]
 *
 * 1. Calidad de la captura: cuadros por segundo, frames con mano, con dos
 *    manos y con cara, y etiquetas Left/Right que ve el detector.
 * 2. El intento con la configuración actual: si valida, cuándo, y la línea de
 *    tiempo de la seña buscada (puntaje = forma × lugar × movimiento, ventana,
 *    qué seña quedó primera y qué mano se leyó en cada comparación).
 * 3. Variantes, una por posible causa: si una variante valida y la actual no,
 *    esa es la causa. Ninguna de ellas cambia la app; solo sirven para medir.
 *
 * Usa las plantillas de apps/web/public/templates/lsc-bundled.json; si en el
 * dispositivo hay plantillas grabadas en /plantillas, exportarlas y pasarlas
 * con --plantillas=<archivo.json> para usar las mismas que la app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../avatar/extract-lib.mjs';
import { DYNAMIC_THRESHOLD, SessionValidator } from '../../packages/cv-model/src/index.ts';

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith('--'));
const file = positional[0];
if (!file) throw new Error('Uso: replay-attempt.mjs <intento.json> [signId] [--plantillas=<json>]');
const attempt = JSON.parse(fs.readFileSync(file, 'utf8'));
const signId = positional[1] ?? attempt.signId;
if (!signId) throw new Error('El intento no dice qué seña es: pásala como segundo argumento');

const bundle = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps/web/public/templates/lsc-bundled.json'), 'utf8'),
);
const localFile = args.find((a) => a.startsWith('--plantillas='))?.split('=')[1];
const local = localFile ? JSON.parse(fs.readFileSync(localFile, 'utf8')).templates : [];
// Igual que mergeTemplates en la app: las del dispositivo pisan a las empaquetadas.
const localIds = new Set(local.map((t) => t.signId));
const templates = [...bundle.templates.filter((t) => !localIds.has(t.signId)), ...local];
const template = templates.find((t) => t.signId === signId);
if (!template) throw new Error(`Sin plantilla para ${signId}`);
const threshold = template.threshold ?? DYNAMIC_THRESHOLD;
const gloss = (id) => id.replace('lsc-', '');

const frames = attempt.frames;
if (!frames?.length) throw new Error('El intento no trae frames');
const span = (frames.at(-1).t - frames[0].t) / 1000;
const withHands = frames.filter((f) => f.hands.length > 0);
const labels = {};
for (const f of withHands) for (const h of f.hands) labels[h.handedness] = (labels[h.handedness] ?? 0) + 1;
const pct = (n) => `${((100 * n) / frames.length).toFixed(0)}%`;
console.log(
  `${signId}: ${localIds.has(signId) ? 'plantilla del dispositivo' : 'plantilla de la app'}, ` +
    `umbral ${threshold.toFixed(2)}, duración ${template.sourceMs ?? '?'} ms, mano registrada ${template.hand ?? 'ninguna'}\n` +
    `Captura: ${frames.length} frames en ${span.toFixed(1)} s (${(frames.length / span).toFixed(0)} fps), ` +
    `proporción ${withHands[0]?.aspect?.toFixed(2) ?? '?'}\n` +
    `  con mano ${pct(withHands.length)}, dos manos ${pct(frames.filter((f) => f.hands.length > 1).length)}, ` +
    `cara ${pct(frames.filter((f) => f.face).length)}; etiquetas ${JSON.stringify(labels)}\n`,
);

function replay(options = {}, log = false, using = templates) {
  const validator = new SessionValidator(signId, template.type, using, options);
  let best = null;
  let validatedAt = null;
  const others = new Map();
  for (const f of frames) {
    const frame =
      f.hands.length > 0
        ? { hands: f.hands, timestampMs: f.t, aspect: f.aspect, ...(f.face ? { face: f.face } : {}) }
        : null;
    const verdict = validator.feedHands(frame);
    const t = ((f.t - frames[0].t) / 1000).toFixed(2);
    if (verdict.best && verdict.best.signId !== signId) {
      others.set(verdict.best.signId, Math.max(others.get(verdict.best.signId) ?? 0, verdict.best.score));
    }
    if (verdict.target) {
      if (!best || verdict.target.score > best.score) best = verdict.target;
      if (log) {
        const d = verdict.target.detail ?? {};
        const top = verdict.best ? `${gloss(verdict.best.signId)} ${verdict.best.score.toFixed(2)}` : '-';
        console.log(
          `  ${t.padStart(6)} s  ${verdict.target.score.toFixed(3)} = forma ${d.shape?.toFixed(2)} × lugar ` +
            `${d.locationFactor?.toFixed(2)}${d.locationError !== undefined ? `(${d.locationError.toFixed(2)})` : ''} × mov ` +
            `${d.motionFactor?.toFixed(2)}${d.motionRatio !== undefined ? `(${d.motionRatio.toFixed(2)})` : ''}` +
            `${d.orientationDeg !== undefined ? ` rot ${d.orientationDeg.toFixed(0)}°` : ''}` +
            ` ventana ${((d.windowMs ?? 0) / 1000).toFixed(1)} s · primera: ${top} · mano ${verdict.hand?.handedness ?? '-'}`,
        );
      }
    }
    if (verdict.status === 'correct' && validatedAt === null) validatedAt = t;
  }
  return { best, validatedAt, others };
}

console.log('Configuración actual (línea de tiempo de la seña buscada):');
const current = replay({}, true);
console.log(
  current.validatedAt !== null
    ? `→ VALIDA a los ${current.validatedAt} s\n`
    : `→ NO VALIDA (mejor ${current.best?.score.toFixed(3) ?? '-'}, umbral ${threshold.toFixed(2)})\n`,
);

const variants = [
  ['umbral general 0.60 (sin el propio de la seña, D43)', { dynamicThreshold: DYNAMIC_THRESHOLD }],
  ['umbral 0.55', { dynamicThreshold: 0.55 }],
  ['umbral 0.50', { dynamicThreshold: 0.5 }],
  ['ventanas el doble de largas (persona muy lenta)', { windowMs: 2 * (template.sourceMs ?? 2000) }],
  ['sin compuerta de lugar (D37)', { locationTolerance: Infinity }],
  ['sin compuerta de movimiento (D36)', { minMotionRatio: 0 }],
  ['forma con la rotación, como antes de D39', { rotationTolerant: false }],
];
if (template.hand) {
  // La práctica sigue la mano registrada: si la persona hizo la seña con la
  // otra (zurda, o cámara espejada), se leyó su mano de apoyo.
  const other = template.hand === 'Left' ? 'Right' : 'Left';
  const flipped = templates.map((t) => (t.signId === signId ? { ...t, hand: other } : t));
  variants.push([`siguiendo la otra mano (${other}: zurda o cámara espejada)`, {}, flipped]);
}
console.log('Variantes (si una valida y la actual no, esa es la causa):');
for (const [label, options, using] of variants) {
  const r = replay(options, false, using);
  const verdict = r.validatedAt !== null ? `VALIDA ${r.validatedAt} s` : 'no valida';
  console.log(`  ${label.padEnd(54)} ${verdict.padEnd(14)} mejor ${r.best?.score.toFixed(3) ?? '-'}`);
}
if (current.others.size > 0) {
  console.log(
    '\nOtras señas que quedaron primeras: ' +
      [...current.others].map(([id, s]) => `${gloss(id)} ${s.toFixed(2)}`).join(', ') +
      ' (si alguna pasó su propio umbral, la app dijo "parece otra seña")',
  );
}
