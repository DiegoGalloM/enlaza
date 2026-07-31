import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { requireAuth } from '../auth';

const attemptSchema = {
  type: 'object',
  required: ['signId', 'correct'],
  properties: {
    signId: { type: 'string', minLength: 1 },
    correct: { type: 'boolean' },
    score: { type: 'number', minimum: 0, maximum: 1 },
  },
} as const;

export async function attemptRoutes(app: FastifyInstance, { db }: { db: DatabaseSync }) {
  app.post(
    '/api/attempts',
    { preHandler: requireAuth, schema: { body: attemptSchema } },
    async (request, reply) => {
      const userId = request.user!.sub;
      const { signId, correct, score } = request.body as {
        signId: string;
        correct: boolean;
        score?: number;
      };

      const sign = db
        .prepare('SELECT id, lesson_id FROM signs WHERE id = ?')
        .get(signId) as { id: string; lesson_id: string } | undefined;
      if (!sign) return reply.code(404).send({ error: 'Seña no encontrada' });

      const now = new Date().toISOString();
      db.prepare(
        'INSERT INTO attempts (user_id, sign_id, correct, score, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(userId, signId, correct ? 1 : 0, score ?? null, now);

      if (correct) {
        db.prepare(
          'INSERT OR IGNORE INTO sign_progress (user_id, sign_id, mastered_at) VALUES (?, ?, ?)',
        ).run(userId, signId, now);
      }

      const { n: masteredCount } = db
        .prepare(
          `SELECT COUNT(*) AS n FROM sign_progress sp
           JOIN signs s ON s.id = sp.sign_id
           WHERE sp.user_id = ? AND s.lesson_id = ?`,
        )
        .get(userId, sign.lesson_id) as { n: number };
      const { n: signCount } = db
        .prepare('SELECT COUNT(*) AS n FROM signs WHERE lesson_id = ?')
        .get(sign.lesson_id) as { n: number };

      const mastered = correct
        ? true
        : Boolean(
            db
              .prepare('SELECT 1 FROM sign_progress WHERE user_id = ? AND sign_id = ?')
              .get(userId, signId),
          );

      return reply.code(201).send({
        signId,
        mastered,
        lesson: {
          id: sign.lesson_id,
          masteredCount,
          signCount,
          completed: masteredCount >= signCount,
        },
      });
    },
  );
}
