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
    slug: 'cortesia',
    title: 'Normas de cortesía',
    subtitle: '10 señas',
    signs: words([
      'Buenos días',
      'Buenas tardes',
      'Buenas noches',
      'Gracias',
      'Por favor',
      'Hola',
      'Con mucho gusto',
      'Lo siento',
      '¿Cómo está?',
      'Permiso',
    ]),
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

export function seedCatalog(db: DatabaseSync): void {
  const hasLsc = db.prepare('SELECT 1 FROM languages WHERE id = ?').get('lsc');
  if (hasLsc) return;

  db.prepare('INSERT INTO languages (id, name) VALUES (?, ?)').run(
    'lsc',
    'Lengua de Señas Colombiana',
  );

  const insertLesson = db.prepare(
    'INSERT INTO lessons (id, language_id, slug, title, subtitle, position) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertSign = db.prepare(
    `INSERT INTO signs (id, lesson_id, gloss, description, sign_type, position, validated)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
  );

  LSC_LESSONS.forEach((lesson, li) => {
    const lessonId = `lsc-${lesson.slug}`;
    insertLesson.run(lessonId, 'lsc', lesson.slug, lesson.title, lesson.subtitle, li);
    lesson.signs.forEach((sign, si) => {
      insertSign.run(
        `${lessonId}-${si}`,
        lessonId,
        sign.gloss,
        sign.description ??
          `Seña de "${sign.gloss}" en LSC. Descripción pendiente de validación con ICAL.`,
        sign.type,
        si,
      );
    });
  });
}
