import { describe, expect, it } from 'vitest';
import { computeStatuses } from '../src/routes/lessons';
import { auth, registerUser, testApp } from './helpers';

describe('computeStatuses', () => {
  it('unlocks only the first lesson for a new user', () => {
    const statuses = computeStatuses([
      { signCount: 5, masteredCount: 0 },
      { signCount: 5, masteredCount: 0 },
      { signCount: 5, masteredCount: 0 },
    ]);
    expect(statuses).toEqual(['unlocked', 'locked', 'locked']);
  });

  it('unlocks the next lesson when the previous is completed', () => {
    const statuses = computeStatuses([
      { signCount: 2, masteredCount: 2 },
      { signCount: 5, masteredCount: 3 },
      { signCount: 5, masteredCount: 0 },
    ]);
    expect(statuses).toEqual(['completed', 'unlocked', 'locked']);
  });
});

describe('GET /api/lessons', () => {
  it('returns the 7 MVP lessons with sign counts', async () => {
    const app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/lessons?language=lsc' });
    expect(res.statusCode).toBe(200);
    const { lessons } = res.json() as {
      lessons: { slug: string; signCount: number; status: string }[];
    };
    expect(lessons).toHaveLength(7);
    expect(lessons[0]).toMatchObject({ slug: 'alfabeto-1', signCount: 13, status: 'unlocked' });
    expect(lessons.map((l) => l.slug)).toEqual([
      'alfabeto-1',
      'alfabeto-2',
      'saludos',
      'numeros',
      'preguntas',
      'salud',
      'emociones',
    ]);
    // 27 letters total across both alphabet lessons (design: "27 letras").
    expect(lessons[0]!.signCount + lessons[1]!.signCount).toBe(27);
  });

  it('reflects per-user progress once signs are mastered', async () => {
    const app = await testApp();
    const token = await registerUser(app);

    // Master all 13 signs of alfabeto-1.
    for (let i = 0; i < 13; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: auth(token),
        payload: { signId: `lsc-alfabeto-1-${i}`, correct: true, score: 0.97 },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/lessons', headers: auth(token) });
    const { lessons } = res.json() as {
      lessons: { slug: string; masteredCount: number; status: string }[];
    };
    expect(lessons[0]).toMatchObject({ masteredCount: 13, status: 'completed' });
    expect(lessons[1]!.status).toBe('unlocked');
    expect(lessons[2]!.status).toBe('locked');
  });
});

describe('GET /api/lessons/:id', () => {
  it('returns the sign list, flagged as not yet validated', async () => {
    const app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/lessons/lsc-saludos' });
    expect(res.statusCode).toBe(200);
    const { signs } = res.json() as {
      signs: { gloss: string; signType: string; validated: boolean; mastered: boolean }[];
    };
    expect(signs).toHaveLength(8);
    expect(signs[0]!.gloss).toBe('Hola');
    expect(signs.every((s) => s.validated === false)).toBe(true);
    expect(signs.every((s) => s.mastered === false)).toBe(true);
  });

  it('404s for unknown lessons', async () => {
    const app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/lessons/nope' });
    expect(res.statusCode).toBe(404);
  });
});
