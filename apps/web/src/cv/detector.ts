import type { FaceBox, HandFrame } from '@enlaza/cv-model';

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
  /**
   * Proporción (ancho/alto) de las imágenes de un detector sin cámara. Con
   * cámara se lee del video (ver cameraAspect).
   */
  readonly aspect?: number;
}

/**
 * Proporción de la imagen que ve el detector, o null si aún no se conoce.
 * Hace falta para migrar plantillas grabadas antes de la corrección de
 * proporción (features v1) al abrir la cámara.
 */
export function cameraAspect(video: HTMLVideoElement, detector: HandDetector): number | null {
  if (!detector.needsCamera) return detector.aspect ?? null;
  return video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : null;
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
/**
 * Detector de caras: solo da la caja de la cara, que sirve de referencia para
 * el lugar de la mano (D37). No se analiza la expresión. BlazeFace de corto
 * alcance es el modelo de MediaPipe pensado para cámaras frontales (~230 KB,
 * ~1–2 ms por frame). Las plantillas se construyen con el mismo modelo.
 */
const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

/** Caja de la cara más grande del frame (la persona frente a la cámara), normalizada. */
function largestFace(
  detections: { boundingBox?: { originX: number; originY: number; width: number; height: number } }[],
  width: number,
  height: number,
): FaceBox | undefined {
  let largest: (typeof detections)[number]['boundingBox'];
  for (const { boundingBox: box } of detections) {
    if (box && (!largest || box.width * box.height > largest.width * largest.height)) largest = box;
  }
  return largest
    ? {
        x: (largest.originX + largest.width / 2) / width,
        y: (largest.originY + largest.height / 2) / height,
        width: largest.width / width,
        height: largest.height / height,
      }
    : undefined;
}

class MediaPipeDetector implements HandDetector {
  readonly needsCamera = true;
  private running = false;
  private rafId = 0;

  async start(video: HTMLVideoElement, onFrame: FrameListener): Promise<void> {
    const { FilesetResolver, HandLandmarker, FaceDetector } = await import('@mediapipe/tasks-vision');
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    const landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    // Si el detector de caras no carga, la práctica sigue funcionando: las
    // señas se comparan sin lugar, como antes de D37.
    const faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
    }).catch((err: unknown) => {
      console.warn('No se pudo cargar el detector de caras; se valida sin lugar', err);
      return null;
    });

    this.running = true;
    let lastVideoTime = -1;

    const loop = () => {
      if (!this.running) {
        landmarker.close();
        faceDetector?.close();
        return;
      }
      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        const result = landmarker.detectForVideo(video, now);
        const landmarks = result.landmarks[0];
        const handednessCategory = result.handedness[0]?.[0];
        if (landmarks && handednessCategory) {
          const face = faceDetector
            ? largestFace(
                faceDetector.detectForVideo(video, now).detections,
                video.videoWidth,
                video.videoHeight,
              )
            : undefined;
          onFrame({
            landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
            handedness: handednessCategory.categoryName === 'Left' ? 'Left' : 'Right',
            timestampMs: now,
            aspect: video.videoWidth / video.videoHeight,
            ...(face ? { face } : {}),
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
