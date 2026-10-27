/**
 * Prueba de luz (D48): ¿la práctica reconoce las señas con poca luz, con
 * contraluz o con la imagen lavada? ¿Y la corrección de lighting.ts ayuda sin
 * empeorar la buena luz?
 *
 * Uso: npx vite-node tools/content/light-stress.mjs [signId…] [--rapido]
 *   (por defecto las cinco señas con plantilla)
 *
 * Simula cada condición de luz sobre los videos de referencia, cuadro a
 * cuadro, en hand-extract-page.html (el MISMO HandLandmarker y detector de
 * caras de la práctica), con y sin la corrección, y reporta:
 * - mano: % de cuadros con alguna mano detectada; cara: % con cara;
 * - si la seña valida con SessionValidator (video completo a 1× y solo la
 *   seña a 0.8×), y en cuántos segundos.
 * Caché en content/ical-2026-09/raw-content/cache/luz/ (gitignorado).
 * --rapido: reproduce a 0.25× en vez de 0.0625× (procesa ~4 veces más rápido;
 *   puede saltarse cuadros si el equipo es lento: compara "normal" con la caché
 *   de diagnose-practice).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createExtractor, repoRoot } from '../avatar/extract-lib.mjs';
import { SessionValidator } from '../../packages/cv-model/src/index.ts';
import { signAnimationFor } from '../../apps/web/src/avatar/animations.ts';
import { faceFromBox } from './common.mjs';

const VIDEOS = {
  'lsc-cortesia-5': 'hola',
  'lsc-cortesia-3': 'gracias',
  'lsc-cortesia-4': 'por-favor',
  'lsc-cortesia-0': 'buenos-dias',
  'lsc-cortesia-1': 'buenas-tardes',
};
const ALL_CONDITIONS = ['normal', 'oscura', 'muy-oscura', 'ruido', 'sobreexpuesta', 'bajo-contraste', 'contraluz'];

const args = process.argv.slice(2);
const signIds = args.filter((a) => !a.startsWith('--'));
const fast = args.includes('--rapido');
const rate = fast ? 0.25 : 0.0625;
const targets = signIds.length > 0 ? signIds : Object.keys(VIDEOS);
/** --luz=a,b: solo esas condiciones. --variante=a=1&b=2: parámetros extra para la página con corrección. */
const CONDITIONS = args.find((a) => a.startsWith('--luz='))?.slice(6).split(',') ?? ALL_CONDITIONS;
const variant = args.find((a) => a.startsWith('--variante='))?.slice(11) ?? '';

const bundle = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps/web/public/templates/lsc-bundled.json'), 'utf8'),
);
const CACHE = path.join(repoRoot, 'content', 'ical-2026-09', 'raw-content', 'cache', 'luz');
fs.mkdirSync(CACHE, { recursive: true });

async function frames(extractor, name, condition, corrected) {
  const tag = variant ? `.${variant.replace(/[^a-z0-9.]+/gi, '-')}` : '';
  const file = path.join(CACHE, `${name}.${condition}.${corrected ? 'corregida' + tag : 'sin'}.${rate}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const params = { rate: String(rate), muestra: '1' };
  if (condition !== 'normal') params.luz = condition;
  if (corrected) {
    params.corregir = '1';
    for (const [k, v] of new URLSearchParams(variant)) params[k] = v;
  }
  const result = await extractor.extract(
    `content/ical-2026-09/${name}.mp4`,
    params,
    'tools/content/hand-extract-page.html',
  );
  if (result.sample) {
    fs.writeFileSync(file.replace(/\.json$/, '.jpg'), Buffer.from(result.sample.split(',')[1], 'base64'));
    delete result.sample;
  }
  fs.writeFileSync(file, JSON.stringify(result));
  return result;
}

/** Repite los cuadros como la práctica: a `speed`, hasta `cut` s, y luego sin mano. */
function replay(signId, result, { speed = 1, cut = Infinity } = {}) {
  const template = bundle.templates.find((t) => t.signId === signId);
  const validator = new SessionValidator(signId, template.type, bundle.templates);
  const aspect = result.cropW / result.height;
  const part = result.frames.filter((f) => f.t <= cut);
  let end = 0;
  for (const f of part) {
    const t = (f.t * 1000) / speed;
    end = t;
    const frame = f.hands.length > 0 ? { hands: f.hands, timestampMs: t, aspect, face: faceFromBox(f.face) } : null;
    if (validator.feedHands(frame).status === 'correct') return t;
  }
  for (let t = end + 33; t < end + 1500; t += 33) {
    if (validator.feedHands(null).status === 'correct') return t;
  }
  return null;
}

/** Tareas en paralelo, de a `size`: cada extracción tiene su propia página. */
async function pool(tasks, size) {
  const results = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    }),
  );
  return results;
}

const pct = (n, d) => `${Math.round((100 * n) / Math.max(d, 1))}%`.padStart(4);
const cell = (t) => (t === null ? 'NO   ' : `${(t / 1000).toFixed(1)}s `);

const extractor = await createExtractor();
try {
  const jobs = [];
  for (const signId of targets) {
    for (const condition of CONDITIONS) {
      for (const corrected of [false, true]) {
        jobs.push(async () => ({
          signId,
          condition,
          corrected,
          result: await frames(extractor, VIDEOS[signId], condition, corrected),
        }));
      }
    }
  }
  const done = await pool(jobs, Number(process.env.PARALELO ?? 4));

  console.log(`Velocidad de extracción ${rate}× · mano/cara = % de cuadros · valida = segundos hasta validar\n`);
  for (const signId of targets) {
    const until = signAnimationFor(signId)?.window?.[1] ?? Infinity;
    console.log(`${VIDEOS[signId]} (${signId}):`);
    console.log(
      `  ${'condición'.padEnd(15)} ${'sin corrección: mano cara  1×    0.8×'.padEnd(40)} con corrección: mano cara  1×    0.8×   media→`,
    );
    for (const condition of CONDITIONS) {
      const row = [false, true].map((corrected) => {
        const { result } = done.find(
          (d) => d.signId === signId && d.condition === condition && d.corrected === corrected,
        );
        const total = result.frames.length;
        const hands = result.frames.filter((f) => f.hands.length > 0).length;
        const faces = result.frames.filter((f) => f.face).length;
        return `${pct(hands, total)} ${pct(faces, total)}  ${cell(replay(signId, result))} ${cell(
          replay(signId, result, { speed: 0.8, cut: until }),
        )}`;
      });
      const corrected = done.find((d) => d.signId === signId && d.condition === condition && d.corrected);
      const light = corrected.result.light ?? [];
      const share = light.filter((l) => l.corrected).length;
      const mean = light.length ? light.reduce((a, l) => a + l.mean, 0) / light.length : NaN;
      console.log(
        `  ${condition.padEnd(15)} ${row[0].padEnd(40)} ${row[1]}  ${mean.toFixed(0)} (corrige ${pct(share, light.length)})`,
      );
    }
  }
} finally {
  await extractor.close();
}
