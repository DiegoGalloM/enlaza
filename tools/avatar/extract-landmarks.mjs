/**
 * Extrae landmarks de MediaPipe Holistic Landmarker de un video mp4 a JSON.
 *
 * Uso: node tools/avatar/extract-landmarks.mjs <video> <salida.json> [fps]
 *   ej: node tools/avatar/extract-landmarks.mjs content/ical-2026-09/hola.mp4 \
 *         apps/web/public/avatar-poc/hola.landmarks.json 30
 *
 * Corre en Chromium/Edge headless vía Playwright (mismo stack que los e2e):
 * sirve el repo por HTTP local, carga extract-page.html y esta ejecuta el
 * landmarker sobre el video. Requiere red (WASM y modelo .task vienen de CDN,
 * igual que en la app). El Chromium empaquetado de Playwright no trae códecs
 * H.264, así que se prefiere Edge/Chrome del sistema.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [videoArg, outArg, fpsArg] = process.argv.slice(2);
if (!videoArg || !outArg) {
  console.error('Uso: node tools/avatar/extract-landmarks.mjs <video> <salida.json> [fps]');
  process.exit(1);
}
const videoRel = path.relative(repoRoot, path.resolve(repoRoot, videoArg)).replaceAll('\\', '/');
const fps = Number(fpsArg ?? 30);

const MIME = {
  '.html': 'text/html',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(repoRoot, urlPath);
  if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

async function launchBrowser() {
  // Edge/Chrome del sistema primero (códecs H.264); Chromium de Playwright de último recurso.
  for (const channel of ['msedge', 'chrome', undefined]) {
    try {
      return await chromium.launch({ channel });
    } catch {
      /* canal no instalado: probar el siguiente */
    }
  }
  throw new Error('No se pudo lanzar ningún navegador');
}

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  page.on('console', (msg) => console.log(`[page] ${msg.text()}`));
  const url = `http://127.0.0.1:${port}/tools/avatar/extract-page.html?video=/${videoRel}&fps=${fps}`;
  console.log(`Procesando ${videoRel} a ${fps} fps...`);
  await page.goto(url);
  await page.waitForFunction(() => window.__done, null, { timeout: 300_000 });

  const error = await page.evaluate(() => window.__error);
  if (error) throw new Error(`Fallo en la página de extracción:\n${error}`);

  const result = await page.evaluate(() => window.__result);
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
  await browser.close();
  server.close();
}
