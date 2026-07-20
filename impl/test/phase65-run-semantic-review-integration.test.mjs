import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { BatonApplication, MockAdapter, createDriver } from '../src/index.mjs';

const sha = (value) => createHash('sha256').update(value).digest('hex');
const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase65-${name}-`));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase65',
  mandatory: true,
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
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

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

function fixture(name, {
  report = null,
  reviewerFamily = 'review-family',
  reviewerDelayMs = 5,
  reviewerExtraEdits = [],
} = {}) {
  const repo = root(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase65@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 65'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const implementer = adapter('implementer', 'work-model', 'work-family', {
    outcome: 'completed', delayMs: 5, summary: 'implemented target',
    edits: [{ path: 'impl/work.mjs', content: 'export const fixed = true;\n' }],
  });
  const reviewer = adapter('reviewer', 'review-model', reviewerFamily, { outcome: 'completed' });
  const rawSpawn = reviewer.spawn.bind(reviewer);
  reviewer.spawn = (worker, brief, opts = {}) => {
    const target = brief.semanticReviewTarget;
    const evidence = target.evidenceRefs[0];
    const defaultReport = {
      schemaVersion: 1,
      targetDigest: target.targetDigest,
      verdict: 'approved',
      summary: 'No semantic defect remained in the exact reviewed result.',
      findings: [{
        id: 'finding-reviewed-line', severity: 'P2', disposition: 'contradicted',
        claim: 'The exported value remains false.',
        source: {
          path: 'impl/work.mjs', startLine: 1, startColumn: 1,
          endLine: 1, endColumn: 27,
          contentDigest: sha('export const fixed = true;'),
        },
        evidence: [{ kind: 'artifact', id: evidence.id, digest: evidence.digest }],
        requiredCorrection: null,
      }],
    };
    const body = typeof report === 'function' ? report({ target, evidence, defaultReport }) : (report ?? defaultReport);
    return rawSpawn(worker, brief, {
      ...opts,
      scenario: {
        outcome: 'completed', delayMs: reviewerDelayMs, summary: 'structured semantic review emitted',
        edits: [
          { path: 'impl/.baton-semantic-review.json', content: `${JSON.stringify(body)}\n` },
          ...reviewerExtraEdits,
        ],
      },
    });
  };

  const profile = {
    schemaVersion: 1,
    repoId: 'repo-phase65',
    definitionOfDone: ['deployment verification passes'],
    constraints: ['Keep the change inside the approved repository scope'],
    risk: 'high',
    goalBudget: { tokens: 40_000, usd: 4, wallMin: 20, providerTurns: 12 },
    nodeBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 6 },
    pathScope: ['impl/**'],
    verification,
    routes: [{ harness: 'implementer', model: 'work-model', effort: 'low' }],
    capabilities: ['code', 'test'],
    effects: ['repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
    reviewPolicy: {
      mode: 'required',
      routes: [{ harness: 'reviewer', model: 'review-model', effort: 'low' }],
      reportPath: 'impl/.baton-semantic-review.json',
      maxFindings: 16,
      maxReportBytes: 64 * 1024,
    },
    integrationPolicy: {
      mode: 'manual', strategies: ['ff-only', 'structured'],
      requireAdoptedResult: true, requireSemanticReview: true,
    },
  };
  const logDir = root(`${name}-log`);
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-phase65', logDir,
    adapters: { implementer, reviewer }, goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-phase65', profiles: { reviewed: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  return { application, driver, implementer, reviewer, repo, logDir, profile };
}

function reopen(f) {
  const implementer = adapter('implementer', 'work-model', 'work-family', { outcome: 'completed' });
  const reviewer = adapter('reviewer', 'review-model', 'review-family', { outcome: 'completed' });
  const driver = createDriver({
    repoRoot: f.repo, repoId: 'repo-phase65', logDir: f.logDir,
    adapters: { implementer, reviewer }, goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-phase65', profiles: { reviewed: f.profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  return { ...f, application, driver, implementer, reviewer };
}

const intent = (runId) => ({
  runId,
  objective: 'Implement and independently review the exact result',
  profile: 'reviewed',
  route: { harness: 'implementer', model: 'work-model', effort: 'low' },
  scope: ['impl/**'],
});

async function completedWork(f, runId) {
  const proposed = await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  await f.application.command('run.approve', { runId, planDigest: proposed.plan.digest }, principal('approver'));
  const finished = await f.application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
  assert.equal(finished.phase, 'work_completed');
  return finished;
}

test('SR1-SR10: exact independent structured review gates an evidence-bound integration and reaps reviewer ownership', async () => {
  const f = fixture('approved');
  const runId = 'run-semantic-approved';
  await completedWork(f, runId);

  const reviewing = await f.application.command('run.review', {
    runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' },
    reason: 'Obtain independent semantic evidence before integration.',
  }, principal('review-controller'));
  assert.equal(['reviewing', 'work_completed'].includes(reviewing.phase), true);

  const reviewed = await f.application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
  assert.equal(reviewed.phase, 'work_completed');
  assert.equal(reviewed.semanticReview.state, 'semantic_reviewed', JSON.stringify(reviewed.semanticReview));
  assert.equal(reviewed.semanticReview.independent, true);
  assert.equal(reviewed.semanticReview.findings[0].disposition, 'contradicted');
  assert.deepEqual(reviewed.semanticReview.route.requested, { harness: 'reviewer', model: 'review-model', effort: 'low' });

  const beforeAdoption = await f.application.command('run.evidence', { runId }, principal('owner'));
  assert.equal(beforeAdoption.schemaVersion, 1);
  assert.equal(Object.hasOwn(beforeAdoption, 'resultIntent'), false);
  const adopted = await f.application.command('run.adopt', {
    runId, nodeKey: reviewed.result.nodeKey, resultSha: reviewed.result.sha,
    evidenceDigest: beforeAdoption.manifestDigest, reason: 'Select the independently reviewed result.',
  }, principal('adopter'));
  assert.equal(adopted.result.state, 'adopted');

  const beforeIntegration = await f.application.command('run.evidence', { runId }, principal('owner'));
  assert.equal(beforeIntegration.schemaVersion, 1);
  assert.equal(Object.hasOwn(beforeIntegration, 'resultIntent'), false);
  const integrated = await f.application.command('run.integrate', {
    runId, evidenceDigest: beforeIntegration.manifestDigest, strategy: 'ff-only',
    reason: 'Integrate the adopted result after independent semantic approval.',
  }, principal('integrator'));
  assert.equal(integrated.phase, 'completed');
  assert.equal(integrated.integration.state, 'integrated');
  assert.equal(execFileSync('git', ['show', 'HEAD:impl/work.mjs'], { cwd: f.repo, encoding: 'utf8' }), 'export const fixed = true;\n');

  const reviewerTask = f.driver.coordination.snapshot().tasks.find((task) => task.taskType === 'review');
  assert.equal(Object.hasOwn(reviewerTask.brief, 'goalPlan'), false,
    'semantic review remains a derived Brief rather than an approved Plan node');
  const reviewerEvents = f.driver.log.read(reviewerTask.assignee);
  assert.equal(reviewerEvents.some((event) => event.kind === 'verify.reverified'
    && event.payload?.capture?.changedPaths?.includes('impl/.baton-semantic-review.json')), true,
  'the derived review report edit reaches the verifier');
  assert.equal(reviewerEvents.some((event) => event.kind === 'error'
    && event.payload?.code === 'forbidden_effect_observed'), false,
  'the Plan-only forbidden-effect check does not reject a derived semantic-review report');
  assert.match(reviewerTask.brief.outputFormat, new RegExp(reviewed.semanticReview.targetDigest));
  assert.match(reviewerTask.brief.outputFormat, /startLine.*contentDigest/u);
  assert.deepEqual(reviewerTask.brief.semanticReviewTarget.changedPaths, ['impl/work.mjs']);
  assert.equal(reviewerTask.brief.constraints.some((constraint) => constraint.includes('impl/work.mjs')), true);
  const reviewerHandle = f.driver.coordinator.list().find((handle) => handle.taskId === reviewerTask.id);
  assert.equal(reviewerHandle.status, 'dead');
  assert.equal(reviewerHandle.worktree, null);
  await f.application.shutdown(principal('shutdown'));
});

test('SR5/SR7/SR9: a stale source anchor fails closed and cannot authorize integration', async () => {
  const f = fixture('stale-anchor', {
    report: ({ defaultReport }) => ({
      ...defaultReport,
      findings: [{
        ...defaultReport.findings[0],
        disposition: 'confirmed', requiredCorrection: 'Correct the reviewed export.',
        source: { ...defaultReport.findings[0].source, contentDigest: '0'.repeat(64) },
      }],
      verdict: 'revision_required',
    }),
  });
  const runId = 'run-semantic-stale';
  const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.repo, encoding: 'utf8' }).trim();
  await completedWork(f, runId);
  await f.application.command('run.review', {
    runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Review exact result.',
  }, principal('review-controller'));
  const reviewed = await f.application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
  assert.equal(reviewed.semanticReview.state, 'review_failed');
  assert.equal(reviewed.semanticReview.error.code, 'application_review_anchor_stale');
  const evidence = await f.application.command('run.evidence', { runId }, principal('owner'));
  await assert.rejects(f.application.command('run.integrate', {
    runId, evidenceDigest: evidence.manifestDigest, strategy: 'ff-only', reason: 'Must not integrate stale review.',
  }, principal('integrator')), (error) => error.code === 'application_semantic_review_required');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.repo, encoding: 'utf8' }).trim(), headBefore);
  await f.application.shutdown(principal('shutdown'));
});

test('SR2/SR6: same-family review is rejected before the reviewer provider sees a spawn', async () => {
  const f = fixture('same-family', { reviewerFamily: 'work-family' });
  const runId = 'run-semantic-same-family';
  await completedWork(f, runId);
  let spawns = 0;
  const spawn = f.reviewer.spawn.bind(f.reviewer);
  f.reviewer.spawn = (...args) => { spawns += 1; return spawn(...args); };
  await assert.rejects(f.application.command('run.review', {
    runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Attempt same-family review.',
  }, principal('review-controller')), (error) => error.code === 'application_review_not_independent');
  assert.equal(spawns, 0);
  await f.application.shutdown(principal('shutdown'));
});

test('SR3/SR10: semantic approval and adoption reconstruct from durable state before later integration', async () => {
  let f = fixture('restart-reviewed');
  const runId = 'run-semantic-restart';
  await completedWork(f, runId);
  await f.application.command('run.review', {
    runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Produce restart-safe review evidence.',
  }, principal('review-controller'));
  const reviewed = await f.application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
  const evidence = await f.application.command('run.evidence', { runId }, principal('owner'));
  await f.application.command('run.adopt', {
    runId, nodeKey: reviewed.result.nodeKey, resultSha: reviewed.result.sha,
    evidenceDigest: evidence.manifestDigest, reason: 'Preserve the exact reviewed result across restart.',
  }, principal('adopter'));
  await f.application.shutdown(principal('first-shutdown'));

  f = reopen(f);
  const reconstructed = await f.application.command('run.status', { runId }, principal('owner'));
  assert.equal(reconstructed.phase, 'work_completed', JSON.stringify({
    semanticReview: reconstructed.semanticReview,
    handles: f.driver.coordinator.list(),
    reviewTasks: f.driver.coordination.snapshot().tasks.filter((task) => task.taskType === 'review'),
  }));
  assert.equal(reconstructed.semanticReview.state, 'semantic_reviewed', JSON.stringify({
    semanticReview: reconstructed.semanticReview,
    handles: f.driver.coordinator.list(),
  }));
  assert.equal(reconstructed.result.state, 'adopted');
  const fresh = await f.application.command('run.evidence', { runId }, principal('owner'));
  const integrated = await f.application.command('run.integrate', {
    runId, evidenceDigest: fresh.manifestDigest, strategy: 'ff-only', reason: 'Integrate after durable reconstruction.',
  }, principal('integrator'));
  assert.equal(integrated.phase, 'completed');
  await f.application.shutdown(principal('second-shutdown'));
});

test('SR4-SR7: unknown fields, substituted evidence, inconsistent verdicts, and extra reviewer edits fail closed', async (t) => {
  const cases = [
    {
      name: 'unknown-report-field', expected: 'application_review_report_invalid',
      report: ({ defaultReport }) => ({ ...defaultReport, forgedAuthority: true }),
    },
    {
      name: 'substituted-evidence', expected: 'application_review_evidence_stale',
      report: ({ defaultReport }) => ({
        ...defaultReport,
        findings: [{ ...defaultReport.findings[0], evidence: [{ ...defaultReport.findings[0].evidence[0], digest: 'f'.repeat(64) }] }],
      }),
    },
    {
      name: 'inconsistent-verdict', expected: 'application_review_verdict_inconsistent',
      report: ({ defaultReport }) => ({ ...defaultReport, verdict: 'revision_required' }),
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async () => {
      const f = fixture(item.name, { report: item.report });
      const runId = `run-${item.name}`;
      await completedWork(f, runId);
      await f.application.command('run.review', {
        runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Adversarial report validation.',
      }, principal('review-controller'));
      const view = await f.application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
      assert.equal(view.semanticReview.state, 'review_failed');
      assert.equal(view.semanticReview.error.code, item.expected);
      await f.application.shutdown(principal('shutdown'));
    });
  }

  await t.test('extra-reviewer-edit', async () => {
    const f = fixture('extra-reviewer-edit', {
      reviewerExtraEdits: [{ path: 'impl/unauthorized.txt', content: 'smuggled\n' }],
    });
    const runId = 'run-extra-reviewer-edit';
    await completedWork(f, runId);
    await f.application.command('run.review', {
      runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Reject report-scope smuggling.',
    }, principal('review-controller'));
    const view = await f.application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
    assert.equal(view.semanticReview.state, 'review_failed');
    assert.equal(view.semanticReview.error.code, 'structured_review_scope_violation');
    await f.application.shutdown(principal('shutdown'));
  });
});

test('SR7/SR9: unverifiable findings and stale displayed evidence cannot authorize integration', async () => {
  const f = fixture('unverifiable', {
    report: ({ defaultReport }) => ({
      ...defaultReport, verdict: 'unverifiable',
      findings: [{ ...defaultReport.findings[0], disposition: 'unverifiable' }],
    }),
  });
  const runId = 'run-semantic-unverifiable';
  await completedWork(f, runId);
  await f.application.command('run.review', {
    runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Preserve uncertainty.',
  }, principal('review-controller'));
  const reviewed = await f.application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
  assert.equal(reviewed.semanticReview.state, 'review_failed');
  assert.equal(reviewed.semanticReview.verdict, 'unverifiable');
  const stale = await f.application.command('run.evidence', { runId }, principal('owner'));
  await f.application.command('run.adopt', {
    runId, nodeKey: reviewed.result.nodeKey, resultSha: reviewed.result.sha,
    evidenceDigest: stale.manifestDigest, reason: 'Adoption does not bless semantic uncertainty.',
  }, principal('adopter'));
  await assert.rejects(f.application.command('run.integrate', {
    runId, evidenceDigest: stale.manifestDigest, strategy: 'ff-only', reason: 'Must reject uncertainty and stale evidence.',
  }, principal('integrator')), (error) => error.code === 'application_semantic_review_required');
  await f.application.shutdown(principal('shutdown'));
});

test('SR9: result adoption invalidates an older displayed manifest before integration', async () => {
  const f = fixture('stale-integration-manifest');
  const runId = 'run-stale-integration-manifest';
  await completedWork(f, runId);
  await f.application.command('run.review', {
    runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Approve the exact result.',
  }, principal('review-controller'));
  const reviewed = await f.application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
  const stale = await f.application.command('run.evidence', { runId }, principal('owner'));
  await f.application.command('run.adopt', {
    runId, nodeKey: reviewed.result.nodeKey, resultSha: reviewed.result.sha,
    evidenceDigest: stale.manifestDigest, reason: 'Adoption changes the authoritative evidence manifest.',
  }, principal('adopter'));
  await assert.rejects(f.application.command('run.integrate', {
    runId, evidenceDigest: stale.manifestDigest, strategy: 'ff-only', reason: 'Reject the stale pre-adoption display.',
  }, principal('integrator')), (error) => error.code === 'application_evidence_stale');
  assert.notEqual((await f.application.command('run.evidence', { runId }, principal('owner'))).manifestDigest, stale.manifestDigest);
  await f.application.shutdown(principal('shutdown'));
});

test('SR8: Run stop races an in-flight review to one exact fully reaped ownership set', async () => {
  const f = fixture('review-stop', { reviewerDelayMs: 500 });
  const runId = 'run-semantic-review-stop';
  await completedWork(f, runId);
  await f.application.command('run.review', {
    runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Begin a review that stop must own.',
  }, principal('review-controller'));
  const stopped = await f.application.command('run.stop', { runId, reason: 'Cancel the entire Run during review.' }, principal('stopper'));
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.stop.receipt.remainingCount, 0);
  assert.equal(f.driver.coordinator.list().every((handle) => handle.status === 'dead'
    && handle.worktree === null && handle.runtimeScope?.active !== true && handle.processRef === null), true, JSON.stringify(f.driver.coordinator.list()));
  await assert.rejects(f.application.command('run.review', {
    runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Stopped Runs stay closed.',
  }, principal('review-controller')), (error) => error.code === 'application_run_stopped');
  await f.application.shutdown(principal('shutdown'));
});

test('SR9: dirty and non-fast-forward main states cannot become claimed integrations', async (t) => {
  for (const mode of ['dirty', 'non-fast-forward']) {
    await t.test(mode, async () => {
      const f = fixture(`integration-${mode}`);
      const runId = `run-integration-${mode}`;
      await completedWork(f, runId);
      await f.application.command('run.review', {
        runId, route: { harness: 'reviewer', model: 'review-model', effort: 'low' }, reason: 'Approve exact result before integration guard test.',
      }, principal('review-controller'));
      const reviewed = await f.application.command('run.wait', { runId, timeoutMs: 5_000 }, principal('owner'));
      const evidence = await f.application.command('run.evidence', { runId }, principal('owner'));
      await f.application.command('run.adopt', {
        runId, nodeKey: reviewed.result.nodeKey, resultSha: reviewed.result.sha,
        evidenceDigest: evidence.manifestDigest, reason: 'Select exact result.',
      }, principal('adopter'));
      const fresh = await f.application.command('run.evidence', { runId }, principal('owner'));
      const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.repo, encoding: 'utf8' }).trim();
      if (mode === 'dirty') {
        writeFileSync(join(f.repo, 'base.txt'), 'dirty local state\n');
      } else {
        writeFileSync(join(f.repo, 'main-only.txt'), 'main diverged\n');
        execFileSync('git', ['add', 'main-only.txt'], { cwd: f.repo });
        execFileSync('git', ['commit', '-qm', 'diverge main'], { cwd: f.repo });
      }
      const guardedHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.repo, encoding: 'utf8' }).trim();
      await assert.rejects(f.application.command('run.integrate', {
        runId, evidenceDigest: fresh.manifestDigest, strategy: 'ff-only', reason: 'Guarded integration must refuse.',
      }, principal('integrator')));
      const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: f.repo, encoding: 'utf8' }).trim();
      assert.equal(headAfter, mode === 'dirty' ? headBefore : guardedHead);
      assert.notEqual(headAfter, reviewed.result.sha);
      await f.application.shutdown(principal('shutdown'));
    });
  }
});
