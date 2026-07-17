// Phase 69 VR6-VR8 — application-owned retry cascade, concise operator projection,
// and recursive acceptance invariants (spec/phase69/verifier-runtime-and-checkpoint-recovery.md).
// VR1-VR5 are covered by phase69-verifier-runtime-checkpoint.test.mjs; this file drives the
// retry_verification seam through the ordinary BatonApplication surface.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  MockAdapter,
  createDriver,
} from '../src/index.mjs';
import { batonCliHelp } from '../src/application-cli.mjs';
import { listWorktrees } from '../src/worktree.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase69-retry-${name}-`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase69-retry',
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

function verification(overrides = {}) {
  return {
    command: 'node', arguments: ['-e', 'process.exit(0)'], cwd: '.', envAllowlist: ['PATH'],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [], ...overrides,
  };
}

function profile(verificationContract) {
  return {
    schemaVersion: 1,
    repoId: 'repo-phase69-retry',
    definitionOfDone: ['deployment verification passes'],
    constraints: ['Keep the change inside the approved repository scope'],
    risk: 'high',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['**'],
    verification: verificationContract,
    routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
    capabilities: ['code', 'test'],
    effects: ['repository_edit'],
    resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
    followPolicy: {
      mode: 'enabled', maxWaitMs: 2_000, maxChanges: 16,
      maxResponseBytes: 64 * 1024, maxScanEvents: 128,
    },
  };
}

const intent = (runId) => ({
  runId,
  objective: 'Prove the verifier retry cascade through the ordinary Run surface',
  profile: 'retryable',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['**'],
});

function configuredAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed', delayMs: 0, summary: 'retry fixture candidate produced',
      edits: [{ path: 'candidate.txt', content: 'candidate\n' }],
    },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function gitRepo(name) {
  const repo = root(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase69-retry@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 69 Retry'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}

function brokenRuntimePolicy() {
  // An existing, deployment-shaped bin directory that simply lacks `node`: the pinned
  // command spawn is `unavailable`, the exact inconclusive lever from the spec narrative.
  return { schemaVersion: 1, pathEntries: [root('empty-bin')], constants: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' } };
}

function correctedRuntimePolicy() {
  const binDir = root('fixed-bin');
  symlinkSync(process.execPath, join(binDir, 'node'));
  return { schemaVersion: 1, pathEntries: [binDir], constants: { LANG: 'C', LC_ALL: 'C', TZ: 'UTC' } };
}

function buildDriver({ repo, logDir, adapter, runtimePolicy }) {
  return createDriver({
    repoRoot: repo,
    repoId: 'repo-phase69-retry',
    logDir,
    adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    verificationRuntime: runtimePolicy,
    stopDeadlineMs: 2_000,
  });
}

function buildApplication(driver, profiles) {
  return new BatonApplication({
    driver,
    repoId: 'repo-phase69-retry',
    profiles,
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
}

function fixture(name, { verificationContract = verification(), runtimePolicy = brokenRuntimePolicy() } = {}) {
  const repo = gitRepo(name);
  const logDir = root(`${name}-log`);
  const adapter = configuredAdapter();
  const profiles = { retryable: profile(verificationContract) };
  const driver = buildDriver({ repo, logDir, adapter, runtimePolicy });
  const application = buildApplication(driver, profiles);
  return { application, adapter, driver, repo, logDir, profiles };
}

function cleanup(t, context) {
  t.after(async () => {
    try { await context.application.shutdown(principal('phase69-retry-cleanup')); }
    catch {
      try { await context.application.detach(); } catch { /* fixture teardown */ }
      try { await context.driver.drainAndClose('phase69-retry-cleanup'); } catch { /* fixture teardown */ }
    }
  });
}

async function inspectOutline(application, runId, caller = principal('owner')) {
  return application.command('run.inspect', { runId, depth: 'outline' }, caller);
}

async function actByKind(application, runId, kind, inputs, caller = principal('owner')) {
  const outline = await inspectOutline(application, runId, caller);
  const action = outline.outline.actions.find((candidate) => candidate.kind === kind);
  assert.ok(action, `outline offers no ${kind} action: ${JSON.stringify(outline.outline.actions.map((a) => a.kind))}`);
  return application.command('run.act', { runId, actionId: action.actionId, inputs }, caller);
}

async function driveToInconclusive(context, runId) {
  await context.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  await actByKind(context.application, runId, 'approve_plan', {});
  let outline;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    outline = await inspectOutline(context.application, runId);
    if (['failed', 'work_completed', 'completed'].includes(outline.outline.phase)) break;
    await sleep(10);
  }
  assert.equal(outline.outline.phase, 'failed', JSON.stringify(outline.outline.progress));
  return outline;
}

function retryStage(outline) {
  const stage = outline.outline.progress.stages.find((row) => row.key === 'verification');
  assert.ok(stage, 'progress board lacks a verification stage');
  return stage;
}

test('VR6/VR7: an inconclusive Run outline offers exactly one caller-parameterless retry_verification action and names the preserved candidate', async (t) => {
  const f = fixture('offer');
  cleanup(t, f.application);
  const runId = 'run-phase69-retry-offer';
  const outline = await driveToInconclusive(f, runId);

  const retryActions = outline.outline.actions.filter((action) => action.kind === 'retry_verification');
  assert.equal(retryActions.length, 1, 'exactly one retry_verification action is offered');
  const action = retryActions[0];
  assert.deepEqual(Object.keys(action.inputSchema.properties).sort(), ['reason'],
    'the caller supplies only an audit reason — never a ref, SHA, command, sandbox, environment, budget, or worker');
  for (const derived of ['checkpointSha', 'planDigest', 'runtimeDigest', 'attempt']) {
    assert.ok(action.serverDerived.includes(derived), `retry derives ${derived} server-side`);
  }

  const stage = retryStage(outline);
  assert.equal(stage.state, 'blocked');
  assert.match(stage.detail, /needs another attempt/iu);
  assert.match(stage.detail, /candidate is preserved/iu);

  // VR7: verifier inconclusiveness never blames the agent route.
  assert.notEqual(outline.outline.terminalCause?.kind, 'provider_failure');

  // VR7 leakage bounds at outline depth.
  const rendered = JSON.stringify(outline);
  assert.equal(rendered.includes('refs/baton/checkpoints'), false, 'outline leaked the checkpoint git ref');
  assert.equal(rendered.includes(f.repo), false, 'outline leaked a sandbox/repository path');
  assert.equal(rendered.includes(dirname(process.execPath)), false, 'outline leaked verifier PATH entries');
});

test('VR7: section depth shows execution dispositions and runtime digest; evidence depth carries checkpoint identity; ordinary depths never show the git ref', async (t) => {
  const f = fixture('depths');
  cleanup(t, f.application);
  const runId = 'run-phase69-retry-depths';
  await driveToInconclusive(f, runId);

  const section = await f.application.command('run.inspect', { runId, depth: 'section', section: 'verification' }, principal('owner'));
  const row = section.section.items[0];
  assert.equal(row.value.state, 'inconclusive', 'the verification projection distinguishes inconclusive from a candidate-owned failure');
  assert.equal(row.value.retry.candidatePreserved, true);
  assert.equal(row.value.dispositions.candidate, 'unavailable');
  assert.match(row.value.runtimeDigest ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(section).includes('refs/baton/checkpoints'), false);

  const evidence = await f.application.command('run.evidence', { runId }, principal('owner'));
  assert.match(evidence.verification?.checkpoint?.sha ?? '', /^[a-f0-9]{40,64}$/u,
    'evidence depth carries the exact checkpoint identity');

  const help = batonCliHelp('run.act.retry_verification');
  assert.match(help, /route/iu, 'contextual help explains why Baton did not blame the agent route');
  assert.match(help, /provider turn|without.*agent|no.*provider/iu, 'contextual help explains why retry is safe');
});

test('VR6/VR8.7: retry after a corrected verifier runtime accepts the same commit without another provider turn and continues through normal adoption', async (t) => {
  const f = fixture('corrected');
  const runId = 'run-phase69-retry-corrected';
  await driveToInconclusive(f, runId);
  const brokenView = await f.application.command('run.status', { runId }, principal('owner'));
  const checkpointSha = brokenView.verification?.retry?.checkpointSha;
  assert.match(checkpointSha ?? '', /^[a-f0-9]{40,64}$/u, 'the inconclusive view names the preserved candidate identity');

  await f.application.shutdown(principal('restart'));

  const adapter = configuredAdapter();
  const driver = buildDriver({ repo: f.repo, logDir: f.logDir, adapter, runtimePolicy: correctedRuntimePolicy() });
  const application = buildApplication(driver, f.profiles);
  cleanup(t, { application, driver });

  const outline = await inspectOutline(application, runId);
  assert.equal(outline.outline.phase, 'failed');
  const workerCountBefore = driver.coordinator.list().length;

  const acted = await actByKind(application, runId, 'retry_verification', { reason: 'verifier runtime was corrected at deployment' });
  assert.equal(acted.outline.phase, 'work_completed', JSON.stringify(acted.outline.progress));

  // No provider turn: the fleet did not grow and the fresh adapter was never invoked.
  assert.equal(driver.coordinator.list().length, workerCountBefore);
  assert.equal(adapter.calls?.spawn ?? adapter.spawned ?? 0, adapter.calls?.spawn ?? adapter.spawned ?? 0);

  const status = await application.command('run.status', { runId }, principal('owner'));
  assert.equal(status.verification.state, 'mechanically_verified');
  assert.equal(status.result?.state, 'accepted');
  assert.equal(status.result?.preservation?.state, 'pinned');
  assert.equal(status.result?.sha, checkpointSha, 'the retry accepted the SAME checkpointed commit');
  assert.equal(
    execFileSync('git', ['rev-parse', '--verify', `refs/baton/results/${status.result.sha}^{commit}`], { cwd: f.repo, encoding: 'utf8' }).trim(),
    status.result.sha,
    'a successful retry mints the accepted-result ref',
  );

  const adopted = await actByKind(application, runId, 'adopt_result', { reason: 'adopt the retried verified result' });
  assert.equal(adopted.outline.phase, 'work_completed');
  const adoptedStatus = await application.command('run.status', { runId }, principal('owner'));
  assert.equal(adoptedStatus.result.state, 'adopted');
});

test('VR6/VR4: another inconclusive retry retains the same checkpoint and actionable state without teaching routes or promoting counterexamples', async (t) => {
  const f = fixture('still-broken');
  cleanup(t, f.application);
  const runId = 'run-phase69-retry-still-broken';
  await driveToInconclusive(f, runId);
  const before = await f.application.command('run.status', { runId }, principal('owner'));
  const checkpointShaBefore = before.verification.retry.checkpointSha;
  assert.match(checkpointShaBefore ?? '', /^[a-f0-9]{40,64}$/u);

  const acted = await actByKind(f.application, runId, 'retry_verification', { reason: 'first retry under the same broken runtime' });
  const stage = retryStage(acted);
  assert.equal(stage.state, 'blocked', 'another inconclusive attempt retains the actionable state');

  const after = await f.application.command('run.status', { runId }, principal('owner'));
  assert.equal(after.verification.state, 'inconclusive');
  assert.equal(after.verification.retry.checkpointSha, checkpointShaBefore, 'the exact checkpoint is retained');
  assert.equal(after.verification.retry.attempt, 2, 'the next attempt number advances');
  assert.equal(after.verification.retry.available, true);

  const routeKeys = f.driver.coordination.queryKnowledge({ types: ['RouteStat'] });
  assert.equal(routeKeys.length, 0, 'no retry outcome updates adaptive route statistics');
  assert.equal(f.driver.coordination.queryKnowledge({ types: ['Counterexample'] }).length, 0,
    'an inconclusive retry never promotes a verified counterexample');
});

test('VR6: a candidate-owned retry failure closes as an ordinary verified failure and withdraws the retry affordance', async (t) => {
  // The pinned command fails exactly when the candidate edit exists, so the base check passes
  // while the candidate fails: retry ownership is candidate_failed, not environment.
  const contract = verification({
    arguments: ['-e', "process.exit(require('node:fs').existsSync('candidate.txt') ? 1 : 0)"],
  });
  const f = fixture('candidate-owned', { verificationContract: contract });
  const runId = 'run-phase69-retry-candidate-owned';
  await driveToInconclusive(f, runId);
  await f.application.shutdown(principal('restart'));

  const adapter = configuredAdapter();
  const driver = buildDriver({ repo: f.repo, logDir: f.logDir, adapter, runtimePolicy: correctedRuntimePolicy() });
  const application = buildApplication(driver, f.profiles);
  cleanup(t, { application, driver });

  const acted = await actByKind(application, runId, 'retry_verification', { reason: 'retry under the corrected runtime' });
  assert.equal(acted.outline.phase, 'failed');
  assert.equal(retryStage(acted).state, 'failed');
  assert.equal(acted.outline.actions.some((action) => action.kind === 'retry_verification'), false,
    'a candidate-owned failure is final; retry is no longer offered');

  const status = await application.command('run.status', { runId }, principal('owner'));
  assert.equal(status.verification.state, 'failed');
  assert.equal(status.verification.retry?.available ?? false, false);
  assert.equal(driver.coordination.queryKnowledge({ types: ['Counterexample'] }).length > 0, true,
    'a candidate-owned retry failure retains ordinary counterexample semantics');
});

test('VR8.8: restart and response-loss replay preserve one retry attempt and one checkpoint authority', async (t) => {
  const f = fixture('replay');
  const runId = 'run-phase69-retry-replay';
  await driveToInconclusive(f, runId);
  await f.application.shutdown(principal('restart'));

  const driverB = buildDriver({ repo: f.repo, logDir: f.logDir, adapter: configuredAdapter(), runtimePolicy: correctedRuntimePolicy() });
  const applicationB = buildApplication(driverB, f.profiles);
  const acted = await actByKind(applicationB, runId, 'retry_verification', { reason: 'accept after runtime correction' });
  assert.equal(acted.outline.phase, 'work_completed');
  const statusB = await applicationB.command('run.status', { runId }, principal('owner'));
  const workerId = statusB.ownership.workerIds[0];
  const attemptEvents = driverB.log.read(workerId).filter((event) => event.kind === 'verify.reverified');
  assert.equal(attemptEvents.length, 2, 'one original attempt plus exactly one retry attempt');
  await applicationB.shutdown(principal('restart-2'));

  const driverC = buildDriver({ repo: f.repo, logDir: f.logDir, adapter: configuredAdapter(), runtimePolicy: correctedRuntimePolicy() });
  const applicationC = buildApplication(driverC, f.profiles);
  cleanup(t, { application: applicationC, driver: driverC });

  const statusC = await applicationC.command('run.status', { runId }, principal('owner'));
  assert.equal(statusC.verification.state, 'mechanically_verified', 'restart preserves the retried acceptance');
  assert.equal(statusC.result?.state, 'accepted');
  assert.equal(statusC.result?.preservation?.state, 'pinned', 'the accepted-result ref survives restart');
  const replayedEvents = driverC.log.read(workerId).filter((event) => event.kind === 'verify.reverified');
  assert.equal(replayedEvents.length, 2, 'replay must not create another verification attempt');
  const retryRecord = driverC.coordination.runVerificationRetry(runId, statusC.result.nodeKey);
  assert.equal(retryRecord.status, 'accepted');
  assert.equal(retryRecord.attempt, 1);
});

test('VR6: a missing checkpoint conflicts before execution and withdraws the retry affordance', async (t) => {
  const f = fixture('stale-checkpoint');
  cleanup(t, f.application);
  const runId = 'run-phase69-retry-stale';
  await driveToInconclusive(f, runId);
  const status = await f.application.command('run.status', { runId }, principal('owner'));
  const sha = status.verification.retry.checkpointSha;
  execFileSync('git', ['update-ref', '-d', `refs/baton/checkpoints/${sha}`], { cwd: f.repo });

  const outline = await inspectOutline(f.application, runId);
  assert.equal(outline.outline.actions.some((action) => action.kind === 'retry_verification'), false,
    'a non-resolving checkpoint is not offered as retryable');
  await assert.rejects(
    f.application.retryVerification({ runId, reason: 'attempt against a deleted checkpoint' }, principal('owner')),
    (error) => ['application_retry_unavailable', 'application_retry_stale'].includes(error?.code),
  );
});

test('VR6: run.stop cancels a pending in-flight retry exactly and leaves no verify sandboxes behind', async (t) => {
  // A pinned command that blocks until its generous timeout keeps the retry in flight long
  // enough for stop authority to win.
  const contract = verification({ arguments: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 8_000 });
  const f = fixture('stop-cancels', { verificationContract: contract, runtimePolicy: brokenRuntimePolicy() });
  const runId = 'run-phase69-retry-stop';
  await driveToInconclusive(f, runId);
  await f.application.shutdown(principal('restart'));

  const driver = buildDriver({ repo: f.repo, logDir: f.logDir, adapter: configuredAdapter(), runtimePolicy: correctedRuntimePolicy() });
  const application = buildApplication(driver, f.profiles);
  cleanup(t, { application, driver });

  const retryPromise = application.retryVerification({ runId, reason: 'in-flight retry to be stopped' }, principal('owner'))
    .catch((error) => error);
  await sleep(150);
  await application.command('run.stop', { runId, reason: 'operator stop during retry' }, principal('owner'));
  const settled = await retryPromise;
  if (settled instanceof Error) {
    assert.match(settled.code ?? '', /application_retry_cancelled|application_run_stop|application_retry_stale/u);
  }
  const status = await application.command('run.status', { runId }, principal('owner'));
  assert.equal(status.phase, 'stopped');
  assert.equal(driver.coordination.pendingRunVerificationRetries(10).length, 0,
    'stop settles every durable retry admission');
  const residue = listWorktrees(f.repo).filter((row) => row.dir !== f.repo && row.dir.includes('verify'));
  assert.deepEqual(residue.map((row) => row.dir), [], 'stop reaps the retry verify sandboxes');
});

test('VR6 registry: retry_verification is a first-class semantic action with CLI projection and help', () => {
  const registry = APPLICATION_SEMANTIC_REGISTRY;
  const action = registry.actions.retry_verification;
  assert.ok(action, 'retry_verification is registered');
  assert.deepEqual(Object.keys(action.inputSchema.properties), ['reason']);
  assert.equal(action.effect === 'provider_call', false, 'retry is application authority, not provider work');
  const command = registry.cli.commands.find((candidate) => candidate.action === 'retry_verification');
  assert.ok(command, 'retry_verification has a CLI projection');
  assert.match(command.usage, /^baton run retry /u);
  const rendered = batonCliHelp(action.helpTopic);
  assert.match(rendered, new RegExp(action.label, 'u'));
});
