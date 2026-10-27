import Fastify from 'fastify';
import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { parseAuth } from './auth';
import { authRoutes } from './routes/auth';
import { lessonRoutes } from './routes/lessons';
import { attemptRoutes } from './routes/attempts';
import { progressRoutes } from './routes/progress';

export interface AppOptions {
  db: DatabaseSync;
  logger?: boolean;
}

/**
 * Orígenes que pueden llamar al API (D50). ENLAZA_CORS_ORIGIN es una lista
 * separada por comas (p. ej. "https://enlaza.app"). Sin ella: en desarrollo,
 * cualquiera; en producción, ninguno de otro dominio (web y API en el mismo).
 */
function corsOrigin(): boolean | string[] {
  const list = process.env.ENLAZA_CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean);
  if (list && list.length > 0) return list;
  return process.env.NODE_ENV !== 'production';
}

export async function buildApp({ db, logger = false }: AppOptions): Promise<FastifyInstance> {
  // trustProxy: detrás del proxy del hosting, la IP real viene en X-Forwarded-For.
  const app = Fastify({ logger, trustProxy: true });
  await app.register(cors, { origin: corsOrigin() });

  app.decorateRequest('user');
  app.addHook('onRequest', async (request) => parseAuth(request));

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes, { db });
  await app.register(lessonRoutes, { db });
  await app.register(attemptRoutes, { db });
  await app.register(progressRoutes, { db });

  return app;
}
