import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, CoordinationStore, MockAdapter, createDriver } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase66-${name}-`));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase66',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
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

function configuredAdapter(scenario = { outcome: 'completed', delayMs: 30, summary: 'follow fixture completed' }) {
  const adapter = new MockAdapter({ harness: 'mock', scenario });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function applicationProfile(followPolicy) {
  const value = {
    schemaVersion: 1,
    repoId: 'repo-phase66',
    definitionOfDone: ['deployment verification passes'],
    constraints: ['Keep the change inside the approved repository scope'],
    risk: 'high',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['impl/**'],
    verification,
    routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
    capabilities: ['code', 'test'],
    effects: ['repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  };
  if (followPolicy !== null) value.followPolicy = followPolicy;
  return value;
}

function fixture(name, {
  followPolicy = {
    mode: 'enabled', maxWaitMs: 2_000, maxChanges: 2,
    maxResponseBytes: 64 * 1024, maxScanEvents: 64,
  },
  scenario,
  applicationAuthorize = async () => true,
} = {}) {
  const repo = root(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase66@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 66'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const logDir = root(`${name}-log`);
  const profile = applicationProfile(followPolicy);
  const adapter = configuredAdapter(scenario);
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-phase66', logDir, adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-phase66', profiles: { continuation: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: applicationAuthorize,
  });
  return { application, driver, adapter, repo, logDir, profile };
}

function reopen(f) {
  const adapter = configuredAdapter();
  const driver = createDriver({
    repoRoot: f.repo, repoId: 'repo-phase66', logDir: f.logDir, adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-phase66', profiles: { continuation: f.profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  return { ...f, application, driver, adapter };
}

const intent = (runId) => ({
  runId,
  objective: `Follow ${runId} through the integrated application`,
  profile: 'continuation',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
});

test('CE1-CE4: Run follow is at-least-once, bounded, paged, and excludes sibling-Run changes', async () => {
  const f = fixture('follow-page');
  const runId = 'run-follow-primary';
  const proposed = await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  const afterCursor = proposed.cursor;
  await f.application.command('run.start', { intent: intent('run-follow-sibling') }, principal('sibling'));
  await f.application.command('run.approve', {
    runId, planDigest: proposed.plan.digest,
  }, principal('approver'));

  const first = await f.application.command('run.follow', {
    runId, afterCursor, timeoutMs: 500,
  }, principal('owner'));
  assert.equal(first.runId, runId);
  assert.equal(first.follow.afterCursor, afterCursor);
  assert.equal(first.follow.changes.length, 2);
  assert.equal(first.follow.hasMore, true);
  assert.ok(first.follow.throughCursor > afterCursor);
  assert.equal(first.follow.changes.every((change) => Object.keys(change).sort().join(',') === 'category,kind,seq,summary'), true);
  assert.equal(JSON.stringify(first.follow).includes('run-follow-sibling'), false);
  assert.equal(JSON.stringify(first.follow).includes(f.repo), false);

  const replay = await f.application.command('run.follow', {
    runId, afterCursor, timeoutMs: 500,
  }, principal('owner'));
  assert.deepEqual(replay.follow, first.follow);

  const second = await f.application.command('run.follow', {
    runId, afterCursor: first.follow.throughCursor, timeoutMs: 500,
  }, principal('owner'));
  assert.ok(second.follow.throughCursor > first.follow.throughCursor);
  assert.equal(new Set([...first.follow.changes, ...second.follow.changes].map((change) => change.seq)).size,
    first.follow.changes.length + second.follow.changes.length);

  await f.application.command('run.stop', { runId, reason: 'End the paging fixture.' }, principal('stopper'));
  await f.application.shutdown(principal('admin'));
});

test('CE3/CE5: timeout, ahead-cursor refusal, policy refusal, and restart preserve follow truth', async () => {
  let f = fixture('follow-restart');
  const runId = 'run-follow-restart';
  const proposed = await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  const timeout = await f.application.command('run.follow', {
    runId, afterCursor: proposed.cursor, timeoutMs: 20,
  }, principal('owner'));
  assert.equal(timeout.follow.timedOut, true);
  assert.equal(timeout.follow.throughCursor, proposed.cursor);
  assert.deepEqual(timeout.follow.changes, []);
  await assert.rejects(f.application.command('run.follow', {
    runId, afterCursor: timeout.follow.observedUpperBound + 1, timeoutMs: 20,
  }, principal('owner')), (error) => error.code === 'application_follow_cursor_ahead');
  await assert.rejects(f.application.command('run.follow', {
    runId, afterCursor: proposed.cursor, timeoutMs: f.profile.followPolicy.maxWaitMs + 1,
  }, principal('owner')), (error) => error.code === 'application_follow_invalid');

  await f.application.detach();
  f = reopen(f);
  await f.application.ready;
  const approved = await f.application.command('run.approve', {
    runId, planDigest: proposed.plan.digest,
  }, principal('approver'));
  const resumed = await f.application.command('run.follow', {
    runId, afterCursor: proposed.cursor, timeoutMs: 500,
  }, principal('owner'));
  assert.ok(resumed.follow.changes.length > 0);
  assert.ok(resumed.follow.throughCursor <= resumed.follow.observedUpperBound);
  assert.equal(['running', 'work_completed'].includes(approved.phase), true);
  await f.application.command('run.stop', { runId, reason: 'End the restart fixture.' }, principal('stopper'));
  await f.application.shutdown(principal('admin'));

  const disabled = fixture('follow-disabled', { followPolicy: null });
  const disabledRun = await disabled.application.command('run.start', {
    intent: intent('run-follow-disabled'),
  }, principal('owner'));
  await assert.rejects(disabled.application.command('run.follow', {
    runId: disabledRun.runId, afterCursor: disabledRun.cursor, timeoutMs: 20,
  }, principal('owner')), (error) => error.code === 'application_follow_unavailable');
  await disabled.application.detach();
});

test('CE3: coordination append notification closes the check-register race and supports cancellation', async () => {
  const store = new CoordinationStore(root('wait-after-store'));
  store.claimWriterLease();
  const waiting = store.waitAfter(0, 1_000);
  store.createTask({ id: 'wait-task', brief: {}, deps: [], runId: null }, { actor: 'test', key: 'wait-task:create' });
  assert.deepEqual(await waiting, { advanced: true, upperBound: 1 });
  assert.deepEqual(await store.waitAfter(0, 1_000), { advanced: true, upperBound: 1 });

  const abort = new AbortController();
  const cancelled = store.waitAfter(1, 1_000, { signal: abort.signal });
  abort.abort();
  await assert.rejects(cancelled, (error) => error.code === 'coordination_wait_aborted');
  store.releaseWriterLease();
});

test('CE3/CE5: follow reauthorizes after waiting and application shutdown cancels pending readers', async () => {
  let followAuthorizations = 0;
  const f = fixture('follow-reauthorize', {
    applicationAuthorize: async ({ command }) => {
      if (command !== 'run.follow') return true;
      followAuthorizations += 1;
      return followAuthorizations === 1;
    },
  });
  const runId = 'run-follow-reauthorize';
  const proposed = await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  const following = f.application.command('run.follow', {
    runId, afterCursor: proposed.cursor, timeoutMs: 1_000,
  }, principal('owner'));
  const reauthorized = assert.rejects(following, (error) => error.code === 'application_unauthorized');
  await f.application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));
  await reauthorized;
  await f.application.command('run.stop', { runId, reason: 'End the reauthorization fixture.' }, principal('stopper'));
  await f.application.shutdown(principal('admin'));

  const closing = fixture('follow-close');
  const closeRun = await closing.application.command('run.start', {
    intent: intent('run-follow-close'),
  }, principal('owner'));
  const pending = closing.application.command('run.follow', {
    runId: closeRun.runId, afterCursor: closeRun.cursor, timeoutMs: 1_000,
  }, principal('owner'));
  const cancelled = assert.rejects(pending, (error) => error.code === 'application_follow_cancelled');
  await closing.application.shutdown(principal('admin'));
  await cancelled;
});

test('CE2/CE10: contradictory explicit Run identity loses to fail-closed task attribution', async () => {
  const f = fixture('follow-contradictory-attribution');
  const runId = 'run-follow-attribution';
  const proposed = await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  await f.application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));
  const task = f.driver.coordination.snapshot().tasks.find((candidate) => candidate.runId === runId);
  assert.ok(task);
  const injected = f.driver.coordination.recordDriver('test.contradictory_attribution', {
    taskId: task.id, runId: 'run-follow-sibling', detail: 'must not project',
  }, { actor: 'test', key: 'contradictory-attribution' }).event;
  const page = await f.application.command('run.follow', {
    runId, afterCursor: injected.seq - 1, timeoutMs: 20,
  }, principal('owner'));
  assert.equal(page.follow.changes.some((change) => change.seq === injected.seq), false);
  assert.ok(page.follow.throughCursor >= injected.seq);
  await f.application.command('run.stop', { runId, reason: 'End attribution fixture.' }, principal('stopper'));
  await f.application.shutdown(principal('admin'));
});
