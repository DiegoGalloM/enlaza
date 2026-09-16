/**
 * Extrae landmarks de MediaPipe Holistic Landmarker de un video mp4 a JSON.
 *
 * Uso: node tools/avatar/extract-landmarks.mjs <video> <salida.json> [--rate=0.0625]
 *   ej: node tools/avatar/extract-landmarks.mjs content/ical-2026-09/hola.mp4 \
 *         apps/web/public/avatar/hola.landmarks.json
 * Registra la seña en apps/web/src/avatar/animations.ts para que la lección
 * la muestre.
 *
 * --rate: velocidad de reproducción durante la extracción. Mientras más baja,
 * más frames del video alcanzan a pasar por la detección (~230 ms/frame en
 * CPU). 0.0625 es el mínimo que acepta Chromium; con él se capturan prácticamente todos los
 * frames del video (~30 fps) en vez de ~14 fps con el 0.15 de la página.
 *
 * Corre en Edge/Chrome headless vía Playwright (mismo stack que los e2e).
 * Requiere red (WASM y modelo .task vienen de CDN, igual que en la app).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createExtractor, repoRoot } from './extract-lib.mjs';

const args = process.argv.slice(2);
const [videoArg, outArg] = args.filter((a) => !a.startsWith('--'));
const rate = args.find((a) => a.startsWith('--rate='))?.split('=')[1] ?? '0.0625';
if (!videoArg || !outArg) {
  console.error('Uso: node tools/avatar/extract-landmarks.mjs <video> <salida.json> [--rate=0.0625]');
  process.exit(1);
}

const extractor = await createExtractor();
try {
  console.log(`Procesando ${videoArg}...`);
  const result = await extractor.extract(videoArg, { rate });
  const outFile = path.resolve(repoRoot, outArg);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result));

  const withPose = result.frames.filter((f) => f.poseWorld).length;
  const withHand = result.frames.filter((f) => f.leftHand || f.rightHand).length;
  console.log(
    `OK: ${result.frames.length} frames (${result.duration}s) → ${outArg}\n` +
      `  pose detectada en ${withPose}, mano(s) en ${withHand}`,
  );
} finally {
  await extractor.close();
}
