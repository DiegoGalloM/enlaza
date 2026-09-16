/**
 * Captura una tira de frames del avatar en /avatar-poc para comparar cambios
 * de animación y render (antes/después) sin depender de un video.
 *
 * Uso: node tools/avatar/capture-frames.mjs <url> <carpeta-salida> [n] [cadaMs]
 *   ej: node tools/avatar/capture-frames.mjs http://localhost:5173/avatar-poc capturas/antes
 *
 * El escenario se fuerza a 320 px de alto (el tamaño del panel en la lección)
 * y deviceScaleFactor 1 (pantalla sin escalado): es el peor caso de nitidez.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const [url, outDir, nArg, stepArg] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('Uso: node tools/avatar/capture-frames.mjs <url> <carpeta-salida> [n] [cadaMs]');
  process.exit(1);
}
const n = Number(nArg ?? 8);
const stepMs = Number(stepArg ?? 350);

let browser;
for (const channel of ['msedge', 'chrome', undefined]) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {
    /* canal no instalado */
  }
}
const page = await browser.newPage({ viewport: { width: 640, height: 720 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.addStyleTag({ content: 'canvas[data-status]{height:320px!important}' });
await page.waitForSelector('canvas[data-status="listo"]', { timeout: 60_000 });
await page.waitForTimeout(1500);
fs.mkdirSync(outDir, { recursive: true });
const canvas = page.locator('canvas[data-status]');
for (let i = 0; i < n; i++) {
  await canvas.screenshot({ path: path.join(outDir, `frame-${String(i).padStart(2, '0')}.png`) });
  await page.waitForTimeout(stepMs);
}
await browser.close();
console.log(`${n} frames → ${outDir}`);
