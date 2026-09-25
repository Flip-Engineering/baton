import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDriver } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';

// #230 red pin — the approval→dispatch seam on the MIGRATED fleet shape. The six wave-b packs
// (2026-08-15 03:16 UTC) plus the dispatch-seam probe all minted goal→plan→approval and then
// NEVER minted plan.node_dispatched / task.created — the interpreter drive polls an
// approved-undispatched run until quiescence stops it. The reap pin (181b9c35) proves the same
// chain green on a plain mock harness; this pin re-runs it with the migration's exact route
// coordinates: harness 'omp' and a provider-path model 'deepseek/deepseek-v4-flash'. RED =
// approval completes but no task is ever dispatched. GREEN = the dispatch mints.

const REPO = 'repo-dispatch-seam-pin';

const principal = (id) => ({ actor: `pin:${id}`, principalId: id, sessionId: `${id}-session` });
const root = (prefix) => mkdtempSync(join(tmpdir(), `baton-${prefix}-`));

function ompShapedAdapter() {
  const instance = new MockAdapter({ harness: 'omp', scenario: {
    outcome: 'completed', delayMs: 5, summary: 'probe done',
    edits: [{ path: 'impl/probe.mjs', content: 'export const probed = true;\n' }],
  } });
  const card = instance.card.bind(instance);
  instance.card = () => {
    const base = card();
    return {
      ...base,
      harness: 'omp',
      modelSelection: {
        mode: 'exact', configuredDefault: 'deepseek/deepseek-v4-flash',
        available: ['deepseek/deepseek-v4-flash'], family: 'omp',
        acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'],
        serviceTier: null, provenance: 'test', refreshedAt: null,
      },
    };
  };
  return instance;
}

async function buildFixture() {
  const repo = root('dispatch-seam-repo');
  const logDir = root('dispatch-seam-log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'seam@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Seam Pin'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const worker = ompShapedAdapter();
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir, now: () => Date.now(),
    adapters: { omp: worker },
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId: REPO, mandatory: true,
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
      }),
      authorize: async () => true,
    },
    stopDeadlineMs: 2_000,
  });

  const application = new BatonApplication({
    driver, repoId: REPO,
    profiles: {
      plain: {
        schemaVersion: 1,
        repoId: REPO,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'high',
        goalBudget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 12 },
        nodeBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 6 },
        pathScope: ['impl/**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [] },
        routes: [{ harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' }],
        capabilities: ['code', 'test'],
        effects: ['repository_edit'],
        integrationPolicy: { mode: 'none', strategies: [], requireAdoptedResult: false, requireSemanticReview: false },
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      },
    },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  return { application, driver, repo, logDir };
}

test('DISPATCH-SEAM: approving a plan on the migrated omp route shape dispatches the node (task created)', async () => {
  const { application, driver } = await buildFixture();
  try {
    const runId = 'run-dispatch-seam-1';
    const intent = {
      runId, objective: 'Implement the probe slice on the migrated route shape',
      profile: 'plain',
      route: { harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' },
    };
    const proposed = await application.command('run.start', { intent }, principal('owner'));
    assert.equal(proposed.plan?.digest !== undefined, true, 'run.start must advertise a plan digest');
    await application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));

    // THE SEAM: approval must have dispatched — a task exists for the plan node.
    const events = driver.coordination.events().filter((event) => event.kind === 'task.created');
    assert.equal(events.length, 1, `approval must dispatch exactly one task (got ${events.length})`);
    const dispatches = driver.coordination.events().filter((event) => event.kind === 'plan.node_dispatched');
    assert.equal(dispatches.length, 1, `approval must mint plan.node_dispatched (got ${dispatches.length})`);
    const dispatchRoute = dispatches[0]?.payload?.route;
    assert.equal(dispatchRoute?.vendor, 'omp', 'dispatch route vendor must be the omp harness');
    assert.equal(dispatchRoute?.model, 'deepseek/deepseek-v4-flash', 'dispatch route model must survive verbatim');
  } finally {
    await application.close?.();
  }
});

test('PROGRESS-CEILING: waves.progress must not ride runs.list — a fleet with more than 64 lifetime runs still answers', async () => {
  const { application } = await buildFixture();
  try {
    // Fill the catalog past MAX_RUN_LIST_ITEMS (64) with plain runs...
    for (let i = 0; i < 65; i += 1) {
      await application.command('run.start', { intent: {
        runId: `run-filler-${i}`, objective: `filler ${i}`,
        profile: 'plain',
        route: { harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' },
      } }, principal('owner'));
    }
    // ...and bind one run to a wave exactly as createWave does (waveId/waveRole ride run.start).
    await application.command('run.start', { intent: {
      runId: 'run-wave-member-1', objective: 'the wave member',
      profile: 'plain', driverKind: 'wave',
      waveId: 'wave:0123456789abcdef0123456789abcdef', waveRole: 'probe',
      route: { harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' },
    } }, principal('owner'));

    // THE CEILING: progress must answer from the wave's own steering index, never the
    // fleet-wide run catalog. 66 runs > 64 must NOT refuse.
    const progress = await application.command('waves.progress', {
      waveId: 'wave:0123456789abcdef0123456789abcdef',
    }, principal('owner'));
    assert.equal(progress.members.length, 1, 'the wave member must be served');
    assert.equal(progress.members[0].role, 'probe', 'the wave role must be served');
  } finally {
    await application.close?.();
  }
});
