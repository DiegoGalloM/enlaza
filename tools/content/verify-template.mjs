/**
 * Verifica una plantilla empaquetada reproduciendo videos reales a través del
 * MISMO SessionValidator que usa la cámara en la pantalla de práctica.
 *
 * Uso: npx vite-node tools/content/verify-template.mjs <signId>
 *
 * Mide tres cosas:
 * 1. Acierto: el video del que salió la plantilla, ¿valida la seña?
 * 2. Tolerancia a velocidad: el mismo video a 0.7× y 1.4×, porque nadie seña
 *    al ritmo exacto del video de referencia.
 * 3. Falsos positivos: los otros 9 videos de cortesía, ¿validan como esta
 *    seña? Con un bundle de una sola plantilla no hay competencia que desempate,
 *    así que un falso positivo aquí significa que la demo diría "¡Correcta!"
 *    ante una seña distinta.
 *
 * Es una verificación de la plantilla contra la señante del video, no contra
 * otra persona: acota errores de pipeline, no predice la precisión real con
 * usuarios distintos. Eso solo se sabe probando con personas (y validando el
 * contenido con ICAL).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createExtractor, repoRoot } from '../avatar/extract-lib.mjs';
import { appHandedness, chooseHand } from './common.mjs';
import { SessionValidator } from '../../packages/cv-model/src/index.ts';

const BUNDLE = path.join(repoRoot, 'apps', 'web', 'public', 'templates', 'lsc-bundled.json');
// Caché de extracción en carpeta gitignorada: nada de esto se commitea.
const CACHE_DIR = path.join(repoRoot, 'content', 'ical-2026-09', 'raw-content', 'cache');

/** Videos de cortesía en el orden de la lección lsc-cortesia (catalog.ts). */
const COURTESY = [
  ['buenos-dias', 'Buenos días'],
  ['buenas-tardes', 'Buenas tardes'],
  ['buenas-noches', 'Buenas noches'],
  ['gracias', 'Gracias'],
  ['por-favor', 'Por favor'],
  ['hola', 'Hola'],
  ['con-mucho-gusto', 'Con mucho gusto'],
  ['lo-siento', 'Lo siento'],
  ['como-estas', '¿Cómo está?'],
  ['permiso', 'Permiso'],
].map(([slug, gloss], i) => ({ slug, gloss, signId: `lsc-cortesia-${i}` }));

const targetId = process.argv[2];
if (!targetId) throw new Error('Uso: verify-template.mjs <signId>');

const bundle = JSON.parse(fs.readFileSync(BUNDLE, 'utf8'));
const template = bundle.templates.find((t) => t.signId === targetId);
if (!template) throw new Error(`${targetId} no está en el bundle`);
const target = COURTESY.find((c) => c.signId === targetId);
if (!target) throw new Error(`verify-template solo cubre señas de cortesía por ahora`);

async function framesFor(extractor, slug) {
  const cacheFile = path.join(CACHE_DIR, `${slug}.json`);
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const result = await extractor.extract(`content/ical-2026-09/${slug}.mp4`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(result));
  return result;
}

/**
 * Reproduce los frames de un video por el validador como si vinieran de la
 * cámara. `speed` > 1 comprime los tiempos (seña más rápida que el video).
 */
function replay(result, speed) {
  const side = chooseHand(result.frames);
  const validator = new SessionValidator(targetId, template.type, bundle.templates);
  let bestScore = 0;
  let validated = false;
  for (const frame of result.frames) {
    const lm = frame[`${side}Hand`];
    if (!lm) {
      validator.feedEmpty();
      continue;
    }
    const verdict = validator.feed({
      landmarks: lm.map(([x, y, z]) => ({ x, y, z })),
      handedness: appHandedness(side),
      timestampMs: (frame.t * 1000) / speed,
    });
    if (verdict.best?.signId === targetId) bestScore = Math.max(bestScore, verdict.best.score);
    if (verdict.status === 'correct') validated = true;
  }
  return { validated, bestScore };
}

const extractor = await createExtractor();
let failures = 0;
try {
  console.log(`Plantilla ${targetId} ("${target.gloss}", ${template.type})\n`);

  console.log('1. Su propio video, a distintas velocidades:');
  const own = await framesFor(extractor, target.slug);
  for (const speed of [1, 0.7, 1.4]) {
    const { validated, bestScore } = replay(own, speed);
    const label = speed === 1 ? 'velocidad del video' : `${speed}× (${speed < 1 ? 'más lento' : 'más rápido'})`;
    console.log(`   ${validated ? 'VALIDA  ' : 'NO VALIDA'} ${label.padEnd(22)} mejor puntaje ${bestScore.toFixed(3)}`);
    if (!validated) failures++;
  }

  console.log('\n2. Las otras 9 señas de cortesía (deberían NO validar):');
  for (const other of COURTESY.filter((c) => c.signId !== targetId)) {
    const { validated, bestScore } = replay(await framesFor(extractor, other.slug), 1);
    console.log(
      `   ${validated ? 'FALSO POSITIVO' : 'ok            '} ${other.gloss.padEnd(16)} puntaje ${bestScore.toFixed(3)}`,
    );
    if (validated) failures++;
  }
} finally {
  await extractor.close();
}

console.log(failures === 0 ? '\nTodo en orden.' : `\n${failures} problema(s).`);
process.exit(failures === 0 ? 0 : 1);
