import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDriver } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';

// #223 reap-on-terminal (operator-ordered, 2026-08-15): a completed work product's worktree
// is reaped PROGRAMMATICALLY at the terminal evidence event — run.adopt success (and the
// wave fold's equivalent). Not a bound on anything alive: the trigger IS the work's own
// completion. RED at HEAD: adoption succeeds and leaves the owned worktree on disk.

const REPO = 'repo-reap-pin';
const NOW = '2026-08-15T00:00:00.000Z';

const principal = (id) => ({ actor: `pin:${id}`, principalId: id, sessionId: `${id}-session` });
function root(prefix) { return mkdtempSync(join(tmpdir(), `baton-${prefix}-`)); }

const intent = (runId) => ({
  runId,
  objective: 'Produce one adoptable artifact for the reap pin.',
  profile: 'default',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['**'],
});

test('REAP-ON-ADOPT: successful adoption reaps the adopted run’s owned worktree', async () => {
  const repo = root('reap-repo');
  const logDir = root('reap-log');
  try {
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'reap@example.invalid'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Reap Pin'], { cwd: repo });
    writeFileSync(join(repo, 'base.txt'), 'base\n');
    execFileSync('git', ['add', 'base.txt'], { cwd: repo });
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

    const { MockAdapter } = await import('../src/adapter.mjs');
    const adapter = new MockAdapter({
      harness: 'mock',
      scenario: { outcome: 'completed', delayMs: 5, summary: 'produced an adoptable result', files: { 'impl/result.txt': 'accepted result\n' } },
    });
    const baseCard = adapter.card.bind(adapter);
    adapter.card = () => ({
      ...baseCard(),
      modelSelection: {
        mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
        acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
        serviceTier: null, provenance: 'test', refreshedAt: null,
      },
    });

    const driver = createDriver({
      repoRoot: repo, repoId: REPO, logDir, now: () => Date.parse(NOW),
      adapters: { mock: adapter },
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
      watchdog: { stallMs: 60_000 },
    });

    // The worktree seam lives on the coordinator — spy on removal.
    const removedWorktrees = [];
    driver.coordinator._worktrees = {
      ...(driver.coordinator._worktrees ?? {}),
      remove: async (path) => { removedWorktrees.push(path); },
      releaseCapacity: () => {},
    };

    const application = new BatonApplication({
      driver, repoId: REPO,
      profiles: {
        default: {
          schemaVersion: 1,
          repoId: REPO,
          definitionOfDone: ['the artifact exists and verifies'],
          constraints: [],
          risk: 'low',
          goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
          nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
          pathScope: ['**'],
          verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [] },
          routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
          capabilities: ['code'],
          effects: ['repository_edit'],
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

    const runId = 'run-reap-pin-1';
    const proposed = await application.start(intent(runId), principal('operator'));
    await application.approve(runId, proposed.plan.digest, principal('approver'));
    const finished = await application.wait(runId, principal('operator'), { timeoutMs: 5_000 });
    assert.equal(finished.phase, 'work_completed', 'the run completes work first');
    const evidence = await application.command('run.evidence', { runId }, principal('operator'));

    const adopted = await application.command('run.adopt', {
      runId, nodeKey: 'work', resultSha: evidence.result.sha, evidenceDigest: evidence.manifestDigest,
      reason: 'The verified result is the selected result for this Run (reap pin).',
    }, principal('adopter'));
    assert.equal(adopted.result.state, 'adopted', 'adoption succeeds');

    assert.equal(removedWorktrees.length >= 1, true,
      'adoption success reaps the owned worktree programmatically — completion IS the reap trigger');
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
});
