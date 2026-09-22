import { FEATURE_VERSION, migrateTemplate } from '@enlaza/cv-model';
import type { SignTemplate } from '@enlaza/cv-model';

/**
 * Sign templates live in localStorage for the MVP: they are recorded by the
 * user on the calibration page (/plantillas) from the reference material
 * (e.g. the LSC alphabet video, README §4.3) and never leave the device —
 * landmark data is biometric-adjacent, so keeping it local is deliberate
 * (README §11). Export/import as JSON allows sharing a curated template set
 * with the team until a proper trained model replaces this.
 */
const STORAGE_KEY = 'enlaza.templates.lsc.v2';

/**
 * Plantillas con features v1 (antes de corregir la proporción de la cámara,
 * sept 2026). No se usan tal cual: se migran con migrateLegacyTemplates en
 * cuanto se abre la cámara del dispositivo, que es la que las grabó.
 */
const LEGACY_STORAGE_KEY = 'enlaza.templates.lsc.v1';

/** La versión del archivo es la versión de features de sus plantillas. */
export interface TemplateStore {
  version: typeof FEATURE_VERSION;
  templates: SignTemplate[];
}

interface LegacyTemplateStore {
  version: 1;
  templates: SignTemplate[];
}

function readStore(key: string, version: number): SignTemplate[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version: number; templates: SignTemplate[] };
    return parsed.version === version && Array.isArray(parsed.templates) ? parsed.templates : [];
  } catch {
    return [];
  }
}

export function loadTemplates(): SignTemplate[] {
  return readStore(STORAGE_KEY, FEATURE_VERSION);
}

export function saveTemplates(templates: SignTemplate[]): void {
  const store: TemplateStore = { version: FEATURE_VERSION, templates };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Señas con plantilla v1 pendiente de migrar en este dispositivo. */
export function legacyTemplateIds(): Set<string> {
  return new Set(readStore(LEGACY_STORAGE_KEY, 1).map((t) => t.signId));
}

/**
 * Migra a v2 las plantillas v1 de este dispositivo usando la proporción de su
 * cámara, las guarda y borra las v1. Si una seña ya tiene plantilla v2 (se
 * regrabó después), gana la v2. Devuelve solo las plantillas migradas que
 * quedaron en uso; vacío si no había nada que migrar.
 */
export function migrateLegacyTemplates(aspect: number): SignTemplate[] {
  const legacy = readStore(LEGACY_STORAGE_KEY, 1);
  if (legacy.length === 0) return [];
  const current = loadTemplates();
  const currentIds = new Set(current.map((t) => t.signId));
  const migrated = legacy
    .filter((t) => !currentIds.has(t.signId))
    .map((t) => migrateTemplate(t, aspect));
  saveTemplates([...current, ...migrated]);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  return migrated;
}

export function upsertTemplate(template: SignTemplate): SignTemplate[] {
  const rest = loadTemplates().filter((t) => t.signId !== template.signId);
  const next = [...rest, template];
  saveTemplates(next);
  return next;
}

export function removeTemplate(signId: string): SignTemplate[] {
  const next = loadTemplates().filter((t) => t.signId !== signId);
  saveTemplates(next);
  return next;
}

export function exportTemplates(): string {
  return JSON.stringify(
    { version: FEATURE_VERSION, templates: loadTemplates() } satisfies TemplateStore,
    null,
    2,
  );
}

/**
 * Proporción supuesta para archivos v1 importados: vienen de otro
 * dispositivo cuya cámara no conocemos. 16:9 es lo que la app pide a la
 * cámara (960×540), así que es el caso más probable.
 */
export const LEGACY_IMPORT_ASPECT = 16 / 9;

export function importTemplates(json: string): SignTemplate[] {
  const parsed = JSON.parse(json) as TemplateStore | LegacyTemplateStore;
  if (!Array.isArray(parsed.templates)) throw new Error('Formato de plantillas no reconocido');
  let templates: SignTemplate[];
  if (parsed.version === FEATURE_VERSION) templates = parsed.templates;
  else if (parsed.version === 1) {
    templates = parsed.templates.map((t) => migrateTemplate(t, LEGACY_IMPORT_ASPECT));
  } else throw new Error('Formato de plantillas no reconocido');
  saveTemplates(templates);
  return templates;
}

/**
 * Plantillas empaquetadas con la app: derivadas de los videos de referencia
 * de ICAL por tools/content/build-templates.mjs (contenido provisional, sin
 * validar). No contienen datos del usuario — son de la señante de los videos
 * fuente — así que sí pueden distribuirse con la app.
 */
const BUNDLED_URL = '/templates/lsc-bundled.json';

export async function fetchBundledTemplates(): Promise<SignTemplate[]> {
  try {
    const res = await fetch(BUNDLED_URL);
    if (!res.ok) return [];
    const parsed = (await res.json()) as TemplateStore;
    // Un bundle de otra versión de features no es comparable: mejor sin
    // plantilla (la práctica lo dice) que validar contra vectores deformados.
    return parsed.version === FEATURE_VERSION && Array.isArray(parsed.templates)
      ? parsed.templates
      : [];
  } catch {
    return [];
  }
}

/** Combina plantillas: las grabadas en este dispositivo pisan a las empaquetadas. */
export function mergeTemplates(
  bundled: SignTemplate[],
  local: SignTemplate[],
): SignTemplate[] {
  const localIds = new Set(local.map((t) => t.signId));
  return [...bundled.filter((t) => !localIds.has(t.signId)), ...local];
}
