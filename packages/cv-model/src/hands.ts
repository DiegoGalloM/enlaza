import { LANDMARK_COUNT, MIDDLE_MCP, WRIST } from './types';
import type { DetectedHand, HandFrame, Handedness, HandsFrame } from './types';

/**
 * Seguimiento de la mano que hace la seña cuando el detector ve dos (D38).
 *
 * Con una sola mano detectada, en señas de dos manos (Gracias: la derecha se
 * apoya sobre la palma izquierda) MediaPipe devolvía en cada frame la que
 * mejor veía: la secuencia mezclaba las dos manos y nunca validaba. Además la
 * etiqueta Left/Right se voltea cuando las manos se tocan, y como las features
 * espejan las manos 'Left', un frame mal etiquetado queda espejado.
 *
 * Reglas:
 * - Al empezar se toma la mano registrada de la seña (`preferred`) si está;
 *   si no, la única visible o la primera que reporta el detector.
 * - Después se sigue por continuidad: la muñeca más cercana a la del frame
 *   anterior, con un castigo si la etiqueta no coincide (sin excluirla: con
 *   las manos juntas la etiqueta falla).
 * - Si la mano seguida no se ve (tapada por la otra), el frame cuenta como
 *   vacío: meter la otra mano ensucia más la secuencia que perder un frame.
 * - La etiqueta que sale es la del seguimiento, no la del frame: una mano no
 *   cambia de lado a mitad de la seña.
 * - Si la mano se pierde más de `lostAfterMs`, se vuelve a empezar.
 */
export interface HandTrackerOptions {
  /** Tiempo sin ver la mano seguida tras el cual se vuelve a elegir, en ms. */
  lostAfterMs?: number;
  /** Salto máximo de la muñeca entre frames, en largos de mano. */
  maxJump?: number;
  /** Castigo, en largos de mano, por no coincidir con la etiqueta seguida. */
  labelPenalty?: number;
  /**
   * Distancia, en largos de mano, bajo la cual una sola mano visible con la
   * otra etiqueta se toma como la misma mano mal etiquetada.
   */
  relabelDistance?: number;
}

interface Point {
  x: number;
  y: number;
  handLength: number;
}

interface Lock extends Point {
  label: Handedness;
  timestampMs: number;
  /** La mano se eligió sin coincidir con `preferred` (había que tomar otra). */
  fallback: boolean;
}

/** Muñeca y largo de la mano en unidades de alto de imagen (sin espejar). */
function wristPoint(hand: DetectedHand, aspect: number): Point {
  if (hand.landmarks.length !== LANDMARK_COUNT) {
    throw new Error(`Expected ${LANDMARK_COUNT} landmarks, got ${hand.landmarks.length}`);
  }
  const wrist = hand.landmarks[WRIST]!;
  const middle = hand.landmarks[MIDDLE_MCP]!;
  return {
    x: aspect * wrist.x,
    y: wrist.y,
    handLength: Math.hypot(aspect * (middle.x - wrist.x), middle.y - wrist.y) || 1e-6,
  };
}

export class HandTracker {
  private readonly preferred: Handedness | undefined;
  private readonly opts: Required<HandTrackerOptions>;
  private lock: Lock | null = null;

  constructor(preferred?: Handedness, options: HandTrackerOptions = {}) {
    this.preferred = preferred;
    this.opts = {
      lostAfterMs: options.lostAfterMs ?? 400,
      maxJump: options.maxJump ?? 2.5,
      labelPenalty: options.labelPenalty ?? 0.5,
      relabelDistance: options.relabelDistance ?? 0.6,
    };
  }

  reset(): void {
    this.lock = null;
  }

  /** La mano que hace la seña en este frame, o null si no se ve. */
  pick(frame: HandsFrame): HandFrame | null {
    if (this.lock && frame.timestampMs - this.lock.timestampMs > this.opts.lostAfterMs) {
      this.lock = null;
    }
    if (frame.hands.length === 0) return null;
    const candidates = frame.hands.map((hand) => ({ hand, point: wristPoint(hand, frame.aspect) }));

    // Se tomó otra mano porque la registrada no estaba: en cuanto aparece, se cambia.
    if (this.lock?.fallback && this.preferred) {
      const preferred = candidates.find((c) => c.hand.handedness === this.preferred);
      if (preferred) this.lock = null;
    }

    if (!this.lock) {
      const preferred = this.preferred
        ? candidates.find((c) => c.hand.handedness === this.preferred)
        : undefined;
      const chosen = preferred ?? candidates[0]!;
      return this.accept(frame, chosen.hand, chosen.point, chosen.hand.handedness, {
        fallback: this.preferred !== undefined && !preferred,
      });
    }

    const lock = this.lock;
    const scale = lock.handLength;
    let best: { hand: DetectedHand; point: Point; distance: number; cost: number } | null = null;
    for (const c of candidates) {
      const distance = Math.hypot(c.point.x - lock.x, c.point.y - lock.y) / scale;
      const cost = distance + (c.hand.handedness === lock.label ? 0 : this.opts.labelPenalty);
      if (!best || cost < best.cost) best = { ...c, distance, cost };
    }
    if (!best || best.distance > this.opts.maxJump) return null;
    // Una sola mano, con la otra etiqueta y no justo donde estaba la seguida:
    // es la otra mano (la seguida quedó tapada), no un error de etiqueta.
    if (
      candidates.length === 1 &&
      best.hand.handedness !== lock.label &&
      best.distance > this.opts.relabelDistance
    ) {
      return null;
    }
    return this.accept(frame, best.hand, best.point, lock.label, { fallback: lock.fallback });
  }

  private accept(
    frame: HandsFrame,
    hand: DetectedHand,
    point: Point,
    label: Handedness,
    { fallback }: { fallback: boolean },
  ): HandFrame {
    this.lock = { ...point, label, timestampMs: frame.timestampMs, fallback };
    return {
      landmarks: hand.landmarks,
      handedness: label,
      timestampMs: frame.timestampMs,
      aspect: frame.aspect,
      ...(frame.face ? { face: frame.face } : {}),
    };
  }
}

/** Mano registrada de la seña, según sus plantillas (la primera que la traiga). */
export function signHand(
  signId: string,
  templates: { signId: string; hand?: Handedness }[],
): Handedness | undefined {
  return templates.find((t) => t.signId === signId && t.hand)?.hand;
}
