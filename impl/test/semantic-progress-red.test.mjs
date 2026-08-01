// P1-C v2 red suite (docs/reference/evidence/semantic-progress-2026-07-31/
// semantic-progress-decisions.md — the v2 section at the top is the ONLY authority). Rows pin
// the deepseek red-team's corrections: (SP-1+) the AX headline case — an awaiting_plan_approval
// run with attention: [] classifies blocked_interaction:approve_plan, phase-derived blocking
// wins over attention-derived blocking, and the live projectBlockedInteraction `decision`
// string maps to answer_required; (SP-2+) requiredAction per block kind with canonical
// summaries that never leak the summary-less blockedInteraction shapes, actionId present iff
// advertised, end-to-end act resolution, and the re-read caveat; (SP-3+) vocabulary identity
// across the run outline + runs.list items (wave rows excluded), wire whitelist round-trips;
// (SP-4+) silent at exactly PROGRESS_SILENCE_THRESHOLD_MS with basis fields, timing fields and
// the blockedInteraction one-liner unchanged; (SP-5) NO rate_limited member anywhere.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  BatonApplication,
  McpFleetServer,
  MockAdapter,
  WebNorthbound,
  createDriver,
  parseBatonCli,
  projectBatonCliResult,
} from '../src/index.mjs';
import { projectProgressClass, projectRequiredAction } from '../src/application.mjs';
import { PROGRESS_SILENCE_THRESHOLD_MS } from '../src/application-semantics.mjs';

const REPO_ID = 'repo-semantic-progress';
const ROUTE = Object.freeze({ harness: 'mock', model: 'mock-model', effort: 'low' });

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-sp-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'sp@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'SP Test'], { cwd: root });
  writeFileSync(join(root, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function principal(id) {
  return Object.freeze({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
}

// One MockAdapter whose spawn() selects a scenario by matching a `(marker:x)` fragment embedded
// in the dispatched brief's goal text — same pattern as issue10/wave-driver so one harness can
// serve several fixtures.
function markerAdapter(scenariosByMarker) {
  const value = new MockAdapter({ harness: 'mock', scenario: scenariosByMarker.default ?? { outcome: 'completed' } });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'semantic-progress-test', refreshedAt: null,
    },
  });
  const nativeSpawn = value.spawn.bind(value);
  value.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
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

// The application clock is injectable so `_progressTiming`'s silenceMs is deterministic at
// exactly PROGRESS_SILENCE_THRESHOLD_MS (SP-4+). The coordination store keeps its own real
// clock, so run lifecycle is unaffected by the application-clock advance.
function harness(t, scenariosByMarker, options = {}) {
  const repo = repository();
  const logDir = mkdtempSync(join(tmpdir(), 'baton-sp-log-'));
  let appClock = options.clockStart ?? new Date().toISOString();
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
    clock: () => appClock,
  });
  t.after(async () => {
    try { await application.shutdown(principal('shutdown')); } catch { /* best-effort teardown */ }
    try { driver.coordination.releaseWriterLease(); } catch { /* best effort */ }
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return {
    application, driver,
    setClock(iso) { appClock = iso; },
    clock() { return appClock; },
  };
}

async function until(check, label, timeoutMs = 20_000, pollMs = 20) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`until: ${label} never became true within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function waitForProgressClass(application, runId, owner, className) {
  return until(
    async () => {
      const view = await application.status(runId, owner);
      return view.progressClass?.class === className ? view : null;
    },
    `progressClass ${className}`,
  );
}

const webContext = () => Object.freeze({
  principal: Object.freeze({
    userId: 'web-user', sessionId: 'web-session', credentialId: 'web-cred', authMethod: 'bearer',
    expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
    capabilities: ['control', 'observe', 'approve', 'emergency_stop', 'adopt_result', 'review', 'integrate_result'],
    repoIds: [REPO_ID],
  }),
  origin: 'https://control.example.test',
  remoteAddress: '127.0.0.1', transport: 'https',
});

const mcpPrincipal = () => Object.freeze({
  userId: 'mcp-user', sessionId: 'mcp-session',
  capabilities: ['control', 'observe', 'approve', 'emergency_stop', 'adopt_result', 'review', 'integrate_result'],
  repoIds: [REPO_ID], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
});

async function initialized(server) {
  const response = await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' },
  } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

// ---------------------------------------------------------------------------
// SP-1+: blocked_interaction classification — phase-AND-attention, pinned priority.
// ---------------------------------------------------------------------------

test('SP-1a: the AX headline case — awaiting_plan_approval with attention: [] classifies blocked_interaction:approve_plan', async (t) => {
  const { application } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-1a (marker:default): write the output file', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  assert.equal(started.phase, 'awaiting_plan_approval');
  assert.deepEqual(started.attention, [], 'pre-approval attention is empty — the blocked state is PHASE-derived');
  assert.equal(started.progressClass.class, 'blocked_interaction:approve_plan');
  assert.equal(typeof started.progressClass.silenceMs, 'number');
  assert.equal(typeof started.progressClass.meaningfulEventAt, 'string');
  assert.equal(started.blockedInteraction.kind, 'approve_plan', 'the blockedInteraction one-liner stays');
});

test('SP-1b: a phase-blocked run ALSO carrying a blocking attention item keeps the phase-derived detail (pinned priority)', () => {
  const attention = [{
    kind: 'answer_question', workerId: 'w1', requestId: 'req_w1_1', question: 'Which option?',
  }];
  const timing = { silenceMs: 0, lastProgress: { at: '2026-07-31T00:00:00.000Z' } };
  const phaseBlocked = projectProgressClass({
    phase: 'awaiting_plan_approval', attention, timing, terminalCause: null,
  });
  assert.equal(phaseBlocked.class, 'blocked_interaction:approve_plan',
    'the phase-derived block wins — it is the run\'s own state, attention items are per-worker');
  const attentionBlocked = projectProgressClass({
    phase: 'running', attention, timing, terminalCause: null,
  });
  assert.equal(attentionBlocked.class, 'blocked_interaction:answer_required');
  const checkpointBlocked = projectProgressClass({
    phase: 'running',
    attention: [{ kind: 'turn_checkpoint', workerId: 'w1', requestId: 'pause:w1:1' }],
    timing, terminalCause: null,
  });
  assert.equal(checkpointBlocked.class, 'blocked_interaction:turn_checkpoint');
  const selectionBlocked = projectProgressClass({
    phase: 'selection_required', attention: [], timing, terminalCause: null,
  });
  assert.equal(selectionBlocked.class, 'blocked_interaction:select_candidate',
    'the other phase-derived block fires with empty attention too');
});

test('SP-1c: the live projectBlockedInteraction `decision` string maps to answer_required', async (t) => {
  const { application } = harness(t, {
    decision: {
      outcome: 'completed', edits: [],
      ask: {
        kind: 'decision', question: 'select a candidate route', blocking: true, deadlineMs: 60_000,
        options: [{ id: 'opt-a', label: 'route a', summary: 'fastest' }],
      },
    },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-1c (marker:decision): probe the decision block', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const view = await waitForProgressClass(application, started.runId, owner, 'blocked_interaction:answer_required');
  assert.equal(view.blockedInteraction.kind, 'decision', 'the LIVE projectBlockedInteraction string rides the view');
  assert.equal(view.progressClass.class, 'blocked_interaction:answer_required');
});

// ---------------------------------------------------------------------------
// SP-2+: requiredAction — honest sourcing, advertised actionId, end-to-end resolution.
// ---------------------------------------------------------------------------

test('SP-2a: approve_plan carries its canonical summary — the summary-less blockedInteraction shape never leaks', async (t) => {
  const { application } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-2a (marker:default): write the output file', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  const view = await application.status(started.runId, owner);
  assert.deepEqual(view.blockedInteraction, { kind: 'approve_plan' }, 'blockedInteraction stays summary-less');
  assert.deepEqual(
    { kind: view.requiredAction.kind, summary: view.requiredAction.summary },
    { kind: 'approve_plan', summary: 'Plan approval is required to proceed' },
    'requiredAction never inherits the summary-less one-liner shape',
  );
  assert.equal(typeof view.requiredAction.actionId, 'string', 'approve_plan is advertised on this view');
});

test('SP-2b: answer_decision carries the requestId in its summary', async (t) => {
  const { application } = harness(t, {
    decision: {
      outcome: 'completed', edits: [],
      ask: {
        kind: 'decision', question: 'pick one', blocking: true, deadlineMs: 60_000,
        options: [{ id: 'opt-a', label: 'route a' }],
      },
    },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-2b (marker:decision): probe the decision block', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const view = await waitForProgressClass(application, started.runId, owner, 'blocked_interaction:answer_required');
  const decision = view.attention.find((entry) => entry.kind === 'answer_decision');
  assert.ok(decision, 'the answer_decision attention entry is present');
  assert.equal(view.requiredAction.kind, 'answer_decision');
  assert.equal(view.requiredAction.summary, decision.requestId, 'the requestId names the decision to answer');
  assert.equal(typeof view.requiredAction.actionId, 'string', 'answer_decision is advertised with a valid requestId');
});

test('SP-2c: actionId is present iff advertised — a not-advertised block yields {kind, summary} with NO actionId, never a fabricated token', () => {
  const attention = [{
    kind: 'answer_question', workerId: 'w1', requestId: null, question: 'not advertised',
  }];
  const notAdvertised = projectRequiredAction({ phase: 'running', attention, actions: [] });
  assert.deepEqual(notAdvertised, { kind: 'answer_question', summary: 'not advertised' });
  assert.equal(Object.hasOwn(notAdvertised, 'actionId'), false, 'no fabricated token');
  const advertised = projectRequiredAction({
    phase: 'running', attention,
    actions: [{ kind: 'answer_question', actionId: 'advertised-token' }],
  });
  assert.equal(advertised.actionId, 'advertised-token', 'the advertised token is carried verbatim');
  const cleared = projectRequiredAction({ phase: 'running', attention: [], actions: [] });
  assert.equal(cleared, null, 'absent when no blocking condition holds');
});

test('SP-2d: executing the advertised actionId resolves the block end-to-end', async (t) => {
  const { application } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-2d (marker:default): write the output file', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  const view = await application.status(started.runId, owner);
  assert.equal(view.progressClass.class, 'blocked_interaction:approve_plan');
  assert.equal(view.requiredAction.kind, 'approve_plan');
  const acted = await application.act({
    runId: started.runId,
    actionId: view.requiredAction.actionId,
    inputs: { planDigest: started.plan.digest },
  }, owner);
  assert.notEqual(acted.phase, 'awaiting_plan_approval', 'the advertised act resolves the block');
  const after = await application.status(started.runId, owner);
  assert.notEqual(after.progressClass.class, 'blocked_interaction:approve_plan');
  assert.notEqual(after.requiredAction?.kind, 'approve_plan');
});

test('SP-2e: a stale actionId after a view change refuses with the existing taxonomy (the re-read caveat exercised)', async (t) => {
  const { application } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-2e (marker:default): write the output file', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  const view = await application.status(started.runId, owner);
  const staleActionId = view.requiredAction.actionId;
  assert.equal(typeof staleActionId, 'string');
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  await assert.rejects(
    () => application.act({
      runId: started.runId, actionId: staleActionId, inputs: { planDigest: started.plan.digest },
    }, owner),
    (error) => error.code === 'application_action_scope_mismatch',
    'a consumer must re-read before acting on a stale view',
  );
});

// ---------------------------------------------------------------------------
// SP-3+: vocabulary identity + wire whitelist round-trips.
// ---------------------------------------------------------------------------

test('SP-3a: vocabulary identity — the run outline, the CLI outline, and the runs.list item serialize the SAME progressClass/requiredAction', async (t) => {
  const { application } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-3a (marker:default): write the output file', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  const outline = await application.status(started.runId, owner);
  const listed = (await application.listRuns(owner)).items.find((item) => item.id === started.runId);
  assert.ok(listed, 'the run is listed');
  assert.deepEqual(listed.progressClass, outline.progressClass, 'progressClass is one vocabulary on both surfaces');
  assert.deepEqual(listed.requiredAction, outline.requiredAction, 'requiredAction is one vocabulary on both surfaces');
  const cliOutline = projectBatonCliResult(parseBatonCli(['run', 'status', started.runId]), outline);
  assert.deepEqual(cliOutline.progressClass, outline.progressClass, 'the CLI outline carries the same progressClass');
  assert.deepEqual(cliOutline.requiredAction, outline.requiredAction, 'the CLI outline carries the same requiredAction');
});

test('SP-3b: a web run_view round-trip includes progressClass/requiredAction on the outline', async (t) => {
  const { application, driver } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-3b (marker:default): write the output file', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  const web = new WebNorthbound({
    coordinator: driver.coordinator, coordination: driver.coordination,
    repoIds: [REPO_ID], allowedOrigins: ['https://control.example.test'],
    now: () => Date.now(), application,
  });
  const response = await web.execute(webContext(), Object.freeze({
    schemaVersion: 1,
    commandId: 'sp-web-1', idempotencyKey: 'sp-web-1',
    command: 'run_view', args: { runId: started.runId, depth: 'outline' },
    repoId: REPO_ID, runId: started.runId, origin: 'https://control.example.test',
  }));
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const outline = response.body?.result?.outline;
  assert.ok(outline, 'the outline is present on the web response');
  assert.equal(outline.progressClass.class, 'blocked_interaction:approve_plan');
  assert.equal(outline.requiredAction.kind, 'approve_plan');
  assert.equal(typeof outline.requiredAction.actionId, 'string');
});

test('SP-3c: an MCP baton_run_inspect tool response includes progressClass/requiredAction on the outline', async (t) => {
  const { application, driver } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-3c (marker:default): write the output file', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  const server = new McpFleetServer({
    coordinator: driver.coordinator, coordination: driver.coordination,
    application, applicationOwned: false, surface: 'application',
    principal: mcpPrincipal(), repoIds: [REPO_ID],
    now: () => Date.now(), maxWaitMs: 25_000, maxMessageBytes: 256 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  await initialized(server);
  const response = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: {
    name: 'baton_run_inspect', arguments: { repoId: REPO_ID, runId: started.runId, depth: 'outline' },
  } });
  assert.equal(response.result.isError, false, JSON.stringify(response));
  const parsed = JSON.parse(response.result.content[0].text);
  assert.equal(parsed.outline.progressClass.class, 'blocked_interaction:approve_plan');
  assert.equal(parsed.outline.requiredAction.kind, 'approve_plan');
});

test('SP-3d: MAX_RUN_VIEW_BYTES holds with progressClass/requiredAction present', async (t) => {
  const { application } = harness(t, {
    decision: {
      outcome: 'completed', edits: [],
      ask: {
        kind: 'decision', question: 'pick one', blocking: true, deadlineMs: 60_000,
        options: [{ id: 'opt-a', label: 'route a', summary: 'fastest' }],
      },
    },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-3d (marker:decision): probe the decision block', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const view = await waitForProgressClass(application, started.runId, owner, 'blocked_interaction:answer_required');
  assert.ok(Buffer.byteLength(JSON.stringify(view)) <= 256 * 1024,
    'the view with both additions stays under the deployment byte ceiling');
  assert.ok(view.requiredAction, 'the block carries a resolving action');
});

// ---------------------------------------------------------------------------
// SP-4+: silent at exactly the named threshold; registry carries the constant.
// ---------------------------------------------------------------------------

test('SP-4a: silent fires at exactly PROGRESS_SILENCE_THRESHOLD_MS and not a millisecond before', async (t) => {
  const { application, setClock, clock } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 60_000 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-4a (marker:default): a long silent delay', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  let running = await until(async () => {
    const view = await application.status(started.runId, owner);
    return view.phase === 'running' && view.progressClass?.class === 'progressing' ? view : null;
  }, 'run running and progressing');
  assert.equal(running.progressClass.silenceMs < PROGRESS_SILENCE_THRESHOLD_MS, true, 'silence below the threshold');
  assert.equal(typeof running.progressClass.meaningfulEventAt, 'string', 'the basis field is present');
  // The worker's claim/dispatch events land in the first few hundred ms; settle the baseline so
  // the clock advance is measured from the FINAL meaningful event (the edit itself is 60s out).
  await new Promise((resolve) => setTimeout(resolve, 200));
  running = await application.status(started.runId, owner);
  assert.equal(running.progressClass.class, 'progressing', 'still progressing once the worker is settled');
  const meaningfulAt = Date.parse(running.progressClass.meaningfulEventAt);
  const thresholdIso = new Date(meaningfulAt + PROGRESS_SILENCE_THRESHOLD_MS).toISOString();
  setClock(thresholdIso);
  const silent = await application.status(started.runId, owner);
  assert.equal(silent.progressClass.class, 'silent', 'silent at exactly the named threshold');
  assert.equal(silent.progressClass.silenceMs, PROGRESS_SILENCE_THRESHOLD_MS, 'silenceMs is exactly the threshold');
  assert.equal(silent.progressClass.meaningfulEventAt, running.progressClass.meaningfulEventAt, 'basis field rides along');

  setClock(new Date(meaningfulAt + PROGRESS_SILENCE_THRESHOLD_MS - 1).toISOString());
  const below = await application.status(started.runId, owner);
  assert.equal(below.progressClass.class, 'progressing', 'one millisecond below the threshold is still progressing');
  assert.equal(below.progressClass.silenceMs, PROGRESS_SILENCE_THRESHOLD_MS - 1);
});

test('SP-4b: the semantics registry carries PROGRESS_SILENCE_THRESHOLD_MS beside the progressClass enum', () => {
  assert.equal(Number.isSafeInteger(PROGRESS_SILENCE_THRESHOLD_MS) && PROGRESS_SILENCE_THRESHOLD_MS > 0, true);
  const enums = APPLICATION_SEMANTIC_REGISTRY.enums;
  assert.ok(enums.progressClass, 'the registry enum table carries progressClass');
  assert.ok(Array.isArray(enums.progressClass.prefixes), 'terminal:/blocked_interaction: prefixes');
  assert.deepEqual(enums.progressClass.prefixes, ['terminal:', 'blocked_interaction:']);
  assert.ok(enums.progressClass.leaves.includes('silent') && enums.progressClass.leaves.includes('progressing'),
    'the silent/progressing leaves are named');
  assert.ok(enums.progressClass.blockedDetails.includes('approve_plan')
    && enums.progressClass.blockedDetails.includes('select_candidate')
    && enums.progressClass.blockedDetails.includes('answer_required')
    && enums.progressClass.blockedDetails.includes('turn_checkpoint'),
    'the four blocking details are named');
});

test('SP-4c: timing fields and the blockedInteraction one-liner are unchanged by the additions', async (t) => {
  const { application } = harness(t, {
    default: { outcome: 'completed', edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }] },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-4c (marker:default): write the output file', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  const view = await application.status(started.runId, owner);
  const listed = (await application.listRuns(owner)).items.find((item) => item.id === started.runId);
  assert.ok(['startedAt', 'observedAt', 'elapsedMs', 'lastProgress', 'silenceMs', 'completedAt']
    .every((field) => Object.hasOwn(listed, field)), 'the runs.list timing fields ride unchanged');
  assert.deepEqual(view.blockedInteraction, { kind: 'approve_plan' }, 'the one-liner is byte-stable');
  assert.deepEqual(listed.blockedInteraction, view.blockedInteraction, 'the one-liner is identical on the list');
});

// ---------------------------------------------------------------------------
// SP-5: NO rate_limited member exists in the enum (source-scan + registry dump).
// ---------------------------------------------------------------------------

test('SP-5a: the progressClass enum has no rate_limited member — source-scan and registry dump agree', async () => {
  const enums = APPLICATION_SEMANTIC_REGISTRY.enums.progressClass;
  const allMembers = [...enums.prefixes, ...enums.leaves, ...enums.blockedDetails];
  assert.equal(allMembers.includes('rate_limited'), false, 'registry dump has no rate_limited member');
  assert.equal(JSON.stringify(allMembers).includes('rate_limited'), false);
  // Source-scan the enum table region of the registry module.
  const source = readFileSync(new URL('../src/application-semantics.mjs', import.meta.url), 'utf8');
  const enumRegion = source.slice(
    source.indexOf('PROGRESS_CLASS'),
    Math.max(source.indexOf('APPLICATION_LIFECYCLE_ENUMS'), source.indexOf('export const APPLICATION_SEMANTIC_REGISTRY')),
  );
  assert.equal(enumRegion.includes('rate_limited'), false, 'the enum source carries no rate_limited member');
});

test('SP-5b: a limit-shaped prose provider result never classifies as rate_limited — only progressing or silent', async (t) => {
  const { application } = harness(t, {
    default: {
      outcome: 'completed',
      edits: [{ path: 'out.txt', content: 'done\n', delayMs: 300 }],
      message: 'provider session limit reached: retry after 60 seconds',
    },
  });
  const owner = principal('owner');
  const started = await application.start({
    objective: 'SP-5b (marker:default): a limit-shaped prose run', profile: 'standard', route: ROUTE, scope: ['**'],
  }, owner);
  const view = await application.status(started.runId, owner);
  assert.equal(view.progressClass.class, 'blocked_interaction:approve_plan', 'pre-approval block is phase-derived');
  await application.approve(started.runId, started.plan.digest, principal('approver'));
  const running = await until(async () => {
    const current = await application.status(started.runId, owner);
    return current.phase === 'running' ? current : null;
  }, 'run running despite limit-shaped prose');
  assert.ok(
    ['progressing', 'silent'].includes(running.progressClass.class),
    `limit-shaped prose classifies as ${running.progressClass.class}, never rate_limited`,
  );
  assert.equal(running.progressClass.class, 'progressing');
});
