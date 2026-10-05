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
//     --evidence-dir <owned root; the runner creates one fresh invocation directory under it>
//
// Exit status
//   0  every executed check passed and the joint producer calls succeeded
//   1  a consumer or environment check failed
//   3  a producer call failed; the exact failure is retained and is not evidence
//      about the Models consumers
//
// Every failure carries a scope: `producer`, `consumer` or `environment`, and
// the two kinds of evidence are labelled: `joint` comes from real producer runs
// over captures of this project, `boundary` comes from records built with the
// producer's own record builders. Each run writes result.json inside a fresh
// invocation directory and removes nothing.
//
// Unqualified until an admitted remote run on the pinned producer produces a
// result: a failing or absent producer callable is a producer outcome, and this
// runner makes no claim about it beyond the recorded failure.

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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Input identity is recorded when the path is first named, so the report
// serializes even when a producer input is absent or unreadable.
function recordInput(path) {
  try {
    return { path, sha256: sha256(readFileSync(path)) };
  } catch (error) {
    return { path, absent: true, error: `${error.code ?? 'error'}: ${error.message}` };
  }
}

function ownedProject(directory) {
  const project = join(directory, 'project');
  cpSync(join(HERE, 'fixtures', 'ts-project'), project, { recursive: true });
  return project;
}

function ownedDatabase({ directory, DatabaseSync }) {
  const path = join(directory, 'shop.db');
  const writer = new DatabaseSync(path);
  writer.exec(readFileSync(join(HERE, 'fixtures', 'db', 'schema.sql'), 'utf8'));
  writer.close();
  return realpathSync(path);
}

// The line and column of a call spelling inside an owned fixture file, so a
// non-attribution check names the exact site instead of any absence of a limit.
function siteOfCall(source, spelling) {
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const column = lines[index].indexOf(spelling);
    if (column !== -1) return { line: index, column, spelling };
  }
  return null;
}

function refPosition(refId) {
  try {
    const parts = JSON.parse(refId);
    return Array.isArray(parts) && parts.length >= 5 ? { path: parts[1], line: parts[3], column: parts[4] } : null;
  } catch {
    return null;
  }
}

function normalizeSql(text) {
  return String(text).replace(/\s+/g, ' ').trim().toUpperCase();
}

async function main() {
  const node = argument('node', { required: false });
  const tsProducerDirectory = resolve(argument('ts-producer'));
  const typescriptDirectory = resolve(argument('typescript'));
  const evidenceRoot = resolve(argument('evidence-dir'));

  // A fresh invocation directory: an existing invocation is never reused, so no
  // fixture input or earlier result can be overwritten.
  mkdirSync(evidenceRoot, { recursive: true });
  let evidenceDirectory = null;
  for (let index = 0; index < 1000 && evidenceDirectory === null; index += 1) {
    const candidate = join(evidenceRoot, `run-${process.pid}-${index}`);
    try {
      mkdirSync(candidate, { recursive: false });
      evidenceDirectory = candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        process.stderr.write(`cannot create an invocation directory under ${evidenceRoot}: ${error.message}\n`);
        return 1;
      }
    }
  }
  if (evidenceDirectory === null) {
    process.stderr.write(`no unused invocation directory under ${evidenceRoot}\n`);
    return 1;
  }

  const failures = [];
  const checks = [];
  const inputs = [];
  const fail = (scope, code, detail) => failures.push({ scope, code, detail });
  const check = (name, ok, detail = null, scope = 'consumer') => {
    checks.push({ name, ok, detail });
    if (!ok) fail(scope, name, detail ?? 'check failed');
  };

  const paths = {
    typescript: join(typescriptDirectory, 'lib', 'typescript.js'),
    producer: join(tsProducerDirectory, 'lib', 'sql.mjs'),
    service: join(tsProducerDirectory, 'lib', 'service.mjs'),
    capture: join(tsProducerDirectory, 'lib', 'capture.mjs'),
    records: join(tsProducerDirectory, 'lib', 'records.mjs'),
  };
  for (const path of Object.values(paths)) inputs.push(recordInput(path));

  let producer;
  let serviceModule;
  let captureModule;
  let records;
  let ts;
  let DatabaseSync;
  try {
    producer = await import(pathToFileURL(paths.producer).href);
    serviceModule = await import(pathToFileURL(paths.service).href);
    captureModule = await import(pathToFileURL(paths.capture).href);
    records = await import(pathToFileURL(paths.records).href);
    ts = await import(pathToFileURL(paths.typescript).href);
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch (error) {
    fail('environment', 'producer-import-failed', String(error?.message ?? error));
    return finish({ evidenceDirectory, node, tsProducerDirectory, typescriptDirectory, inputs, checks, failures, joint: null, boundary: null });
  }

  const createCapture = captureModule.createCapture ?? serviceModule.createCapture;
  const createService = serviceModule.createService ?? captureModule.createService;
  if (typeof createCapture !== 'function' || typeof createService !== 'function') {
    fail('environment', 'producer-builders-absent', 'the producer exposes no createCapture or createService');
    return finish({ evidenceDirectory, node, tsProducerDirectory, typescriptDirectory, inputs, checks, failures, joint: null, boundary: null });
  }

  const resolved = {
    version: ts.version,
    libraryPath: realpathSync(paths.typescript),
    librarySha: sha256(readFileSync(paths.typescript)),
    node: process.execPath,
    runtime: process.version,
    module: ts,
  };
  const request = {
    version: 1,
    engine: 'typescript',
    subject: { kind: 'symbol', path: join('src', 'handler.ts'), name: 'handle' },
    select: ['databaseAccesses'],
    cwd: '.',
    options: {
      client: { kind: 'position', path: join('src', 'db.ts'), line: 0, column: 13 },
      database: { engine: 'sqlite-schema', path: 'shop.db' },
      readRoots: [join('src')],
    },
    effects: [],
  };

  // ---------------------------------------------------------------------------
  // Joint: two captures of one project, the first as shipped and the second with
  // a changed constant statement in the handler. Each revision keeps its own
  // resolver snapshot, capture and plan.
  const joint = { status: 'not-run', revisions: [], evidence: 'producer-frames' };
  const captureRoot = join(evidenceDirectory, 'project');
  const project = ownedProject(evidenceDirectory);
  let databasePath = null;
  try {
    databasePath = ownedDatabase({ directory: evidenceDirectory, DatabaseSync });
  } catch (error) {
    fail('environment', 'fixture-database-failed', String(error?.message ?? error));
  }
  const handlerPath = join(project, 'src', 'handler.ts');
  const consumerPath = join(project, 'src', 'consumer.ts');
  const modelPath = join(project, 'src', 'models', 'user.ts');
  const handlerSource = readFileSync(handlerPath, 'utf8');
  const shadowedSite = siteOfCall(handlerSource, "prepare('SELECT id FROM orders')");
  check('fixture-shadowed-site-located', shadowedSite !== null, shadowedSite ? `${shadowedSite.line}:${shadowedSite.column}` : 'the owned fixture no longer holds the shadowed call');

  const revisionSpecs = [
    { id: 'A', project, databasePath, rewrite: null },
    {
      id: 'B',
      project: join(evidenceDirectory, 'project-revision-b'),
      databasePath: null,
      rewrite: { from: 'SELECT display_name FROM users WHERE id = 1', to: 'SELECT total_cents FROM orders WHERE id = 1' },
    },
  ];

  if (databasePath !== null) {
    revisionSpecs[1].databasePath = join(evidenceDirectory, 'shop-revision-b.db');
  }

  for (const revision of revisionSpecs) {
    if (revision.rewrite !== null) {
      cpSync(join(HERE, 'fixtures', 'ts-project'), revision.project, { recursive: true });
      const source = readFileSync(join(revision.project, 'src', 'handler.ts'), 'utf8');
      writeFileSync(join(revision.project, 'src', 'handler.ts'), source.replace(revision.rewrite.from, revision.rewrite.to));
      const writer = new DatabaseSync(revision.databasePath);
      writer.exec(readFileSync(join(HERE, 'fixtures', 'db', 'schema.sql'), 'utf8'));
      writer.close();
    }
    const revisionRequest = {
      ...request,
      subject: { kind: 'symbol', path: join(revision.project, 'src', 'handler.ts'), name: 'handle' },
      cwd: revision.project,
      options: { ...request.options, database: { engine: 'sqlite-schema', path: revision.databasePath }, readRoots: [join(revision.project, 'src')] },
    };
    const snapshotId = `ts-integration-${revision.id}`;

    // Producer boundary.
    let produced = null;
    try {
      const capture = await createCapture({ cwd: revision.project, readRoots: [join(revision.project, 'src')], providerRoots: [typescriptDirectory] });
      const service = await createService({ resolved, capture, request: revisionRequest });
      produced = await producer.produceDatabaseAccesses({ ts, service, capture, resolved, request: revisionRequest, snapshotId });
    } catch (error) {
      fail('producer', `database-accesses-${revision.id}`, String(error?.message ?? error));
      joint.revisions.push({ id: revision.id, snapshotId, status: 'producer-failed', error: { message: String(error?.message ?? error), stack: String(error?.stack ?? '') }, project: revision.project, databasePath: revision.databasePath });
      continue;
    }
    if (produced === null) continue;

    // Environment boundary: opening the owned catalog.
    let session;
    try {
      session = createSqliteSession({ path: revision.databasePath, DatabaseSync });
    } catch (error) {
      fail('environment', `sqlite-open-${revision.id}`, String(error?.message ?? error));
      continue;
    }
    // Consumer boundary: join and assertions.
    try {
      let joined;
      try {
        joined = session.join({ records: produced.facts ?? [] });
      } finally {
        session.close();
      }
      const sqlCallFacts = (produced.facts ?? []).filter(fact => fact.kind === 'sqlCall');
      const statements = joined.relations.map(relation => relation.value.statementText);
      const objects = [...new Set(joined.relations.map(relation => relation.value.object.name))];
      const record = {
        id: revision.id,
        snapshotId,
        status: 'ok',
        project: revision.project,
        databasePath: revision.databasePath,
        producer: {
          facts: (produced.facts ?? []).length,
          refs: (produced.refs ?? []).length,
          limits: (produced.limits ?? []).map(entry => entry.code ?? entry),
          sqlCallFacts: sqlCallFacts.length,
          records: sqlCallFacts.map(fact => fact.value?.record ?? null),
        },
        consumer: { relations: joined.relations, refs: joined.refs, limits: joined.limits },
        catalog: { snapshotId: session.identity.snapshotId, digest: session.identity.catalogDigest },
        statements,
        objects,
      };
      joint.revisions.push(record);

      // Nonempty positive output precedes every identity assertion.
      check(`joint-${revision.id}-relations-nonempty`, joined.relations.length > 0, `${joined.relations.length} relation(s)`);
      if (joined.relations.length > 0) {
        const own = joined.relations.every(relation => relation.value.statementText === statements[0]);
        check(`joint-${revision.id}-single-statement-bound`, own, statements.join(' | '));
        const bound = joined.relations.every(relation => relation.value.resolverSnapshotId === snapshotId && relation.value.catalogSnapshotId === session.identity.snapshotId);
        check(`joint-${revision.id}-snapshots-bound`, bound, `resolver ${snapshotId}, catalog ${session.identity.snapshotId}`);
      }
      if (revision.id === 'A') {
        check('joint-revision-A-reads-users', objects.includes('users'), objects.join(','));
      }
      if (revision.id === 'B') {
        check('joint-revision-B-reads-orders', objects.includes('orders'), objects.join(','));
      }
      if (revision.id === 'A') {
        // The shadowed local function and the interpolated statement must not be
        // attributed to the admitted client.
        const misattributed = joined.relations.filter(relation => {
          const position = refPosition(relation.from);
          if (position !== null && shadowedSite !== null && position.line === shadowedSite.line && position.column === shadowedSite.column) return true;
          const text = normalizeSql(relation.value.statementText);
          return text === normalizeSql('SELECT id FROM orders') || text.includes('${ID}') || text.includes('$' + '{id}');
        });
        check('joint-shadowed-site-not-attributed', misattributed.length === 0,
          misattributed.length === 0 ? 'no relation names the shadowed or interpolated site' : `${misattributed.length} relation(s) attribute an unadmitted call`);
      }
    } catch (error) {
      fail('consumer', `join-${revision.id}`, String(error?.message ?? error));
      joint.revisions.push({ id: revision.id, snapshotId, status: 'consumer-failed', error: { message: String(error?.message ?? error) } });
    }
  }

  // The changed revision must be an actual second capture, not a modified
  // record: both revisions keep their own statement text and snapshot.
  const revisionA = joint.revisions.find(entry => entry.id === 'A' && entry.status === 'ok');
  const revisionB = joint.revisions.find(entry => entry.id === 'B' && entry.status === 'ok');
  if (revisionA !== undefined && revisionB !== undefined) {
    const textsA = new Set(revisionA.statements.map(normalizeSql));
    const textsB = new Set(revisionB.statements.map(normalizeSql));
    const changed = [...textsB].some(text => !textsA.has(text));
    check('joint-changed-source-capture', changed, `A=${[...textsA].join('|')} B=${[...textsB].join('|')}`);
    check('joint-revisions-distinct-snapshots', revisionA.snapshotId !== revisionB.snapshotId, `${revisionA.snapshotId} / ${revisionB.snapshotId}`);
  } else {
    check('joint-changed-source-capture', false, 'one revision did not complete');
  }

  // ---------------------------------------------------------------------------
  // Joint model use through the alias barrel, with the observed model identity
  // read from the fixture module bytes.
  const modelUse = { status: 'not-run', evidence: 'producer-frames' };
  {
    const modelBytes = readFileSync(modelPath);
    const observedModel = {
      module: { path: modelPath, realPath: realpathSync(modelPath), sha256: sha256(modelBytes) },
      export: { name: 'User' },
      snapshotId: 'fixture-model-1',
      provider: { name: 'zod', version: '4.3.6' },
    };
    const moduleUseRequest = {
      ...request,
      subject: { kind: 'symbol', path: consumerPath, name: 'describe' },
      select: ['calls', 'references'],
      cwd: project,
      options: { readRoots: [join(project, 'src')] },
    };
    let produced = null;
    try {
      const capture = await createCapture({ cwd: project, readRoots: [join(project, 'src')], providerRoots: [typescriptDirectory] });
      const service = await createService({ resolved, capture, request: moduleUseRequest });
      produced = await producer.produceModuleUses({ ts, service, capture, resolved, request: moduleUseRequest, snapshotId: 'ts-integration-2' });
    } catch (error) {
      fail('producer', 'module-uses-failed', String(error?.message ?? error));
      modelUse.status = 'producer-failed';
      modelUse.error = { message: String(error?.message ?? error) };
    }
    if (produced !== null) {
      try {
        const moduleUseFacts = (produced.facts ?? []).filter(fact => fact.kind === 'moduleUse');
        const joins = moduleUseFacts.map(fact => {
          const joined = joinModelUses({ model: observedModel, uses: [fact] });
          return { relations: joined.relations, limits: joined.limits };
        });
        modelUse.status = 'ok';
        modelUse.observedModel = observedModel;
        modelUse.facts = moduleUseFacts.length;
        modelUse.records = moduleUseFacts.map(fact => fact.value?.record ?? null);
        modelUse.joins = joins;
        const joinedCount = joins.filter(entry => entry.relations.length === 1).length;
        check('joint-model-use-alias-barrel', joins.length > 0 && joinedCount === joins.length, `${joinedCount}/${joins.length} edge(s)`);
      } catch (error) {
        modelUse.status = 'consumer-failed';
        fail('consumer', 'model-use-join', String(error?.message ?? error));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Boundary negatives built with the producer's own record builders. These
  // qualify the Models side only and are labelled apart from the joint runs.
  const boundary = { status: 'not-run', evidence: 'producer-record-builders', checks: [] };
  let boundarySession;
  try {
    boundarySession = createSqliteSession({ path: databasePath, DatabaseSync });
  } catch (error) {
    fail('environment', 'boundary-session-failed', String(error?.message ?? error));
  }
  if (boundarySession !== undefined) {
    try {
      const declaration = records.declaration(join(project, 'src', 'db.ts'), sha256(readFileSync(join(project, 'src', 'db.ts'))), { start: { line: 0, column: 13 }, end: { line: 0, column: 21 } });
      const unresolved = records.unresolvedResolution('shadowed_local');
      const callSite = { path: handlerPath, sha256: sha256(readFileSync(handlerPath)), range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } } };
      const constant = records.constantSqlRecord({
        resolved,
        snapshotId: 'boundary-1',
        callSite,
        callee: records.resolvedResolution(declaration),
        receiver: records.resolvedResolution(declaration),
        sql: { status: records.SQL_CONSTANT, text: 'SELECT display_name FROM users', literalKind: 'string' },
        statementKind: 'read',
        limits: [],
      });
      const second = records.constantSqlRecord({
        resolved,
        snapshotId: 'boundary-1',
        callSite,
        callee: records.resolvedResolution(declaration),
        receiver: records.resolvedResolution(declaration),
        sql: { status: records.SQL_CONSTANT, text: 'SELECT total_cents FROM orders', literalKind: 'string' },
        statementKind: 'read',
        limits: [],
      });
      const fact = (record, value = {}) => ({ id: 'boundary', kind: 'sqlCall', classification: 'static-possible', value: { record, callSiteRef: 'ref-id', clientMatch: 'matched', sourceBinding: 'bind', snapshotId: 'boundary-1', ...value } });
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
      for (const entry of cases) {
        // The negative input is passed as given, including null.
        const joined = boundarySession.join({ records: [fact(entry.record, entry.value ?? {})] });
        const codes = joined.limits.map(limit => limit.code);
        const ok = joined.relations.length === 0 && codes.includes(entry.expect);
        boundary.checks.push({ name: entry.name, ok, codes, relations: joined.relations.length });
        if (!ok) fail('consumer', `boundary-${entry.name}`, `expected ${entry.expect}, saw ${codes.join(',') || 'no limit'}`);
      }
      const conflicting = boundarySession.join({ records: [fact(constant), fact(second)] });
      const conflictOk = conflicting.limits.some(limit => limit.code === 'conflictingSourceBinding')
        && conflicting.relations.length > 0
        && new Set(conflicting.relations.map(relation => relation.value.object.name)).size === 2;
      boundary.checks.push({ name: 'conflicting-source-binding', ok: conflictOk, codes: conflicting.limits.map(limit => limit.code) });
      if (!conflictOk) fail('consumer', 'boundary-conflicting-binding', 'a reused binding with different text was not reported with both statements planned');
      const boundOk = conflicting.relations.length > 0 && conflicting.relations.every(relation => relation.value.catalogSnapshotId !== relation.value.resolverSnapshotId);
      boundary.checks.push({ name: 'distinct-catalog-snapshot', ok: boundOk, catalogSnapshotId: boundarySession.identity.snapshotId });
      if (!boundOk) fail('consumer', 'boundary-catalog-snapshot', 'a relation did not bind the catalog snapshot separately from the source snapshot');
      boundary.status = 'ok';
    } catch (error) {
      boundary.status = 'consumer-failed';
      fail('consumer', 'boundary-sql-cases', String(error?.message ?? error));
    } finally {
      boundarySession.close();
    }
  }

  // Model-use boundary cases through the producer's record builder.
  const modelBoundary = { status: 'not-run', evidence: 'producer-record-builders', checks: [] };
  try {
    const modelBytes = readFileSync(modelPath);
    const observed = {
      module: { path: modelPath, realPath: realpathSync(modelPath), sha256: sha256(modelBytes) },
      export: { name: 'User' },
      snapshotId: 'fixture-model-1',
      provider: { name: 'zod', version: '4.3.6' },
    };
    const modelUseRecord = (overrides = {}) => records.modelUseRecord({
      resolved,
      snapshotId: 'boundary-2',
      useSite: { path: consumerPath, sha256: sha256(readFileSync(consumerPath)), range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } }, role: 'call' },
      module: { path: modelPath, sha256: sha256(modelBytes) },
      exportName: 'User',
      resolution: { status: records.RESOLUTION_RESOLVED, declaration: records.declaration(modelPath, sha256(modelBytes), { start: { line: 6, column: 13 }, end: { line: 8, column: 1 } }) },
      limits: [],
      ...overrides,
    });
    const modelFact = record => ({ id: 'model-boundary', kind: 'moduleUse', classification: 'static-possible', value: { record, useSiteRef: 'ref-id', snapshotId: record.snapshotId } });
    const cases = [
      { name: 'changed-module-digest', record: modelUseRecord({ module: { path: modelPath, sha256: 'f'.repeat(64) } }), expect: 'modelModuleHashMismatch' },
      { name: 'changed-declaration-digest', record: modelUseRecord({ resolution: { status: records.RESOLUTION_RESOLVED, declaration: records.declaration(modelPath, '0'.repeat(64), { start: { line: 6, column: 13 }, end: { line: 8, column: 1 } }) } }), expect: 'exportDeclarationHashMismatch' },
      { name: 'different-export', record: modelUseRecord({ exportName: 'Person' }), expect: 'modelExportMismatch' },
      { name: 'unresolved-export', record: modelUseRecord({ resolution: records.unresolvedResolution('re_export_unresolved') }), expect: 'exportUnresolved' },
      { name: 'missing-resolver-snapshot', record: modelUseRecord({ snapshotId: '' }), expect: 'resolverSnapshotAbsent' },
    ];
    for (const entry of cases) {
      const joined = joinModelUses({ model: observed, uses: [modelFact(entry.record)] });
      const codes = joined.limits.map(limit => limit.code);
      const ok = joined.relations.length === 0 && codes.includes(entry.expect);
      modelBoundary.checks.push({ name: entry.name, ok, codes, relations: joined.relations.length });
      if (!ok) fail('consumer', `boundary-${entry.name}`, `expected ${entry.expect}, saw ${codes.join(',') || 'no limit'}`);
    }
    const positive = joinModelUses({ model: observed, uses: [modelFact(modelUseRecord())] });
    modelBoundary.checks.push({ name: 'resolved-use-joins', ok: positive.relations.length === 1, codes: positive.limits.map(limit => limit.code) });
    if (positive.relations.length !== 1) fail('consumer', 'boundary-resolved-use', 'a resolved, digest-matching use produced no relation');
    modelBoundary.status = 'ok';
  } catch (error) {
    modelBoundary.status = 'consumer-failed';
    fail('consumer', 'boundary-model-cases', String(error?.message ?? error));
  }

  return finish({
    evidenceDirectory,
    node,
    tsProducerDirectory,
    typescriptDirectory,
    inputs,
    checks,
    failures,
    joint,
    boundary: { sql: boundary, modelUse: modelBoundary },
    captureRoot,
  });
}

function finish({ evidenceDirectory, node, tsProducerDirectory, typescriptDirectory, inputs, checks, failures, joint, boundary, captureRoot = null }) {
  const report = {
    schema: 'baton2.context.models.ts-integration-result.v1',
    node: { executable: process.execPath, version: process.version, requested: node },
    pins: {
      tsProducerDirectory,
      typescriptDirectory,
      // Input identity is recorded, not re-read, so a missing producer input
      // still produces a valid result document.
      inputs,
    },
    evidence: {
      joint: 'real producer runs over captures of this project',
      boundary: 'records built with the producer record builders',
      projectRoot: captureRoot,
    },
    joint,
    boundary,
    checks,
    failures,
    limits: [
      'unqualified until an admitted remote run on the pinned producer produces a result; a failing producer callable is a producer outcome, not a Models result',
      'the joint model-use observation uses the fixture module bytes and the declared export; the model executes only in the modelLoad operation',
    ],
  };
  const text = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(join(evidenceDirectory, 'result.json'), text);
  process.stdout.write(text);

  const consumerFailures = failures.filter(entry => entry.scope === 'consumer');
  const environmentFailures = failures.filter(entry => entry.scope === 'environment');
  const producerFailures = failures.filter(entry => entry.scope === 'producer');
  if (consumerFailures.length > 0 || environmentFailures.length > 0) return 1;
  if (producerFailures.length > 0) return 3;
  return 0;
}

export { main };

process.exitCode = await main();
