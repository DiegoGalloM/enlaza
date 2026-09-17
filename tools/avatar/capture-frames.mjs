/**
 * Captura una tira de frames del avatar en /avatar-poc para comparar cambios
 * de animación y render (antes/después) sin depender de un video.
 *
 * Uso: node tools/avatar/capture-frames.mjs <url> <carpeta-salida> [opciones]
 *   --n=8 --cadaMs=350     frames con la animación corriendo (por defecto)
 *   --tiempos=0.2,0.6,1.4  en su lugar, congela la seña en esos segundos (?t=)
 *   --alto=320             alto del canvas en px (320 = panel de la lección)
 *   --escala=1             deviceScaleFactor (1 = peor caso de nitidez)
 *   ej: node tools/avatar/capture-frames.mjs http://localhost:5173/avatar-poc capturas/antes
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const [url, outDir] = args.filter((a) => !a.startsWith('--'));
const opt = (name, fallback) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
if (!url || !outDir) {
  console.error('Uso: node tools/avatar/capture-frames.mjs <url> <carpeta-salida> [opciones]');
  process.exit(1);
}
const n = Number(opt('n', 8));
const stepMs = Number(opt('cadaMs', 350));
const times = opt('tiempos', null)?.split(',').map(Number);
const height = Number(opt('alto', 320));
const scale = Number(opt('escala', 1));

let browser;
for (const channel of ['msedge', 'chrome', undefined]) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {
    /* canal no instalado */
  }
}
const page = await browser.newPage({
  viewport: { width: 640, height: height + 400 },
  deviceScaleFactor: scale,
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
fs.mkdirSync(outDir, { recursive: true });
const file = (i) => path.join(outDir, `frame-${String(i).padStart(2, '0')}.png`);

async function open(target) {
  await page.goto(target);
  await page.addStyleTag({ content: `canvas[data-status]{height:${height}px!important}` });
  await page.waitForSelector('canvas[data-status="listo"]', { timeout: 60_000 });
  return page.locator('canvas[data-status]');
}

if (times) {
  for (const [i, t] of times.entries()) {
    const target = new URL(url);
    target.searchParams.set('t', String(t));
    const canvas = await open(target.href);
    await page.waitForTimeout(2500); // que el pelo se asiente en la pose congelada
    await canvas.screenshot({ path: file(i) });
  }
} else {
  const canvas = await open(url);
  await page.waitForTimeout(1500);
  for (let i = 0; i < n; i++) {
    await canvas.screenshot({ path: file(i) });
    await page.waitForTimeout(stepMs);
  }
}
await browser.close();
console.log(`${times?.length ?? n} frames → ${outDir}`);
