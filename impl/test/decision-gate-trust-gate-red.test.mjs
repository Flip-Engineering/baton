// Decision-gate vs trust-gate red suite (live finding, decision-live-2026-07-22, issue #16
// live-acceptance wave): a worker that emits a BLOCKING decision request and then ends its
// provider turn has by definition not produced its final diff — the required-effect trust gate
// must NOT evaluate that partial result. The gate runs on the post-settlement continuation
// turn instead (deferral, never exemption).
//
// Live evidence: w-144 (decision-live wave) emitted decision.requested, the provider's result
// frame arrived as lifecycle.turn_completed {status:'completed'}, the gate threw
// required_effect_absent, and the run was killed with the decision superseded — before the
// driver could answer. Fixture pattern mirrors test/reflex1-decision-requests-red.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-decgate-'));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeBrief(overrides = {}) {
  return {
    goal: 'produce an in-scope diff after the settled decision',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
    requiredEffects: ['repository_edit'],
    ...overrides,
  };
}

function decisionRequestFields() {
  return {
    question: 'Which framing?',
    options: [
      { id: 'opt-a', label: 'Concise', summary: 'Three sentences' },
      { id: 'opt-b', label: 'Detailed', summary: null },
    ],
    allowFreeResponse: false,
    recommended: null,
    deadlineMs: 60_000,
  };
}

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key', concurrencyCeiling: Infinity, maxContext: 100000,
      verbs: { spawn: 'native', interrupt: 'native', answer: 'native', approve: 'native', kill: 'native' },
      decision: 'native',
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

function passingReferee() {
  return async (task) => ({
    reverified: true, observedExit: task.brief.verification.expectExit,
    matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
  });
}

function setup({ capture, adapter }) {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const worktrees = {
    create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
    capture,
    createVerifyWorktree: async () => ({ path: tmpdir() }),
    removeVerifyWorktree: async () => {},
    remove: async () => {},
    reconcile: async () => {},
  };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: adapter },
    worktrees,
    referee: passingReferee(),
    route: () => 'mock',
    now: () => 0,
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
  });
  return { dir, log, coordinator, worktrees };
}

async function flush(times = 20) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

test('DG1: a blocking decision request parks the task input_required and the required-effect trust gate does NOT evaluate the turn that merely ends', async () => {
  const adapter = new ScriptableAdapter();
  // Capture proves NO in-scope diff yet (the worker is parked awaiting settlement): sha equals
  // base and there are no changed paths — the exact evidence that kills a NORMAL completed turn.
  const { coordinator } = setup({
    adapter,
    capture: async () => ({ sha: 'sha-base', baseSha: 'sha-base', changedPaths: [] }),
  });
  const handle = await coordinator.spawn('mock', makeBrief());
  const requestId = 'dg1:decision:1';

  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'decision.requested', actor: 'worker',
    payload: { requestId, request: decisionRequestFields() },
  });
  await flush();
  assert.equal(coordinator.interactionStatus(requestId)?.state, 'pending');

  // The provider's result frame arrives as a plain completed turn — the emulated channel is
  // turn-ending by construction (claude-session.mjs _handleResult).
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output: 'gating on the decision before producing the diff' },
  });
  await flush(40);

  assert.equal(coordinator.interactionStatus(requestId)?.state, 'pending',
    'the pending decision must survive the turn that ends while it is unsettled');
  const task = coordinator._tasks.get(handle.taskId);
  assert.notEqual(task.status, 'failed',
    'required_effect_absent must not evaluate a result that is partial BY CONSTRUCTION');
  assert.equal(task.status, 'input_required',
    'the task stays parked awaiting settlement, never captured into the trust gate');
  assert.equal(adapter.calls.kill.length, 0, 'no kill: the gated worker is healthy');
});

test('DG2: after the settlement the continuation turn DOES face the trust gate (deferral, never exemption)', async () => {
  const adapter = new ScriptableAdapter();
  const { coordinator } = setup({
    adapter,
    capture: async () => ({ sha: 'sha-result', baseSha: 'sha-base', changedPaths: ['file-in-scope.txt'] }),
  });
  const handle = await coordinator.spawn('mock', makeBrief());
  const requestId = 'dg2:decision:1';

  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'decision.requested', actor: 'worker',
    payload: { requestId, request: decisionRequestFields() },
  });
  await flush();
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output: 'gating' },
  });
  await flush(40);
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'input_required');

  const settled = await coordinator.respond(requestId, { optionId: 'opt-a' });
  assert.equal(settled.ok, true);
  await flush();
  assert.equal(adapter.calls.answer.length, 1, 'the settlement is delivered to the worker');
  assert.equal(coordinator._tasks.get(handle.taskId).status, 'working',
    'delivery resumes the task');

  // The continuation turn produces the in-scope diff and ends completed — the gate MUST run.
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch: 2, kind: 'lifecycle.turn_completed', actor: 'worker',
    payload: { status: 'completed', output: 'diff produced as settled' },
  });
  await flush(60);
  const task = coordinator._tasks.get(handle.taskId);
  assert.ok(['verifying', 'completed'].includes(task.status),
    `the post-settlement completed turn reaches capture/verification (got ${task.status})`);
});

// ---------------------------------------------------------------------------
// DG3 (delivery-side half of the live finding, w-145): the deployment constructs
// ClaudeSessionCli with approvals:false (application-deployment.mjs builtInAdapters) and
// answer() used to early-return BEFORE the emulated decision branch — the settlement was
// refused as 'answer() unsupported', the record rolled back to pending, and the gated worker
// idled 29 minutes without ever receiving its DECISION_ANSWER frame. The emulated decision
// delivery is a plain user-turn continuation needing no approval authority, so it must
// succeed under approvals:false while the question/approval channel stays honestly refused.
// ---------------------------------------------------------------------------

import { fileURLToPath } from 'node:url';
import { ClaudeSessionCli } from '../src/claude-session.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));

test('DG3: emulated decision delivery succeeds under approvals:false (deployment construction); question answers stay refused', async () => {
  const cli = new ClaudeSessionCli({ cmd: process.execPath, args: [FAKE_CLAUDE], approvals: false });
  const events = [];
  cli.onEvent((e) => events.push(e));
  const worker = 'dg3-worker';
  const spawnAck = await cli.spawn(worker, {
    goal: 'gate on a decision', constraints: [], pathScope: ['src/**'],
    definitionOfDone: 'done', verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 5 },
  }, { worktree: process.cwd() });
  assert.equal(spawnAck.ok, true, `spawn must succeed with a worktree (got ${JSON.stringify(spawnAck)})`);
  const session = cli._sessions.get(worker);
  assert.ok(session, 'the spawn registered a session');

  // Let the fake's first turn COMPLETE (the live w-145 shape: the asking turn ended before the
  // orchestrator answered) — answering mid-turn is absorbed by the running turn with no new
  // turn_started, which is correct wire semantics, not the path under test.
  await new Promise((resolveWait, rejectWait) => {
    const timer = setTimeout(() => rejectWait(new Error(`first turn never completed; seen: ${events.map((e) => e.kind).join(',')}`)), 8_000);
    const poll = () => {
      if (events.some((e) => e.kind === 'lifecycle.turn_completed')) { clearTimeout(timer); resolveWait(); }
      else setImmediate(poll);
    };
    poll();
  });

  // The emulated decision branch must fire even though approvals are disabled: delivery is a
  // plain user-turn write (DECISION_ANSWER grammar), not an approval-channel operation.
  session.pendingDecisionRequestId = `${worker}:decision:1`;
  const turnsBefore = events.filter((e) => e.kind === 'lifecycle.turn_started').length;
  const ack = await cli.answer(worker, `${worker}:decision:1`, { optionId: 'detailed' });
  assert.equal(ack.ok, true, `decision delivery must succeed under approvals:false (got ${JSON.stringify(ack)})`);
  assert.equal(ack.emulated, true, 'the emulated mapping is always flagged (D1: no silent emulation)');
  assert.equal(session.pendingDecisionRequestId, null, 'the pending marker is consumed by delivery');
  const turnsAfter = events.filter((e) => e.kind === 'lifecycle.turn_started').length;
  assert.ok(turnsAfter > turnsBefore, 'the DECISION_ANSWER frame begins the worker\'s continuation turn');

  // The approvals gate still honestly refuses the approval/question channel.
  const refused = await cli.answer(worker, `${worker}:question:1`, { text: 'hello' });
  assert.equal(refused.ok, false);
  assert.match(refused.reason ?? '', /approvals:false/, 'the question channel keeps its approvals gate');

  await cli.kill(worker).catch(() => {});
});
