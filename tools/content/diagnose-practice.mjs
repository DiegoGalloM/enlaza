/**
 * Diagnóstico de la validación con cámara: ¿reconocería la app una seña hecha
 * por una persona real, no solo el video del que salió la plantilla?
 *
 * Uso: npx vite-node tools/content/diagnose-practice.mjs [signId] [--hasta=1.85]
 *
 * A diferencia de verify-template.mjs (que reutiliza los landmarks de
 * Holistic con los que se construyó la plantilla), aquí los frames salen del
 * MISMO HandLandmarker que usa la pantalla de práctica, y se prueban
 * escenarios de uso real:
 * - el video completo (lo que mide verify-template);
 * - solo la seña (--hasta), después la mano sale de cuadro: lo que hace una
 *   persona que copia al avatar, sin el regreso a reposo del video;
 * - lo mismo con cámara 4:3 (webcam típica; el video fuente es 16:9);
 * - distintas velocidades y repeticiones seguidas.
 *
 * Sigue siendo la misma señante: si aquí no valida, con otra persona menos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createExtractor, repoRoot } from '../avatar/extract-lib.mjs';
import { SessionValidator } from '../../packages/cv-model/src/index.ts';

const args = process.argv.slice(2);
const signId = args.find((a) => !a.startsWith('--')) ?? 'lsc-cortesia-5';
const until = Number(args.find((a) => a.startsWith('--hasta='))?.split('=')[1] ?? 1.85);
const VIDEOS = { 'lsc-cortesia-5': 'content/ical-2026-09/hola.mp4' };
const video = VIDEOS[signId];
if (!video) throw new Error(`Sin video registrado para ${signId}`);

const bundle = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps/web/public/templates/lsc-bundled.json'), 'utf8'),
);
const template = bundle.templates.find((t) => t.signId === signId);

/** Frames de cámara simulados: [{ tMs, frame | null }]. */
function timeline(frames, { speed = 1, cut = Infinity, repeat = 1, gapMs = 800 } = {}) {
  const out = [];
  let offset = 0;
  for (let r = 0; r < repeat; r++) {
    const part = frames.filter((f) => f.t <= cut);
    for (const f of part) {
      out.push({ tMs: offset + (f.t * 1000) / speed, lm: f.landmarks, hand: f.handedness });
    }
    const end = offset + (part[part.length - 1].t * 1000) / speed;
    // La mano sale de cuadro entre repeticiones (y al final).
    for (let t = end + 33; t < end + gapMs; t += 33) out.push({ tMs: t, lm: null });
    offset = end + gapMs;
  }
  return out;
}

function replay(events) {
  const validator = new SessionValidator(signId, template.type, bundle.templates);
  let best = 0;
  let validatedAt = null;
  for (const e of events) {
    const verdict = e.lm
      ? validator.feed({ landmarks: e.lm, handedness: e.hand, timestampMs: e.tMs })
      : validator.feedEmpty();
    if (verdict.best?.signId === signId) best = Math.max(best, verdict.best.score);
    if (verdict.status === 'correct' && validatedAt === null) validatedAt = e.tMs;
  }
  return { best, validatedAt };
}

// Caché en carpeta gitignorada (mismo lugar que verify-template): la extracción tarda ~1 min.
const CACHE_DIR = path.join(repoRoot, 'content', 'ical-2026-09', 'raw-content', 'cache');
async function handFrames(extractor, aspect) {
  const name = `${path.basename(video, '.mp4')}.handlandmarker${aspect ? '-4x3' : ''}.json`;
  const file = path.join(CACHE_DIR, name);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const params = aspect ? { aspect } : {};
  const result = await extractor.extract(video, params, 'tools/content/hand-extract-page.html');
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(result));
  return result;
}

const extractor = await createExtractor();
try {
  const cameras = {
    '16:9 (como el video)': await handFrames(extractor, 0),
    '4:3 (webcam típica)': await handFrames(extractor, 4 / 3),
  };
  const detected = cameras['16:9 (como el video)'].frames;
  console.log(
    `${signId}: plantilla dinámica, ventana ${template.sourceMs} ms, umbral 0.60\n` +
      `HandLandmarker detectó mano en ${detected.filter((f) => f.landmarks).length}/${detected.length} frames; ` +
      `etiquetas: ${[...new Set(detected.map((f) => f.handedness).filter(Boolean))].join(', ')}\n`,
  );
  const scenarios = [
    ['video completo, 1×', {}],
    [`solo la seña (hasta ${until} s), 1×`, { cut: until }],
    [`solo la seña, 0.8× (más lento)`, { cut: until, speed: 0.8 }],
    [`solo la seña, 1.25× (más rápido)`, { cut: until, speed: 1.25 }],
    [`solo la seña, 3 repeticiones seguidas`, { cut: until, repeat: 3 }],
  ];
  for (const [camera, result] of Object.entries(cameras)) {
    console.log(`Cámara ${camera}:`);
    for (const [label, opts] of scenarios) {
      const { best, validatedAt } = replay(timeline(result.frames, opts));
      const verdict = validatedAt !== null ? `VALIDA a los ${(validatedAt / 1000).toFixed(1)} s` : 'NO VALIDA';
      console.log(`  ${verdict.padEnd(20)} ${label.padEnd(40)} mejor puntaje ${best.toFixed(3)}`);
    }
  }
} finally {
  await extractor.close();
}
