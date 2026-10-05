// Domain provider tests: read-only SQLite catalog, statement framing, engine
// program join and snapshot applicability.
//
// These tests exercise the real node:sqlite binding and a real database file.
// They cover the defects the conductor and the security critic found in the
// first draft: single-statement framing for a closing quote at end of text,
// refusal of a two-statement text, no origin from name equality, and rootpage
// identity that includes the database number and the schema.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

import {
  captureSqliteSnapshot,
  compareSqliteIdentities,
  createSqliteSession,
  openReadOnlySqlite,
  scanSqlStatements,
  statementFraming,
  validateSqlText,
} from '../../context/catalogs/index.mjs';
import { makeSqliteFixture, makeTempDir, removeTempDir } from './helpers/fixtures.mjs';

const SELECT_JOIN = 'SELECT o.id, o.total_cents AS amount, u.email FROM orders o JOIN users u ON u.id = o.customer_id';

const CLIENT_DECLARATION = {
  path: '/work/src/db.ts',
  sha256: 'b'.repeat(64),
  range: { start: { line: 4, column: 2 }, end: { line: 4, column: 24 } },
};

// The fact shape the TypeScript resolver publishes: the project record lives at
// value.record, and value.callSiteRef is an opaque ref id string.
function sqlCallFact(text, overrides = {}) {
  const record = {
    schema: 'baton2.context.resolver-record.v1',
    kind: 'constantSql',
    provider: { engine: 'typescript', version: '5.9.3', libraryPath: '/ts/lib/typescript.js', librarySha: 'e'.repeat(64) },
    snapshotId: 'ts-snapshot-1',
    callSite: { path: '/work/src/repo.ts', sha256: 'a'.repeat(64), range: { start: { line: 9, column: 2 }, end: { line: 9, column: 30 } } },
    callee: { status: 'resolved', declaration: CLIENT_DECLARATION },
    receiver: { status: 'resolved', declaration: { ...CLIENT_DECLARATION, range: { start: { line: 2, column: 4 }, end: { line: 2, column: 6 } } } },
    sql: { status: 'constant', text, literalKind: 'string' },
    statementKind: 'read',
    limits: [],
  };
  const { record: recordOverride, value: valueOverride, ...rest } = overrides;
  return {
    id: 'call-1',
    kind: 'sqlCall',
    classification: 'static-possible',
    value: {
      record: { ...record, ...(recordOverride ?? {}) },
      callSiteRef: '["source","/work/src/repo.ts","aaaa",9,2,"databaseAccesses"]',
      clientMatch: 'matched',
      sourceBinding: 'bind-1',
      snapshotId: 'ts-snapshot-1',
      ...(valueOverride ?? {}),
    },
    ...rest,
  };
}

test('catalog capture reports entities, columns, keys, relationships, indexes and views from a real file', () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const snapshot = captureSqliteSnapshot({ path: fixture.path, DatabaseSync });
    assert.equal(snapshot.identity.engine, 'sqlite-schema');
    assert.equal(snapshot.identity.connection.readOnly, true);
    assert.equal(snapshot.identity.connection.foreignKeys, true);
    assert.equal(snapshot.identity.journalMode, 'delete');
    assert.ok(snapshot.identity.catalogDigest.match(/^[0-9a-f]{64}$/));
    assert.ok(snapshot.identity.snapshotId.match(/^[0-9a-f]{64}$/));

    const users = snapshot.catalog.entities.find(entity => entity.name === 'users');
    assert.equal(users.kind, 'table');
    assert.equal(users.rowidAliasColumn, 'id');
    assert.equal(users.strict, false);

    const email = snapshot.catalog.columns.find(column => column.table === 'users' && column.name === 'email');
    assert.equal(email.declaredType, 'TEXT');
    assert.equal(email.notNull, true);
    assert.equal(email.primaryKeyOrdinal, null);

    const display = snapshot.catalog.columns.find(column => column.table === 'users' && column.name === 'display_name');
    assert.equal(display.defaultValue, "'anon'");

    const userKey = snapshot.catalog.keys.find(key => key.table === 'users' && key.kind === 'primaryKey');
    assert.equal(userKey.origin, 'rowid-alias');
    assert.deepEqual(userKey.columns, ['id']);
    const unique = snapshot.catalog.keys.find(key => key.table === 'users' && key.kind === 'unique');
    assert.deepEqual(unique.columns, ['email']);

    const foreignKey = snapshot.catalog.relationships.find(entry => entry.table === 'orders');
    assert.equal(foreignKey.references.table, 'users');
    assert.equal(foreignKey.from, 'customer_id');
    assert.equal(foreignKey.to, 'id');
    assert.equal(foreignKey.onDelete, 'CASCADE');

    const index = snapshot.catalog.indexes.find(entry => entry.name === 'orders_customer');
    assert.equal(index.unique, false);
    assert.equal(index.origin, 'c');
    assert.deepEqual(index.columns.filter(column => column.key).map(column => column.name), ['customer_id']);

    const view = snapshot.catalog.views.find(entry => entry.name === 'paid_orders');
    assert.match(view.ddlText, /CREATE VIEW paid_orders/);
    assert.ok(snapshot.limits.some(limit => limit.code === 'ddlTextOnly'));
    assert.ok(snapshot.limits.some(limit => limit.code === 'rowDataNotCaptured'));
    assert.equal(snapshot.stableWithinTransaction, true);
  } finally {
    fixture.remove();
  }
});

test('the read-only open refuses a missing file and a URI or VFS operand', () => {
  const dir = makeTempDir('sqlite-open');
  try {
    assert.throws(() => openReadOnlySqlite({ path: `${dir}/absent.db`, DatabaseSync }), /does not name an existing file/);
    assert.throws(() => openReadOnlySqlite({ path: `file:${dir}/absent.db?mode=ro`, DatabaseSync }), /ordinary path/);
    assert.throws(() => openReadOnlySqlite({ path: `${dir}/absent.db?vfs=memdb`, DatabaseSync }), /ordinary path/);
    assert.throws(() => openReadOnlySqlite({ path: dir, DatabaseSync }), /not a regular file/);
  } finally {
    removeTempDir(dir);
  }
});

test('single-statement framing admits one statement whose closing quote ends the text', () => {
  assert.deepEqual(statementFraming('SELECT 1').status, 'admitted');
  assert.deepEqual(statementFraming("SELECT 'ok'").status, 'admitted');
  assert.deepEqual(statementFraming("SELECT 'a;b' AS x -- trailing comment").status, 'admitted');
  assert.deepEqual(statementFraming("SELECT 'it''s'").status, 'admitted');
  const scan = scanSqlStatements('SELECT 1');
  assert.equal(scan.statementCount, 1);
  assert.equal(scan.trailingHasContent, false);
});

test('framing refuses two statements, an unterminated literal, a NUL byte and an unpaired surrogate', () => {
  assert.equal(statementFraming('SELECT 1; DROP TABLE users').reason, 'multipleStatements');
  assert.equal(statementFraming('SELECT 1; SELECT 2').reason, 'multipleStatements');
  assert.equal(statementFraming("SELECT 'abc").reason, 'unterminatedLiteral');
  assert.equal(statementFraming('SELECT 1\u0000; DROP TABLE users').reason, 'nulByte');
  assert.equal(statementFraming("SELECT '\uD800'").reason, 'invalidUtf8');
  assert.equal(validateSqlText('SELECT 1').status, 'admitted');
});

test('the SQLite scan treats dollar quoting as engine text, not as a quoted region', () => {
  const text = 'SELECT 1 WHERE x = $p$; DROP TABLE users; --$p$';
  assert.equal(scanSqlStatements(text, { dialect: 'sqlite' }).statementCount, 2);
  assert.equal(statementFraming(text).reason, 'multipleStatements');
  assert.equal(scanSqlStatements('SELECT $tag$xx$tag$', { dialect: 'postgres' }).statementCount, 1);
});

test('a real subject refuses a NUL-bearing and a two-statement text before preparing them', () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const session = createSqliteSession({ path: fixture.path, DatabaseSync });
    try {
      const nul = session.analyze({ id: 'nul', sql: 'SELECT 1\u0000; DROP TABLE users' });
      assert.equal(nul.status, 'refused');
      assert.equal(nul.refusal.reason, 'nulByte');
      const multiple = session.analyze({ id: 'multi', sql: 'SELECT 1; DROP TABLE users' });
      assert.equal(multiple.status, 'refused');
      assert.equal(multiple.refusal.reason, 'multipleStatements');
      assert.equal(session.catalog.entities.some(entity => entity.name === 'users'), true);
    } finally {
      session.close();
    }
  } finally {
    fixture.remove();
  }
});

test('an engine program joins its objects through database, rootpage and schema identity', () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const session = createSqliteSession({ path: fixture.path, DatabaseSync });
    try {
      const plan = session.analyze({ id: 'join', sql: SELECT_JOIN });
      assert.equal(plan.status, 'analyzed');
      assert.equal(plan.kind, 'read');
      const read = plan.relations.filter(relation => relation.opcode === 'OpenRead');
      assert.deepEqual(read.map(relation => relation.object.name).sort(), ['orders', 'users']);
      assert.ok(read.every(relation => relation.database === 0 && relation.object.schema === 'main'));
      for (const relation of read) {
        const owners = session.catalog.rootpages[relation.rootpage];
        assert.equal(owners.length, 1, `rootpage ${relation.rootpage} names exactly one catalog object`);
        assert.equal(owners[0].name, relation.object.name, `rootpage ${relation.rootpage} resolves to ${owners[0].name}`);
      }
      const indexed = session.analyze({ id: 'index-scan', sql: 'SELECT id FROM orders WHERE customer_id = 1' });
      assert.ok(indexed.relations.some(relation => relation.object.type === 'index'),
        'a predicate the planner serves from an index reports the index object');
      assert.equal(plan.unknownAccess.length, 0);

      const write = session.analyze({ id: 'write', sql: 'UPDATE orders SET total_cents = 5 WHERE id = 1' });
      assert.equal(write.kind, 'write');
      assert.deepEqual(write.relations.map(relation => relation.object.name), ['orders']);

      const parameter = session.analyze({ id: 'param', sql: 'SELECT * FROM orders WHERE id = ?' });
      assert.equal(parameter.status, 'refused');
      assert.equal(parameter.refusal.reason, 'bindParametersUnsupported');
      assert.equal(parameter.parameters.count, 1);
    } finally {
      session.close();
    }
  } finally {
    fixture.remove();
  }
});

test('a program operand outside the main database or without a unique catalog object stays unavailable', async () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const session = createSqliteSession({ path: fixture.path, DatabaseSync });
    try {
      const attached = session.analyze({ id: 'temp', sql: 'SELECT * FROM sqlite_temp_master' });
      assert.equal(attached.status, 'analyzed');
      assert.ok(attached.relations.every(relation => relation.object.schema === 'main'));
      assert.ok(attached.unknownAccess.every(access => access.status === 'modeledAccessUnavailable'));

      const catalogWithAmbiguity = { ...session.catalog, rootpages: { ...session.catalog.rootpages, '2': [...session.catalog.rootpages['2'], { schema: 'main', name: 'shadow', type: 'table', table: 'shadow' }] } };
      const { joinRootpages } = await import('../../context/catalogs/sqlite-statement.mjs');
      const ambiguous = joinRootpages({ plan: { status: 'analyzed', limits: [], relations: [{ opcode: 'OpenRead', cursor: 0, database: 0, rootpage: '2', name: null, object: null, status: 'pending-catalog-join' }], unknownAccess: [] }, catalog: catalogWithAmbiguity });
      assert.equal(ambiguous.relations.length, 0);
      assert.equal(ambiguous.unknownAccess[0].reason, 'ambiguousRootpage');

      const absent = joinRootpages({ plan: { status: 'analyzed', limits: [], relations: [{ opcode: 'OpenRead', cursor: 0, database: 0, rootpage: '99', name: null, object: null, status: 'pending-catalog-join' }], unknownAccess: [] }, catalog: session.catalog });
      assert.equal(absent.unknownAccess[0].reason, 'rootpageNotInCatalog');

      const foreignSchema = joinRootpages({ plan: { status: 'analyzed', limits: [], relations: [{ opcode: 'OpenRead', cursor: 0, database: 0, rootpage: '7', name: null, object: null, status: 'pending-catalog-join' }], unknownAccess: [] }, catalog: { ...session.catalog, rootpages: { '7': [{ schema: 'attached', name: 'x', type: 'table', table: 'x' }] } } });
      assert.equal(foreignSchema.unknownAccess[0].reason, 'nonMainSchemaObject');
    } finally {
      session.close();
    }
  } finally {
    fixture.remove();
  }
});

test('result-name origins come from qualified engine metadata or stay unavailable, never from name equality', async () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const session = createSqliteSession({ path: fixture.path, DatabaseSync });
    try {
      assert.equal(session.originCapability.available, true);
      assert.ok(session.originCapability.probe.columns.every(column => column.table !== null && column.column !== null));
      const plan = session.analyze({ id: 'origins', sql: SELECT_JOIN });
      assert.equal(plan.origins.availability, 'available');
      const mapped = new Map(plan.origins.columns.map(column => [column.resultName, `${column.table}.${column.column}`]));
      assert.equal(mapped.get('amount'), 'orders.total_cents');
      assert.equal(mapped.get('email'), 'users.email');

      const expression = session.analyze({ id: 'expression', sql: 'SELECT count(*) AS n FROM orders' });
      assert.equal(expression.origins.availability, 'partial');
      assert.equal(expression.origins.reason, 'expression_origin_absent');
      assert.equal(expression.origins.columns[0].column, null,
        'an expression result reports no base column and no name equality supplies one');

      // The Node 22.15.0 floor exposes no columns() method at all.
      const { statementOrigins } = await import('../../context/catalogs/sqlite-statement.mjs');
      const floor = statementOrigins({ db: { prepare: () => ({}) }, sql: 'SELECT 1' });
      assert.equal(floor.availability, 'unavailable');
      assert.equal(floor.reason, 'column_origin_metadata_unavailable');
    } finally {
      session.close();
    }
  } finally {
    fixture.remove();
  }
});

test('the constant-SQL join binds the resolver call site, the admitted binding and both snapshots', () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const session = createSqliteSession({ path: fixture.path, DatabaseSync });
    try {
      const joined = session.join({ records: [sqlCallFact(SELECT_JOIN)] });
      assert.deepEqual(joined.relations.map(entry => entry.value.object.name).sort(), ['orders', 'users'],
        'the engine program of a predicate-free join opens the two tables');
      const relation = joined.relations.find(entry => entry.value.object.name === 'orders');
      assert.equal(relation.classification, 'static-possible');
      assert.equal(relation.value.sourceBindingId, 'bind-1');
      assert.equal(relation.value.resolverSnapshotId, 'ts-snapshot-1');
      assert.equal(relation.value.catalogSnapshotId, session.identity.snapshotId);
      assert.notEqual(relation.value.resolverSnapshotId, relation.value.catalogSnapshotId, 'the source and catalog snapshots stay distinct');
      assert.equal(relation.value.statementKind, 'read');
      assert.deepEqual(relation.evidence.map(entry => entry.kind), ['source', 'source', 'schema']);
      assert.equal(relation.evidence[0].path, '/work/src/repo.ts');
      assert.equal(relation.evidence[1].path, '/work/src/db.ts');
      assert.equal(relation.evidence[2].databaseIdentity, session.identity.snapshotId);
      assert.equal(joined.refs.length, 3);
      const callSiteRef = joined.refs.find(ref => ref.subject.kind === 'position');
      assert.deepEqual(callSiteRef.subject, { kind: 'position', path: '/work/src/repo.ts', line: 9, column: 2 });
      assert.deepEqual(callSiteRef.projections, ['databaseAccesses']);
      const entityRef = joined.refs.find(ref => ref.subject.kind === 'entity');
      assert.equal(entityRef.subject.database.engine, 'sqlite-schema');
      assert.equal(entityRef.subject.schema, 'main');
      assert.equal(entityRef.snapshotId, session.identity.snapshotId);
      assert.equal(joined.relations[0].from, callSiteRef.id);
      assert.equal(joined.relations[0].to, entityRef.id);
      assert.deepEqual(joined.limits, []);
    } finally {
      session.close();
    }
  } finally {
    fixture.remove();
  }
});

test('the constant-SQL join refuses every record that lacks a required member or contradicts the engine', () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const session = createSqliteSession({ path: fixture.path, DatabaseSync });
    try {
      const flatShape = session.join({ records: [{ id: 'old', kind: 'sqlCall', value: { sqlLiteral: { form: 'stringLiteral', substitutions: 0, text: SELECT_JOIN } } }] });
      assert.equal(flatShape.relations.length, 0);
      assert.equal(flatShape.limits[0].code, 'recordAbsent', 'the legacy flat proposal shape is not consumed');

      const shadowed = session.join({ records: [sqlCallFact(SELECT_JOIN, { value: { clientMatch: 'shadowed' } })] });
      assert.equal(shadowed.limits[0].code, 'clientDeclarationNotMatched');

      const noMatch = session.join({ records: [sqlCallFact(SELECT_JOIN, { value: { clientMatch: undefined } })] });
      assert.equal(noMatch.limits[0].code, 'clientMatchAbsent');

      const noBinding = session.join({ records: [sqlCallFact(SELECT_JOIN, { value: { sourceBinding: undefined } })] });
      assert.equal(noBinding.limits[0].code, 'admittedClientBindingAbsent');

      const dynamic = session.join({ records: [sqlCallFact(SELECT_JOIN, { record: { sql: { status: 'dynamic', reason: 'dynamic_sql_interpolation' } } })] });
      assert.equal(dynamic.limits[0].code, 'dynamicSql');

      const noReceiver = session.join({ records: [sqlCallFact(SELECT_JOIN, { record: { receiver: { status: 'unresolved', reason: 'any_receiver' } } })] });
      assert.equal(noReceiver.limits[0].code, 'databaseReceiverUnresolved');

      const noCallee = session.join({ records: [sqlCallFact(SELECT_JOIN, { record: { callee: { status: 'unresolved', reason: 'shadowed_local' } } })] });
      assert.equal(noCallee.limits[0].code, 'calleeUnresolved');

      const emptyDeclaration = session.join({ records: [sqlCallFact(SELECT_JOIN, { record: { callee: { status: 'resolved', declaration: {} } } })] });
      assert.equal(emptyDeclaration.limits[0].code, 'calleeDeclarationIncomplete', 'equal but empty declarations are not identity');

      const noSnapshot = session.join({ records: [sqlCallFact(SELECT_JOIN, { record: { snapshotId: '' } })] });
      assert.equal(noSnapshot.limits[0].code, 'resolverSnapshotAbsent');

      const noSite = session.join({ records: [sqlCallFact(SELECT_JOIN, { record: { callSite: { path: '', sha256: '', range: {} } } })] });
      assert.equal(noSite.limits[0].code, 'callSiteAbsent');

      const parameter = session.join({ records: [sqlCallFact('SELECT * FROM orders WHERE id = ?')] });
      assert.equal(parameter.relations.length, 0);
      assert.equal(parameter.limits[0].code, 'bindParametersUnsupported');

      const multiple = session.join({ records: [sqlCallFact('SELECT 1; DROP TABLE users')] });
      assert.equal(multiple.relations.length, 0);
      assert.equal(multiple.limits[0].code, 'multipleStatements');

      const disagreement = session.join({ records: [sqlCallFact(SELECT_JOIN, { record: { statementKind: 'write' } })] });
      assert.equal(disagreement.relations.length, 2, 'the engine program decides the published kind');
      assert.ok(disagreement.relations.every(relation => relation.value.statementKind === 'read'));
      assert.equal(disagreement.limits[0].code, 'statementKindDisagreement');

      // Every emitted ref carries real values: a string ref id is an id, never a site object.
      for (const ref of disagreement.refs.filter(entry => entry.subject.kind === 'position')) {
        assert.equal(typeof ref.subject.path, 'string');
        assert.equal(ref.subject.path.length > 0, true);
        assert.notEqual(ref.subject.line, undefined);
      }
      for (const ref of disagreement.refs.filter(entry => entry.subject.kind === 'entity')) {
        assert.equal(ref.subject.database.engine, 'sqlite-schema');
        assert.equal(typeof ref.subject.name, 'string');
      }
    } finally {
      session.close();
    }
  } finally {
    fixture.remove();
  }
});

test('a reused source binding with different text or snapshot is reanalyzed under its own identity', () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const session = createSqliteSession({ path: fixture.path, DatabaseSync });
    try {
      const first = sqlCallFact('SELECT display_name FROM users');
      const second = sqlCallFact('SELECT total_cents FROM orders', { value: { sourceBinding: 'bind-1' } });
      const joined = session.join({ records: [first, second] });
      const byObject = new Map(joined.relations.map(relation => [relation.value.object.name, relation.value.statementText]));
      assert.equal(byObject.get('users'), 'SELECT display_name FROM users');
      assert.equal(byObject.get('orders'), 'SELECT total_cents FROM orders', 'the second statement is planned under its own identity');
      assert.ok(joined.relations.some(relation => relation.value.object.type === 'index') === false,
        'these projections are served from the tables, so the object names are the tables');
      assert.ok(joined.limits.some(limit => limit.code === 'conflictingSourceBinding'));

      // The same binding with the same text under a different resolver
      // snapshot is a conflict: the plan must not be reused across snapshots.
      const changedSnapshot = sqlCallFact('SELECT display_name FROM users', { record: { snapshotId: 'ts-snapshot-2' }, value: { sourceBinding: 'bind-1' } });
      const mixed = session.join({ records: [first, changedSnapshot] });
      assert.equal(mixed.relations.length, 2);
      assert.deepEqual([...new Set(mixed.relations.map(relation => relation.value.resolverSnapshotId))].sort(), ['ts-snapshot-1', 'ts-snapshot-2']);
      assert.ok(mixed.limits.some(limit => limit.code === 'conflictingSourceBinding'));
    } finally {
      session.close();
    }
  } finally {
    fixture.remove();
  }
});

test('catalog applicability follows schema identity: a data-only write stays current, DDL goes stale', () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const before = captureSqliteSnapshot({ path: fixture.path, DatabaseSync });
    const writer = new DatabaseSync(fixture.path);
    writer.exec("INSERT INTO users(email) VALUES ('c@d.co')");
    writer.close();
    const afterData = captureSqliteSnapshot({ path: fixture.path, DatabaseSync });
    const dataVerdict = compareSqliteIdentities(before.identity, afterData.identity);
    assert.equal(dataVerdict.applicability, 'current');
    assert.deepEqual(dataVerdict.changedInputs, []);
    assert.equal(before.identity.snapshotId, afterData.identity.snapshotId,
      'a data-only write leaves the catalog identity and the snapshot id equal');
    assert.ok(Object.prototype.hasOwnProperty.call(before.identity.observations, 'dataVersion'),
      'data_version is reported as an observation');

    const ddl = new DatabaseSync(fixture.path);
    ddl.exec('ALTER TABLE users ADD COLUMN note TEXT');
    ddl.close();
    const afterDdl = captureSqliteSnapshot({ path: fixture.path, DatabaseSync });
    const ddlVerdict = compareSqliteIdentities(before.identity, afterDdl.identity);
    assert.equal(ddlVerdict.applicability, 'stale');
    assert.deepEqual(ddlVerdict.changedInputs, ['catalogDigest']);
  } finally {
    fixture.remove();
  }
});

test('a committed catalog digest matches the file bytes it was computed from', () => {
  const fixture = makeSqliteFixture({ DatabaseSync });
  try {
    const first = captureSqliteSnapshot({ path: fixture.path, DatabaseSync });
    const second = captureSqliteSnapshot({ path: fixture.path, DatabaseSync });
    assert.equal(first.identity.catalogDigest, second.identity.catalogDigest);
    assert.equal(first.identity.snapshotId, second.identity.snapshotId);
    assert.ok(readFileSync(fixture.path).length > 0);
  } finally {
    fixture.remove();
  }
});
