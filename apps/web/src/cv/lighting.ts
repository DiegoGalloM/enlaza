/**
 * Luz de la cámara: medir la imagen y, si hace falta, corregirla antes del
 * detector de manos (D48).
 *
 * Con poca luz o contraluz, MediaPipe pierde la mano o la encuentra a ratos, y
 * la seña no valida aunque esté bien hecha. Aquí se mide cada ~250 ms una
 * miniatura de la imagen y, si la zona de la persona está oscura o sin
 * contraste, se estira su rango (niveles + gamma) con una tabla por píxel
 * antes de pasarla al detector. Con buena luz no se toca nada: la imagen va
 * directo al detector, como antes. Una imagen quemada (sobreexpuesta) no se
 * corrige: se midió que empeoraba la detección; solo se da el aviso.
 *
 * La tabla por píxel (y no `ctx.filter`) es a propósito: Safari no implementa
 * filtros de canvas, y esto corre igual en todos los navegadores.
 * tools/content/hand-extract-page.html replica estas funciones para medirlas
 * sobre los videos de referencia; si cambian aquí, cambiarlas allá.
 */

/**
 * Estadísticas de luminancia (0–255) de la zona central de la imagen, donde
 * están la persona y sus manos: con una ventana detrás, la imagen entera
 * "promedia bien" aunque la persona esté a oscuras (contraluz).
 */
export interface LightStats {
  mean: number;
  /** Media de la imagen entera: comparada con la del centro, delata el contraluz. */
  frameMean: number;
  /** Percentil 2: el negro real de la imagen. */
  lo: number;
  /** Percentil 98: el blanco real de la imagen. */
  hi: number;
  /** Fracción de píxeles quemados (≥ 250). */
  clipped: number;
}

/** Corrección a aplicar: niveles [lo, hi] → [0, 255] y gamma. */
export interface LightCorrection {
  lo: number;
  hi: number;
  gamma: number;
}

export type LightHint = 'oscuro' | 'contraluz' | 'quemado' | null;

/**
 * Desde aquí la zona central se considera oscura (media de luminancia). Con
 * buena luz, el centro de los videos de referencia ronda 120–130; a 75, una
 * persona a contraluz (centro en 76) quedaba sin corregir (D48).
 */
export const DARK_MEAN = 90;
/** Rango útil mínimo (p98 − p2); menos es una imagen sin contraste (bruma, contraluz). */
export const MIN_RANGE = 150;
/** Media a la que se lleva una imagen corregida (≈ la de los videos de referencia). */
const TARGET_MEAN = 0.45;
/** Ganancia máxima: más amplifica sobre todo el ruido del sensor. */
const MAX_GAIN = 4;
/**
 * Límites de la gamma. Arriba de 1.5, una imagen quemada se oscurece de más y
 * la piel se satura (se midió peor que sin corregir, D48).
 */
const MIN_GAMMA = 0.4;
const MAX_GAMMA = 1.5;
/** Zona central que se mide: [x0, x1, y0, y1] como fracción del ancho y alto. */
const CENTER: [number, number, number, number] = [0.2, 0.8, 0.1, 0.95];

/**
 * Luminancia aproximada (Rec. 601) de una imagen RGBA de `width`×`height`,
 * muestreando uno de cada `step` píxeles por eje.
 */
export function measureLight(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  step = 1,
): LightStats {
  const histogram = new Uint32Array(256);
  let sum = 0;
  let count = 0;
  let frameSum = 0;
  let frameCount = 0;
  const [x0, x1, y0, y1] = CENTER;
  for (let y = 0; y < height; y += step) {
    const inRows = y >= height * y0 && y < height * y1;
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const v = (data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 8;
      frameSum += v;
      frameCount++;
      if (inRows && x >= width * x0 && x < width * x1) {
        histogram[v]!++;
        sum += v;
        count++;
      }
    }
  }
  if (count === 0) return { mean: 128, frameMean: 128, lo: 0, hi: 255, clipped: 0 };
  const percentile = (p: number) => {
    const target = count * p;
    let acc = 0;
    for (let v = 0; v < 256; v++) {
      acc += histogram[v]!;
      if (acc >= target) return v;
    }
    return 255;
  };
  let clipped = 0;
  for (let v = 250; v < 256; v++) clipped += histogram[v]!;
  return {
    mean: sum / count,
    frameMean: frameSum / frameCount,
    lo: percentile(0.02),
    hi: percentile(0.98),
    clipped: clipped / count,
  };
}

/**
 * Corrección para una imagen con estas estadísticas, o null si la luz está
 * bien y no hay que tocarla.
 */
export function lightCorrection(stats: LightStats): LightCorrection | null {
  const range = stats.hi - stats.lo;
  const needs = stats.mean < DARK_MEAN || range < MIN_RANGE;
  if (!needs) return null;
  // Niveles: el rango real pasa a ocupar todo, sin pasar de la ganancia máxima.
  const span = Math.max(range, 255 / MAX_GAIN, 1);
  const lo = Math.min(stats.lo, 255 - span);
  const hi = lo + span;
  // Gamma: la media estirada queda en TARGET_MEAN (aclara oscuras, oscurece lavadas).
  const stretchedMean = Math.min(Math.max((stats.mean - lo) / span, 0.02), 0.98);
  const gamma = Math.min(
    Math.max(Math.log(TARGET_MEAN) / Math.log(stretchedMean), MIN_GAMMA),
    MAX_GAMMA,
  );
  return { lo, hi, gamma };
}

/** Tabla de 256 valores de la corrección. */
export function correctionTable(correction: LightCorrection): Uint8ClampedArray {
  const table = new Uint8ClampedArray(256);
  const span = correction.hi - correction.lo;
  for (let v = 0; v < 256; v++) {
    const x = Math.min(Math.max((v - correction.lo) / span, 0), 1);
    table[v] = Math.round(255 * Math.pow(x, correction.gamma));
  }
  return table;
}

/** Aplica la tabla a los canales RGB, en el lugar. */
export function applyTable(data: Uint8ClampedArray, table: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    data[i] = table[data[i]!]!;
    data[i + 1] = table[data[i + 1]!]!;
    data[i + 2] = table[data[i + 2]!]!;
  }
}

/**
 * Aviso para la persona, si la luz es tan mala que conviene que la cambie
 * (la corrección ayuda, pero no hace milagros).
 */
export function lightHint(stats: LightStats): LightHint {
  if (stats.frameMean > 110 && stats.mean < stats.frameMean * 0.6) return 'contraluz';
  if (stats.mean < 45) return 'oscuro';
  if (stats.clipped > 0.3) return 'quemado';
  return null;
}

/** Qué decirle a la persona en cada caso: una acción concreta, sin tono de error. */
export const LIGHT_HINT_TEXT: Record<Exclude<LightHint, null>, string> = {
  oscuro: 'Hay poca luz. Si puedes, enciende una luz o ponte frente a una ventana.',
  contraluz: 'Hay mucha luz detrás de ti. Si puedes, gírate para que la luz te dé de frente.',
  quemado: 'La imagen está muy clara. Si puedes, aléjate un poco de la luz directa.',
};

/**
 * Suaviza la corrección entre mediciones: un cambio brusco de una medición a
 * la siguiente haría "parpadear" la imagen que ve el detector.
 */
export function blendCorrection(
  prev: LightCorrection | null,
  next: LightCorrection | null,
  amount = 0.35,
): LightCorrection | null {
  if (!next) return null;
  if (!prev) return next;
  const mix = (a: number, b: number) => a + (b - a) * amount;
  return { lo: mix(prev.lo, next.lo), hi: mix(prev.hi, next.hi), gamma: mix(prev.gamma, next.gamma) };
}

/** Cada cuánto se mide la luz, en ms. */
const MEASURE_INTERVAL_MS = 250;
/** Un aviso se muestra si se sostiene este tiempo (no por una sombra pasajera). */
const HINT_HOLD_MS = 2000;
/** Lado mayor de la imagen corregida: el detector reescala a 224 px igual. */
const PROCESS_MAX_SIDE = 640;

export interface LightState {
  /** La imagen va corregida al detector. */
  corrected: boolean;
  hint: LightHint;
}

/**
 * Mide la luz del video y, si hace falta, entrega al detector una copia
 * corregida en vez del video. Con buena luz devuelve el video tal cual.
 */
export class LightProcessor {
  private readonly probe: CanvasRenderingContext2D | null;
  private readonly work: HTMLCanvasElement;
  private workCtx: CanvasRenderingContext2D | null = null;
  private correction: LightCorrection | null = null;
  private table: Uint8ClampedArray | null = null;
  private lastMeasureMs = -Infinity;
  private pendingHint: { hint: LightHint; since: number } = { hint: null, since: 0 };
  private state: LightState = { corrected: false, hint: null };
  private readonly onChange: ((state: LightState) => void) | undefined;

  constructor(onChange?: (state: LightState) => void) {
    this.onChange = onChange;
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 48;
    this.probe = probe.getContext('2d', { willReadFrequently: true });
    this.work = document.createElement('canvas');
  }

  /** La imagen que debe ver el detector en este cuadro: el video o su copia corregida. */
  frame(video: HTMLVideoElement, nowMs: number): HTMLVideoElement | HTMLCanvasElement {
    if (nowMs - this.lastMeasureMs >= MEASURE_INTERVAL_MS) {
      this.lastMeasureMs = nowMs;
      this.measure(video, nowMs);
    }
    if (!this.table) return video;
    const scale = Math.min(1, PROCESS_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    if (this.work.width !== width || this.work.height !== height || !this.workCtx) {
      this.work.width = width;
      this.work.height = height;
      this.workCtx = this.work.getContext('2d', { willReadFrequently: true });
    }
    const ctx = this.workCtx;
    if (!ctx || width === 0) return video;
    ctx.drawImage(video, 0, 0, width, height);
    const image = ctx.getImageData(0, 0, width, height);
    applyTable(image.data, this.table);
    ctx.putImageData(image, 0, 0);
    return this.work;
  }

  private measure(video: HTMLVideoElement, nowMs: number): void {
    const ctx = this.probe;
    if (!ctx || video.videoWidth === 0) return;
    ctx.drawImage(video, 0, 0, 64, 48);
    const stats = measureLight(ctx.getImageData(0, 0, 64, 48).data, 64, 48);
    this.correction = blendCorrection(this.correction, lightCorrection(stats));
    this.table = this.correction ? correctionTable(this.correction) : null;

    const hint = lightHint(stats);
    if (hint !== this.pendingHint.hint) this.pendingHint = { hint, since: nowMs };
    const shownHint =
      nowMs - this.pendingHint.since >= HINT_HOLD_MS ? this.pendingHint.hint : this.state.hint;
    const next: LightState = { corrected: this.table !== null, hint: shownHint };
    if (next.corrected !== this.state.corrected || next.hint !== this.state.hint) {
      this.state = next;
      this.onChange?.(next);
    }
  }
}
