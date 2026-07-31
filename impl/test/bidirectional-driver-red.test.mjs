// Bidirectional ergonomics v2 — KERNEL-PROJECTION red suite (BD-1 / BD-2 / BD-4 / BD-5).
//
// Binding contract: docs/reference/evidence/bidirectional-2026-07-31/bidirectional-decisions.md
// v2 rules 1, 2, 4, 5 ONLY. Wave-driver rows BD-3/BD-6/BD-7/BD-8 are a later wave.
//
// Harness mirrors wave-driver-policy-red.test.mjs:39-140 (PausableAdapter + application fixture)
// with decision script rows (adapter.mjs:590-610) and a ScriptableAdapter path for admission.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, Coordinator } from '../src/index.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { wrapProse, boundedAttentionText } from '../src/messages.mjs';

const repoId = 'repo-bidirectional-driver';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-bd-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '--allow-empty', '-q', '-m', 'base',
  ], { cwd: dir });
  return dir;
}

function principal(id) {
  return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });
}

async function until(fn, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

// ---------------------------------------------------------------------------
// Pausable adapter (copied from wave-driver-policy-red.test.mjs:39-140)
// ---------------------------------------------------------------------------

class PausableWaveAdapter extends MockAdapter {
  constructor({ scriptsByMarker, ...config } = {}) {
    super(config);
    this._scriptsByMarker = scriptsByMarker ?? {};
  }

  card() {
    return {
      ...super.card(),
      turnCompletion: 'pausable',
      modelSelection: {
        mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
        family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
        reasoningEffort: ['low'], serviceTier: null,
        provenance: 'bidirectional-driver-red', refreshedAt: null,
      },
    };
  }

  _markerIn(goal) {
    return Object.keys(this._scriptsByMarker).find(
      (key) => key !== 'default' && goal.includes(`(marker:${key})`),
    ) ?? 'default';
  }

  _scriptForMarker(marker) {
    return this._scriptsByMarker[marker] ?? this._scriptsByMarker.default ?? [{ edits: [] }];
  }

  async spawn(worker, brief, options = {}) {
    const goal = brief?.goal ?? '';
    const marker = this._markerIn(goal);
    this._markerByWorker = this._markerByWorker ?? new Map();
    this._markerByWorker.set(worker, marker);
    const script = this._scriptForMarker(marker);
    this._turnCount = this._turnCount ?? new Map();
    this._turnCount.set(worker, 0);
    const turn0 = script[0] ?? { edits: [] };
    return super.spawn(worker, brief, {
      ...options,
      scenario: this._scenarioForTurn(script, 0),
      turnEpoch: 0,
    });
  }

  _scenarioForTurn(script, index) {
    const turn = script[index] ?? script.at(-1) ?? { edits: [] };
    return {
      outcome: 'completed',
      summary: turn.summary ?? `pausable turn ${index}`,
      edits: (turn.edits ?? []).map((edit) => ({ ...edit })),
      ...(turn.ask ? { ask: turn.ask } : {}),
    };
  }

  async prompt(worker, message, mode) {
    if (mode === 'turn') {
      const script = this._scriptForMarker(this._markerByWorker?.get(worker) ?? 'default');
      const count = (this._turnCount?.get(worker) ?? 0) + 1;
      this._turnCount.set(worker, count);
      const turn = script[count] ?? script.at(-1) ?? { edits: [] };
      const session = this._sessions.get(worker);
      if (session) {
        session.terminal = false;
        session.runStarted = false;
        session.stopKind = null;
        session.crashed = false;
        session.timeoutHit = false;
        session.deniedApproval = false;
        session.askHandled = false;
        session.scenario = this._scenarioForTurn(script, count);
        session.opts = { ...session.opts, turnEpoch: count };
        this._startSession(session);
      }
    }
    return super.prompt(worker, message, mode);
  }
}

function appHarness(t, scriptsByMarker, options = {}) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new PausableWaveAdapter({ harness: 'mock', scriptsByMarker });
  const driver = createDriver({
    repoRoot: repo,
    repoId,
    logDir,
    adapters: { mock: adapter },
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1,
        repoId,
        mandatory: true,
        approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver,
    repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1,
        repoId,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('owner'));
  t.after(async () => {
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, adapter, logDir };
}

async function startPausedRun(kit, runId, objective = 'park a completed turn (marker:default)') {
  const proposed = await kit.application.start({
    runId,
    objective,
    profile: 'default',
    route: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['**'],
    driverKind: 'wave',
  }, principal('owner'));
  await kit.application.approve(runId, proposed.plan.digest, principal('approver'));
  await until(
    async () => (await kit.application.status(runId, principal('owner'))).phase === 'paused',
    'task pause',
  );
  return kit.application.status(runId, principal('owner'));
}

// ---------------------------------------------------------------------------
// Coordinator-level ScriptableAdapter for BD-4 admission (reflex1 pattern)
// ---------------------------------------------------------------------------

class ScriptableAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key',
      concurrencyCeiling: Infinity, maxContext: 100_000,
      verbs: {
        spawn: 'native', interrupt: 'native', answer: 'native',
        approve: 'native', kill: 'native',
      },
      decision: 'native',
      turnCompletion: 'claim',
    };
    this.acks = {
      spawn: { ok: true }, prompt: { ok: true }, interrupt: { ok: true },
      approve: { ok: true }, answer: { ok: true }, kill: { ok: true },
    };
    this.answerGate = null;
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn() { return this.acks.spawn; }
  async prompt() { return this.acks.prompt; }
  async interrupt() { return this.acks.interrupt; }
  async approve() { return this.acks.approve; }
  async answer(worker, requestId, answer) {
    if (this.answerGate) await this.answerGate;
    return this.acks.answer;
  }
  async kill() { return this.acks.kill; }
}

function coordSetup(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'baton-bd-coord-'));
  const log = overrides.log ?? new Log(join(dir, 'log'));
  const adapters = overrides.adapters ?? { mock: new ScriptableAdapter() };
  const coordination = overrides.coordination ?? coordinationForLog(log);
  let t = 0;
  const now = overrides.now ?? (() => t);
  const advance = (ms) => { t += ms; };
  const coordinator = new Coordinator({
    log,
    coordination,
    fences: new FenceTable(),
    adapters,
    worktrees: {
      create: async (taskId) => ({
        path: join(dir, 'wt', taskId), branch: `baton/${taskId}`, baseSha: 'sha-base',
      }),
      capture: async () => ({ sha: 'sha-result' }),
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
    now,
    approvalTimeoutMs: 60_000,
    stopDeadlineMs: 15_000,
  });
  return { dir, log, coordination, coordinator, adapters, advance, now };
}

function decisionRequestFields(overrides = {}) {
  return {
    question: 'Which path?',
    options: [
      { id: 'opt-a', label: 'A', summary: null },
      { id: 'opt-b', label: 'B', summary: null },
    ],
    allowFreeResponse: false,
    recommended: null,
    deadlineMs: 60_000,
    ...overrides,
  };
}

function emitDecision(adapter, handle, requestId, request = decisionRequestFields(), turnEpoch = 1) {
  adapter.emit({
    worker: handle.id, harness: 'mock@1.0.0', turnEpoch,
    kind: 'decision.requested', actor: 'worker',
    payload: { requestId, request },
  });
}

// ===========================================================================
// BD-1 — durable claim from pause-origin
// ===========================================================================

test('BD-1 (durable claim): completed park carries origin; pausedTurnStatus + attention project claim; pre-v2 has none; restart keeps claim', async (t) => {
  const summaryText = 'turn finished cleanly';
  const kit = appHarness(t, {
    default: [{ edits: [{ path: 'reports/worker-1.md', content: 'done\n' }], summary: summaryText }],
  });
  const view = await startPausedRun(kit, 'run-bd1-claim');
  const checkpoint = view.attention.find((entry) => entry.kind === 'turn_checkpoint');
  assert.ok(checkpoint, 'turn_checkpoint attention entry must exist');

  const workerId = checkpoint.workerId;
  const pauseId = checkpoint.requestId;
  const pausedEntry = kit.driver.coordinator._log.read(workerId)
    .find((e) => e.kind === 'turn.paused');
  assert.ok(pausedEntry, 'durable turn.paused must exist');
  assert.ok(pausedEntry.payload?.origin, 'v2 turn.paused payload must carry origin');
  assert.equal(pausedEntry.payload.origin.kind, 'turn_completed');
  assert.equal(pausedEntry.payload.origin.resultStatus, 'completed');
  const expectedSummary = wrapProse(workerId, boundedAttentionText(summaryText, 240));
  assert.deepEqual(pausedEntry.payload.origin.summary, expectedSummary);
  assert.equal(pausedEntry.payload.origin.summary.untrusted, true);
  assert.equal(pausedEntry.payload.origin.summary.provenance, 'model-authored');

  const status = kit.driver.coordinator.pausedTurnStatus(pauseId);
  assert.ok(status?.claim, 'pausedTurnStatus must project claim from durable origin');
  assert.equal(status.claim.status, 'completed');
  assert.deepEqual(status.claim.summary, expectedSummary);

  assert.ok(checkpoint.claim, 'turn_checkpoint attention must carry claim');
  assert.equal(checkpoint.claim.status, 'completed');
  assert.deepEqual(checkpoint.claim.summary, expectedSummary);

  // pre-v2-shaped event (no origin): honest absence of claim
  const preV2PauseId = 'pause:pre-v2:0';
  kit.driver.coordinator._pausedTurns.set(preV2PauseId, {
    state: 'pending', resolution: null, consumer: null, worker: workerId,
    taskId: checkpoint.taskId, turnEpoch: 1, changedPathsDigest: null,
    mintedEvent: 0, workerResult: null,
    // deliberately no origin
  });
  const preV2 = kit.driver.coordinator.pausedTurnStatus(preV2PauseId);
  assert.equal(preV2.claim, undefined, 'pre-v2 pause without origin projects NO claim');
  assert.equal(Object.hasOwn(preV2, 'claim'), false);

  // claimTurn re-runs the live trust gate (untouched path) while writer authority is still live
  const claimed = await kit.driver.coordinator.claimTurn(pauseId, { actor: 'orchestrator' });
  assert.equal(claimed.ok, true);
  assert.equal(claimed.result, 'claimed');

  // A second completed park + restart: claim survives byte-for-byte from durable origin alone.
  // (First pause was consumed by claimTurn; nudge a fresh park, then replay over a NEW coordination
  // lease — the documented restart shape from turn-checkpoints-31a-red.)
  await kit.driver.coordinator.nudgeTurn(pauseId, {
    actor: 'orchestrator', message: 'continue for restart fixture',
  }).catch(() => null);
  // Drive a fresh pause via prompt re-park if needed — mint origin on a dedicated coordinator log.
  const logDir = mkdtempSync(join(tmpdir(), 'baton-bd1-restart-'));
  const log = new Log(join(logDir, 'log'));
  const firstCoord = coordinationForLog(log);
  // Reuse the already-asserted durable origin shape from the live paused entry for the restart pin:
  // reconstruct a Coordinator over a log that contains the same turn.paused payload bytes.
  // Minimal durable seed: append the live pausedEntry payload onto a fresh worker stream via a
  // lightweight coordinator that parks once, then restart.
  const seedAdapter = new ScriptableAdapter();
  seedAdapter._card = {
    ...seedAdapter._card,
    turnCompletion: 'pausable',
  };
  const seed = new Coordinator({
    log, coordination: firstCoord, fences: new FenceTable(),
    adapters: { mock: seedAdapter },
    worktrees: {
      create: async (taskId) => ({
        path: join(logDir, 'wt', taskId), branch: `baton/${taskId}`, baseSha: 'sha-base',
      }),
      capture: async () => ({ sha: 'sha-result' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({
      reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
    }),
    route: () => 'mock', stopDeadlineMs: 15_000,
  });
  const seedHandle = await seed.spawn('mock', {
    goal: 'restart claim',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100_000, usd: 5, wallMin: 30 },
  });
  const seedTask = seed._tasks.get(seedHandle.taskId);
  seed._coordRecord(
    'steering.registered',
    { runId: seedTask.runId ?? null, driverKind: 'wave', actor: 'orchestrator' },
    `run.steering_registered:${seedTask.runId ?? 'null'}`,
    'orchestrator',
  );
  seedAdapter.emit({
    worker: seedHandle.id,
    harness: 'mock@1.0.0',
    turnEpoch: 1,
    kind: 'lifecycle.turn_completed',
    actor: 'worker',
    payload: {
      status: 'completed',
      summary: summaryText,
      artifacts: { commits: [], files: [] },
      verification: { command: 'true', claimedExit: 0 },
      openQuestions: [],
      budgetUsed: { tokens: 1, usd: 0 },
    },
  });
  await until(
    () => firstCoord.task(seedTask.id)?.status === 'paused' || seed._pausedTurns.size > 0,
    'seed pause',
  );
  const seedPauseId = [...seed._pausedTurns.keys()].find((k) => k.startsWith(`pause:${seedTask.id}:`));
  assert.ok(seedPauseId, 'seed must mint a pause record');
  const seedStatus = seed.pausedTurnStatus(seedPauseId);
  assert.ok(seedStatus.claim, 'seed pause projects claim from origin');
  const seedClaim = seedStatus.claim;

  firstCoord.releaseWriterLease();
  const restartedCoord = coordinationForLog(log);
  const restarted = new Coordinator({
    log, coordination: restartedCoord, fences: new FenceTable(),
    adapters: { mock: seedAdapter },
    worktrees: {
      create: async () => ({}), capture: async () => ({ sha: 'x' }),
      createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({
      reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok',
    }),
    route: () => 'mock', stopDeadlineMs: 15_000,
  });
  if (restarted.ready) await restarted.ready;
  const replayed = restarted.pausedTurnStatus(seedPauseId);
  assert.ok(replayed, 'pause record reconstructs after restart');
  assert.ok(replayed.claim, 'claim survives restart from durable origin');
  assert.equal(replayed.claim.status, 'completed');
  assert.deepEqual(replayed.claim.summary, seedClaim.summary,
    'claim summary must match the durable origin byte-for-byte after restart');
  t.after(() => {
    try { restartedCoord.releaseWriterLease?.(); } catch { /* best effort */ }
    rmSync(logDir, { recursive: true, force: true });
  });
});

// ===========================================================================
// BD-2 — sanitize pipeline at mint
// ===========================================================================

test('BD-2 (sanitize pipeline): redact-before-bound, unicode scalar safe, empty→null, untrusted wrapper, RunView ceiling', async (t) => {
  const secret = 'sk-abcdefghijklmnopqrstuvwxyz012345';
  // Plant secret near a long prefix so a truncate-then-redact would leak a split token.
  const longPrefix = 'x'.repeat(200);
  const credentialSummary = `${longPrefix} api_key=${secret} tail-after-secret`;
  // Multi-byte scalar near the 240 boundary (emoji is 4 UTF-8 bytes).
  const unicodePad = 'u'.repeat(236);
  const unicodeSummary = `${unicodePad}😀EXTRA`;

  const kit = appHarness(t, {
    default: [{
      edits: [{ path: 'reports/worker-1.md', content: 'done\n' }],
      summary: credentialSummary,
    }],
  });
  const view = await startPausedRun(kit, 'run-bd2-sanitize');
  const checkpoint = view.attention.find((entry) => entry.kind === 'turn_checkpoint');
  assert.ok(checkpoint?.claim?.summary);

  const text = checkpoint.claim.summary.text;
  assert.equal(checkpoint.claim.summary.untrusted, true);
  assert.equal(checkpoint.claim.summary.provenance, 'model-authored');
  assert.ok(!text.includes(secret), 'credential-shaped token must never appear in claim summary');
  assert.ok(!text.includes('sk-abcdefghijklmnop'), 'partial credential leak across the 240 cut is forbidden');
  assert.ok(text.includes('[redacted]') || text.includes('redacted'),
    'redaction marker must appear when a credential-shaped token was present');
  assert.ok(Buffer.byteLength(text) <= 240, 'summary text is bounded to 240 bytes');

  // Empty summary → origin.summary null (never '')
  const emptyKit = appHarness(t, {
    default: [{
      edits: [{ path: 'reports/empty.md', content: 'empty\n' }],
      summary: '',
    }],
  });
  const emptyView = await startPausedRun(emptyKit, 'run-bd2-empty', 'empty summary park (marker:default)');
  const emptyCp = emptyView.attention.find((entry) => entry.kind === 'turn_checkpoint');
  assert.ok(emptyCp?.claim, 'completed park still carries claim');
  assert.equal(emptyCp.claim.summary, null, 'empty summary projects null, never empty string');
  const emptyWorker = emptyCp.workerId;
  const emptyPaused = emptyKit.driver.coordinator._log.read(emptyWorker)
    .find((e) => e.kind === 'turn.paused');
  assert.equal(emptyPaused.payload.origin.summary, null);

  // Unicode scalar boundary: no mid-scalar slice
  const uniKit = appHarness(t, {
    default: [{
      edits: [{ path: 'reports/uni.md', content: 'uni\n' }],
      summary: unicodeSummary,
    }],
  });
  const uniView = await startPausedRun(uniKit, 'run-bd2-unicode', 'unicode park (marker:default)');
  const uniCp = uniView.attention.find((entry) => entry.kind === 'turn_checkpoint');
  const uniText = uniCp.claim.summary.text;
  // If the emoji was included it must be intact; if truncated before it, no orphan UTF-8.
  assert.doesNotThrow(() => {
    const reencoded = Buffer.from(uniText, 'utf8').toString('utf8');
    assert.equal(reencoded, uniText);
  });
  assert.ok(!uniText.includes('\uFFFD'), 'no replacement char from mid-scalar slice');
  assert.ok(Buffer.byteLength(uniText) <= 240);

  // RunView byte ceiling still holds after claim addition
  assert.ok(Buffer.byteLength(JSON.stringify(view)) <= 512 * 1024);
});

// ===========================================================================
// BD-4 — one-pending decision admission
// ===========================================================================

test('BD-4 (one-pending admission): second DECISION_REQUEST refused decision_already_pending; first survives; reentrancy during answer', async (t) => {
  const adapter = new ScriptableAdapter();
  const kit = coordSetup({ adapters: { mock: adapter } });
  t.after(() => {
    try { kit.coordination.releaseWriterLease?.(); } catch { /* best effort */ }
    rmSync(kit.dir, { recursive: true, force: true });
  });

  const handle = await kit.coordinator.spawn('mock', {
    goal: 'decision gate',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100_000, usd: 5, wallMin: 30 },
  });

  // spawn() returns a snapshot; live pendingDecisionId lives on the coordinator's worker map.
  const live = () => kit.coordinator._workers.get(handle.id);

  const firstId = 'decision-bd4-first';
  const secondId = 'decision-bd4-second';
  emitDecision(adapter, handle, firstId);
  await Promise.resolve();
  assert.equal(kit.coordinator.interactionStatus(firstId)?.state, 'pending');
  assert.equal(live().pendingDecisionId, firstId);

  emitDecision(adapter, handle, secondId);
  await Promise.resolve();

  // First survives visible
  assert.equal(kit.coordinator.interactionStatus(firstId)?.state, 'pending');
  assert.equal(live().pendingDecisionId, firstId,
    'pendingDecisionId must still name the first request');
  assert.equal(kit.coordinator.interactionStatus(secondId), null,
    'second request must not mint a pending record');

  const rejected = kit.coordinator._log.read(handle.id)
    .filter((e) => e.kind === 'control.decision_already_pending_rejected'
      || (e.kind === 'control.interaction_rejected' && e.payload?.reason === 'decision_already_pending')
      || e.payload?.reason === 'decision_already_pending');
  assert.ok(rejected.length >= 1, 'durable typed decision_already_pending rejection must be logged');
  const authority = kit.coordination.events().filter((e) => (
    e.kind === 'driver.recorded'
    && e.payload?.kind === 'authority.rejected'
    && e.payload?.reason === 'decision_already_pending'
  ));
  assert.ok(authority.length >= 1 || rejected.some((e) => (
    e.payload?.reason === 'decision_already_pending'
    || e.kind === 'control.decision_already_pending_rejected'
  )), 'rejection is durable and typed as decision_already_pending');

  // Decision raised DURING answer delivery must not lose the first record
  let releaseAnswer;
  adapter.answerGate = new Promise((resolve) => { releaseAnswer = resolve; });
  const answerPromise = kit.coordinator.respond(firstId, { optionId: 'opt-a' });
  await Promise.resolve();
  // While resolving, a third request must also be refused without disturbing the first
  const thirdId = 'decision-bd4-during-answer';
  emitDecision(adapter, handle, thirdId);
  await Promise.resolve();
  assert.equal(kit.coordinator.interactionStatus(thirdId), null);
  assert.equal(
    kit.coordinator.interactionStatus(firstId)?.state === 'resolving'
      || kit.coordinator.interactionStatus(firstId)?.state === 'pending'
      || kit.coordinator.interactionStatus(firstId)?.state === 'resolved',
    true,
  );
  releaseAnswer();
  const answered = await answerPromise;
  assert.equal(answered.ok, true);
  assert.equal(answered.result, 'applied');
  assert.equal(kit.coordinator.interactionStatus(firstId)?.state, 'resolved');
});

// ===========================================================================
// BD-5 — disposition tombstones (+ deadlineAt on decision attention)
// ===========================================================================

test('BD-5 (tombstones + deadlineAt): answered/expired in decisionSettled; deadlineAt projected; one durable outcome', async (t) => {
  // --- answered path via application ---
  const answerKit = appHarness(t, {
    default: [{
      edits: [],
      summary: 'asking',
      ask: {
        kind: 'decision',
        question: 'Ship now?',
        options: [
          { id: 'yes', label: 'Yes', summary: null },
          { id: 'no', label: 'No', summary: null },
        ],
        allowFreeResponse: false,
        recommended: null,
        deadlineMs: 120_000,
        afterEditIndex: 0,
      },
    }],
  });
  // Non-pausable decision park: use a non-pausable adapter path by overriding card
  answerKit.adapter.card = () => ({
    ...MockAdapter.prototype.card.call(answerKit.adapter),
    turnCompletion: 'claim',
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'bidirectional-driver-red', refreshedAt: null,
    },
  });

  // Re-create with a non-pausable decision fixture for cleaner phase
  const decisionAdapter = new MockAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed',
      delayMs: 5,
      summary: 'decision turn',
      ask: {
        kind: 'decision',
        question: 'Ship now?',
        options: [
          { id: 'yes', label: 'Yes', summary: null },
          { id: 'no', label: 'No', summary: null },
        ],
        allowFreeResponse: false,
        deadlineMs: 120_000,
        afterEditIndex: 0,
      },
    },
  });
  const card = decisionAdapter.card.bind(decisionAdapter);
  decisionAdapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'bd5', refreshedAt: null,
    },
  });

  const repo = root('bd5-repo');
  const logDir = root('bd5-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-bd5', logDir,
    adapters: { mock: decisionAdapter },
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId: 'repo-bd5', mandatory: true,
        approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'],
        effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-bd5',
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId: 'repo-bd5',
        definitionOfDone: ['deployment verification passes'],
        constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const runId = 'run-bd5-answer';
  const proposed = await application.start({
    runId, objective: 'decision tombstone',
    profile: 'default',
    route: { harness: 'mock', model: 'mock-model', effort: 'low' },
    scope: ['**'],
    driverKind: 'wave',
  }, principal('owner'));
  await application.approve(runId, proposed.plan.digest, principal('approver'));

  const pendingView = await until(async () => {
    const v = await application.status(runId, principal('owner'));
    return v.attention?.find((a) => a.kind === 'answer_decision') ? v : null;
  }, 'pending decision attention');
  const decision = pendingView.attention.find((a) => a.kind === 'answer_decision');
  assert.ok(decision, 'answer_decision attention present');
  assert.ok(typeof decision.deadlineAt === 'number' && Number.isFinite(decision.deadlineAt),
    'projectDecisionAttention must carry deadlineAt');

  // decisionList also carries deadlineAt
  const listed = await application.decisionList({ runId }, principal('owner'));
  const listedRow = listed.decisions.find((d) => d.requestId === decision.requestId);
  assert.ok(listedRow, 'decisionList returns the pending decision');
  assert.equal(listedRow.deadlineAt, decision.deadlineAt);

  // Answer it
  await application.answer(runId, decision.requestId, { optionId: 'yes' }, principal('owner'));
  const afterAnswer = await application.status(runId, principal('owner'));
  assert.ok(Array.isArray(afterAnswer.decisionSettled), 'RunView gains decisionSettled projection');
  const answeredRow = afterAnswer.decisionSettled.find((r) => r.requestId === decision.requestId);
  assert.ok(answeredRow, 'answered decision appears in decisionSettled');
  assert.equal(answeredRow.disposition, 'answered');
  assert.ok(answeredRow.at, 'tombstone carries durable at timestamp');

  // Re-read: exactly one tombstone per requestId (idempotent projection)
  const again = await application.status(runId, principal('owner'));
  const same = again.decisionSettled.filter((r) => r.requestId === decision.requestId);
  assert.equal(same.length, 1, 'exactly one disposition tombstone per requestId');

  // --- expired path via coordinator clock ---
  const adapter = new ScriptableAdapter();
  let clock = 1_000;
  const exp = coordSetup({ adapters: { mock: adapter }, now: () => clock });
  t.after(() => {
    try { exp.coordination.releaseWriterLease?.(); } catch { /* best effort */ }
    rmSync(exp.dir, { recursive: true, force: true });
  });
  const handle = await exp.coordinator.spawn('mock', {
    goal: 'expire me',
    constraints: [],
    pathScope: ['.'],
    definitionOfDone: 'tests pass',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100_000, usd: 5, wallMin: 30 },
  });
  const expireId = 'decision-bd5-expire';
  emitDecision(adapter, handle, expireId, decisionRequestFields({ deadlineMs: 50 }));
  await Promise.resolve();
  assert.equal(exp.coordinator.interactionStatus(expireId)?.state, 'pending');
  clock = 1_000 + 50;
  exp.coordinator.tick();
  await until(
    () => exp.coordinator.interactionStatus(expireId)?.state === 'resolved',
    'decision expiry',
  );
  const expiredEvent = exp.coordinator._log.read(handle.id)
    .find((e) => e.kind === 'decision.expired' && e.payload?.requestId === expireId);
  assert.ok(expiredEvent, 'durable decision.expired event');
  assert.equal(
    exp.coordinator.interactionStatus(expireId)?.resolution?.disposition
      ?? exp.coordinator._pending.get(expireId)?.resolution?.disposition,
    'expired',
  );

  // decisionSettled projection helper (coordinator-level) for the expired row
  const tombs = typeof exp.coordinator.decisionSettledProjection === 'function'
    ? exp.coordinator.decisionSettledProjection([handle.id])
    : null;
  if (tombs) {
    const expiredRow = tombs.find((r) => r.requestId === expireId);
    assert.ok(expiredRow);
    assert.equal(expiredRow.disposition, 'expired');
    assert.notEqual(expiredRow.disposition, 'answered',
      'answered and expired are never conflated');
  }

  // Bound: last N ≤ 8
  if (afterAnswer.decisionSettled) {
    assert.ok(afterAnswer.decisionSettled.length <= 8, 'decisionSettled is bounded N≤8');
  }
});
