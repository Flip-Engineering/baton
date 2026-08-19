// ROW-CADENCE pins (#163 follow-ons, the row-cadence row — wave-f). Binding contract:
// docs/reference/evidence/no-clock-followons-2026-08-15/wave-f/row-cadence-brief.md.
//
//   P1 — leg-b activity honesty: the per-member liveness/progress classification takes
//        lastActivityAt from ANY member-originated evidence event (tool calls included),
//        not only checkpoints/messages. A tool-call-only member (content.tool_call
//        evidence, NO checkpoints) must never classify 'silent' while its events advance.
//   P2 — settleTimeoutMs is pacing-only: it must never appear on any terminal/basis path.
//   P3 — every member stop the driver issues carries its DECISION basis (verdict + the
//        signal that fired it) on the stop outline — 'Wave driver settled.' is never the
//        reason a member sees (the ledger row must not carry the opaque digest of that
//        constant string).
//   P4 — the drive loop never classifies a member terminal on a signal other than member
//        evidence: a wave-level stall (no crash, no close, no cadence breach — the
//        12s-brief-to-stop red case mirror) stops the member with basis 'stall' named on
//        the stop, never a member-terminal claim.
//   P5 — an operator abort never fabricates member terminality: the mid-turn member stays
//        non-terminal in the record and the stop names basis 'aborted'.
//
// Harness mirrors wave-driver-policy-red.test.mjs:54-124 (PausableWaveAdapter with the
// checkpoint conjunction) plus the quiescence-activity fixture (application-level
// content.tool_call injection through the adapter's real event lane) for P1.
// Clocks: every wave-driver timing parameter is a short RELATIVE timeout; the P1 fixture
// uses real Date.now() with an injected event timestamp — no test hardcodes a future date
// (fixture-clock-lint clean).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, createWaveDriver } from '../src/index.mjs';

const repoId = 'repo-row-cadence';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
// The store's own canonical digest discipline (application.mjs:273-275) — the exact shape the
// ledger `reasonDigest` uses, so the pin can compare member-facing digests byte-for-byte.
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

const root = (label) => {
  const dir = mkdtempSync(join(tmpdir(), `baton-row-cad-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
};

const principal = (id) => Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` });

// A MockAdapter whose card declares `turnCompletion: 'pausable'` and whose turns are SCRIPTED per
// member marker (the wave-driver-policy-red harness idiom, verbatim semantics): a finite
// productive prefix followed by an unproductive tail; `delayMs` keeps a member mid-turn so it
// never parks a checkpoint during the test window.
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
        provenance: 'row-cadence-red', refreshedAt: null,
      },
    };
  }

  _markerIn(goal) {
    return Object.keys(this._scriptsByMarker).find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
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
      summary: `pausable turn ${index}`,
      edits: (turn.edits ?? []).map((edit) => ({ ...edit })),
      delayMs: turn.delayMs,
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

// The driver-wave harness (wave-driver-policy-red idiom): a real createDriver +
// BatonApplication stack over the pausable adapter, with the worker watchdog neutralized so
// timer writes never flap the cursor-stripped stall marker.
function driverHarness(t, scriptsByMarker, options = {}) {
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
    defaults: { profile: 'default', route: null },
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
  return { application, baton, driver, repo, adapter };
}

const member = (role, objective, options = {}) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'],
  report: `reports/${role}.md`,
  ...options,
});

const edit = (role, turn, content = `${role} turn ${turn}\n`) => ({
  path: `reports/${role}-${turn}.md`, content,
});

// Fast policy defaults: short relative timeouts, real clock (fixture-clock-lint clean).
const FAST = Object.freeze({
  steering: 'nudge-on-checkpoint',
  pollIntervalMs: 15,
  stallTimeoutMs: 400,
  settleTimeoutMs: 1_500,
  finalization: 'none',
  unproductiveNudgeBudget: 1,
  saltObjectives: true,
  preflight: false,
});

// The wave member run ids from the goal-plan snapshot (the salted objective carries the marker).
function memberRunIds(driver, role) {
  const goals = driver.coordination.snapshot().goalPlan?.goals ?? [];
  return goals
    .filter((goal) => goal.runId !== null && typeof goal.objective === 'string'
      && goal.objective.includes(`(marker:${role})`))
    .map((goal) => goal.runId);
}

// ---------------------------------------------------------------------------
// P1 — leg-b activity honesty: a tool-call-only member (content.tool_call evidence, NO
// checkpoints, NO messages) classifies NON-silent while its events advance. The store
// projection (application.mjs _progressTiming — lastProgress.at takes semantic-meaningful
// UNION content-liveness evidence) carries this; the pin guards the classification the
// quiescence predicate folds (workflow-interpreter readView → progressClass).
// ---------------------------------------------------------------------------
function activityHarness(t) {
  const repo = root('activity-repo');
  const logDir = root('activity-log');
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  // An adapter that stays working (long delay — the member never completes during the pin)
  // and emits a content.tool_call observation mid-turn via the real event lane.
  const worker = new MockAdapter({ harness: 'worker', scenario: { outcome: 'completed', delayMs: 60_000 } });
  const card = worker.card.bind(worker);
  worker.card = () => ({ ...card(), modelSelection: { mode: 'exact', configuredDefault: 'm', available: ['m'], family: 'f', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } });
  const realOnEvent = worker.onEvent.bind(worker);
  let registeredCb = null;
  worker.onEvent = (fn) => { registeredCb = fn; return realOnEvent(fn); };
  globalThis.__rowCadenceInjectToolCall = (workerId) => registeredCb?.({
    worker: workerId, harness: 'worker', turnEpoch: 1, actor: 'worker',
    kind: 'content.tool_call', payload: { phase: 'start', tool: 'bash' },
  });

  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-row-cadence-activity', logDir, now: () => Date.now(),
    adapters: { worker },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId: 'repo-row-cadence-activity', mandatory: true, approvalTtlMs: 3_600_000,
        riskClasses: ['low'], effectClasses: ['repository_edit'], capabilityClasses: ['code'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
    stopDeadlineMs: 1_000,
  });

  const application = new BatonApplication({
    driver, repoId: 'repo-row-cadence-activity',
    profiles: {
      plain: {
        schemaVersion: 1, repoId: 'repo-row-cadence-activity',
        definitionOfDone: ['verification passes'], constraints: [], risk: 'low',
        goalBudget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 },
        nodeBudget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 },
        pathScope: ['**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 16 * 1024, requiredPredecessorEvidence: [] },
        routes: [{ harness: 'worker', model: 'm', effort: 'low' }],
        capabilities: ['code'], effects: ['repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
        integrationPolicy: { mode: 'none', strategies: [], requireAdoptedResult: false, requireSemanticReview: false },
      },
    },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true,
  });
  return { application, driver, repo, logDir };
}

test('ROW-CADENCE P1: a tool-call-only member (no checkpoints) classifies NON-silent while its events advance', async (t) => {
  const { application, logDir } = activityHarness(t);
  try {
    const runId = 'run-row-cadence-1';
    const proposed = await application.command('run.start', { intent: {
      runId, objective: 'row-cadence activity pin', route: { harness: 'worker', model: 'm', effort: 'low' },
    } }, principal('owner'));
    await application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));
    await new Promise((r) => setTimeout(r, 100));
    // The member is working (60s delay) with NO checkpoint and NO message — inject ONLY
    // content.tool_call observations through the real event lane (exactly what a live
    // provider tool execution surfaces).
    globalThis.__rowCadenceInjectToolCall?.('w-1');
    await new Promise((r) => setTimeout(r, 150));
    let lastToolCallTs = null;
    try {
      for (const l of readFileSync(join(logDir, 'coordination', 'events.jsonl'), 'utf8').trim().split('\n')) {
        try {
          const e = JSON.parse(l);
          if (e.kind === 'evidence.mapped' && e.payload?.kind === 'content.tool_call' && e.ts > (lastToolCallTs ?? '')) lastToolCallTs = e.ts;
        } catch { /* skip malformed rows */ }
      }
    } catch { /* coordination events absent */ }
    const inspect = await application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
    const outline = inspect?.outline ?? inspect ?? {};
    const progressClass = outline.progressClass ?? null;
    assert.ok(progressClass, 'the outline carries the progressClass projection (the classification the quiescence predicate folds)');
    assert.ok(lastToolCallTs, 'the fixture emitted a content.tool_call event');
    assert.notEqual(progressClass.class, 'silent',
      `a tool-call-only member never classifies 'silent' while its events advance (class=${progressClass.class})`);
    assert.equal(progressClass.class, 'progressing',
      'the member reads as progressing — the ONLY non-terminal, non-blocked leaf the reducer can land on');
    assert.ok(progressClass.meaningfulEventAt && Date.parse(progressClass.meaningfulEventAt) >= Date.parse(lastToolCallTs),
      `the classification's basis (meaningfulEventAt ${progressClass.meaningfulEventAt}) is >= the last tool_call (${lastToolCallTs}) — tool-call liveness IS the classification source`);
  } finally {
    await application.close?.();
  }
});

// ---------------------------------------------------------------------------
// P2 — settleTimeoutMs is pacing-only: it must never appear on any terminal/basis path.
// The audit: wave-driver.mjs uses settleTimeoutMs EXACTLY three times — the DEFAULT_POLICY
// default, the freezePolicy validation, and the forward to wave.settle (a join/pacing wait
// that never terminates fate). No basis assignment may read it.
// ---------------------------------------------------------------------------
test('ROW-CADENCE P2: settleTimeoutMs is pacing-only — it never produces a terminal basis', () => {
  const src = readFileSync(new URL('../src/wave-driver.mjs', import.meta.url), 'utf8');
  const lines = src.split('\n');
  const settleLines = [];
  lines.forEach((line, index) => {
    if (line.includes('settleTimeoutMs')) settleLines.push({ line: index + 1, text: line.trim() });
  });
  assert.equal(settleLines.length, 3,
    `settleTimeoutMs appears exactly as (1) the DEFAULT_POLICY default, (2) the freezePolicy validation, (3) the wave.settle forward — got ${JSON.stringify(settleLines)}`);
  for (const entry of settleLines) {
    assert.ok(!/basis|terminal/.test(entry.text),
      `a settleTimeoutMs use never rides a basis/terminal path (line ${entry.line}: ${entry.text})`);
  }
  const basisAssigns = lines
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => /basis\s*=/.test(text));
  assert.ok(basisAssigns.length >= 3, 'the drive loop has basis assignments to audit');
  for (const entry of basisAssigns) {
    assert.ok(!entry.text.includes('settleTimeoutMs'),
      `no basis assignment reads settleTimeoutMs (line ${entry.line}: ${entry.text.trim()}) — the settle window never decides fate`);
  }
  const settleForward = settleLines.find((entry) => entry.text.includes('wave.settle'));
  assert.ok(settleForward, 'the ONLY runtime use of settleTimeoutMs is the wave.settle pacing forward');
});

// ---------------------------------------------------------------------------
// P3 — every member stop the driver issues carries its DECISION basis (verdict + the signal
// that fired it) on the stop outline. The ledger row's reasonDigest must be the digest of
// the basis-bearing reason, never the opaque digest of the constant 'Wave driver settled.'
// ---------------------------------------------------------------------------
test('ROW-CADENCE P3: a completing wave stops members with the decision basis on the stop outline', async (t) => {
  const { baton, repo, driver } = driverHarness(t, { default: [{ edits: [edit('worker', 1)] }] });
  const receipt = await createWaveDriver(baton, {
    ...FAST, unproductiveNudgeBudget: 0, finalization: 'claim-on-stall',
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'completed');
  assert.equal(typeof receipt.closeReason, 'string',
    'the driver receipt discloses the close reason it put on every member stop');
  assert.notEqual(receipt.closeReason, 'Wave driver settled.',
    "'Wave driver settled.' alone is never the member-facing stop reason");
  assert.match(receipt.closeReason, /basis: completed/,
    'the stop outline carries the verdict');
  assert.match(receipt.closeReason, /signal: /,
    'the stop outline carries the signal that fired the verdict');

  const runIds = memberRunIds(driver, 'worker');
  assert.ok(runIds.length >= 1, 'the member run is present on the goal-plan snapshot');
  const stopRow = driver.coordination.runStop(runIds[0]);
  assert.ok(stopRow, 'the member stop is admitted on the ledger');
  assert.notEqual(stopRow.reasonDigest, digest('Wave driver settled.'),
    'the ledger row never carries the opaque digest of the constant string (the measured red fact)');
  assert.equal(stopRow.reasonDigest, digest(receipt.closeReason),
    'the member-facing ledger reasonDigest matches the disclosed basis-bearing reason');
});

// ---------------------------------------------------------------------------
// P4 — the drive loop never classifies a member terminal on a signal other than member
// evidence. The wave-level stall (a mid-turn member: no crash, no close, no cadence breach)
// stops the member with basis 'stall' NAMED on the stop — never a member-terminal claim.
// ---------------------------------------------------------------------------
test('ROW-CADENCE P4: a wave-level stall never classifies a member terminal — the stop names basis stall', async (t) => {
  // The red-case mirror: a member mid-turn (60s delay — no checkpoint, no crash, no close),
  // view byte-static (no content events), steering off — the wave-level stall clock fires.
  const { baton, repo, driver } = driverHarness(t, { default: [{ edits: [], delayMs: 60_000 }] });
  const receipt = await createWaveDriver(baton, {
    ...FAST, steering: 'none', stallTimeoutMs: 250, finalization: 'none',
  }).run({ repoRoot: repo, members: [member('worker', 'long-running report')] });
  assert.equal(receipt.basis, 'stall', 'the wave-level stall clock fired (no member evidence advanced)');
  const outcome = receipt.outcomes.find((entry) => entry.role === 'worker');
  assert.ok(outcome, 'the member outcome is present');
  assert.equal(outcome.terminal, false,
    'the drive loop never classifies the member terminal on the wave-level signal — member evidence showed none');
  assert.equal(typeof receipt.closeReason, 'string');
  assert.match(receipt.closeReason, /basis: stall/,
    'the stop names the wave-level basis, never a member-terminal claim');
  const runIds = memberRunIds(driver, 'worker');
  const stopRow = driver.coordination.runStop(runIds[0]);
  assert.ok(stopRow, 'the member stop is admitted on the ledger');
  assert.equal(stopRow.reasonDigest, digest(receipt.closeReason),
    'the member-facing ledger reasonDigest matches the disclosed basis-bearing reason');
  assert.notEqual(stopRow.reasonDigest, digest('Wave driver settled.'),
    'never the opaque digest of the constant string');
});

// ---------------------------------------------------------------------------
// P5 — an operator abort never fabricates member terminality: the mid-turn member stays
// non-terminal in the record and the stop names basis 'aborted' (with the settle window at
// 1ms, the elapsed pacing wait produced nothing).
// ---------------------------------------------------------------------------
test('ROW-CADENCE P5: an operator abort never fabricates member terminality — the stop names basis aborted', async (t) => {
  const { baton, repo, driver } = driverHarness(t, { default: [{ edits: [], delayMs: 60_000 }] });
  const controller = new AbortController();
  const running = createWaveDriver(baton, {
    ...FAST, stallTimeoutMs: 60_000, settleTimeoutMs: 1, finalization: 'none',
    signal: controller.signal,
  }).run({ repoRoot: repo, members: [member('worker', 'long-running report')] });
  await new Promise((resolve) => setTimeout(resolve, 250)); // let the drive observe the member mid-turn
  controller.abort();
  const receipt = await running;
  assert.equal(receipt.basis, 'aborted',
    'the drive stopped on the operator signal — never on a member classification');
  const outcome = receipt.outcomes.find((entry) => entry.role === 'worker');
  assert.ok(outcome, 'the member outcome is present');
  assert.equal(outcome.terminal, false,
    'the mid-turn member is never classified terminal (no crash, no close, no cadence breach)');
  assert.equal(typeof receipt.closeReason, 'string');
  assert.match(receipt.closeReason, /basis: aborted/,
    'the stop names the operator-signal basis, never a member-terminal claim');
  const runIds = memberRunIds(driver, 'worker');
  const stopRow = driver.coordination.runStop(runIds[0]);
  assert.ok(stopRow, 'the member stop is admitted on the ledger');
  assert.equal(stopRow.reasonDigest, digest(receipt.closeReason),
    'the member-facing ledger reasonDigest matches the disclosed basis-bearing reason');
});
