// Independent provenance negatives for the constant-SQL and model-use joins
// (semantic-impl-models lane, security critic).
//
// These cases were derived from the conductor's source review of
// bend2/context/catalogs/sql-join.mjs and bend2/context/models/model-use-join.mjs.
// They are consumer-boundary negatives over independently authored records, not
// producer output: constructor-shaped records qualify boundaries only.
//
// Required observables:
//   * a relation is emitted only from a complete, self-consistent record whose
//     module/declaration digests match the observed model and whose resolver,
//     source and catalog snapshots are present;
//   * a conflicting reuse of one source binding, a missing receiver, an
//     incomplete declaration, a name-only match and a digest mismatch each
//     produce a named limit instead of a relation;
//   * emitted evidence is non-null and refs use admitted public subject kinds
//     and projections (no invented source kinds, no codeAccesses on source).
//
//   node --test bend2/tests/context-models-security-critic/models-consumer.test.mjs
//   CONTEXT_CATALOGS_DIR=<tree>/bend2/context/catalogs CONTEXT_MODELS_DIR=<tree>/bend2/context/models node --test ...

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const catalogsDir = process.env.CONTEXT_CATALOGS_DIR ?? fileURLToPath(new URL('../../context/catalogs/', import.meta.url));
const modelsDir = process.env.CONTEXT_MODELS_DIR ?? fileURLToPath(new URL('../../context/models/', import.meta.url));

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function load(directory, name) {
  const path = join(directory, name);
  return { path, module: await import(pathToFileURL(path).href) };
}

const sqlJoin = await load(catalogsDir, 'sql-join.mjs');
const modelJoin = await load(modelsDir, 'model-use-join.mjs');
const catalog = await load(catalogsDir, 'sqlite-catalog.mjs');

console.log(JSON.stringify({
  suite: 'models-consumer',
  node: process.version,
  modules: {
    'sql-join.mjs': digest(sqlJoin.path),
    'model-use-join.mjs': digest(modelJoin.path),
  },
}));

const { joinConstantSql } = sqlJoin.module;
const { joinModelUses } = modelJoin.module;
const { createSqliteSession } = catalog.module;

const MODULE = { path: '/project/model.ts', sha256: 'a'.repeat(64) };
const OTHER = { path: '/project/other.ts', sha256: 'b'.repeat(64) };

function range(line, column = 1) {
  return { start: { line, column }, end: { line, column: column + 4 } };
}

function site(path, sha256, line, role = 'call') {
  return { path, sha256, range: range(line), role };
}

function declaration(path, sha256, line) {
  return { path, sha256, range: range(line) };
}

function sqlFact(record, extra = {}) {
  return { kind: 'sqlCall', value: { record, clientMatch: 'matched', sourceBinding: 'binding-1', ...extra } };
}

function constantRecord(text, overrides = {}) {
  return {
    kind: 'constantSql',
    snapshotId: 'resolver-1',
    callSite: site(MODULE.path, MODULE.sha256, 10),
    callee: { status: 'resolved', declaration: declaration(MODULE.path, MODULE.sha256, 4) },
    receiver: { status: 'resolved', declaration: declaration(MODULE.path, MODULE.sha256, 8) },
    sql: { status: 'constant', text },
    statementKind: 'unknown',
    ...overrides,
  };
}

function modelUseRecord(overrides = {}) {
  return {
    kind: 'modelUse',
    snapshotId: 'resolver-1',
    useSite: site(MODULE.path, MODULE.sha256, 20),
    module: { path: MODULE.path, sha256: MODULE.sha256 },
    resolution: { status: 'resolved', declaration: declaration(MODULE.path, MODULE.sha256, 3) },
    export: 'Schema',
    provider: { engine: 'typescript' },
    ...overrides,
  };
}

function observedModel(overrides = {}) {
  return { module: { path: MODULE.path, sha256: MODULE.sha256 }, export: { name: 'Schema' }, snapshotId: 'model-1', provider: { engine: 'typescript' }, ...overrides };
}

function scratchSubject() {
  const directory = mkdtempSync(join(tmpdir(), 'context-critic-consumer-'));
  const path = join(directory, 'subject.db');
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE a (id INTEGER PRIMARY KEY, note TEXT)');
  db.exec('CREATE TABLE b (id INTEGER PRIMARY KEY, note TEXT)');
  db.exec('INSERT INTO a (id, note) VALUES (1, \'x\')');
  db.close();
  return { directory, path };
}

function refusingSession() {
  const session = {
    identity: { engine: 'sqlite-schema', snapshotId: 'catalog-1', catalogDigest: 'c'.repeat(64), realPath: '/scratch/subject.db' },
    analyze() {
      session.called = true;
      throw new Error('the engine must not be reached for a refused record');
    },
    called: false,
  };
  return session;
}

function codesOf(result) {
  return result.limits.map(entry => entry.code);
}

test('a complete record joins through the engine with non-null evidence and valid refs', () => {
  const { directory, path } = scratchSubject();
  const session = createSqliteSession({ path, DatabaseSync });
  try {
    const result = joinConstantSql({ session, catalog: session.catalog, plans: new Map(), records: [sqlFact(constantRecord('SELECT id FROM a'))] });
    assert.equal(result.relations.length, 1, JSON.stringify(result.limits));
    const relation = result.relations[0];
    assert.equal(relation.kind, 'databaseAccess');
    assert.equal(relation.value.resolverSnapshotId, 'resolver-1');
    assert.ok(relation.evidence.length >= 2);
    for (const entry of relation.evidence) {
      assert.ok(entry.kind === 'source' || entry.kind === 'schema' || entry.kind === 'probe', `unexpected evidence kind ${entry.kind}`);
      if (entry.kind === 'source') {
        assert.equal(typeof entry.path, 'string');
        assert.equal(typeof entry.sha256, 'string');
        assert.ok(entry.range?.start?.line !== undefined);
      }
    }
    for (const ref of result.refs) {
      assert.ok(['position', 'symbol', 'entity', 'dataset', 'runtime'].includes(ref.subject?.kind), `ref subject kind ${ref.subject?.kind}`);
      assert.notEqual(ref.subject?.kind, 'source');
      for (const projection of ref.projections) {
        if (ref.subject.kind === 'position' || ref.subject.kind === 'symbol') assert.notEqual(projection, 'codeAccesses');
      }
      assert.equal(typeof ref.snapshotId, 'string');
    }
  } finally {
    session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the flat proposal shape is refused, not silently consumed', () => {
  const session = refusingSession();
  const fact = { kind: 'sqlCall', value: { sqlLiteral: { form: 'stringLiteral', text: 'SELECT id FROM a', substitutions: 0 }, callSiteRef: '["source",...]' } };
  const result = joinConstantSql({ session, catalog: session.catalog ?? null, plans: new Map(), records: [fact] });
  assert.equal(result.relations.length, 0);
  assert.ok(codesOf(result).includes('recordAbsent'), JSON.stringify(result.limits));
  assert.equal(session.called, false);
});

test('a conflicting reuse of one source binding is named and the plan follows its own identity', () => {
  const { directory, path } = scratchSubject();
  const session = createSqliteSession({ path, DatabaseSync });
  try {
    const records = [
      sqlFact(constantRecord('SELECT id FROM a')),
      sqlFact(constantRecord('SELECT id FROM b', { snapshotId: 'resolver-2' })),
    ];
    const result = joinConstantSql({ session, catalog: session.catalog, plans: new Map(), records });
    assert.ok(codesOf(result).includes('conflictingSourceBinding'), JSON.stringify(result.limits));
    const forB = result.relations.filter(relation => relation.value.statementText === 'SELECT id FROM b');
    assert.equal(forB.length, 1, 'the second statement must be analyzed under its own identity');
  } finally {
    session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a missing or unresolved database receiver produces a limit instead of a relation', () => {
  const session = refusingSession();
  const unresolved = sqlFact(constantRecord('SELECT id FROM a', { receiver: { status: 'unresolved', reason: 'variableKeyed' } }));
  const result = joinConstantSql({ session, catalog: null, plans: new Map(), records: [unresolved] });
  assert.equal(result.relations.length, 0);
  assert.ok(codesOf(result).includes('databaseReceiverUnresolved'), JSON.stringify(result.limits));
  assert.equal(session.called, false);

  const absent = sqlFact(constantRecord('SELECT id FROM a', { receiver: undefined }));
  const absentResult = joinConstantSql({ session, catalog: null, plans: new Map(), records: [absent] });
  assert.equal(absentResult.relations.length, 0);
  assert.ok(codesOf(absentResult).includes('databaseReceiverUnresolved'));
});

test('an incomplete callee or receiver declaration produces a limit instead of a relation', () => {
  const session = refusingSession();
  const cases = [
    ['calleeDeclarationIncomplete', sqlFact(constantRecord('SELECT id FROM a', { callee: { status: 'resolved', declaration: {} } }))],
    ['receiverDeclarationIncomplete', sqlFact(constantRecord('SELECT id FROM a', { receiver: { status: 'resolved', declaration: { path: MODULE.path } } }))],
    ['calleeUnresolved', sqlFact(constantRecord('SELECT id FROM a', { callee: { status: 'unresolved', reason: 'dynamicDispatch' } }))],
  ];
  for (const [code, fact] of cases) {
    const result = joinConstantSql({ session, catalog: null, plans: new Map(), records: [fact] });
    assert.equal(result.relations.length, 0, `${code}: ${JSON.stringify(result)}`);
    assert.ok(codesOf(result).includes(code), `${code} not in ${JSON.stringify(result.limits)}`);
  }
  assert.equal(session.called, false);
});

test('a missing client comparison, a dynamic statement and a missing binding produce limits', () => {
  const session = refusingSession();
  const cases = [
    ['clientMatchAbsent', { kind: 'sqlCall', value: { record: constantRecord('SELECT id FROM a'), sourceBinding: 'binding-1' } }],
    ['clientDeclarationNotMatched', sqlFact(constantRecord('SELECT id FROM a'), { clientMatch: 'mismatched' })],
    ['dynamicSql', sqlFact(constantRecord('SELECT id FROM a', { sql: { status: 'dynamic', reason: 'interpolation' } }))],
    ['admittedClientBindingAbsent', { kind: 'sqlCall', value: { record: constantRecord('SELECT id FROM a'), clientMatch: 'matched' } }],
  ];
  for (const [code, fact] of cases) {
    const result = joinConstantSql({ session, catalog: null, plans: new Map(), records: [fact] });
    assert.equal(result.relations.length, 0, `${code}: ${JSON.stringify(result)}`);
    assert.ok(codesOf(result).includes(code), `${code} not in ${JSON.stringify(result.limits)}`);
  }
  assert.equal(session.called, false);
});

test('a model use joins only from a complete digest-consistent record', () => {
  const result = joinModelUses({ model: observedModel(), uses: [{ kind: 'moduleUse', value: { record: modelUseRecord(), useSiteRef: 'site-1' } }] });
  assert.equal(result.relations.length, 1, JSON.stringify(result.limits));
  const relation = result.relations[0];
  assert.equal(relation.kind, 'modelUse');
  assert.equal(relation.value.modelSnapshotId, 'model-1');
  assert.equal(relation.value.resolverSnapshotId, 'resolver-1');
  for (const entry of relation.evidence) {
    assert.equal(entry.kind, 'source');
    assert.equal(typeof entry.path, 'string');
    assert.equal(typeof entry.sha256, 'string');
    assert.ok(entry.range?.start?.line !== undefined);
  }
  for (const ref of result.refs) {
    assert.equal(ref.subject.kind, 'position');
    assert.ok(['references', 'callers', 'definition'].includes(ref.projections[0]), `projection ${ref.projections[0]}`);
    assert.equal(typeof ref.snapshotId, 'string');
  }
});

test('a module digest mismatch between record and observed model refuses', () => {
  const record = modelUseRecord({ module: { path: MODULE.path, sha256: OTHER.sha256 } });
  const result = joinModelUses({ model: observedModel(), uses: [{ kind: 'moduleUse', value: { record } }] });
  assert.equal(result.relations.length, 0);
  assert.ok(codesOf(result).includes('modelModuleHashMismatch'), JSON.stringify(result.limits));
});

test('a name-only match never fabricates a model use', () => {
  const record = modelUseRecord({ module: OTHER, resolution: { status: 'resolved', declaration: declaration(OTHER.path, OTHER.sha256, 3) } });
  const result = joinModelUses({ model: observedModel(), uses: [{ kind: 'moduleUse', value: { record } }] });
  assert.equal(result.relations.length, 0, JSON.stringify(result));
  assert.ok(codesOf(result).includes('modelModuleMismatch'), JSON.stringify(result.limits));
});

test('a string use-site reference and a missing snapshot produce limits, not a null-evidence relation', () => {
  const stringSite = modelUseRecord({ useSite: '["source","/project/model.ts",40,17,"callers"]' });
  const first = joinModelUses({ model: observedModel(), uses: [{ kind: 'moduleUse', value: { record: stringSite, useSiteRef: 'site-1' } }] });
  assert.equal(first.relations.length, 0);
  assert.ok(codesOf(first).includes('useSiteAbsent'), JSON.stringify(first.limits));

  const noSnapshot = modelUseRecord({ snapshotId: undefined });
  const second = joinModelUses({ model: observedModel(), uses: [{ kind: 'moduleUse', value: { record: noSnapshot } }] });
  assert.equal(second.relations.length, 0);
  assert.ok(codesOf(second).includes('resolverSnapshotAbsent'), JSON.stringify(second.limits));

  const missingModelSnapshot = joinModelUses({ model: observedModel({ snapshotId: undefined }), uses: [{ kind: 'moduleUse', value: { record: modelUseRecord() } }] });
  assert.equal(missingModelSnapshot.relations.length, 0);
  assert.ok(codesOf(missingModelSnapshot).includes('modelSnapshotAbsent'), JSON.stringify(missingModelSnapshot.limits));
});

test('a different export name and an incomplete declaration produce limits', () => {
  const wrongExport = joinModelUses({ model: observedModel(), uses: [{ kind: 'moduleUse', value: { record: modelUseRecord({ export: 'Other' }) } }] });
  assert.equal(wrongExport.relations.length, 0);
  assert.ok(codesOf(wrongExport).includes('modelExportMismatch'), JSON.stringify(wrongExport.limits));

  const incomplete = joinModelUses({
    model: observedModel(),
    uses: [{ kind: 'moduleUse', value: { record: modelUseRecord({ resolution: { status: 'resolved', declaration: { path: MODULE.path } } }) } }],
  });
  assert.equal(incomplete.relations.length, 0);
  assert.ok(codesOf(incomplete).includes('exportDeclarationIncomplete'), JSON.stringify(incomplete.limits));

  const unresolvedExport = joinModelUses({ model: observedModel(), uses: [{ kind: 'moduleUse', value: { record: modelUseRecord({ resolution: { status: 'unresolved', reason: 'noExport' } }) } }] });
  assert.equal(unresolvedExport.relations.length, 0);
  assert.ok(codesOf(unresolvedExport).includes('exportUnresolved'), JSON.stringify(unresolvedExport.limits));
});
