// Entrypoint for the independent production-critic fixtures.
//
//   node bend2/tests/context-models-production-critic/run.mjs [--only id,id]
//
// Every check is a required qualification assertion. Exit codes:
//   0  all selected checks passed
//   1  at least one selected check failed
//   2  at least one selected check is pending an admitted external artifact
//      (currently: the single TS joint-fixture record artifact)
//   64 command refusal (bad arguments), before any fixture or provider effect
//
// Options:
// - CTX_PRODUCER_ROOT=<path> pins the captured producer tree (a commit of
//   semantic-impl-catalogs-models; c6fc585d at this writing).
// - CTX_ZOD_ROOT=<path> points at a real Zod 4.3.6 installation.
// - CTX_TS_RECORDS=<path> is the retained record artifact of the single TS
//   joint fixture (a JSON array of facts carrying value.record envelopes).
//   It is read, hashed and validated here; the consumer-boundary positives
//   run on its records. Without it those checks report pending.
// - CTX_RETAIN_DIR=<path> keeps each invocation's inputs, stdout/stderr text,
//   result, status and the actual loaded module closure. Without it the
//   default is <suite>/.scratch/invocations/<ts>-<pid>, and the subject
//   workspace is preserved inside it instead of deleted.
//
// This suite runs only on admitted remote validation runners.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUITE_DIR = dirname(fileURLToPath(import.meta.url));

// ---- argument validation, before any fixture or provider effect ----------
const args = process.argv.slice(2);
const refusals = [];
let only = null;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === '--only') {
    const value = args[index + 1];
    if (value === undefined || value.trim() === '') {
      refusals.push({ argument, reason: 'onlyRequiresNonemptyIdList' });
      break;
    }
    only = value.split(',').map(id => id.trim()).filter(id => id.length > 0);
    if (only.length === 0) refusals.push({ argument, reason: 'emptySelection' });
    index += 1;
    continue;
  }
  refusals.push({ argument, reason: 'unknownArgument' });
}
if (refusals.length > 0) {
  console.log(JSON.stringify({ suite: 'context-models-production-critic', refusal: 'commandRefused', refusals, next: ['run.mjs --only <id,id>'] }, null, 2));
  process.exit(64);
}

import { knownCheckIds, runChecks } from './lib/harness.mjs';
import { loadedModulesWithHashes, registerTracker } from './lib/closure.mjs';
import { loadProducer } from './lib/producer.mjs';
import { buildAuxDatabase, buildOrdersDatabase, buildWriteSubject, makeWorkspace } from './fixtures/db.mjs';

registerTracker();

// Registry is populated by importing the case files; validation of --only
// IDs happens after these imports but still before any check runs.
await import('./cases/catalog-session.test.mjs');
await import('./cases/statement-framing.test.mjs');
await import('./cases/origin-metadata.test.mjs');
await import('./cases/rootpage-identity.test.mjs');
await import('./cases/sql-join.test.mjs');
await import('./cases/model-use-join.test.mjs');
await import('./cases/zod-model.test.mjs');
await import('./cases/json-schema.test.mjs');
await import('./cases/dataset-values.test.mjs');
await import('./cases/migration-replay.test.mjs');
await import('./cases/environment-allowlist.test.mjs');

if (only !== null) {
  const known = knownCheckIds();
  const unknown = only.filter(id => !known.includes(id));
  if (unknown.length > 0) {
    console.log(JSON.stringify({ suite: 'context-models-production-critic', refusal: 'unknownCheckIds', unknown, knownCount: known.length }, null, 2));
    process.exit(64);
  }
}

// ---- TS record artifact: read, hash, validate before any use -------------
function consumeTsRecords() {
  const artifactPath = process.env.CTX_TS_RECORDS ?? null;
  if (artifactPath === null) return { present: false };
  let bytes;
  try {
    bytes = readFileSync(artifactPath);
  } catch (error) {
    throw new Error(`CTX_TS_RECORDS is unreadable: ${error.message}`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let facts;
  try {
    facts = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`CTX_TS_RECORDS is not JSON: ${error.message}`);
  }
  if (!Array.isArray(facts)) throw new Error('CTX_TS_RECORDS must be a JSON array of facts');
  const constantSql = facts.filter(fact => fact?.kind === 'sqlCall' && fact?.value?.record?.schema === 'baton2.context.resolver-record.v1');
  const moduleUse = facts.filter(fact => fact?.kind === 'moduleUse' && fact?.value?.record?.schema === 'baton2.context.resolver-record.v1');
  if (constantSql.length === 0 && moduleUse.length === 0) {
    throw new Error('CTX_TS_RECORDS carries no facts[].value.record envelopes with the agreed schema');
  }
  return { present: true, path: resolve(artifactPath), sha256, bytes: bytes.length, factCount: facts.length, constantSqlCount: constantSql.length, moduleUseCount: moduleUse.length, constantSql, moduleUse };
}

const invocationDir = resolve(process.env.CTX_RETAIN_DIR ?? join(SUITE_DIR, '.scratch/invocations', `${Date.now()}-${process.pid}`));
mkdirSync(invocationDir, { recursive: true });

let tsRecords;
try {
  tsRecords = consumeTsRecords();
} catch (error) {
  writeFileSync(join(invocationDir, 'stderr'), `CTX_TS_RECORDS refused: ${error.message}\n`);
  console.log(JSON.stringify({ suite: 'context-models-production-critic', refusal: 'tsRecordsRefused', detail: String(error.message) }, null, 2));
  process.exit(64);
}

const producer = await loadProducer();
const workspace = makeWorkspace('shared');
const context = {
  producer,
  workspace,
  ordersDbPath: buildOrdersDatabase(join(workspace, 'orders.sqlite3')),
  auxDbPath: buildAuxDatabase(join(workspace, 'aux.sqlite3')),
  writeSubject: buildWriteSubject(join(workspace, 'writer.sqlite3')),
  tsRecords,
};

const results = await runChecks(context, only);

const passed = results.filter(entry => entry.verdict === 'pass').length;
const failed = results.filter(entry => entry.verdict === 'fail').length;
const pending = results.filter(entry => entry.verdict === 'pending').length;
const report = {
  suite: 'context-models-production-critic',
  producerRoot: producer.root,
  producerSourcePins: producer.pins,
  loadedModuleClosure: loadedModulesWithHashes().filter(entry => entry.url.startsWith('file:') && entry.url.includes('/bend2/context/')),
  tsRecordArtifact: tsRecords.present ? { path: tsRecords.path, sha256: tsRecords.sha256, bytes: tsRecords.bytes, factCount: tsRecords.factCount, constantSqlCount: tsRecords.constantSqlCount, moduleUseCount: tsRecords.moduleUseCount } : { present: false },
  invocationDir,
  summary: { passed, failed, pending, total: results.length },
  results,
};

const reportText = JSON.stringify(report, null, 2);
console.log(reportText);

// Retain inputs, result, status and the subject workspace inside the unique
// invocation directory instead of deleting artifacts after output.
writeFileSync(join(invocationDir, 'inputs.json'), JSON.stringify({ argv: args, env: { CTX_PRODUCER_ROOT: process.env.CTX_PRODUCER_ROOT ?? null, CTX_ZOD_ROOT: process.env.CTX_ZOD_ROOT ?? null, CTX_TS_RECORDS: process.env.CTX_TS_RECORDS ?? null }, node: process.version }, null, 2));
writeFileSync(join(invocationDir, 'result.json'), reportText);
writeFileSync(join(invocationDir, 'status'), `${report.summary.passed} passed, ${report.summary.failed} failed, ${report.summary.pending} pending\n`);
try {
  const { cpSync } = await import('node:fs');
  cpSync(workspace, join(invocationDir, 'subject-workspace'), { recursive: true });
} catch {
  // Retention of the subject workspace is best effort; result and status are
  // already retained above.
}

const exitCode = failed > 0 ? 1 : pending > 0 ? 2 : 0;
process.exit(exitCode);
