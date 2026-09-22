/**
 * Busca partes del brazo metidas en el cuerpo del avatar, con la misma
 * silueta medida que usa el retargeting (rig.ts: measureBody). Sirve para
 * confirmar con números lo que de frente no se ve (A30, A31).
 *
 * Uso: node tools/avatar/check-contacts.mjs "<url de /avatar-poc?sena=...>" [--lado=right] [--cada=0.1]
 *   (requiere `npm run dev`; usa el gancho window.__enlazaAvatar de SignAvatar.tsx)
 *
 * Por instante reporta dónde está el codo y la muñeca y la penetración máxima
 * (en metros) del último cuarto del brazo (holgura 1.5 cm) y del antebrazo
 * (holgura 4 cm), las mismas de retarget.ts. Hasta ~0.01 m es el roce normal
 * de la manga con el costado; más que eso se ve como brazo dentro de la camisa.
 */
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
if (!url) {
  console.error('Uso: node tools/avatar/check-contacts.mjs "<url>" [--lado=right] [--cada=0.1]');
  process.exit(1);
}
const side = opt('lado', 'right');
const every = Number(opt('cada', 0.1));

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
await page.goto(url);
await page.waitForSelector('canvas[data-status="listo"]', { timeout: 60_000 });
const rows = await page.evaluate(
  async ({ side, every }) => {
    const { player, vrm, rig } = window.__enlazaAvatar;
    const { bodyPenetration } = await import('/src/avatar/rig.ts');
    const V = rig.position('hips').constructor;
    const at = (bone) => vrm.humanoid.getNormalizedBoneNode(bone).getWorldPosition(new V());
    const fmt = (v) => `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
    const out = [`ciclo ${player.duration.toFixed(2)} s, brazo ${side}`];
    let worstAll = 0;
    for (let t = 0; t < player.duration; t += every) {
      player.update(t);
      vrm.scene.updateMatrixWorld(true);
      const S = at(`${side}UpperArm`);
      const E = at(`${side}LowerArm`);
      const W = at(`${side}Hand`);
      const upper = Math.max(...[0.75, 1].map((s) => bodyPenetration(rig.body, S.clone().lerp(E, s), 0.015)));
      const fore = Math.max(...[0.2, 0.4, 0.6, 0.8, 1].map((s) => bodyPenetration(rig.body, E.clone().lerp(W, s), 0.04)));
      worstAll = Math.max(worstAll, upper, fore);
      out.push(`${t.toFixed(2)} s  codo ${fmt(E)}  muñeca ${fmt(W)}  brazo ${upper.toFixed(3)}  antebrazo ${fore.toFixed(3)}`);
    }
    out.push(`máximo: ${worstAll.toFixed(3)} m`);
    return out;
  },
  { side, every },
);
console.log(rows.join('\n'));
await browser.close();
