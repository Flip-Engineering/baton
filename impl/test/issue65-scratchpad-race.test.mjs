// Issue #65 part 2 red suite: a worker's session-start scratchpad.write races the spawn's own
// claim.
//
// Receipt (issue #65, from the KG settlement suite v2 bring-up, 2026-08-01): a member that emits
// scratchpad.write at session START — before its first turn effect — crashes at spawn with the
// coordination store's already_assigned, and the run is over in about 1.7 s. Mechanism: the
// write's command opens with coordinator.tick(); tick runs the dispatch pass
// (coordinator.mjs _dispatchPass), and the task whose spawn this very frame is inside is still
// 'pending' in memory (the in-memory flip to 'working' lands after the adapter returns). The
// re-entrant dispatch claims the task a second time, and _dispatch mints that claim's
// idempotency key from the coordinationVersion the FIRST claim already advanced
// (runtime-effects.mjs), so the replay misses and claimTask refuses `already assigned <id>`.
// The adapter's spawn is on the stack, so the refusal is consumed as a spawn refusal and the
// member is terminalized.
//
// The pin: a member whose FIRST up-channel event is the session-start write reaches result_ready
// with a preserved resultSha exactly as the byte-identical run without the write does, the task
// is claimed exactly once (no double-claim), and the write attempt is receipted (never silent,
// issue #33/#62) — admitted, or refused with a typed code, but never a crash.
//
// Fixture: the stock one-member wave (createWave + wave.settle, the git-batch-216 harness
// shape) over a MockAdapter subclass that emits the write synchronously from _startSession,
// before _runSession reaches its first effect.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { createWave } from '../src/wave.mjs';

const REPO = 'repo-issue65';
const ROLE = 'alpha';

const dirs = [];
function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue65-${label}-`));
  dirs.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  // The member worktree commits its edit through the shared repository config: without a
  // persisted identity the mock's `git commit` refuses on a host with no global git config.
  execFileSync('git', ['config', 'user.name', 'Baton Test'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'baton@example.test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

const PROFILE = Object.freeze({
  schemaVersion: 1, repoId: REPO, definitionOfDone: ['deployment verification passes'],
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
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

// capabilityClasses deliberately excludes baton_orchestrator: this pin is the write race, never
// #65 part 1 (the keyed-wave close stall is that class's lineage admission path).
const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'], effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

// The member's first up-channel event, emitted SYNCHRONOUSLY inside spawn() — _startSession runs
// before _runSession reaches its first await/effect, and the coordinator's adapter observer
// handles the event on the spot. This is the exact window the issue receipted; a real session
// adapter's scanner lands its first write here too whenever the write precedes the first effect.
class SessionStartWritingAdapter extends MockAdapter {
  constructor(config = {}, entry = null) {
    super(config);
    this._sessionStartEntry = entry ?? { kind: 'note', text: 'session-start note (marker:alpha)' };
  }

  _startSession(session) {
    this._emit(session, 'scratchpad.write', {
      entry: this._sessionStartEntry,
      expectedFence: 'current',
      idempotencyKey: `issue65:session-start:${session.worker}`,
    });
    super._startSession(session);
  }
}

function fixture(t, adapter) {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'issue65-test', refreshedAt: null,
    },
  });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2_000,
    // Suite law #6: the stall watchdog is a valid positive integer in every fixture — pinned,
    // never the default.
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('i65-planner'),
      dispatcher: principal('i65-dispatcher'),
      observer: principal('i65-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('i65-owner'));
  t.after(async () => {
    try { await application.shutdown(principal('i65-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
  });
  return { application, baton, driver, repo, logDir };
}

function scenario() {
  return {
    outcome: 'completed',
    edits: [{ path: `reports/${ROLE}.md`, content: `${ROLE} report\n` }],
  };
}

function member() {
  return {
    role: ROLE,
    objective: `write the ${ROLE} report (marker:${ROLE})`,
    harness: 'mock', model: 'mock-model', effort: 'low',
    scope: ['reports/**'],
    report: `reports/${ROLE}.md`,
  };
}

/** The one member task's durable row and the operational log of its assignee. */
function memberFacts(driver) {
  const tasks = driver.coordination.snapshot().tasks;
  assert.equal(tasks.length, 1, `fixture: exactly one member task, got ${tasks.length}`);
  const task = tasks[0];
  const workerId = task.assignee;
  return { task, workerId, log: driver.log.read(workerId) };
}

test('R1 (#65-A): a member whose first up-channel event is a session-start scratchpad.write settles result_ready with a resultSha — the write never kills its own spawn', async (t) => {
  const context = fixture(t, new SessionStartWritingAdapter({ scenario: scenario() }));
  const wave = await createWave(context.baton, { members: [member()] });
  const outcomes = await wave.settle({ timeoutMs: 30_000 });

  assert.equal(outcomes.length, 1, 'the one member got an outcome');
  const outcome = outcomes[0];
  assert.equal(outcome.role, ROLE);
  assert.equal(outcome.phase, 'result_ready',
    `the session-start write must not terminalize the member: ${JSON.stringify(outcome)}`);
  assert.match(outcome.resultSha ?? '', /^[a-f0-9]{40}$/u,
    'the member preserved its result exactly as the byte-identical run without the write does');

  const { task, workerId, log } = memberFacts(context.driver);
  assert.equal(task.status, 'completed', 'the durable member task completed');
  const crashes = log.filter((event) => event.kind === 'lifecycle.crashed');
  for (const crash of crashes) {
    assert.doesNotMatch(String(crash.payload?.error ?? ''), /already assigned/u,
      `worker ${workerId} died on the double-claim: ${JSON.stringify(crash.payload)}`);
  }
});

test('R2 (#65-B): the session-start write is receipted once and never silently dropped — typed admission or typed refusal, and the task is claimed exactly once', async (t) => {
  const context = fixture(t, new SessionStartWritingAdapter({ scenario: scenario() }));
  const wave = await createWave(context.baton, { members: [member()] });
  const outcomes = await wave.settle({ timeoutMs: 30_000 });
  assert.equal(outcomes[0]?.phase, 'result_ready',
    `precondition: the member settles (${JSON.stringify(outcomes[0])})`);

  const { workerId, log } = memberFacts(context.driver);
  const receipts = log.filter((event) => event.kind === 'scratchpad.write_result');
  assert.equal(receipts.length, 1,
    `every write attempt produces exactly one receipt (issue #33/#62): ${JSON.stringify(receipts)}`);
  const receipt = receipts[0].payload;
  assert.equal(typeof receipt.ok, 'boolean', `the receipt is typed: ${JSON.stringify(receipt)}`);
  if (receipt.ok === false) {
    assert.equal(typeof receipt.result, 'string',
      `a refused write names its closed-set code: ${JSON.stringify(receipt)}`);
  }

  const claims = context.driver.coordination.events().filter((event) => event.kind === 'task.claimed');
  assert.equal(claims.length, 1,
    `the member's own claim is the only one — the write never doubles it: ${JSON.stringify(claims)}`);
  const { task } = memberFacts(context.driver);
  assert.equal(task.assignee, workerId, `the claim belongs to the member's own worker (${workerId})`);
});
