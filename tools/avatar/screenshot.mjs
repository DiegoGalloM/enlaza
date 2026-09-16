import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:5173/avatar-poc';
const out = process.argv[3] ?? 'avatar-poc.png';
const waitMs = Number(process.argv[4] ?? 6000);

let browser;
for (const channel of ['msedge', 'chrome', undefined]) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {}
}
const page = await browser.newPage({ viewport: { width: 800, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text());
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(waitMs);
await page.screenshot({ path: out });
await browser.close();
console.log('screenshot:', out);
