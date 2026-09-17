import { describe, expect, it } from 'vitest';
import { SessionValidator } from '../src/session';
import { toFeatureVector } from '../src/normalize';
import { buildStaticTemplate } from '../src/staticClassifier';
import { buildDynamicTemplate } from '../src/dynamicClassifier';
import type { HandFrame, Landmark } from '../src/types';
import { jitterPose, mulberry32, randomPose, randomSequence } from './synthetic';

const rng = mulberry32(23);
const poseA = randomPose(rng);
const poseB = randomPose(rng);
const vec = (p: Landmark[]) => toFeatureVector(p, 'Right', 1);

const staticTemplates = [
  buildStaticTemplate('letra-a', [vec(poseA)]),
  buildStaticTemplate('letra-b', [vec(poseB)]),
];

function frame(pose: Landmark[], timestampMs: number): HandFrame {
  return { landmarks: pose, handedness: 'Right', timestampMs, aspect: 1 };
}

describe('SessionValidator (static signs)', () => {
  it('validates after holding the target sign for holdFrames frames', () => {
    const session = new SessionValidator('letra-a', 'static', staticTemplates, {
      holdFrames: 5,
    });
    let lastStatus = '';
    for (let i = 0; i < 5; i++) {
      lastStatus = session.feed(frame(jitterPose(poseA, rng, 0.004), i * 33)).status;
    }
    expect(lastStatus).toBe('correct');
    expect(session.isDone).toBe(true);
  });

  it('losing the hand resets the hold streak', () => {
    const session = new SessionValidator('letra-a', 'static', staticTemplates, {
      holdFrames: 3,
    });
    session.feed(frame(poseA, 0));
    session.feed(frame(poseA, 33));
    expect(session.feedEmpty().status).toBe('waiting');
    // Two more frames should NOT be enough — streak restarted.
    session.feed(frame(poseA, 99));
    const verdict = session.feed(frame(poseA, 132));
    expect(verdict.status).toBe('tracking');
    expect(session.isDone).toBe(false);
  });

  it('suggests retry when a different sign is held steadily', () => {
    const session = new SessionValidator('letra-a', 'static', staticTemplates, {
      holdFrames: 5,
      retryFrames: 4,
    });
    let status = '';
    for (let i = 0; i < 4; i++) {
      status = session.feed(frame(jitterPose(poseB, rng, 0.004), i * 33)).status;
    }
    expect(status).toBe('retry');
    expect(session.isDone).toBe(false);
  });

  it('reports missing templates', () => {
    const session = new SessionValidator('letra-z', 'static', staticTemplates);
    expect(session.hasTemplates()).toBe(false);
    expect(new SessionValidator('letra-a', 'static', staticTemplates).hasTemplates()).toBe(true);
  });

  it('ignores frames after validation', () => {
    const session = new SessionValidator('letra-a', 'static', staticTemplates, {
      holdFrames: 1,
    });
    expect(session.feed(frame(poseA, 0)).status).toBe('correct');
    expect(session.feed(frame(poseB, 33)).status).toBe('correct');
  });
});

describe('SessionValidator (dynamic signs)', () => {
  const seq = randomSequence(rng, 24);
  const other = randomSequence(rng, 24);
  const dynTemplates = [
    buildDynamicTemplate('hola', seq.map((f) => vec(f))),
    buildDynamicTemplate('gracias', other.map((f) => vec(f))),
  ];

  it('validates a performed sequence inside the capture window', () => {
    const session = new SessionValidator('hola', 'dynamic', dynTemplates, {
      windowMs: 2000,
      checkIntervalMs: 100,
    });
    let status = '';
    seq.forEach((pose, i) => {
      status = session.feed(frame(jitterPose(pose, rng, 0.002), i * 66)).status;
    });
    expect(status).toBe('correct');
  });

  it('does not validate a different sequence', () => {
    const session = new SessionValidator('gracias', 'dynamic', dynTemplates, {
      windowMs: 2000,
      checkIntervalMs: 100,
    });
    let sawCorrect = false;
    seq.forEach((pose, i) => {
      if (session.feed(frame(pose, i * 66)).status === 'correct') sawCorrect = true;
    });
    expect(sawCorrect).toBe(false);
  });
});
