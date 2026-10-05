#!/usr/bin/env node
// Joint TS-producer to Models-consumer runner.
//
// Runs the TypeScript resolver's real producers over an owned TypeScript
// project and feeds the published facts to the Models consumers over an owned
// two-table SQLite database. Consumes the TypeScript sources read-only, by the
// directory the caller pins; nothing here writes to that tree.
//
// Usage:
//   node bend2/tests/context-models/ts-integration/joint-runner.mjs \
//     --ts-producer <dir containing lib/sql.mjs, lib/service.mjs, lib/capture.mjs, lib/records.mjs> \
//     --typescript <typescript 5.9.3 package dir> \
//     --evidence-dir <owned directory that keeps the project, database and result>
//
// Exit status
//   0  every executed check passed and the joint producer calls succeeded
//   1  a consumer or environment check failed
//   3  a producer call failed; the exact failure is retained and is not evidence
//      about the Models consumers
//
// Every failure carries a scope: `producer`, `consumer` or `environment`.
// The owned project, database and result document stay in the evidence
// directory; this runner removes nothing.

import { cpSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createSqliteSession } from '../../../context/catalogs/sqlite-catalog.mjs';
import { joinModelUses } from '../../../context/models/model-use-join.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function argument(name, { required = true } = {}) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index === process.argv.length - 1) {
    if (required) throw new Error(`missing --${name}`);
    return null;
  }
  return process.argv[index + 1];
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function ownedProject(evidenceDirectory) {
  const project = join(evidenceDirectory, 'project');
  cpSync(join(HERE, 'fixtures', 'ts-project'), project, { recursive: true });
  return project;
}

// A real database file built from the fixture schema inside the evidence
// directory. The provider never writes to it.
function ownedDatabase({ evidenceDirectory, DatabaseSync }) {
  const path = join(evidenceDirectory, 'shop.db');
  const writer = new DatabaseSync(path);
  writer.exec(readFileSync(join(HERE, 'fixtures', 'db', 'schema.sql'), 'utf8'));
  writer.close();
  return realpathSync(path);
}

async function main() {
  const node = argument('node', { required: false });
  const tsProducerDirectory = resolve(argument('ts-producer'));
  const typescriptDirectory = resolve(argument('typescript'));
  const evidenceDirectory = resolve(argument('evidence-dir'));
  mkdirSync(evidenceDirectory, { recursive: true });

  const failures = [];
  const checks = [];
  const consumed = [];
  const fail = (scope, code, detail) => failures.push({ scope, code, detail });

  const typescriptEntry = join(typescriptDirectory, 'lib', 'typescript.js');
  const producerEntry = join(tsProducerDirectory, 'lib', 'sql.mjs');
  const serviceEntry = join(tsProducerDirectory, 'lib', 'service.mjs');
  const captureEntry = join(tsProducerDirectory, 'lib', 'capture.mjs');
  const recordsEntry = join(tsProducerDirectory, 'lib', 'records.mjs');
  consumed.push(typescriptEntry, producerEntry, serviceEntry, captureEntry, recordsEntry);

  let producer;
  let serviceModule;
  let captureModule;
  let records;
  let ts;
  let DatabaseSync;
  try {
    producer = await import(pathToFileURL(producerEntry).href);
    serviceModule = await import(pathToFileURL(serviceEntry).href);
    captureModule = await import(pathToFileURL(captureEntry).href);
    records = await import(pathToFileURL(recordsEntry).href);
    ts = await import(pathToFileURL(typescriptEntry).href);
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (error) {
    fail('environment', 'producer-import-failed', String(error?.message ?? error));
    return finish({ node, tsProducerDirectory, typescriptDirectory, evidenceDirectory, consumed, checks, failures, joint: null, consumer: null });
  }

  const createCapture = captureModule.createCapture ?? serviceModule.createCapture;
  const createService = serviceModule.createService ?? captureModule.createService;
  if (typeof createCapture !== 'function' || typeof createService !== 'function') {
    fail('environment', 'producer-builders-absent', 'the producer exposes no createCapture or createService');
    return finish({ node, tsProducerDirectory, typescriptDirectory, evidenceDirectory, consumed, checks, failures, joint: null, consumer: null });
  }

  const project = ownedProject(evidenceDirectory);
  const databasePath = ownedDatabase({ evidenceDirectory, DatabaseSync });
  const handlerPath = join(project, 'src', 'handler.ts');
  const consumerPath = join(project, 'src', 'consumer.ts');
  const modelPath = join(project, 'src', 'models', 'user.ts');
  const readRoots = [join(project, 'src')];

  const resolved = {
    version: ts.version,
    libraryPath: realpathSync(typescriptEntry),
    librarySha: sha256File(typescriptEntry),
    node: process.execPath,
    runtime: process.version,
    // createService consumes the loaded TypeScript module.
    module: ts,
  };
  const snapshotId = 'ts-integration-1';
  const request = {
    version: 1,
    engine: 'typescript',
    subject: { kind: 'symbol', path: handlerPath, name: 'handle' },
    select: ['databaseAccesses'],
    cwd: project,
    options: {
      client: { kind: 'position', path: join(project, 'src', 'db.ts'), line: 0, column: 13 },
      database: { engine: 'sqlite-schema', path: databasePath },
      readRoots,
    },
    effects: [],
  };

  // -------------------------------------------------------------------------
  // Joint: the real producer over the owned project into the real consumer.
  let joint = { status: 'not-run' };
  let service;
  let capture;
  try {
    capture = await createCapture({ cwd: project, readRoots, providerRoots: [typescriptDirectory] });
    service = await createService({ resolved, capture, request });
  } catch (error) {
    fail('producer', 'service-construction-failed', String(error?.message ?? error));
    service = null;
  }

  if (service !== null) {
    try {
      const produced = await producer.produceDatabaseAccesses({ ts, service, capture, resolved, request, snapshotId });
      const sqlCallFacts = (produced.facts ?? []).filter(fact => fact.kind === 'sqlCall');
      const session = createSqliteSession({ path: databasePath, DatabaseSync });
      let joined;
      try {
        joined = session.join({ records: produced.facts ?? [] });
      } finally {
        session.close();
      }
      const objects = new Set(joined.relations.map(relation => relation.value.object.name));
      joint = {
        status: 'ok',
        producer: {
          facts: (produced.facts ?? []).length,
          refs: (produced.refs ?? []).length,
          limits: (produced.limits ?? []).map(entry => entry.code ?? entry),
          sqlCallFacts: sqlCallFacts.length,
          records: sqlCallFacts.map(fact => fact.value?.record ?? null),
        },
        consumer: {
          relations: joined.relations,
          refs: joined.refs,
          limits: joined.limits,
        },
        catalog: { path: databasePath, database: session?.identity?.snapshotId ?? null },
      };
      checks.push({ name: 'joint-tables-join', ok: objects.has('users') && objects.has('orders'), detail: [...objects].join(',') });
      if (!objects.has('users') || !objects.has('orders')) {
        fail('consumer', 'joint-tables-missing', `the joint run joined ${[...objects].join(', ') || 'no objects'}`);
      }
      if (sqlCallFacts.length === 0) {
        fail('producer', 'no-sqlcall-facts', 'the producer published no sqlCall fact for the fixture handler');
      }
      // The shadowed local `prepare` in the fixture must not be attributed to
      // the database client: a name match is not a resolved callee.
      const shadowed = joined.limits.find(limit => limit.code === 'clientDeclarationNotMatched' || limit.code === 'calleeUnresolved');
      checks.push({ name: 'shadowed-callee-not-joined', ok: sqlCallFacts.length >= 1, detail: shadowed ? shadowed.code : 'no refusal reported' });
    } catch (error) {
      joint = { status: 'producer-failed', error: { message: String(error?.message ?? error), name: String(error?.name ?? 'Error'), stack: String(error?.stack ?? '') } };
      fail('producer', 'database-accesses-failed', String(error?.message ?? error));
    }
  }

  // -------------------------------------------------------------------------
  // Joint: model use through the alias barrel, with the observed model identity
  // taken from the fixture module bytes.
  let modelUseJoint = { status: 'not-run' };
  try {
    const modelBytes = readFileSync(modelPath);
    const observedModel = {
      module: { path: modelPath, realPath: realpathSync(modelPath), sha256: createHash('sha256').update(modelBytes).digest('hex') },
      export: { name: 'User' },
      snapshotId: 'fixture-model-1',
      provider: { name: 'zod', version: '4.3.6' },
    };
    const moduleUseRequest = {
      version: 1,
      engine: 'typescript',
      subject: { kind: 'symbol', path: consumerPath, name: 'describe' },
      select: ['calls', 'references'],
      cwd: project,
      options: { readRoots },
      effects: [],
    };
    const moduleCapture = await createCapture({ cwd: project, readRoots, providerRoots: [typescriptDirectory] });
    const moduleService = await createService({ resolved, capture: moduleCapture, request: moduleUseRequest });
    const produced = await producer.produceModuleUses({ ts, service: moduleService, capture: moduleCapture, resolved, request: moduleUseRequest, snapshotId: 'ts-integration-2' });
    const moduleUseFacts = (produced.facts ?? []).filter(fact => fact.kind === 'moduleUse');
    const perFact = moduleUseFacts.map(fact => {
      const joined = joinModelUses({ model: observedModel, uses: [fact] });
      return { relations: joined.relations, limits: joined.limits };
    });
    modelUseJoint = {
      status: 'ok',
      observedModel,
      facts: moduleUseFacts.length,
      records: moduleUseFacts.map(fact => fact.value?.record ?? null),
      joins: perFact,
    };
    const joinedOk = perFact.length > 0 && perFact.every(entry => entry.relations.length === 1);
    checks.push({ name: 'joint-model-use-alias-barrel', ok: joinedOk, detail: `${perFact.length} fact(s)` });
    if (!joinedOk) {
      fail('consumer', 'model-use-join-incomplete', `the model-use join produced ${perFact.filter(entry => entry.relations.length === 1).length} of ${perFact.length} edges`);
    }
  } catch (error) {
    modelUseJoint = { status: 'producer-failed', error: { message: String(error?.message ?? error), stack: String(error?.stack ?? '') } };
    fail('producer', 'module-uses-failed', String(error?.message ?? error));
  }

  // -------------------------------------------------------------------------
  // Consumer boundary negatives, built with the producer's own record builders.
  // These qualify the Models side only and never substitute for the joint run.
  const consumer = { checks: [] };
  try {
    const declaration = records.declaration(join(project, 'src', 'db.ts'), sha256File(join(project, 'src', 'db.ts')), { start: { line: 0, column: 13 }, end: { line: 0, column: 21 } });
    const unresolved = records.unresolvedResolution('shadowed_local');
    const callSite = { path: handlerPath, sha256: sha256File(handlerPath), range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } } };
    const constant = records.constantSqlRecord({
      resolved,
      snapshotId,
      callSite,
      callee: records.resolvedResolution(declaration),
      receiver: records.resolvedResolution(declaration),
      sql: { status: records.SQL_CONSTANT, text: 'SELECT display_name FROM users', literalKind: 'string' },
      statementKind: 'read',
      limits: [],
    });
    const second = records.constantSqlRecord({
      resolved,
      snapshotId,
      callSite,
      callee: records.resolvedResolution(declaration),
      receiver: records.resolvedResolution(declaration),
      sql: { status: records.SQL_CONSTANT, text: 'SELECT total_cents FROM orders', literalKind: 'string' },
      statementKind: 'read',
      limits: [],
    });
    const fact = (record, value = {}) => ({ id: 'boundary', kind: 'sqlCall', classification: 'static-possible', value: { record, callSiteRef: 'ref-id', clientMatch: 'matched', sourceBinding: 'bind', snapshotId, ...value } });
    const cases = [
      { name: 'record-absent', record: null, expect: 'recordAbsent' },
      { name: 'shadowed-client', record: constant, value: { clientMatch: 'shadowed' }, expect: 'clientDeclarationNotMatched' },
      { name: 'missing-client-match', record: constant, value: { clientMatch: undefined }, expect: 'clientMatchAbsent' },
      { name: 'missing-source-binding', record: constant, value: { sourceBinding: undefined }, expect: 'admittedClientBindingAbsent' },
      { name: 'missing-receiver', record: { ...constant, receiver: unresolved }, expect: 'databaseReceiverUnresolved' },
      { name: 'unresolved-callee', record: { ...constant, callee: unresolved }, expect: 'calleeUnresolved' },
      { name: 'empty-callee-declaration', record: { ...constant, callee: { status: 'resolved', declaration: {} } }, expect: 'calleeDeclarationIncomplete' },
      { name: 'missing-resolver-snapshot', record: { ...constant, snapshotId: '' }, expect: 'resolverSnapshotAbsent' },
      { name: 'missing-call-site', record: { ...constant, callSite: { path: '', sha256: '', range: {} } }, expect: 'callSiteAbsent' },
      { name: 'dynamic-sql', record: { ...constant, sql: { status: records.SQL_DYNAMIC, reason: 'dynamic_sql_interpolation' } }, expect: 'dynamicSql' },
    ];
    const session = createSqliteSession({ path: databasePath, DatabaseSync });
    try {
      for (const entry of cases) {
        const joined = session.join({ records: [fact(entry.record ?? constant, entry.value ?? {})] });
        const codes = joined.limits.map(limit => limit.code);
        const ok = joined.relations.length === 0 && codes.includes(entry.expect);
        consumer.checks.push({ name: entry.name, ok, codes, relations: joined.relations.length });
        if (!ok) fail('consumer', `boundary-${entry.name}`, `expected ${entry.expect}, saw ${codes.join(',') || 'no limit'}`);
      }
      const conflicting = session.join({ records: [fact(constant), fact(second)] });
      const conflictOk = conflicting.limits.some(limit => limit.code === 'conflictingSourceBinding')
        && new Set(conflicting.relations.map(relation => relation.value.object.name)).size === 2;
      consumer.checks.push({ name: 'conflicting-source-binding', ok: conflictOk, codes: conflicting.limits.map(limit => limit.code) });
      if (!conflictOk) fail('consumer', 'boundary-conflicting-binding', 'a reused binding with different text was not reported with both statements planned');
      // The catalog snapshot is bound separately from the resolver snapshot.
      const boundOk = conflicting.relations.every(relation => relation.value.catalogSnapshotId !== relation.value.resolverSnapshotId);
      consumer.checks.push({ name: 'distinct-catalog-snapshot', ok: boundOk, catalogSnapshotId: session.identity.snapshotId });
      if (!boundOk) fail('consumer', 'boundary-catalog-snapshot', 'a relation did not bind the catalog snapshot separately from the source snapshot');
    } finally {
      session.close();
    }

    // Model-use records through the producer's own builder.
    const modelUseRecord = (overrides = {}) => records.modelUseRecord({
      resolved,
      snapshotId: 'ts-integration-2',
      useSite: { path: consumerPath, sha256: sha256File(consumerPath), range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } }, role: 'call' },
      module: { path: modelPath, sha256: sha256File(modelPath) },
      exportName: 'User',
      resolution: { status: records.RESOLUTION_RESOLVED, declaration: records.declaration(modelPath, sha256File(modelPath), { start: { line: 6, column: 13 }, end: { line: 8, column: 1 } }) },
      limits: [],
      ...overrides,
    });
    const modelFact = record => ({ id: 'model-boundary', kind: 'moduleUse', classification: 'static-possible', value: { record, useSiteRef: 'ref-id', snapshotId: record.snapshotId } });
    const moduleBytes = readFileSync(modelPath);
    const observed = {
      module: { path: modelPath, realPath: realpathSync(modelPath), sha256: createHash('sha256').update(moduleBytes).digest('hex') },
      export: { name: 'User' },
      snapshotId: 'fixture-model-1',
      provider: { name: 'zod', version: '4.3.6' },
    };
    const modelCases = [
      { name: 'changed-module-digest', record: modelUseRecord({ module: { path: modelPath, sha256: 'f'.repeat(64) } }), expect: 'modelModuleHashMismatch' },
      { name: 'changed-declaration-digest', record: modelUseRecord({ resolution: { status: records.RESOLUTION_RESOLVED, declaration: records.declaration(modelPath, '0'.repeat(64), { start: { line: 6, column: 13 }, end: { line: 8, column: 1 } }) } }), expect: 'exportDeclarationHashMismatch' },
      { name: 'different-export', record: modelUseRecord({ exportName: 'Person' }), expect: 'modelExportMismatch' },
      { name: 'unresolved-export', record: modelUseRecord({ resolution: records.unresolvedResolution('re_export_unresolved') }), expect: 'exportUnresolved' },
      { name: 'missing-resolver-snapshot', record: modelUseRecord({ snapshotId: '' }), expect: 'resolverSnapshotAbsent' },
    ];
    for (const entry of modelCases) {
      const joined = joinModelUses({ model: observed, uses: [modelFact(entry.record)] });
      const codes = joined.limits.map(limit => limit.code);
      const ok = joined.relations.length === 0 && codes.includes(entry.expect);
      consumer.checks.push({ name: entry.name, ok, codes, relations: joined.relations.length });
      if (!ok) fail('consumer', `boundary-${entry.name}`, `expected ${entry.expect}, saw ${codes.join(',') || 'no limit'}`);
    }
    const positive = joinModelUses({ model: observed, uses: [modelFact(modelUseRecord())] });
    consumer.checks.push({ name: 'resolved-use-joins', ok: positive.relations.length === 1, codes: positive.limits.map(limit => limit.code) });
    if (positive.relations.length !== 1) fail('consumer', 'boundary-resolved-use', 'a resolved, digest-matching use produced no relation');
  } catch (error) {
    fail('environment', 'consumer-fixture-failed', String(error?.message ?? error));
  }

  return finish({ node, tsProducerDirectory, typescriptDirectory, evidenceDirectory, consumed, checks, failures, joint: { databaseAccesses: joint, modelUse: modelUseJoint }, consumer });
}

function finish({ node, tsProducerDirectory, typescriptDirectory, evidenceDirectory, consumed, checks, failures, joint, consumer }) {
  const report = {
    schema: 'baton2.context.models.ts-integration-result.v1',
    node: { executable: process.execPath, version: process.version, requested: node },
    pins: {
      tsProducerDirectory,
      typescriptDirectory,
      consumed: consumed.filter(Boolean).map(path => ({ path, sha256: sha256File(path) })),
    },
    joint,
    consumer,
    checks,
    failures,
    limits: [
      'the joint model-use observation uses the fixture module bytes and the declared export; the model executes only in the modelLoad operation',
      'a producer failure is reported with scope producer and is not evidence about the Models consumers',
    ],
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(join(evidenceDirectory, 'result.json'), text);
  process.stdout.write(text);

  const consumerFailures = failures.filter(entry => entry.scope === 'consumer');
  const producerFailures = failures.filter(entry => entry.scope === 'producer');
  const environmentFailures = failures.filter(entry => entry.scope === 'environment');
  if (consumerFailures.length > 0 || environmentFailures.length > 0) return 1;
  if (producerFailures.length > 0) return 3;
  return 0;
}

export { main };

process.exitCode = await main();
