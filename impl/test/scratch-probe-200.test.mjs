// scratch probe — delete before landing.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { createWave } from '../src/wave.mjs';

const REPO = 'repo-scratch-200';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-s200-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}
function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

const PROFILE = Object.freeze({
  schemaVersion: 1, repoId: REPO, definitionOfDone: ['verification passes'],
  constraints: [], risk: 'low',
  goalBudget: { tokens: 200000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: [],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30000, maxOutputBytes: 65536,
    requiredPredecessorEvidence: [],
  },
  routes: [ROUTE],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const GOAL_PLAN_POLICY = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 3600000,
  riskClasses: ['low'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 65536, maxPlanBytes: 262144, maxStatusBytes: 262144,
    maxTokens: 1000000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10000,
  }),
});

async function harness(t, key) {
  const repo = root(`${key}-repo`);
  const logDir = root(`${key}-log`);
  mkdirSync(join(repo, 'reports'), { recursive: true });
  mkdirSync(join(repo, 'objectives'), { recursive: true });
  writeFileSync(join(repo, 'objectives', 'brief.md'), 'do the thing\n(marker:thing)\n');
  const tracker = { calls: [] };
  const adapter = new MockAdapter({ scenario: { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'scratch-200', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const scenario = goal.includes('(marker:thing)')
      ? { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] }
      : { outcome: 'completed' };
    tracker.calls.push({ worker, goal });
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: adapter },
    stopDeadlineMs: 2000,
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver, repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('s-planner'), dispatcher: principal('s-dispatcher'), observer: principal('s-observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  const baton = bindBaton(application, principal('s-owner'));
  t.after(async () => {
    try { await application.shutdown(principal('s-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, baton, driver, repo, tracker };
}

const member = (role, objective, options = {}) => ({
  role, objective: `${objective} (marker:thing)`,
  harness: 'mock', model: 'mock-model', effort: 'low',
  scope: ['reports/**'], report: `reports/${role}.md`, ...options,
});

test('PROBE-4: wave 1 completes; wave 2 same objective binds', async (t) => {
  const { baton, driver, tracker } = await harness(t, 'p4');
  const obj = 'identical objective text';
  execFileSync('git', ['add', '-A'], { cwd: driver.repoRoot });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '-q', '-m', 'brief'], { cwd: driver.repoRoot });
  const dirtyProbe = () => {
    try {
      const st = execFileSync('git', ['status', '--porcelain'], { cwd: driver.repoRoot, encoding: 'utf8' });
      console.log('REPO STATUS:', JSON.stringify(st));
    } catch { /* ignore */ }
  };
  const wt = driver.coordinator._worktrees;
  console.log('worktrees present:', Boolean(wt));
  if (wt && typeof wt.create === 'function') {
    const orig = wt.create.bind(wt);
    wt.create = (taskId, baseSha, opts) => orig(taskId, baseSha, opts).catch((err) => {
      console.log('WORKTREE CREATE FAILED:', err?.code, String(err?.message).slice(0, 300));
      throw err;
    });
  }
  const w1 = await createWave(baton, { members: [member('alpha', obj)], idempotencyKey: 'key-1', repoRoot: driver.repoRoot });
  dirtyProbe();
  const h1 = w1.runs.get('alpha');
  try {
    const workers = driver.coordinator.list().filter((w) => w.runId === h1?.id);
    for (const w of workers) {
      const log = w._log?.items ?? [];
      console.log('W1 worker log:', JSON.stringify(log.slice(-8).map((item) => ({ kind: item.kind, code: item.payload?.code ?? item.payload?.error?.code ?? null, summary: item.payload?.summary ?? null }))));
    }
  } catch (e) { console.log('W1 worker log err:', e?.code ?? String(e)); }
  const s1 = await w1.settle({ timeoutMs: 30000 });
  console.log('W1 outcome:', JSON.stringify(s1.map((o) => ({ role: o.role, phase: o.phase, error: o.error?.code, resultSha: o.resultSha ?? null }))));
  // wave 2 — identical objective, distinct key
  const w2 = await createWave(baton, { members: [member('alpha', obj)], idempotencyKey: 'key-2', repoRoot: driver.repoRoot });
  const s2 = await w2.settle({ timeoutMs: 30000 });
  console.log('W2 outcome:', JSON.stringify(s2.map((o) => ({ role: o.role, phase: o.phase, error: o.error?.code, resultSha: o.resultSha ?? null }))));
  console.log('spawn calls:', tracker.calls.length);
  const events = driver.coordination.eventsView();
  const regs = events.filter((e) => e.kind === 'driver.recorded' && e.payload?.kind === 'steering.registered');
  console.log('steering.registered:', JSON.stringify(regs.map((e) => ({ runId: e.payload.runId, waveId: e.payload.waveId }))));
  const created = events.filter((e) => e.kind === 'task.created');
  console.log('task.created:', created.length, JSON.stringify(created.map((e) => ({ taskId: e.taskId, runId: e.runId }))));
});
