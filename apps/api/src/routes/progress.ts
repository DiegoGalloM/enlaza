import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { requireAuth } from '../auth';

/** Local calendar date (YYYY-MM-DD) for a Date. */
function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Streak = consecutive days with at least one attempt, counting back from
 * today (or yesterday, so the streak isn't "lost" before practicing today).
 */
export function computeStreak(activeDates: Set<string>, today = new Date()): number {
  let streak = 0;
  const cursor = new Date(today);
  if (!activeDates.has(localDate(cursor))) {
    cursor.setDate(cursor.getDate() - 1); // allow starting from yesterday
  }
  while (activeDates.has(localDate(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export async function progressRoutes(app: FastifyInstance, { db }: { db: DatabaseSync }) {
  app.get('/api/me/progress', { preHandler: requireAuth }, async (request) => {
    const userId = request.user!.sub;

    const lessons = (
      db
        .prepare(
          `SELECT l.id, l.title, l.position,
                  (SELECT COUNT(*) FROM signs s WHERE s.lesson_id = l.id) AS sign_count,
                  (SELECT COUNT(*) FROM sign_progress sp
                     JOIN signs s2 ON s2.id = sp.sign_id
                     WHERE sp.user_id = ? AND s2.lesson_id = l.id) AS mastered_count
           FROM lessons l WHERE l.language_id = 'lsc' ORDER BY l.position`,
        )
        .all(userId) as unknown as {
        id: string;
        title: string;
        position: number;
        sign_count: number;
        mastered_count: number;
      }[]
    ).map((row) => ({
      id: row.id,
      title: row.title,
      signCount: row.sign_count,
      masteredCount: row.mastered_count,
      percent: row.sign_count === 0 ? 0 : Math.round((row.mastered_count / row.sign_count) * 100),
    }));

    const attemptDates = db
      .prepare('SELECT created_at FROM attempts WHERE user_id = ?')
      .all(userId) as unknown as { created_at: string }[];
    const activeDates = new Set(attemptDates.map((row) => localDate(new Date(row.created_at))));

    const today = new Date();
    const streakDays = computeStreak(activeDates, today);

    // Current week, Monday-first (design shows L M M J V S D).
    const monday = new Date(today);
    const dow = (today.getDay() + 6) % 7; // 0 = Monday
    monday.setDate(today.getDate() - dow);
    const weekActivity = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return { date: localDate(d), active: activeDates.has(localDate(d)) };
    });

    const totalMastered = lessons.reduce((sum, l) => sum + l.masteredCount, 0);
    const totalSigns = lessons.reduce((sum, l) => sum + l.signCount, 0);

    const alphabet = lessons.filter((l) => l.id.includes('alfabeto'));
    const alphabetDone =
      alphabet.length > 0 && alphabet.every((l) => l.masteredCount >= l.signCount);
    const allDone = lessons.every((l) => l.masteredCount >= l.signCount);

    const achievements = [
      {
        id: 'alfabeto-completo',
        title: 'Alfabeto completo',
        detail: `${alphabet.reduce((s, l) => s + l.signCount, 0)} letras validadas`,
        earned: alphabetDone,
      },
      {
        id: 'primera-semana',
        title: 'Primera semana',
        detail: `${Math.min(streakDays, 7)} días de práctica`,
        earned: streakDays >= 6,
      },
      {
        id: 'conversacion-basica',
        title: 'Conversación básica',
        detail: 'al terminar el nivel 1',
        earned: allDone,
      },
    ];

    return {
      displayName: request.user!.name,
      totalMastered,
      totalSigns,
      streakDays,
      weekActivity,
      lessons,
      achievements,
    };
  });
}
