/**
 * Animaciones de avatar disponibles, por seña.
 *
 * Cada una se genera con tools/avatar/extract-landmarks.mjs a partir del video
 * de referencia de ICAL, p. ej.:
 *   node tools/avatar/extract-landmarks.mjs content/ical-2026-09/hola.mp4 \
 *     apps/web/public/avatar/hola.landmarks.json
 *
 * Registro explícito (en vez de adivinar la ruta por signId) para que una seña
 * sin animación no dispare un 404 en cada lección.
 */
const SIGN_ANIMATIONS: Record<string, string> = {
  'lsc-cortesia-5': '/avatar/hola.landmarks.json', // Hola
};

export function hasSignAnimation(signId: string): boolean {
  return signId in SIGN_ANIMATIONS;
}

export function animationUrlFor(signId: string): string | null {
  return SIGN_ANIMATIONS[signId] ?? null;
}
