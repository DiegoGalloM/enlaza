/**
 * Prueba de estrés de una seña dinámica: ¿valida hecha como la haría alguien
 * que aprende, no solo idéntica al video de referencia? ¿Y sigue sin validar
 * lo que no es la seña?
 *
 * Uso: npx vite-node tools/content/stress-sign.mjs [signId]   (por defecto Gracias)
 *
 * Parte de los frames del MISMO HandLandmarker de la app con dos manos (caché
 * *.hands2.json que genera diagnose-practice.mjs) y los pasa por
 * SessionValidator.feedHands, como la pantalla de práctica. A cada escenario le
 * agrega temblor de detector (JITTER, fracción del alto de imagen; ~0.003 es el
 * medido con la mano quieta) y reporta el mejor puntaje con su desglose:
 * forma × lugar × movimiento, y la ventana que lo dio.
 * --antes: compara la forma como antes de D39 (vector crudo, sin separar la
 * orientación), para medir el cambio.
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../avatar/extract-lib.mjs';
import { SessionValidator } from '../../packages/cv-model/src/index.ts';
import { signAnimationFor } from '../../apps/web/src/avatar/animations.ts';
import { faceFromBox } from './common.mjs';

const signId = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'lsc-cortesia-3';
const JITTER = Number(process.env.JITTER ?? 0.003);
/** --antes: forma comparada con el vector crudo, como antes de D39 (para medir el cambio). */
const BEFORE = process.argv.includes('--antes');
const CACHE = path.join(repoRoot, 'content', 'ical-2026-09', 'raw-content', 'cache');
const SLUGS = { 'lsc-cortesia-3': 'gracias', 'lsc-cortesia-4': 'por-favor', 'lsc-cortesia-5': 'hola' };

const bundle = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'apps/web/public/templates/lsc-bundled.json'), 'utf8'),
);
const template = bundle.templates.find((t) => t.signId === signId);
if (!template) throw new Error(`Sin plantilla para ${signId}`);

function load(slug, suffix = '') {
  const file = path.join(CACHE, `${slug}.hands2${suffix}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Falta ${path.relative(repoRoot, file)}: corre diagnose-practice.mjs para esa seña`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Ruido determinista (mulberry32 + Box-Muller) para que las corridas se puedan comparar.
let seed = 7;
function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function gauss() {
  return Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Construye la línea de tiempo de un escenario a partir de los frames del video.
 * `plan`: lista de tramos [desde s, hasta s, duración en s] del video; un tramo
 * con desde == hasta sostiene ese frame. `shift(tVideo)` = [dx, dy] en altos de
 * cara que se suman a las MANOS (no a la cara): mueve el lugar de la seña.
 */
function build(result, plan, shift = () => [0, 0], { mod, fps = 30, jitter = JITTER, mirror = false } = {}) {
  const aspect = result.cropW / result.height;
  const frames = result.frames;
  const at = (t) => frames.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  const events = [];
  let clock = 0;
  for (const [from, to, dur] of plan) {
    const steps = Math.max(1, Math.round(dur * fps));
    for (let k = 0; k < steps; k++) {
      const tVideo = from + ((to - from) * k) / steps;
      const f = at(tVideo);
      let face = faceFromBox(f.face);
      const [dx, dy] = shift(tVideo);
      const fh = face?.height ?? 0.2;
      const noise = () => gauss() * jitter;
      let hands = f.hands.map((h) => ({
        handedness: h.handedness,
        landmarks: (mod && h.handedness === template.hand ? mod(h.landmarks, tVideo, aspect) : h.landmarks).map(
          (p) => ({
            x: p.x + (dx * fh) / aspect + noise() / aspect,
            y: p.y + dy * fh + noise(),
            z: p.z,
          }),
        ),
      }));
      if (mirror) {
        // Cámara que entrega la imagen espejada: MediaPipe ve la mano derecha como izquierda.
        hands = hands.map((h) => ({
          handedness: h.handedness === 'Left' ? 'Right' : 'Left',
          landmarks: h.landmarks.map((p) => ({ ...p, x: 1 - p.x })),
        }));
        if (face) face = { ...face, x: 1 - face.x };
      }
      events.push({
        hands,
        timestampMs: clock * 1000,
        aspect,
        ...(face ? { face } : {}),
      });
      clock += dur / steps;
    }
  }
  // La mano sale de cuadro al final.
  for (let k = 0; k < 20; k++) events.push({ hands: [], timestampMs: (clock + k / 30) * 1000, aspect });
  return events;
}

function replay(target, events) {
  const validator = new SessionValidator(target, 'dynamic', bundle.templates, {
    rotationTolerant: !BEFORE,
  });
  let best = null;
  let validated = false;
  for (const e of events) {
    const verdict = validator.feedHands(e.hands.length > 0 ? e : null);
    if (verdict.target && (!best || verdict.target.score > best.score)) best = verdict.target;
    if (verdict.status === 'correct') validated = true;
  }
  // Tras validar el validador deja de clasificar: el mejor puntaje visto es el que validó.
  return { validated, best };
}

function fmt({ validated, best }) {
  if (!best) return 'sin evaluar';
  const d = best.detail ?? {};
  const loc = d.locationError === undefined ? '   –   ' : `${d.locationFactor.toFixed(2)}(${d.locationError.toFixed(2)})`;
  const mov = d.motionRatio === undefined ? '   –   ' : `${d.motionFactor.toFixed(2)}(${d.motionRatio.toFixed(2)})`;
  const rot = d.orientationDeg === undefined ? '' : ` rot ${d.orientationDeg.toFixed(0)}°`;
  const off = d.locationOffset ? ` desp (${d.locationOffset.map((v) => v.toFixed(2)).join(', ')})` : '';
  return (
    `${validated ? 'VALIDA' : 'no    '} ${best.score.toFixed(3)} = forma ${d.shape?.toFixed(3)} × lugar ${loc} × mov ${mov}${rot}${off}` +
    (d.windowMs ? ` ventana ${(d.windowMs / 1000).toFixed(2)} s` : '')
  );
}

/**
 * Variaciones de la mano de la seña, en coordenadas cuadradas (x·proporción),
 * alrededor de la muñeca: lo que cambia de una persona a otra.
 */
function transform(fn) {
  return (landmarks, t, aspect) => {
    const w = landmarks[0];
    const sq = landmarks.map((p) => [(p.x - w.x) * aspect, p.y - w.y, (p.z - w.z) * aspect]);
    return fn(sq, t).map(([x, y, z]) => ({ x: w.x + x / aspect, y: w.y + y, z: w.z + z / aspect }));
  };
}
const deg = (d) => (d * Math.PI) / 180;
/** Rota en el plano de la imagen (la mano se inclina hacia un lado). */
const inPlane = (d, when = () => true) =>
  transform((pts, t) => (when(t) ? pts.map(([x, y, z]) => [x * Math.cos(deg(d)) - y * Math.sin(deg(d)), x * Math.sin(deg(d)) + y * Math.cos(deg(d)), z]) : pts));
/** Gira alrededor del eje vertical (la palma mira más a un lado). */
const yaw = (d) => transform((pts) => pts.map(([x, y, z]) => [x * Math.cos(deg(d)) + z * Math.sin(deg(d)), y, -x * Math.sin(deg(d)) + z * Math.cos(deg(d))]));
/** Gira 180° alrededor del eje muñeca→nudillo medio: la palma mira al lado contrario. */
const flipPalm = (when) =>
  transform((pts, t) => {
    if (!when(t)) return pts;
    const [ax, ay, az] = pts[9];
    const n = Math.hypot(ax, ay, az) || 1;
    const u = [ax / n, ay / n, az / n];
    // Rodrigues con 180°: p' = 2(u·p)u − p
    return pts.map((p) => {
      const d = 2 * (u[0] * p[0] + u[1] * p[1] + u[2] * p[2]);
      return [d * u[0] - p[0], d * u[1] - p[1], d * u[2] - p[2]];
    });
  });
/** Dedos relajados: las puntas y falanges se acercan a los nudillos. */
const relaxed = (k) =>
  transform((pts) =>
    pts.map((p, i) => {
      const finger = [[5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]].find((f) => f.includes(i));
      if (!finger || i === finger[0]) return p;
      const base = pts[finger[0]];
      const frac = (finger.indexOf(i) / 3) * k;
      return p.map((v, j) => v + (base[j] - v) * frac);
    }),
  );
/** Pulgar abierto: se separa de la palma en el plano de la imagen. */
const thumbOut = (d) =>
  transform((pts) => {
    const c = pts[1];
    return pts.map((p, i) => {
      if (i < 2 || i > 4) return p;
      const [x, y] = [p[0] - c[0], p[1] - c[1]];
      return [c[0] + x * Math.cos(deg(d)) - y * Math.sin(deg(d)), c[1] + x * Math.sin(deg(d)) + y * Math.cos(deg(d)), p[2]];
    });
  });

const [from, to] = signAnimationFor(signId)?.window ?? [0, Infinity];
const slug = SLUGS[signId];
const own = { '16:9': load(slug), '4:3': load(slug, '-4x3') };
const lastT = (r) => r.frames[r.frames.length - 1].t;
const sign = (speed = 1) => [[from, to, (to - from) / speed]];
const ramp = (a, b, value) => (t) => Math.min(1, Math.max(0, (t - a) / (b - a))) * value;

console.log(
  `${signId}: umbral 0.60, ventana de la plantilla ${template.sourceMs} ms, tramo ${from}–${to} s, ` +
    `mano ${template.hand ?? 'sin registrar'}, temblor ${JITTER}\n` +
    `Formato: VALIDA puntaje = forma × lugar factor(error en altos de cara) × mov factor(proporción)\n`,
);

for (const [camera, result] of Object.entries(own)) {
  const mid = (from + to) / 2;
  const end = Math.min(to, lastT(result));
  // Fin del contacto y apoyo según animations.ts de Gracias; para otras señas, tercios del tramo.
  const contactEnd = signId === 'lsc-cortesia-3' ? 1.17 : from + (to - from) / 3;
  const restStart = signId === 'lsc-cortesia-3' ? 1.42 : from + (2 * (to - from)) / 3;
  const scenarios = [
    ['video completo', [[0, lastT(result), lastT(result)]]],
    ['solo la seña, 1×', sign()],
    ['solo la seña, 0.8×', sign(0.8)],
    ['solo la seña, 0.6× (aprendiz)', sign(0.6)],
    ['solo la seña, 0.5× (muy lento)', sign(0.5)],
    ['solo la seña, 1.25×', sign(1.25)],
    ['sube la mano a la boca y hace la seña', [[0, to, to]]],
    ['sostiene el apoyo 1.5 s', [...sign(), [end, end, 1.5]]],
    ['sostiene el apoyo 3 s', [...sign(), [end, end, 3]]],
    ['sostiene la boca 1 s antes de bajar', [[from, from, 1], ...sign()]],
    ['contacto breve (0.15 s) y baja', [[contactEnd - 0.15, contactEnd, 0.15], [contactEnd, to, to - contactEnd]]],
    ['apoyo 0.5 cara más abajo', sign(), (t) => [0, ramp(contactEnd, restStart, 0.5)(t)]],
    ['apoyo 1.0 cara más abajo (ombligo)', sign(), (t) => [0, ramp(contactEnd, restStart, 1.0)(t)]],
    ['toda la seña centrada (+0.4 cara en x)', sign(), () => [0.4, 0]],
    ['mano inclinada 15° en la imagen', sign(), undefined, { mod: inPlane(15) }],
    ['mano inclinada -15° en la imagen', sign(), undefined, { mod: inPlane(-15) }],
    ['mano inclinada 30° en la imagen', sign(), undefined, { mod: inPlane(30) }],
    ['mano inclinada -30° en la imagen', sign(), undefined, { mod: inPlane(-30) }],
    ['palma girada 30° (eje vertical)', sign(), undefined, { mod: yaw(30) }],
    ['palma girada -30° (eje vertical)', sign(), undefined, { mod: yaw(-30) }],
    ['en la boca, dedos de lado (+30° solo ahí)', sign(), undefined, { mod: inPlane(30, (t) => t < contactEnd) }],
    ['apoyo con la palma ABAJO (palma con palma)', sign(), undefined, { mod: flipPalm((t) => t >= restStart) }],
    ['dedos relajados (30%)', sign(), undefined, { mod: relaxed(0.3) }],
    ['pulgar abierto 30°', sign(), undefined, { mod: thumbOut(30) }],
    ['cámara a 12 cuadros por segundo', sign(), undefined, { fps: 12 }],
    ['temblor alto (0.008)', sign(), undefined, { jitter: 0.008 }],
    ['cámara espejada', sign(), undefined, { mirror: true }],
    ['mano quieta en el apoyo 3 s (NO debe validar)', [[end, end, 3]]],
    ['mano quieta en la boca 3 s (NO debe validar)', [[mid - 0.3, mid - 0.3, 3]]],
  ];
  console.log(`Cámara ${camera}:`);
  for (const [label, plan, shift, opts] of scenarios) {
    console.log(`  ${label.padEnd(46)} ${fmt(replay(signId, build(result, plan, shift, opts)))}`);
  }
}

console.log('\nFalsos positivos (otra seña hecha, esta seña como objetivo; NO debe validar):');
for (const [otherId, otherSlug] of Object.entries(SLUGS)) {
  if (otherId === signId) continue;
  const result = load(otherSlug);
  const [a, b] = signAnimationFor(otherId)?.window ?? [0, lastT(result)];
  for (const [label, plan] of [
    ['video completo', [[0, lastT(result), lastT(result)]]],
    ['solo su tramo', [[a, b, b - a]]],
    ['su tramo a 0.6×', [[a, b, (b - a) / 0.6]]],
  ]) {
    console.log(`  ${`${otherSlug}: ${label}`.padEnd(46)} ${fmt(replay(signId, build(result, plan)))}`);
  }
}
console.log('\nEsta seña con otra como objetivo (NO debe validar):');
for (const [otherId, otherSlug] of Object.entries(SLUGS)) {
  if (otherId === signId) continue;
  console.log(`  objetivo ${otherSlug.padEnd(37)} ${fmt(replay(otherId, build(own['16:9'], [[0, lastT(own['16:9']), lastT(own['16:9'])]])))}`);
}
