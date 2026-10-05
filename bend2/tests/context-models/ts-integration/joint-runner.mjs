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
//     --ts-producer <dir containing lib/sql.mjs, lib/service.mjs, lib/records.mjs> \
//     --typescript <typescript 5.9.3 package dir> \
//     --out <result json path>
//
// Exit status
//   0  every executed check passed and the joint producer calls succeeded
//   1  a consumer check failed
//   3  a producer call failed; the exact failure is retained in the result
//
// A consumer negative built from the producer's own record builders checks the
// Models boundary. It is not joint acceptance: only a successful producer run
// into these consumers is.

import { execFileSync } from 'node:child_process';
import { cpSync, createHash, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createSqliteSession } from '../../../context/catalogs/sqlite-catalog.mjs';
import { joinConstantSql } from '../../../context/catalogs/sql-join.mjs';
import { joinModelUses } from '../../../context/models/model-use-join.mjs';

const HERE = dirname(new URL(import.meta.url).pathname);

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

function ownedProject(root) {
  const project = join(root, 'project');
  cpSync(join(HERE, 'fixtures', 'ts-project'), project, { recursive: true });
  return project;
}

// A real database file built from the fixture schema, inside the owned
// scratch directory. The provider never writes to it.
function ownedDatabase({ root, DatabaseSync }) {
  const path = join(root, 'shop.db');
  const writer = new DatabaseSync(path);
  writer.exec(readFileSync(join(HERE, 'fixtures', 'db', 'schema.sql'), 'utf8'));
  writer.close();
  return realpathSync(path);
}

function buildReport({ node, tsProducerDirectory, typescriptDirectory, statement, failures, notes }) {
  const consumed = [statement, ...(notes.consumed ?? [])];
  return {
    schema: 'baton2.context.models.ts-integration-result.v1',
    node: { executable: process.execPath, version: process.version, requested: node },
    pins: {
      tsProducerDirectory,
      typescriptDirectory,
      consumed: consumed.filter(Boolean).map(path => ({ path, sha256: sha256File(path) })),
    },
    joint: statement,
    checks: notes.checks ?? [],
    failures,
  };
}

async function main() {
  const node = argument('node', { required: false });
  const tsProducerDirectory = resolve(argument('ts-producer'));
  const typescriptDirectory = resolve(argument('typescript'));
  const out = argument('out', { required: false });
  const failures = [];
  const checks = [];
  const consumed = [];

  const typescriptEntry = join(typescriptDirectory, 'lib', 'typescript.js');
  const producerEntry = join(tsProducerDirectory, 'lib', 'sql.mjs');
  const serviceEntry = join(tsProducerDirectory, 'lib', 'service.mjs');
  const recordsEntry = join(tsProducerDirectory, 'lib', 'records.mjs');
  consumed.push(typescriptEntry, producerEntry, serviceEntry, recordsEntry);

  const producer = await import(pathToFileURL(producerEntry).href);
  const serviceModule = await import(pathToFileURL(serviceEntry).href);
  const captureEntry = join(tsProducerDirectory, 'lib', 'capture.mjs');
  consumed.push(captureEntry);
  const captureModule = await import(pathToFileURL(captureEntry).href);
  const records = await import(pathToFileURL(recordsEntry).href);
  const ts = await import(pathToFileURL(typescriptEntry).href);
  const { DatabaseSync } = await import('node:sqlite');

  // The builder lives in one of the producer's modules; the runner reports
  // which module supplied it instead of assuming a single layout.
  const builders = {
    createCapture: captureModule.createCapture ?? serviceModule.createCapture ?? null,
    createService: serviceModule.createService ?? null,
  };
  checks.push({ name: 'producer-builders', ok: builders.createCapture !== null && builders.createService !== null, detail: JSON.stringify(Object.keys(builders).filter(key => builders[key] !== null)) });

  const root = join(tmpdir(), `baton-context-ts-integration-${process.pid}`);
  mkdirSync(root, { recursive: true });
  const project = ownedProject(root);
  const databasePath = ownedDatabase({ root, DatabaseSync });
  const handlerPath = join(project, 'src', 'handler.ts');

  const resolved = {
    version: ts.version,
    libraryPath: realpathSync(typescriptEntry),
    librarySha: sha256File(typescriptEntry),
    node: process.execPath,
    runtime: process.version,
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
      readRoots: [join(project, 'src')],
    },
    effects: [],
  };

  let statement;
  try {
    const capture = builders.createCapture({ cwd: project, readRoots: [join(project, 'src')], providerRoots: [typescriptDirectory] });
    const context = { ts, service: serviceModule, capture, resolved, request, snapshotId };
    const produced = await producer.produceDatabaseAccesses(context);

    const session = createSqliteSession({ path: databasePath, DatabaseSync });
    try {
      const joined = session.join({ records: produced.facts, engineProbe: { executable: process.execPath, sha256: null, version: process.version } });
      const sqlCalls = produced.facts.filter(fact => fact.kind === 'sqlCall');
      const consumerLimits = joined.limits.map(entry => `${entry.code}: ${entry.detail}`);
      const producedLimits = produced.limits ?? [];
      statement = {
        status: 'ok',
        producer: { facts: produced.facts.length, refs: (produced.refs ?? []).length, limits: producedLimits.map(entry => entry.code ?? entry) },
        sqlCallFacts: sqlCalls.length,
        relations: joined.relations.map(relation => ({
          object: `${relation.value.object.schema}.${relation.value.object.name}`,
          type: relation.value.object.type,
          statementText: relation.value.statementText,
          sourceBindingId: relation.value.sourceBindingId,
          resolverSnapshotId: relation.value.resolverSnapshotId,
          catalogSnapshotId: relation.value.catalogSnapshotId,
        })),
        refs: joined.refs.map(ref => ({ id: ref.id, subject: ref.subject, projections: ref.projections })),
        consumerLimits,
        catalogSnapshotId: session.identity.snapshotId,
        catalogDigest: session.identity.catalogDigest,
      };
      // Two tables must join from the real project: a run that produced no
      // relation is a reported failure, not a silent pass.
      const objects = new Set(joined.relations.map(relation => relation.value.object.name));
      checks.push({ name: 'joint-tables-join', ok: objects.has('users') && objects.has('orders'), detail: [...objects].join(',') });
      if (!objects.has('users') || !objects.has('orders')) failures.push('the joint run joined neither or only one of the two fixture tables');
    } finally {
      session.close();
    }
  } catch (error) {
    statement = { status: 'producer-failed', error: { message: String(error?.message ?? error), name: String(error?.name ?? 'Error'), stack: String(error?.stack ?? '') } };
    failures.push('the TypeScript producer call failed; the exact failure is retained');
  }

  // Consumer negatives built with the producer's own record builders. These
  // exercise the Models boundary only.
  try {
    const declaration = records.declaration(join(project, 'src', 'db.ts'), sha256File(join(project, 'src', 'db.ts')), {
      start: { line: 0, column: 13 },
      end: { line: 0, column: 21 },
    });
    const unresolved = records.unresolvedResolution('shadowed_local');
    const callSite = {
      path: handlerPath,
      sha256: sha256File(handlerPath),
      range: { start: { line: 0, column: 0 }, end: { line: 0, column: 1 } },
    };
    const constant = records.constantSqlRecord({
      resolved,
      snapshotId,
      callSite,
      callee: records.resolvedResolution(declaration),
      receiver: records.resolvedResolution(declaration),
      sql: { status: records.SQL_CONSTANT, text: 'SELECT id FROM users', literalKind: 'string' },
      statementKind: 'read',
      limits: [],
    });
    const session = createSqliteSession({ path: databasePath, DatabaseSync });
    try {
      const fact = (record, value = {}) => ({ id: 'neg', kind: 'sqlCall', classification: 'static-possible', value: { record, callSiteRef: 'id', clientMatch: 'matched', sourceBinding: 'bind', snapshotId, ...value } });
      const cases = [
        { name: 'shadowed-client', record: null, value: { clientMatch: 'shadowed' }, expect: 'clientDeclarationNotMatched' },
        { name: 'missing-receiver', record: { ...constant, receiver: unresolved }, expect: 'databaseReceiverUnresolved' },
        { name: 'empty-callee-declaration', record: { ...constant, callee: { status: 'resolved', declaration: {} } }, expect: 'calleeDeclarationIncomplete' },
        { name: 'missing-resolver-snapshot', record: { ...constant, snapshotId: '' }, expect: 'resolverSnapshotAbsent' },
        { name: 'dynamic-sql', record: { ...constant, sql: { status: records.SQL_DYNAMIC, reason: 'dynamic_sql_interpolation' } }, expect: 'dynamicSql' },
        { name: 'missing-client-match', record: constant, value: { clientMatch: undefined }, expect: 'clientMatchAbsent' },
        { name: 'missing-source-binding', record: constant, value: { sourceBinding: undefined }, expect: 'admittedClientBindingAbsent' },
      ];
      const results = [];
      for (const entry of cases) {
        const joined = session.join({ records: [fact(entry.record ?? constant, entry.value ?? {})] });
        const codes = joined.limits.map(limit => limit.code);
        const ok = joined.relations.length === 0 && codes.includes(entry.expect);
        results.push({ name: entry.name, ok, codes, relations: joined.relations.length });
        if (!ok) failures.push(`consumer negative ${entry.name} did not refuse with ${entry.expect}`);
      }
      // A conflicting binding reuses one source binding with different text.
      const second = records.constantSqlRecord({
        resolved, snapshotId, callSite,
        callee: records.resolvedResolution(declaration),
        receiver: records.resolvedResolution(declaration),
        sql: { status: records.SQL_CONSTANT, text: 'SELECT total_cents FROM orders', literalKind: 'string' },
        statementKind: 'read',
        limits: [],
      });
      const conflicting = session.join({ records: [fact(constant), fact(second)] });
      const conflictOk = conflicting.limits.some(limit => limit.code === 'conflictingSourceBinding')
        && new Set(conflicting.relations.map(relation => relation.value.object.name)).size === 2;
      results.push({ name: 'conflicting-source-binding', ok: conflictOk, codes: conflicting.limits.map(limit => limit.code) });
      if (!conflictOk) failures.push('a conflicting source binding was not reported with both statements planned under their own identity');
      checks.push({ name: 'consumer-negatives', ok: results.every(entry => entry.ok), detail: `${results.filter(entry => entry.ok).length}/${results.length}` , results });
    } finally {
      session.close();
    }
  } catch (error) {
    failures.push(`the consumer negative fixture could not be built from the producer records: ${String(error?.message ?? error)}`);
  }

  // Model-use join over the producer's module-use facts, when the producer
  // publishes them.
  try {
    const capture = builders.createCapture({ cwd: project, readRoots: [join(project, 'src')], providerRoots: [typescriptDirectory] });
    const context = { ts, service: serviceModule, capture, resolved, request: { ...request, select: ['codeAccesses'] }, snapshotId };
    const produced = await producer.produceModuleUses(context);
    const moduleUses = produced.facts.filter(fact => fact.kind === 'moduleUse');
    const observed = moduleUses.map(fact => ({
      module: { realPath: fact.value?.record?.module?.path ?? null, sha256: fact.value?.record?.module?.sha256 ?? null },
      export: { name: fact.value?.record?.export ?? null },
      snapshotId: 'model-observed-1',
      provider: { name: 'zod', version: '4.3.6' },
    }));
    const perUse = moduleUses.map((fact, index) => {
      const joined = joinModelUses({ model: observed[index], uses: [fact] });
      return { facts: moduleUses.length, relations: joined.relations.length, limits: joined.limits.map(limit => limit.code) };
    });
    checks.push({ name: 'joint-model-use', ok: perUse.length > 0 && perUse.every(entry => entry.relations === 1), detail: JSON.stringify(perUse) });
    if (perUse.length === 0 || perUse.some(entry => entry.relations !== 1)) {
      failures.push('the joint model-use join did not produce one relation per producer module-use fact');
    }
  } catch (error) {
    failures.push(`the module-use producer call failed: ${String(error?.message ?? error)}`);
  }

  const report = buildReport({ node, tsProducerDirectory, typescriptDirectory, statement, failures, notes: { checks, consumed } });
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (out === null) process.stdout.write(text);
  else writeFileSync(out, text);
  rmSync(root, { recursive: true, force: true });

  if (failures.length > 0) {
    const producerOnly = statement?.status === 'producer-failed' && failures.length === 1;
    process.exit(producerOnly ? 3 : 1);
  }
  process.exit(0);
}

await main().catch(error => {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exit(1);
});

export { main };
