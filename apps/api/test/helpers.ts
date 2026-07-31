import type { FastifyInstance } from 'fastify';
import { openDb } from '../src/db';
import { seedCatalog } from '../src/catalog';
import { buildApp } from '../src/app';

export async function testApp(): Promise<FastifyInstance> {
  const db = openDb(':memory:');
  seedCatalog(db);
  return buildApp({ db });
}

export async function registerUser(
  app: FastifyInstance,
  email = 'test@example.com',
  password = 'secreta-123',
  displayName = 'Test',
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, password, displayName },
  });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  return (res.json() as { token: string }).token;
}

export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
