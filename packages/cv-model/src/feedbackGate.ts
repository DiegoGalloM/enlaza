import { WINDOW_SCALES, type SessionVerdict } from './session';
import type { SignType } from './types';

/**
 * Cuándo decirle a la persona que la seña todavía no sale (D46).
 *
 * El validador puede marcar "otra seña" o calcular qué falta desde el primer
 * segundo, pero quien aprende casi nunca acierta al primer intento: hacerlo
 * despacio, copiando al avatar, ya valida (D43). Avisar antes de que termine
 * ese intento lento se lee como un error y frustra. Por eso la práctica calla
 * los avisos durante un tiempo de gracia de intento real (con la mano en
 * cuadro) y solo después dice, en amarillo, qué seña reconoció y qué falta.
 */

/** Gracia mínima, en ms de intento, para cualquier seña. */
export const MIN_GRACE_MS = 5000;

/**
 * Preparación que se suma a la seña lenta: subir la mano desde el reposo y
 * ubicarla antes de empezar (~1.5 s en los videos de ICAL y en la práctica).
 */
export const PREPARATION_MS = 1500;

/** Sin mano en cuadro este tiempo, la persona hizo una pausa: la gracia vuelve a empezar. */
export const PAUSE_RESET_MS = 3000;

/** Cuánto se sigue nombrando una seña reconocida después de verla por última vez. */
export const IDENTIFIED_TTL_MS = 4000;

/**
 * Un hueco entre frames más largo que esto (pestaña en segundo plano, cámara
 * trabada) no cuenta como tiempo de intento.
 */
const MAX_FRAME_GAP_MS = 250;

/**
 * Gracia de una seña: lo que dura hacerla despacio desde el reposo. La ventana
 * más larga del validador (1.6× la seña, D43) es justo la seña lenta que
 * todavía valida; se le suma la preparación, y nunca baja de MIN_GRACE_MS.
 * Hola (1.5 s) queda en 5 s; Buenos días (2.6 s), en 5.6 s.
 */
export function feedbackGraceMs(signType: SignType, windowMs: number): number {
  if (signType === 'static') return MIN_GRACE_MS;
  const slowSign = windowMs * Math.max(...WINDOW_SCALES);
  return Math.max(MIN_GRACE_MS, Math.round(slowSign + PREPARATION_MS));
}

export interface FeedbackGateState {
  /** Ya pasó la gracia: se puede decir que la seña aún no sale. */
  open: boolean;
  /** Otra seña reconocida hace poco (sobre su umbral), para nombrarla; o null. */
  identifiedSignId: string | null;
  /** Milisegundos de intento con la mano en cuadro desde el inicio, el reinicio o la última pausa. */
  tryingMs: number;
}

/**
 * Lleva el tiempo de intento de una práctica y decide si ya se pueden mostrar
 * los avisos. Se alimenta con cada frame, después del validador.
 */
export class FeedbackGate {
  private readonly graceMs: number;
  private tryingMs = 0;
  private lastFrameMs: number | null = null;
  private lastHandMs: number | null = null;
  private identified: { signId: string; t: number } | null = null;

  constructor(graceMs: number) {
    this.graceMs = graceMs;
  }

  reset(): void {
    this.tryingMs = 0;
    this.lastFrameMs = null;
    this.lastHandMs = null;
    this.identified = null;
  }

  /**
   * `handVisible`: el detector vio la mano de la seña en este frame.
   * `verdict`: lo que dijo el validador en este mismo frame.
   */
  feed(timestampMs: number, handVisible: boolean, verdict: SessionVerdict): FeedbackGateState {
    if (handVisible) {
      if (this.lastHandMs !== null && timestampMs - this.lastHandMs >= PAUSE_RESET_MS) {
        // Volvió después de una pausa (p. ej., a mirar otra vez al avatar).
        this.tryingMs = 0;
        this.identified = null;
      } else if (this.lastFrameMs !== null) {
        this.tryingMs += Math.min(Math.max(timestampMs - this.lastFrameMs, 0), MAX_FRAME_GAP_MS);
      }
      this.lastHandMs = timestampMs;
    }
    this.lastFrameMs = timestampMs;

    if (verdict.status === 'retry' && verdict.best) {
      this.identified = { signId: verdict.best.signId, t: timestampMs };
    } else if (this.identified && timestampMs - this.identified.t > IDENTIFIED_TTL_MS) {
      this.identified = null;
    }

    return {
      open: this.tryingMs >= this.graceMs,
      identifiedSignId: this.identified?.signId ?? null,
      tryingMs: this.tryingMs,
    };
  }
}
