// Issue #526 — cold replay's last two blockers: run.stop_admitted and package.admitted read a
// live authority instead of the row's own recorded content.
//
// The class is #325/#504/#518's: a recorded row was judged against a LIVE authority the read-only
// probe behind `baton doctor` does not carry, so the deployment refused its own history. #518
// (c1dc35a2) closed the plan-budget settlement and the dispatch pair and named the two remaining
// sites, both verified against a 93988-row clone ledger:
//
//   * seq 28, `run.stop_admitted`: `_validateRunStopAdmission` derived the expected row SHAPE from
//     the presence of a live run-lineage policy, while the recorded row carries its own shape
//     (`scope`, `throughSeq`, `targetRunIds`);
//   * seq 31384, `package.admitted`: `_normalizeContextPackage` required the live Context Program
//     authority (its policy digest, its branch ceiling), while the recorded row carries its own
//     `policyDigest`.
//
// Both rows here are RECORDED BY THE REAL CODE — a live store with both policies configured runs
// the real `admitRunStop` and `admitContextPackage` — and then replayed in a store opened the way
// the doctor probe opens one: no run-lineage policy, no Context Program authority. The tamper rows
// prove the anchor did not become a rubber stamp: a stop whose target set no longer derives, and a
// package whose recorded digest no longer binds its body, still refuse at startup.
//
// Suite law: hermetic (mkdtemp fixture, fixed clock, no network, no processes).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CoordinationStore, coordinationReplayFailure,
} from '../src/coordination-store.mjs';
import { DEFAULT_RUN_LINEAGE_POLICY } from '../src/run-lineage.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY } from '../src/context-program-policy.mjs';

const REPO_ID = 'repo-526-cold-replay';
const RUN_ID = 'run-526-cold-replay';
const CLOCK_ISO = '2026-08-02T09:00:00.000Z';
const ACTOR = 'operator:issue526';
const SOURCE_DIGEST = '9'.repeat(64);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const temporaryRoots = [];
function temporaryRoot(label) {
  const directory = mkdtempSync(join(tmpdir(), `baton-issue526-${label}-`));
  temporaryRoots.push(directory);
  return directory;
}
test.after(() => { for (const directory of temporaryRoots) rmSync(directory, { recursive: true, force: true }); });

const taskId = (index) => `task-${String(index).padStart(6, '0')}`;
const workerId = (index) => `worker-${String(index).padStart(6, '0')}`;

/** One durable task row of the run under test, exactly as createTask writes it: the stop's target
 * set is a projection of these rows, so the recorded stop below is derivable from the ledger
 * alone. */
function taskRow(seq, index) {
  return {
    schemaVersion: 1, seq, ts: CLOCK_ISO, kind: 'task.created',
    actor: 'orchestrator', idempotencyKey: `task.created:${taskId(index)}`,
    payload: {
      id: taskId(index),
      brief: { objective: `Own ${RUN_ID} unit ${index}`, capabilities: ['baton_orchestrator'] },
      deps: [], refines: null, relation: 'root', runId: RUN_ID, taskType: 'general',
      reservedWorkerId: workerId(index),
      vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3', modelPolicy: null,
      effortRequested: 'max', sessionRequest: { mode: 'new' },
    },
  };
}

function writeLedger(directory, rows) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'events.jsonl'), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

function readLedger(directory) {
  return readFileSync(join(directory, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
}

/** Rewrite ONE recorded row in place (every other byte of the ledger stays), the tamper the
 * anchors below must still refuse. */
function tamperRow(directory, kind, mutate) {
  const rows = readLedger(directory);
  const row = rows.find((candidate) => candidate.kind === kind);
  assert.ok(row, `the recorded ledger still carries the ${kind} row`);
  mutate(row);
  writeLedger(directory, rows);
}

/** The deployment-side options: both authorities present, exactly as a live deployment opens the
 * store that records these rows. The Context Program reader is the stub the branch resolver needs;
 * the branch carries a `source` ref, whose bytes are resolved lazily, never by the fold. */
const recordOptions = () => ({
  repoId: REPO_ID,
  clock: () => CLOCK_ISO,
  runLineagePolicy: DEFAULT_RUN_LINEAGE_POLICY,
  deploymentBaseSha: '1'.repeat(40),
  contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  contextEnvironmentDigest: '2'.repeat(64),
  contextReferenceIdentity: '3'.repeat(64),
  contextReferenceRead: (reference) => ({
    kind: 'context_source', ref: reference.ref, digest: reference.digest,
    mediaType: reference.mediaType, itemCount: reference.itemCount,
  }),
  contextSourceAttest: () => { throw new Error('context source attestation is not used here'); },
});

/** Record BOTH rows the issue names through the real recorders, then hand back the ledger
 * directory and the shapes that were recorded. */
function recordBoth(label) {
  const directory = temporaryRoot(label);
  writeLedger(directory, [taskRow(1, 0), taskRow(2, 1)]);
  const store = new CoordinationStore(directory, recordOptions());
  try {
    const reasonDigest = digest('stop the run and everything it owns');
    const requestDigest = digest({ repoId: REPO_ID, runId: RUN_ID, reasonDigest });
    const admittedStop = store.admitRunStop(
      { schemaVersion: 1, repoId: REPO_ID, runId: RUN_ID, reasonDigest, requestDigest },
      { actor: ACTOR, key: `run.stop:${RUN_ID}` },
    );
    assert.equal(admittedStop.result, 'admitted', 'the live store records the run stop');
    const admittedPackage = store.admitContextPackage({
      schemaVersion: 1, kind: 'baton.context_package',
      branches: [{
        name: 'issue-526',
        source: {
          kind: 'context_source', ref: `ctx:sha256:${SOURCE_DIGEST}`, digest: SOURCE_DIGEST,
          mediaType: 'text/markdown', itemCount: 1,
        },
        artifact: null, valueRef: null, schema: null,
      }],
      provenance: { runId: RUN_ID, principalId: ACTOR },
      policyDigest: DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest,
    }, { actor: ACTOR, key: 'package-526' });
    assert.equal(admittedPackage.result, 'admitted', 'the live store records the package');
    const stopRow = store.events().find((row) => row.kind === 'run.stop_admitted');
    const packageRow = store.events().find((row) => row.kind === 'package.admitted');
    // The recorded SHAPE is the issue's own: the stop carries its own lineage fields, the package
    // its own policy digest. If either recorder ever stops writing them, this fixture is the place
    // the incident shape is pinned.
    assert.equal(stopRow.payload.scope, 'run_subtree');
    assert.equal(typeof stopRow.payload.throughSeq, 'number');
    assert.deepEqual(stopRow.payload.targetRunIds, [RUN_ID]);
    assert.equal(packageRow.payload.policyDigest, DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest);
    return { directory, stopRow: stopRow.payload, packageRow: packageRow.payload };
  } finally {
    store.releaseWriterLease({ requireOwned: true });
  }
}

test('a recorded run stop with its own lineage shape replays in a store carrying no run-lineage policy', () => {
  const recorded = recordBoth('stop-replay');
  // The probe's own construction: no options at all, so no lineage authority and no Context
  // Program authority — exactly what `baton doctor` opens.
  const replayed = new CoordinationStore(recorded.directory);
  try {
    assert.equal(replayed.startupStatus().state, 'ready',
      'the fold judges the recorded stop by what it carries, not by a live lineage policy');
    const stop = replayed.runStop(RUN_ID);
    assert.ok(stop, 'the recorded stop is projected');
    assert.equal(stop.status, 'stopping');
    assert.equal(stop.schemaVersion, recorded.stopRow.schemaVersion);
    assert.equal(stop.scope, 'run_subtree');
    assert.equal(stop.throughSeq, recorded.stopRow.throughSeq);
    assert.deepEqual(stop.targetRunIds, [RUN_ID]);
    assert.deepEqual(stop.targetTaskIds, [taskId(0), taskId(1)]);
    assert.deepEqual(stop.targetWorkerIds, [workerId(0), workerId(1)]);
    assert.equal(stop.targetDigest, digest({
      throughSeq: recorded.stopRow.throughSeq, targetRunIds: stop.targetRunIds,
      targetTaskIds: stop.targetTaskIds, targetWorkerIds: stop.targetWorkerIds,
    }), 'the recorded target digest is re-derived from the ledger, not loosened');
    assert.equal(coordinationReplayFailure(recorded.directory), null,
      'and the doctor probe reports the ledger clean');
  } finally {
    replayed.releaseWriterLease({ requireOwned: true });
  }
});

test('a recorded package admission replays in a store carrying no Context Program authority', () => {
  const recorded = recordBoth('package-replay');
  const replayed = new CoordinationStore(recorded.directory);
  try {
    assert.equal(replayed.startupStatus().state, 'ready',
      'the fold accepts the recorded policy digest the row carries');
    const pkg = replayed.contextPackage(recorded.packageRow.packageDigest);
    assert.ok(pkg, 'the recorded package is projected');
    assert.equal(pkg.policyDigest, DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest);
    assert.equal(pkg.admittedAt, CLOCK_ISO);
    assert.deepEqual(pkg.branches.map((branch) => branch.name), ['issue-526']);
    assert.equal(coordinationReplayFailure(recorded.directory), null,
      'and the doctor probe reports the ledger clean');
  } finally {
    replayed.releaseWriterLease({ requireOwned: true });
  }
});

test('the anchor is not a rubber stamp: a recorded stop whose target set no longer derives still refuses', () => {
  const recorded = recordBoth('stop-tamper');
  tamperRow(recorded.directory, 'run.stop_admitted', (row) => {
    row.payload.targetTaskIds = [...row.payload.targetTaskIds, 'task-phantom-526'];
  });
  assert.throws(() => new CoordinationStore(recorded.directory), (error) => {
    assert.equal(error.coordinationSeq, 3, 'the refusal names the offending row');
    assert.equal(error.coordinationKind, 'run.stop_admitted');
    assert.equal(error.code, 'run_stop_integrity');
    return true;
  });
});

test('a recorded package whose digest no longer binds its body still refuses', () => {
  const recorded = recordBoth('package-tamper');
  tamperRow(recorded.directory, 'package.admitted', (row) => {
    const flipped = row.payload.packageDigest.startsWith('0') ? '1' : '0';
    row.payload.packageDigest = `${flipped}${row.payload.packageDigest.slice(1)}`;
  });
  assert.throws(() => new CoordinationStore(recorded.directory), (error) => {
    assert.equal(error.coordinationKind, 'package.admitted');
    assert.equal(error.code, 'context_package_invalid');
    return true;
  });
});
