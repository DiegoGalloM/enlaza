/**
 * Extrae landmarks de MediaPipe Holistic Landmarker de un video mp4 a JSON.
 *
 * Uso: node tools/avatar/extract-landmarks.mjs <video> <salida.json>
 *   ej: node tools/avatar/extract-landmarks.mjs content/ical-2026-09/hola.mp4 \
 *         apps/web/public/avatar-poc/hola.landmarks.json
 *
 * Corre en Edge/Chrome headless vía Playwright (mismo stack que los e2e).
 * Requiere red (WASM y modelo .task vienen de CDN, igual que en la app).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createExtractor, repoRoot } from './extract-lib.mjs';

const [videoArg, outArg] = process.argv.slice(2);
if (!videoArg || !outArg) {
  console.error('Uso: node tools/avatar/extract-landmarks.mjs <video> <salida.json>');
  process.exit(1);
}

const extractor = await createExtractor();
try {
  console.log(`Procesando ${videoArg}...`);
  const result = await extractor.extract(videoArg);
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
