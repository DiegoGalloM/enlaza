/**
 * Calibración del movimiento de la muñeca en el reconocimiento de señas
 * dinámicas (D36): compara combinaciones de peso DTW y compuerta de cantidad
 * de movimiento en todas las señas de cortesía con plantilla.
 *
 * Uso: npx vite-node tools/content/tune-motion.mjs <peso:fracción[:tolerancia]> [...]
 *   ej: JITTER=0.005 npx vite-node tools/content/tune-motion.mjs 0:0.4 0.5:0.4 0.5:0.4:0.6
 *   tolerancia: de lugar, en altos de cara (D37); sin ella, la de cv-model.
 *
 * Por cada seña y combinación reporta:
 * - la seña real con el detector de la app (cámaras 16:9 y 4:3, a 1×, 0.8× y
 *   1.25×), cortada al fin del tramo registrado en animations.ts;
 * - un frame del centro del tramo sostenido 2.6 s ("mano quieta"), con temblor
 *   gaussiano JITTER (fracción del alto de imagen por frame; el temblor real
 *   medido con la mano quieta equivale a ~0.003);
 * - la seña real con la mano DESPLAZADA respecto a la cara (misma forma y
 *   movimiento, otro lugar: frente a la cara, en el vientre, del otro lado del
 *   pecho), que no debe validar (D37);
 * - falsos positivos contra los videos de las otras señas de cortesía.
 *
 * Requiere los cachés de extracción: los de HandLandmarker los genera
 * diagnose-practice.mjs <signId>; los de Holistic, verify-template.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { SessionValidator } from '../../packages/cv-model/src/index.ts';
import { signAnimationFor } from '../../apps/web/src/avatar/animations.ts';
import { appHandedness, chooseHand, faceFromBox, videoAspect } from './common.mjs';

const CACHE = 'content/ical-2026-09/raw-content/cache';
/** Videos de cortesía en el orden de la lección lsc-cortesia (catalog.ts). */
const COURTESY = [
  'buenos-dias', 'buenas-tardes', 'buenas-noches', 'gracias', 'por-favor',
  'hola', 'con-mucho-gusto', 'lo-siento', 'como-estas', 'permiso',
];
const JITTER = Number(process.env.JITTER ?? 0);

const bundle = JSON.parse(fs.readFileSync('apps/web/public/templates/lsc-bundled.json', 'utf8'));
const load = (name) => JSON.parse(fs.readFileSync(path.join(CACHE, name), 'utf8'));

function run(target, events, combo) {
  const [motionWeight, minMotionRatio, locationTolerance] = combo.split(':').map(Number);
  const validator = new SessionValidator(target, 'dynamic', bundle.templates, {
    motionWeight,
    minMotionRatio,
    ...(Number.isFinite(locationTolerance) ? { locationTolerance } : {}),
  });
  let best = 0;
  let ok = false;
  for (const e of events) {
    const verdict = e ? validator.feed(e) : validator.feedEmpty();
    if (verdict.best?.signId === target) best = Math.max(best, verdict.best.score);
    if (verdict.status === 'correct') ok = true;
  }
  return { ok, best };
}

/**
 * Frames de HandLandmarker como cámara, con velocidad y corte; luego la mano
 * sale de cuadro. `shift` = [dx, dy] desplaza la mano (no la cara), en altos
 * de cara: la misma seña hecha en otro lugar.
 */
function cameraEvents(result, speed, cut, shift = [0, 0]) {
  const aspect = result.cropW / result.height;
  const events = result.frames
    .filter((f) => f.t <= cut)
    .map((f) => {
      if (!f.landmarks) return null;
      const face = faceFromBox(f.face);
      const h = face?.height ?? 0;
      return {
        landmarks: f.landmarks.map((p) => ({ x: p.x + (shift[0] * h) / aspect, y: p.y + shift[1] * h, z: p.z })),
        handedness: f.handedness,
        timestampMs: (f.t * 1000) / speed,
        aspect,
        face,
      };
    });
  return [...events, ...Array.from({ length: 25 }, () => null)];
}

let seed = 7;
const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const gauss = () => Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());

/** Un frame sostenido con temblor: toda la mano se desplaza al azar en cada frame. */
function stillEvents(result, at) {
  const aspect = result.cropW / result.height;
  const frame = result.frames.reduce((a, x) =>
    x.landmarks && Math.abs(x.t - at) < Math.abs(a.t - at) ? x : a,
  );
  return Array.from({ length: 80 }, (_, i) => {
    const dx = gauss() * JITTER;
    const dy = gauss() * JITTER;
    return {
      landmarks: frame.landmarks.map((p) => ({ x: p.x + dx, y: p.y + dy, z: p.z })),
      handedness: frame.handedness,
      timestampMs: i * 33,
      aspect,
      face: faceFromBox(frame.face),
    };
  });
}

/** Frames de Holistic de otro video, con la etiqueta de mano de la app. */
function holisticEvents(result) {
  const side = chooseHand(result.frames);
  const aspect = videoAspect(result);
  return result.frames.map((f) => {
    const lm = f[`${side}Hand`];
    return lm
      ? {
          landmarks: lm.map(([x, y, z]) => ({ x, y, z })),
          handedness: appHandedness(side),
          timestampMs: f.t * 1000,
          aspect,
          face: faceFromBox(f.face),
        }
      : null;
  });
}

const combos = process.argv.slice(2);
if (combos.length === 0) throw new Error('Uso: tune-motion.mjs <peso:fracción[:tolerancia]> [...]');

/** Desplazamientos de la mano en altos de cara (x hacia el lado de la mano, y hacia abajo). */
const SHIFTS = {
  'arriba 1.2 (cara)': [0, -1.2],
  'abajo 1.2 (vientre)': [0, 1.2],
  'lado 1.2': [1.2, 0],
  'lado 0.8': [0.8, 0],
};

for (const template of bundle.templates.filter((t) => t.type === 'dynamic')) {
  const index = Number(/^lsc-cortesia-(\d+)$/.exec(template.signId)?.[1]);
  const slug = COURTESY[index];
  const window = signAnimationFor(template.signId)?.window;
  if (!slug || !window) continue;
  const cameras = {
    '16:9': load(`${slug}.handlandmarker.json`),
    '4:3': load(`${slug}.handlandmarker-4x3.json`),
  };
  console.log(`\n${template.signId} (${slug}), temblor ${JITTER}`);
  console.log(
    'peso:fracción[:tol] | seña 16:9 (1× / 0.8× / 1.25×) | seña 4:3 (1× / 0.8× / 1.25×) | mano quieta | ' +
      `otro lugar (${Object.keys(SHIFTS).join(' / ')}) | falsos positivos`,
  );
  for (const combo of combos) {
    const real = Object.values(cameras).map((camera) =>
      [1, 0.8, 1.25]
        .map((speed) => {
          const r = run(template.signId, cameraEvents(camera, speed, window[1]), combo);
          return `${r.ok ? 'sí' : 'NO'} ${r.best.toFixed(2)}`;
        })
        .join(' / '),
    );
    const still = run(template.signId, stillEvents(cameras['16:9'], (window[0] + window[1]) / 2), combo);
    const moved = Object.values(SHIFTS)
      .map((shift) => {
        const r = run(template.signId, cameraEvents(cameras['16:9'], 1, window[1], shift), combo);
        return `${r.ok ? 'VALIDA' : 'no'} ${r.best.toFixed(2)}`;
      })
      .join(' / ');
    let falsePositives = 0;
    let highest = 0;
    for (const other of COURTESY.filter((s) => s !== slug)) {
      const r = run(template.signId, holisticEvents(load(`${other}.json`)), combo);
      if (r.ok) falsePositives++;
      highest = Math.max(highest, r.best);
    }
    console.log(
      `${combo.padEnd(13)} | ${real[0].padEnd(29)} | ${real[1].padEnd(28)} | ` +
        `${(still.ok ? 'VALIDA ' : 'no     ') + still.best.toFixed(2)} | ${moved} | ` +
        `${falsePositives} (máx ${highest.toFixed(2)})`,
    );
  }
}
