import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDriver } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';

// #230 red pin — the REAL-adapter dispatch repro. The mock-shaped pin (dispatch-seam-omp-red)
// proves the application chain green on the omp route COORDINATES; this pin swaps in the REAL
// OmpRpcCli (the exact class the resident's deployment constructs, adapter key 'omp:omp') to
// reproduce the resident's measured failure: six wave-b packs + two probes minted
// goal→plan→approval and then NEVER minted plan.node_dispatched / task.created. The member
// startError is swallowed in-process by createWave's catch — this pin surfaces it.
//
// RED   = the approval path throws OR no task is admitted (the resident's class of failure,
//         with the actual stack, which the resident never surfaces).
// GREEN = dispatch admission mints task.created with vendor 'omp' (adapter spawn lifecycle
//         is out of scope here — admission is the seam that dies in the resident).

const REPO = 'repo-dispatch-real-pin';
const principal = (id) => ({ actor: `pin:${id}`, principalId: id, sessionId: `${id}-session` });
const root = (prefix) => mkdtempSync(join(tmpdir(), `baton-${prefix}-`));

async function buildFixture() {
  const repo = root('dispatch-real-repo');
  const logDir = root('dispatch-real-log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'real@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Real Pin'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  // The REAL adapter, deployment-shaped: provider routes catalog, omp binary on PATH.
  const worker = new OmpRpcCli({
    requestTimeoutMs: 45_000,
    model: 'deepseek/deepseek-v4-flash',
    modelCatalog: {
      'deepseek/deepseek-v4-flash': ['high'],
      'deepseek/deepseek-v4-pro[1m]': ['high'],
      'glm/glm-5.2': ['high'],
      'glm/glm-5.3': ['high'],
    },
    ceiling: 4,
  });
  // The deployment's adapter dict key is `omp:omp` (harness:provider) — mirror it.
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir, now: () => Date.now(),
    adapters: { 'omp:omp': worker },
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
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
        integrationPolicy: { mode: 'none', strategies: [], requireAdoptedResult: false, requireSemanticReview: false },
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

test('DISPATCH-REAL: the real OmpRpcCli seat admits the plan dispatch after approval (task created)', async () => {
  const { application, driver } = await buildFixture();
  try {
    const runId = 'run-dispatch-real-1';
    const intent = {
      runId, objective: 'Admit the dispatch on the real omp seat',
      profile: 'plain',
      route: { harness: 'omp', model: 'deepseek/deepseek-v4-flash', effort: 'high' },
    };
    const proposed = await application.command('run.start', { intent }, principal('owner'));
    await application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));

    const dispatches = driver.coordination.events().filter((event) => event.kind === 'plan.node_dispatched');
    assert.equal(dispatches.length, 1, `approval must dispatch (got ${dispatches.length})`);
    assert.equal(dispatches[0]?.payload?.route?.vendor, 'omp', 'dispatch vendor must be omp');
  } finally {
    await application.close?.();
  }
});
