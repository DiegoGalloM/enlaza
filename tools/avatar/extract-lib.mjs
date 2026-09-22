/**
 * Librería de extracción de landmarks Holistic desde videos del repo.
 * Sirve el repo por HTTP local y corre MediaPipe en Edge/Chrome headless vía
 * Playwright (ver extract-page.html). Reutilizable: un solo navegador/servidor
 * para procesar varios videos en tanda.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
};

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

export async function createExtractor({ log = () => {} } = {}) {
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
  const browser = await launchBrowser();

  return {
    /**
     * Extrae landmarks de un video (ruta relativa al repo).
     * `params` extra van a la query de la página (p. ej. rate, sig).
     * `pagePath`: página de extracción (por defecto Holistic, extract-page.html).
     */
    async extract(videoPath, params = {}, pagePath = 'tools/avatar/extract-page.html') {
      const videoRel = path
        .relative(repoRoot, path.resolve(repoRoot, videoPath))
        .replaceAll('\\', '/');
      const query = new URLSearchParams({ video: `/${videoRel}`, ...params });
      const page = await browser.newPage();
      try {
        page.on('console', (msg) => log(`[page] ${msg.text()}`));
        await page.goto(`http://127.0.0.1:${port}/${pagePath}?${query}`);
        await page.waitForFunction(() => window.__done, null, { timeout: 900_000 });
        const error = await page.evaluate(() => window.__error);
        if (error) throw new Error(`Fallo en la página de extracción:\n${error}`);
        return await page.evaluate(() => window.__result);
      } finally {
        await page.close();
      }
    },
    async close() {
      await browser.close();
      server.close();
    },
  };
}
