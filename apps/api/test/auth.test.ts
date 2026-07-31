import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword, verifyToken, signToken } from '../src/auth';
import { testApp } from './helpers';

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const stored = hashPassword('mi-contraseña');
    expect(verifyPassword('mi-contraseña', stored)).toBe(true);
    expect(verifyPassword('otra-cosa', stored)).toBe(false);
  });

  it('produces unique salts', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'));
  });
});

describe('tokens', () => {
  it('round-trips a valid token and rejects garbage', () => {
    const token = signToken('user-1', 'Diego');
    expect(verifyToken(token)).toEqual({ sub: 'user-1', name: 'Diego' });
    expect(verifyToken('not-a-token')).toBeNull();
  });
});

describe('POST /api/auth/register', () => {
  it('creates a user and returns a token', async () => {
    const app = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'ana@example.com', password: 'secreta-123', displayName: 'Ana' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { token: string; user: { email: string; displayName: string } };
    expect(body.user.email).toBe('ana@example.com');
    expect(verifyToken(body.token)?.name).toBe('Ana');
  });

  it('rejects duplicate emails with 409', async () => {
    const app = await testApp();
    const payload = { email: 'dup@example.com', password: 'secreta-123', displayName: 'Dup' };
    await app.inject({ method: 'POST', url: '/api/auth/register', payload });
    const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload });
    expect(res.statusCode).toBe(409);
  });

  it('rejects short passwords with 400', async () => {
    const app = await testApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@example.com', password: 'corta', displayName: 'X' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const app = await testApp();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'leo@example.com', password: 'secreta-123', displayName: 'Leo' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'LEO@example.com', password: 'secreta-123' },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { user: { displayName: string } }).user.displayName).toBe('Leo');
  });

  it('rejects a wrong password with 401', async () => {
    const app = await testApp();
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'mia@example.com', password: 'secreta-123', displayName: 'Mia' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'mia@example.com', password: 'incorrecta-99' },
    });
    expect(res.statusCode).toBe(401);
  });
});
