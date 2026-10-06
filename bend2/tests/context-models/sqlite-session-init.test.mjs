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

import { attachDiagnostics, describeFailure } from '../../context/catalogs/failure.mjs';
import { captureSqliteSnapshot, createSqliteSession, openReadOnlySqlite } from '../../context/catalogs/sqlite-catalog.mjs';

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
  const counts = new Map();
  const dispatch = (sql, instance) => {
    for (const [match, behavior] of Object.entries(failures)) {
      if (!sql.includes(match)) continue;
      const seen = (counts.get(match) ?? 0) + 1;
      counts.set(match, seen);
      if (behavior.after !== undefined && seen <= behavior.after) continue;
      if ('thrown' in behavior) throw behavior.thrown;
      throw Object.assign(new Error(behavior.message), { code: behavior.code ?? null });
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

test('the release reports what happened instead of throwing or swallowing it', () => {
  const subject = subjectFile();
  try {
    const closeError = Object.assign(new Error('close refused'), { code: 'SQLITE_BUSY' });
    const failing = scriptedDatabase({ realPath: subject.realPath, rows: HAPPY_ROWS, closeError });
    const failingSession = createSqliteSession({ path: subject.path, DatabaseSync: failing.DatabaseSync });
    const release = failingSession.close();
    assert.equal(release.closed, false, 'a release that could not free the connection says so');
    assert.equal(release.sessionUsable, false);
    assert.deepEqual(release.diagnostics, [{ stage: 'sqliteSession:close', code: 'SQLITE_BUSY', message: 'close refused' }]);
    assert.equal(failing.instances[0].closes, 1);
    const repeat = failingSession.close();
    assert.equal(repeat.closed, false, 'a repeat reports the cached outcome, not a blank success');
    assert.equal(repeat.alreadyClosed, true);
    assert.deepEqual(repeat.diagnostics, release.diagnostics);
    assert.equal(failing.instances[0].closes, 1, 'a repeat release attempts no second close');

    const commitFailing = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      execFailures: { COMMIT: { message: 'no transaction is active' } },
    });
    const commitSession = createSqliteSession({ path: subject.path, DatabaseSync: commitFailing.DatabaseSync });
    const commitRelease = commitSession.close();
    assert.equal(commitRelease.closed, true, 'the connection still closes');
    assert.equal(commitRelease.sessionUsable, false, 'the session refuses further work either way');
    assert.deepEqual(commitRelease.diagnostics, [{ stage: 'sqliteSession:commit', code: null, message: 'no transaction is active' }]);
    assert.equal(commitFailing.instances[0].closes, 1);

    const clean = scriptedDatabase({ realPath: subject.realPath, rows: HAPPY_ROWS });
    const cleanSession = createSqliteSession({ path: subject.path, DatabaseSync: clean.DatabaseSync });
    assert.deepEqual(cleanSession.close(), { closed: true, sessionUsable: false, alreadyClosed: false, diagnostics: [] });
  } finally {
    subject.remove();
  }
});

test('the capture wrapper returns the release record and attaches its diagnostics on failure', () => {
  const subject = subjectFile();
  try {
    const clean = scriptedDatabase({ realPath: subject.realPath, rows: HAPPY_ROWS });
    const snapshot = captureSqliteSnapshot({ path: subject.path, DatabaseSync: clean.DatabaseSync, statements: [] });
    assert.deepEqual(snapshot.release, { closed: true, sessionUsable: false, alreadyClosed: false, diagnostics: [] });
    assert.equal(clean.instances[0].closes, 1);

    // A refused analysis stays a refusal with its release information, because
    // analyzeSqliteStatement reports a prepare failure as engineParseRefused.
    const refusing = scriptedDatabase({ realPath: subject.realPath, rows: HAPPY_ROWS, failures: { 'EXPLAIN ': { message: 'parse refused' } } });
    const refused = captureSqliteSnapshot({ path: subject.path, DatabaseSync: refusing.DatabaseSync, statements: [{ id: 'x', sql: 'SELECT a FROM t' }] });
    assert.equal(refused.plans[0].status, 'refused');
    assert.equal(refused.plans[0].refusal.reason, 'engineParseRefused');
    assert.deepEqual(refused.release, { closed: true, sessionUsable: false, alreadyClosed: false, diagnostics: [] });
    assert.equal(refusing.instances[0].closes, 1);

    // The second identity read inside the same transaction is what escapes the
    // wrapper, so a controlled failure there exercises the error path.
    const closeError = Object.assign(new Error('close refused'), { code: 'SQLITE_BUSY' });
    const failing = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      failures: { 'sqlite_version()': { after: 1, message: 'stability probe failed' } },
      closeError,
    });
    assert.throws(
      () => captureSqliteSnapshot({ path: subject.path, DatabaseSync: failing.DatabaseSync, statements: [] }),
      error => {
        assert.equal(error.message, 'stability probe failed', 'the escaping error stays the thrown one');
        assert.deepEqual(error.cleanup, [{ stage: 'sqliteSession:close', code: 'SQLITE_BUSY', message: 'close refused' }]);
        return true;
      },
    );
    assert.equal(failing.instances[0].closes, 1);
  } finally {
    subject.remove();
  }
});

test('cleanup evidence survives an original failure that cannot be mutated', () => {
  const subject = subjectFile();
  try {
    const frozen = Object.freeze(Object.assign(new Error('read failed'), { code: 'SQLITE_CORRUPT' }));
    const closeError = Object.assign(new Error('close refused'), { code: 'SQLITE_BUSY' });
    const scripted = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      failures: { sqlite_schema: { thrown: frozen } },
      closeError,
    });
    assert.throws(
      () => createSqliteSession({ path: subject.path, DatabaseSync: scripted.DatabaseSync }),
      error => {
        assert.equal(error.message, 'read failed', 'the original message is retained');
        assert.equal(error.cause, frozen, 'the original value is retained as the cause');
        assert.deepEqual(error.cleanup, [{ stage: 'createSqliteSession:close', code: 'SQLITE_BUSY', message: 'close refused' }]);
        return true;
      },
    );
    const [instance] = scripted.instances;
    assert.deepEqual(instance.execs, ['BEGIN DEFERRED', 'ROLLBACK'], 'the rollback still ran first');
    assert.equal(instance.closes, 1, 'the close still ran even though attachment could not mutate the original');
  } finally {
    subject.remove();
  }
});

test('a non-writable cleanup member and a primitive throw both keep every diagnostic', () => {
  const subject = subjectFile();
  try {
    const sealed = new Error('read failed');
    Object.defineProperty(sealed, 'cleanup', { value: [], writable: false, enumerable: true, configurable: false });
    const closeError = Object.assign(new Error('close refused'), { code: 'SQLITE_BUSY' });
    const sealedRun = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      failures: { sqlite_schema: { thrown: sealed } },
      execFailures: { ROLLBACK: { message: 'rollback refused' } },
      closeError,
    });
    assert.throws(
      () => createSqliteSession({ path: subject.path, DatabaseSync: sealedRun.DatabaseSync }),
      error => {
        assert.equal(error.message, 'read failed');
        assert.deepEqual(error.cleanup, [
          { stage: 'createSqliteSession:rollback', code: null, message: 'rollback refused' },
          { stage: 'createSqliteSession:close', code: 'SQLITE_BUSY', message: 'close refused' },
        ], 'both cleanup failures are retained in order');
        assert.equal(error.cause, sealed);
        return true;
      },
    );
    assert.equal(sealedRun.instances[0].closes, 1);

    const primitiveRun = scriptedDatabase({
      realPath: subject.realPath,
      rows: HAPPY_ROWS,
      failures: { sqlite_schema: { thrown: 'read failed as a string' } },
      closeError,
    });
    assert.throws(
      () => createSqliteSession({ path: subject.path, DatabaseSync: primitiveRun.DatabaseSync }),
      error => {
        assert.match(error.message, /non-error throw: read failed as a string/);
        assert.equal(error.cause, 'read failed as a string');
        assert.deepEqual(error.cleanup, [{ stage: 'createSqliteSession:close', code: 'SQLITE_BUSY', message: 'close refused' }]);
        return true;
      },
    );
    assert.equal(primitiveRun.instances[0].closes, 1, 'a primitive throw does not skip the close');
  } finally {
    subject.remove();
  }
});

test('the failure description keeps the provider error, codes and cleanup evidence', () => {
  const provider = Object.assign(new Error('read failed'), { code: 'SQLITE_CORRUPT' });
  provider.cleanup = [{ stage: 'sqliteSession:close', code: 'SQLITE_BUSY', message: 'close refused' }];
  const described = describeFailure(provider);
  assert.equal(described.kind, 'Error');
  assert.equal(described.message, 'read failed');
  assert.equal(described.code, 'SQLITE_CORRUPT');
  assert.equal(described.cleanup.length, 1);
  assert.equal(described.cause, null);

  const primitive = describeFailure('plain string failure');
  assert.equal(primitive.kind, 'non-error-throw');
  assert.equal(primitive.message, 'plain string failure');
  assert.deepEqual(primitive.cleanup, []);
  assert.equal(primitive.cause, null);

  const wrapped = attachDiagnostics(Object.freeze(new Error('frozen failure')), [
    { stage: 'createSqliteSession:close', code: null, message: 'close refused' },
  ]);
  const describedWrapped = describeFailure(wrapped);
  assert.equal(describedWrapped.message, 'frozen failure');
  assert.equal(describedWrapped.cleanup.length, 1);
  assert.equal(describedWrapped.cause.message, 'frozen failure', 'the retained original is described through the cause');
});

test('the failure description tolerates throwing members and a cyclic cause', () => {
  const hostile = new Error('hostile');
  Object.defineProperty(hostile, 'cleanup', { get() { throw new Error('cleanup getter failed'); } });
  const described = describeFailure(hostile);
  assert.equal(described.message, 'hostile');
  assert.deepEqual(described.cleanup, [], 'an unreadable cleanup member yields no diagnostics instead of throwing');

  const cyclic = new Error('cyclic');
  cyclic.cause = cyclic;
  const cyclicDescribed = describeFailure(cyclic);
  assert.equal(cyclicDescribed.message, 'cyclic');
  assert.equal(cyclicDescribed.cause.kind, 'cycle', 'a cyclic cause chain is cut');

  const attached = attachDiagnostics(hostile, [{ stage: 's', code: null, message: 'm' }]);
  assert.deepEqual(attached.cleanup, [{ stage: 's', code: null, message: 'm' }], 'the diagnostics are retained');
  assert.equal(attached.cause, hostile, 'the original failure is retained as the cause when the member cannot be replaced');
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

    const release = session.close();
    assert.equal(instance.closes, 1, 'the caller closes once');
    assert.equal(release.closed, true);
    assert.equal(session.closed, true);
    const repeat = session.close();
    assert.equal(repeat.alreadyClosed, true);
    assert.equal(instance.closes, 1, 'a repeat close is a no-op');
  } finally {
    subject.remove();
  }
});
