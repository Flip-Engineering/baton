// Fixture builders for the domain tests. Every fixture is created under a
// private temporary directory; no research database and no repository file is
// written by a test run.

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zodPackageDir } from './deps.mjs';

export function makeTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), `baton-context-${prefix}-`));
}

export function removeTempDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

export const SQLITE_FIXTURE_SQL = `PRAGMA foreign_keys=ON;
CREATE TABLE users(id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT DEFAULT 'anon');
CREATE TABLE orders(id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, total_cents INTEGER NOT NULL CHECK(total_cents >= 0), created_at_epoch_ms INTEGER);
CREATE INDEX orders_customer ON orders(customer_id);
CREATE VIEW paid_orders AS SELECT id, customer_id FROM orders WHERE total_cents > 0;
INSERT INTO users(email, display_name) VALUES ('a@b.co', 'Ann'), ('b@c.co', 'Bo');
INSERT INTO orders(customer_id, total_cents, created_at_epoch_ms) VALUES (1, 1250, 1700000000000), (2, 0, 1700000001000);`;

export function makeSqliteFixture({ DatabaseSync, dir = makeTempDir('sqlite') }) {
  const path = join(dir, 'shop.db');
  const writer = new DatabaseSync(path);
  writer.exec(SQLITE_FIXTURE_SQL);
  writer.close();
  return { dir, path, remove: () => removeTempDir(dir) };
}

export const ZOD_FIXTURE_MODULE = `import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(join(here, 'marker.txt'), 'module loaded\\n');
console.log('target stdout line');
console.error('target stderr line');

export const User = z.object({
  email: z.string().regex(/^[^@]+@[^@]+$/),
  display_name: z.string().trim().toLowerCase().default('anonymous'),
  total_cents: z.number().int().min(0),
  tags: z.array(z.string()).transform(list => list.length),
});

export const NotAModel = { safeParse() { return { success: true }; } };
`;

export const ZOD_FIXTURE_SAMPLE = `{"email":"A@B.co","display_name":"  ANN  ","total_cents":1250,"tags":["a","b"]}`;
export const ZOD_FIXTURE_INVALID_SAMPLE = `{"email":"not-an-email","display_name":"Bo","total_cents":-5,"tags":[]}`;

// The matching project resolves the real zod package through its own
// node_modules. The mismatch project declares a different version; the child
// must refuse before it imports anything, so its code is never loaded.
export function makeZodProject({ dir = makeTempDir('zod'), zodDir = zodPackageDir(), version = null } = {}) {
  const project = join(dir, 'project');
  const modules = join(project, 'node_modules');
  mkdirSync(modules, { recursive: true });
  if (version === null) {
    symlinkSync(zodDir, join(modules, 'zod'), 'dir');
  } else {
    const shim = join(modules, 'zod');
    mkdirSync(shim, { recursive: true });
    writeFileSync(join(shim, 'package.json'), `${JSON.stringify({ name: 'zod', version, main: 'index.js' })}\n`);
    writeFileSync(join(shim, 'index.js'), 'module.exports = {};\n');
  }
  writeFileSync(join(project, 'models.mjs'), ZOD_FIXTURE_MODULE);
  writeFileSync(join(project, 'sample.json'), ZOD_FIXTURE_SAMPLE);
  writeFileSync(join(project, 'invalid-sample.json'), ZOD_FIXTURE_INVALID_SAMPLE);
  return {
    dir,
    project,
    modulePath: join(project, 'models.mjs'),
    samplePath: join(project, 'sample.json'),
    invalidSamplePath: join(project, 'invalid-sample.json'),
    markerPath: join(project, 'marker.txt'),
    readMarker: () => (existsSync(join(project, 'marker.txt')) ? readFileSync(join(project, 'marker.txt'), 'utf8') : null),
    remove: () => removeTempDir(dir),
  };
}

export const PSQL = process.env.BATON_CONTEXT_PSQL ?? '/opt/homebrew/bin/psql';

export const POSTGRES_FIXTURE_SQL = `CREATE TYPE mood AS ENUM ('sad', 'ok', 'happy');
CREATE DOMAIN positive_cents AS integer CHECK (VALUE >= 0);
CREATE TABLE users(id serial PRIMARY KEY, email text NOT NULL UNIQUE, current_mood mood, joined date DEFAULT current_date);
CREATE TABLE orders(id serial PRIMARY KEY, customer_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE, total positive_cents NOT NULL CHECK (total < 100000), note text);
CREATE INDEX orders_customer ON orders(customer_id);
CREATE INDEX orders_large ON orders(total) WHERE total > 100;
CREATE VIEW paid AS SELECT id, customer_id FROM orders WHERE total > 0;
CREATE MATERIALIZED VIEW order_totals AS SELECT customer_id, sum(total) AS total FROM orders GROUP BY customer_id;
COMMENT ON TABLE orders IS 'shop orders';
INSERT INTO users(email, current_mood) VALUES ('a@b.co', 'ok'), ('b@c.co', 'happy');
INSERT INTO orders(customer_id, total, note) VALUES (1, 1250, 'first');`;

export function psqlRun(args, options = {}) {
  return execFileSync(PSQL, ['-X', '-w', '-q', ...args], { encoding: 'utf8', ...options });
}

// A dedicated fixture database, created and dropped by the test that owns it.
export function makePostgresFixture({ name, dir = makeTempDir('pg') }) {
  psqlRun(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${name}`]);
  psqlRun(['-d', 'postgres', '-c', `CREATE DATABASE ${name}`]);
  const fixtureSql = join(dir, 'fixture.sql');
  writeFileSync(fixtureSql, POSTGRES_FIXTURE_SQL);
  psqlRun(['-d', name, '-v', 'ON_ERROR_STOP=1', '-f', fixtureSql]);
  const serviceFile = join(dir, 'pg_service.conf');
  writeFileSync(serviceFile, `[baton_context]\nhost=/tmp\nport=5432\ndbname=${name}\nuser=${process.env.USER}\n`);
  chmodSync(serviceFile, 0o600);
  return {
    dir,
    name,
    serviceFile,
    home: dir,
    tempDirectory: dir,
    remove: () => {
      try {
        psqlRun(['-d', 'postgres', '-c', `DROP DATABASE IF EXISTS ${name}`]);
      } catch {
        // The drop is best effort; the fixture name is owned by this test.
      }
      removeTempDir(dir);
    },
  };
}
