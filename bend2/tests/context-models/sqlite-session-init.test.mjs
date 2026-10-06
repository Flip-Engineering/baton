// Resource-ownership discriminators for the SQLite session constructor.
//
// The catalog module takes its DatabaseSync constructor as a parameter, so this
// file drives every initialization failure with a scripted binding double and
// needs no engine: the dependency closure is the catalog module and node:fs.
// The cases assert that each post-open failure releases the handle before the
// original error is rethrown, and that a failing release is reported on that
// error rather than hidden.
//
// These cases are unexecuted: all compilation and test gates run on admitted
// remote runners.

import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createSqliteSession, openReadOnlySqlite } from '../../context/catalogs/sqlite-catalog.mjs';

function subjectFile() {
  const directory = mkdtempSync(join(tmpdir(), 'baton-context-session-'));
  const path = join(directory, 'subject.db');
  writeFileSync(path, 'not a real database; the double supplies every answer');
  return { directory, path, realPath: realpathSync(path), remove: () => rmSync(directory, { recursive: true, force: true }) };
}

// A scripted binding: every statement the catalog module issues is answered from
// the table below, and every instance records its execs, prepares and closes.
function scriptedDatabase({ realPath, rows = {}, failures = {}, execFailures = {}, closeError = null }) {
  const instances = [];
  const dispatch = (sql, instance) => {
    for (const [match, behavior] of Object.entries(failures)) {
      if (sql.includes(match)) throw Object.assign(new Error(behavior.message), { code: behavior.code ?? null });
    }
    if (sql.startsWith('EXPLAIN ')) return { all: () => rows.explain ?? [] };
    if (sql.includes('sqlite_version()')) return { get: () => ({ version: '3.53.0', source_id: 'scripted-source-id' }) };
    if (sql.includes('sqlite_schema')) return { all: () => rows.schema ?? [] };
    if (sql.includes('table_list')) return { all: () => rows.tableList ?? [] };
    if (sql.includes('table_xinfo')) return { all: () => rows.columns ?? [] };
    if (sql.includes('index_list')) return { all: () => rows.indexes ?? [] };
    if (sql.includes('foreign_key_list')) return { all: () => rows.foreignKeys ?? [] };
    if (sql.includes('database_list')) return { all: () => rows.databases ?? [{ seq: 0, name: 'main', file: realPath }] };
    if (sql.includes('schema_version')) return { all: () => [{ schema_version: 4 }] };
    if (sql.includes('data_version')) return { all: () => [{ data_version: 2 }] };
    if (sql.includes('journal_mode')) return { all: () => [{ journal_mode: 'delete' }] };
    if (sql.includes('foreign_keys')) return { all: () => [{ foreign_keys: 1 }] };
    if (sql === 'SELECT 1') return { columns: () => [] };
    // The origin probe selects its two slots from the subject table.
    return { columns: () => rows.probe ?? [] };
  };
  class ScriptedDatabaseSync {
    constructor(path, options) {
      this.path = path;
      this.options = options;
      this.execs = [];
      this.prepares = [];
      this.closes = 0;
      instances.push(this);
    }

    prepare(sql) {
      this.prepares.push(sql);
      return dispatch(sql, this);
    }

    exec(sql) {
      this.execs.push(sql);
      for (const [match, behavior] of Object.entries(execFailures)) {
        if (sql.includes(match)) throw new Error(behavior.message);
      }
    }

    close() {
      this.closes += 1;
      if (closeError !== null) throw closeError;
    }
  }
  return { DatabaseSync: ScriptedDatabaseSync, instances };
}

const HAPPY_ROWS = {
  schema: [{ type: 'table', name: 't', tbl_name: 't', rootpage: 2, sql: 'CREATE TABLE t(a TEXT)' }],
  tableList: [{ schema: 'main', name: 't', type: 'table', ncol: 1, wr: 0, strict: 0 }],
  columns: [{ cid: 0, name: 'a', type: 'TEXT', notnull: 0, dflt_value: null, pk: 0, hidden: 0 }],
  indexes: [],
  foreignKeys: [],
  probe: [
    { name: 'p0', database: 'main', table: 't', column: 'a' },
    { name: 'p1', database: 'main', table: 't', column: 'a' },
  ],
  explain: [{ addr: 0, opcode: 'OpenRead', p1: 0, p2: 2, p3: 0, p4: null, p5: 0 }],
};

test('the open releases the handle when the connection reports a different database', () => {
  const subject = subjectFile();
  const other = subjectFile();
  try {
    const scripted = scriptedDatabase({
      realPath: subject.realPath,
      rows: { databases: [{ seq: 0, name: 'main', file: other.realPath }] },
    });
    assert.throws(
      () => openReadOnlySqlite({ path: subject.path, DatabaseSync: scripted.DatabaseSync }),
      error => {
        assert.match(error.message, /not the admitted path/);
        assert.equal(error.cleanup, undefined, 'a successful release adds no diagnostic');
        return true;
      },
    );
    assert.equal(scripted.instances.length, 1);
    assert.equal(scripted.instances[0].closes, 1, 'the rejected handle is released once');
  } finally {
    subject.remove();
    other.remove();
  }
});

test('the open releases the handle when the connection reports no main database', () => {
  const subject = subjectFile();
  try {
    const empty = scriptedDatabase({ realPath: subject.realPath, rows: { databases: [] } });
    assert.throws(
      () => openReadOnlySqlite({ path: subject.path, DatabaseSync: empty.DatabaseSync }),
      /reports no main database file/,
    );
    assert.equal(empty.instances[0].closes, 1);
  } finally {
    subject.remove();
  }
});

test('a failing transaction start closes the handle and starts no rollback', () => {
  const subject = subjectFile();
  try {
    const scripted = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      execFailures: { 'BEGIN DEFERRED': { message: 'cannot start a transaction within a transaction' } },
    });
    assert.throws(
      () => createSqliteSession({ path: subject.path, DatabaseSync: scripted.DatabaseSync }),
      /cannot start a transaction within a transaction/,
    );
    const [instance] = scripted.instances;
    assert.deepEqual(instance.execs, ['BEGIN DEFERRED'], 'no rollback is issued for a transaction that never started');
    assert.equal(instance.closes, 1);
  } finally {
    subject.remove();
  }
});

test('a failing catalog read rolls back and closes, keeping the original error', () => {
  const subject = subjectFile();
  try {
    const scripted = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      failures: { 'sqlite_schema': { message: 'database disk image is malformed', code: 'SQLITE_CORRUPT' } },
    });
    assert.throws(
      () => createSqliteSession({ path: subject.path, DatabaseSync: scripted.DatabaseSync }),
      error => {
        assert.equal(error.message, 'database disk image is malformed', 'the original engine message survives');
        assert.equal(error.code, 'SQLITE_CORRUPT');
        assert.equal(error.cleanup, undefined, 'a successful cleanup adds no diagnostic');
        return true;
      },
    );
    const [instance] = scripted.instances;
    assert.deepEqual(instance.execs, ['BEGIN DEFERRED', 'ROLLBACK']);
    assert.equal(instance.closes, 1);
  } finally {
    subject.remove();
  }
});

test('a failing origin probe rolls back and closes', () => {
  const subject = subjectFile();
  try {
    const scripted = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      failures: { 'SELECT 1': { message: 'probe refused' } },
    });
    assert.throws(
      () => createSqliteSession({ path: subject.path, DatabaseSync: scripted.DatabaseSync }),
      /probe refused/,
    );
    const [instance] = scripted.instances;
    assert.deepEqual(instance.execs, ['BEGIN DEFERRED', 'ROLLBACK']);
    assert.equal(instance.closes, 1);
  } finally {
    subject.remove();
  }
});

test('a failing close is reported on the original error instead of replacing it', () => {
  const subject = subjectFile();
  try {
    const closeError = Object.assign(new Error('close refused'), { code: 'SQLITE_BUSY' });
    const scripted = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      failures: { 'sqlite_schema': { message: 'read failed' } },
      closeError,
    });
    assert.throws(
      () => createSqliteSession({ path: subject.path, DatabaseSync: scripted.DatabaseSync }),
      error => {
        assert.equal(error.message, 'read failed', 'the original error is still the thrown one');
        assert.deepEqual(error.cleanup, [{ stage: 'createSqliteSession:close', code: 'SQLITE_BUSY', message: 'close refused' }]);
        return true;
      },
    );
    assert.equal(scripted.instances[0].closes, 1);
  } finally {
    subject.remove();
  }
});

test('a failing rollback and close reports both diagnostics without publishing success', () => {
  const subject = subjectFile();
  try {
    const closeError = Object.assign(new Error('close refused'), { code: 'SQLITE_BUSY' });
    const scripted = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      failures: { 'sqlite_schema': { message: 'read failed' } },
      execFailures: { ROLLBACK: { message: 'rollback refused' } },
      closeError,
    });
    assert.throws(
      () => createSqliteSession({ path: subject.path, DatabaseSync: scripted.DatabaseSync }),
      error => {
        assert.equal(error.message, 'read failed');
        assert.deepEqual(error.cleanup, [
          { stage: 'createSqliteSession:rollback', code: null, message: 'rollback refused' },
          { stage: 'createSqliteSession:close', code: 'SQLITE_BUSY', message: 'close refused' },
        ]);
        return true;
      },
    );
  } finally {
    subject.remove();
  }
});

test('an open-path close failure is reported on the open error', () => {
  const subject = subjectFile();
  try {
    const closeError = Object.assign(new Error('close refused'), { code: 'SQLITE_BUSY' });
    const scripted = scriptedDatabase({ realPath: subject.realPath, rows: { databases: [] }, closeError });
    assert.throws(
      () => openReadOnlySqlite({ path: subject.path, DatabaseSync: scripted.DatabaseSync }),
      error => {
        assert.match(error.message, /reports no main database file/);
        assert.deepEqual(error.cleanup, [{ stage: 'openReadOnlySqlite:close', code: 'SQLITE_BUSY', message: 'close refused' }]);
        return true;
      },
    );
  } finally {
    subject.remove();
  }
});

test('a successful construction keeps one connection and the caller owns its close', () => {
  const subject = subjectFile();
  try {
    const scripted = scriptedDatabase({ realPath: subject.realPath, rows: HAPPY_ROWS });
    const session = createSqliteSession({ path: subject.path, DatabaseSync: scripted.DatabaseSync });
    const [instance] = scripted.instances;
    assert.equal(scripted.instances.length, 1, 'one connection per session');
    assert.equal(instance.closes, 0, 'the constructor does not close a session it returned');
    assert.deepEqual(instance.execs, ['BEGIN DEFERRED']);
    assert.equal(instance.options.readOnly, true);
    assert.match(session.identity.catalogDigest, /^[0-9a-f]{64}$/);
    assert.equal(session.originCapability.available, true);
    assert.equal(session.originCapability.scope, 'origin-metadata-shape');

    // The same connection serves statement analysis.
    const preparesBefore = instance.prepares.length;
    const plan = session.analyze({ id: 'a', sql: 'SELECT a FROM t' });
    assert.equal(instance.prepares.length > preparesBefore, true, 'analysis reuses the session connection');
    assert.equal(plan.status, 'analyzed');
    assert.equal(plan.relations.length, 1);
    assert.equal(plan.relations[0].object.name, 't');
    assert.equal(plan.join.schema, 'main');

    session.close();
    assert.equal(instance.closes, 1, 'the caller closes once');
    assert.equal(session.closed, true);
    session.close();
    assert.equal(instance.closes, 1, 'a repeat close is a no-op');
  } finally {
    subject.remove();
  }
});
