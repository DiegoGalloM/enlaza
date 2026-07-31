import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db';
import { seedCatalog } from './catalog';
import { buildApp } from './app';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.ENLAZA_DB_PATH ?? join(here, '..', 'data', 'enlaza.db');
const port = Number(process.env.PORT ?? 3001);

const db = openDb(dbPath);
seedCatalog(db);

const app = await buildApp({ db, logger: true });
await app.listen({ port, host: '0.0.0.0' });
