// AX-1 red suite (issue #10, docs/32 §5): blockedInteraction classification + required-action
// projection. See docs/reference/evidence/reflex-wave-live-2026-07-21/ax1-decisions.md — the
// binding contract for this file. One shared projection helper (application.mjs
// `projectBlockedInteraction`) must classify identically across the single-attempt view, the
// workflow view, `runs.list`, and the CLI `baton run status` outline.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BatonApplication, MockAdapter, createDriver, parseBatonCli, projectBatonCliResult,
} from '../src/index.mjs';

const REPO_ID = 'repo-issue10-blocked-interaction';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-ax1-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'ax1@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'AX1 Test'], { cwd: root });
  writeFileSync(join(root, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function principal(id) {
  return Object.freeze({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
}

// One MockAdapter whose spawn() selects a scenario by matching a `(marker:x)` fragment
// embedded in the dispatched brief's goal text — mirrors impl/test/wave-driver-red.test.mjs's
// markerAdapter so multiple scenarios can share one driver/adapter instance.
function markerAdapter(scenariosByMarker) {
  const value = new MockAdapter({ harness: 'mock', scenario: scenariosByMarker.default ?? { outcome: 'completed' } });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'ax1-blocked-interaction-test', refreshedAt: null,
    },
  });
  const nativeSpawn = value.spawn.bind(value);
  value.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    // Matches by bare marker substring (not a "marker:" prefix) so this also matches a
    // Workflow attempt's auto-generated `${role} parallel attempt: ...` objective, where the
    // role name is a literal prefix rather than something the caller controls verbatim.
    const marker = Object.keys(scenariosByMarker).find((key) => key !== 'default' && goal.includes(key));
    const scenario = scenariosByMarker[marker] ?? scenariosByMarker.default;
    return nativeSpawn(worker, brief, { ...options, scenario });
  };
  return value;
}

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: [], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536, requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1, repoId: REPO_ID,
  definitionOfDone: ['the change is verified'], constraints: [], risk: 'low',
  goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
  nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
  pathScope: ['**'], verification, routes: [ROUTE], capabilities: ['code', 'test'],
  effects: ['provider_call', 'repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

function harness(t, scenariosByMarker) {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-ax1-log-'));
  const driver = createDriver({
    repoRoot: repo, repoId: REPO_ID, logDir, adapters: { mock: markerAdapter(scenariosByMarker) },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver, repoId: REPO_ID,
    profiles: { standard: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    authorize: async () => true,
  });
  t.after(async () => {
    try { await application.shutdown(principal('shutdown')); } catch { /* best-effort teardown */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, driver };
}

async function waitForBlockedAnswerQuestion(application, runId, owner) {
  for (let i = 0; i < 300; i += 1) {
    const view = await application.status(runId, owner);
    if (view.blockedInteraction?.kind === 'answer_question') return view;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('run never surfaced a pending answer_question blockedInteraction');
}

test('AX1-A: blockedInteraction classifies approve_plan before approval and clears once dispatched', async (t) => {
  const { application } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'AX1-A (marker:default): write the output file', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  assert.equal(started.phase, 'awaiting_plan_approval');
  assert.deepEqual(started.blockedInteraction, { kind: 'approve_plan' });

  const approved = await application.approve(started.runId, started.plan.digest, principal('approver'));
  assert.notEqual(approved.phase, 'awaiting_plan_approval');
  assert.equal(approved.blockedInteraction, null,
    'once dispatched with no pending worker request, blockedInteraction clears (additive to attention, never sticky)');
});

test('AX1-B: blockedInteraction classifies a pending worker question, bounded and sanitized', async (t) => {
  const longQuestion = `Which of the many candidate directories under this monorepo should hold the freshly generated configuration artifact, given the constraints already described and the team's established naming conventions for generated files ${'x'.repeat(120)}?`;
  const { application } = harness(t, {
    short: {
      outcome: 'completed', edits: [],
      ask: { kind: 'question', question: 'Which directory should hold the new file?', blocking: true },
    },
    secret: {
      outcome: 'completed', edits: [],
      ask: { kind: 'question', question: 'api_key: sk-proj-abcdefghijklmnopqrstuvwx', blocking: true },
    },
    long: {
      outcome: 'completed', edits: [],
      ask: { kind: 'question', question: longQuestion, blocking: true },
    },
  });
  const owner = principal('owner');

  async function blockOn(marker) {
    const started = await application.start({
      objective: `AX1-B (marker:${marker}): probe the pending question`, profile: 'standard', route: ROUTE, scope: ['**'],
    }, owner);
    await application.approve(started.runId, started.plan.digest, principal('approver'));
    return waitForBlockedAnswerQuestion(application, started.runId, owner);
  }

  const short = await blockOn('short');
  assert.deepEqual(short.blockedInteraction, {
    kind: 'answer_question', summary: 'Which directory should hold the new file?',
  });

  const secret = await blockOn('secret');
  assert.equal(secret.blockedInteraction.kind, 'answer_question');
  assert.equal(secret.blockedInteraction.summary, '[credential-shaped content redacted]',
    'never worker prose beyond the request text itself — credential-shaped text is redacted, not projected');

  const long = await blockOn('long');
  assert.equal(long.blockedInteraction.kind, 'answer_question');
  assert.ok(Buffer.byteLength(long.blockedInteraction.summary) <= 160,
    'summary honors the <=160-byte bound, ellipsis included');
  assert.ok(long.blockedInteraction.summary.endsWith('…'), 'an over-long question is truncated, not dropped');
});

test('AX1-C: blockedInteraction classifies select_candidate once an operator-join workflow settles', async (t) => {
  const { application } = harness(t, {
    alpha: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha\n' }] },
    beta: { outcome: 'completed', edits: [{ path: 'reports/beta.md', content: 'beta\n' }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'AX1-C: operator-join workflow', profile: 'standard', scope: ['**'],
    composition: {
      strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
      team: [
        { role: 'alpha', route: ROUTE },
        { role: 'beta', route: ROUTE },
      ],
    },
  }, owner);
  assert.deepEqual(started.blockedInteraction, { kind: 'approve_plan' });

  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const settled = await application.wait(started.runId, owner, { timeoutMs: 20_000 });
  assert.equal(settled.phase, 'selection_required', JSON.stringify(settled.phase));
  assert.deepEqual(settled.blockedInteraction, { kind: 'select_candidate' });
});

test('AX1-D: blockedInteraction stays null while a run is actively working with nothing pending', async (t) => {
  const { application } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 2_000 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'AX1-D (marker:default): write slowly with nothing pending', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  const approved = await application.approve(started.runId, started.plan.digest, principal('approver'));
  assert.equal(approved.phase, 'running');
  assert.equal(approved.blockedInteraction, null);

  const stillRunning = await application.status(started.runId, owner);
  assert.equal(stillRunning.phase, 'running');
  assert.equal(stillRunning.blockedInteraction, null,
    'no classification while running with a clear attention set');
});

test('AX1-E: runs.list items and the CLI run-status outline render blockedInteraction identically to the RunView', async (t) => {
  const { application } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 2_000 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'AX1-E (marker:default): CLI and list parity before approval', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  assert.deepEqual(started.blockedInteraction, { kind: 'approve_plan' });

  const listedBefore = (await application.listRuns(owner)).items.find((item) => item.id === started.runId);
  assert.deepEqual(listedBefore.blockedInteraction, started.blockedInteraction);

  const startedOutline = projectBatonCliResult(parseBatonCli(['run', 'status', started.runId]), started);
  assert.deepEqual(startedOutline.blockedInteraction, started.blockedInteraction);

  const approved = await application.approve(started.runId, started.plan.digest, principal('approver'));
  assert.equal(approved.blockedInteraction, null);

  const listedAfter = (await application.listRuns(owner)).items.find((item) => item.id === started.runId);
  assert.deepEqual(listedAfter.blockedInteraction, approved.blockedInteraction);

  const approvedOutline = projectBatonCliResult(parseBatonCli(['run', 'status', started.runId]), approved);
  assert.equal(approvedOutline.blockedInteraction, null);
  assert.deepEqual(approvedOutline.blockedInteraction, approved.blockedInteraction);
});

test('AX1-F: a burst of provider tool-call/message telemetry does not advance lastProgress while a run is otherwise idle', async (t) => {
  const { application, driver } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 600 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'AX1-F (marker:default): a slow edit with noisy tool telemetry in between', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));

  const worker = driver.coordinator.list().find((handle) => handle.taskId != null);
  assert.ok(worker, 'a worker must be claimed for the synthetic burst to attribute to');

  const early = (await application.listRuns(owner)).items.find((item) => item.id === started.runId);
  assert.equal(early.phase, 'running');

  // Real richer adapters (kimi-acp, grok-acp, claude-session) stream `content.tool_call`
  // (COMMAND_EXEC) and `content.message` chunks continuously while a turn is in flight; every
  // one of them is durably evidence-mapped into the coordination ledger by the coordinator's
  // Run-timeline plumbing (impl/src/coordinator.mjs RUN_TIMELINE_OPERATIONAL_KINDS), same as a
  // real committed `content.file_edit`. Drive that same durable path directly (as
  // impl/test/phase31-cairn-scorecard.test.mjs and others already do) to pin that this noise
  // is nonetheless excluded from `lastProgress`.
  for (let i = 0; i < 20; i += 1) {
    driver.log.append({
      worker: worker.id, harness: 'mock@1.0.0', turnEpoch: 0, actor: 'worker',
      kind: i % 2 === 0 ? 'content.tool_call' : 'content.message',
      payload: { tool: 'noop', index: i, text: `thinking about step ${i}` },
    });
  }

  const mid = (await application.listRuns(owner)).items.find((item) => item.id === started.runId);
  assert.equal(mid.phase, 'running', 'still working, not yet accepted');
  assert.equal(mid.lastProgress.at, early.lastProgress.at,
    'content.tool_call/content.message telemetry is evidence-mapped but must not count as meaningful progress');

  const settled = await application.wait(started.runId, owner, { timeoutMs: 20_000 });
  assert.equal(settled.phase, 'work_completed');
  const done = (await application.listRuns(owner)).items.find((item) => item.id === started.runId);
  assert.notEqual(done.lastProgress.at, early.lastProgress.at,
    'genuine settlement (a real committed edit and task acceptance) does advance lastProgress');
});
