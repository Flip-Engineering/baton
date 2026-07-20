import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  APPLICATION_COMMAND_DEFINITIONS, APPLICATION_SEMANTIC_REGISTRY, BatonApplication,
  CoordinationStore, McpFleetServer, MockAdapter, WebNorthbound, createDriver, operatorAsset,
} from '../src/index.mjs';

const REPO = 'repo-phase92-result-intent';
const ORIGIN = 'https://result-intent.example.test';
const ROUTE = Object.freeze({ harness: 'mock', model: 'result-model', effort: 'low' });
const RESULT_MARKER = 'Baton objective/result policy read_only_evidence_v1';
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const temporary = (label) => mkdtempSync(join(tmpdir(), `baton-result-intent-${label}-`));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

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
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
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
  t.after(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });
  return { application: applicationFor(driver, { standard: profile }, options.authorize), driver };
}

function intent(overrides = {}) {
  return {
    objective: 'Audit wording cannot choose the result policy', profile: 'standard',
    route: ROUTE, scope: ['impl/**'], ...overrides,
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
  assert.equal(goals.find((goal) => goal.runId === legacy.runId).constraints.includes(RESULT_MARKER), false);
  assert.equal(goals.find((goal) => goal.runId === evidence.runId).constraints.includes(RESULT_MARKER), true);
  const inspected = await reconstructed.command('run.inspect', {
    runId: evidence.runId, depth: 'outline',
  }, owner);
  assert.equal(inspected.outline.resultIntent, 'read_only_evidence');
  assert.equal(Object.hasOwn(inspected.outline, 'objectiveResultPolicy'), false);
  await reconstructed.shutdown(principal('shutdown'));
});

test('RI2: historical profile-registry marker records replay, while new Run compilation reserves them', async (t) => {
  const { driver } = applicationFixture(t);
  const markedProfile = Object.freeze({ ...profile, constraints: [RESULT_MARKER] });
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
  assert.deepEqual(replay._profileRegistry.get(coordinate).constraints, [RESULT_MARKER]);
  await replay.shutdown(principal('shutdown'));
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
