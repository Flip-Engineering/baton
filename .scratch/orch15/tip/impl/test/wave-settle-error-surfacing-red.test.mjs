import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDriver, createWave } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';

// #230 follow-on red pin — the SWALLOWED approve-phase startError. Measured 2026-08-15: when a
// member's runs.start succeeds but approve() throws (the worker_policy_invalid dispatch refusal),
// createWave records entry.startError AND keeps entry.run; the settle outcome then builds purely
// from the run view — phase 'stopped'/quiesced, error dropped. Six wave-b packs read as
// phantom-root/quiescence when the truth was a one-line typed refusal. A member whose approve
// threw is START-FAILED in wave terms: the machinery cannot dispatch it, and the settle receipt
// must say so — terminalCause 'start' with the typed error — never a silent quiesce.
//
// RED   = the outcome carries no error (the swallowed class).
// GREEN = outcome.error.code === the approve-phase error, terminalCause 'start', terminal true.

const principal = (id) => ({ actor: `pin:${id}`, principalId: id, sessionId: `${id}-session` });
const root = (prefix) => mkdtempSync(join(tmpdir(), `baton-${prefix}-`));

test('SETTLE-SURFACING: a member whose approve throws settles failed-with-cause, never silent', async () => {
  const repo = root('swallow-repo');
  const logDir = root('swallow-log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 's@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'S'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const worker = new MockAdapter({ harness: 'worker', scenario: { outcome: 'completed', delayMs: 5 } });
  const card = worker.card.bind(worker);
  worker.card = () => ({ ...card(), modelSelection: { mode: 'exact', configuredDefault: 'm', available: ['m'], family: 'f', acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null } });

  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-swallow', logDir, now: () => Date.now(),
    adapters: { worker },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId: 'repo-swallow', mandatory: true, approvalTtlMs: 3_600_000,
        riskClasses: ['low'], effectClasses: ['repository_edit'], capabilityClasses: ['code'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
    stopDeadlineMs: 1_000,
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-swallow',
    profiles: {
      plain: {
        schemaVersion: 1, repoId: 'repo-swallow',
        definitionOfDone: ['verification passes'], constraints: [], risk: 'low',
        goalBudget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 },
        nodeBudget: { tokens: 4_000, usd: 1, wallMin: 5, providerTurns: 4 },
        pathScope: ['**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 5_000, maxOutputBytes: 16 * 1024, requiredPredecessorEvidence: [] },
        routes: [{ harness: 'worker', model: 'm', effort: 'low' }],
        capabilities: ['code'], effects: ['repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
        integrationPolicy: { mode: 'none', strategies: [], requireAdoptedResult: false, requireSemanticReview: false },
      },
    },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true,
  });
  await application.ready;

  // A facade whose runs.start succeeds but whose run.approve THROWS a typed error — the
  // measured approve-phase failure shape (createWave calls start then approve per member).
  const approveError = Object.assign(new Error('harness "worker" cannot satisfy the requested worker permission policy'), { code: 'worker_policy_invalid' });
  const facade = {
    runs: {
      start: async (objective, options) => application.command('run.start', { intent: { runId: `run-${options.waveRole}`, objective, route: { harness: 'worker', model: 'm', effort: 'low' } } }, principal('owner')),
      list: async () => ({ items: [] }),
    },
    _assertWaveStartReplayable: undefined,
  };
  // Patch: wrap start so the returned handle's approve throws (the handle comes from the
  // application; override its act path by pre-invoking start through the real facade and
  // intercepting approve at the handle level).
  const realStart = facade.runs.start.bind(facade.runs);
  facade.runs.start = async (...args) => {
    await realStart(...args); // the run exists and is plannable — start succeeded
    return {
      approve: async () => { throw approveError; }, // the measured approve-phase refusal
      complete: async () => ({}),
      status: async () => ({ view: { phase: 'planning' } }), // honest pre-dispatch view
      stop: async () => ({}),
    };
  };

  try {
    const wave = await createWave(facade, {
      members: [{ role: 'solo', objective: 'swallow pin', harness: 'worker', model: 'm', effort: 'low', scope: ['out.md'] }],
      approve: true,
      repoRoot: repo,
    });
    // Run the wave's own settle with a bounded window; the member is approved-undispatched so
    const outcomes = await wave.settle({ timeoutMs: 2_000 });
    const outcome = outcomes.find((o) => o.role === 'solo');
    assert.ok(outcome, 'the member must settle');
    assert.equal(outcome.error?.code, 'worker_policy_invalid',
      `the approve-phase error must surface on the outcome (got ${JSON.stringify(outcome.error)})`);
    assert.equal(outcome.terminalCause, 'start', 'the cause class is start, never a silent quiesce');
    assert.equal(outcome.terminal, true);
  } finally {
    await application.close?.();
  }
});
