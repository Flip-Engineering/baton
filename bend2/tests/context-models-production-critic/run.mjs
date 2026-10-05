// Entrypoint for the independent production-critic fixtures.
//
//   node bend2/tests/context-models-production-critic/run.mjs [--only id,id]
//   CTX_PRODUCER_ROOT=<root> pins a specific captured producer tree.
//   CTX_TS_RECORDS=<file> supplies actual TS producer records (JSON array of
//   facts with value.record envelopes) for consumer-boundary checks.
//
// Exit code 0 means: every required check passed and every registered
// discriminator reproduced its defect (or reports fixed). Exit 1 is an
// unexpected divergence. The JSON report (report field) is written to stdout.

import { runChecks } from './lib/harness.mjs';
import { loadProducer } from './lib/producer.mjs';
import { buildAuxDatabase, buildOrdersDatabase, buildWriteSubject, cleanupWorkspace, makeWorkspace } from './fixtures/db.mjs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const selected = onlyIndex !== -1 ? args[onlyIndex + 1].split(',') : null;

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

const producer = await loadProducer();
const workspace = makeWorkspace('shared');
const context = {
  producer,
  workspace,
  ordersDbPath: buildOrdersDatabase(join(workspace, 'orders.sqlite3')),
  auxDbPath: buildAuxDatabase(join(workspace, 'aux.sqlite3')),
  writeSubject: buildWriteSubject(join(workspace, 'writer.sqlite3')),
  tsRecords: process.env.CTX_TS_RECORDS ?? null,
};

const results = await runChecks(context, selected);

const required = results.filter(entry => !entry.discriminator);
const discriminators = results.filter(entry => entry.discriminator);
const report = {
  suite: 'context-models-production-critic',
  producerRoot: producer.root,
  sourcePins: producer.pins,
  realTsProducerRecords: context.tsRecords !== null,
  summary: {
    requiredPassed: required.filter(entry => entry.verdict === 'pass').length,
    requiredFailed: required.filter(entry => entry.verdict !== 'pass').length,
    discriminatorsReproduced: discriminators.filter(entry => entry.verdict === 'reproduced').length,
    discriminatorsFixed: discriminators.filter(entry => entry.verdict === 'pass').length,
    total: results.length,
  },
  results,
};

console.log(JSON.stringify(report, null, 2));
cleanupWorkspace(workspace);

const healthy = report.summary.requiredFailed === 0
  && report.summary.discriminatorsReproduced + report.summary.discriminatorsFixed === discriminators.length;
process.exit(healthy ? 0 : 1);
