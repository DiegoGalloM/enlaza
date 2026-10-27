import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { hashPassword, signToken, verifyPassword } from '../auth';

const credentialsSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8, maxLength: 128 },
    displayName: { type: 'string', minLength: 1, maxLength: 80 },
  },
} as const;

interface Credentials {
  email: string;
  password: string;
  displayName?: string;
}

/**
 * Límite de intentos de registro e inicio de sesión por IP (D50): sin él,
 * se pueden probar contraseñas sin fin. En memoria: alcanza para una sola
 * instancia del API; con varias, hay que moverlo a un almacén compartido.
 */
export const AUTH_LIMIT = { max: 20, windowMs: 10 * 60 * 1000 };

export function createRateLimiter({ max, windowMs } = AUTH_LIMIT) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    // Limpieza ocasional para que el mapa no crezca con IPs que no vuelven.
    if (hits.size > 10_000) {
      for (const [k, times] of hits) if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return true;
  };
}

export async function authRoutes(app: FastifyInstance, { db }: { db: DatabaseSync }) {
  const allow = createRateLimiter();
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/auth/')) return;
    if (!allow(request.ip)) {
      await reply
        .code(429)
        .send({ error: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.' });
    }
  });
  app.post(
    '/api/auth/register',
    { schema: { body: { ...credentialsSchema, required: ['email', 'password', 'displayName'] } } },
    async (request, reply) => {
      const { email, password, displayName } = request.body as Required<Credentials>;
      const normalized = email.trim().toLowerCase();

      const existing = db.prepare('SELECT 1 FROM users WHERE email = ?').get(normalized);
      if (existing) {
        return reply.code(409).send({ error: 'Ese correo ya está registrado' });
      }

      const id = randomUUID();
      db.prepare(
        'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(id, normalized, hashPassword(password), displayName.trim(), new Date().toISOString());

      return reply.code(201).send({
        token: signToken(id, displayName.trim()),
        user: { id, email: normalized, displayName: displayName.trim() },
      });
    },
  );

  app.post(
    '/api/auth/login',
    { schema: { body: credentialsSchema } },
    async (request, reply) => {
      const { email, password } = request.body as Credentials;
      const row = db
        .prepare('SELECT id, email, password_hash, display_name FROM users WHERE email = ?')
        .get(email.trim().toLowerCase()) as
        | { id: string; email: string; password_hash: string; display_name: string }
        | undefined;

      if (!row || !verifyPassword(password, row.password_hash)) {
        return reply.code(401).send({ error: 'Correo o contraseña incorrectos' });
      }

      return {
        token: signToken(row.id, row.display_name),
        user: { id: row.id, email: row.email, displayName: row.display_name },
      };
    },
  );
}
