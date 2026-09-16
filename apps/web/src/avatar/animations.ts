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
export interface SignAnimation {
  url: string;
  /**
   * Tramo del video que es la seña, en segundos: se deja fuera la preparación
   * y el regreso a reposo para que el avatar repita solo la seña. Se elige
   * viendo el video cuadro por cuadro (es una decisión sobre la seña, no un
   * umbral numérico) y se revisa con ICAL.
   */
  window?: [number, number];
}

const SIGN_ANIMATIONS: Record<string, SignAnimation> = {
  // Hola: la mano sube a la frente y se aleja (hasta 1.8 s). Después baja y
  // las manos se entrelazan en reposo, que no es parte de la seña. Empieza en
  // 0.15 s porque el video arranca con la mano ya en movimiento y antes no
  // hay datos con qué suavizar.
  'lsc-cortesia-5': { url: '/avatar/hola.landmarks.json', window: [0.15, 1.8] },
};

export function hasSignAnimation(signId: string): boolean {
  return signId in SIGN_ANIMATIONS;
}

export function signAnimationFor(signId: string): SignAnimation | null {
  return SIGN_ANIMATIONS[signId] ?? null;
}
