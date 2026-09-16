import * as THREE from 'three';

/**
 * Limpieza de la animación ya retargeteada (rotaciones de hueso por muestra),
 * antes de reproducirla. Corresponde al paso "normalizar y limpiar" de
 * docs/propuesta-avatar-lengua-senas.pdf; el porqué de cada parámetro está en
 * docs/AVATAR-DECISIONES.md.
 *
 * Se trabaja sobre rotaciones y no sobre landmarks porque los landmarks de
 * mano vienen en coordenadas centradas en la mano: suavizar posiciones no
 * evita que el ángulo de curl salte, suavizar la rotación resultante sí.
 *
 * Todo es offline sobre el clip completo (74 muestras en Hola): se puede usar
 * un filtro sin retraso (centrado en el tiempo) en vez de uno causal.
 */

/** Una pista por hueso: una rotación por muestra, o null si no hubo detección. */
export type RawTrack = (THREE.Quaternion | null)[];

export interface CleanupOptions {
  /** Huecos interiores de hasta esta duración se interpolan entre vecinos. */
  maxGapSeconds: number;
  /** Duración de la rampa hacia/desde la pose de reposo en huecos largos. */
  restBlendSeconds: number;
  /** Frecuencia de salida uniforme. */
  outFps: number;
  /** Desviación estándar del suavizado gaussiano, por hueso. */
  sigmaSeconds: (bone: string) => number;
  /** Fracción del pico de movimiento bajo la cual se considera quieto. */
  stillFraction: number;
  /** Margen que se conserva antes/después del movimiento al recortar. */
  trimMarginSeconds: number;
  /** Transición del último frame al primero para cerrar el bucle. */
  returnSeconds: number;
  /** Pausa en la pose inicial antes de repetir. */
  holdSeconds: number;
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  maxGapSeconds: 0.3,
  restBlendSeconds: 0.25,
  outFps: 30,
  sigmaSeconds: (bone) => (/Thumb|Index|Middle|Ring|Little/.test(bone) ? 0.05 : 0.035),
  stillFraction: 0.1,
  trimMarginSeconds: 0.12,
  returnSeconds: 0.45,
  holdSeconds: 0.2,
};

/** Clip limpio: muestras uniformes a `fps`, listo para reproducir en bucle. */
export interface CleanClip {
  fps: number;
  frameCount: number;
  tracks: Map<string, THREE.Quaternion[]>;
}

const smoothstep = (x: number) => {
  const c = Math.min(Math.max(x, 0), 1);
  return c * c * (3 - 2 * c);
};

/**
 * Rellena muestras sin detección. Huecos cortos: slerp entre las detecciones
 * vecinas por tiempo real. Huecos largos o en los extremos (p. ej. la mano
 * fuera de cuadro): pose de reposo, con rampas suaves de entrada y salida para
 * que la mano no "brinque" al aparecer.
 */
export function fillGaps(
  times: number[],
  track: RawTrack,
  rest: THREE.Quaternion,
  opts: Pick<CleanupOptions, 'maxGapSeconds' | 'restBlendSeconds'>,
): THREE.Quaternion[] {
  const known = track.flatMap((q, i) => (q ? [i] : []));
  if (known.length === 0) return times.map(() => rest.clone());

  let k = 0; // índice en known de la siguiente detección >= i
  return track.map((q, i) => {
    if (q) {
      k++;
      return q.clone();
    }
    const prev = k > 0 ? known[k - 1] : -1;
    const next = k < known.length ? known[k] : -1;
    const t = times[i];

    let base: THREE.Quaternion;
    if (prev >= 0 && next >= 0) {
      const alpha = (t - times[prev]) / (times[next] - times[prev]);
      base = new THREE.Quaternion().slerpQuaternions(track[prev]!, track[next]!, alpha);
      if (times[next] - times[prev] <= opts.maxGapSeconds) return base;
    } else {
      base = track[prev >= 0 ? prev : next]!.clone();
    }
    // Peso hacia el reposo: 0 junto a una detección, 1 a restBlendSeconds de ella.
    const fromPrev = prev >= 0 ? (t - times[prev]) / opts.restBlendSeconds : Infinity;
    const toNext = next >= 0 ? (times[next] - t) / opts.restBlendSeconds : Infinity;
    return base.slerp(rest, smoothstep(Math.min(fromPrev, toNext)));
  });
}

/**
 * Remuestrea a tiempos uniformes con un kernel gaussiano sobre el tiempo real
 * de cada muestra. Hace dos cosas a la vez: quita el jitter de MediaPipe y
 * corrige el espaciado irregular de la extracción (hay saltos de 32 y 64 ms).
 * Promedio de cuaterniones por suma ponderada normalizada, alineando el
 * hemisferio con la muestra central — válido porque el kernel abarca ~±0.15 s,
 * donde las rotaciones son cercanas entre sí.
 */
export function smoothResample(
  times: number[],
  track: THREE.Quaternion[],
  outTimes: number[],
  sigma: number,
): THREE.Quaternion[] {
  const reach = 3 * sigma;
  return outTimes.map((T) => {
    let nearest = 0;
    for (let i = 1; i < times.length; i++) {
      if (Math.abs(times[i] - T) < Math.abs(times[nearest] - T)) nearest = i;
    }
    const ref = track[nearest];
    const acc = new THREE.Vector4(0, 0, 0, 0); // ojo: Vector4() arranca con w = 1
    for (let i = 0; i < times.length; i++) {
      const dt = times[i] - T;
      if (Math.abs(dt) > reach) continue;
      const w = Math.exp(-(dt * dt) / (2 * sigma * sigma));
      const q = track[i];
      const s = q.dot(ref) < 0 ? -w : w;
      acc.x += q.x * s;
      acc.y += q.y * s;
      acc.z += q.z * s;
      acc.w += q.w * s;
    }
    acc.normalize();
    return new THREE.Quaternion(acc.x, acc.y, acc.z, acc.w);
  });
}

/**
 * Rango [inicio, fin] de frames con movimiento, más un margen. "Quieto" es
 * relativo al pico del propio clip para no depender de la escala del ruido.
 */
export function motionRange(
  tracks: Map<string, THREE.Quaternion[]>,
  frameCount: number,
  fps: number,
  opts: Pick<CleanupOptions, 'stillFraction' | 'trimMarginSeconds'>,
): [number, number] {
  const motion = new Array<number>(frameCount).fill(0);
  for (const track of tracks.values()) {
    for (let i = 1; i < frameCount; i++) motion[i] += track[i].angleTo(track[i - 1]);
  }
  const peak = Math.max(...motion);
  if (peak === 0) return [0, frameCount - 1];
  const moving = motion.flatMap((m, i) => (m >= peak * opts.stillFraction ? [i] : []));
  const margin = Math.round(opts.trimMarginSeconds * fps);
  return [
    Math.max(0, moving[0] - 1 - margin),
    Math.min(frameCount - 1, moving[moving.length - 1] + margin),
  ];
}

/**
 * Pipeline completo: rellenar huecos → suavizar y remuestrear → recortar
 * quietud de inicio/fin → cerrar el bucle con una transición al primer frame.
 */
export function cleanAnimation(
  times: number[],
  rawTracks: Map<string, RawTrack>,
  restFor: (bone: string) => THREE.Quaternion,
  opts: CleanupOptions = DEFAULT_CLEANUP,
): CleanClip {
  const { outFps: fps } = opts;
  const start = times[0];
  const end = times[times.length - 1];
  const count = Math.floor((end - start) * fps) + 1;
  const outTimes = Array.from({ length: count }, (_, i) => start + i / fps);

  const smoothed = new Map<string, THREE.Quaternion[]>();
  for (const [bone, raw] of rawTracks) {
    const filled = fillGaps(times, raw, restFor(bone), opts);
    smoothed.set(bone, smoothResample(times, filled, outTimes, opts.sigmaSeconds(bone)));
  }

  const [first, last] = motionRange(smoothed, count, fps, opts);
  const returnFrames = Math.max(1, Math.round(opts.returnSeconds * fps));
  const holdFrames = Math.round(opts.holdSeconds * fps);

  const tracks = new Map<string, THREE.Quaternion[]>();
  for (const [bone, track] of smoothed) {
    const clip = track.slice(first, last + 1);
    const from = clip[clip.length - 1];
    const to = clip[0];
    for (let k = 1; k <= returnFrames; k++) {
      clip.push(new THREE.Quaternion().slerpQuaternions(from, to, smoothstep(k / returnFrames)));
    }
    for (let k = 0; k < holdFrames; k++) clip.push(to.clone());
    tracks.set(bone, clip);
  }
  return { fps, frameCount: last - first + 1 + returnFrames + holdFrames, tracks };
}
