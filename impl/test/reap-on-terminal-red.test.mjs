import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDriver } from '../src/index.mjs';
import { BatonApplication } from '../src/application.mjs';
import { MockAdapter } from '../src/adapter.mjs';

// #223 reap-on-terminal (operator-ordered, 2026-08-15). THE COMPLETION CHAIN — the reap rides
// only its TRUE end:
//   committed → adopted → INTEGRATED (merged; run phase 'completed') → reap
// run.adopt is an INTERMEDIATE completion (result selection — the run stays mutable); the
// worktree is deliberately retained for the merge. run.integrate success — after the required
// independent semantic review, adoption, and the coordinator's merge outcome — is the full
// completion, and the reap fires there, programmatically, on that evidence. No bound on
// anything alive.
//
// Fixture rides the phase65 semantic-review machinery (the proven review→adopt→integrate
// chain): an implementer mock producing an edit, a reviewer mock emitting the structured
// review report, the reviewed profile, and the full green command sequence.

const REPO = 'repo-reap-pin';
const NOW = '2026-08-15T00:00:00.000Z';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const principal = (id) => ({ actor: `pin:${id}`, principalId: id, sessionId: `${id}-session` });
const root = (prefix) => mkdtempSync(join(tmpdir(), `baton-${prefix}-`));

function adapter(harness, model, family, scenario) {
  const instance = new MockAdapter({ harness, scenario });
  const card = instance.card.bind(instance);
  instance.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: model, available: [model], family,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return instance;
}

async function buildFixture() {
  const repo = root('reap-repo');
  const logDir = root('reap-log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'reap@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Reap Pin'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const implementer = adapter('implementer', 'work-model', 'work-family', {
    outcome: 'completed', delayMs: 5, summary: 'implemented target',
    edits: [{ path: 'impl/work.mjs', content: 'export const fixed = true;\n' }],
  });
  const reviewer = adapter('reviewer', 'review-model', 'review-family', { outcome: 'completed' });
  const rawSpawn = reviewer.spawn.bind(reviewer);
  reviewer.spawn = (worker, brief, opts = {}) => {
    const target = brief.semanticReviewTarget;
    const evidence = target.evidenceRefs[0];
    const report = {
      schemaVersion: 1,
      targetDigest: target.targetDigest,
      verdict: 'approved',
      summary: 'No semantic defect remained in the exact reviewed result.',
      findings: [{
        id: 'finding-reviewed-line', severity: 'P2', disposition: 'contradicted',
        claim: 'The exported value remains false.',
        source: {
          path: 'impl/work.mjs', startLine: 1, startColumn: 1, endLine: 1, endColumn: 27,
          contentDigest: sha('export const fixed = true;'),
        },
        evidence: [{ kind: 'artifact', id: evidence.id, digest: evidence.digest }],
        requiredCorrection: null,
      }],
    };
    return rawSpawn(worker, brief, {
      ...opts,
      scenario: {
        outcome: 'completed', delayMs: 5, summary: 'structured semantic review emitted',
        edits: [{ path: 'impl/.baton-semantic-review.json', content: `${JSON.stringify(report)}\n` }],
      },
    });
  };

  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir, now: () => Date.parse(NOW),
    adapters: { implementer, reviewer },
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

  // Spy the REAL manager (assigned at createDriver): wrap remove, keep every other method.
  const removedWorktrees = [];
  const realWorktrees = driver.coordinator._worktrees;
  const realRemove = realWorktrees.remove.bind(realWorktrees);
  realWorktrees.remove = async (...args) => {
    removedWorktrees.push(String(args[0]));
    return realRemove(...args);
  };

  const application = new BatonApplication({
    driver, repoId: REPO,
    profiles: {
      reviewed: {
        schemaVersion: 1,
        repoId: REPO,
        definitionOfDone: ['deployment verification passes'],
        constraints: [],
        risk: 'high',
        goalBudget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 12 },
        nodeBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 6 },
        pathScope: ['impl/**'],
        verification: { command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [] },
        routes: [{ harness: 'implementer', model: 'work-model', effort: 'low' }],
        capabilities: ['code', 'test'],
        effects: ['repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
        reviewPolicy: {
          mode: 'required',
          routes: [{ harness: 'reviewer', model: 'review-model', effort: 'low' }],
          reportPath: 'impl/.baton-semantic-review.json',
          maxFindings: 16, maxReportBytes: 64 * 1024,
        },
        integrationPolicy: {
          mode: 'manual', strategies: ['ff-only', 'structured'],
          requireAdoptedResult: true, requireSemanticReview: true,
        },
      },
    },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize: async () => true,
  });
  await application.ready;
  return { application, driver, repo, logDir, removedWorktrees };
}

test('REAP-ON-COMPLETION: adoption does NOT reap; INTEGRATION (the merge, run completed) reaps the owned worktree', async () => {
  const { application, driver, repo, logDir, removedWorktrees } = await buildFixture();
  try {
    const runId = 'run-reap-pin-1';
    const intent = {
      runId, objective: 'Implement and independently review the exact result',
      profile: 'reviewed',
      route: { harness: 'implementer', model: 'work-model', effort: 'low' },
    };
    const proposed = await application.command('run.start', { intent }, principal('owner'));
    await application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));
    const finished = await application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
    assert.equal(finished.phase, 'work_completed', 'the implementer completes its work');

    await application.command('run.review', {
      runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' },
      reason: 'Obtain independent semantic evidence before integration.',
    }, principal('review-controller'));
    const reviewed = await application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
    assert.equal(reviewed.semanticReview.state, 'semantic_reviewed', 'the review lands');

    const beforeAdoption = await application.command('run.evidence', { runId }, principal('owner'));
    const adopted = await application.command('run.adopt', {
      runId, nodeKey: reviewed.result.nodeKey, resultSha: reviewed.result.sha,
      evidenceDigest: beforeAdoption.manifestDigest, reason: 'Select the independently reviewed result.',
    }, principal('adopter'));
    assert.equal(adopted.result.state, 'adopted', 'adoption succeeds');

    // INTERMEDIATE completion: the IMPLEMENTER's worktree is deliberately retained for the
    // merge. The removal observed at this point is the REVIEWER's review-lane workspace
    // (SR1-SR10's documented reap-at-review-completion) — physical ws- ids carry no role
    // name, so the honest discriminator is the implementer's own worktree presence: the
    // snapshot's implementer task must still own a live physical workspace.
    // Discriminate by COUNT + timing: at adoption exactly ONE workspace (the reviewer's
    // review-lane checkout, SR1-SR10) has been reaped; the implementer's survives — the
    // merge below still needs it (retainResult read from it moments later).
    const distinctAtAdopt = new Set(removedWorktrees).size;
    assert.equal(distinctAtAdopt, 1,
      'adoption reaps exactly the reviewer checkout — the implementer workspace survives for the merge');

    const beforeIntegration = await application.command('run.evidence', { runId }, principal('owner'));
    const integrated = await application.command('run.integrate', {
      runId, evidenceDigest: beforeIntegration.manifestDigest, strategy: 'ff-only',
      reason: 'Integrate the adopted result after independent semantic approval.',
    }, principal('integrator'));
    assert.equal(integrated.phase, 'completed', 'the run reaches FULL terminal completion');
    assert.equal(integrated.integration.state, 'integrated', 'the merge landed');

    // FULL completion: the implementer's workspace joins the removal log — a SECOND distinct
    // ws-id beyond the reviewer's (duplicate idempotent calls may repeat it).
    const distinctAtMerge = new Set(removedWorktrees).size;
    assert.equal(distinctAtMerge >= 2, true,
      'INTEGRATION (committed, reviewed, adopted, MERGED — phase completed) reaps the implementer workspace');
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  }
});
