// Phase 70 PS5-PS7 — the unified coordinate-free resume_work application cascade over preserved
// progress (spec/phase70/preserved-stop-and-resumable-work.md). Drives the ordinary
// BatonApplication surface: a worker is stopped mid-progress, its checkpoint is preserved, the
// Run outline offers exactly one reason-only resume_work action, and resume restores the exact
// commit under an orchestrator-selected harness/model/effort route without a low default.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  MockAdapter,
  createDriver,
} from '../src/index.mjs';
import { batonCliHelp } from '../src/application-cli.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase70-resume-${name}-`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase70-resume',
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

function verification() {
  return {
    command: 'node', arguments: ['-e', 'process.exit(0)'], cwd: '.', envAllowlist: ['PATH'],
    expectExit: 0, expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [],
  };
}

// PS6: the route effort is `medium`, never a global/harness `low` fallback. The resumed task must
// inherit this exact orchestrator-selected effort.
function profile() {
  return {
    schemaVersion: 1,
    repoId: 'repo-phase70-resume',
    definitionOfDone: ['deployment verification passes'],
    constraints: ['Keep the change inside the approved repository scope'],
    risk: 'medium',
    goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
    nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
    pathScope: ['**'],
    verification: verification(),
    routes: [{ harness: 'mock', model: 'model-a', effort: 'medium' }],
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
  objective: 'Prove the resume_work cascade through the ordinary Run surface',
  profile: 'resumable',
  route: { harness: 'mock', model: 'model-a', effort: 'medium' },
  scope: ['**'],
});

// The worker applies one edit, then blocks on a question so the test can kill it at a deterministic
// point with real partial progress in its worktree.
function stallingAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed', delayMs: 0,
      edits: [{ path: 'partial.txt', content: 'partial progress\n' }],
      ask: { kind: 'question', question: 'pause for kill?', afterEditIndex: 1, blocking: true },
    },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['medium'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function completingAdapter() {
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: {
      outcome: 'completed', delayMs: 0, summary: 'resumed candidate produced',
      edits: [{ path: 'partial.txt', content: 'partial progress\ncompleted\n' }],
    },
  });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['medium'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  return adapter;
}

function gitRepo(name) {
  const repo = root(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase70-resume@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 70 Resume'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  return repo;
}

function buildDriver({ repo, logDir, adapter }) {
  return createDriver({
    repoRoot: repo,
    repoId: 'repo-phase70-resume',
    logDir,
    adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
}

function buildApplication(driver, profiles) {
  return new BatonApplication({
    driver,
    repoId: 'repo-phase70-resume',
    profiles,
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
}

function fixture(name, { adapter = stallingAdapter() } = {}) {
  const repo = gitRepo(name);
  const logDir = root(`${name}-log`);
  const profiles = { resumable: profile() };
  const driver = buildDriver({ repo, logDir, adapter });
  const application = buildApplication(driver, profiles);
  return { application, adapter, driver, repo, logDir, profiles };
}

function cleanup(t, context) {
  t.after(async () => {
    try { await context.application.shutdown(principal('phase70-resume-cleanup')); }
    catch {
      try { await context.application.detach(); } catch { /* fixture teardown */ }
      try { await context.driver.drainAndClose('phase70-resume-cleanup'); } catch { /* fixture teardown */ }
    }
  });
}

async function inspectOutline(application, runId, caller = principal('owner')) {
  return application.command('run.inspect', { runId, depth: 'outline' }, caller);
}

async function actByKind(application, runId, kind, inputs, caller = principal('owner')) {
  const outline = await inspectOutline(application, runId, caller);
  const action = outline.outline.actions.find((candidate) => candidate.kind === kind);
  assert.ok(action, `outline offers no ${kind} action`);
  return application.command('run.act', { runId, actionId: action.actionId, inputs }, caller);
}

async function untilCancelled(application, runId) {
  let outline;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    outline = await inspectOutline(application, runId);
    if (['cancelled', 'failed', 'work_completed', 'completed', 'stopped'].includes(outline.outline.phase)) return outline;
    await sleep(10);
  }
  throw new Error(`timeout waiting for terminal phase: ${outline.outline.phase}`);
}

async function driveToStalledWork(context, runId) {
  await context.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  await actByKind(context.application, runId, 'approve_plan', {});
  // Wait until the worker has acquired its owned worktree and applied its partial edit.
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const outline = await inspectOutline(context.application, runId);
    if (outline.outline.phase === 'running') return outline;
    await sleep(10);
  }
  throw new Error('worker never reached running phase');
}

test('PS5/PS7: a stopped Run with preserved progress offers exactly one coordinate-free resume_work action and projects preservation plainly', async (t) => {
  const f = fixture('offer');
  cleanup(t, f);
  const runId = 'run-phase70-resume-offer';
  await driveToStalledWork(f, runId);
  const workers = f.driver.coordinator.list().filter((handle) => handle.runId === runId);
  assert.equal(workers.length, 1);
  await f.driver.coordinator.kill(workers[0].id, 'operator:test');
  const outline = await untilCancelled(f.application, runId);
  assert.equal(outline.outline.phase, 'cancelled');

  const resumeActions = outline.outline.actions.filter((action) => action.kind === 'resume_work');
  assert.equal(resumeActions.length, 1, 'exactly one resume_work action is offered');
  const action = resumeActions[0];
  // PS5/PS6: the caller supplies only an audit reason — never a ref, SHA, worktree path, harness
  // command, provider credential, budget, byte limit, file-count limit, or export ceiling.
  assert.deepEqual(Object.keys(action.inputSchema.properties).sort(), ['reason']);
  assert.deepEqual(action.inputSchema.required, ['reason']);
  for (const derived of ['checkpoint', 'planNode', 'routePolicy', 'recoveryLineage']) {
    assert.ok(action.serverDerived.includes(derived), `resume derives ${derived} server-side`);
  }

  // PS3/PS7: outline depth says plainly that work was preserved and that resume is the next
  // semantic action. It never leaks the checkpoint ref/SHA, a sandbox path, or a provider wire.
  assert.equal(outline.outline.preservation.state, 'pinned');
  assert.equal(outline.outline.preservation.resumeAvailable, true);
  assert.match(outline.outline.preservation.summary, /work preserved/iu);
  const rendered = JSON.stringify(outline);
  assert.equal(rendered.includes('refs/baton/checkpoints'), false, 'outline leaked the checkpoint git ref');
  assert.equal(rendered.includes(f.repo), false, 'outline leaked a sandbox/repository path');

  const registry = APPLICATION_SEMANTIC_REGISTRY.actions.resume_work;
  assert.equal(registry.helpTopic, 'run.act.resume_work');
  const help = batonCliHelp('run.act.resume_work');
  assert.match(help, /preserved checkpoint/iu);
  assert.match(help, /fresh verifier|downstream gate|untrusted/iu);
});

test('PS5/PS6: resume_work restores the exact checkpoint under an orchestrator-selected route, selects model and effort together, and never defaults effort to low', async (t) => {
  const f = fixture('execute');
  cleanup(t, f);
  const runId = 'run-phase70-resume-execute';
  await driveToStalledWork(f, runId);
  const preserved = f.driver.coordinator.list().filter((handle) => handle.runId === runId);
  await f.driver.coordinator.kill(preserved[0].id, 'policy');
  await untilCancelled(f.application, runId);

  // The preserved checkpoint SHA is the exact progress commit (evidence depth only).
  const preservedTask = f.driver.coordination.task(preserved[0].taskId);
  const preservedResult = await f.driver.coordinator.result(preserved[0].id);
  assert.equal(preservedResult.status, 'cancelled');
  assert.equal(preservedResult.checkpoint.state, 'pinned');
  const checkpointSha = preservedResult.checkpoint.sha;
  assert.ok(/^[a-f0-9]{40}$/.test(checkpointSha));

  // Swap to an adapter whose resumed worker actually completes, so we can prove the resumed
  // candidate must pass the ordinary fresh verifier before acceptance.
  f.adapter._defaultScenario = { outcome: 'completed', delayMs: 0, summary: 'resumed',
    edits: [{ path: 'partial.txt', content: 'partial progress\ncompleted\n' }] };

  const outline = await inspectOutline(f.application, runId);
  const action = outline.outline.actions.find((candidate) => candidate.kind === 'resume_work');
  assert.ok(action);
  const resumed = await f.application.command('run.act',
    { runId, actionId: action.actionId, inputs: { reason: 'continue the preserved work' } },
    principal('owner'));

  // PS5: the resumed task is the Run's new active dispatch; the run is no longer cancelled.
  assert.notEqual(resumed.outline.phase, 'cancelled');
  const resumedWorkers = f.driver.coordinator.list().filter((handle) => handle.runId === runId);
  assert.equal(resumedWorkers.length, 2);
  const resumedHandle = resumedWorkers.find((handle) => handle.id !== preserved[0].id);
  assert.ok(resumedHandle, 'a fresh resumed worker exists');
  assert.notEqual(resumedHandle.taskId, preserved[0].taskId);

  // PS5: fresh owned worktree at the preserved commit (the resumed base is the checkpoint).
  const resumedTask = f.driver.coordination.task(resumedHandle.taskId);
  assert.equal(resumedTask.worktreeBaseSha, checkpointSha);
  assert.equal(resumedTask.refines, preservedTask.id, 'recovery lineage points at the preserved task');

  // PS6: orchestrator-selected harness/model/effort, selected together; effort is the explicit
  // per-task `medium`, never a silent low default.
  assert.equal(resumedHandle.vendor, 'mock');
  assert.equal(resumedHandle.modelRequested, 'model-a');
  assert.equal(resumedHandle.effortRequested, 'medium');
  assert.notEqual(resumedHandle.effortRequested, 'low');

  // PS3/PS5: the resumed candidate is untrusted progress — let the resumed worker complete, then
  // require the ordinary fresh verifier + adoption gate before it is an accepted result.
  let finalOutline;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    finalOutline = await inspectOutline(f.application, runId);
    if (['work_completed', 'completed', 'failed'].includes(finalOutline.outline.phase)) break;
    await sleep(10);
  }
  assert.equal(finalOutline.outline.phase, 'work_completed',
    `resumed work must pass the fresh verifier before adoption: ${finalOutline.outline.phase}`);
  const adopt = finalOutline.outline.actions.find((candidate) => candidate.kind === 'adopt_result');
  assert.ok(adopt, 'the resumed verified candidate is adoptable through the normal gate');
});

test('PS4/PS5: resume_work is response-loss idempotent — replay returns the same resumed task without a second dispatch', async (t) => {
  const f = fixture('idempotent');
  cleanup(t, f);
  const runId = 'run-phase70-resume-idempotent';
  await driveToStalledWork(f, runId);
  const preserved = f.driver.coordinator.list().filter((handle) => handle.runId === runId);
  await f.driver.coordinator.kill(preserved[0].id, 'operator:test');
  await untilCancelled(f.application, runId);
  const outline = await inspectOutline(f.application, runId);
  const action = outline.outline.actions.find((candidate) => candidate.kind === 'resume_work');

  const first = await f.application.command('run.act',
    { runId, actionId: action.actionId, inputs: { reason: 'resume once' } }, principal('owner'));
  const second = await f.application.command('run.act',
    { runId, actionId: action.actionId, inputs: { reason: 'resume once' } }, principal('owner'));

  // One resumed task exists; replay did not create a second dispatch.
  const resumedWorkers = f.driver.coordinator.list()
    .filter((handle) => handle.runId === runId && handle.id !== preserved[0].id);
  assert.equal(resumedWorkers.length, 1);
  assert.notEqual(first.outline.phase, 'cancelled');
  assert.notEqual(second.outline.phase, 'cancelled');
  // PS2/PS4: exactly one preservation checkpoint exists for the preserved task; resume never
  // manufactured a second snapshot.
  const checkpointed = f.driver.log.read(preserved[0].id).filter((event) => event.kind === 'worktree.progress_checkpointed');
  assert.equal(checkpointed.length, 1);
});

test('PS4/PS5/PS8: a second stop recursively resumes the current same-node checkpoint lineage', async (t) => {
  const f = fixture('recursive');
  cleanup(t, f);
  const runId = 'run-phase70-resume-recursive';
  await driveToStalledWork(f, runId);
  const original = f.driver.coordinator.list().find((handle) => handle.runId === runId);
  await f.driver.coordinator.kill(original.id, 'policy');
  await untilCancelled(f.application, runId);

  // The first resumed worker makes distinct progress and stalls again, exercising a second
  // preservation boundary for the same approved Plan node.
  f.adapter._defaultScenario = {
    outcome: 'completed', delayMs: 0,
    edits: [{ path: 'partial.txt', content: 'partial progress\nrecursive progress\n' }],
    ask: { kind: 'question', question: 'pause recursive resume?', afterEditIndex: 1, blocking: true },
  };
  await actByKind(f.application, runId, 'resume_work', { reason: 'first recursive resume' });
  let firstResume;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    firstResume = f.driver.coordinator.list()
      .find((handle) => handle.runId === runId && handle.id !== original.id);
    const outline = await inspectOutline(f.application, runId);
    if (firstResume && outline.outline.phase === 'running') break;
    await sleep(10);
  }
  assert.ok(firstResume, 'first resumed worker was not dispatched');
  await f.driver.coordinator.kill(firstResume.id, 'policy');
  await untilCancelled(f.application, runId);
  const firstResumeResult = await f.driver.coordinator.result(firstResume.id);
  assert.equal(firstResumeResult.checkpoint.state, 'pinned');

  f.adapter._defaultScenario = {
    outcome: 'completed', delayMs: 0, summary: 'recursive resume completed',
    edits: [{ path: 'partial.txt', content: 'partial progress\nrecursive progress\ncompleted\n' }],
  };
  await actByKind(f.application, runId, 'resume_work', { reason: 'second recursive resume' });
  const workers = f.driver.coordinator.list().filter((handle) => handle.runId === runId);
  assert.equal(workers.length, 3, 'same-node recursive resume did not create exactly one fresh task');
  const secondResume = workers.find((handle) => ![original.id, firstResume.id].includes(handle.id));
  assert.ok(secondResume);
  const secondResumeTask = f.driver.coordination.task(secondResume.taskId);
  assert.equal(secondResumeTask.refines, firstResume.taskId);
  assert.equal(secondResumeTask.worktreeBaseSha, firstResumeResult.checkpoint.sha);
});

test('PS5: resume_work refuses when preserved progress is unavailable and preserves PS1-PS4 lifecycle safety', async (t) => {
  const f = fixture('refuse');
  cleanup(t, f);
  const runId = 'run-phase70-resume-refuse';
  await driveToStalledWork(f, runId);
  const outlineBefore = await inspectOutline(f.application, runId);
  // A still-running Run has no preserved checkpoint and must not advertise resume_work.
  assert.ok(!outlineBefore.outline.actions.some((action) => action.kind === 'resume_work'));
  assert.notEqual(outlineBefore.outline.preservation.state, 'pinned');
  await assert.rejects(
    () => f.application.command('run.resume_work', { runId, reason: 'nothing to resume' }, principal('owner')),
    (error) => /application_resume_unavailable/.test(error?.code ?? ''),
  );
});
