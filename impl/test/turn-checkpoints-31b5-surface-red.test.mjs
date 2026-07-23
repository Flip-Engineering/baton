// Issue #31 slice B.5 — surface completion: wiring the `turn_checkpoint` semantic action.
//
// Binding contract:
//   docs/reference/evidence/turn-checkpoints-2026-07-23/31b-steering-acts-decisions.md
//   (v2 FINAL) Part F rule 16 (lines 167-186 name the routing decision, 479-505 the rule itself).
//
// Ground truth this suite pins:
//   - the `turn_checkpoint` attention entry already exists (application.mjs `_buildView`,
//     `31b-red`'s F3), and the three steering acts already exist at the coordinator layer
//     (coordinator.mjs `nudgeTurn`/`waitTurn`/`claimTurn`, `31b-red`'s Parts A-E) — this suite
//     does NOT re-prove either of those.
//   - what was MISSING before this contract: `APPLICATION_SEMANTIC_REGISTRY` had no
//     `nudge_turn`/`wait_turn`/`claim_turn` entries, `_semanticActions` generated no candidates
//     from a `turn_checkpoint` attention entry, and `act()`/`actionAuthority` could not resolve
//     or execute them. Rule 16 forecloses a new MCP tool or enum member — the ONLY entry point
//     is the existing generic `run.act`/`_semanticActions`/`actionAuthority` machinery, exactly
//     like `approve_plan`/`answer_question`/etc.
//
// Clocks: this suite drives a real Coordinator through MockAdapter's real (short) setTimeout
// delays — the same style already used by turn-checkpoints-31a-red.test.mjs's
// `applicationFixture()` and phase64-integrated-run-application.test.mjs's `fixture()`, neither
// of which fake `now()` for this class of end-to-end dispatch fixture. No test in this file reads
// wall-clock time or asserts on a timestamp; every wait is a bounded condition poll.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';

const dirs = [];
function dir(name) {
  const d = mkdtempSync(join(tmpdir(), `baton-31b5-${name}-`));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

async function until(fn, label, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timeout waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const VERIFICATION = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});
const POLICY = Object.freeze({
  schemaVersion: 1, repoId: 'repo-31b5', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});
const PROFILE = Object.freeze({
  schemaVersion: 1, repoId: 'repo-31b5',
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification: VERIFICATION,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const intent = (runId, extra = {}) => ({
  runId, objective: 'Exercise the turn_checkpoint semantic action surface',
  profile: 'p31b5', route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'], driverKind: 'wave', ...extra,
});

/** A driver whose one adapter declares `turnCompletion: 'pausable'` (SC8, 31-a's A1/A2). */
function pausableFixture(name) {
  const repo = dir(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', '31b5@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Issue 31b5'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: { outcome: 'completed', delayMs: 5, summary: '31b5 fixture turn', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    turnCompletion: 'pausable',
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });

  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-31b5', logDir: dir(`${name}-log`),
    adapters: { mock: adapter },
    goalPlanAuthority: { policy: POLICY, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-31b5', profiles: { p31b5: PROFILE },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  return { application, driver };
}

/** Dispatches one Run with `driverKind:'wave'` (no auto-settle) and waits for its genuine pause. */
async function pausedRun(name, runId) {
  const kit = pausableFixture(name);
  const { application } = kit;
  const proposed = await application.start(intent(runId), principal('owner'));
  await application.approve(runId, proposed.plan.digest, principal('approver'));
  await until(
    async () => (await application.status(runId, principal('owner'))).phase === 'paused',
    'task pause',
  );
  const view = await application.status(runId, principal('owner'));
  const checkpoint = view.attention.find((entry) => entry.kind === 'turn_checkpoint');
  assert.ok(checkpoint, 'a genuinely paused task must carry a turn_checkpoint attention entry');
  return {
    ...kit, runId, pauseId: checkpoint.requestId,
    workerId: checkpoint.workerId, taskId: checkpoint.taskId,
  };
}

test('turn_checkpoint surface: a pending pause lists nudge_turn/wait_turn/claim_turn with the '
  + 'server-derived target shape, and run.act(nudge_turn) unparks the SAME task working with a '
  + 'freshly armed watchdog', async (t) => {
  const { application, driver, runId, pauseId, workerId, taskId } = await pausedRun('nudge', 'run-31b5-nudge');
  t.after(async () => { try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ } });

  const run = bindBaton(application, principal('owner')).runs.open(runId);
  const outline = await run.inspect();
  const kinds = outline.outline.actions.map((action) => action.kind);
  for (const kind of ['nudge_turn', 'wait_turn', 'claim_turn']) {
    assert.ok(kinds.includes(kind), `${kind} must be listed while the turn is checkpointed`);
  }
  const nudge = outline.outline.actions.find((action) => action.kind === 'nudge_turn');
  assert.deepEqual(nudge.target, { workerId, taskId, turnEpoch: nudge.target.turnEpoch, pauseId });
  assert.deepEqual([...nudge.serverDerived].sort(), ['pauseId', 'taskId', 'turnEpoch', 'workerId']);
  assert.deepEqual([...nudge.requiredCapabilities].sort(), ['control', 'observe']);

  const handle = driver.coordinator._workers.get(workerId);
  const timerBefore = handle.watchdogTimer;
  const generationBefore = handle.watchdogGeneration ?? 0;

  const answered = await run.act(nudge.actionId, { message: 'Please continue with the next step.' });
  assert.equal(answered.outline.actions.some((action) => action.kind === 'nudge_turn'), false,
    'the SAME pause record is consumed once nudged — the checkpoint disappears');

  assert.equal(driver.coordination.task(taskId).status, 'working');
  assert.equal(handle.status, 'working');
  assert.ok(handle.watchdogTimer != null, 'nudge must arm a live stall timer, not just bump a generation');
  assert.notEqual(handle.watchdogGeneration ?? 0, generationBefore);
  assert.notEqual(handle.watchdogTimer, timerBefore);
  clearTimeout(handle.watchdogTimer);
});

test('wait_turn receipts the checkpoint without consuming it: the SAME nudge_turn/wait_turn/'
  + 'claim_turn candidates remain advertised afterward', async (t) => {
  const { application, driver, runId, pauseId, workerId, taskId } = await pausedRun('wait', 'run-31b5-wait');
  t.after(async () => { try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ } });

  const run = bindBaton(application, principal('owner')).runs.open(runId);
  const before = await run.inspect();
  const wait = before.outline.actions.find((action) => action.kind === 'wait_turn');
  assert.ok(wait);

  const answered = await run.act(wait.actionId, {});
  const kindsAfter = answered.outline.actions.map((action) => action.kind);
  for (const kind of ['nudge_turn', 'wait_turn', 'claim_turn']) {
    assert.ok(kindsAfter.includes(kind), `${kind} must still be advertised after a wait receipt`);
  }
  assert.equal(driver.coordination.task(taskId).status, 'paused');
  assert.equal(driver.coordinator._pausedTurns.get(pauseId).state, 'pending');
  const receipts = driver.coordinator._log.read(workerId).filter((event) => event.kind === 'turn.wait_noted');
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].payload.pauseId, pauseId);

  const handle = driver.coordinator._workers.get(workerId);
  if (handle.watchdogTimer != null) clearTimeout(handle.watchdogTimer);
});

test('claim_turn re-runs the live trust gate against the exact paused task and resolves it to '
  + 'a terminal outcome, consuming the checkpoint', async (t) => {
  const { application, driver, runId, pauseId, workerId, taskId } = await pausedRun('claim', 'run-31b5-claim');
  t.after(async () => { try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ } });

  const run = bindBaton(application, principal('owner')).runs.open(runId);
  const outline = await run.inspect();
  const claim = outline.outline.actions.find((action) => action.kind === 'claim_turn');
  assert.ok(claim);

  const answered = await run.act(claim.actionId, {});
  assert.equal(answered.outline.actions.some((action) => action.kind === 'claim_turn'), false);
  assert.equal(driver.coordination.task(taskId).status, 'completed');
  assert.equal(driver.coordinator._pausedTurns.get(pauseId).state, 'resolved');

  const finished = await application.status(runId, principal('owner'));
  assert.equal(finished.phase, 'work_completed');

  const handle = driver.coordinator._workers.get(workerId);
  if (handle.watchdogTimer != null) clearTimeout(handle.watchdogTimer);
});

test('actionAuthority/act recheck against LIVE state: an actionId captured before the pause was '
  + 'resolved by something else is refused, never silently executed', async (t) => {
  const { application, driver, runId, pauseId, workerId } = await pausedRun('recheck', 'run-31b5-recheck');
  t.after(async () => { try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ } });

  const run = bindBaton(application, principal('owner')).runs.open(runId);
  const outline = await run.inspect();
  const nudge = outline.outline.actions.find((action) => action.kind === 'nudge_turn');
  assert.ok(nudge);

  const authority = await application.actionAuthority(
    { runId, actionId: nudge.actionId, inputs: {} }, principal('owner'),
  );
  assert.equal(authority.kind, 'nudge_turn');

  // A caller outside the semantic-action surface (e.g. a different driver) resolves the SAME
  // pause record directly against the coordinator.
  const claimed = await driver.coordinator.claimTurn(pauseId);
  assert.equal(claimed.ok, true);

  await assert.rejects(
    application.actionAuthority({ runId, actionId: nudge.actionId, inputs: {} }, principal('owner')),
    (error) => error?.code === 'application_action_scope_mismatch',
  );
  await assert.rejects(
    application.act({ runId, actionId: nudge.actionId, inputs: { message: 'too late' } }, principal('owner')),
    (error) => error?.code === 'application_action_scope_mismatch',
  );

  const handle = driver.coordinator._workers.get(workerId);
  if (handle.watchdogTimer != null) clearTimeout(handle.watchdogTimer);
});

test('a second act() against the SAME nudge_turn actionId after the first already resolved the '
  + 'pause is refused as scope-mismatched — an already-resolved checkpoint, never re-executed',
async (t) => {
  const { application, driver, runId, pauseId, workerId } = await pausedRun('twice', 'run-31b5-twice');
  t.after(async () => { try { await application.shutdown(principal('cleanup')); } catch { /* best effort */ } });

  const run = bindBaton(application, principal('owner')).runs.open(runId);
  const outline = await run.inspect();
  const nudge = outline.outline.actions.find((action) => action.kind === 'nudge_turn');
  assert.ok(nudge);

  await application.act({ runId, actionId: nudge.actionId, inputs: {} }, principal('owner'));
  assert.equal(
    driver.coordinator._log.read(workerId)
      .filter((event) => event.kind === 'lifecycle.turn_started' && event.payload?.pauseId === pauseId).length,
    1,
  );

  await assert.rejects(
    application.act({ runId, actionId: nudge.actionId, inputs: {} }, principal('owner')),
    (error) => error?.code === 'application_action_scope_mismatch',
    'the resolved pause record must never admit a second fresh turn through the stale actionId',
  );
  assert.equal(
    driver.coordinator._log.read(workerId)
      .filter((event) => event.kind === 'lifecycle.turn_started' && event.payload?.pauseId === pauseId).length,
    1,
    'exactly one fresh turn was admitted, never two',
  );

  const handle = driver.coordinator._workers.get(workerId);
  if (handle.watchdogTimer != null) clearTimeout(handle.watchdogTimer);
});
