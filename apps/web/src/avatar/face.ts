import * as THREE from 'three';
import { VRMExpression, VRMExpressionMorphTargetBind, type VRM } from '@pixiv/three-vrm';

/**
 * Gestos no manuales de una seña en el avatar: la expresión de la cara que
 * acompaña a la seña (en Hola y Por favor, una sonrisa) y un parpadeo en el
 * cierre del bucle.
 *
 * La expresión se REGISTRA por seña en animations.ts, no se extrae del video
 * (A27): los coeficientes de cara de MediaPipe no la captaban en los videos de
 * ICAL. En Por favor marcaban sonrisa (0.6) durante el puchero, casi como la
 * sonrisa real de después (0.9), y el puchero y el ceño casi no aparecían. Se
 * describe lo que se ve en el video con los morphs del modelo, igual que el
 * tramo de la seña, y queda para revisar con ICAL.
 */

/**
 * Morphs de la cara del modelo VRoid que se usan en las expresiones. Son
 * morph targets de la malla, no expresiones VRM: el modelo solo trae
 * expresiones de cara completa (happy, sad…), que no combinan cejas de un
 * gesto con boca de otro.
 */
export type FaceMorph =
  | 'Fcl_BRW_Angry'
  | 'Fcl_BRW_Fun'
  | 'Fcl_BRW_Joy'
  | 'Fcl_BRW_Sorrow'
  | 'Fcl_BRW_Surprised'
  | 'Fcl_EYE_Angry'
  | 'Fcl_EYE_Fun'
  | 'Fcl_EYE_Joy'
  | 'Fcl_EYE_Sorrow'
  | 'Fcl_EYE_Surprised'
  | 'Fcl_MTH_Angry'
  | 'Fcl_MTH_Down'
  | 'Fcl_MTH_Fun'
  | 'Fcl_MTH_Joy'
  | 'Fcl_MTH_Small'
  | 'Fcl_MTH_Sorrow'
  | 'Fcl_MTH_Up';

/** Pesos 0–1 por morph. */
export type FaceExpression = Partial<Record<FaceMorph, number>>;

/** Nombre de la expresión VRM que se registra para la seña. */
const SIGN_EXPRESSION = 'enlazaSena';

/** Duración del parpadeo: cierre rápido y apertura algo más lenta, como el real. */
const BLINK_CLOSE_SECONDS = 0.06;
const BLINK_OPEN_SECONDS = 0.1;
/** Parpadea en el cierre del bucle cada tantos ciclos (~4 s con ciclos de ~2 s). */
const BLINK_EVERY_CYCLES = 2;

/**
 * Peso del parpadeo (0 abierto, 1 cerrado) en el instante `t` del ciclo
 * número `cycle`. Ocurre en medio del regreso al inicio, que es el límite
 * entre repeticiones: ahí parpadean también las personas señantes, y en
 * medio de la seña se leería como parte de ella.
 */
export function blinkWeight(
  t: number,
  cycle: number,
  returnStart: number,
  duration: number,
): number {
  if (cycle % BLINK_EVERY_CYCLES !== BLINK_EVERY_CYCLES - 1) return 0;
  const start = (returnStart + duration) / 2 - BLINK_CLOSE_SECONDS;
  const x = t - start;
  if (x <= 0) return 0;
  if (x < BLINK_CLOSE_SECONDS) return Math.sin((x / BLINK_CLOSE_SECONDS) * (Math.PI / 2));
  const opening = (x - BLINK_CLOSE_SECONDS) / BLINK_OPEN_SECONDS;
  return opening < 1 ? Math.cos(opening * (Math.PI / 2)) : 0;
}

/**
 * Suma de los morphs de ojos de la expresión. Cerrar el párpado encima de
 * unos ojos ya entrecerrados (súplica, sonrisa) pasa de largo y la malla se
 * deforma; el parpadeo se reduce en esa proporción.
 */
function eyeAmount(expression: FaceExpression): number {
  let sum = 0;
  for (const [morph, weight] of Object.entries(expression)) {
    if (morph.startsWith('Fcl_EYE_')) sum += weight ?? 0;
  }
  return Math.min(sum, 1);
}

export interface SignFace {
  /** `weight` mezcla la expresión con la cara neutra (0 = neutra); `blink` 0–1. */
  apply(weight: number, blink: number): void;
}

/**
 * Registra la expresión de la seña en el VRM. Los morphs que el modelo no
 * tenga se ignoran (con aviso), para que otro modelo no rompa el avatar.
 */
export function createSignFace(vrm: VRM, expression: FaceExpression = {}): SignFace {
  const manager = vrm.expressionManager;
  if (!manager) return { apply() {} };

  const existing = manager.getExpression(SIGN_EXPRESSION);
  if (existing) manager.unregisterExpression(existing);
  const signExpression = new VRMExpression(SIGN_EXPRESSION);
  for (const [morph, weight] of Object.entries(expression)) {
    let found = false;
    vrm.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      const dictionary = mesh.morphTargetDictionary;
      if (!dictionary) return;
      // Los nombres pueden venir con prefijo de la malla (Face_Blendshape.Fcl_…).
      const key = Object.keys(dictionary).find((name) => name === morph || name.endsWith(`.${morph}`));
      if (key === undefined) return;
      found = true;
      signExpression.addBind(
        new VRMExpressionMorphTargetBind({ primitives: [mesh], index: dictionary[key]!, weight: weight ?? 0 }),
      );
    });
    if (!found) console.warn(`El modelo no tiene el morph ${morph}; se ignora.`);
  }
  manager.registerExpression(signExpression);

  const blinkScale = 1 - 0.3 * eyeAmount(expression);
  return {
    apply(weight: number, blink: number) {
      manager.setValue(SIGN_EXPRESSION, weight);
      manager.setValue('blink', blink * blinkScale);
    },
  };
}
