import { migrateFeatureVector } from './normalize';
import type { SignTemplate } from './types';

/**
 * Migra una plantilla v1 a la definición de features actual (v2), dada la
 * proporción de la cámara con la que se grabó. Ver migrateFeatureVector.
 */
export function migrateTemplate(template: SignTemplate, aspect: number): SignTemplate {
  return template.type === 'static'
    ? { ...template, vector: migrateFeatureVector(template.vector, aspect) }
    : { ...template, frames: template.frames.map((f) => migrateFeatureVector(f, aspect)) };
}
