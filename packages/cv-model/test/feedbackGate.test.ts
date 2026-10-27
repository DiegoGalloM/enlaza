import { describe, expect, it } from 'vitest';
import {
  FeedbackGate,
  IDENTIFIED_TTL_MS,
  MIN_GRACE_MS,
  PAUSE_RESET_MS,
  feedbackGraceMs,
} from '../src/feedbackGate';
import type { SessionVerdict } from '../src/session';

const tracking: SessionVerdict = { status: 'tracking', best: null };
const otherSign: SessionVerdict = { status: 'retry', best: { signId: 'gracias', score: 0.7 } };

/** Frames a 30 fps con la mano en cuadro, de `fromMs` a `toMs`. */
function feedFor(
  gate: FeedbackGate,
  fromMs: number,
  toMs: number,
  verdict: SessionVerdict = tracking,
  handVisible = true,
) {
  let state = gate.feed(fromMs, handVisible, verdict);
  for (let t = fromMs + 33; t <= toMs; t += 33) state = gate.feed(t, handVisible, verdict);
  return state;
}

describe('feedbackGraceMs (D46)', () => {
  it('dura lo que la seña lenta desde el reposo, con un mínimo', () => {
    // Hola (1535 ms): 1.6× = 2.5 s + 1.5 s de preparación < mínimo.
    expect(feedbackGraceMs('dynamic', 1535)).toBe(MIN_GRACE_MS);
    // Buenos días (2592 ms): 1.6× = 4.1 s + 1.5 s.
    expect(feedbackGraceMs('dynamic', 2592)).toBe(5647);
    expect(feedbackGraceMs('static', 99999)).toBe(MIN_GRACE_MS);
  });
});

describe('FeedbackGate (D46)', () => {
  it('calla los avisos durante la gracia, aunque el validador vea otra seña', () => {
    const gate = new FeedbackGate(5000);
    const state = feedFor(gate, 0, 4900, otherSign);
    expect(state.open).toBe(false);
    // La seña reconocida se recuerda para nombrarla cuando se abra.
    expect(state.identifiedSignId).toBe('gracias');
  });

  it('se abre después de la gracia de intento y nombra la seña reconocida', () => {
    const gate = new FeedbackGate(5000);
    feedFor(gate, 0, 3000, otherSign);
    const state = feedFor(gate, 3033, 5100);
    expect(state.open).toBe(true);
    expect(state.identifiedSignId).toBe('gracias');
  });

  it('el tiempo sin mano no cuenta como intento', () => {
    const gate = new FeedbackGate(5000);
    feedFor(gate, 0, 2500);
    // 2 s sin mano (menos que una pausa): no suma ni reinicia.
    feedFor(gate, 2533, 4500, tracking, false);
    expect(feedFor(gate, 4533, 6900).open).toBe(false);
    expect(feedFor(gate, 6933, 7200).open).toBe(true);
  });

  it('una pausa larga sin mano vuelve a dar la gracia completa', () => {
    const gate = new FeedbackGate(5000);
    expect(feedFor(gate, 0, 5100, otherSign).open).toBe(true);
    feedFor(gate, 5133, 5133 + PAUSE_RESET_MS, tracking, false);
    const state = feedFor(gate, 5133 + PAUSE_RESET_MS + 33, 5133 + PAUSE_RESET_MS + 1000);
    expect(state.open).toBe(false);
    expect(state.identifiedSignId).toBeNull();
  });

  it('un hueco entre frames (pestaña en segundo plano) no abre la gracia de golpe', () => {
    const gate = new FeedbackGate(5000);
    gate.feed(0, true, tracking);
    expect(gate.feed(2000, true, tracking).tryingMs).toBeLessThan(500);
  });

  it('deja de nombrar una seña que no se volvió a ver', () => {
    const gate = new FeedbackGate(5000);
    feedFor(gate, 0, 1000, otherSign);
    const state = feedFor(gate, 1033, 1000 + IDENTIFIED_TTL_MS + 100);
    expect(state.identifiedSignId).toBeNull();
  });

  it('reset vuelve a empezar', () => {
    const gate = new FeedbackGate(5000);
    feedFor(gate, 0, 6000, otherSign);
    gate.reset();
    const state = gate.feed(6033, true, tracking);
    expect(state).toEqual({ open: false, identifiedSignId: null, tryingMs: 0 });
  });
});
