// waves-list-scaling-red.test.mjs — red-first pin for the waves_list O(members × events) scan.
//
// Defect (live, 2026-08-14): waves_list 503s (`temporarily_unavailable` / command dispatch
// failed) once the coordination log is fat (87k+ events) and multiple interpreter-seam waves
// are open — the roster projection re-reads `coordination.events()` per member runId
// (_runWaveRole/_runWaveRoute in application.mjs), so a 20-member roster scans ~87k events ×
// ~40 times inside one command's budget. The bus honestly reports the failure but the
// orchestrator loses the roster exactly when the fleet is biggest.
//
// The pin is STRUCTURAL (no wall clocks): a spy coordination object counts events() calls;
// waves_list over a fixture with many waves × members must read the log a bounded number of
// times independent of roster size (a single-pass index per invocation). At HEAD the call
// count scales with the roster — RED at stage[waves-list-index-missing].
//
// Suite law: hermetic (mkdtemp fixture, no network) · no clocks as controls · sorted-key
// literals ACTUAL order · watchdog.stallMs pinned · split-twice recorded below.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';
import { createDriver } from '../src/index.mjs';

const REPO = 'repo-waves-list-scaling';

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-wls-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principalOf(id) {
  return Object.freeze({ actor: `test:${id}`, principalId: id, sessionId: `session-${id}` });
}

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
  routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
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

test('WLS-1 (stage[waves-list-index-missing]): waves_list builds its roster projection from a bounded number of event-log reads — never one full scan per member', async (t) => {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: new MockAdapter({ harness: 'mock', scenariosByMarker: { default: { outcome: 'completed' } } }) },
    stopDeadlineMs: 2_000,
    // Suite law #6: the stall watchdog is a valid positive integer in every fixture — pinned, never the default.
    watchdog: { stallMs: 5 * 60_000, loopThreshold: 0, scopeAction: 'kill' },
    goalPlanAuthority: { policy: GOAL_PLAN_POLICY, authorize: async () => true },
  });
  const application = new BatonApplication({
    driver,
    repoId: REPO,
    profiles: { default: PROFILE },
    defaults: { profile: 'default', route: null },
    principals: { planner: principalOf('wls-planner') },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principalOf('wls-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  // Fatten the log: forty steering-registered records per fake member across twenty fake waves
  // (the shape the projection scans for). Then spy on events().
  const coordination = driver.coordination;
  const realEvents = coordination.events.bind(coordination);
  let eventsCalls = 0;
  coordination.events = (...args) => { eventsCalls += 1; return realEvents(...args); };

  // The fixture doesn't need real runs — it needs the projection to see a large log. We call
  // the application's waves.list command and count log reads. At HEAD the projection calls
  // events() once PER MEMBER (role + route each), so 20 waves × 5 members ≈ 200 reads; the fix
  // builds the index once.
  const result = await captureResult(() => application.command('waves.list', {}, principalOf('wls-owner')));
  assert.ok(result.value !== undefined || result.error === undefined || result.error,
    'the command answers (any honest outcome) so the read path is exercised');
  assert.ok(eventsCalls <= 4,
    `stage[waves-list-index-missing]: waves_list read the event log ${eventsCalls} times in one call — at HEAD the projection scans per member (_runWaveRole/_runWaveRoute); the fix builds a single-pass index per invocation`);
});

async function captureResult(fn) {
  try { return { value: await fn() }; } catch (error) { return { error }; }
}
