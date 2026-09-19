// Issue #390 red-before suite: the contextCall projection owes a distinct `stopping` state from
// stop ADMISSION until a completed-stop receipt is observed; `stopped` only after the receipt.
//
// The store folds exactly ONE completed-stop receipt into the stop row: `run.stop_completed`
// (completeRunStop appends it; the run.stop_completed fold stamps `_runStops` status 'stopped'
// with the receipt). The worker's process_closed / kill.confirmed rows ride the worker's own
// operational ledger and are never folded into the stop row, so the awaited receipt the
// projection names is `run.stop_completed` — nothing else.
//
// While stopping, the call view names what it waits on with the #10 waiting vocabulary:
// `waitingOn: {kind: '<receipt kind>', since: <seq>}` — here the stop ADMISSION's event seq.
// Honest-null law: the field is always present, `null` when the call is not waiting.
//
// ROW INVENTORY
//   (a)  an admitted stop reads `stopping` with the awaited receipt named   (RED at HEAD:
//        the view reads 'stopped' from the admission alone and carries no waitingOn)
//   (b)  the receipt observed reads `stopped` and exits waitingOn to null   (RED at HEAD:
//        waitingOn is absent, not honest-null)
//   (c)  a stop whose receipt never lands stays `stopping` and never reads `stopped`
//   (d)  replay parity: a ledger with the admission but not the receipt replays to `stopping`
// Fixture idiom: the deployment + context map fixture the existing context-call suites use
// (phase85-context-effect-admission / phase84-context-map), stopped at the STORE level so the
// stop stays open — the application's own stop flow completes the receipt in-process and can
// never observe its own open admission.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';

const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'kimi-code', model: 'k3', effort: 'high' });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-issue390-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'issue390@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Issue 390'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  writeFileSync(join(root, 'alpha.mjs'), 'export const alpha = 1;\n');
  writeFileSync(join(root, 'beta.mjs'), 'export const beta = 2;\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter(route, tracker) {
  const value = new MockAdapter({
    harness: route.harness,
    scenario: {
      outcome: 'completed',
      edits: [{ path: `${route.harness}-source.txt`, content: 'source\n', delayMs: 20 }],
    },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(), authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'issue390-context-call-stopping-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  return value;
}

function options(repo, deploymentRoot, tracker) {
  return {
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, tracker),
        'kimi-code': adapter(routeB, tracker),
      },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({
          freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER,
        }),
      },
    },
  };
}

/** One open Context map call on an approved workflow — the call the stop will target. */
async function mapCall(t, { label }) {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), `baton-issue390-${label}-`));
  const tracker = { calls: [] };
  let deployment; let driver; let driverOptions = null;
  const open = async () => openBatonDeployment(options(repo, deploymentRoot, tracker), (captured) => {
    driverOptions = captured;
    driver = createDriver(captured);
    return driver;
  });
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await open();
  const workflow = await deployment.workflow(`Prove one Context map stop projection (${label}).`, {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const mapped = await workflow.context().map(parts, {
    role: 'critic', instruction: 'Write one exact retained result for this partition.',
  });
  return { deployment, store: driver.coordination, deploymentRoot, runId: workflow.id, callId: mapped.id, driverOptions, open };
}

function admitStop(store, runId) {
  const repoId = store.goalPlanPolicy().repoId;
  const reasonDigest = digest(`Stop the Context map before its receipt (${runId}).`);
  return store.admitRunStop({
    schemaVersion: 1, repoId, runId, reasonDigest,
    requestDigest: digest({ repoId, runId, reasonDigest }),
  }, { actor: 'direct:issue390', key: `run.stop:${runId}` });
}

function receiptFor(stop) {
  const targetCount = stop.targetWorkerIds.length;
  const core = {
    schemaVersion: stop.schemaVersion,
    state: 'stopped', scope: stop.scope ?? 'run', repoId: stop.repoId, runId: stop.runId,
    targetCount, remainingCount: 0, targetDigest: stop.targetDigest,
    counts: {
      pendingCancelled: targetCount, killConfirmed: 0, alreadyTerminal: 0,
      processesObserved: 0, processesClosed: 0,
    },
    checks: { dispatchClosed: true, interactionsResolved: true, runAuthorityReleased: true },
    effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false },
    context: {
      targetSessionCount: stop.targetContextSessionIds.length,
      targetCellCount: stop.targetContextCellIds.length,
      targetCallCount: stop.targetContextCallIds.length,
      remainingSessionCount: 0,
      remainingCellCount: 0,
      remainingCallCount: 0,
    },
  };
  return { ...core, receiptDigest: digest(core) };
}

test('a390 (a)(b): an admitted stop reads stopping with the awaited receipt named; the receipt exits to stopped', async (t) => {
  const { store, runId, callId } = await mapCall(t, { label: 'exit' });
  const admittedStop = admitStop(store, runId);
  const stop = admittedStop.stop;
  assert.equal(stop.status, 'stopping', 'fixture: the store-level admission stays open');
  assert.deepEqual(stop.targetContextCallIds, [callId],
    'fixture: the plan-pending map call is swept into the stop target set');

  // (a) RED at HEAD: the view reads 'stopped' from the admission alone, with no waitingOn.
  const view = store.contextCall(callId);
  assert.equal(view.state, 'stopping',
    'an admitted-but-uncompleted stop must read stopping, never stopped');
  assert.deepEqual(view.waitingOn,
    { kind: 'run.stop_completed', since: admittedStop.event.seq },
    'while stopping the row must name the ONE receipt the store folds and when it started waiting');

  // (b) the receipt observed: `stopped`, and the wait exits to the honest null.
  store.completeRunStop(runId, receiptFor(stop), {
    actor: 'direct:issue390', key: `run.stop.complete:${runId}`,
  });
  const completed = store.contextCall(callId);
  assert.equal(completed.state, 'stopped');
  assert.equal(completed.waitingOn, null);
});

test('a390 (c): a stop whose receipt never lands stays stopping and never reads stopped', async (t) => {
  const { store, runId, callId } = await mapCall(t, { label: 'open' });
  const admittedStop = admitStop(store, runId);
  assert.equal(store.contextCall(callId).state, 'stopping');
  await new Promise((resolve) => { setTimeout(resolve, 50); });
  const still = store.contextCall(callId);
  assert.equal(still.state, 'stopping', 'without the receipt the call must not read stopped');
  assert.deepEqual(still.waitingOn,
    { kind: 'run.stop_completed', since: admittedStop.event.seq },
    'the open wait keeps naming the same awaited receipt since the same admission seq');
});

test('a390 (d): a ledger with the admission but not the receipt replays to stopping', async (t) => {
  const { deployment, store, runId, callId, driverOptions } = await mapCall(t, { label: 'replay' });
  const admittedStop = admitStop(store, runId);
  assert.equal(store.contextCall(callId).state, 'stopping');

  // A fresh driver over the same durable ledger after the resident is gone — the crashed-restart
  // projection BEFORE any restart reconciliation acts: pure ledger replay, no live stop chain.
  // The deployment layer (openBatonDeployment) would reconcile the open stop at startup, so the
  // replay rides the driver level only.
  await deployment.close();
  const replay = createDriver(driverOptions);
  // #509: the captured options carry the open path's internal `coordinationAsyncOpen`, so this
  // driver's store replays asynchronously and its projection holds nothing until `coordinationOpened`
  // resolves — the driver contract requires that promise be awaited before the store's first read
  // (the deployment open awaits it at its own first read). Reading straight after `createDriver`
  // raced the replay and answered from the empty projection.
  await replay.coordinationOpened;
  const replayed = replay.coordination.contextCall(callId);
  assert.equal(replayed.state, 'stopping',
    'the admission-only ledger must replay to the same stopping view, never stopped');
  assert.deepEqual(replayed.waitingOn,
    { kind: 'run.stop_completed', since: admittedStop.event.seq });
  replay.coordination.releaseWriterLease();
});
