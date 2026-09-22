/**
 * Animaciones de avatar disponibles, por seña.
 *
 * Cada una se genera con tools/avatar/extract-landmarks.mjs a partir del video
 * de referencia de ICAL, p. ej.:
 *   node tools/avatar/extract-landmarks.mjs content/ical-2026-09/hola.mp4 \
 *     apps/web/public/avatar/hola.landmarks.json   (--rate=0.0625 por defecto)
 *
 * Registro explícito (en vez de adivinar la ruta por signId) para que una seña
 * sin animación no dispare un 404 en cada lección.
 */
import type { FaceExpression } from './face';
import type { Handshape } from './retarget';

export interface SignAnimation {
  /** Glosa, solo para pantallas de revisión (la lección usa la del catálogo). */
  gloss: string;
  url: string;
  /**
   * Tramo del video que es la seña, en segundos: se deja fuera la preparación
   * y el regreso a reposo para que el avatar repita solo la seña. Se elige
   * viendo el video cuadro por cuadro (es una decisión sobre la seña, no un
   * umbral numérico) y se revisa con ICAL.
   */
  window?: [number, number];
  /**
   * Expresión de la cara durante la seña (gestos no manuales), con los morphs
   * del modelo. Describe lo que hace la señante en el video: no se extrae
   * porque MediaPipe no la captaba (A27). Se revisa con ICAL igual que el tramo.
   */
  face?: FaceExpression;
  /**
   * Configuración manual por mano, cuando la detección no la capta (dedos
   * ocultos, p. ej. un puño contra el pecho). Describe lo que se ve en el
   * video, como `face`, y se revisa con ICAL (A32).
   */
  handshape?: { left?: Handshape; right?: Handshape };
  /**
   * Tramo del video, en segundos, en que la yema del dedo medio toca la cara
   * (labios, mentón). MediaPipe no da bien la profundidad de la mano frente a
   * la cara y la dejaba flotando; con esto se apoya en la piel del modelo (A35).
   */
  faceContact?: { left?: [number, number]; right?: [number, number] };
  /**
   * Tramo del video en que la mano va con la palma hacia arriba, cuando la
   * detección de la mano no es confiable (p. ej. dos manos encimadas). La
   * orientación sale del antebrazo (A36).
   */
  palmUp?: { left?: [number, number]; right?: [number, number] };
  /**
   * Instante del video hasta el cual una mano se queda en la pose que tiene en
   * él: la mano de apoyo empieza ya en su lugar en vez de subir desde el
   * regazo, que es preparación y no seña (A37).
   */
  holdUntil?: { left?: number; right?: number };
  /**
   * Mano que hace la seña. La plantilla de reconocimiento la elegía por cuánto
   * se movía cada mano, y en Gracias, con las dos manos encimadas, el salto de
   * las detecciones confundidas daba la izquierda (A37).
   */
  hand?: 'left' | 'right';
}

const SIGN_ANIMATIONS: Record<string, SignAnimation> = {
  // Hola: la mano sube a la frente y se aleja (hasta 1.8 s). Después baja y
  // las manos se entrelazan en reposo, que no es parte de la seña. Empieza en
  // 0.15 s porque el video arranca con la mano ya en movimiento y antes no
  // hay datos con qué suavizar.
  // Cara: sonrisa abierta durante toda la seña.
  'lsc-cortesia-5': {
    gloss: 'Hola',
    url: '/avatar/hola.landmarks.json',
    window: [0.15, 1.8],
    face: { Fcl_MTH_Joy: 0.5, Fcl_EYE_Joy: 0.35, Fcl_BRW_Joy: 0.5 },
  },
  // Por favor: puño derecho apoyado en el lado izquierdo del pecho, con
  // círculos pequeños (0.37–2.03 s en el video). Antes la mano sube desde el
  // reposo y después se retira y las manos se entrelazan: nada de eso es la
  // seña. El tramo es solo el contacto, así el bucle repite los círculos sin
  // despegar la mano del pecho. La cabeza inclinada es parte de la seña.
  // Cara: la misma sonrisa que Hola. Primero se registró la cara de súplica
  // del video (cejas de tristeza, puchero), pero en el avatar se leía como
  // tristeza, no como cortesía (A29); queda pendiente revisarlo con ICAL.
  // Mano: puño cerrado (dedos ocultos contra el pecho; MediaPipe los daba a
  // medio doblar, A32).
  'lsc-cortesia-4': {
    gloss: 'Por favor',
    url: '/avatar/por-favor.landmarks.json',
    window: [0.37, 2.06],
    face: { Fcl_MTH_Joy: 0.5, Fcl_EYE_Joy: 0.35, Fcl_BRW_Joy: 0.5 },
    handshape: { right: 'puño' },
  },
  // Gracias: mano derecha plana (dedos juntos, pulgar al costado del índice)
  // con las yemas en los labios y el mentón (0.55–1.17 s en el video); luego
  // baja hacia el frente, gira la palma hacia arriba y se apoya con el dorso
  // sobre la palma izquierda, también plana y hacia arriba, a la altura del
  // abdomen (1.45–1.97 s). Antes la mano sube desde el reposo y después las
  // manos se entrelazan: nada de eso es la seña. La izquierda ya está palma
  // arriba desde el inicio del tramo.
  // Cara: la misma sonrisa que Hola (la señante sonríe toda la seña).
  // Manos: planas las dos (A35). Contacto: la yema toca la boca de 0.55 a
  // 1.17 s; MediaPipe la ponía 15 cm por delante de la cara.
  // Palmas arriba desde que la derecha se posa sobre la izquierda: ahí
  // MediaPipe confunde las dos manos encimadas (A36).
  // Mano izquierda: en el video descansa en el regazo y sube al frente a
  // 1.1–1.45 s, fuera de cuadro en el avatar. Es preparación: empieza ya en
  // su lugar, palma arriba al frente como a 1.5 s (A37).
  'lsc-cortesia-3': {
    gloss: 'Gracias',
    url: '/avatar/gracias.landmarks.json',
    window: [0.6, 2.0],
    face: { Fcl_MTH_Joy: 0.5, Fcl_EYE_Joy: 0.35, Fcl_BRW_Joy: 0.5 },
    handshape: { left: 'plana', right: 'plana' },
    faceContact: { right: [0.6, 1.17] },
    palmUp: { left: [1.42, 2.0], right: [1.42, 2.0] },
    holdUntil: { left: 1.5 },
    hand: 'right',
  },
};

export function listSignAnimations(): { signId: string; gloss: string }[] {
  return Object.entries(SIGN_ANIMATIONS).map(([signId, { gloss }]) => ({ signId, gloss }));
}

export function hasSignAnimation(signId: string): boolean {
  return signId in SIGN_ANIMATIONS;
}

export function signAnimationFor(signId: string): SignAnimation | null {
  return SIGN_ANIMATIONS[signId] ?? null;
}
