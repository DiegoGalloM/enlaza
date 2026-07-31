import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Schema notes:
 * - `languages` exists from day one so LSC content is data, not structure —
 *   adding LSM later must not require schema changes (README §3, §9).
 * - `signs.validated` marks whether ICAL has confirmed the sign is correct
 *   and culturally appropriate (README §4.3); unvalidated content should be
 *   labeled as provisional in the UI.
 * - Attempts store only outcome + score. Raw video/landmarks are biometric
 *   data and stay on the client (README §11).
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS languages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  language_id TEXT NOT NULL REFERENCES languages(id),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  position INTEGER NOT NULL,
  UNIQUE (language_id, slug)
);

CREATE TABLE IF NOT EXISTS signs (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id),
  gloss TEXT NOT NULL,
  description TEXT NOT NULL,
  sign_type TEXT NOT NULL CHECK (sign_type IN ('static', 'dynamic')),
  position INTEGER NOT NULL,
  validated INTEGER NOT NULL DEFAULT 0,
  UNIQUE (lesson_id, position)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id),
  sign_id TEXT NOT NULL REFERENCES signs(id),
  correct INTEGER NOT NULL,
  score REAL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_date ON attempts(user_id, created_at);

CREATE TABLE IF NOT EXISTS sign_progress (
  user_id TEXT NOT NULL REFERENCES users(id),
  sign_id TEXT NOT NULL REFERENCES signs(id),
  mastered_at TEXT NOT NULL,
  PRIMARY KEY (user_id, sign_id)
);
`;

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
