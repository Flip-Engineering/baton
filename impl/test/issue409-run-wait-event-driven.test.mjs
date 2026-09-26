// Issue #409 (audit C36, principle P11): one contract, two wait disciplines. run.wait polled
// the worker-plane coordinator on a 100 ms sleep loop (`coordinator.wait(Math.min(100, ...))`)
// while run.follow and run.inspect park on the event-driven coordination change signal
// (`coordination.waitAfter(view.cursor, remaining)`). The fix parks run.wait on that SAME
// primitive with the caller's remaining budget and retires the fixed cadence.
//
// Fixture idiom: blind-waits-red.test.mjs (a real createDriver + BatonApplication stack over a
// MockAdapter, a parent orchestrator task + recursive lease, so run.start/run.wait run through
// the REAL seams). Spies wrap and call through, so every row observes the real primitive.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { MockAdapter } from '../src/adapter.mjs';
import { BatonApplication } from '../src/application.mjs';
import { createDriver } from '../src/index.mjs';

const NOW = '2026-08-13T08:00:00.000Z';
const REPO = 'repo-issue409';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const root = (label) => mkdtempSync(join(tmpdir(), `baton-409-${label}-`));
const principal = (principalId) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
});

const runLineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 4, maxChildrenPerRun: 4, maxDescendantsPerRoot: 16, leaseTtlMs: 60_000,
});
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId: REPO,
  mandatory: false,
  approvalTtlMs: 60 * 60 * 1_000,
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
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1,
  repoId: REPO,
  definitionOfDone: ['the recursive result is mechanically verified'],
  constraints: ['remain inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  followPolicy: {
    mode: 'enabled', maxWaitMs: 1_000, maxChanges: 8,
    maxResponseBytes: 64 * 1024, maxScanEvents: 32,
  },
});

function configuredAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 25, summary: 'done', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function createParentTask(store, label) {
  const runId = `run-${label}-parent`;
  const taskId = `task-${label}-parent`;
  const workerId = `worker-${label}-parent`;
  store.createTask({
    id: taskId,
    brief: { objective: 'Probe the run.wait event-driven discipline.', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'mock', modelRequested: 'model-a',
    modelPolicy: null, effortRequested: 'low', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = store.claimTask(taskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  }, {
    harnessRequested: 'mock', harnessResolved: 'mock@fixture',
    modelRequested: 'model-a', modelResolved: 'model-a', modelObserved: 'model-a',
    effortRequested: 'low', effortResolved: 'low', effortObserved: 'low',
    routeKey: '["mock","fixture","model-a","low"]',
  }).task;
  return { runId, taskId, workerId, task };
}

function issueLease(store, parent, recursivePrincipal) {
  const session = {
    principalId: recursivePrincipal.principalId,
    sessionId: recursivePrincipal.sessionId,
    authorityDigest: digest({
      kind: 'authenticated-recursive-session',
      principalId: recursivePrincipal.principalId,
      sessionId: recursivePrincipal.sessionId,
    }),
    expiresAt: '2026-08-13T09:00:00.000Z',
  };
  const identity = {
    repoId: REPO, parentRunId: parent.runId, parentTaskId: parent.taskId,
    parentTaskVersion: parent.task.version, workerId: parent.workerId,
    principalId: session.principalId, sessionId: session.sessionId,
    sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(identity)}`;
  return store.issueRunOrchestratorLease({
    schemaVersion: 1, repoId: REPO,
    parentTask: { id: parent.taskId, version: parent.task.version }, session,
  }, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` }).lease;
}

function recursiveContext(lease, requestId = 'recursive-request-1') {
  return {
    transport: 'direct', requestId,
    idempotencyKey: `direct.recursive:${requestId}`,
    sessionAuthority: {
      schemaVersion: 1,
      authorityDigest: lease.session.authorityDigest,
      expiresAt: lease.session.expiresAt,
      orchestratorLeaseId: lease.leaseId,
    },
  };
}

function fixture(label) {
  const repository = root(`${label}-repo`);
  const logDir = root(`${label}-log`);
  execFileSync('git', ['init', '-q'], { cwd: repository });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue409@example.invalid', GIT_COMMITTER_EMAIL: 'issue409@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 409', GIT_COMMITTER_NAME: 'Issue 409' });
  writeFileSync(join(repository, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repository });
  const driver = createDriver({
    repoRoot: repository, repoId: REPO, logDir, now: () => Date.parse(NOW),
    adapters: { mock: configuredAdapter() }, runLineagePolicy,
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
    watchdog: { stallMs: 60_000 },
  });
  const application = new BatonApplication({
    driver, repoId: REPO, profiles: { recursive: profile },
    principals: {
      planner: principal(`${label}-planner`), dispatcher: principal(`${label}-dispatcher`),
      observer: principal(`${label}-observer`),
    },
    authorize: async () => true,
  });
  const parent = createParentTask(driver.coordination, label);
  const recursivePrincipal = principal(`${label}-recipient`);
  const lease = issueLease(driver.coordination, parent, recursivePrincipal);
  return {
    application, driver, lease, logDir, parent, recursivePrincipal, repository,
  };
}

const intent = (runId) => ({
  runId,
  objective: 'Probe the run.wait event-driven discipline on one bounded run.',
  profile: 'recursive',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
});

async function startRun(f, runId, label) {
  return f.application.command(
    'run.start', { intent: intent(runId) }, f.recursivePrincipal,
    recursiveContext(f.lease, `${label}-start`),
  );
}

function admitStop(f, runId, reason) {
  const reasonDigest = digest(reason);
  return f.driver.coordination.admitRunStop({
    schemaVersion: 1, repoId: REPO, runId, reasonDigest,
    requestDigest: digest({ repoId: REPO, runId, reasonDigest }),
  }, { actor: 'direct:issue409', key: `run.stop:${runId}` });
}

function durableStopReceipt(stop) {
  const counts = {
    pendingCancelled: 0, killConfirmed: 0, alreadyTerminal: 0,
    processesObserved: 0, processesClosed: 0,
  };
  const checks = { dispatchClosed: true, interactionsResolved: true, runAuthorityReleased: true };
  const effects = { coordinatorClosed: false, writerReleased: false, transportsClosed: false };
  const core = {
    schemaVersion: stop.schemaVersion, state: 'stopped', scope: stop.scope ?? 'run',
    repoId: stop.repoId, runId: stop.runId,
    targetCount: stop.targetWorkerIds.length, remainingCount: 0, targetDigest: stop.targetDigest,
    counts, checks, effects,
  };
  return { ...core, receiptDigest: digest(core) };
}

async function cleanupFixture(f) {
  try { await f.application.shutdown(principal('issue409-shutdown')); } catch { /* RED failures may interrupt setup */ }
  rmSync(f.repository, { recursive: true, force: true });
  rmSync(f.logDir, { recursive: true, force: true });
}

// The event-driven spy: wrap the REAL coordination.waitAfter, count the parks and record how
// each one resolved. Calling through keeps the wait honest — the row observes the primitive.
function spyWaitAfter(f) {
  const calls = [];
  const outcomes = [];
  const real = f.driver.coordination.waitAfter.bind(f.driver.coordination);
  f.driver.coordination.waitAfter = (afterSeq, timeoutMs, options) => {
    calls.push({ afterSeq, timeoutMs });
    return real(afterSeq, timeoutMs, options).then((result) => {
      outcomes.push(result);
      return result;
    });
  };
  return { calls, outcomes };
}

function countCoordinatorWait(f) {
  let calls = 0;
  const real = f.driver.coordinator.wait.bind(f.driver.coordinator);
  f.driver.coordinator.wait = async (...args) => { calls += 1; return real(...args); };
  return () => calls;
}

// Static source helpers (blind-waits idiom: NEVER whole-file-read application.mjs; every anchor
// uses grep -F/sed via execFileSync so the pin reads the committed source).
function srcAnchor(file, pattern) {
  const rootDir = fileURLToPath(new URL('../src/', import.meta.url));
  const out = execFileSync('/usr/bin/grep', ['-Fna', pattern, join(rootDir, file)], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  }).trim().split('\n').filter(Boolean);
  assert.ok(out.length > 0, `source anchor ${file} ~ ${pattern} not found`);
  const first = out[0];
  const colon = first.indexOf(':');
  return { line: Number(first.slice(0, colon)), text: first.slice(colon + 1) };
}
function srcRegion(file, fromLine, toLine) {
  const rootDir = fileURLToPath(new URL('../src/', import.meta.url));
  return execFileSync('/usr/bin/sed', ['-n', `${fromLine},${toLine}p`, join(rootDir, file)], {
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  });
}
function runWaitBody() {
  const start = srcAnchor('application.mjs', 'async wait(runId, rawObserver, options = {}, rawContext = null) {');
  const end = srcAnchor('application.mjs', '  _followCategory(event)');
  return srcRegion('application.mjs', start.line, end.line - 1).replace(/\/\/[^\n]*/gu, '');
}

// (a) run.wait resolves on the primitive's own wake: the terminal row lands mid-wait and the
// wait returns the terminal view within the primitive's latency — far under the retired 100 ms
// cadence. The promptness bound is DERIVED from the observed primitive call (its remaining
// budget), never a magic number; the redness at HEAD is the seam (no waitAfter park at all).
test('409-a RED: run.wait({until:"terminal"}) returns on the event-driven wake, not the next poll', async (t) => {
  const f = fixture('409a');
  t.after(() => cleanupFixture(f));
  const runId = 'run-issue409-a';
  const started = await startRun(f, runId, '409a');
  assert.equal(started.phase, 'awaiting_plan_approval');
  const spied = spyWaitAfter(f);

  let appendedAt = null;
  setTimeout(() => {
    const admitted = admitStop(f, runId, 'Terminalize the run mid-wait.');
    f.driver.coordination.completeRunStop(runId, durableStopReceipt(admitted.stop), {
      actor: 'direct:issue409', key: `run.stop.complete:${runId}`,
    });
    appendedAt = Date.now();
  }, 100);

  const timeoutMs = 5_000;
  const view = await f.application.command('run.wait', {
    runId, until: 'terminal', timeoutMs,
  }, f.recursivePrincipal, recursiveContext(f.lease, '409a-wait'));
  const returnedAt = Date.now();

  assert.ok(spied.calls.length >= 1,
    'stage[event-driven-wait-missing]: run.wait must park on coordination.waitAfter (the same '
    + 'primitive run.follow/run.inspect park on); at HEAD it polls coordinator.wait on a 100 ms '
    + 'cadence and never touches waitAfter');
  assert.ok(spied.outcomes.some((outcome) => outcome?.advanced === true),
    'the terminal append must wake the park (advanced:true) instead of being observed a poll later');
  assert.equal(view.phase, 'stopped', 'the post-wake status re-read returns the terminal view');
  // Promptness against the primitive's OWN budget: the first park's remaining is the caller's
  // deadline minus elapsed; the wake resolves in primitive latency, orders below that budget.
  const budget = spied.calls[0].timeoutMs;
  assert.ok(Number.isSafeInteger(budget) && budget > 0 && budget <= timeoutMs,
    'the park is bounded by the caller deadline, never a fixed cadence');
  // Both numeric asserts below read DERIVED bounds (the observed park budget and the
  // caller deadline), never a magic number; the measured post-append latency is reported in
  // the message so the run shows the wake resolving in primitive latency, far under the
  // retired 100 ms cadence.
  assert.ok(appendedAt !== null && (returnedAt - appendedAt) < budget,
    `the wait returned ${appendedAt === null ? 'without observing the append' : `${returnedAt - appendedAt}ms after the terminal row landed`} against the park budget ${budget}ms (caller deadline ${timeoutMs}ms)`);
  assert.ok((returnedAt - appendedAt) <= timeoutMs,
    'the terminal wake returns inside the caller deadline');
});

// (b) an unreachable condition parks ONCE to its deadline: exactly one primitive wake (the
// deadline expiry) and no intermediate polls — the coordinator sleep behind the loop fires no
// more often than the primitive wakes.
test('409-b RED: run.wait with an unreachable condition returns at its deadline without intermediate polls', async (t) => {
  const f = fixture('409b');
  t.after(() => cleanupFixture(f));
  const runId = 'run-issue409-b';
  const started = await startRun(f, runId, '409b');
  assert.equal(started.phase, 'awaiting_plan_approval');
  const spied = spyWaitAfter(f);
  const coordinatorWaits = countCoordinatorWait(f);

  const timeoutMs = 800;
  const before = Date.now();
  const view = await f.application.command('run.wait', {
    runId, until: 'terminal', timeoutMs,
  }, f.recursivePrincipal, recursiveContext(f.lease, '409b-wait'));
  const elapsed = Date.now() - before;

  assert.equal(spied.outcomes.length, 1,
    'stage[poll-loop-survives]: one park resolves the whole wait; at HEAD the 100 ms poll loop '
    + `never parks (observed ${spied.outcomes.length} waitAfter resolutions)`);
  assert.equal(spied.outcomes[0]?.advanced, false, 'the single wake is the deadline expiry');
  assert.ok(coordinatorWaits() <= spied.outcomes.length,
    `the coordinator sleep behind the loop fires no more often than the primitive wakes (sleeps ${coordinatorWaits()}, wakes ${spied.outcomes.length}); at HEAD it fires every ~100 ms`);
  assert.ok(!['completed', 'failed', 'inconclusive', 'cancelled', 'denied', 'stopped'].includes(view.phase),
    'the deadline view is the still-unreached condition, honestly unmet');
  // The hold is proved by the advanced:false expiry; elapsed corroborates against the
  // OBSERVED park budget (50 ms scheduling slop — the park timer, like every timer, may fire
  // a tick early — never a second magic bound).
  assert.ok(elapsed >= spied.calls[0].timeoutMs - 50,
    `the wait holds to its deadline (observed ${elapsed}ms against park budget ${spied.calls[0].timeoutMs}ms)`);
});

// (c) no sleep cadence literal remains in run.wait: the 100 ms poll bound is gone (a surviving
// cadence would live as a limits.mjs row with a derivation, never a literal); the parks name
// the viewed cursor.
test('409-c RED: application.mjs run.wait names no sleep cadence literal', async () => {
  const body = runWaitBody();
  assert.ok(!/\(\s*100\s*[,)]/.test(body),
    'stage[sleep-cadence-literal]: run.wait still names the 100 ms poll cadence');
  assert.ok(!/coordinator\.wait\(\s*Math\.min/.test(body),
    'stage[sleep-cadence-literal]: run.wait still paces on coordinator.wait with a sliced budget');
  assert.ok(/coordination\?\.waitAfter/.test(body),
    'stage[event-driven-wait-missing]: run.wait must prefer the coordination change signal '
    + '(waitAfter), the same primitive run.follow and run.inspect park on');
  assert.ok(/park\(view\.cursor,\s*remaining\)/.test(body),
    'stage[event-driven-wait-missing]: both wait loops must park the VIEWED cursor against the '
    + "caller's remaining budget");
});
