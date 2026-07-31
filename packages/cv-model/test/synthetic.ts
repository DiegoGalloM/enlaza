import { LANDMARK_COUNT } from '../src/types';
import type { Landmark } from '../src/types';

/** Deterministic PRNG so fixtures are reproducible across runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate a random-but-plausible hand pose: wrist near frame center,
 * middle MCP at a fixed distance (the normalization scale reference),
 * remaining landmarks scattered around the palm.
 */
export function randomPose(rng: () => number): Landmark[] {
  const wrist = { x: 0.5, y: 0.6, z: 0 };
  const pose: Landmark[] = [wrist];
  for (let i = 1; i < LANDMARK_COUNT; i++) {
    pose.push({
      x: wrist.x + (rng() - 0.5) * 0.3,
      y: wrist.y - rng() * 0.3,
      z: (rng() - 0.5) * 0.1,
    });
  }
  // Pin middle MCP to a fixed offset so scale normalization is stable.
  pose[9] = { x: wrist.x + 0.02, y: wrist.y - 0.15, z: 0 };
  return pose;
}

/** Add gaussian-ish noise to a pose (camera jitter, hand tremor). */
export function jitterPose(pose: Landmark[], rng: () => number, sigma = 0.008): Landmark[] {
  const noise = () => (rng() + rng() + rng() - 1.5) * 2 * sigma;
  return pose.map((p) => ({ x: p.x + noise(), y: p.y + noise(), z: p.z + noise() }));
}

/** Translate + scale a pose (same sign seen from another position/distance). */
export function transformPose(
  pose: Landmark[],
  dx: number,
  dy: number,
  scale: number,
): Landmark[] {
  const wrist = pose[0]!;
  return pose.map((p) => ({
    x: wrist.x + dx + (p.x - wrist.x) * scale,
    y: wrist.y + dy + (p.y - wrist.y) * scale,
    z: (p.z - wrist.z) * scale,
  }));
}

/** Mirror a pose horizontally (right hand ↔ left hand). */
export function mirrorPose(pose: Landmark[]): Landmark[] {
  return pose.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
}

/**
 * Generate a smooth pose sequence (a dynamic sign): interpolate between a
 * start and end pose with slight noise per frame.
 */
export function randomSequence(rng: () => number, length = 24): Landmark[][] {
  const from = randomPose(rng);
  const to = randomPose(rng);
  const frames: Landmark[][] = [];
  for (let f = 0; f < length; f++) {
    const t = f / (length - 1);
    const frame = from.map((p, i) => ({
      x: p.x * (1 - t) + to[i]!.x * t,
      y: p.y * (1 - t) + to[i]!.y * t,
      z: p.z * (1 - t) + to[i]!.z * t,
    }));
    frames.push(jitterPose(frame, rng, 0.003));
  }
  return frames;
}

/** Time-warp a sequence by duplicating/dropping frames (variable signing speed). */
export function timeWarp(frames: Landmark[][], rng: () => number): Landmark[][] {
  const out: Landmark[][] = [];
  for (const frame of frames) {
    const r = rng();
    if (r < 0.2) continue; // drop frame
    out.push(frame);
    if (r > 0.8) out.push(frame); // duplicate frame
  }
  return out.length >= 4 ? out : frames;
}
