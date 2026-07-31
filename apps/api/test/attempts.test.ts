import { describe, expect, it } from 'vitest';
import { auth, registerUser, testApp } from './helpers';

describe('POST /api/attempts', () => {
  it('requires authentication', async () => {
    const app = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      payload: { signId: 'lsc-alfabeto-1-0', correct: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it('records a correct attempt and masters the sign', async () => {
    const app = await testApp();
    const token = await registerUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: auth(token),
      payload: { signId: 'lsc-alfabeto-1-0', correct: true, score: 0.95 },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      signId: 'lsc-alfabeto-1-0',
      mastered: true,
      lesson: { id: 'lsc-alfabeto-1', masteredCount: 1, signCount: 13, completed: false },
    });
  });

  it('a failed attempt does not master the sign', async () => {
    const app = await testApp();
    const token = await registerUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: auth(token),
      payload: { signId: 'lsc-alfabeto-1-1', correct: false, score: 0.4 },
    });
    expect(res.statusCode).toBe(201);
    expect((res.json() as { mastered: boolean }).mastered).toBe(false);
  });

  it('mastering twice is idempotent', async () => {
    const app = await testApp();
    const token = await registerUser(app);
    const payload = { signId: 'lsc-alfabeto-1-2', correct: true };
    await app.inject({ method: 'POST', url: '/api/attempts', headers: auth(token), payload });
    const res = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: auth(token),
      payload,
    });
    expect((res.json() as { lesson: { masteredCount: number } }).lesson.masteredCount).toBe(1);
  });

  it('404s for unknown signs', async () => {
    const app = await testApp();
    const token = await registerUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/attempts',
      headers: auth(token),
      payload: { signId: 'nope', correct: true },
    });
    expect(res.statusCode).toBe(404);
  });

  it('completing every sign marks the lesson completed', async () => {
    const app = await testApp();
    const token = await registerUser(app);
    let last: { lesson: { completed: boolean } } | null = null;
    for (let i = 0; i < 13; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/attempts',
        headers: auth(token),
        payload: { signId: `lsc-alfabeto-1-${i}`, correct: true },
      });
      last = res.json();
    }
    expect(last!.lesson.completed).toBe(true);
  });
});
