// git-batch-216-red.test.mjs — red-first pin for #216: the per-member sync git digest goes
// batched.
//
// Defect (measured 2026-08-20): every waves.list page resolves each completed member's
// preserved-result ref with its OWN `git rev-parse` — a ~40 ms synchronous spawn per member
// on the event loop (index.mjs localGit): _buildView → coordinator.inspectPreservedResult →
// worktrees.resolveResult. ~90 members × ~3 git calls ≈ 11-13 s per waves_list. This pin:
// a page resolving N members' result refs makes ≤1 git invocation — ONE batched
// resolveResults (a single `git for-each-ref refs/baton/results/` process for the whole
// page), never N.
//
// The pin is STRUCTURAL (no wall clocks): a spy seam wraps the worktree manager's
// resolveResult/resolveResults (method-call count), and createDriver's gitExec spawn seam
// counts real git spawns. waves_list over a fixture of N completed preserved members must
// resolve the page in ≤1 resolution call. At HEAD the call count is N — RED at
// stage[git-batch-resolution-missing]. The batch must return exact shas: the batched
// inspection of a completed member still reads `pinned` against the real repo.
//
// Suite law: hermetic (mkdtemp fixture, no network) · no clocks as controls · watchdogs
// pinned positive · split-twice recorded below.

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

const REPO = 'repo-git-batch';
const MEMBER_COUNT = 5;

function root(label) {
  const dir = mkdtempSync(join(tmpdir(), `baton-gitbatch-${label}-`));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: dir });
  return dir;
}

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

// The spawn seam: createDriver's gitExec option replaces the worktree manager's git spawn
// for result-resolution paths, so the test counts REAL `git` processes, not just calls.
// When resolveResult/resolveResults delegate through it, the whole page pays one spawn.
function localGitEnv() {
  const env = {}; for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}

// One MockAdapter whose spawn() selects a scenario by matching the member marker in the brief.
function markerAdapter(scenariosByMarker) {
  const adapter = new MockAdapter({ scenario: scenariosByMarker.default ?? { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'git-batch-test', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const marker = Object.keys(scenariosByMarker).find((key) => key !== 'default' && goal.includes(key));
    const scenario = scenariosByMarker[marker] ?? scenariosByMarker.default;
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  return adapter;
}

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

function member(role) {
  return {
    role,
    objective: `write the ${role} report (marker:${role})`,
    harness: 'mock', model: 'mock-model', effort: 'low',
    scope: ['reports/**'],
    report: `reports/${role}.md`,
  };
}

test('GB-1 (stage[git-batch-resolution-missing]): a waves.list page resolves N completed members\' result refs with ≤1 git invocation — one batched resolveResults, never one per member', async (t) => {
  const repo = root('repo');
  const logDir = root('log');
  mkdirSync(join(repo, 'reports'), { recursive: true });
  let spawns = 0;
  const seam = (args, cwd, opts = {}) => {
    spawns += 1;
    return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts, cwd, env: localGitEnv() });
  };
  const scenarios = {};
  const members = [];
  for (let index = 0; index < MEMBER_COUNT; index += 1) {
    const role = `m${index}`;
    members.push(member(role));
    scenarios[role] = { outcome: 'completed', edits: [{ path: `reports/${role}.md`, content: `${role} report\n` }] };
  }
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir,
    adapters: { mock: markerAdapter(scenarios) },
    // The spawn seam: every preserved-result git spawn goes through this function.
    gitExec: seam,
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
    principals: {
      planner: principal('gb-planner'),
      dispatcher: principal('gb-dispatcher'),
      observer: principal('gb-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('gb-owner'));
  t.after(async () => {
    try { await application.shutdown(principal('gb-cleanup')); } catch { /* best effort */ }
    try { await driver.coordination?.releaseWriterLease?.(); } catch { /* best effort */ }
    try { await driver.closeAuthority?.(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  // Drive one real open wave with MEMBER_COUNT completed members — every member's result is
  // preserved under refs/baton/results/<sha> (the wave settles to result_ready, retained).
  const wave = await createWave(baton, { members });
  const outcomes = await wave.settle({ timeoutMs: 30_000 });
  assert.equal(outcomes.length, MEMBER_COUNT, 'fixture: every member got an outcome');
  for (const outcome of outcomes) {
    assert.equal(outcome.phase, 'result_ready',
      `fixture: ${outcome.role} reached the result-ready resting state`);
    assert.match(outcome.resultSha ?? '', /^[a-f0-9]{40}$/u,
      `fixture: ${outcome.role} preserved its result under refs/baton/results/`);
  }

  // The method spy seam: wrap the worktree manager's resolve entry points so waves.list's
  // per-member resolution is counted whether it goes through resolveResult (HEAD) or the
  // batched resolveResults (the fix). Count every resolution call AND every real git spawn.
  const manager = driver.coordinator._worktrees;
  const realResolveResult = manager.resolveResult.bind(manager);
  const realResolveResults = typeof manager.resolveResults === 'function' ? manager.resolveResults.bind(manager) : null;
  let resolveCalls = 0;
  let batchRefs = null;
  manager.resolveResult = async (ref) => { resolveCalls += 1; return realResolveResult(ref); };
  if (realResolveResults) {
    manager.resolveResults = async (refs) => { resolveCalls += 1; batchRefs = refs; return realResolveResults(refs); };
  }
  spawns = 0;

  const page = await application.command('waves.list', {}, principal('gb-owner'));
  assert.ok(Array.isArray(page?.waves) && page.waves.length >= 1, 'the open wave appears on the page');
  const membersOnPage = page.waves.reduce((sum, entry) => sum + (entry.roster?.length ?? 0), 0);
  assert.ok(membersOnPage >= MEMBER_COUNT, `the page carries all ${MEMBER_COUNT} members`);
  // The page rows are live reads, not nulls: every completed member projects its real phase.
  for (const entry of page.waves) {
    for (const roster of entry.roster) {
      assert.equal(roster.liveness, 'local');
      assert.ok(typeof roster.phase === 'string' && roster.phase.length > 0,
        `${roster.role} reads a live phase, not a hardcoded null`);
    }
  }

  assert.ok(resolveCalls <= 1,
    `stage[git-batch-resolution-missing]: waves.list resolved ${resolveCalls} preserved-result ref${resolveCalls === 1 ? '' : 's'} for ${membersOnPage} members — at HEAD the page resolves one ref per member (_buildView → inspectPreservedResult → resolveResult); the fix batches the page into one resolveResults call`);
  assert.ok(spawns <= 1,
    `stage[git-batch-resolution-missing]: the page paid ${spawns} git process${spawns === 1 ? '' : 'es'} for result resolution — the batch must be one for-each-ref process, never N`);
  if (realResolveResults) {
    assert.equal(batchRefs.length, MEMBER_COUNT,
      'the page batch carries every completed member\'s retained ref (one distinct ref each)');
  }

  // The batch returns exact shas, not placeholders: a batched inspection of a completed
  // member still reads `pinned` against the real repo (the fixture's refs resolve). The
  // captured sha / retained ref live on the coordinator's task authority, exposed through
  // coordinator.result() — the store row is a projection and does not carry them.
  const worker = driver.coordinator.list().find((entry) => entry.runId != null);
  assert.ok(worker, 'fixture: a completed member worker remains registered');
  const memberResult = await driver.coordinator.result(worker.id);
  assert.equal(memberResult.status, 'completed');
  const inspected = await driver.coordinator.inspectPreservedResults(
    [{ workerId: worker.id, expectedSha: memberResult.capturedSha }],
  );
  assert.equal(inspected.length, 1);
  assert.equal(inspected[0].state, 'pinned', 'the batched resolution reads the exact pinned sha');
  assert.equal(inspected[0].resolved, memberResult.capturedSha, 'the batched resolution returns the exact captured sha');
  assert.equal(inspected[0].ref, memberResult.retainedResultRef);
});

async function captureResult(fn) {
  try { return { value: await fn() }; } catch (error) { return { error }; }
}
