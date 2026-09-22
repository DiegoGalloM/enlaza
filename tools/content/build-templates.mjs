/**
 * Pipeline reproducible video → plantillas de señas para @enlaza/cv-model.
 *
 * Uso: npx vite-node tools/content/build-templates.mjs [courtesy|alphabet|all]
 *                                                     [--only <signId> ...]
 * (vite-node —incluido con vitest— porque cv-model usa imports TS sin
 * extensión, que el type-stripping nativo de Node no resuelve)
 *
 * - courtesy: los 10 mp4 de content/ical-2026-09/ → plantillas dinámicas
 *   (una por seña de la lección lsc-cortesia).
 * - alphabet: content/ical-2026-09/raw-content/abecedarioLSC.mp4 (gitignorado)
 *   → plantillas estáticas/dinámicas de las letras (lecciones lsc-alfabeto-*).
 * - --only: empaqueta EXACTAMENTE las señas indicadas y reemplaza el bundle en
 *   vez de mezclarlo. Sirve para dejar una sola plantilla en la demo mientras
 *   ICAL da retroalimentación sobre ella, antes de publicar el lote completo.
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
import { chooseHand, frameLocation, frameVector, frameWrist, videoAspect } from './common.mjs';
import { buildAlphabet } from './build-alphabet.mjs';
import {
  buildDynamicTemplate,
  FEATURE_VERSION,
  locationTrajectory,
  motionTrajectory,
} from '../../packages/cv-model/src/index.ts';
import { signAnimationFor } from '../../apps/web/src/avatar/animations.ts';

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

async function buildCourtesy(extractor, wanted) {
  const templates = [];
  for (const { video, signId } of COURTESY.filter((c) => !wanted || wanted.has(c.signId))) {
    const result = await extractor.extract(video);
    // Tramo de la seña: el mismo que reproduce el avatar (animations.ts). Los
    // videos traen preparación y regreso a reposo; si entran a la plantilla,
    // DTW exige que la persona también los haga, y quien copia al avatar no
    // los hace (Hola completo: 0.42 haciendo solo la seña).
    const [from, to] = signAnimationFor(signId)?.window ?? [-Infinity, Infinity];
    const frames = result.frames.filter((f) => f.t >= from && f.t <= to);
    const side = chooseHand(frames);
    if (!side) throw new Error(`Sin manos detectadas en ${video}`);
    const withHand = frames.filter((f) => f[`${side}Hand`]);
    const vectors = withHand.map((f) => frameVector(f, side, videoAspect(result)));
    if (vectors.length < 8) throw new Error(`Muy pocos frames con mano en ${video}`);
    // Duración de la seña tal como se capturó: la ventana de práctica se
    // dimensiona con ella (ver defaultWindowMs en cv-model).
    const sourceMs = Math.round((withHand[withHand.length - 1].t - withHand[0].t) * 1000);
    // Trayectoria de la muñeca: sin ella, una seña de forma casi constante
    // (Por favor) se validaba con la mano quieta (D35, D36).
    const motion = motionTrajectory(withHand.map((f) => frameWrist(f, side, videoAspect(result))));
    // Lugar de la mano respecto a la cara: sin él, Por favor validaba con los
    // círculos hechos en cualquier parte, no solo en el pecho (D37).
    const location = locationTrajectory(
      withHand.map((f) => frameLocation(f, side, videoAspect(result))),
    );
    templates.push(buildDynamicTemplate(signId, vectors, sourceMs, motion, location));
    console.log(
      `  ${signId} ← ${path.basename(video)} (mano ${side === 'right' ? 'derecha' : 'izquierda'}, ` +
        `${vectors.length} frames, ${(sourceMs / 1000).toFixed(1)}s` +
        `${location ? '' : ', SIN LUGAR: no se detectó la cara'})`,
    );
  }
  return templates;
}

function mergeAndWrite(newTemplates, replace) {
  let existing = [];
  if (!replace && fs.existsSync(OUT_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
      // Plantillas de otra versión de features no se mezclan: se regeneran.
      if (parsed.version === FEATURE_VERSION && Array.isArray(parsed.templates)) {
        existing = parsed.templates;
      }
    } catch {
      /* archivo corrupto: se regenera */
    }
  }
  const regenerated = new Set(newTemplates.map((t) => t.signId));
  const templates = [...existing.filter((t) => !regenerated.has(t.signId)), ...newTemplates].sort(
    (a, b) => a.signId.localeCompare(b.signId),
  );
  const store = {
    version: FEATURE_VERSION,
    source:
      'Derivadas de los videos de referencia de ICAL con tools/content/build-templates.mjs. ' +
      'Contenido provisional, sin validar por ICAL ni por la comunidad sorda (validated=0).' +
      (replace
        ? ' Bundle parcial (--only): solo las señas listadas aquí se validan con la cámara; ' +
          'las demás quedan sin plantilla hasta que esta se revise.'
        : ''),
    templates,
  };
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(store));
  console.log(`OK: ${templates.length} plantillas en ${path.relative(repoRoot, OUT_FILE)}`);
}

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex === -1 ? null : new Set(args.slice(onlyIndex + 1));
if (only && only.size === 0) throw new Error('--only necesita al menos un signId');
const what = onlyIndex === 0 ? 'all' : (args[0] ?? 'all');

const extractor = await createExtractor();
try {
  const templates = [];
  if (what === 'courtesy' || what === 'all') {
    console.log('Cortesía:');
    templates.push(...(await buildCourtesy(extractor, only)));
  }
  if (what === 'alphabet' || what === 'all') {
    const letters = await buildAlphabet(extractor);
    templates.push(...(only ? letters.filter((t) => only.has(t.signId)) : letters));
  }
  if (only) {
    const missing = [...only].filter((id) => !templates.some((t) => t.signId === id));
    if (missing.length > 0) throw new Error(`--only sin resultado para: ${missing.join(', ')}`);
  }
  mergeAndWrite(templates, Boolean(only));
} finally {
  await extractor.close();
}
