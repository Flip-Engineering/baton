// Real source-mutation control over a captured producer copy.
//
//   node bend2/tests/context-models-production-critic/mutation/run.mjs
//
// For each registered mutation this control:
//   1. copies the pinned producer tree (bend2/context) into a private
//      capture directory and records its hashes;
//   2. runs the SAME selected suite path against the unchanged capture
//      (baseline) and requires the targeted checks to pass;
//   3. applies one textual mutation to the captured source, records the
//      mutated bytes hash, and reruns the same path;
//   4. requires the targeted check to fail in the mutated run, and verifies
//      the failure text is the intended behavioral assertion, not an import
//      or runtime setup error.
// Runs remotely only. Exit 0 when every mutation is detected against a
// passing baseline.

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SUITE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN = join(SUITE_DIR, 'run.mjs');

const MUTATIONS = [
  {
    id: 'receiver-check-neutralized',
    // Removing the receiver admission rule must make the receiver check fail.
    file: 'bend2/context/catalogs/sql-join.mjs',
    from: "if (record.receiver?.status !== 'resolved') {",
    to: 'if (false) {',
    checks: 'sqljoin/boundary/receiver-unresolved-limited',
    intendedFailure: 'unresolved receiver still joined',
  },
  {
    id: 'plan-key-stripped',
    // Removing the SQL text from the plan key must make the cache-binding
    // check fail: the second relation would reuse the first plan.
    file: 'bend2/context/catalogs/sql-join.mjs',
    from: "planKey: [record.snapshotId, value.sourceBinding, record.sql.text].join('\\u0000'),",
    to: "planKey: [record.snapshotId, value.sourceBinding].join('\\u0000'),",
    checks: 'sqljoin/boundary/plan-cache-bound-to-provenance',
    intendedFailure: 'stale plan labeled new SQL',
  },
  {
    id: 'identity-fields-unvalidated',
    // Making declarationIdentity accept empty objects must make the
    // incomplete-declaration check fail with a joined relation.
    file: 'bend2/context/catalogs/sql-join.mjs',
    from: "  if (typeof path !== 'string' || path.length === 0) return null;",
    to: '  void path;',
    checks: 'sqljoin/boundary/incomplete-callee-declaration-refused',
    intendedFailure: 'incomplete callee declaration joined',
  },
];

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function runSuite({ producerRoot, only }) {
  const result = spawnSync(process.execPath, [RUN, '--only', only], {
    encoding: 'utf8',
    env: { ...process.env, CTX_PRODUCER_ROOT: producerRoot },
    timeout: 300000,
  });
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = null;
  }
  return { exitCode: result.status, stderr: result.stderr ?? '', report };
}

function checkOutcome(report, checkId) {
  return report?.results?.find(entry => entry.id === checkId) ?? null;
}

const producerRoot = resolve(process.env.CTX_PRODUCER_ROOT ?? join(SUITE_DIR, '../../../..', '../semantic-impl-catalogs-models'));
const outcomes = [];

for (const mutation of MUTATIONS) {
  const capture = join(tmpdir(), `ctx-critic-mutation-${process.pid}-${mutation.id}`);
  rmSync(capture, { recursive: true, force: true });
  mkdirSync(capture, { recursive: true });
  cpSync(producerRoot, join(capture, 'tree'), { recursive: true });
  const mutatedFile = join(capture, 'tree', mutation.file);
  const before = sha256File(mutatedFile);

  const baseline = runSuite({ producerRoot: join(capture, 'tree'), only: mutation.checks });
  const baselineCheck = checkOutcome(baseline.report, mutation.checks);

  const source = readFileSync(mutatedFile, 'utf8');
  if (!source.includes(mutation.from)) {
    outcomes.push({ id: mutation.id, detected: false, reason: 'mutation anchor absent from captured source; producer changed', before });
    rmSync(capture, { recursive: true, force: true });
    continue;
  }
  writeFileSync(mutatedFile, source.replace(mutation.from, mutation.to));
  const after = sha256File(mutatedFile);

  const mutated = runSuite({ producerRoot: join(capture, 'tree'), only: mutation.checks });
  const mutatedCheck = checkOutcome(mutated.report, mutation.checks);

  const detected = baseline.exitCode === 0
    && baselineCheck?.verdict === 'pass'
    && mutated.exitCode === 1
    && mutatedCheck?.verdict === 'fail'
    && String(mutatedCheck.observed?.error ?? '').includes(mutation.intendedFailure);
  outcomes.push({
    id: mutation.id,
    detected,
    baseline: { exitCode: baseline.exitCode, verdict: baselineCheck?.verdict ?? null },
    mutated: { exitCode: mutated.exitCode, verdict: mutatedCheck?.verdict ?? null, error: mutatedCheck?.observed?.error ?? null },
    hashes: { before, after },
  });
  rmSync(capture, { recursive: true, force: true });
}

console.log(JSON.stringify({ mutationControl: 'context-models-production-critic', producerRoot, outcomes }, null, 2));
const allDetected = outcomes.length > 0 && outcomes.every(entry => entry.detected === true);
process.exit(allDetected ? 0 : 1);
