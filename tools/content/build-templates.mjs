/**
 * Pipeline reproducible video → plantillas de señas para @enlaza/cv-model.
 *
 * Uso: npx vite-node tools/content/build-templates.mjs [courtesy|alphabet|all]
 * (vite-node —incluido con vitest— porque cv-model usa imports TS sin
 * extensión, que el type-stripping nativo de Node no resuelve)
 *
 * - courtesy: los 10 mp4 de content/ical-2026-09/ → plantillas dinámicas
 *   (una por seña de la lección lsc-cortesia).
 * - alphabet: content/ical-2026-09/raw-content/abecedarioLSC.mp4 (gitignorado)
 *   → plantillas estáticas/dinámicas de las letras (lecciones lsc-alfabeto-*).
 *
 * La salida se mezcla por signId en apps/web/public/templates/lsc-bundled.json
 * (formato TemplateStore v1, el mismo del export/import de /plantillas), que
 * la web carga como plantillas por defecto. Solo se commitean las plantillas
 * derivadas, nunca los insumos de raw-content.
 *
 * Usa el MISMO código de features que la app (packages/cv-model) para que
 * las plantillas sean comparables con lo que produce la cámara del usuario.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createExtractor, repoRoot } from '../avatar/extract-lib.mjs';
import {
  buildDynamicTemplate,
  buildStaticTemplate,
  toFeatureVector,
} from '../../packages/cv-model/src/index.ts';

const OUT_FILE = path.join(repoRoot, 'apps', 'web', 'public', 'templates', 'lsc-bundled.json');

/** Videos de cortesía en el orden de la lección lsc-cortesia (catalog.ts). */
const COURTESY = [
  'buenos-dias',
  'buenas-tardes',
  'buenas-noches',
  'gracias',
  'por-favor',
  'hola',
  'con-mucho-gusto',
  'lo-siento',
  'como-estas',
  'permiso',
].map((slug, i) => ({
  video: `content/ical-2026-09/${slug}.mp4`,
  signId: `lsc-cortesia-${i}`,
}));

/**
 * Elige la mano activa de la seña: la que más recorre en imagen (con la
 * cantidad de frames como desempate). El cv-model es de una sola mano.
 */
function chooseHand(frames) {
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
function frameVector(frame, side) {
  const lm = frame[`${side}Hand`];
  if (!lm) return null;
  const landmarks = lm.map(([x, y, z]) => ({ x, y, z }));
  return toFeatureVector(landmarks, side === 'right' ? 'Left' : 'Right');
}

async function buildCourtesy(extractor) {
  const templates = [];
  for (const { video, signId } of COURTESY) {
    const result = await extractor.extract(video);
    const side = chooseHand(result.frames);
    if (!side) throw new Error(`Sin manos detectadas en ${video}`);
    const vectors = result.frames.map((f) => frameVector(f, side)).filter(Boolean);
    if (vectors.length < 8) throw new Error(`Muy pocos frames con mano en ${video}`);
    templates.push(buildDynamicTemplate(signId, vectors));
    console.log(
      `  ${signId} ← ${path.basename(video)} (mano ${side === 'right' ? 'derecha' : 'izquierda'}, ${vectors.length} frames)`,
    );
  }
  return templates;
}

function mergeAndWrite(newTemplates) {
  let existing = [];
  if (fs.existsSync(OUT_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      if (parsed.version === 1 && Array.isArray(parsed.templates)) existing = parsed.templates;
    } catch {
      /* archivo corrupto: se regenera */
    }
  }
  const regenerated = new Set(newTemplates.map((t) => t.signId));
  const templates = [...existing.filter((t) => !regenerated.has(t.signId)), ...newTemplates].sort(
    (a, b) => a.signId.localeCompare(b.signId),
  );
  const store = {
    version: 1,
    source:
      'Derivadas de los videos de referencia de ICAL con tools/content/build-templates.mjs. ' +
      'Contenido provisional, sin validar por ICAL ni por la comunidad sorda (validated=0).',
    templates,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(store));
  console.log(`OK: ${templates.length} plantillas en ${path.relative(repoRoot, OUT_FILE)}`);
}

const what = process.argv[2] ?? 'all';
const extractor = await createExtractor();
try {
  const templates = [];
  if (what === 'courtesy' || what === 'all') {
    console.log('Cortesía:');
    templates.push(...(await buildCourtesy(extractor)));
  }
  if (what === 'alphabet' || what === 'all') {
    const { buildAlphabet } = await import('./build-alphabet.mjs');
    templates.push(...(await buildAlphabet(extractor)));
  }
  mergeAndWrite(templates);
} finally {
  await extractor.close();
}
