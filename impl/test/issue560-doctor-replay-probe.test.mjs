// Issue #560: the replay probe behind `baton doctor` and the `quarantine` verb assembles its store
// with no options, so `_runLineagePolicy` is null. A running resident passes
// `runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY`, and every stop it records carries the scope
// fields. Before the fix the probe expected the policy-less field set and reported every recorded
// stop as `run_stop_integrity`, and the doctor's own remedy (quarantine) then broke the logical
// fold: quarantining the admission made the completion refuse, and quarantining that left the run
// un-stopped. The fix follows the #325/#504 precedent — the FOLD reads the scope from the row it
// folds — so the probe folds a recorded stop exactly as the deployment recorded it, while a
// policy-less ledger keeps replaying under its own (unscoped) shape.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, coordinationReplayFailure } from '../src/coordination-store.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const root = (label) => mkdtempSync(join(tmpdir(), `baton-560-probe-${label}-`));
const repoId = 'repo-560-probe';
const policy = Object.freeze({
  schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 4,
  maxDescendantsPerRoot: 16, leaseTtlMs: 60_000,
});
const clock = () => '2026-07-18T08:00:00.000Z';

function task(store, runId, label) {
  const id = `task-${label}`;
  const workerId = `worker-${label}`;
  store.createTask({
    id,
    brief: { objective: `Own ${runId}`, capabilities: [] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code',
    modelRequested: 'kimi-code/k3', modelPolicy: null, effortRequested: 'max',
    sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${id}` });
  return store.claimTask(id, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${id}`,
  }, {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
}

function stopRequest(runId, reason = `Stop ${runId}`) {
  const reasonDigest = digest(reason);
  const core = { repoId, runId, reasonDigest };
  return { schemaVersion: 1, ...core, requestDigest: digest(core) };
}

test('560a: the doctor probe folds a lineage-scoped stop admission a policy-carrying resident recorded', () => {
  const directory = root('scoped');
  const store = new CoordinationStore(directory, { repoId, clock, runLineagePolicy: policy });
  const runId = 'run-560-scoped';
  task(store, runId, '560-scoped');
  const admitted = store.admitRunStop(stopRequest(runId), {
    actor: 'operator:560-probe', key: `run.stop:${runId}`,
  });
  // The recorded row carries the scope fields — this is the shape the probe could not read.
  assert.deepEqual(Object.keys(admitted.event.payload).sort(), [
    'reasonDigest', 'repoId', 'requestDigest', 'runId', 'schemaVersion', 'scope',
    'targetDigest', 'targetRunIds', 'targetTaskIds', 'targetWorkerIds', 'throughSeq',
  ]);
  store.releaseWriterLease();

  // The probe behind `baton doctor`'s coordination row and the `quarantine` verb: no options.
  assert.equal(coordinationReplayFailure(directory), null,
    'the read-only probe folds the recorded stop instead of reporting run_stop_integrity');

  // The same store construction `quarantineCoordinationLedgerEvent` probes with, held open so the
  // fold's own state is observable: the probe refuses nothing AND the run reads as stopped.
  const cold = new CoordinationStore(directory);
  assert.equal(cold.runStop(runId)?.admittedEvent, admitted.event.seq,
    'a store assembled without the deployment policies still reads the recorded stop');
  cold.releaseWriterLease();
});

test('560b: a ledger recorded without the policy keeps folding under its own unscoped shape', () => {
  const directory = root('unscoped');
  const store = new CoordinationStore(directory, { repoId, clock });
  const runId = 'run-560-unscoped';
  task(store, runId, '560-unscoped');
  const admitted = store.admitRunStop(stopRequest(runId), {
    actor: 'operator:560-probe', key: `run.stop:${runId}`,
  });
  assert.deepEqual(Object.keys(admitted.event.payload).sort(), [
    'reasonDigest', 'repoId', 'requestDigest', 'runId', 'schemaVersion',
    'targetDigest', 'targetTaskIds', 'targetWorkerIds',
  ], 'a policy-less store still records the unscoped shape');
  store.releaseWriterLease();
  assert.equal(coordinationReplayFailure(directory), null,
    'the unscoped recorded shape replays clean');
});

test('560c: the probe still reports a genuinely malformed stop admission', () => {
  const directory = root('defect');
  const store = new CoordinationStore(directory, { repoId, clock, runLineagePolicy: policy });
  const runId = 'run-560-defect';
  task(store, runId, '560-defect');
  store.admitRunStop(stopRequest(runId), { actor: 'operator:560-probe', key: `run.stop:${runId}` });
  store.releaseWriterLease();

  // Rewrite the recorded admission's target digest in place: the row no longer verifies against the
  // state it was recorded from, and the probe must keep saying so — the fix widens which field set
  // is accepted, never which content is trusted.
  const path = join(directory, 'events.jsonl');
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  const index = lines.findIndex((line) => JSON.parse(line).kind === 'run.stop_admitted');
  const row = JSON.parse(lines[index]);
  row.payload.targetDigest = digest({ tampered: true });
  lines[index] = JSON.stringify(row);
  writeFileSync(path, `${lines.join('\n')}\n`);

  const refusal = coordinationReplayFailure(directory);
  assert.notEqual(refusal, null, 'a tampered stop admission is still a refusal');
  assert.equal(refusal.kind, 'run.stop_admitted');
  assert.equal(refusal.code, 'run_stop_integrity');
});
