// [attempt: 4b19d324-91d7-4f4f-86af-aa156a744331 row-plan-effects]
// row-plan-effects attempt 4b19d324-91d7-4f4f-86af-aa156a744331 — #240 red-first pin: the
// wave coordinator (verification) seat's plan must not REQUIRE repository_edit.
// Authority: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-a/row-plan-effects-brief.md
//   + the wave-b dispatch brief (attempt line above). Measured (wave-h): the wave's coordinator
//   seat — whose duty is verification (read the rows' deliverables, write verify-notes.md) —
//   failed the trust gate `required_effect_absent` because its plan minted from the deployment
//   profile carries requiredEffects:['repository_edit']. An honest verifier with no diff can
//   never satisfy that gate. The gate is correct; the PLAN SHAPE is wrong for the role.
//
// The two assertions (per the dispatch brief):
//   1. coordinator-seat plan/brief: repository_edit stays DECLARED (in effects — the
//      verify-notes write stays in-scope when it happens) but is NOT required (absent from
//      requiredEffects) — the seat must be able to complete with no diff.
//   2. row-seat control: repository_edit stays REQUIRED — the trust gate is preserved for
//      ordinary wave members, so the fix can never be a blanket effects weakening.
//
// At HEAD the coordinator seat's plan node carries requiredEffects:['repository_edit'] minted
// verbatim from the deployment profile (application.mjs singleNode), so assertion 1 fails RED
// with exactly the wrong-for-the-role shape; assertion 2 is the still-green control. The wave
// machinery passes driverKind:'wave' + waveId + waveRole + waveStart through run.start exactly
// as createWave does (wave.mjs:243-247), and the plan is read back from the authoritative
// store index (coordination-store.mjs goalPlanRun) — never a projected view.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDriver } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';

const REPO = 'repo-coordinator-plan-effects-240';
const WAVE_ID = 'wave:0123456789abcdef0123456789abcdef';

const principal = (id) => ({ actor: `plan-effects:${id}`, principalId: id, sessionId: `${id}-session` });
const root = (prefix) => mkdtempSync(join(tmpdir(), `baton-${prefix}-`));

// The deployment-profile shape the coordinator seat actually mints from: effects declares
// repository_edit AND requiredEffects requires it (application-deployment.mjs:947-948).
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: false,
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

const profile = Object.freeze({
  schemaVersion: 1,
  repoId: REPO,
  definitionOfDone: ['the role deliverable is verified'],
  constraints: [],
  risk: 'high',
  goalBudget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 12 },
  nodeBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 6 },
  pathScope: ['docs/**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  requiredEffects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

function mockAdapter() {
  const instance = new MockAdapter({ harness: 'mock', scenario: {
    outcome: 'completed', delayMs: 5, summary: 'done', files: {},
  } });
  const card = instance.card.bind(instance);
  instance.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return instance;
}

async function buildFixture() {
  const repo = root('coordinator-plan-effects-repo');
  const logDir = root('coordinator-plan-effects-log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'plan-effects@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Plan Effects 240'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir, now: () => Date.now(),
    adapters: { mock: mockAdapter() },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: REPO, profiles: { default: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  return { application, driver, repo, logDir };
}

async function cleanup(f) {
  try { await f.application.close?.(); } catch { /* a RED failure may interrupt teardown */ }
}

// The coordinator seat starts exactly as createWave starts its members (wave.mjs:243-247):
// driverKind:'wave' + waveId + waveRole + waveStart riding run.start options.
async function startCoordinator(f) {
  return f.application.command('run.start', { intent: {
    runId: 'run-coordinator-seat',
    objective: 'Verify the row deliverables and write the verify-notes.',
    profile: 'default', driverKind: 'wave', waveId: WAVE_ID, waveRole: 'coordinator',
    waveStart: { roster: ['coordinator', 'row-alpha'], idempotencyKey: 'plan-effects-coordinator' },
    route: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['docs/**'],
  } }, principal('owner'));
}

// A row seat is a wave member with any NON-verification role (here 'row-alpha').
async function startRow(f) {
  return f.application.command('run.start', { intent: {
    runId: 'run-row-seat',
    objective: 'Implement the row slice.',
    profile: 'default', driverKind: 'wave', waveId: WAVE_ID, waveRole: 'row-alpha',
    route: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['docs/**'],
  } }, principal('owner'));
}

test('coordinator-seat plan: repository_edit stays DECLARED but is NOT required — a diff-less verifier must not fail required_effect_absent', async (t) => {
  const f = await buildFixture();
  try {
    await startCoordinator(f);
    const plan = f.driver.coordination.goalPlanRun(REPO, 'run-coordinator-seat')?.plan;
    assert.ok(plan, 'the coordinator run must mint a plan at run.start');
    const node = plan.nodes[0];
    assert.ok(node, 'the coordinator plan must carry its node');
    assert.ok(node.effects.includes('repository_edit'),
      'repository_edit stays DECLARED — the verify-notes write stays in-scope when it happens');
    assert.equal((node.requiredEffects ?? []).includes('repository_edit'), false,
      'repository_edit is NOT REQUIRED for the verification seat — an honest verifier with no diff completes (RED at HEAD: the profile-minted requiredEffects:[repository_edit] survives into the node)');
  } finally {
    await cleanup(f);
  }
});

test('row-seat control: repository_edit stays REQUIRED — the trust gate is preserved for ordinary wave members', async (t) => {
  const f = await buildFixture();
  try {
    await startRow(f);
    const plan = f.driver.coordination.goalPlanRun(REPO, 'run-row-seat')?.plan;
    assert.ok(plan, 'the row run must mint a plan at run.start');
    const node = plan.nodes[0];
    assert.ok(node, 'the row plan must carry its node');
    assert.deepEqual(node.requiredEffects, ['repository_edit'],
      'a row seat still REQUIRES repository_edit — the fix must never be a blanket effects weakening');
    assert.ok(node.effects.includes('repository_edit'), 'the row seat keeps the declared effect');
  } finally {
    await cleanup(f);
  }
});
