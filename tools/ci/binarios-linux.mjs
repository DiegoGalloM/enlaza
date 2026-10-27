/**
 * Binarios nativos de Linux que faltan en package-lock.json (D50).
 *
 * El lockfile se genera en Windows y, por un bug de npm con dependencias
 * opcionales por plataforma (npm/cli#4828), solo registra los binarios de
 * Windows de oxlint, rolldown y lightningcss. En Linux (CI, hosting) `npm ci`
 * no los instala y lint/build fallan. Regenerar el lockfile cambiaría
 * versiones de otras dependencias; esto baja solo el binario de la MISMA
 * versión que quedó instalada, sin tocar package.json ni el lockfile.
 *
 * Uso (después de `npm ci`, en Linux x64): node tools/ci/binarios-linux.mjs
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.platform !== 'linux' || process.arch !== 'x64') {
  console.log('No es Linux x64: no hace falta.');
  process.exit(0);
}

/** [carpeta del paquete instalado, binario que necesita en Linux x64 (glibc)] */
const NATIVE = [
  ['oxlint', '@oxlint/binding-linux-x64-gnu'],
  ['rolldown', '@rolldown/binding-linux-x64-gnu'],
  ['lightningcss', 'lightningcss-linux-x64-gnu'],
];
const ROOTS = ['node_modules', 'apps/web/node_modules'];

for (const root of ROOTS) {
  for (const [pkg, binding] of NATIVE) {
    const manifest = path.join(root, pkg, 'package.json');
    if (!fs.existsSync(manifest)) continue;
    const { version } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    const target = path.join(root, binding);
    if (fs.existsSync(path.join(target, 'package.json'))) continue;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'binario-'));
    const tgz = execFileSync('npm', ['pack', `${binding}@${version}`, '--silent'], { cwd: tmp })
      .toString()
      .trim()
      .split('\n')
      .pop();
    fs.mkdirSync(target, { recursive: true });
    execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', target, '--strip-components=1']);
    console.log(`${binding}@${version} → ${target}`);
  }
}
