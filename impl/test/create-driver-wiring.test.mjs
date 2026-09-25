// create-driver-wiring.test.mjs — issue #259 slice 0 (docs/audits/2026-09-13-runtime-policy).
//
// Why this file exists: on 2026-09-13 the shared-custody checkpoint displaced one line of driver
// wiring — `route.record = (…) => router.record(…)` in createDriver — and the whole suite stayed
// green (fixed in 5bd37fbf). Nothing failed because every consumer guards the hand-off with
// `typeof this._route.record === 'function'`: an unwired authority is not an error, it is a silent
// no-op, and hub-verified terminals simply stopped recording route observations. The same shape
// repeats for the other late-bound authorities createDriver assembles: each is consulted only
// through a member that tolerates its absence.
//
// So each test here builds the REAL driver (createDriver over a real temp git repo with a
// MockAdapter), runs a real task to a verified terminal, and asserts the injected authority was
// actually consulted — never that the driver merely constructed. The wiring identity assertion
// (`driver.coordinator._route.record` is a function) fails the moment the assignment is deleted,
// and the run assertions fail if the authority is present but unreachable.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver, prepareVerificationRuntime } from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-wiring-${name}-`));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function repo() {
  const path = root('repo');
  execFileSync('git', ['init', '-q'], { cwd: path });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: path });
  return path;
}

/** Poll a coordinator read until it reports ready; the run is real, so its end is a wall-clock event. */
async function until(fn, predicate, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let value = null;
  while (Date.now() < deadline) {
    value = await fn();
    if (predicate(value)) return value;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}: ${JSON.stringify(value)}`);
}

function verification(arguments_, overrides = {}) {
  return {
    command: 'node', arguments: arguments_, cwd: '.',
    envAllowlist: ['PATH', 'LANG', 'WIRING_PROBE'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
    requiredPredecessorEvidence: [], ...overrides,
  };
}

function brief(overrides = {}) {
  return {
    goal: 'prove the driver wiring', constraints: [], pathScope: [],
    definitionOfDone: 'the injected authorities are consulted',
    verification: verification(['-e', "process.exit(process.env.WIRING_PROBE === 'seam-wired' ? 0 : 91)"]),
    budget: { tokens: 10_000, usd: 1, wallMin: 5 },
    ...overrides,
  };
}

// The deployment's closed verifier runtime, distinguished two ways: its digest is what the
// verdict must cite, and its constant is what the verification command can only see through it.
const RUNTIME_POLICY = Object.freeze({
  schemaVersion: 1, pathEntries: Object.freeze([dirname(process.execPath)]),
  constants: Object.freeze({ LANG: 'C', WIRING_PROBE: 'seam-wired' }),
});
const RUNTIME_DIGEST = prepareVerificationRuntime(RUNTIME_POLICY).digest;

const mock = () => new MockAdapter({
  scenario: { outcome: 'completed', edits: [{ path: 'wired.txt', content: 'wired\n' }] },
  card: { harness: 'mock', version: 'wiring-1', model: 'wiring-model' },
});

/** The provider edge, recorded: the briefs an adapter was actually asked to run. The driver-level
 * claims below read this, never the coordinator's internals, so "the authority was consulted" and
 * "the composed value reached the provider" are observed facts about a real dispatch. */
class RecordingMockAdapter extends MockAdapter {
  constructor(config = {}) {
    super(config);
    this.servedBriefs = [];
  }

  async spawn(worker, brief, opts = {}) {
    this.servedBriefs.push(structuredClone(brief));
    return super.spawn(worker, brief, opts);
  }
}

test('CDW1: one real verified run consults the injected route authority, custody provider, and verifier runtime', async (t) => {
  const repository = repo();
  const logDir = root('log');
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-wiring', logDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
  });
  t.after(async () => {
    await driver.drainAndClose('wiring-cdw1').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  // 1. Route authority. This is the exact guard every route-learning call site uses
  //    (coordinator.mjs `typeof this._route.record === 'function'`), so its absence is the
  //    5bd37fbf regression: a driver whose route authority cannot record.
  assert.equal(typeof driver.coordinator._route.record, 'function', 'createDriver must wire route.record onto the coordinator route authority');
  const recorded = [];
  const routerRecord = driver.router.record.bind(driver.router);
  driver.router.record = (...args) => { recorded.push(args); return routerRecord(...args); };

  // 2. The worktree custody provider. createDriver injects it into the worktree manager as the
  //    live-holder closure whose answer is `coordinator.liveWorkspaceHolders`; watching the
  //    delegate proves the injected provider was consulted rather than bypassed.
  const holderCalls = [];
  const liveHolders = driver.coordinator.liveWorkspaceHolders.bind(driver.coordinator);
  driver.coordinator.liveWorkspaceHolders = (...args) => { holderCalls.push(args); return liveHolders(...args); };

  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'wiring-run', taskType: 'general' });
  const outcome = await until(() => driver.coordinator.result(handle.id), (value) => value?.ready, 'the verified terminal of wiring-run');
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));

  // 3. Verifier seam. The verdict cites the injected runtime's digest, and the run only reaches
  //    `completed` because the pinned command read the constant that runtime alone supplies: a
  //    driver that prepared a different runtime (or none) fails one of these two.
  assert.equal(outcome.verdict.runtimeDigest, RUNTIME_DIGEST, 'the verdict must cite the injected verification runtime');
  assert.equal(driver.coordinator.verificationRuntimeDigest(), RUNTIME_DIGEST, 'the coordinator must hold the injected verification runtime digest');
  assert.equal(outcome.verdict.passed, true);

  // 4. Route observation. Without the wiring the coordinator's guard silently skips this call and
  //    learning is lost with no error anywhere.
  assert.ok(recorded.length >= 1, 'a verified terminal must reach router.record through the injected route authority');
  assert.equal(recorded[0][2], true, 'the recorded outcome is the verified win');
  assert.ok(holderCalls.length >= 1, 'the injected custody provider must be consulted at least once by a real run');
  for (const [physicalOwnerId] of holderCalls) {
    assert.equal(typeof physicalOwnerId === 'string' || physicalOwnerId === null || physicalOwnerId === undefined, true);
  }
});

// The control that justifies this file: reproduce the 5bd37fbf shape — a route authority without
// `record` — and show it is SILENT. The same verified terminal still reports `completed`, the
// event log still closes the task, and nothing anywhere throws. A driver-level suite can be fully
// green with route learning dead, which is exactly what happened; only the wiring assertion in
// CDW1 (or an observation count, as here) can see it.
test('CDW3: an authority without record is a silent no-op, not a failure — the shape of 5bd37fbf', async (t) => {
  const repository = repo();
  const logDir = root('control-log');
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-wiring-control', logDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
  });
  t.after(async () => {
    await driver.drainAndClose('wiring-cdw3').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const recorded = [];
  const routerRecord = driver.router.record.bind(driver.router);
  driver.router.record = (...args) => { recorded.push(args); return routerRecord(...args); };
  delete driver.coordinator._route.record;
  assert.equal(driver.coordinator._route.record, undefined);

  const handle = await driver.coordinator.spawn('mock', brief(), { taskId: 'wiring-control-run', taskType: 'general' });
  const outcome = await until(() => driver.coordinator.result(handle.id), (value) => value?.ready, 'the verified terminal of wiring-control-run');
  assert.equal(outcome.status, 'completed', 'the run is unaffected by the missing authority');
  assert.equal(outcome.verdict.passed, true);
  assert.equal(recorded.length, 0, 'an unwired route authority loses the observation with no error: this is the regression CDW1 pins');
  assert.equal(driver.coordination.task('wiring-control-run').status, 'completed',
    'the task still reaches its durable terminal — silence, not failure');
});

test('CDW2: the injected goal-plan authority is consulted for goal, plan, approval, and plan-gated dispatch', async (t) => {
  const repository = repo();
  const logDir = root('plan-log');
  const consultations = [];
  const authorize = async (request) => { consultations.push(request); return true; };
  const policy = Object.freeze({
    schemaVersion: 1, repoId: 'repo-wiring-plan', mandatory: false, approvalTtlMs: 3_600_000,
    riskClasses: Object.freeze(['low', 'medium', 'high', 'critical']),
    effectClasses: Object.freeze(['repository_edit', 'provider_call']),
    capabilityClasses: Object.freeze(['code', 'test']),
    limits: Object.freeze({
      maxGoalVersions: 4, maxPlanVersions: 4, maxNodes: 8, maxDepsPerNode: 4,
      maxTextBytes: 4096, maxItems: 16, maxScopePaths: 16, maxRouteValues: 8,
      maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
      maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 60, maxProviderTurns: 100,
    }),
  });
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-wiring-plan', logDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
    goalPlanAuthority: { policy, authorize },
  });
  t.after(async () => {
    await driver.drainAndClose('wiring-cdw2').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const auth = (principalId, powers, idempotencyKey) => ({
    actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`, powers,
    repoId: 'repo-wiring-plan', runId: null, idempotencyKey,
  });
  const budget = { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 };
  const nodeVerification = verification(['-e', "process.exit(process.env.WIRING_PROBE === 'seam-wired' ? 0 : 91)"], { timeoutMs: 30_000 });
  const intent = { vendor: 'mock', model: 'wiring-model', effort: 'low' };

  const goal = (await driver.coordinator.defineGoal({
    objective: 'Ship the plan-gated slice', definitionOfDone: ['the pinned check passes'],
    constraints: [], risk: 'low', budget, predecessor: null,
  }, auth('goal-owner', ['goal:define'], 'wiring-goal'))).goal;
  const plan = (await driver.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'implement', objective: 'Implement the plan-gated slice', definitionOfDone: ['the pinned check passes'],
      deps: [], pathScope: ['**'], risk: 'low', budget: { tokens: 10_000, usd: 2, wallMin: 10, providerTurns: 8 },
      verification: nodeVerification, routes: { harnesses: ['mock'], models: ['wiring-model'], efforts: ['low'] },
      capabilities: ['code', 'test'], effects: ['repository_edit'],
    }],
  }, auth('planner', ['plan:propose'], 'wiring-plan'))).plan;
  await driver.coordinator.approvePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    plan: { planId: plan.planId, version: plan.version, digest: plan.digest },
    expectedDisposition: null, disposition: 'approved',
  }, auth('approver', ['plan:approve'], 'wiring-approval'));

  const routeBinding = { vendor: intent.vendor, model: intent.model, effort: intent.effort };
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: 'implement', expectedDispatchVersion: 0,
    capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const admitted = driver.coordination.previewPlanDispatch(gate, routeBinding);
  // The plan's Brief carries the goal/plan coordinates; the caller may not restate them, so the
  // dispatch input is that Brief minus the coordinates (the coordinator re-derives them itself).
  const { goalPlan: _coordinates, ...callerBrief } = admitted.brief;
  const handle = await driver.coordinator.spawn('mock', callerBrief, {
    taskId: 'wiring-plan-run', model: intent.model, effort: intent.effort,
    goalPlan: gate,
    actor: 'direct:dispatcher', principalId: 'dispatcher', sessionId: 'dispatcher-session',
    powers: ['plan:dispatch'], idempotencyKey: 'wiring-plan-dispatch',
  });
  const outcome = await until(() => driver.coordinator.result(handle.id), (value) => value?.ready, 'the verified terminal of wiring-plan-run');
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));

  const operations = consultations.map((request) => request.operation);
  for (const operation of ['goal_define', 'plan_propose', 'plan_approve', 'plan_dispatch']) {
    assert.ok(operations.includes(operation), `the injected goal-plan authority must be consulted for ${operation} (saw ${operations.join(', ')})`);
  }
  for (const request of consultations) {
    assert.equal(request.repoId, 'repo-wiring-plan');
    assert.match(request.requestDigest, /^[a-f0-9]{64}$/u);
  }
  const principals = new Set(consultations.map((request) => request.principalId));
  for (const principalId of ['goal-owner', 'planner', 'approver', 'dispatcher']) {
    assert.ok(principals.has(principalId), `the authority must see the real principal ${principalId}`);
  }
});

// The brief-time knowledge seam (KG-3 rule 9, docs/34 §3): the coordinator consults a
// provider-supplied `knowledgeBriefingProvider` and attaches its answer to the provider-facing
// value only. Nothing about the seam is optional at the composition root: a driver whose
// composition root does not carry the provider is a driver whose briefings are silently inert,
// which is the same failure shape as 5bd37fbf one layer out.
test('CDW4: the injected knowledge-briefing provider is consulted, and its block reaches the provider-facing brief only', async (t) => {
  const repository = repo();
  const logDir = root('briefing-log');
  const adapter = new RecordingMockAdapter({
    scenario: { outcome: 'completed', edits: [{ path: 'wired.txt', content: 'wired\n' }] },
    card: { harness: 'mock', version: 'wiring-1', model: 'wiring-model' },
  });
  const consultations = [];
  const briefing = Object.freeze({
    text: 'finding:alpha (Finding): alpha beta signal', truncated: false,
    provenance: 'hub-derived', untrusted: true,
  });
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-wiring-brief', logDir,
    adapters: { mock: adapter }, verificationRuntime: RUNTIME_POLICY,
    knowledgeBriefingProvider: (inner) => { consultations.push(structuredClone(inner)); return briefing; },
  });
  t.after(async () => {
    await driver.drainAndClose('wiring-cdw4').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  const admitted = brief();
  const handle = await driver.coordinator.spawn('mock', admitted, { taskId: 'wiring-brief-run', taskType: 'general' });
  const outcome = await until(() => driver.coordinator.result(handle.id), (value) => value?.ready, 'the verified terminal of wiring-brief-run');
  assert.equal(outcome.status, 'completed', JSON.stringify(outcome));

  // 1. The injected provider is consulted. A composition root that drops the option still
  //    reaches this same `completed` terminal with the seam inert, so the observation itself is
  //    the check — never the run outcome.
  assert.ok(consultations.length >= 1, 'the injected briefing provider must be consulted for a dispatched worker');
  // 2. The briefing never enters the durable task: the admitted brief carries no `briefing` key,
  //    so `briefDigest = canonicalDigest(task.brief)` cannot move when a briefing changes
  //    (KG-3 rule 6/6a), and the provider is handed the admitted brief's own fields.
  const stored = driver.coordination.task('wiring-brief-run').brief;
  assert.equal(Object.hasOwn(consultations[0], 'briefing'), false, 'the provider must see the brief without its own block');
  assert.equal(Object.hasOwn(stored, 'briefing'), false, 'the briefing never enters task.brief');
  assert.equal(consultations[0].goal, stored.goal, 'the provider is handed the admitted brief');
  // 3. The composed value reaches the provider edge, with the inner fields intact.
  const served = adapter.servedBriefs.filter((value) => value && value.briefing).at(-1) ?? null;
  assert.ok(served, `the composed briefing must reach the adapter's spawn brief (served ${adapter.servedBriefs.length})`);
  assert.deepEqual(served.briefing, briefing, 'the adapter is handed the provider\'s exact answer');
  assert.equal(served.goal, stored.goal, 'the inner brief fields survive the composition untouched');
});

// Issue #558 follow-up: the declared shared remote is an opt the composition root validates and
// hands to the Coordinator, while the landing authority application.mjs assembles reads it off the
// object createDriver RETURNS (`this.driver.integrationPublishRemote`). A returned object that
// omits the member makes that read undefined, the authority composes publishRemote: null, and
// every real landing refuses integrate_publish_undeclared however the deployment declared its
// remote — the state this deployment was in one level below the declaration the operator sets.
// Both values are asserted: the normalized declaration, and the null an undeclared deployment
// gets, which the authority's own typeof check must read as "none declared" rather than undefined.
test('CDW6: the declared shared remote reaches the driver the landing authority reads', async (t) => {
  const repository = repo();
  const logDir = root('publish-log');
  const undeclaredLogDir = root('publish-none-log');
  const PUBLISH_REMOTE = 'https://example.test/baton-shared.git';
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-wiring-publish', logDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
    integrationPublishRemote: PUBLISH_REMOTE,
  });
  const undeclared = createDriver({
    repoRoot: repository, repoId: 'repo-wiring-publish-none', logDir: undeclaredLogDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
  });
  t.after(async () => {
    await driver.drainAndClose('wiring-cdw6').catch(() => {});
    await undeclared.drainAndClose('wiring-cdw6-none').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    rmSync(undeclaredLogDir, { recursive: true, force: true });
  });

  assert.equal(driver.integrationPublishRemote, PUBLISH_REMOTE,
    'the declared remote must ride the driver object the landing authority reads it from');
  assert.equal(undeclared.integrationPublishRemote, null,
    'an undeclared deployment must still carry the member, as the null that declares none');
});

// Issues #572/#574 follow-up, the CDW6 shape one authority over: the operator's declared routing
// rule (harnesses no seat may be routed onto) is validated at the deployment open
// (advanced.routing.excludeHarnesses), handed through the driver options, and READ BACK OFF the
// object createDriver returns (`this.driver.routingExcludedHarnesses`) by the swarm runtime the
// application assembles. A returned object that omits the member makes that read undefined and
// the rule silently inert, so both values are asserted: the normalized declaration, and the
// empty array an undeclared deployment gets.
test('CDW7: the declared routing exclusion reaches the driver the swarm runtime reads', async (t) => {
  const repository = repo();
  const logDir = root('routing-log');
  const undeclaredLogDir = root('routing-none-log');
  const driver = createDriver({
    repoRoot: repository, repoId: 'repo-wiring-routing', logDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
    routingExcludedHarnesses: ['codex'],
    routingAllowedModels: { codex: ['gpt-6-*'] },
  });
  const undeclared = createDriver({
    repoRoot: repository, repoId: 'repo-wiring-routing-none', logDir: undeclaredLogDir,
    adapters: { mock: mock() }, verificationRuntime: RUNTIME_POLICY,
  });
  t.after(async () => {
    await driver.drainAndClose('wiring-cdw7').catch(() => {});
    await undeclared.drainAndClose('wiring-cdw7-none').catch(() => {});
    rmSync(repository, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
    rmSync(undeclaredLogDir, { recursive: true, force: true });
  });

  assert.deepEqual(driver.routingExcludedHarnesses, ['codex'],
    'the declared exclusion must ride the driver object the swarm runtime reads it from');
  assert.deepEqual(driver.routingAllowedModels, { codex: ['gpt-6-*'] },
    'the declared model allow rule must ride the same driver object');
  assert.deepEqual(undeclared.routingExcludedHarnesses, [],
    'an undeclared deployment carries the member as the empty array that excludes nothing');
  assert.deepEqual(undeclared.routingAllowedModels, {},
    'and the empty map that constrains no harness');
});

// The composition root's option surface is a closed set, and this file must say which options it
// exercises. A new `opts.<name>` read inside createDriver — an authority that arrives through the
// factory and is consulted by the runtime it builds — is a wiring the driver-level suite would
// otherwise never see: the two lists below must together name every option the factory reads,
// and an `exercised` claim must be backed by a case in THIS file that names the option.
const EXERCISED_OPTIONS = Object.freeze({
  adapters: 'CDW1',
  goalPlanAuthority: 'CDW2',
  integrationPublishRemote: 'CDW6',
  knowledgeBriefingProvider: 'CDW4',
  routingAllowedModels: 'CDW7',
  routingExcludedHarnesses: 'CDW7',
  verificationRuntime: 'CDW1',
});
// Options the factory reads that no case here exercises yet. Each row is a debt a reader can act
// on, never a claim that the option is inert: the row names the path that would exercise it.
const UNEXERCISED_OPTIONS = Object.freeze({
  recorderPort: 'the observation-layer port the effect and recovery seams share; passed through by createDriver and composed over the wrapped authorities by the Coordinator constructor when absent',
  advisoryFeedSources: 'consulted by advisory feed projections, which need a feed card',
  approvalTimeoutMs: 'an interaction deadline, reached only by a pending approval',
  atlas: 'assembled only when the atlas capability is opted in',
  budgetPolicy: 'a threshold policy, reached only by a budget-crossing run',
  canonicalOrderPolicy: 'a policy, reached only by a canonical-order transaction',
  capabilities: 'consulted when a registered capability is invoked by a worker',
  capabilityContexts: 'consulted when a registered capability is invoked by a worker',
  capabilityFactories: 'read at assembly; the produced capability must still be invoked',
  contextProgram: 'reached only by a contextCall brief',
  coordination: 'a caller-supplied store; every case uses the factory-built one',
  coordinationAsyncOpen: 'the deployment open path, not this file\'s construction',
  deploymentBaseSha: 'a pinned worktree base; no case supplies one',
  drainPolicy: 'reached by drainAndClose, which every case runs without asserting its policy',
  gitExec: 'the preserved-result resolution spawn seam; no case resolves preserved results',
  hostCapacity: 'the contribution check is its only consult site',
  logDir: 'the store root; exercised implicitly by every case\'s construction',
  maxCapabilityBudgetTokens: 'a ceiling over the capability registry',
  maxCapabilityEnvelopeBytes: 'a ceiling over the capability registry',
  now: 'the deployment clock seam; cases use the default',
  progressNudgeWindowMs: 'the stall window, reached only by a stalled turn',
  providerGovernance: 'consulted on a provider call under a governance policy',
  providerPolling: 'a supervisor, started only with a reuse policy and poll cards',
  providerProcessingSchedule: 'a supervisor, started only with its bounded retry policy',
  providerQuotaAuthority: 'consulted on a provider quota refusal',
  providerRead: 'consulted by provider status reads',
  providerReconciliation: 'consulted by provider reconciliation',
  publisher: 'reached only by a landing/push effect',
  recoveryMaxAttempts: 'reached only by a death-cert retry',
  recoveryTimeoutMs: 'reached only by a recovery attempt',
  repoId: 'the deployment identity; supplied implicitly by every case',
  repoRoot: 'the deployment checkout; supplied implicitly by every case',
  representationProduction: 'assembled only when representation production is configured',
  requireCoverage: 'an acceptance policy flag, read by the done gate',
  requireIndependentOracle: 'an acceptance policy flag, read by the done gate',
  requireMutation: 'an acceptance policy flag, read by the done gate',
  requireRedGreen: 'an acceptance policy flag, read by the done gate',
  reuseDecisionPolicy: 'reached only by a reuse decision',
  routeLearningPolicy: 'a policy; the route seam itself is exercised by CDW1',
  runLineagePolicy: 'a policy, reached only by a settlement lease',
  runtimeIsolation: 'construction options for the default scope authority',
  runtimeScopes: 'the scope authority, consulted on scope-governed dispatch',
  scratchOraclePolicy: 'reached only by a scratch oracle target',
  sessionRecoveryPolicy: 'started only with a session recovery policy',
  standingLaws: 'returned on the driver for the briefing composer',
  stopDeadlineMs: 'a stop deadline, reached only by a stop',
  structuredMerge: 'reached only by a structured integration',
  taskTopologyPolicy: 'a policy, reached only by plan-gated topology admission',
  toolchainProjection: 'a worktree preparation seam',
  verificationConcurrency: 'the verification lane width; no case supplies a non-default value',
  verificationForCapture: 'reached only by a contribution capture',
  verifyDependencyDirs: 'a worktree preparation seam',
  verifySparsePaths: 'a worktree preparation seam',
  watchdog: 'reached only by a stall or loop verdict',
  workerDependencyDirs: 'a worktree preparation seam',
  workerSparsePaths: 'a worktree preparation seam',
  workflowPolicy: 'a policy, reached only by a workflow drive',
  worktreeCapacity: 'a capacity policy; no case configures one',
  worktreeCapacityEstimate: 'a capacity observation dependency',
  worktreeCapacityObserve: 'a capacity observation dependency',
  worktreeCapacityRuntimeFootprint: 'a capacity observation dependency',
});

/** Every `opts.<name>` the createDriver body reads, in source order, deduplicated. */
function createDriverOptionNames() {
  const source = readFileSync(new URL('../src/index.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('export function createDriver(opts) {');
  assert.ok(start >= 0, 'the public composition root createDriver must exist');
  const end = source.indexOf('\n}', start);
  assert.ok(end > start, 'the createDriver body must close at column 0');
  const body = source.slice(start, end);
  return [...new Set([...body.matchAll(/opts\.([A-Za-z_][A-Za-z0-9_]*)/gu)].map((match) => match[1]))].sort();
}

/** The body of the case whose title starts with `id`, or null. */
function caseBody(id) {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const marker = `test('${id}:`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const next = source.indexOf("\ntest('", start + marker.length);
  return source.slice(start, next < 0 ? source.length : next);
}

test('CDW5: every option the composition root reads is classified, and every exercised claim names a case in this file', () => {
  const derived = createDriverOptionNames();
  const declared = [...Object.keys(EXERCISED_OPTIONS), ...Object.keys(UNEXERCISED_OPTIONS)].sort();
  const missing = derived.filter((name) => !declared.includes(name));
  const stale = declared.filter((name) => !derived.includes(name));
  assert.deepEqual(missing, [],
    'a new option on the composition root must be classified in EXERCISED_OPTIONS or UNEXERCISED_OPTIONS');
  assert.deepEqual(stale, [], 'a classified option must still be read by the composition root');
  assert.equal(new Set(declared).size, declared.length, 'an option is classified once');
  for (const [option, id] of Object.entries(EXERCISED_OPTIONS)) {
    const body = caseBody(id);
    assert.ok(body, `${option} claims case ${id}, which must exist in this file`);
    assert.ok(body.includes(option),
      `${option} claims case ${id}, whose body must name the option it exercises`);
  }
});
