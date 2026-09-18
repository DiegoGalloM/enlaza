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
  // despegar la mano del pecho. La cabeza inclinada y el gesto de súplica
  // también son parte de la seña. Cara de súplica durante el contacto: cejas
  // levantadas por dentro y juntas, ojos entrecerrados y labios apretados en
  // puchero. Al retirar la mano (después del tramo) sonríe, y eso no es la seña.
  'lsc-cortesia-4': {
    gloss: 'Por favor',
    url: '/avatar/por-favor.landmarks.json',
    window: [0.37, 2.06],
    face: {
      Fcl_BRW_Sorrow: 0.8,
      Fcl_BRW_Angry: 0.3,
      Fcl_EYE_Sorrow: 0.6,
      Fcl_MTH_Angry: 0.6,
      Fcl_MTH_Small: 0.4,
    },
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
