// Independent security/lifecycle discriminators for the constant-SQL catalogs
// provider (semantic-impl-models lane, security critic).
//
// Scope: the statement-framing boundary, the origin tier, and the program-to-
// catalog join. Each case states an observable the approved specification
// requires, not an implementation shape. The suite runs whatever revision sits
// at CONTEXT_CATALOGS_DIR (default bend2/context/catalogs) and prints the exact
// module hashes it loaded, so a verdict names its revision.
//
//   node --test bend2/tests/context-models-security-critic/catalogs-security.test.mjs
//   CONTEXT_CATALOGS_DIR=<tree>/bend2/context/catalogs node --test ...
//
// The real end-to-end cases open a scratch SQLite file with node:sqlite and go
// through createSqliteSession, so relation identity and the "analyze never
// mutates the target" claim are measured against the engine, not a stub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const catalogDir = process.env.CONTEXT_CATALOGS_DIR
  ?? fileURLToPath(new URL('../../context/catalogs/', import.meta.url));

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function load(name) {
  const path = join(catalogDir, name);
  const module = await import(pathToFileURL(path).href);
  return { path, module };
}

const statement = await load('sqlite-statement.mjs');
const scan = await load('sql-scan.mjs');
const catalog = await load('sqlite-catalog.mjs');

console.log(JSON.stringify({
  suite: 'catalogs-security',
  node: process.version,
  catalogDir,
  modules: {
    'sqlite-statement.mjs': digest(statement.path),
    'sql-scan.mjs': digest(scan.path),
    'sqlite-catalog.mjs': digest(catalog.path),
  },
}));

const { statementFraming, joinRootpages, statementOrigins, analyzeSqliteStatement } = statement.module;
const { scanSqlStatements } = scan.module;
const { createSqliteSession } = catalog.module;

const SQLITE_SCHEMA = 'main';
const MAIN_DATABASE = 0;

function mainCatalog({ rootpages, schema = SQLITE_SCHEMA }) {
  return { schema, rootpages };
}

function mainOwner(name, extra = {}) {
  return { schema: SQLITE_SCHEMA, name, type: 'table', table: name, ...extra };
}

function access(overrides = {}) {
  return { opcode: 'OpenRead', cursor: 1, database: MAIN_DATABASE, rootpage: '2', engineName: null, name: null, object: null, status: 'pending-catalog-join', ...overrides };
}

function plan(relations) {
  return { status: 'analyzed', relations, unknownAccess: [], limits: [] };
}

function scratchDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'context-critic-catalogs-'));
  const path = join(directory, 'subject.db');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL)');
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id))');
  db.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.test'), (2, 'b@example.test')");
  db.exec('INSERT INTO orders (id, user_id) VALUES (10, 1)');
  db.close();
  return { directory, path };
}

function rowCount(path, table) {
  const db = new DatabaseSync(path);
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  db.close();
  return Number(row.n);
}

const single = [
  'SELECT 1',
  "SELECT 'ok'",
  'SELECT 1;',
  'SELECT 1;;',
  '  -- leading comment\nSELECT 1  ',
  'SELECT 1 /* trailing comment */',
  "SELECT 'a;b'",
  'SELECT "a;b" FROM users',
];

test('one constant statement is admitted and its byte range names that statement', () => {
  for (const sql of single) {
    const framing = statementFraming(sql);
    assert.equal(framing.status, 'admitted', `${JSON.stringify(sql)} must be admitted, got ${JSON.stringify(framing)}`);
    assert.equal(framing.statement.hasContent, true);
  }
});

test('a second statement, an unterminated literal and an empty text are refused', () => {
  const two = statementFraming('SELECT 1; SELECT 2');
  assert.equal(two.status, 'refused');
  assert.equal(two.reason, 'multipleStatements');

  const trailing = statementFraming('SELECT 1; SELECT 2;');
  assert.equal(trailing.reason, 'multipleStatements');

  const unterminated = statementFraming("SELECT 'ok");
  assert.equal(unterminated.status, 'refused');
  assert.equal(unterminated.reason, 'unterminatedLiteral');

  for (const sql of ['', '   ', '-- only a comment', '/* only a comment */', ';;;']) {
    const framing = statementFraming(sql);
    assert.equal(framing.status, 'refused', `${JSON.stringify(sql)} must be refused, got ${JSON.stringify(framing)}`);
    assert.equal(framing.reason, 'emptyStatement');
  }
});

test('the admitted text carries no NUL byte', () => {
  // The Node binding truncates a NUL-terminated C string: EXPLAIN of
  // 'SELECT 1\u0000; SELECT 2' analyzes only 'SELECT 1'. The framing gate is
  // the only place the byte boundary can be refused, so admitting the text
  // claims a single statement the engine never saw.
  const framed = statementFraming('SELECT 1\u0000');
  assert.equal(framed.status, 'refused', `NUL-carrying text must be refused, got ${JSON.stringify(framed)}`);
  assert.match(JSON.stringify(framed), /nul|utf-?8/i, 'the refusal must name the byte-level condition');
});

test('the admitted text is valid UTF-8', () => {
  const framed = statementFraming("SELECT '\uD800'");
  assert.equal(framed.status, 'refused', `a lone surrogate must be refused, got ${JSON.stringify(framed)}`);
});

test('result names never fabricate a column origin', () => {
  // A binding with result-name metadata but no origin metadata returns null
  // table/column. A stored column whose name equals the result name is not
  // evidence that the result came from it.
  const db = {
    prepare() {
      return {
        columns: () => [{ name: 'id', database: null, table: null, column: null }],
        all: () => [],
      };
    },
  };
  const origins = statementOrigins({
    db,
    sql: 'SELECT id FROM users',
    originCapability: { available: true, probe: null, reason: null, detail: null },
  });
  assert.equal(origins.availability, 'partial');
  assert.equal(origins.columns.length, 1);
  assert.equal(origins.columns[0].table, null, 'a null engine origin must stay null');
  assert.equal(origins.columns[0].column, null, 'a null engine origin must stay null');

  // With the capability unqualified the tier is unavailable: an empty column
  // list, never a name-matched guess.
  const unqualified = statementOrigins({
    db,
    sql: 'SELECT id FROM users',
    originCapability: { available: false, reason: 'column_origin_metadata_unavailable', detail: null, probe: null },
  });
  assert.equal(unqualified.availability, 'unavailable');
  assert.deepEqual(unqualified.columns, []);
});

test('the framing gate refuses a second statement before the engine is consulted', () => {
  // node:sqlite prepares only the first statement of a text and exposes no tail
  // pointer, so a silent drop is possible only if this gate is bypassed.
  let prepared = 0;
  const db = {
    prepare() {
      prepared += 1;
      return { all: () => [], columns: () => [] };
    },
  };
  const analyzed = analyzeSqliteStatement({ db, sql: 'SELECT 1; DELETE FROM users' });
  assert.equal(analyzed.status, 'refused');
  assert.equal(analyzed.refusal.reason, 'multipleStatements');
  assert.equal(prepared, 0, 'the refusal must precede any prepare call');
});

test('an access operand outside the admitted main database is not joined', () => {
  const joined = joinRootpages({
    plan: plan([access({ database: 1 })]),
    catalog: mainCatalog({ rootpages: { 2: [mainOwner('users')] } }),
  });
  assert.equal(joined.relations.length, 0);
  assert.equal(joined.unknownAccess.length, 1);
  assert.equal(joined.unknownAccess[0].reason, 'nonMainDatabaseAccess');
});

test('an ambiguous or unknown rootpage is not joined to an invented object', () => {
  const ambiguous = joinRootpages({
    plan: plan([access()]),
    catalog: mainCatalog({ rootpages: { 2: [mainOwner('users'), { schema: SQLITE_SCHEMA, name: 'users_idx', type: 'index', table: 'users' }] } }),
  });
  assert.equal(ambiguous.relations.length, 0);
  assert.equal(ambiguous.unknownAccess[0].reason, 'ambiguousRootpage');

  const missing = joinRootpages({
    plan: plan([access({ rootpage: '99' })]),
    catalog: mainCatalog({ rootpages: { 2: [mainOwner('users')] } }),
  });
  assert.equal(missing.relations.length, 0);
  assert.equal(missing.unknownAccess[0].reason, 'rootpageNotInCatalog');

  const foreign = joinRootpages({
    plan: plan([access()]),
    catalog: mainCatalog({ rootpages: { 2: [{ schema: 'temp', name: 'users', type: 'table', table: 'users' }] } }),
  });
  assert.equal(foreign.relations.length, 0);
  assert.equal(foreign.unknownAccess[0].reason, 'nonMainSchemaObject');
});

test('an unambiguous main-database rootpage joins to the captured object', () => {
  const joined = joinRootpages({
    plan: plan([access()]),
    catalog: mainCatalog({ rootpages: { 2: [mainOwner('users')] } }),
  });
  assert.equal(joined.relations.length, 1);
  assert.equal(joined.relations[0].status, 'joined');
  assert.equal(joined.relations[0].object.name, 'users');
  assert.equal(joined.relations[0].object.database, MAIN_DATABASE);
});

test('a real subject joins a constant SELECT to its captured table and leaves the file unchanged', () => {
  const { directory, path } = scratchDatabase();
  const before = rowCount(path, 'users');
  const session = createSqliteSession({ path, DatabaseSync });
  try {
    assert.equal(session.identity.engine, 'sqlite-schema');

    const read = session.analyze({ id: 'q', sql: 'SELECT id FROM users' });
    assert.equal(read.status, 'analyzed');
    assert.equal(read.kind, 'read');
    const opened = read.relations.filter(relation => relation.object !== null);
    assert.equal(opened.length, 1, `expected one joined table access, got ${JSON.stringify(read.relations)}`);
    assert.equal(opened[0].object.name, 'users');
    assert.equal(opened[0].object.database, MAIN_DATABASE);

    const write = session.analyze({ id: 'w', sql: 'DELETE FROM users' });
    assert.equal(write.status, 'analyzed');
    assert.equal(write.kind, 'write');
    assert.ok(write.relations.some(relation => relation.object?.name === 'users'));
  } finally {
    session.close();
  }
  assert.equal(rowCount(path, 'users'), before, 'analyzing must not mutate the subject database');

  // A second statement never reaches the engine, and a bind parameter is refused.
  const session2 = createSqliteSession({ path, DatabaseSync });
  try {
    const two = session2.analyze({ id: 'x', sql: 'SELECT id FROM users; SELECT 1' });
    assert.equal(two.status, 'refused');
    assert.equal(two.refusal.reason, 'multipleStatements');

    const bound = session2.analyze({ id: 'y', sql: 'SELECT id FROM users WHERE id = ?' });
    assert.equal(bound.status, 'refused');
    assert.equal(bound.refusal.reason, 'bindParametersUnsupported');
  } finally {
    session2.close();
  }

  rmSync(directory, { recursive: true, force: true });
});

test('a real subject does not admit a NUL-bearing statement', () => {
  const { directory, path } = scratchDatabase();
  const session = createSqliteSession({ path, DatabaseSync });
  try {
    const smuggled = session.analyze({ id: 'n', sql: 'SELECT id FROM users\u0000; DROP TABLE users' });
    assert.notEqual(smuggled.status, 'analyzed', `NUL-bearing text was analyzed as ${JSON.stringify(smuggled)}`);
    assert.equal(smuggled.status, 'refused');
  } finally {
    session.close();
  }
  assert.equal(rowCount(path, 'users'), 2, 'the truncated tail must never reach the engine');
  rmSync(directory, { recursive: true, force: true });
});

test('scan and engine agree on the statement boundary for SQLite text', () => {
  // PostgreSQL dollar quoting is not SQLite syntax: SQLite reads $p$ as a
  // parameter and the ';' as a statement boundary (measured: the engine
  // program for this text carries a Variable opcode). A scan that treats the
  // region as quoted reports one statement for text the engine frames as two,
  // so the required observable is that the framing gate refuses it instead of
  // claiming a single admitted statement.
  const sql = 'SELECT 1 WHERE x = $p$; DROP TABLE users; --$p$';
  const framed = statementFraming(sql);
  assert.equal(framed.status, 'refused', `dollar-quoted text must not be admitted as one statement, got ${JSON.stringify(framed)}`);
  assert.equal(framed.reason, 'multipleStatements');
  const scanned = scanSqlStatements(sql);
  assert.ok(scanned.statementCount >= 2, `the scan must not hide the engine's second statement, got ${JSON.stringify(scanned)}`);
});
