// Constant-SQL join qualification against the committed producer contract
// (catalogs c6fc585d: facts[].value.record ConstantSqlRecord with admitted
// provenance; the flat proposal shape is refused).
//
// The useful positive is complete (every provenance component present and a
// real joined catalog object). Each negative varies exactly one provenance
// component from the positive. When the single TS joint-fixture artifact is
// supplied through CTX_TS_RECORDS, the positive runs on its real records;
// without it that one check reports pending and the run exits 2.

import { DatabaseSync } from 'node:sqlite';

import { assert, check } from '../lib/harness.mjs';

const DECLARATION = { path: '/work/src/db.ts', sha256: 'a'.repeat(64), range: { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } } };
const CALL_SITE = { path: '/work/src/handler.ts', sha256: 'c'.repeat(64), range: { start: { line: 12, column: 4 }, end: { line: 12, column: 44 } } };

function recordFact({ snapshotId = 'resolver-snap-1', callSite = CALL_SITE, callee = { status: 'resolved', declaration: DECLARATION }, receiver = { status: 'resolved', declaration: DECLARATION }, sql = { status: 'constant', text: 'SELECT id, name FROM users', literalKind: 'stringLiteral' }, statementKind = 'read', clientMatch = 'matched', sourceBinding = 'binding-1', moduleSource } = {}) {
  return {
    kind: 'sqlCall',
    provider: { engine: 'typescript', version: '5.9.3' },
    value: {
      record: {
        schema: 'baton2.context.resolver-record.v1',
        kind: 'constantSql',
        snapshotId,
        callSite,
        callee,
        receiver,
        sql,
        statementKind,
        limits: [],
      },
      clientMatch,
      sourceBinding,
      ...(moduleSource !== undefined ? { moduleSource } : {}),
    },
  };
}

// --- engine layer ---------------------------------------------------------

check({
  id: 'sqljoin/engine/useful-positive',
  requirement: 'live session analyzes a real constant SELECT inside the open snapshot and joins a captured main-database object with full identity (useful supported result, not canned JSON)',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const plan = session.analyze({ id: 'h1', sql: 'SELECT id, name FROM users WHERE id = 1' });
    session.close();
    const joined = plan.relations.find(entry => entry.status === 'joined');
    assert(joined?.object?.schema === 'main' && joined?.object?.table === 'users', `join observed ${JSON.stringify(plan.relations)}`);
    assert(plan.kind === 'read', `kind ${plan.kind}`);
    return { object: joined.object, rootpage: joined.rootpage };
  },
});

check({
  id: 'sqljoin/engine/parameters-refused',
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

// --- consumer boundary over facts[].value.record --------------------------

check({
  id: 'sqljoin/boundary/complete-positive-real-records',
  requirement: 'the single TS joint-fixture artifact supplies real producer records: at least one admitted constantSql fact joins with complete evidence and valid public refs (CTX_TS_RECORDS consumed, hashed and validated)',
  async run({ producer, ordersDbPath, tsRecords }) {
    if (!tsRecords.present || tsRecords.constantSqlCount === 0) {
      return { pending: true, reason: 'the TS joint-fixture record artifact is absent; boundary positives need the real producer records (CTX_TS_RECORDS)' };
    }
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const result = session.join({ records: tsRecords.constantSql });
    session.close();
    const relation = result.relations[0];
    if (relation === undefined) throw new Error(`no real record joined; limits=${JSON.stringify(result.limits.map(entry => entry.code))}`);
    for (const item of relation.evidence ?? []) {
      for (const [field, value] of Object.entries(item)) {
        if (value === null && field !== 'column') throw new Error(`real-record relation evidence ${item.kind}.${field} is null`);
      }
    }
    return { relations: result.relations.length, from: relation.from, object: relation.value?.object ?? null, artifactSha256: tsRecords.sha256 };
  },
});

check({
  id: 'sqljoin/boundary/complete-positive-authored',
  requirement: 'a complete admitted fact (resolved callee+receiver declarations, matched client comparison, source binding, constant literal) joins a real catalog object with non-null evidence and valid public selector refs',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const result = session.join({ records: [recordFact()] });
    session.close();
    const relation = result.relations[0];
    if (relation === undefined) throw new Error(`complete fact joined nothing; limits=${JSON.stringify(result.limits.map(entry => entry.code))}`);
    for (const item of relation.evidence ?? []) {
      for (const [field, value] of Object.entries(item)) {
        if (value === null && field !== 'column') throw new Error(`evidence ${item.kind}.${field} is null`);
      }
    }
    assert(relation.value?.statementText === 'SELECT id, name FROM users', `statementText ${relation.value?.statementText}`);
    assert(relation.value?.catalogSnapshotId !== null, 'catalog snapshot identity missing from the relation');
    for (const refId of [relation.from, relation.to]) {
      const parsed = JSON.parse(refId);
      assert(['source', 'entity'].includes(parsed[0]), `invented selector kind ${parsed[0]} in ${refId}`);
    }
    return { from: relation.from, to: relation.to, object: relation.value.object, statementKind: relation.value.statementKind };
  },
});

check({
  id: 'sqljoin/boundary/receiver-unresolved-limited',
  requirement: 'negative varying only the receiver component: receiver status unresolved yields databaseReceiverUnresolved and no relation (no bypass on an absent or unresolved receiver)',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const result = session.join({ records: [recordFact({ receiver: { status: 'unresolved', reason: 'any-typed receiver' } })] });
    session.close();
    assert(result.relations.length === 0, 'unresolved receiver still joined');
    assert(result.limits.some(entry => entry.code === 'databaseReceiverUnresolved'), `limits ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'sqljoin/boundary/incomplete-callee-declaration-refused',
  requirement: 'negative varying only the callee declaration digest: an incomplete declaration identity refuses with calleeDeclarationIncomplete instead of joining on three equal empty digests',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const result = session.join({ records: [recordFact({ callee: { status: 'resolved', declaration: { path: '/work/src/db.ts', sha256: '', range: CALL_SITE_RANGE() } } })] });
    session.close();
    assert(result.relations.length === 0, 'incomplete callee declaration joined');
    assert(result.limits.some(entry => entry.code === 'calleeDeclarationIncomplete'), `limits ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});

function CALL_SITE_RANGE() {
  return { start: { line: 3, column: 0 }, end: { line: 3, column: 30 } };
}

check({
  id: 'sqljoin/boundary/client-match-required',
  requirement: 'negative varying only the client comparison: a fact with no clientMatch refuses with clientMatchAbsent; a mismatched verdict refuses with clientDeclarationNotMatched',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const absent = session.join({ records: [recordFact({ clientMatch: undefined })] });
    const mismatched = session.join({ records: [recordFact({ clientMatch: 'mismatched' })] });
    session.close();
    assert(absent.relations.length === 0 && absent.limits.some(entry => entry.code === 'clientMatchAbsent'), `absent observed ${JSON.stringify(absent.limits.map(entry => entry.code))}`);
    assert(mismatched.relations.length === 0 && mismatched.limits.some(entry => entry.code === 'clientDeclarationNotMatched'), `mismatched observed ${JSON.stringify(mismatched.limits.map(entry => entry.code))}`);
    return { absent: absent.limits.map(entry => entry.code), mismatched: mismatched.limits.map(entry => entry.code) };
  },
});

check({
  id: 'sqljoin/boundary/source-binding-required',
  requirement: 'negative varying only the provenance binding: a fact without the admitted source binding refuses with admittedClientBindingAbsent',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const result = session.join({ records: [recordFact({ sourceBinding: '' })] });
    session.close();
    assert(result.relations.length === 0, 'fact without source binding joined');
    assert(result.limits.some(entry => entry.code === 'admittedClientBindingAbsent'), `limits ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'sqljoin/boundary/dynamic-sql-limited',
  requirement: 'negative varying only the statement component: a dynamic statement yields dynamicSql bound to the exact call-site record, never a plan of its text',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const result = session.join({ records: [recordFact({ sql: { status: 'dynamic', reason: 'template interpolation' } })] });
    session.close();
    assert(result.relations.length === 0, 'dynamic statement joined');
    assert(result.limits.some(entry => entry.code === 'dynamicSql'), `limits ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});

check({
  id: 'sqljoin/boundary/plan-cache-bound-to-provenance',
  requirement: 'the plan cache binds resolver snapshot AND source binding AND SQL text: reusing one source binding with a different snapshot or text names the conflict and the new relation carries its own statement object, never the stale one',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const first = session.join({ records: [recordFact()] });
    const second = session.join({ records: [recordFact({ snapshotId: 'resolver-snap-2', sql: { status: 'constant', text: 'SELECT id, total FROM orders', literalKind: 'stringLiteral' } })] });
    session.close();
    const secondRelation = second.relations[0];
    if (secondRelation !== undefined) {
      assert(secondRelation.value.statementText === 'SELECT id, total FROM orders', `stale plan labeled new SQL: ${secondRelation.value.statementText}`);
      assert(secondRelation.value.object?.table === 'orders', `new SQL joined stale object ${JSON.stringify(secondRelation.value.object)}`);
    }
    assert(second.limits.some(entry => entry.code === 'conflictingSourceBinding'), `conflict not named: ${JSON.stringify(second.limits.map(entry => entry.code))}`);
    return { firstObject: first.relations[0]?.value?.object?.table ?? null, secondObject: secondRelation?.value?.object?.table ?? null, limits: second.limits.map(entry => entry.code) };
  },
});

check({
  id: 'sqljoin/boundary/flat-shape-refused',
  requirement: 'the flat proposal shape (value.sqlLiteral and friends) is refused with recordAbsent: the sole private boundary is facts[].value.record',
  async run({ producer, ordersDbPath }) {
    const catalog = producer.modules.catalogs.catalog;
    const session = catalog.createSqliteSession({ path: ordersDbPath, DatabaseSync });
    const flat = {
      kind: 'sqlCall',
      provider: { engine: 'typescript', version: '5.9.3' },
      value: {
        sqlLiteral: { form: 'stringLiteral', substitutions: 0, text: 'SELECT id FROM users' },
        clientMatch: 'matched',
        resolvedDeclaration: DECLARATION,
        clientDeclaration: DECLARATION,
        admittedClient: DECLARATION,
        databaseReceiver: { bindingStatus: 'resolved' },
      },
    };
    const result = session.join({ records: [flat] });
    session.close();
    assert(result.relations.length === 0, 'flat shape joined');
    assert(result.limits.some(entry => entry.code === 'recordAbsent' || entry.code === 'recordKindMismatch'), `limits ${JSON.stringify(result.limits.map(entry => entry.code))}`);
    return { limits: result.limits.map(entry => entry.code) };
  },
});
