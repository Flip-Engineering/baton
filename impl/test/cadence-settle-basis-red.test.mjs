// [attempt: 65fd1578-0c44-4f81-a2e2-2701900a3ec8 row-cadence]
// #163 follow-on red suite — settle pacing + stop-basis honesty (row-cadence, wave-h).
// Authority: docs/reference/evidence/no-clock-followons-2026-08-15/wave-h/row-cadence-brief.md
// (byte-identical to the wave-f/wave-g canonical), contract items 2-5.
//
// Rows:
//   C1   settle-timeout pin (contract 2 + 3b + 5): a member still parked when the wave
//        stalls and the settle window expires is NEVER classified terminal on the timeout —
//        the receipt basis stays 'stall' (the loop's own member-evidence decision), the
//        settle outcome reads the member's real (non-terminal) status, and the member stop
//        carries the stall-clock decision basis. RED at pre-change head: the stop reason was
//        the generic 'Wave driver settled.' constant (an opaque digest of a constant string)
//        and no stop carried a basis.
//   C2   completed-path signal (contract 4): a claim-settled wave stops members with the
//        { verdict: 'completed', signal: 'member-terminality' } basis — member evidence, not
//        a clock.
//   C3   leg-b classifier pin (contract 1 + 3a): a tool-call-only member (content.tool_call
//        evidence, NO checkpoints/messages) classifies 'progressing' at the silence-threshold
//        edge — a member whose events advance is never 'silent'. RED at pre-change head:
//        content evidence was excluded from lastProgress.at, so the same clock edge read
//        'silent'.
//   C4   wave-level composition (contract 4 threading): wave.close({ reason, basis }) threads
//        verdict + signal into BOTH the per-member stop entry AND the member-facing stop
//        reason (the ledger run.stop_admitted reasonDigest is digest of the composed reason,
//        never the bare constant); close({ reason }) without a basis stays byte-identical
//        (back-compat guard).
//   C5   abort-path signal (contract 4): an aborted drive stops members with
//        { verdict: 'aborted', signal: 'abort-signal' }.
//
// Clocks: the driver rows use short RELATIVE timeouts on a real clock (the wave-driver-policy
// idiom — no hardcoded dates, fixture-clock-lint clean). C3's application clock is a FIXTURE
// DOUBLE set relative to a ledger-read timestamp (the quiescence-completion idiom: a double,
// never a completion control; no test waits on elapsed time for a verdict).
//
// NUL-byte discipline: this file contains 0 NUL bytes.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { PROGRESS_SILENCE_THRESHOLD_MS } from '../src/application-semantics.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver, createWaveDriver } from '../src/index.mjs';
import { createWave } from '../src/wave.mjs';

const repoId = 'repo-cadence-settle';

// The ledger's reasonDigest is the application digest discipline (application.mjs:273-277):
// sha256 of the canonicalized JSON — for a string, JSON.stringify of it.
const stopReasonDigest = (reason) => createHash('sha256').update(JSON.stringify(reason)).digest('hex');

// ---------------------------------------------------------------------------
// Driver harness (wave-driver-policy-red idiom): a pausable adapter so a member parks on a
// turn checkpoint (non-terminal) and only advances on a nudge.
// ---------------------------------------------------------------------------

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-cadence-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

// One MockAdapter whose card declares `turnCompletion: 'pausable'` and whose turns are SCRIPTED
// per member marker; after the last scripted turn the adapter repeats it (path set frozen =>
// unproductive), so a finite productive prefix is followed by a parked tail. The turnEpoch is
// bumped +1 per nudge to stay in lockstep with the coordinator fence.
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
        provenance: 'cadence-settle-basis-red', refreshedAt: null,
      },
    };
  }

  _markerIn(goal) {
    return Object.keys(this._scriptsByMarker).find((key) => key !== 'default' && goal.includes(`(marker:${key})`)) ?? 'default';
  }

  _scriptForMarker(marker) {
    return this._scriptsByMarker[marker] ?? this._scriptsByMarker.default ?? [{ edits: [] }];
  }

  _scenarioForTurn(script, index) {
    const turn = script[index] ?? script.at(-1) ?? { edits: [] };
    return {
      outcome: 'completed',
      summary: `pausable turn ${index}`,
      edits: (turn.edits ?? []).map((edit) => ({ ...edit })),
    };
  }

  async spawn(worker, brief, options = {}) {
    const marker = this._markerIn(brief?.goal ?? '');
    this._markerByWorker = this._markerByWorker ?? new Map();
    this._markerByWorker.set(worker, marker);
    const script = this._scriptForMarker(marker);
    this._turnCount = this._turnCount ?? new Map();
    this._turnCount.set(worker, 0);
    return super.spawn(worker, brief, {
      ...options,
      scenario: this._scenarioForTurn(script, 0),
      turnEpoch: 0,
    });
  }

  async prompt(worker, message, mode) {
    if (mode === 'turn') {
      const marker = this._markerByWorker?.get(worker) ?? 'default';
      const script = this._scriptForMarker(marker);
      const count = (this._turnCount?.get(worker) ?? 0) + 1;
      this._turnCount.set(worker, count);
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

// Fast policy defaults for the suite: short relative timeouts, real clock (no time-bombs).
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
    // Neutralize the worker watchdog: a stallMs far beyond any test window, so a parked turn's
    // freshly armed timer never fires and writes nothing that flaps the stall marker.
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
  return { application, baton, driver, repo, logDir, adapter };
}

// The last run.stop_admitted admission in the coordination ledger for the run — its
// payload.reasonDigest is the digest of the reason the member actually saw.
function lastStopReasonDigest(logDir, runId) {
  let digestValue = null;
  try {
    for (const line of readFileSync(join(logDir, 'coordination', 'events.jsonl'), 'utf8').trim().split('\n')) {
      try {
        const event = JSON.parse(line);
        // runId omitted → the last admission overall (single-wave fixtures).
        if (event.kind === 'run.stop_admitted'
          && (runId === undefined || event.payload?.runId === runId)) digestValue = event.payload.reasonDigest;
      } catch { /* skip malformed lines */ }
    }
  } catch { /* coordination events absent */ }
  return digestValue;
}

// ---------------------------------------------------------------------------
// C1 — the settle-timeout pin (contract 2 + 3b + 5): settleTimeoutMs paces the settle wait
// only; it NEVER produces a terminal basis. A member still parked when the stall clock fires
// and the settle window expires stops with the stall-clock decision basis and a NON-terminal
// settle outcome — the timeout classified nothing.
// ---------------------------------------------------------------------------
test('C1: the settle timeout never produces a terminal basis — a stalled member stops non-terminal with the stall-clock basis', async (t) => {
  const scriptsByMarker = { default: [{ edits: [edit('worker', 1)] }] };
  const { baton, repo, logDir } = driverHarness(t, scriptsByMarker);
  const receipt = await createWaveDriver(baton, {
    ...FAST,
    steering: 'none', // no nudges: the member parks on turn 1 and its view freezes
    stallTimeoutMs: 250, settleTimeoutMs: 600, finalization: 'none',
  }).run({ repoRoot: repo, members: [member('worker', 'one parked report')] });

  assert.equal(receipt.basis, 'stall', 'the loop\'s own decision is stall — the settle timeout never flips the basis to completed');
  const outcome = receipt.outcomes.find((entry) => entry.role === 'worker');
  assert.ok(outcome, 'the settle leg produced an outcome for the member');
  assert.equal(outcome.terminal, false, 'a member still working past the settle window is NOT classified terminal on the timeout (no crash, no close, no cadence breach)');

  const stop = receipt.stops.find((entry) => entry.role === 'worker');
  assert.ok(stop, 'close produced a per-member stop');
  assert.deepEqual(stop.basis, { verdict: 'stall', signal: 'stall-clock' },
    'the member stop carries the decision basis: the stall clock fired it, and member evidence never did');

  // The member-facing stop reason is digest of the COMPOSED reason (verdict + signal), never
  // the opaque constant. The runId is the salted objective digest — recover it from the ledger.
  const stopDigest = lastStopReasonDigest(logDir, undefined);
  assert.ok(typeof stopDigest === 'string' && /^[a-f0-9]{64}$/u.test(stopDigest), 'a run.stop_admitted admission exists in the ledger');
  assert.equal(stopDigest, stopReasonDigest('Wave driver settled. basis=stall signal=stall-clock'),
    'the member-facing stop reason names verdict + signal — the reason a member sees is never the bare \'Wave driver settled.\'');
  assert.notEqual(stopDigest, stopReasonDigest('Wave driver settled.'),
    'the opaque constant-string digest is gone from the ledger');
  assert.equal(receipt.remainingCount, 0, 'the guaranteed close drains every member even on a stall');
});

// ---------------------------------------------------------------------------
// C2 — completed-path signal (contract 4): a claim-settled wave stops with the
// member-terminality basis — member evidence fired it, no clock.
// ---------------------------------------------------------------------------
test('C2: a completing wave stops members with the completed/member-terminality basis', async (t) => {
  const scriptsByMarker = { default: [{ edits: [edit('worker', 1)] }] };
  const { baton, repo } = driverHarness(t, scriptsByMarker);
  const receipt = await createWaveDriver(baton, {
    ...FAST, stallTimeoutMs: 10_000, unproductiveNudgeBudget: 0, finalization: 'claim-on-stall',
  }).run({ repoRoot: repo, members: [member('worker', 'write the worker report')] });
  assert.equal(receipt.basis, 'completed');
  const stop = receipt.stops.find((entry) => entry.role === 'worker');
  assert.ok(stop, 'close produced a per-member stop');
  assert.deepEqual(stop.basis, { verdict: 'completed', signal: 'member-terminality' },
    'a completed wave stops members on member evidence, and the stop names that signal');
});

// ---------------------------------------------------------------------------
// C5 — abort-path signal (contract 4): an aborted drive stops with the abort-signal basis.
// ---------------------------------------------------------------------------
test('C5: an aborted drive stops members with the abort-signal basis', async (t) => {
  const scriptsByMarker = { default: [{ edits: [edit('worker', 1)] }] };
  const { baton, repo } = driverHarness(t, scriptsByMarker);
  const controller = new AbortController();
  controller.abort();
  const receipt = await createWaveDriver(baton, {
    ...FAST, steering: 'none', stallTimeoutMs: 10_000, settleTimeoutMs: 400,
    finalization: 'none', signal: controller.signal,
  }).run({ repoRoot: repo, members: [member('worker', 'one parked report')] });
  assert.equal(receipt.basis, 'aborted');
  const stop = receipt.stops.find((entry) => entry.role === 'worker');
  assert.ok(stop, 'close produced a per-member stop');
  assert.deepEqual(stop.basis, { verdict: 'aborted', signal: 'abort-signal' },
    'an aborted drive stops members on the abort signal, and the stop names it');
});

// ---------------------------------------------------------------------------
// C4 — wave-level composition (contract 4 threading): wave.close threads verdict + signal
// into the per-member stop entry AND the member-facing stop reason; close without a basis
// stays byte-identical.
// ---------------------------------------------------------------------------
test('C4: wave.close threads the decision basis into every member stop and the member-facing reason', async (t) => {
  const { baton, repo, logDir } = driverHarness(t, { default: [{ edits: [edit('worker', 1)] }] });
  const wave = await createWave(baton, {
    repoRoot: repo,
    members: [member('alpha', 'write the alpha report'), member('beta', 'write the beta report')],
  });
  const stop = await wave.close({
    reason: 'C4 settled.',
    basis: { verdict: 'stall', signal: 'stall-clock' },
  });
  assert.equal(stop.stops.length, 2);
  for (const entry of stop.stops) {
    assert.deepEqual(entry.basis, { verdict: 'stall', signal: 'stall-clock' },
      `every member stop carries the decision basis (${entry.role})`);
  }
  // The member-facing reason: the ledger admission digest is the composed reason, and the bare
  // constant never appears.
  for (const entry of stop.stops) {
    const runId = [...wave.runs].find(([role]) => role === entry.role)?.[1]?.id ?? null;
    const digestValue = lastStopReasonDigest(logDir, runId);
    assert.equal(digestValue, stopReasonDigest('C4 settled. basis=stall signal=stall-clock'),
      `the stop reason a member sees carries verdict + signal (${entry.role})`);
  }

  const bare = await createWave(baton, {
    repoRoot: repo,
    members: [member('gamma', 'write the gamma report')],
  });
  const bareStop = await bare.close({ reason: 'C4 bare.' });
  assert.equal(bareStop.stops.length, 1);
  assert.ok(!('basis' in bareStop.stops[0]), 'close without a basis stays byte-identical (back-compat guard)');
  const bareRunId = [...bare.runs][0]?.[1]?.id ?? null;
  assert.equal(lastStopReasonDigest(logDir, bareRunId), stopReasonDigest('C4 bare.'),
    'the bare close reason is passed through verbatim');
});

// ---------------------------------------------------------------------------
// C3 — the leg-b classifier pin (contract 1 + 3a): a tool-call-only member (content.tool_call
// evidence, NO checkpoints/messages) classifies non-silent at the silence-threshold edge. The
// application clock is a FIXTURE DOUBLE set relative to the ledger-read tool_call ts — the
// quiescence-completion idiom (a double, never a completion control).
// ---------------------------------------------------------------------------
function classifierHarness(t) {
  const repo = root('classifier');
  const logDir = root('classifier-log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'c@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'C'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  // An adapter that stays working (long delay — the member never completes during the pin) and
  // emits a content.tool_call observation mid-turn via the real event lane.
  const worker = new MockAdapter({ harness: 'worker', scenario: { outcome: 'completed', delayMs: 60_000 } });
  const card = worker.card.bind(worker);
  worker.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'm', available: ['m'], family: 'f',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const realOnEvent = worker.onEvent.bind(worker);
  let registeredCb = null;
  worker.onEvent = (fn) => { registeredCb = fn; return realOnEvent(fn); };
  globalThis.__cadenceInjectToolCall = (workerId) => registeredCb?.({
    worker: workerId, harness: 'worker', turnEpoch: 1, actor: 'worker',
    kind: 'content.tool_call', payload: { phase: 'start', tool: 'bash' },
  });

  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-cadence-classifier', logDir, now: () => Date.now(),
    adapters: { worker },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId: 'repo-cadence-classifier', mandatory: true, approvalTtlMs: 3_600_000,
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

  let appClock = new Date().toISOString();
  const application = new BatonApplication({
    driver, repoId: 'repo-cadence-classifier',
    profiles: {
      plain: {
        schemaVersion: 1, repoId: 'repo-cadence-classifier',
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
    clock: () => appClock,
  });
  t.after(async () => {
    try { await application.close?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, driver, logDir, setClock(iso) { appClock = iso; } };
}

function lastToolCallTs(logDir) {
  let ts = null;
  try {
    for (const line of readFileSync(join(logDir, 'coordination', 'events.jsonl'), 'utf8').trim().split('\n')) {
      try {
        const event = JSON.parse(line);
        if (event.kind === 'evidence.mapped' && event.payload?.kind === 'content.tool_call'
          && event.ts > (ts ?? '')) ts = event.ts;
      } catch { /* skip malformed lines */ }
    }
  } catch { /* coordination events absent */ }
  return ts;
}

test('C3: a tool-call-only member (no checkpoints) classifies non-silent while its events advance', async (t) => {
  const { application, logDir, setClock } = classifierHarness(t);
  try {
    const runId = 'run-cadence-c3';
    const proposed = await application.command('run.start', { intent: {
      runId, objective: 'cadence classifier pin', route: { harness: 'worker', model: 'm', effort: 'low' },
    } }, principal('owner'));
    await application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));
    await new Promise((resolve) => setTimeout(resolve, 100));
    // The member is working (60s delay). Inject the mid-turn tool_call observation through the
    // real event lane — the ONLY member-originated evidence (no checkpoints, no messages).
    globalThis.__cadenceInjectToolCall?.('w-1');
    await new Promise((resolve) => setTimeout(resolve, 150));
    const toolCallTs = lastToolCallTs(logDir);
    assert.ok(toolCallTs, 'the fixture emitted a content.tool_call event');
    // The classifier edge: observedAt sits just BELOW the silence threshold measured from the
    // tool_call (post-fix lastProgress.at), which is just ABOVE the threshold measured from the
    // pre-tool meaningful event (pre-fix lastProgress.at) — the exact RED/GREEN discriminator.
    setClock(new Date(Date.parse(toolCallTs) + PROGRESS_SILENCE_THRESHOLD_MS - 1).toISOString());
    const inspect = await application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
    const outline = inspect?.outline ?? inspect ?? {};
    const progressClass = outline.progressClass ?? null;
    assert.ok(progressClass, 'the outline carries the progressClass projection');
    assert.equal(progressClass.class, 'progressing',
      'a member whose tool_call events advance is NEVER silent — only tool calls, no checkpoints, yet non-silent');
    assert.ok(Date.parse(progressClass.meaningfulEventAt) >= Date.parse(toolCallTs),
      'the classification basis rides the latest member event');
  } finally {
    await application.close?.();
  }
});
