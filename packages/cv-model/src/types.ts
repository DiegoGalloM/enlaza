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

/**
 * Caja de la cara en la imagen (centro y tamaño, en coordenadas normalizadas
 * como los landmarks). Solo sirve de referencia para el lugar de la mano
 * (location.ts); no se analiza la expresión.
 */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single captured frame of one hand. */
export interface HandFrame {
  landmarks: Landmark[];
  handedness: Handedness;
  /** Milliseconds, monotonic (e.g. video timestamp). */
  timestampMs: number;
  /**
   * Proporción (ancho / alto) de la imagen de la que salieron los landmarks.
   * Obligatoria: sin ella las features dependen de la cámara (ver toFeatureVector).
   */
  aspect: number;
  /** Cara detectada en el mismo frame, si la hay (lugar de la seña, D37). */
  face?: FaceBox;
}

/** Una mano detectada en un frame, sin decidir aún si es la que hace la seña. */
export interface DetectedHand {
  landmarks: Landmark[];
  handedness: Handedness;
}

/**
 * Todas las manos que ve el detector en un frame (hasta dos, D38). HandTracker
 * elige de aquí la mano que hace la seña y la convierte en HandFrame.
 */
export interface HandsFrame {
  hands: DetectedHand[];
  timestampMs: number;
  aspect: number;
  face?: FaceBox;
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
  /**
   * Duración real de la seña de la que salió la plantilla, en ms.
   * La comparación DTW es de ventana completa contra plantilla completa, así
   * que la ventana de captura tiene que durar lo que dura la seña: con una
   * ventana más corta solo entra un pedazo, y con una mucho más larga entran
   * frames de reposo que ensucian la comparación. Opcional: las plantillas
   * grabadas en /plantillas no la traen y usan la ventana por defecto.
   */
  sourceMs?: number;
  /**
   * Trayectoria de la muñeca (SEQUENCE_LENGTH × [x, y], en largos de mano,
   * centrada; ver motion.ts). Opcional: plantillas sin movimiento se comparan
   * solo por forma.
   */
  motion?: number[][];
  /**
   * Lugar de la mano respecto a la cara (SEQUENCE_LENGTH × [x, y], en altos
   * de cara, sin centrar; ver location.ts). Opcional: plantillas sin lugar no
   * lo exigen.
   */
  location?: number[][];
  /**
   * Mano con la que se hace la seña, si está registrada (D38). Con dos manos
   * en cuadro, la práctica sigue a esta y no a la de apoyo. Opcional: sin
   * ella se sigue a la primera mano que aparezca.
   */
  hand?: Handedness;
}

export type SignTemplate = StaticTemplate | DynamicTemplate;

/**
 * Desglose del puntaje de una seña dinámica: score = forma × lugar × movimiento.
 * Sirve para decir qué falló (retroalimentación en la práctica) y para medir.
 */
export interface DynamicDetail {
  /** Similitud DTW de forma de la mano (+ recorrido de la muñeca), antes de compuertas. */
  shape: number;
  /**
   * Rotación media de la mano respecto a la plantilla, en grados, sobre los
   * frames que alinea DTW (D39). Alta = la palma o los dedos miran a otro lado.
   */
  orientationDeg?: number;
  /** Error medio de lugar en altos de cara, si se evaluó. */
  locationError?: number;
  /**
   * Desplazamiento medio del lugar (captura − plantilla), en altos de cara:
   * [x hacia el lado de la mano, y hacia abajo]. Dice hacia dónde corregir.
   */
  locationOffset?: [number, number];
  /** Factor de la compuerta de lugar (1 = sin castigo). */
  locationFactor: number;
  /** Movimiento de la captura / movimiento de la plantilla, si se evaluó. */
  motionRatio?: number;
  /** Factor de la compuerta de cantidad de movimiento (1 = sin castigo). */
  motionFactor: number;
  /** Duración de la ventana que dio este puntaje, en ms (la elige SessionValidator). */
  windowMs?: number;
}

export interface ClassifyResult {
  signId: string;
  /** Similarity in [0, 1]; higher is better. */
  score: number;
  /** Solo en señas dinámicas. */
  detail?: DynamicDetail;
}
