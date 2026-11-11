#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  BatonApplication, GlmSessionCli, MockAdapter, createDriver,
} from '../../../../impl/src/index.mjs';

if (!process.env.BATON_TARGET_REPO) throw new Error('PENDING-LIVE-baton-target-repo-required');
if (!process.env.BATON_EVIDENCE_OWNER_ROOT) throw new Error('PENDING-LIVE-baton-evidence-owner-root-required');

const SOURCE_REPO = realpathSync(resolve(process.env.BATON_SOURCE_REPO ?? resolve(import.meta.dirname, '../../../..')));
const TARGET_REPO = realpathSync(resolve(process.env.BATON_TARGET_REPO));
const OUTPUT = resolve(process.env.BATON_EVIDENCE_DIR ?? import.meta.dirname);
const OWNER_ROOT = realpathSync(resolve(process.env.BATON_EVIDENCE_OWNER_ROOT));
const GLM_AUTH = resolve(process.env.BATON_GLM_AUTH_FILE ?? join(SOURCE_REPO, 'glm_key.json'));
const GLM_AUTH_POINTER = process.env.BATON_GLM_AUTH_JSON_POINTER ?? '/glm_key';
const REPO_ID = 'baton-phase65-dogfood';
const REPORT_PATH = 'reviews/dogfood/phase65-semantic-review.json';
const WORK_PATH = 'impl/phase65-dogfood.mjs';
const WORK_CONTENT = 'export function answer() {\n  return 42;\n}\n';
const LOG_DIR = mkdtempSync(join(OWNER_ROOT, 'phase65-log-'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const principal = (id) => Object.freeze({ actor: `dogfood:${id}`, principalId: id, sessionId: `${id}-session` });
const processAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
};
const processGroupAlive = (processGroupId) => {
  if (!Number.isSafeInteger(processGroupId) || processGroupId <= 0) return false;
  try { process.kill(-processGroupId, 0); return true; }
  catch (error) { return error?.code === 'EPERM'; }
};

if (!existsSync(GLM_AUTH)) throw new Error('PENDING-LIVE-project-glm-key-absent');
if (execFileSync('git', ['status', '--porcelain'], { cwd: TARGET_REPO, encoding: 'utf8' }).trim()) {
  throw new Error('PENDING-LIVE-dogfood-target-must-be-clean');
}

const runtimeFiles = [
  'impl/src/application.mjs', 'impl/src/coordinator.mjs', 'impl/src/coordination-store.mjs',
  'impl/src/index.mjs', 'impl/src/adapter.mjs',
];
const runtimeDigest = (root) => sha(JSON.stringify(runtimeFiles.map((path) => [path, sha(readFileSync(join(root, path)))])));

const implementer = new MockAdapter({
  harness: 'mock-worker',
  scenario: {
    outcome: 'completed', delayMs: 10, summary: 'created deterministic review target',
    edits: [{ path: WORK_PATH, content: WORK_CONTENT }],
  },
});
const implementerCard = implementer.card.bind(implementer);
implementer.card = () => ({
  ...implementerCard(),
  modelSelection: {
    mode: 'exact', configuredDefault: 'mock-work', available: ['mock-work'], family: 'deterministic-mock',
    acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null,
    provenance: 'phase65-dogfood', refreshedAt: null,
  },
});

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 8_192, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 128 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 512 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const profile = Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  definitionOfDone: [
    `${WORK_PATH} exports answer() returning 42.`,
    'The exact accepted commit passes the pinned syntax check.',
  ],
  constraints: [
    `Change only ${WORK_PATH}; the later independent reviewer alone may write ${REPORT_PATH}.`,
    'Do not publish, deploy, push, or use homelab integration.',
  ],
  risk: 'high',
  goalBudget: { tokens: 120_000, usd: 3, wallMin: 15, providerTurns: 100 },
  nodeBudget: { tokens: 100_000, usd: 3, wallMin: 10, providerTurns: 100 },
  pathScope: ['impl/**', 'reviews/dogfood/**'],
  verification: {
    command: 'node', arguments: ['--check', WORK_PATH], cwd: '.', envAllowlist: ['PATH'],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 64 * 1_024,
    requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock-worker', model: 'mock-work', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit', 'provider_call'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  reviewPolicy: {
    mode: 'required',
    routes: [{ harness: 'glm', model: 'glm-4.7', effort: 'low' }],
    reportPath: REPORT_PATH,
    maxFindings: 32,
    maxReportBytes: 64 * 1_024,
  },
  integrationPolicy: {
    mode: 'manual', strategies: ['ff-only'], requireAdoptedResult: true, requireSemanticReview: true,
  },
});

const driver = createDriver({
  repoRoot: TARGET_REPO,
  repoId: REPO_ID,
  logDir: LOG_DIR,
  adapters: {
    'mock-worker': implementer,
    glm: new GlmSessionCli({
      authTokenFile: GLM_AUTH,
      authTokenJsonPointer: GLM_AUTH_POINTER,
      model: 'glm-4.7',
      approvals: false,
      permissionMode: 'acceptEdits',
      args: ['--safe-mode', '--no-session-persistence', '--max-budget-usd', '3.00'],
      ceiling: 1,
    }),
  },
  goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
  approvalTimeoutMs: 60_000,
  stopDeadlineMs: 20_000,
  drainPolicy: { maxWorkers: 2, timeoutMs: 90_000, pollMs: 10 },
  budgetPolicy: { terminalGraceMs: 2_000 },
  watchdog: { stallMs: 600_000 },
});

let application;
let shutdown = null;
let fatal = null;
let stage = 'construction';
try {
  application = new BatonApplication({
    driver,
    repoId: REPO_ID,
    profiles: { reviewed: profile },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });

  const runId = 'phase65-reflexive-run';
  stage = 'start';
  const proposed = await application.command('run.start', {
    intent: {
      runId,
      objective: `Create ${WORK_PATH}, independently review the immutable result with real GLM, adopt it, and integrate it locally.`,
      profile: 'reviewed',
      route: { harness: 'mock-worker', model: 'mock-work', effort: 'low' },
      scope: ['impl/**', 'reviews/dogfood/**'],
    },
  }, principal('owner'));
  stage = 'approve';
  const dispatched = await application.command('run.approve', {
    runId, planDigest: proposed.plan.digest,
  }, principal('approver'));
  stage = 'wait_work';
  const worked = await application.command('run.wait', { runId, timeoutMs: 60_000 }, principal('owner'));
  if (worked.phase !== 'work_completed') throw new Error(`PENDING-LIVE-work-phase-${worked.phase}`);

  stage = 'review_start';
  const reviewing = await application.command('run.review', {
    runId,
    route: { harness: 'glm', model: 'glm-4.7', effort: 'low' },
    reason: 'Independently inspect the exact accepted result and provide evidence before local integration.',
  }, principal('review-controller'));
  stage = 'review_wait';
  const reviewed = await application.command('run.wait', { runId, timeoutMs: 600_000 }, principal('owner'));
  mkdirSync(OUTPUT, { recursive: true });
  let reportContent = null;
  try {
    const inspection = driver.coordinator.inspectStructuredReview(
      reviewed.semanticReview.workerId, reviewed.semanticReview.targetDigest,
    );
    reportContent = inspection.report.text;
    writeFileSync(join(OUTPUT, 'glm-semantic-review.json'), reportContent, { mode: 0o600 });
  } catch { /* the typed RunView remains authoritative when no accepted report is inspectable */ }
  if (reviewed.semanticReview?.state !== 'semantic_reviewed') {
    throw new Error(`PENDING-LIVE-semantic-${reviewed.semanticReview?.state ?? 'absent'}-${reviewed.semanticReview?.error?.code ?? 'no-code'}`);
  }

  reportContent ??= execFileSync('git', [
    'show', `${reviewed.semanticReview.report.sha}:${reviewed.semanticReview.report.path}`,
  ], { cwd: TARGET_REPO, encoding: 'utf8', maxBuffer: 1024 * 1024 });

  stage = 'evidence_before_adoption';
  const beforeAdoption = await application.command('run.evidence', { runId }, principal('owner'));
  stage = 'adopt';
  const adopted = await application.command('run.adopt', {
    runId,
    nodeKey: reviewed.result.nodeKey,
    resultSha: reviewed.result.sha,
    evidenceDigest: beforeAdoption.manifestDigest,
    reason: 'Select the exact independently reviewed result.',
  }, principal('adopter'));
  stage = 'evidence_before_integration';
  const beforeIntegration = await application.command('run.evidence', { runId }, principal('owner'));
  stage = 'integrate';
  const integrated = await application.command('run.integrate', {
    runId,
    evidenceDigest: beforeIntegration.manifestDigest,
    strategy: 'ff-only',
    reason: 'Apply the exact adopted semantically reviewed result to this disposable local checkout.',
  }, principal('integrator'));
  if (integrated.phase !== 'completed') throw new Error(`PENDING-LIVE-integration-phase-${integrated.phase}`);

  const reviewWorkerId = reviewed.semanticReview.workerId;
  const readProcessEvents = () => driver.log.read(reviewWorkerId)
    .filter((event) => ['lifecycle.process_started', 'lifecycle.process_closed', 'lifecycle.process_reap_unconfirmed'].includes(event.kind))
    .map((event) => ({
      kind: event.kind,
      generation: event.payload?.generation ?? null,
      pid: event.payload?.pid ?? null,
      processGroupId: event.payload?.processGroupId ?? null,
      modelObserved: event.modelObserved ?? event.payload?.modelObserved ?? null,
      effortObserved: event.effortObserved ?? event.payload?.effortObserved ?? null,
    }));
  const preShutdownHandles = driver.coordinator.list();
  stage = 'shutdown';
  shutdown = await application.command('application.shutdown', {}, principal('shutdown-admin'));
  stage = 'summarize';
  const processEvents = readProcessEvents();
  const started = processEvents.filter((event) => event.kind === 'lifecycle.process_started');
  const closed = processEvents.filter((event) => event.kind === 'lifecycle.process_closed');
  const closedGenerations = new Set(closed.map((event) => event.generation));
  const unreaped = started.filter((event) => !closedGenerations.has(event.generation));
  const stillAlive = started.filter((event) => processAlive(event.pid) || processGroupAlive(event.processGroupId));
  const targetContent = execFileSync('git', ['show', `HEAD:${WORK_PATH}`], { cwd: TARGET_REPO, encoding: 'utf8' });
  const targetStatus = execFileSync('git', ['status', '--porcelain'], { cwd: TARGET_REPO, encoding: 'utf8' }).trim();
  const summary = {
    schemaVersion: 1,
    source: {
      runtimeHeadSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: SOURCE_REPO, encoding: 'utf8' }).trim(),
      targetHeadSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: TARGET_REPO, encoding: 'utf8' }).trim(),
      runtimeDigest: runtimeDigest(SOURCE_REPO),
      targetRuntimeDigest: runtimeDigest(TARGET_REPO),
    },
    applicationCommands: application.card().commands,
    checkpoints: {
      proposed: proposed.phase,
      dispatched: dispatched.phase,
      worked: worked.phase,
      reviewing: reviewing.phase,
      reviewed: reviewed.phase,
      adopted: adopted.result?.state ?? null,
      integrated: integrated.phase,
    },
    implementerRoute: integrated.route,
    semanticReview: reviewed.semanticReview,
    evidence: {
      beforeAdoption: beforeAdoption.manifestDigest,
      beforeIntegration: beforeIntegration.manifestDigest,
    },
    integration: integrated.integration,
    report: {
      exportedFile: 'glm-semantic-review.json',
      digest: sha(reportContent),
      bytes: Buffer.byteLength(reportContent),
    },
    processLifecycle: { started, closed, unreaped, stillAlive },
    cleanup: {
      preShutdownHandles: preShutdownHandles.map((handle) => ({
        id: handle.id, taskId: handle.taskId, status: handle.status, worktree: handle.worktree,
        runtimeActive: handle.runtimeScope?.active ?? false, processRef: handle.processRef,
      })),
      shutdown,
    },
    target: { clean: targetStatus.length === 0, contentDigest: sha(targetContent) },
  };
  writeFileSync(join(OUTPUT, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  const exactReviewRoute = reviewed.semanticReview.route.requested.harness === 'glm'
    && reviewed.semanticReview.route.requested.model === 'glm-4.7'
    && reviewed.semanticReview.route.requested.effort === 'low'
    && reviewed.semanticReview.route.resolved.model === 'glm-4.7'
    && reviewed.semanticReview.route.resolved.effort === 'low';
  const cleanupExact = shutdown.ownership?.workers === 0
    && shutdown.receipt?.fleet?.remainingCount === 0
    && shutdown.receipt?.fleet?.counts?.processesObserved === shutdown.receipt?.fleet?.counts?.processesClosed;
  if (!application.card().commands.includes('run.review') || !application.card().commands.includes('run.integrate')
    || !exactReviewRoute || reviewed.semanticReview.independent !== true
    || reviewed.semanticReview.report.digest !== sha(reportContent)
    || integrated.integration?.state !== 'integrated' || integrated.integration?.strategy !== 'ff-only'
    || targetContent !== WORK_CONTENT || targetStatus.length > 0
    || started.length < 1 || closed.length !== started.length || unreaped.length > 0 || stillAlive.length > 0
    || processEvents.some((event) => event.kind === 'lifecycle.process_reap_unconfirmed')
    || !cleanupExact || shutdown.receipt?.fleet?.remainingCount !== 0
    || summary.source.runtimeDigest !== summary.source.targetRuntimeDigest) process.exitCode = 1;
} catch (error) {
  fatal = error;
  mkdirSync(OUTPUT, { recursive: true });
  const errorChain = [];
  for (let current = error, depth = 0; current && depth < 8; current = current.cause, depth += 1) {
    errorChain.push({ name: current.name ?? null, code: current.code ?? null });
  }
  writeFileSync(join(OUTPUT, 'failure.json'), `${JSON.stringify({ schemaVersion: 1, stage, errorChain }, null, 2)}\n`, { mode: 0o600 });
  process.stderr.write(`phase65 semantic-review dogfood failed: ${error?.code ?? error?.message ?? 'unknown'}\n`);
  process.exitCode = 1;
} finally {
  if (application && !shutdown) {
    try { shutdown = await application.shutdown(principal('shutdown-admin')); }
    catch (error) { if (!fatal) process.stderr.write(`phase65 cleanup failed: ${error?.code ?? error?.message ?? 'unknown'}\n`); }
  } else if (!application) {
    try { await driver.drainAndClose('dogfood:construction-failure'); } catch { /* preserve original failure */ }
  }
}
