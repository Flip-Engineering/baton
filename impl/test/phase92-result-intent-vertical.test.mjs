import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import {
  APPLICATION_COMMAND_DEFINITIONS, APPLICATION_SEMANTIC_REGISTRY, BatonApplication,
  CoordinationStore, McpFleetServer, MockAdapter, WebNorthbound, createDriver, operatorAsset,
} from '../src/index.mjs';

const REPO = 'repo-phase92-result-intent';
const ORIGIN = 'https://result-intent.example.test';
const ROUTE = Object.freeze({ harness: 'mock', model: 'result-model', effort: 'low' });
const LEGACY_RESULT_MARKER = 'Baton objective/result policy read_only_evidence_v1';
const EXPLICIT_CHANGE_MARKER = 'Baton objective/result policy explicit change_v1';
const EXPLICIT_EVIDENCE_MARKER = 'Baton objective/result policy explicit read_only_evidence_v1';
const READ_ONLY_DEFINITION = Object.freeze([
  'A bounded evidence-backed textual/result capsule answers the declared read-only objective.',
  'Sources, derivations, contradictions, verification, and cleanup remain inspectable.',
]);
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const temporary = (label) => mkdtempSync(join(tmpdir(), `baton-result-intent-${label}-`));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const v1Golden = JSON.parse(gunzipSync(Buffer.from(readFileSync(new URL(
  './fixtures/phase92-v1-evidence-golden.json.gz.b64', import.meta.url,
), 'utf8').trim(), 'base64')));

const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId: REPO, mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
  riskClasses: ['high'], effectClasses: ['repository_edit'], capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1440, maxProviderTurns: 10_000,
  }),
});
const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: REPO,
  definitionOfDone: ['the explicit result is verified'], constraints: [], risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 32, providerTurns: 32 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'], verification, routes: [ROUTE], capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

function adapter() {
  const value = new MockAdapter({
    harness: 'mock', scenario: { outcome: 'completed', delayMs: 1, summary: 'done', files: {} },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: 'mock',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort],
      serviceTier: null, provenance: 'result-intent-test', refreshedAt: null,
    },
  });
  return value;
}

function applicationFor(driver, profiles = { standard: profile }, authorize = async () => true) {
  return new BatonApplication({
    driver, repoId: REPO, profiles,
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'),
      observer: principal('observer'),
    },
    authorize,
  });
}

function applicationFixture(t, options = {}) {
  const repo = temporary('repo');
  const logDir = temporary('log');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'result-intent@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Result Intent'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const driver = createDriver({
    repoRoot: repo, repoId: REPO, logDir, adapters: { mock: adapter() },
    goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 500,
  });
  const application = applicationFor(driver, { standard: profile }, options.authorize);
  t.after(async () => {
    try { await application.shutdown(principal('shutdown')); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application, driver };
}

function intent(overrides = {}) {
  return {
    objective: 'Audit wording cannot choose the result policy', profile: 'standard',
    route: ROUTE, scope: ['impl/**'], ...overrides,
  };
}

const goalPlanAuth = (principalId, power, runId, idempotencyKey) => ({
  actor: `direct:${principalId}`, principalId, sessionId: `${principalId}-session`,
  powers: [power], repoId: REPO, runId, idempotencyKey,
});

async function settle(application, proposed) {
  await application.approve(proposed.runId, proposed.plan.digest, principal('approver'));
  return application.wait(proposed.runId, principal('owner'), { timeoutMs: 10_000 });
}

function goldenHarness(fixture, workflow = false) {
  return {
    repoId: fixture.manifest.repoId,
    driver: { coordination: {
      ...(workflow ? { events: () => [] } : { runResultAdoption: () => null }),
      task: (id) => fixture.tasks[id] ?? null,
      artifact: (id) => fixture.artifacts[id] ?? null,
      runStop: () => null,
    } },
    ...(!workflow ? {
      _buildView: async () => fixture.view,
      _isWorkflowRun: () => false,
      principals: { observer: {} },
    } : {}),
  };
}

test('RI1: generated IDs preserve the missing-field preimage and diverge for both explicit intents', async (t) => {
  const authorizations = [];
  const { application, driver } = applicationFixture(t, {
    authorize: async (request) => { authorizations.push(structuredClone(request)); return true; },
  });
  const owner = principal('owner');
  const legacy = await application.start(intent(), owner);
  const explicitChange = await application.start(intent({ resultIntent: 'change' }), owner);
  const evidence = await application.start(intent({ resultIntent: 'read_only_evidence' }), owner);
  const profileDigest = application.profiles.get('standard').digest;
  assert.equal(legacy.runId, `run-${digest({
    objective: intent().objective, profileDigest, route: ROUTE, composition: null,
    scope: ['impl/**'], ownerPrincipalId: owner.principalId,
  }).slice(0, 32)}`);
  assert.equal(new Set([legacy.runId, explicitChange.runId, evidence.runId]).size, 3);
  assert.equal(legacy.resultIntent, 'change');
  assert.equal(explicitChange.resultIntent, 'change');
  assert.equal(evidence.resultIntent, 'read_only_evidence');
  assert.equal(Object.hasOwn(legacy.planPreview, 'resultIntent'), false);
  assert.equal(explicitChange.planPreview.resultIntent, 'change');
  assert.deepEqual(Object.keys(legacy.planPreview), [
    'objective', 'definitionOfDone', 'constraints', 'risk', 'goalBudget', 'node',
    'profileDigest', 'planDigest', 'objectiveResultPolicy', 'displayDigest',
  ]);
  assert.deepEqual(Object.keys(explicitChange.planPreview), [
    'objective', 'definitionOfDone', 'constraints', 'risk', 'goalBudget', 'node',
    'profileDigest', 'planDigest', 'resultIntent', 'objectiveResultPolicy', 'displayDigest',
  ]);
  const { displayDigest: legacyPreviewDigest, ...legacyPreviewCore } = legacy.planPreview;
  const { displayDigest: explicitPreviewDigest, ...explicitPreviewCore } = explicitChange.planPreview;
  assert.equal(legacyPreviewDigest, digest(legacyPreviewCore));
  assert.equal(explicitPreviewDigest, digest(explicitPreviewCore));
  assert.equal(evidence.planPreview.node.effects.includes('repository_edit'), false);
  assert.equal(evidence.goal.id === explicitChange.goal.id, false);

  authorizations.length = 0;
  await application.authorizeReplay('run.start', { intent: intent() }, owner);
  await application.authorizeReplay('run.start', {
    intent: intent({ resultIntent: 'change' }),
  }, owner);
  await application.authorizeReplay('run.start', {
    intent: intent({ resultIntent: 'read_only_evidence' }),
  }, owner);
  assert.deepEqual(authorizations.map(({ runId }) => runId), [
    legacy.runId, explicitChange.runId, evidence.runId,
  ]);
  assert.equal(Object.hasOwn(authorizations[0].subject, 'resultIntent'), false);
  assert.equal(authorizations[1].subject.resultIntent, 'change');
  assert.equal(authorizations[2].subject.resultIntent, 'read_only_evidence');

  const reconstructed = applicationFor(driver);
  await reconstructed.ready;
  const legacyReplay = await reconstructed.command('run.status', { runId: legacy.runId }, owner);
  const evidenceReplay = await reconstructed.command('run.status', { runId: evidence.runId }, owner);
  assert.equal(legacyReplay.resultIntent, 'change');
  assert.equal(legacyReplay.objectiveResultPolicy.mode, 'change');
  assert.equal(evidenceReplay.resultIntent, 'read_only_evidence');
  assert.equal(evidenceReplay.objectiveResultPolicy.mode, 'read_only_evidence');
  const goals = driver.coordination.snapshot().goalPlan.goals;
  assert.equal(goals.find((goal) => goal.runId === legacy.runId).constraints
    .some((constraint) => constraint.startsWith('Baton objective/result policy ')), false);
  assert.equal(goals.find((goal) => goal.runId === explicitChange.runId).constraints
    .includes(EXPLICIT_CHANGE_MARKER), true);
  assert.equal(goals.find((goal) => goal.runId === evidence.runId).constraints
    .includes(EXPLICIT_EVIDENCE_MARKER), true);
  const inspected = await reconstructed.command('run.inspect', {
    runId: evidence.runId, depth: 'outline',
  }, owner);
  assert.equal(inspected.outline.resultIntent, 'read_only_evidence');
  assert.equal(Object.hasOwn(inspected.outline, 'objectiveResultPolicy'), false);
  await reconstructed.shutdown(principal('shutdown'));
});

test('RI2: historical profile-registry marker records replay, while new Run compilation reserves them', async (t) => {
  const { driver } = applicationFixture(t);
  const markedProfile = Object.freeze({ ...profile, constraints: [LEGACY_RESULT_MARKER] });
  const recorder = applicationFor(driver, { historical_marker: markedProfile });
  await recorder.ready;
  const record = driver.coordination.events().find((event) => (
    event.payload?.kind === 'application.profile_registered'
      && event.payload?.name === 'historical_marker'
  ));
  assert.ok(record);
  await assert.rejects(recorder.start({
    ...intent({ runId: 'run-reserved-profile' }), profile: 'historical_marker',
  }, principal('owner')), (error) => error.code === 'application_profile_invalid');
  assert.equal(driver.coordination.snapshot().goalPlan.goals
    .some((goal) => goal.runId === 'run-reserved-profile'), false);

  const replay = applicationFor(driver);
  await replay.ready;
  const coordinate = `historical_marker\0${record.payload.profileDigest}`;
  assert.deepEqual(replay._profileRegistry.get(coordinate).constraints, [LEGACY_RESULT_MARKER]);
  await replay.shutdown(principal('shutdown'));
});

test('RI6: omitted single and Workflow manifests retain the exact pre-explicit v1 bytes', async (t) => {
  assert.equal(v1Golden.sourceCommit, '235a599d3e0053806919f40e48d169f883e35608');
  const goldenSingle = await BatonApplication.prototype._buildEvidence.call(
    goldenHarness(v1Golden.single), v1Golden.single.current,
  );
  const goldenWorkflow = BatonApplication.prototype._buildWorkflowEvidence.call(
    goldenHarness(v1Golden.workflow, true), v1Golden.workflow.current, v1Golden.workflow.view,
  );
  assert.equal(JSON.stringify(goldenSingle), JSON.stringify(v1Golden.single.manifest));
  assert.equal(JSON.stringify(goldenWorkflow), JSON.stringify(v1Golden.workflow.manifest));
  assert.equal(goldenSingle.manifestDigest, v1Golden.single.manifest.manifestDigest);
  assert.equal(goldenWorkflow.manifestDigest, v1Golden.workflow.manifest.manifestDigest);

  const { application } = applicationFixture(t);
  const single = await application.start(intent({ runId: 'run-legacy-single' }), principal('owner'));
  await settle(application, single);
  const singleEvidence = await application.evidence(single.runId, principal('owner'));
  assert.equal(singleEvidence.schemaVersion, 1);
  assert.equal(Object.hasOwn(singleEvidence, 'resultIntent'), false);
  assert.deepEqual(Object.keys(singleEvidence), [
    'schemaVersion', 'kind', 'state', 'repoId', 'runId', 'observedThroughSeq',
    'bindings', 'phase', 'progress', 'node', 'result', 'integration', 'verification',
    'semanticReview', 'artifacts', 'stop', 'ownership', 'checks', 'manifestDigest',
  ]);

  const workflow = await application.start(intent({
    runId: 'run-legacy-workflow',
    composition: {
      strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
      team: [{ role: 'builder', route: ROUTE }, { role: 'challenger', route: ROUTE }],
    },
  }), principal('owner'));
  assert.equal(Object.hasOwn(workflow.planPreview, 'resultIntent'), false);
  assert.deepEqual(Object.keys(workflow.planPreview), [
    'objective', 'strategy', 'workspace', 'join', 'attempts', 'round', 'revision',
    'profileDigest', 'planDigest', 'displayDigest',
  ]);
  const { displayDigest: workflowPreviewDigest, ...workflowPreviewCore } = workflow.planPreview;
  assert.equal(workflowPreviewDigest, digest(workflowPreviewCore));
  await settle(application, workflow);
  const workflowEvidence = await application.evidence(workflow.runId, principal('owner'));
  assert.equal(workflowEvidence.schemaVersion, 1);
  assert.equal(Object.hasOwn(workflowEvidence, 'resultIntent'), false);
  assert.deepEqual(Object.keys(workflowEvidence), [
    'schemaVersion', 'kind', 'state', 'repoId', 'runId', 'observedThroughSeq',
    'bindings', 'phase', 'progress', 'attempts', 'candidates', 'feedback', 'memberStops',
    'selection', 'rounds', 'result', 'verification', 'stop', 'ownership', 'checks',
    'manifestDigest',
  ]);

  const explicitWorkflow = await application.start(intent({
    runId: 'run-explicit-workflow-preview', resultIntent: 'change',
    composition: {
      strategy: 'parallel_attempts', workspace: 'isolated', join: 'operator_selected',
      team: [{ role: 'builder', route: ROUTE }, { role: 'challenger', route: ROUTE }],
    },
  }), principal('owner'));
  assert.equal(explicitWorkflow.planPreview.resultIntent, 'change');
  assert.deepEqual(Object.keys(explicitWorkflow.planPreview), [
    'objective', 'strategy', 'workspace', 'join', 'attempts', 'round', 'revision',
    'profileDigest', 'planDigest', 'resultIntent', 'displayDigest',
  ]);
  const { displayDigest: explicitWorkflowDigest, ...explicitWorkflowCore } = explicitWorkflow.planPreview;
  assert.equal(explicitWorkflowDigest, digest(explicitWorkflowCore));
});

test('RI7: an omitted historical read-only request reuses its exact durable Goal and Plan', async (t) => {
  const { application, driver } = applicationFixture(t);
  await application.ready;
  const runId = 'run-historical-read-only';
  const objective = 'Read-only audit and research report; do not modify the repository.';
  const profileDigest = application.profiles.get('standard').digest;
  const goal = (await driver.coordinator.defineGoal({
    objective, definitionOfDone: [...READ_ONLY_DEFINITION],
    constraints: [`Baton deployment profile standard@${profileDigest}`, LEGACY_RESULT_MARKER],
    risk: profile.risk, budget: profile.goalBudget, predecessor: null,
  }, goalPlanAuth('owner', 'goal:define', runId, `application:${runId}:goal:v1`))).goal;
  const plan = (await driver.coordinator.proposePlan({
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest }, predecessor: null,
    nodes: [{
      key: 'work', objective, definitionOfDone: [...READ_ONLY_DEFINITION], deps: [],
      pathScope: ['impl/**'], risk: profile.risk, budget: profile.nodeBudget,
      verification, routes: { schemaVersion: 2, allowed: [ROUTE] },
      capabilities: [...profile.capabilities], effects: [],
    }],
  }, goalPlanAuth('planner', 'plan:propose', runId, `application:${runId}:plan:v1`))).plan;
  const counts = driver.coordination.snapshot().goalPlan;
  const replayed = await application.start(intent({ runId, objective }), principal('owner'));
  assert.equal(replayed.goal.digest, goal.digest);
  assert.equal(replayed.plan.digest, plan.digest);
  assert.equal(replayed.resultIntent, 'read_only_evidence');
  assert.equal(replayed.planPreview.node.effects.includes('repository_edit'), false);
  const after = driver.coordination.snapshot().goalPlan;
  assert.equal(after.goals.length, counts.goals.length);
  assert.equal(after.plans.length, counts.plans.length);

  const fresh = await application.start(intent({
    runId: 'run-new-prose-is-not-policy', objective,
  }), principal('owner'));
  assert.equal(fresh.resultIntent, 'change');
  assert.equal(fresh.planPreview.node.effects.includes('repository_edit'), true);
});

test('RI7b: the frozen parent digest crosses pending adopt, integrate, and export validators', async () => {
  const manifest = structuredClone(v1Golden.single.manifest);
  const current = {
    goal: { ...v1Golden.single.current.goal },
    plan: { nodes: [{ key: manifest.result.nodeKey }] },
    profile: {
      digest: manifest.bindings.profileDigest,
      resultPolicy: { mode: 'manual', maxAdoptedResults: 1 },
      integrationPolicy: {
        mode: 'manual', strategies: ['ff-only'],
        requireAdoptedResult: true, requireSemanticReview: true,
      },
      exportPolicy: {
        mode: 'manual', format: 'directory-v1', maxFiles: 8, maxBytes: 4096,
        requireAdoptedResult: true, requireSemanticReview: true, requireIntegration: false,
      },
    },
  };
  const before = {
    result: { state: 'adopted', sha: manifest.result.sha },
    semanticReview: structuredClone(manifest.semanticReview), integration: null,
  };
  const admitted = [];
  const base = {
    ready: Promise.resolve(), repoId: manifest.repoId,
    principals: { observer: principal('observer') },
    _assertOpen() {}, _assertRunMutable() {},
    async _authorize() {},
    _findRun: () => current,
    _isWorkflowRun: () => false,
    _buildEvidence: async () => manifest,
    _buildView: async () => before,
    driver: {
      coordination: {
        task: () => ({ assignee: 'worker-v1' }),
        runResultAdoption: () => null,
        admitRunResultAdoption(request) {
          admitted.push({ seam: 'adopt', evidenceDigest: request.evidenceDigest });
          return { adoption: request };
        },
      },
      coordinator: {
        async integrate() { return { ok: true, result: 'integrated' }; },
      },
    },
    async _performResultAdoption() { return { receiptDigest: 'a'.repeat(64) }; },
  };
  const adopted = await BatonApplication.prototype.adopt.call(base, {
    runId: manifest.runId, nodeKey: manifest.result.nodeKey, resultSha: manifest.result.sha,
    evidenceDigest: manifest.manifestDigest, reason: 'Accept the frozen parent coordinate.',
  }, principal('adopter'));
  assert.equal(adopted.result.state, 'adopted');

  const integrated = await BatonApplication.prototype._integrate.call(base, {
    runId: manifest.runId, evidenceDigest: manifest.manifestDigest, strategy: 'ff-only',
    reason: 'Integrate the frozen parent coordinate.',
  }, principal('integrator'));
  assert.equal(integrated.result.state, 'adopted');

  const exportHarness = {
    ...base,
    exportRoot: 'fixture-export-root', exportRootDigest: 'b'.repeat(64),
    resultExportLifecycle: {
      deriveArchive: () => ({ descriptor: { schemaVersion: 1, state: 'delivered' } }),
    },
    driver: {
      ...base.driver,
      coordination: {
        ...base.driver.coordination,
        admitRunResultExport(request) {
          admitted.push({ seam: 'export', evidenceDigest: request.evidenceDigest });
          return { result: 'admitted', export: request };
        },
      },
    },
    async _performResultExport(request) {
      return { schemaVersion: 1, state: 'completed', exportId: request.exportId };
    },
  };
  const exported = await BatonApplication.prototype._export.call(exportHarness, {
    runId: manifest.runId, evidenceDigest: manifest.manifestDigest,
  }, principal('exporter'));
  assert.equal(exported.export.state, 'completed');
  assert.deepEqual(admitted, [
    { seam: 'adopt', evidenceDigest: manifest.manifestDigest },
    { seam: 'export', evidenceDigest: manifest.manifestDigest },
  ]);
});

test('RI8: explicit markers produce distinct stable schema-v2 evidence', async (t) => {
  const { application, driver } = applicationFixture(t);
  const change = await application.start(intent({
    runId: 'run-explicit-change-v2', resultIntent: 'change',
  }), principal('owner'));
  const evidenceOnly = await application.start(intent({
    runId: 'run-explicit-evidence-v2', resultIntent: 'read_only_evidence',
  }), principal('owner'));
  await settle(application, change);
  await settle(application, evidenceOnly);
  const changeManifest = await application.evidence(change.runId, principal('owner'));
  const evidenceManifest = await application.evidence(evidenceOnly.runId, principal('owner'));
  for (const [manifest, resultIntent] of [
    [changeManifest, 'change'], [evidenceManifest, 'read_only_evidence'],
  ]) {
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.resultIntent, resultIntent);
    const { manifestDigest, ...core } = manifest;
    assert.equal(manifestDigest, digest(core));
  }
  assert.notEqual(changeManifest.manifestDigest, evidenceManifest.manifestDigest);
  const goals = driver.coordination.snapshot().goalPlan.goals;
  assert.equal(goals.find(({ runId }) => runId === change.runId).constraints
    .includes(EXPLICIT_CHANGE_MARKER), true);
  assert.equal(goals.find(({ runId }) => runId === evidenceOnly.runId).constraints
    .includes(EXPLICIT_EVIDENCE_MARKER), true);

  const replay = applicationFor(driver);
  await replay.ready;
  assert.deepEqual(await replay.evidence(change.runId, principal('owner')), changeManifest);
  assert.deepEqual(await replay.evidence(evidenceOnly.runId, principal('owner')), evidenceManifest);
  await replay.shutdown(principal('shutdown'));
});

test('RI9: unknown, duplicate, redundant, and conflicting result-policy markers fail closed', async (t) => {
  const { application, driver } = applicationFixture(t);
  await application.ready;
  const profileDigest = application.profiles.get('standard').digest;
  const define = (runId, constraints) => driver.coordinator.defineGoal({
    objective: 'Reject malformed durable result policy',
    definitionOfDone: [...profile.definitionOfDone],
    constraints: [`Baton deployment profile standard@${profileDigest}`, ...constraints],
    risk: profile.risk, budget: profile.goalBudget, predecessor: null,
  }, goalPlanAuth('owner', 'goal:define', runId, `${runId}:goal`));

  await assert.rejects(define('run-marker-duplicate', [
    EXPLICIT_CHANGE_MARKER, EXPLICIT_CHANGE_MARKER,
  ]), (error) => error.code === 'goal_plan_invalid');
  for (const [runId, markers] of [
    ['run-marker-unknown', ['Baton objective/result policy explicit future_v9']],
    ['run-marker-redundant', [LEGACY_RESULT_MARKER, EXPLICIT_EVIDENCE_MARKER]],
    ['run-marker-conflict', [EXPLICIT_CHANGE_MARKER, EXPLICIT_EVIDENCE_MARKER]],
  ]) {
    await define(runId, markers);
    await assert.rejects(application.status(runId, principal('owner')),
      (error) => error.code === 'application_goal_invalid');
  }

  const contradictoryRunId = 'run-marker-read-only-mutation';
  const contradictoryGoal = (await driver.coordinator.defineGoal({
    objective: 'Attempt to pair read-only authority with repository mutation',
    definitionOfDone: [...READ_ONLY_DEFINITION],
    constraints: [
      `Baton deployment profile standard@${profileDigest}`, EXPLICIT_EVIDENCE_MARKER,
    ],
    risk: profile.risk, budget: profile.goalBudget, predecessor: null,
  }, goalPlanAuth('owner', 'goal:define', contradictoryRunId, `${contradictoryRunId}:goal`))).goal;
  const contradictoryPlan = (await driver.coordinator.proposePlan({
    goal: {
      goalId: contradictoryGoal.goalId, version: contradictoryGoal.version,
      digest: contradictoryGoal.digest,
    },
    predecessor: null,
    nodes: [{
      key: 'work', objective: contradictoryGoal.objective,
      definitionOfDone: [...READ_ONLY_DEFINITION], deps: [], pathScope: ['impl/**'],
      risk: profile.risk, budget: profile.nodeBudget, verification,
      routes: { schemaVersion: 2, allowed: [ROUTE] }, capabilities: [...profile.capabilities],
      effects: ['repository_edit'], requiredEffects: ['repository_edit'],
    }],
  }, goalPlanAuth('planner', 'plan:propose', contradictoryRunId,
    `${contradictoryRunId}:plan`))).plan;
  await assert.rejects(application.status(contradictoryRunId, principal('owner')),
    (error) => error.code === 'application_goal_invalid');

  await driver.coordinator.proposePlan({
    goal: {
      goalId: contradictoryGoal.goalId, version: contradictoryGoal.version,
      digest: contradictoryGoal.digest,
    },
    predecessor: {
      planId: contradictoryPlan.planId, version: contradictoryPlan.version,
      digest: contradictoryPlan.digest,
    },
    nodes: [{
      key: 'work', objective: contradictoryGoal.objective,
      definitionOfDone: [...READ_ONLY_DEFINITION], deps: [], pathScope: ['impl/**'],
      risk: profile.risk, budget: profile.nodeBudget, verification,
      routes: { schemaVersion: 2, allowed: [ROUTE] }, capabilities: [...profile.capabilities],
      effects: [], requiredEffects: [],
    }],
  }, goalPlanAuth('planner', 'plan:propose', contradictoryRunId,
    `${contradictoryRunId}:plan-clean-successor`));
  await assert.rejects(application.status(contradictoryRunId, principal('owner')),
    (error) => error.code === 'application_goal_invalid');

  const fallbackStore = {
    goalPlanRun: driver.coordination.goalPlanRun.bind(driver.coordination),
    snapshot: driver.coordination.snapshot.bind(driver.coordination),
  };
  const fallbackApplication = Object.create(application);
  fallbackApplication.driver = { ...driver, coordination: fallbackStore };
  assert.throws(() => fallbackApplication._findRun(contradictoryRunId),
    (error) => error.code === 'application_goal_invalid');
  fallbackApplication.driver = {
    ...driver,
    coordination: { goalPlanRun: fallbackStore.goalPlanRun },
  };
  assert.throws(() => fallbackApplication._findRun(contradictoryRunId),
    (error) => error.code === 'application_run_history_unavailable');
  fallbackApplication.driver = {
    ...driver,
    coordination: {
      goalPlanRun: fallbackStore.goalPlanRun,
      goalPlanRunPlans(repoId, runId, limit) {
        assert.equal(repoId, REPO);
        assert.equal(runId, contradictoryRunId);
        assert.equal(limit, 100_000);
        return Array(limit + 1).fill(contradictoryPlan);
      },
    },
  };
  assert.throws(() => fallbackApplication._findRun(contradictoryRunId),
    (error) => error.code === 'application_run_lookup_oversize');
});

function applicationRecorder() {
  const calls = [];
  const replays = [];
  return {
    calls, replays,
    application: {
      repoId: REPO,
      card: () => ({ repoId: REPO, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
      async command(name, args, suppliedPrincipal, context) {
        calls.push({ name, args: structuredClone(args), principal: suppliedPrincipal, context });
        return { schemaVersion: 1, runId: args.intent?.runId ?? args.runId, phase: 'awaiting_plan_approval' };
      },
      async authorizeReplay(name, args, suppliedPrincipal, context) {
        replays.push({ name, args: structuredClone(args), principal: suppliedPrincipal, context });
        return true;
      },
    },
  };
}

const webPrincipal = Object.freeze({
  userId: 'web-user', sessionId: 'web-session', credentialId: 'web-credential',
  authMethod: 'cookie', csrfToken: 'web-csrf', expiresAt: '2099-01-01T00:00:00.000Z',
  revoked: false, capabilities: ['control', 'observe'], repoIds: [REPO],
});
const webContext = Object.freeze({
  principal: webPrincipal, origin: ORIGIN, csrfToken: 'web-csrf', transport: 'https',
});
const webEnvelope = (id, rawIntent) => ({
  schemaVersion: 1, commandId: id, idempotencyKey: id, command: 'run_start',
  args: { intent: rawIntent }, repoId: REPO, runId: rawIntent.runId, origin: ORIGIN,
});

test('RI3: Web keeps resultIntent optional for legacy replay and forwards each explicit enum exactly', async (t) => {
  const directory = temporary('web');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coordination = new CoordinationStore(directory);
  const recorded = applicationRecorder();
  const web = new WebNorthbound({
    coordinator: {}, coordination, application: recorded.application,
    repoIds: [REPO], allowedOrigins: [ORIGIN],
  });
  const legacyIntent = { runId: 'run-web-legacy', objective: 'Legacy Web start', route: ROUTE };
  const envelope = webEnvelope('web-legacy-result-intent', legacyIntent);
  assert.equal((await web.execute(webContext, envelope)).status, 200);
  assert.equal((await web.execute(webContext, structuredClone(envelope))).status, 200);
  assert.equal(Object.hasOwn(recorded.calls[0].args.intent, 'resultIntent'), false);
  assert.equal(Object.hasOwn(recorded.replays[0].args.intent, 'resultIntent'), false);

  const explicit = webEnvelope('web-evidence-result-intent', {
    ...legacyIntent, runId: 'run-web-evidence', resultIntent: 'read_only_evidence',
  });
  assert.equal((await web.execute(webContext, explicit)).status, 200);
  assert.equal(recorded.calls.at(-1).args.intent.resultIntent, 'read_only_evidence');
  const invalid = webEnvelope('web-invalid-result-intent', {
    ...legacyIntent, runId: 'run-web-invalid', resultIntent: 'report',
  });
  assert.equal((await web.execute(webContext, invalid)).status, 400);
  assert.equal(recorded.calls.length, 2);
  coordination.releaseWriterLease();
});

async function initializeMcp(server) {
  await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'result-intent-test', version: '1.0.0' },
    },
  });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

test('RI4: MCP advertises optional enum/default, preserves omitted replay, and forwards explicit intent', async (t) => {
  const directory = temporary('mcp');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const coordination = new CoordinationStore(directory);
  const recorded = applicationRecorder();
  const server = new McpFleetServer({
    coordinator: {}, coordination, application: recorded.application, applicationOwned: false,
    principal: {
      userId: 'mcp-user', sessionId: 'mcp-session', expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: false, capabilities: ['control', 'observe'], repoIds: [REPO],
    },
    repoIds: [REPO], surface: 'application', maxWaitMs: 30_000,
    bindApplicationContext: true,
    maxMessageBytes: 256 * 1024, takeToolQuota: async () => ({ ok: true }),
  });
  await initializeMcp(server);
  const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const resultIntentSchema = listed.result.tools.find(({ name }) => name === 'baton_run_start')
    .inputSchema.properties.intent.properties.resultIntent;
  assert.deepEqual(resultIntentSchema, {
    type: 'string', enum: ['change', 'read_only_evidence'], default: 'change',
  });
  assert.equal(listed.result.tools.find(({ name }) => name === 'baton_run_start')
    .inputSchema.properties.intent.required.includes('resultIntent'), false);
  const legacyCall = {
    jsonrpc: '2.0', id: 3, method: 'tools/call', params: {
      name: 'baton_run_start', arguments: {
        intent: { runId: 'run-mcp-legacy', objective: 'Legacy MCP start', route: ROUTE },
      },
    },
  };
  assert.equal((await server.handle(legacyCall)).result.isError, false);
  assert.equal((await server.handle(structuredClone(legacyCall))).result.isError, false);
  assert.equal(Object.hasOwn(recorded.calls[0].args.intent, 'resultIntent'), false);
  assert.equal(Object.hasOwn(recorded.replays[0].args.intent, 'resultIntent'), false);
  const explicitCall = structuredClone(legacyCall);
  explicitCall.id = 4;
  explicitCall.params.arguments.intent = {
    ...explicitCall.params.arguments.intent, runId: 'run-mcp-change', resultIntent: 'change',
  };
  assert.equal((await server.handle(explicitCall)).result.isError, false);
  assert.equal(recorded.calls.at(-1).args.intent.resultIntent, 'change');
  await server.close();
  coordination.releaseWriterLease();
});

test('RI5: browser defaults to Change, can switch to Evidence only, and displays policy pre-approval', () => {
  const html = operatorAsset('/control').body;
  const script = operatorAsset('/control/app.js').body;
  assert.match(html, /id="result-intent"[^>]*required><option value="change">Change<\/option><option value="read_only_evidence">Evidence only<\/option>/u);
  assert.match(script, /resultIntent=byId\('result-intent'\)\.value/u);
  assert.match(script, /const intent=\{objective:byId\('objective'\)\.value,resultIntent,profile:profile\.name,route\}/u);
  assert.match(script, /addDatum\(fields,'Result intent'/u);
  assert.match(script, /addDatum\(fields,'Repository mutation'/u);
  const webSchema = APPLICATION_SEMANTIC_REGISTRY.operations['run.start']
    .inputSchema.properties.intent.properties.resultIntent;
  assert.deepEqual(webSchema, {
    type: 'string', enum: ['change', 'read_only_evidence'], default: 'change',
  });
  assert.equal(APPLICATION_SEMANTIC_REGISTRY.operations['run.start']
    .inputSchema.properties.intent.required.includes('resultIntent'), false);
});
