import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAdapter, createDriver } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';

// #240 red pin — coordinator plans over-declare repository_edit for verification roles.
//
// Measured (wave-h, the no-clock-followons coordinator): the coordinator seat's plan —
// minted from the deployment profile at admission (application.mjs singleNode) — carries
// requiredEffects: ['repository_edit']. An honest coordinator whose deliverable is the
// verification verdict, not a diff, then fails the trust gate with required_effect_absent.
//
// The contract: repository_edit stays DECLARED for the coordinator seat (it may still
// write its verify-notes) but is never REQUIRED — absence of an edit is not a violation
// for a verification duty. Implementation/row seats keep the requirement.
//
// RED   = a driverKind:'wave', waveRole:'coordinator' run's spawn brief carries
//         requiredEffects including repository_edit.
// GREEN = the coordinator seat's brief carries effects including repository_edit but
//         requiredEffects WITHOUT it; a row seat's brief keeps it required.

const REPO = 'issue-240-repo';

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 60_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 16, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 100_000, maxUsd: 10, maxWallMin: 60, maxProviderTurns: 100,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: REPO,
  definitionOfDone: ['the work is done'],
  constraints: ['remain inside scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit', 'provider_call'],
  requiredEffects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

function briefCapturingAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'done', files: {} },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['mock-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  const briefs = [];
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = async (worker, brief, opts = {}) => {
    briefs.push(brief);
    return spawn(worker, brief, opts);
  };
  return { adapter, briefs };
}

function fixture(label) {
  const repository = mkdtempSync(join(tmpdir(), `bt240-${label}-repo-`));
  const logDir = mkdtempSync(join(tmpdir(), `bt240-${label}-log-`));
  execFileSync('git', ['init', '-q'], { cwd: repository });
  execFileSync('git', ['config', 'user.email', 'issue240@example.invalid'], { cwd: repository });
  execFileSync('git', ['config', 'user.name', 'Issue 240'], { cwd: repository });
  writeFileSync(join(repository, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '-A'], { cwd: repository });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repository });
  const { adapter, briefs } = briefCapturingAdapter();
  const driver = createDriver({
    repoRoot: repository, repoId: REPO, logDir, now: Date.now,
    adapters: { mock: adapter }, goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000, watchdog: { stallMs: 60_000 },
  });
  const principalId = `${label}-principal`;
  const application = new BatonApplication({
    driver, repoId: REPO, profiles: { default: profile },
    principals: { owner: { actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers: ['plan', 'dispatch', 'observe'], repoId: REPO, runId: null, idempotencyKey: `${label}-owner` } },
    authorize: async () => true,
  });
  return { application, adapter, briefs, repository, cleanup: () => { rmSync(repository, { recursive: true, force: true }); rmSync(logDir, { recursive: true, force: true }); } };
}

const owner = (label) => ({ actor: `direct:${label}-principal`, principalId: `${label}-principal`, sessionId: `${label}-principal-session` });

test('COORDINATOR-SEAT (#240): the wave coordinator\'s plan declares repository_edit but never requires it', async (t) => {
  const f = fixture('coord');
  t.after(() => { try { f.cleanup(); } catch {} });
  const started = await f.application.start({
    runId: 'run-240-coordinator',
    objective: 'Verify rows and write verify-notes.',
    profile: 'default',
    route: { harness: 'mock', model: 'model-a', effort: 'low' },
    scope: ['docs/**'],
    driverKind: 'wave',
    waveId: 'wave-240-a',
    waveRole: 'coordinator',
  }, owner('coord'), { transport: 'direct', requestId: 'coord-1', idempotencyKey: 'direct:coord-1' });
  assert.ok(started?.runId || started?.ok !== false, `run started (${JSON.stringify(started).slice(0, 120)})`);
  assert.ok(f.briefs.length >= 1, `a worker was spawned with a brief (got ${f.briefs.length})`);
  const brief = f.briefs[0];
  assert.ok(brief.effects?.includes('repository_edit'),
    'repository_edit stays DECLARED for the coordinator seat (the verify-notes write is in-scope when it happens)');
  assert.equal((brief.requiredEffects ?? []).includes('repository_edit'), false,
    `the coordinator seat's brief must NOT require repository_edit (got ${JSON.stringify(brief.requiredEffects)}) — an honest verifier with no diff must not fail required_effect_absent`);
});

test('ROW-SEAT (control): an implementation seat keeps repository_edit required', async (t) => {
  const f = fixture('row');
  t.after(() => { try { f.cleanup(); } catch {} });
  await f.application.start({
    runId: 'run-240-row',
    objective: 'Implement the slice.',
    profile: 'default',
    route: { harness: 'mock', model: 'model-a', effort: 'low' },
    scope: ['impl/**'],
    driverKind: 'wave',
    waveId: 'wave-240-a',
    waveRole: 'row-implement',
  }, owner('row'), { transport: 'direct', requestId: 'row-1', idempotencyKey: 'direct:row-1' });
  assert.ok(f.briefs.length >= 1, `a worker was spawned with a brief (got ${f.briefs.length})`);
  assert.ok(f.briefs[0].requiredEffects?.includes('repository_edit'),
    'an implementation seat keeps repository_edit required');
});
