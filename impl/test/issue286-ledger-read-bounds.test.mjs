// issue286-ledger-read-bounds.test.mjs — issue #286 G-38/G-45: bounded ledger reads.
//
// `eventsView()` with no arguments copies the whole ledger (the store's own comment calls it "the
// #210 class" and shipped `eventsView(fromSeq, limit)` precisely so delta readers stop doing it).
// The coordinator did it anyway at four sites; the one that mattered ran INSIDE the per-message
// delivery path, where `_messagePeers` paid three full-ledger copies to answer two O(1) questions
// (which wave does this run sit in; has that wave closed), and the recovery path copied the world
// to index ONE event out of it.
//
// The pin is a counting store double — no wall clocks, no timing: every counted read is recorded
// with its name and arguments, and the assertions are about the SHAPE of the reads an operation
// performs (zero ledger copies; the terminal read asks for exactly one element).
//
// Suite law: hermetic (mkdtemp fixture, mocked worktrees, no network) · no clocks · no timing.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Coordinator } from '../src/coordinator.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

const dirs = [];
function tmpDir(label) {
  const dir = mkdtempSync(join(tmpdir(), label));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

/** The counting double: a real store that records every counted read with its name and arguments.
 * `unbounded()` is the count of no-argument `eventsView()` calls — each one a full-ledger copy. */
const COUNTED = ['eventsView', 'waveBinding', 'waveClosure', 'orientationReadHead'];
function countingStore(store) {
  const reads = [];
  const proxy = new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (typeof value !== 'function') return value;
      if (COUNTED.includes(property)) {
        return (...args) => { reads.push({ method: property, args }); return value.apply(target, args); };
      }
      return value.bind(target);
    },
  });
  return {
    proxy,
    reads,
    unbounded: () => reads.filter((read) => read.method === 'eventsView' && read.args.length === 0).length,
    named: (method, from) => reads.slice(from).filter((read) => read.method === method).length,
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

function makeBrief() {
  return {
    goal: 'read the world, then produce the deliverable', constraints: [], pathScope: ['.'],
    definitionOfDone: 'report written', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 }, requiredEffects: [],
  };
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
  const dir = tmpDir('baton-286-reads-');
  const log = new Log(join(dir, 'log'));
  const store = coordinationForLog(log);
  const counted = countingStore(store);
  const adapter = new ScriptableAdapter();
  const coordinator = new Coordinator(coordinatorDeps({ adapter, log, coordination: counted.proxy }));
  return { dir, log, store, adapter, coordinator, ...counted };
}

async function flush() { for (let i = 0; i < 100; i += 1) await Promise.resolve(); }
function sent(fx, worker) {
  return fx.log.read(worker.id).filter((e) => e.kind === 'message.sent_result').at(-1)?.payload;
}
function emitMessage(fx, worker, fields) {
  fx.adapter.emit({
    worker: worker.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'message.send', actor: 'worker',
    payload: { kind: fields.kind ?? 'query', ...fields },
  });
}

test('G45-R1: one peer exchange copies the ledger zero times', async () => {
  const fx = laneFixture();
  const a = await fx.coordinator.spawn('mock', makeBrief(), { runId: 'run:a' });
  const b = await fx.coordinator.spawn('mock', makeBrief(), { runId: 'run:b' });
  const foreign = await fx.coordinator.spawn('mock', makeBrief(), { runId: 'run:foreign' });
  for (const [runId, waveId] of [['run:a', 'wave:ours'], ['run:b', 'wave:ours'], ['run:foreign', 'wave:theirs']]) {
    fx.store.recordDriver('steering.registered', { runId, driverKind: 'wave', waveId, waveRole: runId },
      { actor: 'orchestrator', key: `steering:${runId}` });
  }

  // The baseline is taken AFTER construction: the coordinator's one legitimate full pass is its own
  // replay rebuild (`_replay`), which must see every event once. What this pin forbids is a
  // whole-ledger copy inside an OPERATION.
  const baseline = fx.unbounded();
  const before = fx.reads.length;
  emitMessage(fx, a, { to: { workerId: b.id }, body: 'Which interface can we share?' });
  await flush();
  const root = sent(fx, a);
  assert.equal(root?.ok, true, 'the in-wave peer message still delivers');
  assert.equal(fx.unbounded(), baseline, 'a peer delivery copies the ledger zero times');
  // Two membership checks per delivery (send-time admission, then the delivery-time recheck), each
  // asking the store's projections: one binding per member and one closure per check.
  assert.equal(fx.named('waveBinding', before), 4, 'the wave question is a folded lookup, never a scan');
  assert.equal(fx.named('waveClosure', before), 2, 'the closure question reads the closure projection');

  const afterDelivery = fx.unbounded();
  emitMessage(fx, a, { to: { workerId: foreign.id }, body: 'Unauthorized peer send' });
  await flush();
  assert.equal(fx.unbounded(), afterDelivery, 'the foreign-wave refusal copies the ledger zero times too');

  // A closed wave is answered from the store's own closure projection — still no copy.
  fx.store.appendWaveClosed({
    waveId: 'wave:ours', receiptDigest: 'a'.repeat(64), rings: [], lanes: [], parked: [], blockedOn: [],
    settlementErrors: [],
    knowledge: { candidates: 0, admittedThisRun: 0, candidatesAwaitingAdmission: 0, settlementRunId: null },
  }, { actor: 'orchestrator', key: 'wave.close:ours' });
  emitMessage(fx, a, { to: { workerId: b.id }, body: 'The wave has closed.' });
  await flush();
  assert.equal(fx.unbounded(), afterDelivery, 'the closed-wave refusal copies the ledger zero times');
});

test('G45-R2: the terminal-event read asks the store for one element, never the world', () => {
  const fx = laneFixture();
  const auth = (key) => ({ actor: 'orchestrator', key });
  fx.store.createTask({ id: 't-prior', brief: { objective: 'prior' }, deps: [], refines: null, runId: 'run:r' }, auth('t1'));
  const claimed = fx.store.claimTask('t-prior', 'w-prior', 1, auth('t2'));
  const done = fx.store.transitionTask('t-prior', 'completed', claimed.task.version, auth('t3'), {
    coordinationSeq: claimed.event.seq,
  });
  const durable = fx.store.task('t-prior');
  assert.equal(durable.status, 'completed');
  assert.equal(durable.terminalEvent, done.event.seq, 'the fixture has a real terminal event');

  // The admission's own write half is not this pin's subject: the read shape is. Stubbing it keeps
  // the assertion about the ledger read the coordinator performs BEFORE it decides anything.
  fx.store.recoveryAttemptHead = () => null;
  fx.store.admitRecoveryAttempt = () => ({ attempt: { attemptId: 'attempt:stub', state: 'pending' } });

  const handle = { id: 'w-prior', processGeneration: 3, routeKey: 'mock|mock-model|low' };
  const task = { id: 't-prior', vendorRequested: 'mock' };
  const session = { id: 'sess-prior', context: { repoRoot: '/tmp/repo', baseSha: 'a'.repeat(40), branch: 'baton/prior' } };
  const before = fx.reads.length;
  try {
    fx.coordinator._admitDurableRecoveryAttempt(handle, task, session, fx.adapter);
  } catch (error) {
    // A refusal is acceptable here and is not silent: it must be typed, and it must come AFTER the
    // bounded read (the assertions below prove the read happened).
    assert.ok(typeof error?.code === 'string' && error.code.length > 0,
      `the recovery admission refused without a typed code: ${error?.message ?? error}`);
  }
  const window = fx.reads.slice(before);
  const views = window.filter((read) => read.method === 'eventsView');
  assert.ok(views.length > 0, 'the recovery admission read the terminal event');
  assert.equal(window.filter((read) => read.method === 'eventsView' && read.args.length === 0).length, 0,
    'the recovery admission never copies the ledger');
  assert.deepEqual(views[0], { method: 'eventsView', args: [durable.terminalEvent, 1] },
    'the terminal event is read as one element at its own seq');
});
