import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  BatonApplication,
  GlmSessionCli,
  SignalLifecycleOwner,
  createDriver,
} from '../src/index.mjs';

const FAKE_CLAUDE = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase67-signal-${name}-`));
const principal = (id) => ({ actor: `signal:${id}`, principalId: id, sessionId: `${id}-session` });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(read, label) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await sleep(10);
  }
  throw new Error(`timeout waiting for ${label}`);
}

test('AX8: SIGINT then SIGHUP await exact GLM process, worktree, branch, writer, and application reaping', async (t) => {
  const repo = root('repo');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase67-signal@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 67 Signal'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const repoId = 'repo-phase67-signal';
  const route = { harness: 'glm', model: 'glm-5.2', effort: 'low' };
  const budget = { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 8 };
  const verification = {
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [],
  };
  const policy = {
    schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 60_000,
    riskClasses: ['low', 'medium', 'high', 'critical'],
    effectClasses: ['repository_edit', 'provider_call'], capabilityClasses: ['code', 'test'],
    limits: {
      maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
      maxTextBytes: 8_192, maxItems: 32, maxScopePaths: 32, maxRouteValues: 16,
      maxGoalBytes: 64 * 1024, maxPlanBytes: 128 * 1024, maxStatusBytes: 256 * 1024,
      maxTokens: budget.tokens, maxUsd: budget.usd, maxWallMin: budget.wallMin,
      maxProviderTurns: budget.providerTurns,
    },
  };
  const profile = {
    schemaVersion: 1, repoId,
    definitionOfDone: ['The held provider is stopped only through application shutdown.'],
    constraints: ['Keep the test inside the fixture repository.'],
    risk: 'high', goalBudget: budget, nodeBudget: budget,
    pathScope: ['**'], verification, routes: [route],
    capabilities: ['code', 'test'], effects: ['repository_edit', 'provider_call'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
    followPolicy: {
      mode: 'enabled', maxWaitMs: 2_000, maxChanges: 16,
      maxResponseBytes: 64 * 1024, maxScanEvents: 128,
    },
  };
  const driver = createDriver({
    repoRoot: repo, repoId, logDir: root('log'),
    adapters: {
      glm: new GlmSessionCli({
        cmd: process.execPath, args: [FAKE_CLAUDE], authToken: 'fixture-only',
        model: route.model, killGraceMs: 20,
      }),
    },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId, profiles: { signal: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principal('cleanup')); } catch {}
  });

  const runId = 'run-phase67-signal-reap';
  await application.command('run.start', {
    intent: {
      runId, objective: 'HOLD_UNTIL_INTERRUPT and prove signal-owned cleanup.',
      profile: 'signal', route, scope: ['**'],
    },
  }, principal('owner'));
  const proposed = await application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
  const approve = proposed.outline.actions.find((action) => action.kind === 'approve_plan');
  await application.command('run.act', {
    runId, actionId: approve.actionId, inputs: {},
  }, principal('owner'));

  const handle = await until(() => {
    const candidate = driver.coordinator.list()[0];
    return ['initializing', 'ready'].includes(candidate?.processRef?.state) && candidate.worktree ? candidate : null;
  }, 'live GLM process and worktree');
  const pid = handle.processRef.pid;
  const worktree = handle.worktree;
  const branch = handle.sessionContext?.branch;
  assert.equal(alive(pid), true);
  assert.equal(existsSync(worktree), true);
  assert.equal(typeof branch, 'string');

  const signals = new EventEmitter();
  let markShutdownPending;
  let releaseShutdown;
  const shutdownPending = new Promise((resolve) => { markShutdownPending = resolve; });
  const shutdownRelease = new Promise((resolve) => { releaseShutdown = resolve; });
  const owner = new SignalLifecycleOwner({
    signalEmitter: signals,
    shutdown: async () => {
      markShutdownPending();
      await shutdownRelease;
      return application.shutdown(principal('signal-shutdown'));
    },
  });
  const lifecyclePromise = owner.run(async ({ signal }) => {
    if (!signal.aborted) await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return { state: 'interrupted' };
  });
  signals.emit('SIGINT');
  await shutdownPending;
  assert.equal(alive(pid), true, 'first trigger does not preempt provider reaping');
  assert.equal(existsSync(worktree), true, 'first trigger does not preempt worktree reaping');
  signals.emit('SIGHUP');
  releaseShutdown();
  const lifecycle = await lifecyclePromise;

  assert.equal(lifecycle.trigger.kind, 'SIGINT');
  assert.equal(lifecycle.signalCount, 2);
  assert.equal(lifecycle.closed.state, 'closed');
  assert.equal(lifecycle.closed.receipt.fleet.targetCount, 1);
  assert.equal(lifecycle.closed.receipt.fleet.counts.killConfirmed, 1);
  assert.equal(lifecycle.closed.receipt.fleet.counts.processesObserved, 1);
  assert.equal(lifecycle.closed.receipt.fleet.counts.processesClosed, 1);
  assert.equal(lifecycle.closed.receipt.authority.coordinatorClosed, true);
  assert.equal(lifecycle.closed.receipt.authority.writerReleased, true);
  assert.equal(alive(pid), false);
  assert.equal(existsSync(worktree), false);
  assert.equal(execFileSync('git', ['branch', '--list', branch], { cwd: repo, encoding: 'utf8' }).trim(), '');
});
