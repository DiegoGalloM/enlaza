import type { FaceBox, HandsFrame } from '@enlaza/cv-model';
import type { FaceDetector, HandLandmarker } from '@mediapipe/tasks-vision';
import { FACE_MODEL_URL, MODEL_URL, WASM_URL, loadModel } from './assets';
import { LightProcessor, type LightState } from './lighting';

/**
 * Recibe todas las manos que ve el detector en cada frame (hasta dos, D38), o
 * null si no ve ninguna. Quién la consume elige la mano de la seña con HandTracker.
 */
export type FrameListener = (frame: HandsFrame | null) => void;

/** Cambios en la luz de la cámara (D48): si se corrige y qué aviso dar. */
export type LightListener = (state: LightState) => void;

/**
 * Abstraction over the hand-landmark source so the practice screen can run
 * against MediaPipe in the browser and against a scripted fake in tests
 * (jsdom and Playwright have no real camera).
 */
export interface HandDetector {
  /** Begin emitting frames from the given video element. */
  start(video: HTMLVideoElement, onFrame: FrameListener, onLight?: LightListener): Promise<void>;
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

/**
 * Si detectar un cuadro tarda más que esto (promedio), el equipo no da para
 * todos los cuadros: se procesan menos, para que la página no se trabe (D49).
 */
const SLOW_DETECTION_MS = 35;
/** Nunca menos de 12 cuadros por segundo: las señas validan igual a ese ritmo (D42). */
const MAX_DETECTION_INTERVAL_MS = 1000 / 12;

type Delegate = 'GPU' | 'CPU';

class MediaPipeDetector implements HandDetector {
  readonly needsCamera = true;
  private running = false;
  private rafId = 0;

  async start(video: HTMLVideoElement, onFrame: FrameListener, onLight?: LightListener): Promise<void> {
    const [{ FilesetResolver, HandLandmarker, FaceDetector }, handModel, faceModel] = await Promise.all([
      import('@mediapipe/tasks-vision'),
      loadModel(MODEL_URL),
      loadModel(FACE_MODEL_URL),
    ]);
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    // El modelo sale de la caché del dispositivo si ya se bajó (assets.ts);
    // si no, MediaPipe lo baja de la URL.
    const model = (buffer: Uint8Array | null, url: string, delegate: Delegate) =>
      buffer ? { modelAssetBuffer: buffer, delegate } : { modelAssetPath: url, delegate };
    // GPU primero; si el navegador no la da (WebGL2 apagado, equipo viejo), CPU.
    const createLandmarker = (delegate: Delegate) =>
      HandLandmarker.createFromOptions(vision, {
        baseOptions: model(handModel, MODEL_URL, delegate),
        runningMode: 'VIDEO',
        // Dos manos (D38): con una sola, en señas de dos manos (Gracias) MediaPipe
        // devolvía la que mejor veía y la secuencia mezclaba las dos.
        numHands: 2,
      });
    let delegate: Delegate = 'GPU';
    const landmarker = await createLandmarker('GPU').catch((err: unknown) => {
      console.warn('Detector de manos sin GPU; se usa la CPU', err);
      delegate = 'CPU';
      return createLandmarker('CPU');
    });
    // Si el detector de caras no carga, la práctica sigue funcionando: las
    // señas se comparan sin lugar, como antes de D37.
    const faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: model(faceModel, FACE_MODEL_URL, delegate),
      runningMode: 'VIDEO',
    }).catch((err: unknown) => {
      console.warn('No se pudo cargar el detector de caras; se valida sin lugar', err);
      return null;
    });

    this.running = true;
    let lastVideoTime = -1;
    let lastDetectionMs = -Infinity;
    /** Promedio móvil de lo que tarda detectar un cuadro (luz + manos + cara). */
    let detectionCostMs = 0;
    let warned = false;
    // Con poca luz o contraluz, el detector ve una copia corregida del
    // cuadro; con buena luz, el video tal cual (D48).
    const light = new LightProcessor(onLight);

    const loop = () => {
      if (!this.running) {
        landmarker.close();
        faceDetector?.close();
        return;
      }
      const now = performance.now();
      const interval =
        detectionCostMs > SLOW_DETECTION_MS
          ? Math.min(detectionCostMs * 1.5, MAX_DETECTION_INTERVAL_MS)
          : 0;
      if (
        video.readyState >= 2 &&
        video.currentTime !== lastVideoTime &&
        now - lastDetectionMs >= interval
      ) {
        lastVideoTime = video.currentTime;
        lastDetectionMs = now;
        try {
          this.detect(video, light.frame(video, now), now, landmarker, faceDetector, onFrame);
        } catch (err) {
          // Un cuadro que falla no debe detener la práctica: se salta.
          if (!warned) console.warn('Falló la detección de un cuadro', err);
          warned = true;
        }
        detectionCostMs = detectionCostMs * 0.9 + (performance.now() - now) * 0.1;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  /** `image`: el cuadro que ve el detector (el video, o su copia con la luz corregida, D48). */
  private detect(
    video: HTMLVideoElement,
    image: HTMLVideoElement | HTMLCanvasElement,
    now: number,
    landmarker: HandLandmarker,
    faceDetector: FaceDetector | null,
    onFrame: FrameListener,
  ): void {
    const result = landmarker.detectForVideo(image, now);
    const hands = result.landmarks.flatMap((landmarks, i) => {
      const category = result.handedness[i]?.[0];
      return category
        ? [
            {
              landmarks: landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z })),
              handedness: category.categoryName === 'Left' ? ('Left' as const) : ('Right' as const),
            },
          ]
        : [];
    });
    if (hands.length > 0) {
      const face = faceDetector
        ? largestFace(
            faceDetector.detectForVideo(image, now).detections,
            // La caja viene en píxeles de la imagen que se le pasó (la copia corregida es más chica).
            image instanceof HTMLVideoElement ? image.videoWidth : image.width,
            image instanceof HTMLVideoElement ? image.videoHeight : image.height,
          )
        : undefined;
      onFrame({
        hands,
        timestampMs: now,
        aspect: video.videoWidth / video.videoHeight,
        ...(face ? { face } : {}),
      });
    } else {
      onFrame(null);
    }
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
