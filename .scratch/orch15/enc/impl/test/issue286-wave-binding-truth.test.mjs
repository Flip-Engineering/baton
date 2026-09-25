// issue286-wave-binding-truth.test.mjs — issue #286 G-31: ONE reading of current state.
//
// An append-only log has no updates: a later record for the same key is a CORRECTION. Two readers
// disagreed about which record is current — `_waveIdOf`/`_waveRoleOf` scanned forward and returned
// the FIRST `steering.registered` for a run, while `orphans` folded `worker.generation_bound`
// last-write-wins. A run re-registered under a new wave resolved to its STALE wave, and that value
// decides whether two members may exchange messages at all.
//
// The law (written down in coordination-internals.mjs): current state is the LAST record, read from
// the replay fold, never rescanning the ledger. This file feeds a rebinding and asserts that the
// wave readers, the orphan scan and the message lane all agree on it.
//
// Suite law: hermetic (mkdtemp fixture, mocked worktrees, no network) · no clocks · no timing.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Coordinator } from '../src/coordinator.mjs';
import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const dirs = [];
function tmpDir(label = 'baton-286-wave-') {
  const dir = mkdtempSync(join(tmpdir(), label));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

/** Every record the log holds for one predicate, in append order — the raw material a "first
 * binding" reader would have answered from. */
function records(store, predicate) {
  return store.eventsView().filter(predicate);
}

function makeBrief() {
  return {
    goal: 'read the world, then produce the deliverable', constraints: [], pathScope: ['.'],
    definitionOfDone: 'report written', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 }, requiredEffects: [],
  };
}

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native', turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'issue286', refreshedAt: null,
      },
    };
    this.calls = { spawn: [], prompt: [], interrupt: [], approve: [], answer: [], kill: [] };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) { this.calls.spawn.push({ worker, brief }); return { ok: true }; }
  async prompt(worker, content, mode) { this.calls.prompt.push({ worker, content, mode }); return { ok: true }; }
  async interrupt(worker, then) { this.calls.interrupt.push({ worker, then }); return { ok: true }; }
  async approve(worker, requestId, decision, payload) { this.calls.approve.push({ worker, requestId, decision, payload }); return { ok: true }; }
  async answer(worker, requestId, answer) { this.calls.answer.push({ worker, requestId, answer }); return { ok: true }; }
  async kill(worker) { this.calls.kill.push({ worker }); return { ok: true }; }
}

function coordinatorDeps({ adapter, log, coordination }) {
  return {
    log,
    coordination,
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {},
      remove: async () => {},
      reconcile: async () => {},
    },
    referee: async (task) => ({
      reverified: true, observedExit: task.brief.verification.expectExit,
      matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
    }),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
  };
}

function laneFixture() {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const store = coordinationForLog(log);
  const adapter = new ScriptableAdapter();
  const coordinator = new Coordinator(coordinatorDeps({ adapter, log, coordination: store }));
  return { dir, log, store, adapter, coordinator };
}

async function flush() { for (let i = 0; i < 100; i += 1) await Promise.resolve(); }
function sent(fx, worker) {
  return fx.log.read(worker.id).filter((e) => e.kind === 'message.sent_result').at(-1)?.payload;
}
function rejected(fx, worker) {
  return fx.log.read(worker.id).filter((e) => e.kind === 'message.rejected').at(-1)?.payload.reason;
}

test('G31-R1: a re-registered run resolves to its CURRENT wave, and the raw log shows the rebinding', async () => {
  const fx = laneFixture();
  const a = await fx.coordinator.spawn('mock', makeBrief(), { runId: 'run:a' });
  const b = await fx.coordinator.spawn('mock', makeBrief(), { runId: 'run:b' });
  const auth = (key) => ({ actor: 'orchestrator', key });
  fx.store.recordDriver('steering.registered', { runId: 'run:a', driverKind: 'wave', waveId: 'wave:old', waveRole: 'lane' }, auth('steer:a:1'));
  fx.store.recordDriver('steering.registered', { runId: 'run:a', driverKind: 'wave', waveId: 'wave:new', waveRole: 'lead' }, auth('steer:a:2'));
  fx.store.recordDriver('steering.registered', { runId: 'run:b', driverKind: 'wave', waveId: 'wave:new', waveRole: 'lane' }, auth('steer:b'));

  const rebindings = records(fx.store, (e) => e.kind === 'driver.recorded'
    && e.payload?.kind === 'steering.registered' && e.payload?.runId === 'run:a');
  assert.equal(rebindings.length, 2, 'the fixture really re-registered the run');
  assert.equal(rebindings[0].payload.waveId, 'wave:old');
  assert.equal(rebindings[1].payload.waveId, 'wave:new');

  const binding = fx.store.waveBinding('run:a');
  assert.equal(binding.waveId, 'wave:new', 'the store fold keeps the current (last) binding');
  assert.equal(binding.waveRole, 'lead', 'the role is corrected with the wave');
  assert.equal(binding.registeredEvent, rebindings[1].seq, 'the binding names the record it came from');
  assert.equal(fx.coordinator._waveIdOf('run:a'), 'wave:new', 'the coordinator reads the same binding');
  assert.equal(fx.coordinator._waveRoleOf('run:a'), 'lead', 'the role reader agrees with the wave reader');

  // The behavioural consequence, in the lane that consumes it: run:a is a peer of run:b in wave:new.
  // A first-binding reader would have answered wave:old here and refused this delivery.
  fx.adapter.emit({
    worker: a.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send', actor: 'worker',
    payload: { kind: 'query', to: { workerId: b.id }, body: 'Re-bound to the new wave.' },
  });
  await flush();
  assert.equal(sent(fx, a)?.ok, true, 'the CURRENT wave membership admits the peer message');
  assert.equal(rejected(fx, a), undefined, 'nothing refused the delivery');
});

test('G31-R2: the orphan scan names the LAST generation binding, like every other reader', () => {
  const fx = laneFixture();
  const auth = (key) => ({ actor: 'orchestrator', key });
  fx.store.createTask({ id: 't-orphan', brief: { objective: 'orphan' }, deps: [], refines: null, runId: 'run:o' }, auth('o1'));
  const claimed = fx.store.claimTask('t-orphan', 'w-orphan', 1, auth('o2'));
  assert.equal(claimed.task.assignee, 'w-orphan');
  const generation = (processGeneration, key) => fx.store.recordWorkerGeneration({
    workerId: 'w-orphan', processGeneration, runId: 'run:o', taskId: 't-orphan', taskVersion: claimed.task.version,
  }, auth(key));
  const first = generation(1, 'gen:1');
  const second = generation(2, 'gen:2');

  const bindings = records(fx.store, (e) => e.kind === 'worker.generation_bound' && e.payload?.workerId === 'w-orphan');
  assert.deepEqual(bindings.map((e) => e.payload.processGeneration), [1, 2], 'the fixture rebinds the generation');
  assert.equal(first.event.seq, bindings[0].seq);
  assert.equal(second.event.seq, bindings[1].seq);

  const rows = fx.store.orphans({ liveWorkers: [] });
  const orphan = rows.find((row) => row.taskId === 't-orphan');
  assert.ok(orphan, 'the claimed task of a dead worker is an orphan');
  assert.equal(orphan.processGeneration, 2,
    'orphans names the CURRENT generation — the same last-write-wins reading the wave binding uses');

  // Both readers name the last record of their own key, and the fold they read is the same fold the
  // replay built: `workerGeneration` (the store's public reader) reports the same generation.
  assert.equal(fx.store.workerGeneration('w-orphan').processGeneration, 2);
  assert.equal(fx.store.workerGeneration('w-orphan').boundEvent, bindings[1].seq);
  const replay = new CoordinationStore(join(fx.dir, 'log', 'coordination'), {
    operationalRead: (worker, seq) => fx.log.read(worker, seq).find((event) => event.seq === seq) ?? null,
  });
  assert.equal(replay.waveBinding('run:a'), null, 'a store with no steering record binds no wave');
  assert.equal(replay.orphans({ liveWorkers: [] }).find((row) => row.taskId === 't-orphan').processGeneration, 2,
    'the SAME reading survives a fresh replay off the durable ledger');
});
