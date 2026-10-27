import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db';
import { LSC_LESSONS, signId, syncCatalog } from '../src/catalog';

const count = (db: ReturnType<typeof openDb>, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('syncCatalog (D50)', () => {
  it('se puede correr varias veces sin duplicar nada', () => {
    const db = openDb(':memory:');
    syncCatalog(db);
    const before = [count(db, 'lessons'), count(db, 'signs')];
    syncCatalog(db);
    expect([count(db, 'lessons'), count(db, 'signs')]).toEqual(before);
  });

  it('en una base con datos, agrega lo nuevo y corrige lo cambiado sin tocar el progreso', () => {
    const db = openDb(':memory:');
    syncCatalog(db);
    db.prepare(
      "INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ('u1', 'a@b.co', 'x', 'A', '2026-10-01')",
    ).run();
    db.prepare(
      "INSERT INTO sign_progress (user_id, sign_id, mastered_at) VALUES ('u1', 'lsc-cortesia-5', '2026-10-01')",
    ).run();
    db.prepare("UPDATE signs SET validated = 1 WHERE id = 'lsc-cortesia-5'").run();
    // Una base vieja: le falta una seña y tiene otro título.
    db.prepare("DELETE FROM signs WHERE id = 'lsc-cortesia-9'").run();
    db.prepare("UPDATE lessons SET title = 'viejo' WHERE id = 'lsc-cortesia'").run();

    syncCatalog(db);

    expect(db.prepare("SELECT gloss FROM signs WHERE id = 'lsc-cortesia-9'").get()).toEqual({
      gloss: 'Permiso',
    });
    expect(db.prepare("SELECT title FROM lessons WHERE id = 'lsc-cortesia'").get()).toEqual({
      title: 'Normas de cortesía',
    });
    expect(count(db, 'sign_progress')).toBe(1);
    // La validación la pone la revisión con ICAL, no el catálogo.
    expect(db.prepare("SELECT validated FROM signs WHERE id = 'lsc-cortesia-5'").get()).toEqual({
      validated: 1,
    });
  });

  it('las señas con contenido conservan su id (progreso, plantillas y avatar dependen de él)', () => {
    const cortesia = LSC_LESSONS.find((l) => l.slug === 'cortesia')!;
    const ids = Object.fromEntries(cortesia.signs.map((s, i) => [signId('cortesia', s, i), s.gloss]));
    expect(ids).toMatchObject({
      'lsc-cortesia-0': 'Buenos días',
      'lsc-cortesia-1': 'Buenas tardes',
      'lsc-cortesia-3': 'Gracias',
      'lsc-cortesia-4': 'Por favor',
      'lsc-cortesia-5': 'Hola',
    });
  });

  it('los ids son únicos en todo el catálogo', () => {
    const ids = LSC_LESSONS.flatMap((l) => l.signs.map((s, i) => signId(l.slug, s, i)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada plantilla y cada animación del avatar apuntan a una seña del catálogo', () => {
    const ids = new Set(LSC_LESSONS.flatMap((l) => l.signs.map((s, i) => signId(l.slug, s, i))));
    const bundle = JSON.parse(
      readFileSync(new URL('../../web/public/templates/lsc-bundled.json', import.meta.url), 'utf8'),
    ) as { templates: { signId: string }[] };
    for (const t of bundle.templates) expect(ids, `plantilla ${t.signId}`).toContain(t.signId);
    // El registro del avatar es de la web (otro tsconfig): se leen sus claves del fuente.
    const animations = readFileSync(
      new URL('../../web/src/avatar/animations.ts', import.meta.url),
      'utf8',
    ).matchAll(/^\s+'(lsc-[a-z0-9-]+)':\s*\{/gm);
    const animationIds = [...animations].map((m) => m[1]!);
    expect(animationIds.length).toBeGreaterThan(0);
    for (const id of animationIds) expect(ids, `animación ${id}`).toContain(id);
  });
});
