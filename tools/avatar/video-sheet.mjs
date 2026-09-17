/**
 * Hoja de contactos de un video de referencia: un cuadro cada `--cada`
 * segundos con su tiempo, para decidir a ojo qué tramo es la seña (el
 * `window` de apps/web/src/avatar/animations.ts). Qué es la seña es una
 * decisión lingüística, no un umbral numérico: esta hoja es la evidencia.
 *
 * Uso: node tools/avatar/video-sheet.mjs <video> <salida.png> [--cada=0.1] [--columnas=8] [--ancho=230] [--desde=0] [--hasta=∞] [--recorte=x,y,w,h]
 *   ej: node tools/avatar/video-sheet.mjs content/ical-2026-09/por-favor.mp4 hoja.png
 *
 * Reproduce a 0.0625× y toma cuadros con requestVideoFrameCallback (los mp4
 * de referencia no permiten seek preciso, ver extract-page.html).
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { repoRoot } from './extract-lib.mjs';

const args = process.argv.slice(2);
const [videoArg, outArg] = args.filter((a) => !a.startsWith('--'));
const opt = (name, fallback) =>
  Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
if (!videoArg || !outArg) {
  console.error('Uso: node tools/avatar/video-sheet.mjs <video> <salida.png> [--cada=0.1] [--columnas=8] [--ancho=230] [--desde=0] [--hasta=∞] [--recorte=x,y,w,h]');
  process.exit(1);
}
const every = opt('cada', 0.1);
const columns = opt('columnas', 8);
const cellWidth = opt('ancho', 230);
const from = opt('desde', 0);
const to = opt('hasta', Infinity);
// Recorte en fracciones del cuadro (p. ej. 0.3,0.4,0.4,0.6 para acercar la mano).
const crop = (args.find((a) => a.startsWith('--recorte='))?.split('=')[1] ?? '0,0,1,1')
  .split(',')
  .map(Number);

const server = http.createServer((req, res) => {
  // La hoja se arma en una página del mismo origen que el video, para que el
  // canvas no quede "contaminado" por origen cruzado.
  if (new URL(req.url, 'http://x').pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      `<body style="margin:0;background:#fff"><div id="g" style="display:grid;` +
        `grid-template-columns:repeat(${columns},${cellWidth}px);gap:2px;font:12px sans-serif"></div></body>`,
    );
    return;
  }
  const file = path.join(repoRoot, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(repoRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return res.writeHead(404).end();
  }
  res.writeHead(200, { 'Content-Type': 'video/mp4' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

let browser;
for (const channel of ['msedge', 'chrome', undefined]) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {
    /* canal no instalado */
  }
}
try {
  const page = await browser.newPage({ viewport: { width: columns * (cellWidth + 2), height: 50 } });
  await page.goto(`${origin}/`);
  const videoRel = path.relative(repoRoot, path.resolve(repoRoot, videoArg)).replaceAll('\\', '/');
  const duration = await page.evaluate(
    async ({ src, every, from, to, crop, cellWidth }) => {
      const v = document.createElement('video');
      v.src = src;
      v.muted = true;
      await new Promise((resolve) => (v.onloadeddata = resolve));
      v.playbackRate = 0.0625;
      await v.play();
      const grid = document.getElementById('g');
      let last = -Infinity;
      await new Promise((resolve) => {
        const onFrame = (_now, meta) => {
          const t = meta.mediaTime;
          if (t >= from && t <= to && t - last >= every - 0.001) {
            last = t;
            const [cx, cy, cw, ch] = crop;
            const sw = v.videoWidth * cw;
            const sh = v.videoHeight * ch;
            const c = document.createElement('canvas');
            c.width = cellWidth;
            c.height = Math.round((cellWidth * sh) / sw);
            c.getContext('2d').drawImage(
              v, v.videoWidth * cx, v.videoHeight * cy, sw, sh, 0, 0, c.width, c.height,
            );
            const cell = document.createElement('div');
            cell.append(c, document.createTextNode(`${meta.mediaTime.toFixed(2)} s`));
            grid.append(cell);
          }
          if (v.ended) resolve();
          else v.requestVideoFrameCallback(onFrame);
        };
        v.requestVideoFrameCallback(onFrame);
        v.onended = () => setTimeout(resolve, 100);
      });
      return v.duration;
    },
    { src: `${origin}/${videoRel}`, every, from, to, crop, cellWidth },
  );
  await page.screenshot({ path: outArg, fullPage: true });
  console.log(`${videoRel}: ${duration.toFixed(2)} s → ${outArg}`);
} finally {
  await browser.close();
  server.close();
}
