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

export async function buildApp({ db, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  await app.register(cors, { origin: true });

  app.decorateRequest('user');
  app.addHook('onRequest', async (request) => parseAuth(request));

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes, { db });
  await app.register(lessonRoutes, { db });
  await app.register(attemptRoutes, { db });
  await app.register(progressRoutes, { db });

  return app;
}
