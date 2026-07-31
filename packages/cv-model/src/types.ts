/** One MediaPipe hand landmark in normalized image coordinates. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export type Handedness = 'Left' | 'Right';

/** Landmark indices we rely on (MediaPipe Hands topology, 21 points). */
export const WRIST = 0;
export const MIDDLE_MCP = 9;
export const LANDMARK_COUNT = 21;

/** A single captured frame of one hand. */
export interface HandFrame {
  landmarks: Landmark[];
  handedness: Handedness;
  /** Milliseconds, monotonic (e.g. video timestamp). */
  timestampMs: number;
}

/**
 * Señas estáticas: una postura fija → un solo vector de features.
 * Señas dinámicas: postura + movimiento → secuencia de vectores.
 * (Distinción central del proyecto, README §4.2.)
 */
export type SignType = 'static' | 'dynamic';

export interface StaticTemplate {
  signId: string;
  type: 'static';
  vector: number[];
}

export interface DynamicTemplate {
  signId: string;
  type: 'dynamic';
  /** Resampled sequence of feature vectors. */
  frames: number[][];
}

export type SignTemplate = StaticTemplate | DynamicTemplate;

export interface ClassifyResult {
  signId: string;
  /** Similarity in [0, 1]; higher is better. */
  score: number;
}
