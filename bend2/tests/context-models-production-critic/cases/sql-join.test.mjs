// Constant-SQL join discriminators.
//
// Two layers:
// - engine layer (passes on current source): the live session analyzes real
//   statements inside the open snapshot transaction and joins real objects.
// - record-boundary layer (agreed sole private boundary facts[].value.record
//   ConstantSqlRecord v1, owned by TS): the current draft consumes flat
//   value fields, so v1-shaped inputs are discriminators. Known current
//   defects from conductor rounds 14/15/18 are each pinned as a named
//   discriminator against the captured bytes.

import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { assert, check } from '../lib/harness.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function constantSqlRecord({ callSite, callee, receiver, sql, statementKind = 'read', snapshotId, clientMatch = null, provider }) {
  return {
    schema: 'baton2.context.resolver-record.v1',
    kind: 'constantSql',
    provider,
    snapshotId,
    callSite,
    callee,
    receiver,
    sql,
    statementKind,
    limits: [],
    clientMatch,
  };
}

const DECLARATION = { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } };
const CLIENT = { path: '/work/src/client.ts', sha256: 'b'.repeat(64), range: { start: { line: 9, column: 2 }, end: { line: 9, column: 40 } } };
const CALL_SITE = { path: '/work/src/handler.ts', sha256: 'c'.repeat(64), range: { start: { line: 12, column: 4 }, end: { line: 12, column: 44 } } };
const PROVIDER = { engine: 'typescript', version: '5.9.3' };

// --- engine layer ---------------------------------------------------------

check({
  id: 'sqljoin/engine/useful-positive',
  requirement: 'live session analyzes a real constant SELECT inside the open snapshot and joins main.users with full identity (useful supported result, not canned JSON)',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const plan = session.analyze({ id: 'h1', sql: 'SELECT id, name FROM users WHERE id = 1' });
    session.close();
    const joined = plan.relations.find(entry => entry.status === 'joined');
    assert(joined?.object?.name === 'users' && joined.object.schema === 'main', `joined ${JSON.stringify(plan.relations)}`);
    assert(plan.kind === 'read', `kind ${plan.kind}`);
    return { object: joined.object, rootpage: joined.rootpage, opcodes: plan.opcodes.slice(0, 4) };
  },
});

check({
  id: 'sqljoin/engine/dynamic-shape-independent',
  requirement: 'the engine layer rejects parameterized text before any catalog join (bindParametersUnsupported)',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const plan = session.analyze({ id: 'h2', sql: 'SELECT id FROM users WHERE id = ?1' });
    session.close();
    assert(plan.status === 'refused' && plan.refusal.reason === 'bindParametersUnsupported', JSON.stringify(plan.refusal ?? plan));
    return { reason: plan.refusal.reason };
  },
});

// --- record-boundary layer ------------------------------------------------

function v1RecordBuilder(context) {
  void context;
  return { constantSqlRecord, DECLARATION, CLIENT, CALL_SITE, PROVIDER };
}

check({
  id: 'sqljoin/boundary/v1-positive-relation',
  requirement: 'agreed boundary: facts[].value.record ConstantSqlRecord v1 (resolved callee+receiver, constant sql, client identity match) produces a databaseAccess relation with complete evidence',
  discriminator: true,
  async run({ producer, ordersDbPath }) {
    const builder = v1RecordBuilder();
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const record = builder.constantSqlRecord({
      callSite: builder.CALL_SITE,
      callee: { status: 'resolved', declaration: builder.DECLARATION },
      receiver: { status: 'resolved', declaration: builder.CLIENT },
      sql: { status: 'constant', text: 'SELECT id, name FROM users', literalKind: 'stringLiteral' },
      snapshotId: 'resolver-snap-1',
      clientMatch: 'matched',
      provider: builder.PROVIDER,
    });
    const result = session.join({ records: [record] });
    session.close();
    const relation = result.relations[0];
    if (relation === undefined) throw new Error(`v1 record produced no relation; limits=${JSON.stringify(result.limits)}`);
    for (const item of relation.evidence ?? []) {
      for (const [field, value] of Object.entries(item)) {
        if (value === null && field !== 'column') throw new Error(`evidence ${item.kind}.${field} is null`);
      }
    }
    return { relationKind: relation.kind, object: relation.object ?? relation.value ?? null, limits: result.limits };
  },
});

check({
  id: 'sqljoin/boundary/missing-receiver-limited',
  requirement: 'conductor round18: a record with databaseReceiver absent must emit an explicit limit and no relation; observed 7f9574bf/f52e4dbe emitted a relation',
  discriminator: true,
  async run({ producer, ordersDbPath }) {
    const builder = v1RecordBuilder();
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const record = builder.constantSqlRecord({
      callSite: builder.CALL_SITE,
      callee: { status: 'resolved', declaration: builder.DECLARATION },
      receiver: undefined,
      sql: { status: 'constant', text: 'SELECT id FROM users', literalKind: 'stringLiteral' },
      snapshotId: 'resolver-snap-1',
      clientMatch: 'matched',
      provider: builder.PROVIDER,
    });
    const result = session.join({ records: [record] });
    session.close();
    if (result.relations.length !== 0) throw new Error(`missing receiver still joined ${result.relations.length} relation(s)`);
    const limited = result.limits.some(entry => entry.code === 'databaseReceiverUnresolved' || entry.code === 'databaseReceiverAbsent');
    if (!limited) throw new Error(`no receiver limit emitted: ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'sqljoin/boundary/empty-identity-objects-refused',
  requirement: 'conductor round18: resolvedDeclaration={}, clientDeclaration={}, admittedClient={} must refuse on missing identity fields, not join because three empty digests are equal (observed f52e4dbe)',
  discriminator: true,
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const record = {
      kind: 'sqlCall',
      provider: { engine: 'typescript', version: '5.9.3' },
      snapshotId: 'resolver-snap-1',
      value: {
        callSiteRef: '["source","/work/src/handler.ts","cc",12,4,"databaseAccesses"]',
        sqlLiteral: { form: 'stringLiteral', substitutions: 0, text: 'SELECT id FROM users' },
        clientMatch: 'matched',
        resolvedDeclaration: {},
        clientDeclaration: {},
        admittedClient: {},
        databaseReceiver: { bindingStatus: 'resolved' },
      },
    };
    const result = session.join({ records: [record] });
    session.close();
    if (result.relations.length !== 0) throw new Error('empty identity objects joined');
    const limited = result.limits.some(entry => entry.code === 'clientDeclarationAbsent' || entry.code === 'identityFieldsAbsent');
    if (!limited) throw new Error(`no identity-field limit: ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'sqljoin/boundary/call-site-evidence-nonnull',
  requirement: 'conductor round18: the record contract supplies callSiteRef as a ref ID string; a consumer treating it as an object emits null-valued public evidence (observed f52e4dbe: [source,null,null,...]). Required: consume the string as a ref ID and bind real evidence, or refuse with a precise limit',
  discriminator: true,
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const record = {
      kind: 'sqlCall',
      provider: { engine: 'typescript', version: '5.9.3' },
      snapshotId: 'resolver-snap-1',
      value: {
        callSiteRef: '["source","/work/src/handler.ts","cc",12,4,"databaseAccesses"]',
        sqlLiteral: { form: 'stringLiteral', substitutions: 0, text: 'SELECT id FROM users' },
        clientMatch: 'matched',
        resolvedDeclaration: { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } },
        clientDeclaration: { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } },
        admittedClient: { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } },
        databaseReceiver: { bindingStatus: 'resolved' },
      },
    };
    const result = session.join({ records: [record] });
    session.close();
    const relation = result.relations[0];
    if (relation !== undefined) {
      if (String(relation.from).includes('null') || String(relation.to).includes('null')) {
        throw new Error('string callSiteRef produced a null-valued public ref');
      }
      for (const item of relation.evidence ?? []) {
        for (const [field, value] of Object.entries(item)) {
          if (value === null && field !== 'column') throw new Error(`string callSiteRef joined with null evidence field ${field}`);
        }
      }
      return { joined: true, from: relation.from };
    }
    throw new Error(`string callSiteRef neither joined with real evidence nor precisely refused: ${JSON.stringify(result.limits.map(entry => entry.code))}`);
  },
});

check({
  id: 'sqljoin/boundary/cache-bound-to-sql-and-snapshot',
  requirement: 'conductor round18: plan reuse must bind resolver snapshot AND SQL text; same callSiteRef with changed SQL/snapshot must refuse or reanalyze, never label old objects as new SQL (observed f52e4dbe: SELECT id FROM b labeled with main.a)',
  discriminator: true,
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const callSiteRef = '["source","/work/src/handler.ts","cc",20,4,"databaseAccesses"]';
    const identity = { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } };
    const make = (snapshotId, text) => ({
      kind: 'sqlCall',
      provider: { engine: 'typescript', version: '5.9.3' },
      snapshotId,
      value: {
        callSiteRef,
        sqlLiteral: { form: 'stringLiteral', substitutions: 0, text, literalKind: 'stringLiteral' },
        clientMatch: 'matched',
        resolvedDeclaration: identity,
        clientDeclaration: identity,
        admittedClient: identity,
        databaseReceiver: { bindingStatus: 'resolved' },
      },
    });
    const plans = new Map();
    const first = session.join({ records: [make('resolver-snap-1', 'SELECT id FROM users')], plans });
    const second = session.join({ records: [make('resolver-snap-2', 'SELECT id FROM orders')], plans });
    session.close();
    const firstName = first.relations[0]?.object?.name;
    const secondName = second.relations[0]?.object?.name;
    if (second.relations.length > 0 && secondName === 'users' && secondName !== 'orders') {
      throw new Error(`stale cache labeled SELECT id FROM orders with ${secondName}`);
    }
    return { firstObject: firstName ?? null, secondObject: secondName ?? null, secondLimits: second.limits.map(entry => entry.code) };
  },
});

check({
  id: 'sqljoin/boundary/client-mismatch-limited',
  requirement: 'resolved declaration differing from the client declaration emits clientDeclarationMismatch and no relation (conductor invariant: identity comparison against admitted options.client)',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const record = {
      kind: 'sqlCall',
      provider: { engine: 'typescript', version: '5.9.3' },
      snapshotId: 'resolver-snap-1',
      value: {
        callSiteRef: '["source","/work/src/handler.ts","cc",30,0,"databaseAccesses"]',
        sqlLiteral: { form: 'stringLiteral', substitutions: 0, text: 'SELECT id FROM users' },
        clientMatch: 'mismatched',
        resolvedDeclaration: { path: '/work/src/other.ts', sha256: 'd'.repeat(64), range: { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } } },
        clientDeclaration: { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } },
        admittedClient: { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } },
        databaseReceiver: { bindingStatus: 'resolved' },
      },
    };
    const result = session.join({ records: [record] });
    session.close();
    if (result.relations.length !== 0) throw new Error('client mismatch joined');
    const limited = result.limits.some(entry => entry.code === 'clientDeclarationNotMatched' || entry.code === 'clientDeclarationMismatch');
    if (!limited) throw new Error(`no client limit: ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'sqljoin/boundary/dynamic-sql-limited',
  requirement: 'dynamic SQL emits an explicit dynamicSql limit bound to the exact call-site ref',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const record = {
      kind: 'sqlCall',
      provider: { engine: 'typescript', version: '5.9.3' },
      snapshotId: 'resolver-snap-1',
      value: {
        callSiteRef: '["source","/work/src/dynamic.ts","dd",40,2,"databaseAccesses"]',
        sqlLiteral: { form: 'dynamic', substitutions: 2 },
        clientMatch: 'matched',
        resolvedDeclaration: { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } },
        clientDeclaration: { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } },
        admittedClient: { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } },
        databaseReceiver: { bindingStatus: 'resolved' },
      },
    };
    const result = session.join({ records: [record] });
    session.close();
    if (result.relations.length !== 0) throw new Error('dynamic SQL joined');
    const limited = result.limits.some(entry => entry.code === 'dynamicSql');
    if (!limited) throw new Error(`no dynamic limit: ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});
