import type { DatabaseSync } from 'node:sqlite';

/**
 * MVP curriculum: the 7 confirmed lessons (README §6), LSC only.
 *
 * IMPORTANT: all sign descriptions here are provisional placeholders written
 * for development (`validated: 0` in the schema). None have been reviewed by
 * ICAL or a native LSC signer yet — they MUST NOT be presented as verified
 * sign-language instruction until that validation happens (README §4.3).
 */
interface SignSeed {
  /**
   * Id estable de la seña (D50). Lo usan el progreso de cada persona, las
   * plantillas de reconocimiento y el avatar, así que nunca debe cambiar. Sin
   * él vale `<lección>-<posición>`, que cambia si se inserta una seña antes:
   * las señas nuevas que no vayan al final deben traer id propio.
   */
  id?: string;
  gloss: string;
  type: 'static' | 'dynamic';
  description?: string;
}

interface LessonSeed {
  slug: string;
  title: string;
  subtitle: string;
  signs: SignSeed[];
}

const letters = (chars: string[], dynamicSet: Set<string>): SignSeed[] =>
  chars.map((c) => ({ gloss: c, type: dynamicSet.has(c) ? 'dynamic' : 'static' }));

const words = (glosses: string[]): SignSeed[] =>
  glosses.map((gloss) => ({ gloss, type: 'dynamic' }));

export const LSC_LESSONS: LessonSeed[] = [
  // Orden pedagógico dado por Victoria Olmos (ICAL/FENASCOL, reunión sept 2026):
  // primero el "bautizo" (nombre-seña de la persona oyente), luego las normas
  // de cortesía, y después el abecedario (content/ical-2026-09/content-brief.md).
  {
    slug: 'bautizo',
    title: 'Bautizo',
    subtitle: 'Tu nombre-seña',
    signs: [
      {
        gloss: 'Mi nombre-seña',
        type: 'dynamic',
        description:
          'En la comunidad sorda cada persona recibe un nombre-seña; el "bautizo" es ' +
          'recibirlo. Idealmente te lo asigna una persona sorda. Graba el tuyo como ' +
          'plantilla personal en la página de calibración y practícalo aquí. ' +
          '(El nombre-seña del avatar de Enlaza está pendiente de definir con ICAL.)',
      },
    ],
  },
  {
    // Las 10 señas con video de referencia de ICAL, en el orden del brief.
    // Ids explícitos: las plantillas y el avatar ya los usan (D50).
    slug: 'cortesia',
    title: 'Normas de cortesía',
    subtitle: '10 señas',
    signs: [
      { id: 'lsc-cortesia-0', gloss: 'Buenos días', type: 'dynamic' },
      { id: 'lsc-cortesia-1', gloss: 'Buenas tardes', type: 'dynamic' },
      { id: 'lsc-cortesia-2', gloss: 'Buenas noches', type: 'dynamic' },
      { id: 'lsc-cortesia-3', gloss: 'Gracias', type: 'dynamic' },
      { id: 'lsc-cortesia-4', gloss: 'Por favor', type: 'dynamic' },
      { id: 'lsc-cortesia-5', gloss: 'Hola', type: 'dynamic' },
      { id: 'lsc-cortesia-6', gloss: 'Con mucho gusto', type: 'dynamic' },
      { id: 'lsc-cortesia-7', gloss: 'Lo siento', type: 'dynamic' },
      { id: 'lsc-cortesia-8', gloss: '¿Cómo está?', type: 'dynamic' },
      { id: 'lsc-cortesia-9', gloss: 'Permiso', type: 'dynamic' },
    ],
  },
  {
    slug: 'alfabeto-1',
    title: 'Alfabeto I',
    subtitle: 'A – M',
    signs: letters(
      ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M'],
      new Set(['J']),
    ),
  },
  {
    slug: 'alfabeto-2',
    title: 'Alfabeto II',
    subtitle: 'N – Z',
    signs: letters(
      ['N', 'Ñ', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
      new Set(['Ñ', 'X', 'Z']),
    ),
  },
  {
    slug: 'numeros',
    title: 'Números 1 – 20',
    subtitle: '20 señas',
    signs: Array.from({ length: 20 }, (_, i): SignSeed => {
      const n = i + 1;
      return { gloss: String(n), type: n <= 10 ? 'static' : 'dynamic' };
    }),
  },
  {
    slug: 'preguntas',
    title: 'Preguntas esenciales',
    subtitle: '6 señas',
    signs: words(['¿Cómo estás?', '¿Qué necesitas?', 'Sí', 'No', '¿Dónde?', '¿Quién?']),
  },
  {
    slug: 'salud',
    title: 'Salud y atención',
    subtitle: '6 señas',
    signs: words(['Dolor', 'Médico', 'Ayuda', 'Cita', 'Medicina', 'Hospital']),
  },
  {
    slug: 'emociones',
    title: 'Emociones',
    subtitle: '6 señas',
    signs: words(['Feliz', 'Triste', 'Enojado', 'Cansado', 'Nervioso', 'Tranquilo']),
  },
];

/** Id de cada seña del catálogo: el explícito, o el de su posición (señas viejas). */
export function signId(lessonSlug: string, sign: SignSeed, index: number): string {
  return sign.id ?? `lsc-${lessonSlug}-${index}`;
}

/**
 * Lleva el catálogo de este archivo a la base de datos, también a una que ya
 * existe (D50). Antes solo se cargaba si la base estaba vacía, así que una
 * lección o seña nueva nunca llegaba a una instalación con datos. Ahora se
 * insertan las nuevas y se actualizan título, glosa, descripción, tipo y
 * orden de las existentes, por id, sin tocar el progreso ni la marca de
 * validación (`validated` la pone la revisión con ICAL, no este archivo).
 *
 * Quitar una seña de aquí no la borra de la base (tiene intentos y progreso
 * de personas): sigue apareciendo hasta que se retire a mano.
 */
export function syncCatalog(db: DatabaseSync): void {
  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO languages (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name',
    ).run('lsc', 'Lengua de Señas Colombiana');

    const upsertLesson = db.prepare(
      `INSERT INTO lessons (id, language_id, slug, title, subtitle, position) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, title = excluded.title,
         subtitle = excluded.subtitle, position = excluded.position`,
    );
    // Las posiciones son únicas por lección: se apartan antes de reordenar.
    const clearPositions = db.prepare(
      'UPDATE signs SET position = -1 - position WHERE lesson_id = ? AND position >= 0',
    );
    const upsertSign = db.prepare(
      `INSERT INTO signs (id, lesson_id, gloss, description, sign_type, position, validated)
       VALUES (?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(id) DO UPDATE SET lesson_id = excluded.lesson_id, gloss = excluded.gloss,
         description = excluded.description, sign_type = excluded.sign_type,
         position = excluded.position`,
    );

    LSC_LESSONS.forEach((lesson, li) => {
      const lessonId = `lsc-${lesson.slug}`;
      upsertLesson.run(lessonId, 'lsc', lesson.slug, lesson.title, lesson.subtitle, li);
      clearPositions.run(lessonId);
      lesson.signs.forEach((sign, si) => {
        upsertSign.run(
          signId(lesson.slug, sign, si),
          lessonId,
          sign.gloss,
          sign.description ??
            `Seña de "${sign.gloss}" en LSC. Descripción pendiente de validación con ICAL.`,
          sign.type,
          si,
        );
      });
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
