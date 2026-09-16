import { describe, expect, it } from 'vitest';
import { computeStreak } from '../src/routes/progress';
import { auth, registerUser, testApp } from './helpers';

function daysAgo(n: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    const dates = new Set([daysAgo(0), daysAgo(1), daysAgo(2)]);
    expect(computeStreak(dates)).toBe(3);
  });

  it('still counts a streak that ends yesterday', () => {
    const dates = new Set([daysAgo(1), daysAgo(2)]);
    expect(computeStreak(dates)).toBe(2);
  });

  it('breaks on a gap', () => {
    const dates = new Set([daysAgo(0), daysAgo(2), daysAgo(3)]);
    expect(computeStreak(dates)).toBe(1);
  });

  it('is zero with no activity', () => {
    expect(computeStreak(new Set())).toBe(0);
  });
});

describe('GET /api/me/progress', () => {
  it('requires authentication', async () => {
    const app = await testApp();
    const res = await app.inject({ method: 'GET', url: '/api/me/progress' });
    expect(res.statusCode).toBe(401);
  });

  it('summarizes progress, streak, week and achievements', async () => {
    const app = await testApp();
    const token = await registerUser(app, 'pro@example.com', 'secreta-123', 'Pro');

    for (let i = 0; i < 3; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: auth(token),
        payload: { signId: `lsc-alfabeto-1-${i}`, correct: true, score: 0.93 },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/me/progress', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      displayName: string;
      totalMastered: number;
      totalSigns: number;
      streakDays: number;
      weekActivity: { date: string; active: boolean }[];
      lessons: { title: string; percent: number }[];
      achievements: { id: string; earned: boolean }[];
    };

    expect(body.displayName).toBe('Pro');
    expect(body.totalMastered).toBe(3);
    expect(body.totalSigns).toBe(76);
    expect(body.streakDays).toBe(1); // practiced today only
    expect(body.weekActivity).toHaveLength(7);
    expect(body.weekActivity.some((d) => d.active)).toBe(true);
    expect(body.lessons).toHaveLength(8);
    // Las 3 señas dominadas pertenecen a alfabeto-1 (tercera lección del orden ICAL).
    expect(body.lessons[2]!.percent).toBe(Math.round((3 / 13) * 100));
    expect(body.achievements.map((a) => a.id)).toEqual([
      'alfabeto-completo',
      'primera-semana',
      'conversacion-basica',
    ]);
    expect(body.achievements.every((a) => a.earned === false)).toBe(true);
  });

  it('earns the alphabet achievement when both alphabet lessons are complete', async () => {
    const app = await testApp();
    const token = await registerUser(app, 'abc@example.com', 'secreta-123', 'Abc');

    for (let i = 0; i < 13; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: auth(token),
        payload: { signId: `lsc-alfabeto-1-${i}`, correct: true },
      });
    }
    for (let i = 0; i < 14; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: auth(token),
        payload: { signId: `lsc-alfabeto-2-${i}`, correct: true },
      });
    }

    const res = await app.inject({ method: 'GET', url: '/api/me/progress', headers: auth(token) });
    const body = res.json() as { achievements: { id: string; earned: boolean; detail: string }[] };
    const alphabet = body.achievements.find((a) => a.id === 'alfabeto-completo')!;
    expect(alphabet.earned).toBe(true);
    expect(alphabet.detail).toBe('27 letras validadas');
  });
});
