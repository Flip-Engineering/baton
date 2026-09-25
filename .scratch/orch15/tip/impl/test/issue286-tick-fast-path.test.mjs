// issue286-tick-fast-path.test.mjs — issue #286 G-40: the read-only tick fast path.
//
// `tick()` runs `_sweepDeadlines` + `_dispatchPass` on every public command. Both walk live state
// (every worker, every pending interaction, every stop waiter; every pending task's dependency
// list), which a READ pays for nothing: a read has no effect of its own that the sweep or the
// dispatch pass could be following.
//
// The fast path (`tickRead`) runs the same health boundary and then the deadline work ONLY when a
// recorded deadline has come due — `_deadlineDue` reads the same records `_sweepDeadlines` acts on,
// so nothing that can fire is skipped. Mutations keep the full tick, because the command that makes
// work ready is the one that dispatches it.
//
// The pin counts invocations (no wall clocks, no timing) and proves the due branch still fires.
//
// Suite law: hermetic (mkdtemp fixture, mocked worktrees, no network) · injectable clock.

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
function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-286-tick-'));
  dirs.push(dir);
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

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

async function flush() { for (let i = 0; i < 100; i += 1) await Promise.resolve(); }

/** A coordinator with an injectable clock and a counter on the two deadline paths. */
function fixture() {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const adapter = new ScriptableAdapter();
  let nowMs = 0;
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
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
    now: () => nowMs,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
    progressNudgeWindowMs: 25,
  });
  const counts = { sweeps: 0, dispatches: 0 };
  const sweep = coordinator._sweepDeadlines.bind(coordinator);
  const dispatch = coordinator._dispatchPass.bind(coordinator);
  coordinator._sweepDeadlines = () => { counts.sweeps += 1; return sweep(); };
  coordinator._dispatchPass = () => { counts.dispatches += 1; return dispatch(); };
  const reset = () => { counts.sweeps = 0; counts.dispatches = 0; };
  const setNow = (ms) => { nowMs = ms; };
  return { dir, log, adapter, coordinator, counts, reset, setNow };
}

/** The read-only public command: it authorizes, normalizes targets and answers from the attention
 * projection — no append, no process effect. The principal is the deployment's orchestrator of
 * record, so a run-scoped follow is authorized. */
function readCommand(fx, runId = 'run:tick') {
  return fx.coordinator.attentionFollow(
    { scope: { runId }, targets: [], afterCursor: 0 }, { principalId: 'wave-owner' },
  );
}

test('G40-R1: a read-only command pays the deadline work zero times when nothing is due', async () => {
  const fx = fixture();
  await fx.coordinator.spawn('mock', makeBrief(), { runId: 'run:tick' });
  fx.reset();
  await readCommand(fx);
  await readCommand(fx);
  assert.deepEqual(fx.counts, { sweeps: 0, dispatches: 0 },
    'a read runs neither the sweep nor the dispatch pass while no recorded deadline has come due');
});

test('G40-R2: the fast path is not a skip — a due deadline still fires, and the mutation tick is unchanged', async () => {
  const fx = fixture();
  const handle = await fx.coordinator.spawn('mock', makeBrief(), { runId: 'run:tick' });
  fx.adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId: 'q:due', question: 'Which interface?', blocking: true },
  });
  await flush();
  assert.equal(fx.coordinator.interactionStatus('q:due').state, 'pending', 'the fixture has a pending interaction');

  fx.reset();
  const beforeDue = await readCommand(fx);
  assert.deepEqual(fx.counts, { sweeps: 0, dispatches: 0 },
    'nothing is due yet: the blocking-question default deadline has not elapsed');
  assert.equal(beforeDue.reasons.some((reason) => reason.kind === 'interaction_expired'), false,
    'and nothing was expired for the read to report');

  // The blocking question's own recorded rule: mintedAt + the deployment's blocking-interaction
  // timeout. Read it off the coordinator so the pin tracks the policy instead of restating it.
  fx.setNow(fx.coordinator._watchdog.blockingInteractionTimeoutMs + 1);
  fx.reset();
  const afterDue = await readCommand(fx);
  assert.ok(fx.counts.sweeps >= 1, 'a due deadline makes the read run the sweep');
  assert.ok(fx.counts.dispatches >= 1, 'and the dispatch pass beside it');
  // The effect landed on the read's own surface: the page the read returned carries the expiry
  // reason, and the expiry itself is durable — the fast path skipped nothing that can fire.
  assert.ok(afterDue.reasons.some((reason) => reason.kind === 'interaction_expired'
    && reason.requestId === 'q:due'),
  'the due deadline actually fired: the read reports the interaction it expired');
  assert.equal(fx.log.read(handle.id).filter((event) => event.kind === 'question.expired'
    && event.payload?.requestId === 'q:due').length, 1,
  'the expiry is durable: one question.expired receipt for the escalated interaction');

  // A MUTATING command pays the deadline work unconditionally, exactly as before: the command that
  // makes work is the one that follows it.
  fx.adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'question.asked', actor: 'worker',
    payload: { requestId: 'q:mutating', question: 'And this one?', blocking: true },
  });
  await flush();
  assert.equal(fx.coordinator.interactionStatus('q:mutating').state, 'pending');
  fx.reset();
  fx.coordinator.respond('q:mutating', { text: 'answered' }, 'orchestrator');
  await flush();
  assert.deepEqual(fx.counts, { sweeps: 1, dispatches: 1 },
    'a mutating command keeps today\'s behaviour: one sweep and one dispatch pass, deadline or not');
});

test('G40-R3: the read path crosses the same health boundary as every other command', async () => {
  const fx = fixture();
  fx.coordinator._closed = true; // the admission state the boundary reads
  await assert.rejects(() => readCommand(fx), (error) => error?.code === 'coordinator_closed');
  assert.deepEqual(fx.counts, { sweeps: 0, dispatches: 0 }, 'a refused read sweeps nothing');
});
