import type { SignTemplate } from '@enlaza/cv-model';

/**
 * Sign templates live in localStorage for the MVP: they are recorded by the
 * user on the calibration page (/plantillas) from the reference material
 * (e.g. the LSC alphabet video, README §4.3) and never leave the device —
 * landmark data is biometric-adjacent, so keeping it local is deliberate
 * (README §11). Export/import as JSON allows sharing a curated template set
 * with the team until a proper trained model replaces this.
 */
const STORAGE_KEY = 'enlaza.templates.lsc.v1';

export interface TemplateStore {
  version: 1;
  templates: SignTemplate[];
}

export function loadTemplates(): SignTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TemplateStore;
    return parsed.version === 1 && Array.isArray(parsed.templates) ? parsed.templates : [];
  } catch {
    return [];
  }
}

export function saveTemplates(templates: SignTemplate[]): void {
  const store: TemplateStore = { version: 1, templates };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
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
  return JSON.stringify({ version: 1, templates: loadTemplates() } satisfies TemplateStore, null, 2);
}

export function importTemplates(json: string): SignTemplate[] {
  const parsed = JSON.parse(json) as TemplateStore;
  if (parsed.version !== 1 || !Array.isArray(parsed.templates)) {
    throw new Error('Formato de plantillas no reconocido');
  }
  saveTemplates(parsed.templates);
  return parsed.templates;
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
    return parsed.version === 1 && Array.isArray(parsed.templates) ? parsed.templates : [];
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
