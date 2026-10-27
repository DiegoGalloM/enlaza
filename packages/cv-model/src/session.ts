import { toFeatureVector } from './normalize';
import { STATIC_THRESHOLD, classifyStatic } from './staticClassifier';
import {
  DYNAMIC_THRESHOLD,
  LOCATION_TOLERANCE,
  MIN_MOTION_RATIO,
  MOTION_WEIGHT,
  classifyDynamic,
} from './dynamicClassifier';
import { motionTrajectory, wristSample, type WristSample } from './motion';
import { locationSample, locationTrajectory } from './location';
import { HandTracker, signHand } from './hands';
import type {
  ClassifyResult,
  DynamicTemplate,
  HandFrame,
  HandsFrame,
  SignTemplate,
  SignType,
} from './types';

export type SessionStatus =
  | 'waiting' // no hand detected yet
  | 'tracking' // hand visible, not matched yet
  | 'correct' // target sign validated
  | 'retry'; // a different sign is being held steadily — nudge the user

export interface SessionVerdict {
  status: SessionStatus;
  /** Best guess right now (may be another sign than the target). */
  best: ClassifyResult | null;
  /**
   * Resultado de la seña buscada en la última comparación (dinámicas), aunque
   * otra quede primera: su desglose dice qué le falta para validar.
   */
  target?: ClassifyResult | null;
}

export interface HandsVerdict extends SessionVerdict {
  /** La mano que se validó en este frame (la que sigue HandTracker), o null. */
  hand: HandFrame | null;
}

export interface SessionOptions {
  /** Consecutive matching frames required to accept a static sign. */
  holdFrames?: number;
  /** Consecutive frames of the same wrong sign before suggesting a retry. */
  retryFrames?: number;
  /** Capture window for dynamic signs, in ms. */
  windowMs?: number;
  /** How often to run DTW for dynamic signs, in ms. */
  checkIntervalMs?: number;
  staticThreshold?: number;
  /** Umbral para todas las dinámicas; sin él, cada seña usa el de su plantilla (D43). */
  dynamicThreshold?: number;
  /** Peso del movimiento de la muñeca en señas dinámicas (0 = solo forma). */
  motionWeight?: number;
  /** Fracción mínima del movimiento de la plantilla (0 = sin compuerta). */
  minMotionRatio?: number;
  /** Tolerancia de lugar en altos de cara (Infinity = sin compuerta de lugar, D37). */
  locationTolerance?: number;
  /** Forma sin la rotación de la mano entera, con orientación aparte (D39). */
  rotationTolerant?: boolean;
}

/** Ventana por defecto cuando la seña no trae duración de origen. */
const FALLBACK_WINDOW_MS = 2000;

/**
 * Largos de ventana que se prueban en cada comparación, como fracción de la
 * ventana de la seña (D43). Quien aprende casi nunca va al ritmo del video:
 * más lento, la seña no cabe en una ventana del largo de la plantilla y DTW
 * solo ve un pedazo; más rápido y desde el reposo, la ventana mete la subida
 * de las manos. Vale la ventana en la que la seña buscada queda mejor.
 */
export const WINDOW_SCALES = [0.75, 1, 1.6] as const;

/**
 * La ventana de captura debe durar lo que dura la seña buscada: DTW compara la
 * ventana completa contra la plantilla completa, así que una ventana más corta
 * que la seña solo puede ver un pedazo (y nunca supera el umbral) y una mucho
 * más larga mete reposo. Las plantillas derivadas de los videos de referencia
 * traen esa duración; las grabadas en el dispositivo no, y usan el default.
 */
function defaultWindowMs(targetSignId: string, templates: SignTemplate[]): number {
  const durations = templates
    .filter((t): t is DynamicTemplate => t.signId === targetSignId && t.type === 'dynamic')
    .map((t) => t.sourceMs)
    .filter((ms): ms is number => ms !== undefined);
  return durations.length > 0 ? Math.max(...durations) : FALLBACK_WINDOW_MS;
}

interface DynamicFrame {
  vector: number[];
  timestampMs: number;
  wrist: WristSample;
  location: [number, number] | null;
}

/**
 * Stateful validator for one practice attempt: feed it hand frames as they
 * arrive from the detector, and it decides when the target sign was executed
 * correctly. Static signs must be *held* for `holdFrames` consecutive frames;
 * dynamic signs are matched by DTW over a sliding capture window.
 */
export class SessionValidator {
  private readonly targetSignId: string;
  private readonly signType: SignType;
  private readonly templates: SignTemplate[];
  private readonly opts: Required<Omit<SessionOptions, 'dynamicThreshold'>>;
  private readonly dynamicThreshold: number | undefined;

  private matchStreak = 0;
  private wrongStreak = 0;
  private wrongSignId: string | null = null;
  private buffer: DynamicFrame[] = [];
  private lastDynamicCheckMs = -Infinity;
  private done = false;
  private readonly tracker: HandTracker;

  constructor(
    targetSignId: string,
    signType: SignType,
    templates: SignTemplate[],
    options: SessionOptions = {},
  ) {
    this.targetSignId = targetSignId;
    this.signType = signType;
    this.templates = templates;
    this.opts = {
      holdFrames: options.holdFrames ?? 8,
      retryFrames: options.retryFrames ?? 20,
      windowMs: options.windowMs ?? defaultWindowMs(targetSignId, templates),
      checkIntervalMs: options.checkIntervalMs ?? 400,
      staticThreshold: options.staticThreshold ?? STATIC_THRESHOLD,
      motionWeight: options.motionWeight ?? MOTION_WEIGHT,
      minMotionRatio: options.minMotionRatio ?? MIN_MOTION_RATIO,
      locationTolerance: options.locationTolerance ?? LOCATION_TOLERANCE,
      rotationTolerant: options.rotationTolerant ?? true,
    };
    this.dynamicThreshold = options.dynamicThreshold;
    this.tracker = new HandTracker(signHand(targetSignId, templates));
  }

  /**
   * Umbral de una seña dinámica: el de las opciones si se pasó; si no, el
   * propio de su plantilla, y si no trae, DYNAMIC_THRESHOLD (D43).
   */
  private thresholdFor(signId: string): number {
    if (this.dynamicThreshold !== undefined) return this.dynamicThreshold;
    const own = this.templates.find(
      (t): t is DynamicTemplate => t.signId === signId && t.type === 'dynamic' && t.threshold !== undefined,
    );
    return own?.threshold ?? DYNAMIC_THRESHOLD;
  }

  /** True once the target sign has been validated; further frames are ignored. */
  get isDone(): boolean {
    return this.done;
  }

  hasTemplates(): boolean {
    return this.templates.some((t) => t.signId === this.targetSignId);
  }

  reset(): void {
    this.matchStreak = 0;
    this.wrongStreak = 0;
    this.wrongSignId = null;
    this.buffer = [];
    this.lastDynamicCheckMs = -Infinity;
    this.done = false;
    this.tracker.reset();
  }

  /**
   * Frame con todas las manos que ve el detector (D38): se valida solo la que
   * hace la seña (HandTracker); si no se ve, cuenta como frame vacío.
   */
  feedHands(frame: HandsFrame | null): HandsVerdict {
    const hand = frame ? this.tracker.pick(frame) : null;
    return { ...(hand ? this.feed(hand) : this.feedEmpty()), hand };
  }

  /** Call when the detector reports no hand in the frame. */
  feedEmpty(): SessionVerdict {
    if (this.done) return { status: 'correct', best: null };
    this.matchStreak = 0;
    return { status: 'waiting', best: null };
  }

  feed(frame: HandFrame): SessionVerdict {
    if (this.done) return { status: 'correct', best: null };
    const vector = toFeatureVector(frame.landmarks, frame.handedness, frame.aspect);
    return this.signType === 'static'
      ? this.feedStatic(vector)
      : this.feedDynamic(
          vector,
          frame.timestampMs,
          wristSample(frame.landmarks, frame.handedness, frame.aspect),
          locationSample(frame.landmarks, frame.handedness, frame.aspect, frame.face),
        );
  }

  private feedStatic(vector: number[]): SessionVerdict {
    const templates = this.templates.filter((t) => t.type === 'static');
    const ranked = classifyStatic(vector, templates);
    const best = ranked[0] ?? null;

    if (best && best.signId === this.targetSignId && best.score >= this.opts.staticThreshold) {
      this.matchStreak++;
      this.wrongStreak = 0;
      this.wrongSignId = null;
      if (this.matchStreak >= this.opts.holdFrames) {
        this.done = true;
        return { status: 'correct', best };
      }
      return { status: 'tracking', best };
    }

    this.matchStreak = 0;
    // Track whether the user is steadily holding a *different* sign.
    if (best && best.score >= this.opts.staticThreshold) {
      if (best.signId === this.wrongSignId) {
        this.wrongStreak++;
      } else {
        this.wrongSignId = best.signId;
        this.wrongStreak = 1;
      }
      if (this.wrongStreak >= this.opts.retryFrames) {
        return { status: 'retry', best };
      }
    } else {
      this.wrongStreak = 0;
      this.wrongSignId = null;
    }
    return { status: 'tracking', best };
  }

  private feedDynamic(
    vector: number[],
    timestampMs: number,
    wrist: WristSample,
    location: [number, number] | null,
  ): SessionVerdict {
    this.buffer.push({ vector, timestampMs, wrist, location });
    const longest = this.opts.windowMs * Math.max(...WINDOW_SCALES);
    const cutoff = timestampMs - longest;
    while (this.buffer.length > 0 && this.buffer[0]!.timestampMs < cutoff) {
      this.buffer.shift();
    }

    if (
      timestampMs - this.lastDynamicCheckMs < this.opts.checkIntervalMs ||
      this.buffer.length < 10
    ) {
      return { status: 'tracking', best: null };
    }
    this.lastDynamicCheckMs = timestampMs;

    // Cada ventana es el final del buffer; se compara contra todas las
    // plantillas y la seña buscada tiene que quedar primera en esa misma
    // ventana (D43).
    let found: { best: ClassifyResult | null; target: ClassifyResult | null } | null = null;
    let retry: ClassifyResult | null = null;
    for (const scale of WINDOW_SCALES) {
      const windowMs = this.opts.windowMs * scale;
      const frames = this.buffer.filter((f) => f.timestampMs >= timestampMs - windowMs);
      if (frames.length < 10) continue;
      const ranked = this.classify(frames).map((r) =>
        r.detail ? { ...r, detail: { ...r.detail, windowMs } } : r,
      );
      const best = ranked[0] ?? null;
      const target = ranked.find((r) => r.signId === this.targetSignId) ?? null;
      if (best && best.signId === this.targetSignId && best.score >= this.thresholdFor(best.signId)) {
        this.done = true;
        return { status: 'correct', best, target };
      }
      // Otra seña completa solo cuenta en la ventana del largo de la buscada,
      // como antes: en las demás, un pedazo de una seña compuesta se parece a
      // otra seña más corta.
      if (scale === 1 && best && best.signId !== this.targetSignId && best.score >= this.thresholdFor(best.signId)) {
        retry = best;
      }
      if (!found || (target?.score ?? 0) > (found.target?.score ?? 0)) found = { best, target };
    }
    if (!found) return { status: 'tracking', best: null };
    if (retry) return { status: 'retry', best: retry, target: found.target };
    return { status: 'tracking', ...found };
  }

  private classify(frames: DynamicFrame[]): ClassifyResult[] {
    return classifyDynamic(
      frames.map((f) => f.vector),
      this.templates.filter((t) => t.type === 'dynamic'),
      {
        motion: motionTrajectory(frames.map((f) => f.wrist)),
        motionWeight: this.opts.motionWeight,
        minMotionRatio: this.opts.minMotionRatio,
        location: locationTrajectory(frames.map((f) => f.location)),
        locationTolerance: this.opts.locationTolerance,
        rotationTolerant: this.opts.rotationTolerant,
      },
    );
  }
}
