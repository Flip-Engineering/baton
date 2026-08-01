// Bidirectional ergonomics v2 — KERNEL-PROJECTION red suite (BD-1 / BD-2 / BD-4 / BD-5) PLUS the
// DRIVER-ERGONOMICS rows (BD-3 / BD-6 / BD-7 / BD-8).
//
// Binding contract: docs/reference/evidence/bidirectional-2026-07-31/bidirectional-decisions.md
// v2 rules 1-8. The kernel rows (1,2,4,5) drive the real application/coordinator stack; the
// driver rows (3,6,7,8) drive `createWaveDriver` — the real stack for the decision-callback
// lifecycle, and a deterministic fake wave facade (instrumented status/follow/answer, no live
// providers) for the wake laws, the reducer precedence, and the full outcome union.
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
import { bindBaton, createDriver, createWaveDriver, Coordinator } from '../src/index.mjs';
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

// ===========================================================================
// Driver-ergonomics rows (v2 rules 3, 6, 7, 8) — the wave driver consumes the
// landed kernel projections (claim on the turn_checkpoint entry, deadlineAt +
// decisionSettled tombstones) and never rebuilds them.
// ===========================================================================

// A real single-member wave over a decision-asking MockAdapter (claim completion): the run parks
// at input_required with an `answer_decision` attention item, then terminates once answered.
function realWaveKit(t, ask, label = 'w') {
  const repo = root('wave-repo');
  const logDir = root('wave-log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed', delayMs: 5, summary: 'decision turn',
      edits: [{ path: `reports/${label}.md`, content: 'work\n' }],
      ask,
    },
  });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'bidirectional-wave-red', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId, logDir,
    adapters: { mock: adapter },
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
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
    driver, repoId,
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId,
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
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo };
}

const waveMember = (role) => ({
  role, objective: `do the work (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'], report: `reports/${role}.md`,
});

const decisionAsk = (overrides = {}) => ({
  kind: 'decision', question: 'Which path?',
  options: [{ id: 'opt-a', label: 'A', summary: null }, { id: 'opt-b', label: 'B', summary: null }],
  allowFreeResponse: false, recommended: null, deadlineMs: 120_000, afterEditIndex: 0,
  ...overrides,
});

const DRIVER_POLICY = Object.freeze({
  preflight: false, steering: 'nudge-on-checkpoint',
  pollIntervalMs: 30, stallTimeoutMs: 800, hardCapMs: 20_000, settleTimeoutMs: 1_500,
  finalization: 'none', unproductiveNudgeBudget: 1, saltObjectives: false,
});

function settledEvents(driver, requestId) {
  return driver.coordinator._log.workers()
    .flatMap((worker) => driver.coordinator._log.read(worker))
    .filter((event) => event.kind === 'decision.settled' && event.payload?.requestId === requestId);
}

// ---------------------------------------------------------------------------
// BD-3 (real stack) — callback lifecycle: async awaited, fired exactly once,
// {optionId} resolves through run.answer (durable decision.settled).
// ---------------------------------------------------------------------------
test('BD-3 (callback lifecycle): async onDecision awaited, fired once, {optionId} resolves via run.answer with durable decision.settled', async (t) => {
  const kit = realWaveKit(t, decisionAsk());
  const calls = [];
  const receipt = await createWaveDriver(kit.baton, {
    // A generous stall budget: the post-answer turn/verify/rest must not be cut short by the stall
    // clock when the test host is under concurrent load (node runs test files in parallel).
    ...DRIVER_POLICY, stallTimeoutMs: 8_000, pollIntervalMs: 25,
    onDecision: async (payload) => {
      calls.push(payload);
      await new Promise((resolve) => setTimeout(resolve, 5)); // async: the driver must AWAIT this
      return { optionId: 'opt-a' };
    },
  }).run({ repoRoot: kit.repo, members: [waveMember('w')] });

  assert.equal(calls.length, 1, 'onDecision fires exactly once per (runId, requestId)');
  const payload = calls[0];
  assert.ok(typeof payload.requestId === 'string' && payload.requestId.length > 0);
  assert.equal(payload.question, 'Which path?');
  assert.equal(payload.options.length, 2);
  assert.equal(payload.allowFreeResponse, false);
  assert.ok(typeof payload.expiresInMs === 'number' && payload.expiresInMs > 0,
    'expiresInMs derived from the projected deadlineAt (never a local rebuild)');

  assert.equal(receipt.basis, 'completed', 'the answered worker continued to completion');
  assert.ok(Array.isArray(receipt.decisions));
  const decisionRow = receipt.decisions.find((row) => row.requestId === payload.requestId);
  assert.ok(decisionRow, 'the driver records one evidence line for the fired decision');
  assert.equal(decisionRow.outcome, 'applied', 'a delivered answer surfaces the coordinator result');

  assert.ok(settledEvents(kit.driver, payload.requestId).length >= 1,
    'durable decision.settled (the exact event name) proves the answer rode run.answer');
});

// BD-3 — undefined leaves attention-required; invalid return and a throw are recorded as evidence
// with the interaction still pending and the wave NEVER closed/superseded because a callback failed.
test('BD-3 (deferred / invalid / throw): a failed or absent callback answer never closes the wave, decision stays pending', async (t) => {
  const cases = [
    { name: 'deferred', ret: () => undefined, evidence: null, outcome: 'deferred' },
    { name: 'invalid', ret: () => ({ optionId: 'a', text: 'b' }), evidence: 'invalid_return', outcome: null },
    { name: 'throw', ret: () => { throw new Error('orchestrator boom'); }, evidence: 'callback_threw', outcome: null },
    { name: 'coordinator-refusal', ret: () => ({ optionId: 'not-an-option' }), evidence: null, outcome: 'invalid_answer' },
  ];
  for (const scenario of cases) {
    const kit = realWaveKit(t, decisionAsk(), scenario.name);
    let seen = null;
    const receipt = await createWaveDriver(kit.baton, {
      ...DRIVER_POLICY, stallTimeoutMs: 350,
      onDecision: async (payload) => { seen = payload; return scenario.ret(); },
    }).run({ repoRoot: kit.repo, members: [waveMember('w')] });

    assert.equal(receipt.basis, 'stall', `${scenario.name}: the wave never completed a pending decision`);
    assert.ok(seen, `${scenario.name}: onDecision fired`);
    const row = receipt.decisions.find((entry) => entry.requestId === seen.requestId);
    assert.ok(row, `${scenario.name}: an evidence line is recorded`);
    if (scenario.evidence) assert.equal(row.evidence, scenario.evidence);
    if (scenario.outcome) assert.equal(row.outcome, scenario.outcome);
    if (scenario.name !== 'coordinator-refusal') {
      // deferred/invalid/throw never call run.answer at all: no durable settlement.
      assert.equal(settledEvents(kit.driver, seen.requestId).length, 0,
        `${scenario.name}: the decision was never answered`);
    }
  }
});

// ---------------------------------------------------------------------------
// Deterministic fake wave facade (instrumented status/follow/answer, no live
// providers) for the wake laws, the reducer, and the full outcome union.
// ---------------------------------------------------------------------------

function delay(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
  });
}

function cancelledFollow() {
  return Object.assign(new Error('followOnce was cancelled'), { code: 'application_follow_cancelled' });
}

function fakeView(overrides = {}) {
  return {
    schemaVersion: 1, phase: 'working', terminal: false, cursor: 0,
    viewDigest: 'f'.repeat(64), attention: [], decisionSettled: [], ...overrides,
  };
}

const decAtt = (requestId, overrides = {}) => ({
  kind: 'answer_decision', workerId: 'wk', requestId,
  question: 'Which path?',
  options: [{ id: 'opt-a', label: 'A', summary: null }, { id: 'opt-b', label: 'B', summary: null }],
  allowFreeResponse: false, recommended: null, deadlineAt: null, ...overrides,
});
const qAtt = (requestId, overrides = {}) => ({ kind: 'answer_question', workerId: 'wk', requestId, question: 'q?', ...overrides });
const apAtt = (requestId, overrides = {}) => ({ kind: 'answer_approval', workerId: 'wk', requestId, approvalKind: 'publish', ...overrides });
const cpAtt = (requestId, overrides = {}) => ({
  kind: 'turn_checkpoint', workerId: 'wk', taskId: 't', turnEpoch: 1, changedPathsDigest: 'd0', requestId, ...overrides,
});

class FakeRun {
  constructor(id, program) {
    this.id = id;
    this._program = program;
    this._poll = -1;
    this.answerCalls = [];
    this.actCalls = [];
    this.followCalls = [];
  }

  async status() {
    this._poll += 1;
    return this._program.status(this._poll, this);
  }

  async act(action, inputs = {}) {
    this.actCalls.push({ action, inputs });
    return typeof this._program.act === 'function' ? this._program.act(action, inputs, this) : { ok: true };
  }

  async answer(requestId, answer) {
    this.answerCalls.push({ requestId, answer });
    if (typeof this._program.answer === 'function') return this._program.answer(requestId, answer, this);
    return { lastAction: { command: 'run.answer', requestId, result: 'applied' } };
  }

  async followOnce(options) {
    this.followCalls.push({ ...options });
    if (typeof this._program.follow === 'function') return this._program.follow(options, this);
    await delay(options.timeoutMs, options.signal);
    if (options.signal?.aborted) throw cancelledFollow();
    return { follow: { afterCursor: options.afterCursor, throughCursor: options.afterCursor, changes: [], hasMore: false, terminal: false, timedOut: true } };
  }
}

function fakeBaton(runs) {
  const wave = {
    runs,
    settle: async () => [...runs.keys()].map((role) => ({ role, outcome: 'settled' })),
    close: async () => ({ remainingCount: 0, residueUnknown: false }),
    evidence: () => ({ schemaVersion: 1, waveId: 'fake-wave', stops: [], outcomes: [], pumpDrained: true }),
  };
  return { waves: { start: async () => wave }, doctor: async () => ({ routes: [] }) };
}

function fakeWave(programsByRole) {
  const runs = new Map(Object.entries(programsByRole).map(([role, program]) => [role, new FakeRun(`run-${role}`, program)]));
  return { baton: fakeBaton(runs), runs, members: [...runs.keys()].map(waveMember) };
}

const terminalView = () => fakeView({ phase: 'succeeded', terminal: true });

// ---------------------------------------------------------------------------
// BD-3 (outcome union) — every branch of the ONE normalized driver outcome union.
// ---------------------------------------------------------------------------
test('BD-3 (outcome union): applied + each coordinator refusal + application_interaction_not_found are recorded, never a driver crash', async (t) => {
  void t;
  const results = {
    applied: 'applied', alreadyResolved: 'already_resolved', invalidAnswer: 'invalid_answer',
    staleDiscarded: 'stale_discarded', deliveryRefused: 'delivery_refused',
  };
  const programs = {};
  for (const [role, code] of Object.entries(results)) {
    programs[role] = {
      status: (poll) => (poll === 0 ? fakeView({ attention: [decAtt(`req-${role}`)] }) : terminalView()),
      answer: (requestId) => ({ lastAction: { command: 'run.answer', requestId, result: code } }),
    };
  }
  programs.notFound = {
    status: (poll) => (poll === 0 ? fakeView({ attention: [decAtt('req-notFound')] }) : terminalView()),
    answer: () => { throw Object.assign(new Error('gone'), { code: 'application_interaction_not_found' }); },
  };
  const wave = fakeWave(programs);
  const receipt = await createWaveDriver(wave.baton, {
    ...DRIVER_POLICY, pollIntervalMs: 20, onDecision: async () => ({ optionId: 'opt-a' }),
  }).run({ members: wave.members });

  assert.equal(receipt.basis, 'completed');
  const outcomeByRole = new Map(receipt.decisions.map((row) => [row.role, row.outcome]));
  assert.equal(outcomeByRole.get('applied'), 'applied');
  assert.equal(outcomeByRole.get('alreadyResolved'), 'already_resolved');
  assert.equal(outcomeByRole.get('invalidAnswer'), 'invalid_answer');
  assert.equal(outcomeByRole.get('staleDiscarded'), 'stale_discarded');
  assert.equal(outcomeByRole.get('deliveryRefused'), 'delivery_refused');
  assert.equal(outcomeByRole.get('notFound'), 'application_interaction_not_found',
    'an application exception is normalized into the outcome union, never a driver crash');
});

// ---------------------------------------------------------------------------
// BD-6 (wake laws)
// ---------------------------------------------------------------------------
test('BD-6 (wake): a target change wakes before pollIntervalMs; active-follow count returns to zero', async (t) => {
  void t;
  const wave = fakeWave({
    w: {
      status: (poll) => (poll === 0 ? fakeView({ cursor: 10 }) : terminalView()),
      follow: async (options) => {
        await delay(25, options.signal);
        if (options.signal?.aborted) throw cancelledFollow();
        return { follow: { afterCursor: options.afterCursor, throughCursor: options.afterCursor + 1,
          changes: [{ seq: options.afterCursor + 1, category: 'execution', kind: 'task.transitioned', summary: 'decision park' }],
          hasMore: false, terminal: false, timedOut: false } };
      },
    },
  });
  const waits = [];
  const receipt = await createWaveDriver(wave.baton, {
    ...DRIVER_POLICY, pollIntervalMs: 1_000, onWait: (info) => waits.push(info),
  }).run({ members: wave.members });

  assert.equal(receipt.basis, 'completed');
  const woke = waits.find((wait) => wait.wokeEarly);
  assert.ok(woke, 'a target change ends the sleep early');
  assert.ok(woke.elapsedMs < 1_000, `woke before the interval (elapsed ${woke.elapsedMs}ms)`);
  assert.ok(woke.peakFollows >= 1, 'a follow was actually raced');
  for (const wait of waits) {
    assert.equal(wait.activeFollows, 0, 'active-follow count returns to zero every cycle');
  }
});

test('BD-6 (no early wake): unrelated backlog advances the cursor but does not end the sleep; cursors are monotonic', async (t) => {
  void t;
  let terminalAfter = 3;
  const wave = fakeWave({
    w: {
      status: (poll) => (poll >= terminalAfter ? terminalView() : fakeView({ cursor: poll * 100 })),
      follow: async (options) => {
        await delay(12, options.signal);
        if (options.signal?.aborted) throw cancelledFollow();
        // Empty changes (sibling/unrelated traffic filtered out) but the page advances.
        return { follow: { afterCursor: options.afterCursor, throughCursor: options.afterCursor + 1,
          changes: [], hasMore: true, terminal: false, timedOut: false } };
      },
    },
  });
  const waits = [];
  const receipt = await createWaveDriver(wave.baton, {
    ...DRIVER_POLICY, pollIntervalMs: 180, onWait: (info) => waits.push(info),
  }).run({ members: wave.members });

  assert.equal(receipt.basis, 'completed');
  assert.ok(waits.length >= 1);
  let lastCursor = -1;
  for (const wait of waits) {
    assert.equal(wait.wokeEarly, false, 'unrelated backlog never ends the sleep early');
    assert.ok(wait.elapsedMs >= 150, `the sleep ran ~the full interval (elapsed ${wait.elapsedMs}ms)`);
    assert.equal(wait.activeFollows, 0);
    const cursor = wait.cursors.w;
    assert.ok(Number.isSafeInteger(cursor) && cursor >= lastCursor, 'cursors advance monotonically through throughCursor');
    lastCursor = cursor;
  }
  assert.ok(lastCursor > 0, 'the cursor advanced across empty pages');
});

test('BD-6 (downgrade + terminal exclusion): application_follow_unavailable downgrades once per member; terminal members are excluded', async (t) => {
  void t;
  const wave = fakeWave({
    live: {
      status: (poll) => (poll >= 2 ? terminalView() : fakeView({ cursor: 5 })),
      follow: async () => { throw Object.assign(new Error('follow disabled'), { code: 'application_follow_unavailable' }); },
    },
    done: {
      status: () => terminalView(), // terminal from the first poll — never eligible for a follow
    },
  });
  const receipt = await createWaveDriver(wave.baton, {
    ...DRIVER_POLICY, pollIntervalMs: 25,
  }).run({ members: wave.members });

  assert.equal(receipt.basis, 'completed');
  const downgrades = receipt.follows.filter((entry) => entry.role === 'live');
  assert.equal(downgrades.length, 1, 'exactly one downgrade evidence line per member (never retried in a loop)');
  assert.equal(downgrades[0].reason, 'application_follow_unavailable');
  assert.equal(wave.runs.get('live').followCalls.length, 1, 'the downgraded member is not followed again');
  assert.equal(wave.runs.get('done').followCalls.length, 0, 'a terminal member is excluded from follows');
});

// ---------------------------------------------------------------------------
// BD-7 (reducer precedence)
// ---------------------------------------------------------------------------
test('BD-7 (reducer): a checkpoint+decision member classifies decision and is NOT nudged or claimed; onDecision fires for the gated decision', async (t) => {
  void t;
  const wave = fakeWave({
    w: { status: (poll) => (poll === 0 ? fakeView({ attention: [cpAtt('cp-1', { claim: { status: 'completed', summary: null } }), decAtt('req-1')] }) : terminalView()) },
  });
  const classes = [];
  const calls = [];
  const receipt = await createWaveDriver(wave.baton, {
    ...DRIVER_POLICY, pollIntervalMs: 20, finalization: 'claim-on-stall',
    onProgress: (_line, meta) => classes.push(...meta.classes),
    onDecision: async (payload) => { calls.push(payload); return undefined; },
  }).run({ members: wave.members });

  assert.equal(receipt.basis, 'completed');
  assert.ok(classes.some(([role, cls]) => role === 'w' && cls === 'decision'),
    'a decision-parked member classifies decision, never bare working, even with a checkpoint present');
  assert.equal(calls.length, 1, 'onDecision fired for the gated decision');
  const member = wave.runs.get('w');
  assert.equal(member.actCalls.filter((call) => call.action === 'nudge_turn').length, 0, 'a blocked member is not nudged');
  assert.equal(member.actCalls.filter((call) => call.action === 'claim_turn').length, 0, 'a blocked member is not claimed');
  assert.equal(receipt.nudges.length, 0);
  assert.equal(receipt.claims.length, 0);
});

test('BD-7 (reducer): question and approval classify distinctly and never fire onDecision', async (t) => {
  void t;
  const wave = fakeWave({
    q: { status: (poll) => (poll === 0 ? fakeView({ attention: [qAtt('q-1')] }) : terminalView()) },
    a: { status: (poll) => (poll === 0 ? fakeView({ attention: [apAtt('a-1')] }) : terminalView()) },
  });
  const classes = [];
  const calls = [];
  await createWaveDriver(wave.baton, {
    ...DRIVER_POLICY, pollIntervalMs: 20,
    onProgress: (_line, meta) => classes.push(...meta.classes),
    onDecision: async (payload) => { calls.push(payload); return undefined; },
  }).run({ members: wave.members });

  assert.ok(classes.some(([role, cls]) => role === 'q' && cls === 'question'));
  assert.ok(classes.some(([role, cls]) => role === 'a' && cls === 'approval'));
  assert.equal(calls.length, 0, 'question/approval are not folded into decision and never fire onDecision');
});

test('BD-7 (reducer): multiple pending interactions surface in stable requestId order; only the gated one is decided', async (t) => {
  void t;
  const wave = fakeWave({
    // decision sorts first (r-a < r-b) → gated decision.
    first: { status: (poll) => (poll === 0 ? fakeView({ attention: [decAtt('r-a'), qAtt('r-b')] }) : terminalView()) },
    // question sorts first (r-x < r-y) → gated question; the decision waits and does NOT fire.
    second: { status: (poll) => (poll === 0 ? fakeView({ attention: [decAtt('r-y'), qAtt('r-x')] }) : terminalView()) },
  });
  const classes = [];
  const calls = [];
  await createWaveDriver(wave.baton, {
    ...DRIVER_POLICY, pollIntervalMs: 20,
    onProgress: (_line, meta) => classes.push(...meta.classes),
    onDecision: async (payload) => { calls.push(payload); return undefined; },
  }).run({ members: wave.members });

  assert.ok(classes.some(([role, cls]) => role === 'first' && cls === 'decision'));
  assert.ok(classes.some(([role, cls]) => role === 'second' && cls === 'question'));
  assert.deepEqual(calls.map((call) => call.requestId), ['r-a'],
    'only the gated (first-by-requestId) decision fires; a decision behind an earlier interaction waits');
});

test('BD-7 (claim-checkpoint): a claim-checkpoint with no interaction is claimed at the next poll WITHOUT waiting for the unproductive budget', async (t) => {
  void t;
  const wave = fakeWave({
    // Each re-park mints a fresh pauseId (as a real pausable worker does) but keeps the SAME
    // changedPathsDigest — an unproductive re-park carrying a completed claim.
    w: { status: (poll) => fakeView({ attention: [cpAtt(`cp-${Math.min(poll, 1)}`, { claim: { status: 'completed', summary: null }, changedPathsDigest: 'd0' })] }) },
  });
  const receipt = await createWaveDriver(wave.baton, {
    // Budget 5 would nudge five unproductive re-parks for a claim-ABSENT checkpoint; the claim
    // bypasses it and settles at the next poll.
    ...DRIVER_POLICY, pollIntervalMs: 20, stallTimeoutMs: 10_000,
    finalization: 'claim-on-stall', unproductiveNudgeBudget: 5,
  }).run({ members: wave.members });

  assert.equal(receipt.basis, 'completed');
  assert.equal(receipt.nudges.length, 1, 'the first sighting nudges once; the claim then bypasses the remaining budget');
  assert.equal(receipt.claims.length, 1);
  assert.equal(receipt.claims[0].code, 'claimed');
});

// ---------------------------------------------------------------------------
// BD-8 (no regression) — the treadmill still governs a CLAIM-ABSENT checkpoint;
// nudge dedup per requestId holds. (wave-driver-policy-red D1–D10 is the
// authoritative regression gate and stays green — see this suite's Verification.)
// ---------------------------------------------------------------------------
test('BD-8 (no regression): a claim-absent checkpoint still rides the unproductive budget to stall; nudge dedup per requestId holds', async (t) => {
  void t;
  const wave = fakeWave({
    // A single persistent pauseId (cp-1) across polls: the requestId dedup must nudge it exactly
    // once even though it is re-observed every poll; a claim-absent checkpoint then rides to stall.
    w: { status: () => fakeView({ attention: [cpAtt('cp-1', { changedPathsDigest: 'd0' })] }) }, // no claim
  });
  const receipt = await createWaveDriver(wave.baton, {
    ...DRIVER_POLICY, pollIntervalMs: 20, stallTimeoutMs: 300,
    finalization: 'none', unproductiveNudgeBudget: 1,
  }).run({ members: wave.members });

  assert.equal(receipt.basis, 'stall', 'a claim-absent checkpoint is not claimed — the treadmill judges it');
  assert.equal(receipt.nudges.length, 1, 'the pause is nudged exactly once (requestId dedup), then the budget stops nudging');
  assert.equal(receipt.claims.length, 0);
});
