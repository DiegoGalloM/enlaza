import type { HandFrame } from '@enlaza/cv-model';

export type FrameListener = (frame: HandFrame | null) => void;

/**
 * Abstraction over the hand-landmark source so the practice screen can run
 * against MediaPipe in the browser and against a scripted fake in tests
 * (jsdom and Playwright have no real camera).
 */
export interface HandDetector {
  /** Begin emitting frames from the given video element. */
  start(video: HTMLVideoElement, onFrame: FrameListener): Promise<void>;
  stop(): void;
  /** True if this detector drives its own frames and needs no camera. */
  readonly needsCamera: boolean;
}

declare global {
  interface Window {
    /** Test hook: when set, practice screens use this instead of MediaPipe. */
    __enlazaFakeDetector?: () => HandDetector;
  }
}

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

class MediaPipeDetector implements HandDetector {
  readonly needsCamera = true;
  private running = false;
  private rafId = 0;

  async start(video: HTMLVideoElement, onFrame: FrameListener): Promise<void> {
    const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });

    this.running = true;
    let lastVideoTime = -1;

    const loop = () => {
      if (!this.running) {
        landmarker.close();
        return;
      }
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const result = landmarker.detectForVideo(video, performance.now());
        const landmarks = result.landmarks[0];
        const handednessCategory = result.handedness[0]?.[0];
        if (landmarks && handednessCategory) {
          onFrame({
            landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
            handedness: handednessCategory.categoryName === 'Left' ? 'Left' : 'Right',
            timestampMs: performance.now(),
          });
        } else {
          onFrame(null);
        }
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }
}

export function createDetector(): HandDetector {
  if (typeof window !== 'undefined' && window.__enlazaFakeDetector) {
    return window.__enlazaFakeDetector();
  }
  return new MediaPipeDetector();
}
