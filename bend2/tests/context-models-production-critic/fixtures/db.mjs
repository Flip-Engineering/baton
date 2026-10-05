// Real SQLite subject databases built with node:sqlite for the critic
// fixtures. Every value asserted downstream is written here first, so the
// checks observe actual provider behavior over known bytes.

import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const { DatabaseSync: RealDatabaseSync } = { DatabaseSync };

export function makeWorkspace(name) {
  const root = join(tmpdir(), `ctx-critic-${process.pid}-${name}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  return root;
}

export function cleanupWorkspace(root) {
  rmSync(root, { recursive: true, force: true });
}

// Two-table relational subject: primary key, foreign key, unique index,
// nullable column, declared check text.
export function buildOrdersDatabase(path) {
  const db = new DatabaseSync(path);
  // WAL keeps the captured read transaction and concurrent writer commits
  // valid on one file, matching the spec's freshness model.
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      total REAL NOT NULL,
      note TEXT,
      CHECK (total >= 0)
    );
    CREATE INDEX orders_user_idx ON orders(user_id);
    INSERT INTO users (id, name, email) VALUES (1, 'ada', 'ada@example.com'), (2, 'grace', NULL);
    INSERT INTO orders (id, user_id, total) VALUES (100, 1, 12.5), (101, 2, 7.25);
  `);
  db.close();
  return path;
}

// Separate auxiliary database used to build attached-database EXPLAIN plans.
export function buildAuxDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE aux_log (id INTEGER PRIMARY KEY, line TEXT)');
  db.close();
  return path;
}

// Database for write-observation checks; returns a row reader for assertions.
export function buildWriteSubject(path) {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE counter (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)');
  db.prepare('INSERT INTO counter (id, n) VALUES (1, 1)').run();
  db.close();
  return {
    path,
    rows() {
      const reader = new DatabaseSync(path, { readOnly: true });
      const rows = reader.prepare('SELECT id, n FROM counter ORDER BY id').all();
      reader.close();
      return rows;
    },
  };
}
