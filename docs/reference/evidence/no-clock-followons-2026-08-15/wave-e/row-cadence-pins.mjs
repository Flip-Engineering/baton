// ROW-CADENCE red-first pin suite (wave-e, attempt 5884e780-5ba4-493b-a7fd-8b6974b772cb).
//
// Deliverable: leg-b activity honesty + settle pacing. The row's contract (row-cadence-brief.md):
//
//   1. The per-member liveness/progress classification takes lastActivityAt from ANY
//      member-originated evidence event (tool calls included), not only checkpoints/messages —
//      a tool-calling member must never classify 'silent' while its events advance.
//   2. settleTimeoutMs is PACING ONLY — it never terminates fate (never on a terminal path).
//   4. Every member stop the driver issues carries its DECISION basis (verdict + the signal
//      that fired it) on the stop outline — 'Wave driver settled.' is never the reason a member
//      sees when the basis is incomplete/stalled/aborted.
//   5. The drive loop never classifies a member terminal on a signal other than member evidence.
//
// RED facts (measured 2026-08-15 00:12Z, wave 99c21cd8): members spawned clean, brief
// delivered, then BOTH members were stopped 12s later with stop reason = the GENERIC
// 'Wave driver settled.' (an opaque reasonDigest of a constant string) — zero crashes, zero
// process_closed before the stop, and a tool-call-only member reads progressClass 'silent'
// because the classification folds checkpoints/messages, not content.tool_call activity.
//
// Pins:
//   RC-1  tool-call-only member (no checkpoints, no messages) classifies non-silent while its
//         content.tool_call events advance — RED at pre-change head (silence measured from the
//         last MEANINGFUL event only, so a 120s+ activity gap reads 'silent'), GREEN after.
//   RC-2  settleTimeoutMs never produces a terminal basis: a 1ms settle window still yields the
//         member-evidence basis 'completed', and every reference to the field in
//         wave-driver.mjs is pacing-only (the settle call), never on a basis-decision path.
//   RC-4  every member stop carries basis=… signal=… on the stop outline — completed,
//         stall, and abort closes alike; never the bare constant. RED at pre-change head.
//   RC-5  the drive loop never classifies a live, evidence-advancing member terminal: with a
//         sub-second stall window and a member whose content.tool_call activity advances every
//         poll, the drive never breaks 'stall' (no crash, no close, no cadence breach) — it
//         only stops on the operator abort, and that stop names basis=aborted signal=abort-signal.
//
// Clocks: RC-1 drives a shared controllable clock (`now` for the driver/log/coordination event
// stamps AND the application progress clock — one mutable source), so silenceMs is
// deterministic with zero wall-time waits. RC-2/4/5 use short RELATIVE timeouts over a real
// coordinator (the wave-driver-policy-red convention); none hardcodes a future date.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../../../../../impl/src/application.mjs';
import { MockAdapter } from '../../../../../impl/src/adapter.mjs';
import { bindBaton, createDriver, createWaveDriver } from '../../../../../impl/src/index.mjs';

const REPO_ID = 'repo-row-cadence-wave-e';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-row-cadence-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'row-cadence@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Row Cadence'], { cwd: root });
  writeFileSync(join(root, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function principal(id) {
  return Object.freeze({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
}

// One MockAdapter whose spawn() selects a scenario by matching a `(marker:x)` fragment embedded
// in the dispatched brief's goal text — same pattern as semantic-progress/wave-driver suites.
function markerAdapter(scenariosByMarker) {
  const value = new MockAdapter({ harness: 'mock', scenario: scenariosByMarker.default ?? { outcome: 'completed' } });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'row-cadence-wave-e', refreshedAt: null,
    },
  });
  const nativeSpawn = value.spawn.bind(value);
  value.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const marker = Object.keys(scenariosByMarker).find((key) => key !== 'default' && goal.includes(key));
    const scenario = scenariosByMarker[marker] ?? scenariosByMarker.default;
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  return value;
}

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536, requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID,
  definitionOfDone: ['the change is verified'], constraints: [], risk: 'low',
  goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'], verification, routes: [ROUTE], capabilities: ['code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

// options.now/options.clock: BOTH optional; when supplied they must be the SAME mutable clock
// source so the member-activity fold is deterministic (RC-1). Absent => real clocks (RC-2/4/5).
function harness(t, scenariosByMarker, options = {}) {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-row-cadence-log-'));
  const driver = createDriver({
    repoRoot: repo, repoId: REPO_ID, logDir, adapters: { mock: markerAdapter(scenariosByMarker) },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
    ...(options.now ? { now: options.now } : {}),
  });
  const application = new BatonApplication({
    driver, repoId: REPO_ID,
    profiles: { standard: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    try { await application.shutdown(principal('shutdown')); } catch { /* best-effort teardown */ }
    try { driver.coordination.releaseWriterLease(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo };
}

async function until(check, label, timeoutMs = 20_000, pollMs = 20) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label} never became true within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

const owner = () => principal('owner');
const approver = () => principal('approver');

const member = (role, objective, scenario) => ({
  role,
  objective: `${objective} (marker:${role})`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'], report: `reports/${role}.md`,
});

// A completing member scenario (writes one report, done immediately).
const completingScenario = (role) => ({ outcome: 'completed', edits: [{ path: `reports/${role}.md`, content: `${role} report\n` }] });
// A member that works for an hour (never completes inside any row window).
const longWorkScenario = (role) => ({ outcome: 'completed', edits: [{ path: `reports/${role}.md`, content: `${role} report\n`, delayMs: 3_600_000 }] });

const DRIVER_POLICY = Object.freeze({
  preflight: false, steering: 'none',
  pollIntervalMs: 25, stallTimeoutMs: 8_000, settleTimeoutMs: 1_500,
  finalization: 'none', unproductiveNudgeBudget: 1, saltObjectives: false, settlement: 'none',
});

// ---------------------------------------------------------------------------
// RC-1 — leg-b activity honesty (RED at pre-change head)
// ---------------------------------------------------------------------------

test('RC-1: a tool-call-only member (no checkpoints, no messages) never classifies silent while its content.tool_call events advance', async (t) => {
  // One mutable clock drives BOTH the driver/log/coordination event stamps and the application
  // progress clock, so silenceMs is exact: the member's activity horizon is measurable with
  // zero wall-time waits. The mock worker edits after an hour, so the run stays 'running' and
  // emits NO content.* events of its own — every content.tool_call below is member evidence.
  const epoch = Date.parse('2026-08-15T00:00:00.000Z');
  let current = epoch;
  const now = () => current;
  const clock = () => new Date(current).toISOString();
  const { application, driver } = harness(t, {
    alpha: longWorkScenario('alpha'),
  }, { now, clock });
  const started = await application.start({
    objective: 'RC-1 (marker:alpha): write the alpha report', profile: 'standard', route: ROUTE, scope: ['reports/**'],
  }, owner());
  await application.approve(started.runId, started.plan.digest, approver());
  const running = await until(async () => {
    const view = await application.status(started.runId, owner());
    return view.phase === 'running' ? view : null;
  }, 'run running');
  const workerId = running.ownership?.workerIds?.[0];
  assert.ok(typeof workerId === 'string' && workerId.length > 0, 'the run owns a live worker');
  assert.equal(running.progressClass.class, 'progressing', 'baseline: recently dispatched member progresses');
  const baselineMeaningfulAt = running.progressClass.meaningfulEventAt;
  assert.ok(typeof baselineMeaningfulAt === 'string' && Date.parse(baselineMeaningfulAt) <= epoch + 5_000,
    'the dispatch baseline is stamped at the controlled epoch (no real-time drift in the basis)');

  // The store projection already carries the member-activity horizon: assert the projection
  // exists and reads the member-originated tool-call evidence (the row pins the projection the
  // classification must fold — application.mjs `_activityProjection`).
  assert.equal(running.activity.contentEvents, 0, 'the plain mock emits no content events yet');

  // Advance the world 120s and emit a burst of tool calls: the member is WORKING (only tool
  // calls, no checkpoints, no messages). Its events advance — the classification must not read
  // 'silent' at any point after the burst.
  current = epoch + 120_000;
  const turnEpoch = 1;
  for (let n = 1; n <= 3; n += 1) {
    driver.log.append({
      worker: workerId, harness: 'mock@1.0.0', turnEpoch, kind: 'content.tool_call', actor: 'worker',
      payload: { callId: `rc1-${n}`, phase: 'completed', command: 'ls -la /repo', exitCode: 0, status: 'completed' },
    });
  }
  current = epoch + 121_000;
  const working = await application.status(started.runId, owner());
  assert.equal(working.activity.contentEvents, 3, 'the activity projection counts the tool calls');
  assert.ok(typeof working.activity.lastActivityAt === 'string'
    && Date.parse(working.activity.lastActivityAt) === epoch + 120_000,
  'the activity projection carries the LATEST member-originated event ts (tool calls included)');
  // THE PIN: 1s of silence since the last tool call — the member is advancing, never 'silent'.
  assert.equal(working.progressClass.class, 'progressing',
    'a tool-call-only member whose events advance never classifies silent (RC-1)');
  assert.ok(working.progressClass.silenceMs < 120_000,
    `silence is measured against the member's own last activity, not the last checkpoint/message (got ${working.progressClass.silenceMs}ms)`);

  // The outline the quiescence leg folds carries the same honest classification: progressClass
  // non-silent and a folded silence basis. AX-1 rule 3 stays — telemetry is not a forward-
  // progress MILESTONE, so lastProgress.at remains the last meaningful event (the milestone law
  // AX1-F pins), while the liveness classification is what folds the member activity.
  const outline = await application.command('run.inspect', { runId: started.runId, depth: 'outline' }, owner());
  assert.equal(outline.outline.progressClass.class, 'progressing',
    'the outline classification is non-silent for an advancing tool-calling member');
  assert.ok(outline.outline.silenceMs < 120_000,
    `the outline silence basis folds the member activity (got ${outline.outline.silenceMs}ms)`);
  assert.equal(outline.outline.lastProgress.at, baselineMeaningfulAt,
    'AX-1 rule 3 holds: tool telemetry is evidence-mapped but is not a forward-progress milestone — lastProgress.at stays meaningful-only');
});

// ---------------------------------------------------------------------------
// RC-2 — settleTimeoutMs is pacing only (never a terminal basis)
// ---------------------------------------------------------------------------

test('RC-2: a 1ms settle window still yields the member-evidence basis — the settle timeout never produces a terminal basis', async (t) => {
  const { baton, repo } = harness(t, { alpha: completingScenario('alpha') });
  const receipt = await createWaveDriver(baton, {
    ...DRIVER_POLICY, settleTimeoutMs: 1, pollIntervalMs: 20,
  }).run({ repoRoot: repo, members: [member('alpha', 'write the alpha report')] });

  assert.equal(receipt.basis, 'completed',
    'the settle window paces outcome collection; the basis was decided on member evidence before it');
  assert.equal(receipt.outcomes.length, 1, 'settle still produces an outcome for every member');
  assert.ok(['completed', 'stall', 'aborted'].includes(receipt.basis),
    'the basis vocabulary is member-evidence derived (never settle-timeout derived)');
});

test('RC-2 (static): every settleTimeoutMs reference in wave-driver.mjs is pacing-only — the field never appears on a terminal-basis path', () => {
  const source = readFileSync(new URL('../../../../../impl/src/wave-driver.mjs', import.meta.url), 'utf8');
  const refs = source.split('\n')
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => text.includes('settleTimeoutMs'));
  // The closed set: DEFAULT_POLICY declaration, freezePolicy validation, and the ONE runtime
  // use — the post-basis settle call. Anything else (a basis assignment, a break condition,
  // a stall/terminal comparison) is a fate path and fails here.
  assert.equal(refs.length, 3,
    `settleTimeoutMs must appear exactly in DEFAULT_POLICY + validation + the settle call (got ${refs.length}: ${refs.map((r) => r.line).join(',')})`);
  for (const ref of refs) {
    const text = ref.text.trim();
    const allowed = text.includes('settleTimeoutMs: 5_000')
      || text.includes('assertInteger(policy.settleTimeoutMs')
      || text.includes('wave.settle({ timeoutMs: policy.settleTimeoutMs })');
    assert.ok(allowed, `line ${ref.line} uses the settle window only as pacing: ${text}`);
    assert.ok(!text.includes('basis'), `line ${ref.line} never touches a basis assignment: ${text}`);
  }
  assert.match(source, /wave\.settle\(\{ timeoutMs: policy\.settleTimeoutMs \}\)/u,
    'the sole runtime use is the post-basis settle call');
  assert.doesNotMatch(source, /basis\s*=\s*['"]settle/u,
    'no basis spelling names the settle window');
});

// ---------------------------------------------------------------------------
// RC-4 — member stops carry their decision basis (RED at pre-change head)
// ---------------------------------------------------------------------------

// The reason string rides the run.stop RESPONSE outline (the stop view wave.mjs close reads —
// `lastAction.reason`); the durable ledger binds only its digest. Both are pinned: capture the
// stop response through the application command seam, and bind the ledger row to the same
// basis-carrying string (never the opaque constant's digest).
function captureStopOutlines(application) {
  const captured = [];
  const realCommand = application.command.bind(application);
  application.command = async (name, args, principal) => {
    const result = await realCommand(name, args, principal);
    if (name === 'run.stop' && result?.lastAction?.command === 'run.stop') captured.push(result);
    return result;
  };
  return captured;
}

// application.mjs `digest()`: sha256 over canonical(value) JSON — identity for a string.
const digestOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function stopAdmissionDigest(driver, runId) {
  const admission = driver.coordination.eventsView()
    .filter((event) => event.kind === 'run.stop_admitted' && event.payload?.runId === runId)
    .at(-1);
  return admission?.payload?.reasonDigest ?? null;
}

test('RC-4: every member stop the driver issues carries basis+signal on the stop outline — completed closes included, never the opaque constant', async (t) => {
  const { application, baton, driver, repo } = harness(t, { alpha: completingScenario('alpha') });
  const captured = captureStopOutlines(application);
  const receipt = await createWaveDriver(baton, {
    ...DRIVER_POLICY, stallTimeoutMs: 10_000,
  }).run({ repoRoot: repo, members: [member('alpha', 'write the alpha report')] });
  assert.equal(receipt.basis, 'completed');

  const stopOutline = captured.find((view) => view.phase === 'stopped' || view.terminal === true);
  assert.ok(stopOutline, 'the driver issued a member stop (response outline captured)');
  const reason = stopOutline.lastAction?.reason ?? null;
  assert.ok(typeof reason === 'string' && reason.startsWith('Wave driver settled: '),
    `the member stop outline carries the decision basis, never the bare constant (got ${JSON.stringify(reason)})`);
  assert.match(reason, /basis=completed signal=all-members-settled/u,
    `the stop names the verdict and the signal that fired it (got ${JSON.stringify(reason)})`);
  assert.notEqual(reason, 'Wave driver settled.', 'the opaque digest-of-a-constant is gone');
  assert.equal(stopAdmissionDigest(driver, stopOutline.runId), digestOf(reason),
    'the durable ledger reason binding is the basis-carrying string, not the constant');
});

test('RC-4 (stall): an incomplete wave stops its members with basis=stall signal=wave-stall-marker on the stop outline', async (t) => {
  const { application, baton, driver, repo } = harness(t, { beta: longWorkScenario('beta') });
  const captured = captureStopOutlines(application);
  const receipt = await createWaveDriver(baton, {
    ...DRIVER_POLICY, stallTimeoutMs: 400, pollIntervalMs: 20, settleTimeoutMs: 500,
  }).run({ repoRoot: repo, members: [member('beta', 'work forever')] });
  assert.equal(receipt.basis, 'stall', 'the no-progress member stalls the wave (member evidence: static marker)');

  const stopOutline = captured.find((view) => view.phase === 'stopped' || view.terminal === true);
  assert.ok(stopOutline, 'the driver issued the member stop (response outline captured)');
  const reason = stopOutline.lastAction?.reason ?? null;
  assert.ok(typeof reason === 'string' && reason.startsWith('Wave driver settled: '),
    `the stall stop carries the decision basis (got ${JSON.stringify(reason)})`);
  assert.match(reason, /basis=stall signal=wave-stall-marker/u,
    `the incomplete basis names the L5 wave-stall-marker signal (got ${JSON.stringify(reason)})`);
  assert.notEqual(reason, 'Wave driver settled.', 'the opaque digest-of-a-constant is gone');
  assert.equal(stopAdmissionDigest(driver, stopOutline.runId), digestOf(reason),
    'the durable ledger reason binding names the stall basis');
});

// ---------------------------------------------------------------------------
// RC-5 — the drive loop never classifies a member terminal on a non-evidence signal
// ---------------------------------------------------------------------------

test('RC-5: with member evidence advancing every poll (tool calls, no crash/close/cadence breach), a sub-second stall window never fires — only the operator abort stops the drive, naming basis=aborted', async (t) => {
  const { application, baton, driver, repo } = harness(t, { gamma: longWorkScenario('gamma') });
  const captured = captureStopOutlines(application);
  const controller = new AbortController();
  let appended = 0;

  // Pump member-originated tool-call evidence while the driver polls: the L5 marker must keep
  // advancing (the activity horizon changes every append), so a 400ms stall window NEVER
  // classifies the live member terminal. The red 2026-08-15 instance stopped members 12s after
  // brief delivery with zero crashes/closes/cadence breaches — this pump is the honest signal
  // that drive must keep driving on.
  const pump = (async () => {
    for (;;) {
      if (controller.signal.aborted) return;
      try {
        const list = await application.command('runs.list', {}, owner());
        const row = list.items.find((item) => item.objective?.includes('(marker:gamma)'));
        if (row) {
          const view = await application.status(row.id, owner());
          const workerId = view.ownership?.workerIds?.[0];
          if (typeof workerId === 'string') {
            appended += 1;
            driver.log.append({
              worker: workerId, harness: 'mock@1.0.0', turnEpoch: 1, kind: 'content.tool_call', actor: 'worker',
              payload: { callId: `rc5-${appended}`, phase: 'completed', command: 'ls -la /repo', exitCode: 0, status: 'completed' },
            });
          }
        }
      } catch { /* the run is not admitted yet — keep polling */ }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  })();
  const abortTimer = setTimeout(() => controller.abort(), 900);

  let receipt;
  try {
    receipt = await createWaveDriver(baton, {
      ...DRIVER_POLICY, stallTimeoutMs: 400, pollIntervalMs: 20, settleTimeoutMs: 500,
      signal: controller.signal,
    }).run({ repoRoot: repo, members: [member('gamma', 'work forever')] });
  } finally {
    clearTimeout(abortTimer);
    await pump.catch(() => {});
  }

  assert.ok(appended >= 5, `member tool-call evidence advanced during the drive (appended ${appended})`);
  assert.equal(receipt.basis, 'aborted',
    'the drive never classified the live, evidence-advancing member terminal — no stall fired on a non-activity signal');
  const stopOutline = captured.find((view) => view.phase === 'stopped' || view.terminal === true);
  assert.ok(stopOutline, 'the driver issued the member stop (response outline captured)');
  const reason = stopOutline.lastAction?.reason ?? null;
  assert.ok(typeof reason === 'string' && reason.startsWith('Wave driver settled: '),
    `the abort stop carries the decision basis (got ${JSON.stringify(reason)})`);
  assert.match(reason, /basis=aborted signal=abort-signal/u,
    `the abort names the operator signal that fired it (got ${JSON.stringify(reason)})`);
  assert.equal(stopAdmissionDigest(driver, stopOutline.runId), digestOf(reason),
    'the durable ledger reason binding names the abort signal');
});
