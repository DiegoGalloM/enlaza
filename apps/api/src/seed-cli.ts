/**
 * Seeds the local database with the LSC catalog and a demo user whose
 * progress matches the design mockups (Mariana: alphabet + greetings done,
 * numbers in progress, 6-day streak). Safe to re-run.
 *
 * Demo credentials: demo@enlaza.app / enlaza-demo
 */
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openDb } from './db';
import { seedCatalog } from './catalog';
import { hashPassword } from './auth';

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.ENLAZA_DB_PATH ?? join(here, '..', 'data', 'enlaza.db');

const db = openDb(dbPath);
seedCatalog(db);

const DEMO_EMAIL = 'demo@enlaza.app';
let user = db.prepare('SELECT id FROM users WHERE email = ?').get(DEMO_EMAIL) as
  | { id: string }
  | undefined;

if (!user) {
  const id = randomUUID();
  db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, DEMO_EMAIL, hashPassword('enlaza-demo'), 'Mariana C.', new Date().toISOString());
  user = { id };
  console.log('Demo user created:', DEMO_EMAIL, '/ enlaza-demo');
} else {
  console.log('Demo user already exists:', DEMO_EMAIL);
}

// Master: all of alfabeto-1, alfabeto-2, saludos; first 12 of numeros.
const masteredSigns = [
  ...(db.prepare("SELECT id FROM signs WHERE lesson_id IN ('lsc-alfabeto-1','lsc-alfabeto-2','lsc-saludos') ORDER BY lesson_id, position").all() as unknown as { id: string }[]),
  ...(db.prepare("SELECT id FROM signs WHERE lesson_id = 'lsc-numeros' ORDER BY position LIMIT 12").all() as unknown as { id: string }[]),
];

const insertAttempt = db.prepare(
  'INSERT INTO attempts (user_id, sign_id, correct, score, created_at) VALUES (?, ?, 1, ?, ?)',
);
const insertProgress = db.prepare(
  'INSERT OR IGNORE INTO sign_progress (user_id, sign_id, mastered_at) VALUES (?, ?, ?)',
);

// Spread attempts over the last 6 days for a 6-day streak.
masteredSigns.forEach((sign, i) => {
  const daysAgo = 5 - (i % 6);
  const when = new Date();
  when.setDate(when.getDate() - daysAgo);
  when.setHours(18, (i * 7) % 60, 0, 0);
  const iso = when.toISOString();
  insertAttempt.run(user!.id, sign.id, 0.95, iso);
  insertProgress.run(user!.id, sign.id, iso);
});

console.log(`Seeded ${masteredSigns.length} mastered signs for the demo user.`);
