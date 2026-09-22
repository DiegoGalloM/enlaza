/**
 * Mide qué tan suave es la animación del avatar, hueso por hueso, para
 * comparar cambios con números y no solo a ojo.
 *
 * Uso: node tools/avatar/measure-smoothness.mjs [url]
 *   (por defecto http://localhost:5173/avatar-poc; requiere `npm run dev`)
 *
 * Muestrea un ciclo completo a 120 Hz con el gancho de desarrollo
 * window.__enlazaAvatar (SignAvatar.tsx) y reporta por hueso:
 * - maxVel: velocidad angular máxima (rad/s);
 * - meanAcc / maxAcc: cambio de velocidad promedio y máximo (rad/s²). Un
 *   maxAcc aislado muy alto es un tirón; su instante (@) dice dónde buscarlo
 *   (p. ej. el cierre del bucle al final del ciclo).
 */
import { chromium } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:5173/avatar-poc';
const BONES = [
  'rightUpperArm', 'rightLowerArm', 'rightHand',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightMiddleProximal',
  'rightRingProximal', 'rightLittleProximal',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'head',
];

let browser;
for (const channel of ['msedge', 'chrome', undefined]) {
  try {
    browser = await chromium.launch({ channel });
    break;
  } catch {
    /* canal no instalado */
  }
}
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${url}${url.includes('?') ? '&' : '?'}t=0`);
await page.waitForFunction(() => window.__enlazaAvatar, null, { timeout: 60_000 });

const report = await page.evaluate((names) => {
  const { player, vrm } = window.__enlazaAvatar;
  const hz = 120;
  const n = Math.round(player.duration * hz);
  const nodes = names.map((name) => vrm.humanoid.getNormalizedBoneNode(name));
  const samples = names.map(() => []);
  for (let k = 0; k <= n; k++) {
    player.update(k / hz);
    nodes.forEach((node, i) => samples[i].push(node.quaternion.clone()));
  }
  return {
    duration: player.duration,
    rows: names.map((name, i) => {
      const q = samples[i];
      const vel = q.slice(1).map((qk, k) => qk.angleTo(q[k]) * hz);
      let sum = 0;
      let max = 0;
      let at = 0;
      for (let k = 1; k < vel.length; k++) {
        const acc = Math.abs(vel[k] - vel[k - 1]) * hz;
        sum += acc;
        if (acc > max) {
          max = acc;
          at = k / hz;
        }
      }
      return { name, maxVel: Math.max(...vel), meanAcc: sum / vel.length, maxAcc: max, at };
    }),
  };
}, BONES);
await browser.close();

console.log(`Ciclo: ${report.duration.toFixed(2)} s`);
for (const r of report.rows) {
  console.log(
    `${r.name.padEnd(24)} maxVel ${r.maxVel.toFixed(1).padStart(5)} rad/s  ` +
      `meanAcc ${r.meanAcc.toFixed(0).padStart(4)}  maxAcc ${r.maxAcc.toFixed(0).padStart(4)} @${r.at.toFixed(2)}s`,
  );
}
