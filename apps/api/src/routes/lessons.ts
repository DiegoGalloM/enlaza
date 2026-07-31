import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';

interface LessonRow {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  position: number;
  sign_count: number;
}

export type LessonStatus = 'completed' | 'unlocked' | 'locked';

/**
 * Progression rule (MVP): the first lesson is always unlocked; every other
 * lesson unlocks when the previous one is completed.
 */
export function computeStatuses(
  lessons: { signCount: number; masteredCount: number }[],
): LessonStatus[] {
  const statuses: LessonStatus[] = [];
  for (let i = 0; i < lessons.length; i++) {
    const { signCount, masteredCount } = lessons[i]!;
    if (signCount > 0 && masteredCount >= signCount) {
      statuses.push('completed');
    } else if (i === 0 || statuses[i - 1] === 'completed') {
      statuses.push('unlocked');
    } else {
      statuses.push('locked');
    }
  }
  return statuses;
}

export async function lessonRoutes(app: FastifyInstance, { db }: { db: DatabaseSync }) {
  app.get('/api/languages', async () => {
    return { languages: db.prepare('SELECT id, name FROM languages ORDER BY id').all() };
  });

  app.get('/api/lessons', async (request) => {
    const { language = 'lsc' } = request.query as { language?: string };
    const rows = db
      .prepare(
        `SELECT l.id, l.slug, l.title, l.subtitle, l.position,
                (SELECT COUNT(*) FROM signs s WHERE s.lesson_id = l.id) AS sign_count
         FROM lessons l WHERE l.language_id = ? ORDER BY l.position`,
      )
      .all(language) as unknown as LessonRow[];

    const masteredByLesson = new Map<string, number>();
    if (request.user) {
      const mastered = db
        .prepare(
          `SELECT s.lesson_id AS lesson_id, COUNT(*) AS n
           FROM sign_progress sp JOIN signs s ON s.id = sp.sign_id
           WHERE sp.user_id = ? GROUP BY s.lesson_id`,
        )
        .all(request.user.sub) as unknown as { lesson_id: string; n: number }[];
      for (const row of mastered) masteredByLesson.set(row.lesson_id, row.n);
    }

    const withProgress = rows.map((row) => ({
      signCount: row.sign_count,
      masteredCount: masteredByLesson.get(row.id) ?? 0,
    }));
    const statuses = computeStatuses(withProgress);

    return {
      lessons: rows.map((row, i) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        subtitle: row.subtitle,
        position: row.position,
        signCount: row.sign_count,
        masteredCount: withProgress[i]!.masteredCount,
        status: statuses[i]!,
      })),
    };
  });

  app.get('/api/lessons/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const lesson = db
      .prepare('SELECT id, slug, title, subtitle, position FROM lessons WHERE id = ?')
      .get(id) as { id: string } | undefined;
    if (!lesson) return reply.code(404).send({ error: 'Lección no encontrada' });

    const masteredSet = new Set<string>();
    if (request.user) {
      const rows = db
        .prepare(
          `SELECT sp.sign_id FROM sign_progress sp
           JOIN signs s ON s.id = sp.sign_id
           WHERE sp.user_id = ? AND s.lesson_id = ?`,
        )
        .all(request.user.sub, id) as unknown as { sign_id: string }[];
      for (const row of rows) masteredSet.add(row.sign_id);
    }

    const signs = (
      db
        .prepare(
          `SELECT id, gloss, description, sign_type, position, validated
           FROM signs WHERE lesson_id = ? ORDER BY position`,
        )
        .all(id) as unknown as {
        id: string;
        gloss: string;
        description: string;
        sign_type: 'static' | 'dynamic';
        position: number;
        validated: number;
      }[]
    ).map((s) => ({
      id: s.id,
      gloss: s.gloss,
      description: s.description,
      signType: s.sign_type,
      position: s.position,
      validated: s.validated === 1,
      mastered: masteredSet.has(s.id),
    }));

    return { lesson, signs };
  });
}
