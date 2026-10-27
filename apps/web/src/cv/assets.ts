/**
 * Archivos del detector de manos (MediaPipe): de dónde salen y cómo se
 * guardan en el dispositivo (D49).
 *
 * - El WASM (11.5 MB) sale de jsDelivr: lo entrega comprimido con brotli
 *   (3.1 MB) y cacheable por un año (versión fija en la ruta). Servirlo desde
 *   la app no lo comprimiría igual en cualquier hosting.
 * - Los modelos salen de Google, que los deja en caché solo una hora: después,
 *   cada práctica espera una revalidación con el servidor antes de arrancar, y
 *   los navegadores de celular suelen sacar de su caché HTTP los archivos
 *   grandes (el de manos pesa 7.8 MB) y volver a bajarlos. Aquí se guardan en
 *   Cache Storage la primera vez y se leen de ahí, sin red.
 * - En la lección se pueden bajar de antemano (warmUpDetector), mientras la
 *   persona mira al avatar, para que la práctica arranque más rápido.
 */

export const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.0/wasm';
export const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
/**
 * Detector de caras: solo da la caja de la cara, que sirve de referencia para
 * el lugar de la mano (D37). No se analiza la expresión. BlazeFace de corto
 * alcance es el modelo de MediaPipe pensado para cámaras frontales (~230 KB,
 * ~1–2 ms por frame). Las plantillas se construyen con el mismo modelo.
 */
export const FACE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

/** Las URL de los modelos llevan su versión: si cambian, es otra entrada de la caché. */
const CACHE_NAME = 'enlaza-modelos-v1';

/**
 * Bytes del modelo, desde Cache Storage si ya se bajó, o de la red (y se
 * guarda). null si no se pudo: quien llama usa la URL directamente.
 */
export async function loadModel(url: string): Promise<Uint8Array | null> {
  try {
    if (typeof caches === 'undefined') return null;
    const cache = await caches.open(CACHE_NAME);
    let response = await cache.match(url);
    if (!response) {
      const fresh = await fetch(url);
      if (!fresh.ok) return null;
      await cache.put(url, fresh.clone());
      response = fresh;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/** Con ahorro de datos activado o red 2G, no se baja nada de antemano. */
function saveData(): boolean {
  const connection = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  return Boolean(connection?.saveData || /2g/.test(connection?.effectiveType ?? ''));
}

let warmedUp = false;

/**
 * Baja de antemano el WASM y los modelos (una vez por carga de la app), en un
 * momento ocioso. No bloquea ni falla: si algo no baja, la práctica lo baja.
 */
export function warmUpDetector(): void {
  if (warmedUp || typeof window === 'undefined' || saveData()) return;
  warmedUp = true;
  const run = () => {
    for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
      void fetch(`${WASM_URL}/${file}`).catch(() => {});
    }
    void loadModel(MODEL_URL);
    void loadModel(FACE_MODEL_URL);
  };
  const idle = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
    .requestIdleCallback;
  if (idle) idle(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}
