import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as applicationSource from '../src/application.mjs';
import {
  BatonApplication,
  McpFleetServer,
  MockAdapter,
  createDriver,
  operatorAsset,
  parseBatonCli,
} from '../src/index.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase67-${name}-`));
const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase67',
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

const profile = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-phase67',
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
  exportPolicy: {
    mode: 'manual', format: 'directory-v1', maxFiles: 128, maxBytes: 4 * 1024 * 1024,
    requireAdoptedResult: true, requireSemanticReview: false, requireIntegration: false,
  },
  followPolicy: {
    mode: 'enabled', maxWaitMs: 2_000, maxChanges: 16,
    maxResponseBytes: 64 * 1024, maxScanEvents: 128,
  },
});

const intent = (runId) => ({
  runId,
  objective: 'Improve Baton through its progressive ordinary agent surface',
  profile: 'progressive',
  route: { harness: 'mock', model: 'model-a', effort: 'low' },
  scope: ['impl/**'],
});

function configuredAdapter(delayMs = 5_000, files = {}, scenario = {}) {
  const adapter = new MockAdapter({
    harness: 'mock',
    scenario: { outcome: 'completed', delayMs, summary: 'progressive AX fixture completed', files, ...scenario },
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

function fixture(name, { delayMs = 5_000, files = {}, scenario = {} } = {}) {
  const repo = root(`${name}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase67@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 67'], { cwd: repo });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });

  const authorization = { active: true };
  const adapter = configuredAdapter(delayMs, files, scenario);
  const driver = createDriver({
    repoRoot: repo,
    repoId: 'repo-phase67',
    logDir: root(`${name}-log`),
    adapters: { mock: adapter },
    goalPlanAuthority: { policy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver,
    repoId: 'repo-phase67',
    profiles: { progressive: profile },
    principals: {
      planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer'),
    },
    exportRoot: root(`${name}-exports`),
    authorize: async ({ command, principal: caller }) => command === 'application.shutdown'
      || (authorization.active && caller.principalId !== 'revoked'),
  });
  return { application, authorization, adapter, driver, repo };
}

function cleanup(t, application) {
  t.after(async () => {
    try { await application.shutdown(principal('phase67-cleanup')); }
    catch {
      try { await application.detach(); } catch {}
    }
  });
}

function expectCode(code) {
  return (error) => error?.code === code;
}

function registry() {
  const value = applicationSource.APPLICATION_SEMANTIC_REGISTRY;
  assert.ok(value, 'Phase 67 requires APPLICATION_SEMANTIC_REGISTRY');
  return value;
}

test('AX1: one closed semantic registry defines the compact ordinary vocabulary, depths, sections, actions, and advanced boundary', () => {
  const value = registry();
  assert.equal(value.schemaVersion, 1);
  assert.match(value.digest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(Object.keys(value.operations).sort(), [
    'application.help', 'run.act', 'run.episode', 'run.inspect', 'run.start', 'run.stop',
    'run.workstream.notify', 'run.workstream.stop', 'run.workstreams', 'runs.list',
  ]);
  assert.deepEqual(value.depths, [
    'outline', 'index', 'section', 'item', 'content', 'evidence',
  ]);
  for (const section of ['plan', 'execution', 'attention', 'route', 'budget', 'verification',
    'semantic_review', 'result', 'delivery', 'cleanup', 'knowledge', 'capabilities',
    'episode', 'workstreams']) {
    assert.ok(value.sections.some((candidate) => candidate.id === section), `missing ${section} section`);
  }
  for (const operation of Object.values(value.operations)) {
    assert.equal(operation.inputSchema.type, 'object');
    assert.equal(operation.inputSchema.additionalProperties, false);
    assert.equal(typeof operation.helpTopic, 'string');
    assert.equal(typeof operation.idempotent, 'boolean');
    assert.equal(typeof operation.destructive, 'boolean');
  }
  assert.equal(value.operations['run.stop'].emergency, true);
  assert.equal(value.advanced.defaultVisible, false);
  assert.equal(value.advanced.operations.includes('fleet_spawn'), true);
  assert.equal(JSON.stringify(value).toLowerCase().includes('homelab'), false);
});

test('AX1b RED: orchestration is one discoverable semantic section and remains empty when recursive Run authority is unconfigured', async (t) => {
  const f = fixture('legacy-orchestration');
  cleanup(t, f.application);
  const runId = 'run-phase67-legacy-orchestration';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));

  const definition = registry().sections.find((section) => section.id === 'orchestration');
  assert.ok(definition, 'agents discover recursive topology and authority through the ordinary cascade');
  assert.match(definition.summary, /authority|topology|child|descendant/iu);

  const outline = await f.application.command(
    'run.inspect', { runId, depth: 'outline' }, principal('owner'),
  );
  assert.equal(Object.hasOwn(outline.outline, 'orchestration'), false,
    'a legacy deployment does not invent recursive authority state in its compact outline');

  const index = await f.application.command(
    'run.inspect', { runId, depth: 'index' }, principal('owner'),
  );
  const orchestration = index.sections.find((section) => section.id === 'orchestration');
  assert.deepEqual({ state: orchestration?.state, itemCount: orchestration?.itemCount }, {
    state: 'empty', itemCount: 0,
  });

  const section = await f.application.command(
    'run.inspect', { runId, depth: 'section', section: 'orchestration' }, principal('owner'),
  );
  assert.equal(section.section.state, 'empty');
  assert.equal(section.section.itemCount, 0);
  assert.deepEqual(section.section.items, []);
});

test('AX2: inspect cascades from compact outline to index, section, item, and explicit evidence without raw default leakage', async (t) => {
  const f = fixture('cascade');
  cleanup(t, f.application);
  const runId = 'run-phase67-cascade';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));

  const outline = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
  assert.equal(outline.depth, 'outline');
  assert.equal(outline.runId, runId);
  assert.match(outline.registryDigest, /^[a-f0-9]{64}$/u);
  assert.match(outline.viewDigest, /^[a-f0-9]{64}$/u);
  assert.equal(Number.isSafeInteger(outline.cursor), true);
  assert.equal(outline.outline.phase, 'awaiting_plan_approval');
  assert.equal(typeof outline.outline.narrative, 'string');
  assert.equal(Array.isArray(outline.outline.actions), true);
  assert.equal(Object.hasOwn(outline, 'bounds'), false,
    'ordinary inspection must not make agents manage deployment response ceilings');
  assert.equal(Object.hasOwn(outline.outline, 'budget'), false,
    'numeric execution authority belongs at explicit budget depth, not the outline');
  assert.equal(Object.hasOwn(outline.continuation.arguments, 'waitMs'), false,
    'ordinary continuation must derive its wait policy inside Baton');
  for (const leaked of ['planPreview', 'nodes', 'evidence', 'ownership', 'workerIds', 'receipts', 'events']) {
    assert.equal(Object.hasOwn(outline.outline, leaked), false, `outline leaked ${leaked}`);
  }
  assert.equal(JSON.stringify(outline).includes(f.repo), false);

  const index = await f.application.command('run.inspect', { runId, depth: 'index' }, principal('owner'));
  assert.equal(index.depth, 'index');
  assert.equal(index.sections.every((section) => typeof section.id === 'string'
    && typeof section.summary === 'string' && typeof section.state === 'string'
    && Number.isSafeInteger(section.itemCount) && typeof section.truncated === 'boolean'
    && section.expand?.depth === 'section'), true);
  const planIndex = index.sections.find((section) => section.id === 'plan');
  assert.ok(planIndex);

  const section = await f.application.command('run.inspect', {
    runId, depth: 'section', section: planIndex.id,
  }, principal('owner'));
  assert.equal(section.depth, 'section');
  assert.equal(section.section.id, 'plan');
  assert.equal(Array.isArray(section.section.items), true);
  assert.ok(section.section.items.length > 0);
  const itemId = section.section.items[0].id;

  const item = await f.application.command('run.inspect', {
    runId, depth: 'item', section: 'plan', item: itemId,
  }, principal('owner'));
  assert.equal(item.depth, 'item');
  assert.equal(item.item.id, itemId);
  assert.equal(item.item.section, 'plan');

  const evidence = await f.application.command('run.inspect', {
    runId, depth: 'evidence', section: 'plan', item: itemId,
  }, principal('owner'));
  assert.equal(evidence.depth, 'evidence');
  assert.equal(evidence.evidence.every((entry) => typeof entry.kind === 'string'
    && /^[a-f0-9]{64}$/u.test(entry.digest) && typeof entry.provenance === 'string'), true);
  assert.equal(JSON.stringify(evidence).includes(f.repo), false);
  assert.equal(JSON.stringify(evidence).includes('sessionId'), false);
});

test('AX2c/RT1: execution exposes stable progress, events, and opt-in output through content depth', async (t) => {
  const f = fixture('execution-streams');
  cleanup(t, f.application);
  const runId = 'run-phase67-execution-streams';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));

  const section = await f.application.command('run.inspect', {
    runId, depth: 'section', section: 'execution',
  }, principal('owner'));
  assert.deepEqual(section.section.items.slice(1).map((item) => item.id), [
    'execution:progress', 'execution:events', 'execution:output',
  ]);

  const progress = await f.application.command('run.inspect', {
    runId, depth: 'content', section: 'execution', item: 'execution:progress',
  }, principal('owner'));
  assert.equal(progress.content.kind, 'baton.run_progress');
  assert.equal(progress.content.runId, runId);
  assert.equal(Object.hasOwn(progress.content, 'budget'), false);

  const events = await f.application.command('run.inspect', {
    runId, depth: 'content', section: 'execution', item: 'execution:events',
  }, principal('owner'));
  assert.equal(events.content.kind, 'baton.run_timeline.page');
  assert.equal(events.content.channel, 'events');
  assert.equal(events.content.items.every((item) => item.runId === runId
    && item.occurrenceTrust === 'authoritative'), true);
  for (const leaked of ['workerIds', 'taskId', 'fence', 'maxBytes', 'maxItems']) {
    assert.equal(JSON.stringify(events.content).includes(leaked), false, `events leaked ${leaked}`);
  }

  const output = await f.application.command('run.inspect', {
    runId, depth: 'content', section: 'execution', item: 'execution:output',
  }, principal('owner'));
  assert.equal(output.content.channel, 'output');
  assert.deepEqual(output.content.items, []);

  await f.application.command('run.stop', {
    runId, reason: 'Prove terminal timeline cleanup.',
  }, principal('owner'));
  const terminal = await f.application.command('run.inspect', {
    runId, depth: 'content', section: 'execution', item: 'execution:events',
  }, principal('owner'));
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.content.hasMore, false);
  assert.equal(Object.hasOwn(terminal, 'continuation'), false);
  const stopped = terminal.content.items.find((item) => item.kind === 'run.stop_completed');
  assert.equal(stopped.facts.remainingCount, 0);
  assert.equal(stopped.facts.dispatchClosed, true);
  assert.equal(stopped.facts.runAuthorityReleased, true);
});

test('AX2b: one hidden finalizer bounds every semantic inspection depth', async (t) => {
  const f = fixture('all-depth-response-finalizer');
  cleanup(t, f.application);
  const runId = 'run-phase67-all-depth-response-finalizer';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));

  const normalSection = await f.application.command('run.inspect', {
    runId, depth: 'section', section: 'plan',
  }, principal('owner'));
  const itemId = normalSection.section.items[0].id;
  const ordinary = [
    await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner')),
    await f.application.command('run.inspect', { runId, depth: 'index' }, principal('owner')),
    normalSection,
    await f.application.command('run.inspect', {
      runId, depth: 'item', section: 'plan', item: itemId,
    }, principal('owner')),
    await f.application.command('run.inspect', {
      runId, depth: 'evidence', section: 'plan', item: itemId,
    }, principal('owner')),
  ];
  const serialized = JSON.stringify(ordinary);
  for (const internal of ['maxBytes', 'maxItems', 'maxWaitMs', 'maxResponseBytes']) {
    assert.equal(serialized.includes(`"${internal}"`), false,
      `ordinary inspection leaked internal guard ${internal}`);
  }

  f.application._semanticBounds = () => Object.freeze({
    maxItems: 16, maxBytes: 1, maxWaitMs: 2_000,
  });
  for (const request of [
    { runId, depth: 'outline' },
    { runId, depth: 'index' },
    { runId, depth: 'section', section: 'plan' },
    { runId, depth: 'item', section: 'plan', item: itemId },
    { runId, depth: 'evidence', section: 'plan', item: itemId },
  ]) {
    await assert.rejects(
      () => f.application.command('run.inspect', request, principal('owner')),
      expectCode('application_inspect_oversize'),
      `${request.depth} must pass through the same deployment-owned finalizer`,
    );
  }
});

test('AX3: contextual help is registry-derived, progressive, live-authorized, and does not become a deployment oracle', async (t) => {
  const f = fixture('help');
  cleanup(t, f.application);
  const runId = 'run-phase67-help';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));

  const help = await f.application.command('application.help', {
    topic: 'run.inspect.plan', depth: 'section', runId,
  }, principal('owner'));
  assert.equal(help.schemaVersion, 1);
  assert.equal(help.topic, 'run.inspect.plan');
  assert.equal(help.depth, 'section');
  assert.equal(help.registryDigest, registry().digest);
  assert.equal(typeof help.title, 'string');
  assert.equal(typeof help.summary, 'string');
  assert.equal(Array.isArray(help.examples), true);
  assert.equal(Array.isArray(help.links), true);
  assert.equal(JSON.stringify(help).includes(f.repo), false);
  assert.equal(JSON.stringify(help).includes('sessionId'), false);

  await assert.rejects(f.application.command('application.help', {
    topic: 'run.inspect.plan', depth: 'section', runId,
  }, principal('revoked')), expectCode('application_unauthorized'));

  f.authorization.active = false;
  await assert.rejects(f.application.command('application.help', {
    topic: 'run.inspect.plan', depth: 'section', runId,
  }, principal('owner')), expectCode('application_unauthorized'));
});

test('AX4/AX8: actions are closed and self-describing, bind to one live Run, reauthorize before effects, and keep stop immediate', async (t) => {
  const f = fixture('actions');
  cleanup(t, f.application);
  const runId = 'run-phase67-actions';
  const siblingRunId = 'run-phase67-sibling';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  await f.application.command('run.start', { intent: intent(siblingRunId) }, principal('owner'));
  const outline = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
  const approve = outline.outline.actions.find((action) => action.kind === 'approve_plan');
  assert.ok(approve);
  for (const field of ['actionId', 'kind', 'label', 'summary', 'inputSchema', 'effect',
    'destructive', 'irreversible', 'idempotent', 'freshness', 'help']) {
    assert.equal(Object.hasOwn(approve, field), true, `action descriptor omitted ${field}`);
  }
  assert.equal(approve.inputSchema.additionalProperties, false);
  assert.deepEqual(approve.serverDerived.sort(), ['planDigest']);
  assert.equal(Object.hasOwn(approve.inputSchema.properties, 'planDigest'), false);

  f.driver.coordination.recordWebAudit({
    kind: 'operator_read_authorized', resourceClass: 'application_card',
  }, { actor: 'web:transport-noise', key: 'phase67:transport-noise' });
  const afterTransportNoise = await f.application.command(
    'run.inspect', { runId, depth: 'outline' }, principal('owner'),
  );
  assert.ok(afterTransportNoise.cursor > outline.cursor);
  assert.equal(afterTransportNoise.viewDigest, outline.viewDigest);
  assert.equal(
    afterTransportNoise.outline.actions.find((action) => action.kind === 'approve_plan').actionId,
    approve.actionId,
  );

  await assert.rejects(f.application.command('run.act', {
    runId, actionId: approve.actionId, inputs: { planDigest: 'a'.repeat(64) },
  }, principal('owner')), expectCode('application_action_input_invalid'));
  assert.equal(f.driver.coordinator.list().length, 0);

  await assert.rejects(f.application.command('run.act', {
    runId: siblingRunId, actionId: approve.actionId, inputs: {},
  }, principal('owner')), expectCode('application_action_scope_mismatch'));
  assert.equal(f.driver.coordinator.list().length, 0);

  f.authorization.active = false;
  await assert.rejects(f.application.command('run.act', {
    runId, actionId: approve.actionId, inputs: {},
  }, principal('owner')), expectCode('application_unauthorized'));
  assert.equal(f.driver.coordinator.list().length, 0);

  f.authorization.active = true;
  const admitted = await f.application.command('run.act', {
    runId, actionId: approve.actionId, inputs: {},
  }, principal('owner'));
  assert.equal(['running', 'work_completed'].includes(admitted.outline.phase), true);
  assert.equal(f.driver.coordinator.list().length, 1);

  const running = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
  assert.deepEqual(running.outline.route.requested, { harness: 'mock', model: 'model-a', effort: 'low' });
  assert.deepEqual(running.outline.route.resolved, { harness: 'mock@1.0.0', model: 'model-a', effort: 'low' });
  assert.equal(running.outline.route.launchEnforcement.harness.state, 'matched');
  assert.equal(running.outline.route.launchEnforcement.model.state, 'matched');
  assert.equal(running.outline.route.launchEnforcement.effort.state, 'matched');
  for (const axis of ['harness', 'model', 'effort']) {
    assert.deepEqual(running.outline.route.providerAttestation[axis], { observed: null, state: 'pending' });
  }
  assert.equal(running.outline.narrative.includes('w-'), false, 'outline narrative must not leak worker coordinates');
  const stop = running.outline.actions.find((action) => action.kind === 'stop');
  assert.ok(stop, 'Run stop must appear in the first outline');
  assert.equal(stop.priority, 'emergency');
  assert.equal(stop.destructive, true);
  assert.equal(stop.serverDerived.includes('workerIds'), true);
  assert.equal(Object.hasOwn(stop.inputSchema.properties, 'workerIds'), false);

  const stopped = await f.application.command('run.stop', {
    runId, reason: 'Exercise the pinned emergency alias without section traversal.',
  }, principal('owner'));
  assert.equal(stopped.phase, 'stopped');
  assert.equal(stopped.stop.receipt.remainingCount, 0);
  const stoppedOutline = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
  for (const axis of ['harness', 'model', 'effort']) {
    assert.equal(stoppedOutline.outline.route.providerAttestation[axis].state, 'not_observed_before_stop');
  }
});

test('AX4b: a real application Run explains one durable budget root cause across outline and cascade sections', async (t) => {
  const f = fixture('terminal-cause-budget', {
    delayMs: 0,
    scenario: { budgetUsed: { tokens: 15_000, usd: 0 } },
  });
  cleanup(t, f.application);
  const runId = 'run-phase67-terminal-cause';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  let outline = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
  const approve = outline.outline.actions.find((action) => action.kind === 'approve_plan');
  await f.application.command('run.act', { runId, actionId: approve.actionId, inputs: {} }, principal('owner'));

  for (let attempt = 0; attempt < 200; attempt += 1) {
    outline = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
    if (['failed', 'cancelled'].includes(outline.outline.phase)) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(['failed', 'cancelled'].includes(outline.outline.phase), true);
  const expected = {
    kind: 'budget_exceeded', code: 'budget_hard_limit_exceeded',
    dimension: 'tokens', used: 15_000, limit: 10_000, ratio: 1.5,
  };
  assert.deepEqual(outline.outline.terminalCause, expected);
  assert.equal(Object.hasOwn(outline.outline, 'budget'), false);
  assert.deepEqual(outline.outline.resources.terminalCause, expected);
  assert.equal(outline.outline.resources.state, 'active');
  assert.equal(outline.outline.resources.cleanupState, 'active');
  assert.ok(outline.outline.resources.ownedCount > 0);
  assert.match(outline.outline.narrative, /budget_hard_limit_exceeded.*tokens 15000\/10000/u);

  for (const section of ['execution', 'budget', 'cleanup']) {
    const expanded = await f.application.command('run.inspect', {
      runId, depth: 'section', section,
    }, principal('owner'));
    const value = expanded.section.items[0].value;
    const cause = section === 'budget' ? value.termination : value.terminalCause;
    assert.deepEqual(cause, expected, `${section} must project the same terminal cause`);
    if (section === 'cleanup') {
      assert.equal(expanded.section.state, 'active');
      assert.equal(value.state, 'active');
    }
    assert.equal(JSON.stringify(value).includes(f.repo), false);
    assert.equal(JSON.stringify(value).includes('w-'), false);
    assert.equal(JSON.stringify(value).includes('task-'), false);
  }
});

test('AX4c: a provider wire failure has one safe actionable cause across outline, execution, and cleanup', async (t) => {
  const f = fixture('terminal-cause-wire');
  cleanup(t, f.application);
  f.adapter.spawn = async () => ({
    ok: false,
    code: 'wire_frame_oversize',
    reason: 'oversized provider response contained token=secret-value at /private/provider/session',
  });
  const runId = 'run-phase67-terminal-cause-wire';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  let outline = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
  const approve = outline.outline.actions.find((action) => action.kind === 'approve_plan');
  await f.application.command('run.act', { runId, actionId: approve.actionId, inputs: {} }, principal('owner'));

  for (let attempt = 0; attempt < 200; attempt += 1) {
    outline = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
    if (outline.outline.phase === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(outline.outline.phase, 'failed');
  const expected = {
    kind: 'provider_failure', code: 'wire_frame_oversize', category: 'provider_protocol',
    summary: 'The provider emitted a frame that exceeded Baton\'s safe wire boundary.',
    remediation: 'Baton requires exact termination and reaping of the ambiguous session. Update or repair the harness integration, then retry the Run.',
    retryable: true,
  };
  assert.deepEqual(outline.outline.terminalCause, expected);
  assert.doesNotMatch(JSON.stringify(outline.outline), /secret-value|\/private\/provider|token=/u);

  for (const section of ['execution', 'cleanup']) {
    const expanded = await f.application.command('run.inspect', {
      runId, depth: 'section', section,
    }, principal('owner'));
    assert.deepEqual(expanded.section.items[0].value.terminalCause, expected);
    assert.doesNotMatch(JSON.stringify(expanded.section), /secret-value|\/private\/provider|token=|worker-|task-/u);
  }
});

test('AX5: result adoption and export are application-owned action cascades with no caller coordinates', async (t) => {
  const f = fixture('result-actions', {
    delayMs: 0,
    files: { 'impl/recursive-proof.txt': 'Baton improved Baton through run.act.\n' },
  });
  cleanup(t, f.application);
  const runId = 'run-phase67-result-actions';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));
  let outline = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
  const approve = outline.outline.actions.find((action) => action.kind === 'approve_plan');
  outline = await f.application.command('run.act', {
    runId, actionId: approve.actionId, inputs: {},
  }, principal('owner'));

  let adopt = null;
  for (let attempt = 0; attempt < 200 && !adopt; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    outline = await f.application.command('run.inspect', { runId, depth: 'outline' }, principal('owner'));
    adopt = outline.outline.actions.find((action) => action.kind === 'adopt_result');
  }
  assert.ok(adopt, 'adoption becomes available only after Baton can reverify the preserved result');
  assert.equal(outline.outline.phase, 'work_completed');
  assert.equal(outline.outline.progress.current, 'result');
  assert.deepEqual(outline.outline.progress.stages.find((stage) => stage.key === 'semantic_review'), {
    key: 'semantic_review', label: 'Independent semantic review', state: 'complete',
    detail: 'Review not required by selected profile',
  });
  assert.equal(outline.outline.progress.stages.find((stage) => stage.key === 'result').state, 'active');
  assert.deepEqual(Object.keys(adopt.inputSchema.properties), ['reason']);
  assert.deepEqual([...adopt.serverDerived].sort(), ['evidenceDigest', 'nodeKey', 'resultSha']);

  outline = await f.application.command('run.act', {
    runId,
    actionId: adopt.actionId,
    inputs: { reason: 'Adopt the exact mechanically verified recursive result.' },
  }, principal('owner'));
  const exportResult = outline.outline.actions.find((action) => action.kind === 'export_result');
  assert.ok(exportResult);
  assert.deepEqual(Object.keys(exportResult.inputSchema.properties), []);
  assert.deepEqual([...exportResult.serverDerived].sort(), ['evidenceDigest', 'exportId', 'nodeKey', 'resultSha']);

  outline = await f.application.command('run.act', {
    runId, actionId: exportResult.actionId, inputs: {},
  }, principal('owner'));
  assert.equal(outline.outline.phase, 'completed');
  assert.equal(outline.terminal, true);
  const result = await f.application.command('run.inspect', {
    runId, depth: 'section', section: 'result',
  }, principal('owner'));
  const delivery = await f.application.command('run.inspect', {
    runId, depth: 'section', section: 'delivery',
  }, principal('owner'));
  assert.equal(result.section.items[0].value.state, 'adopted');
  assert.equal(delivery.section.items[0].value.state, 'completed');
  assert.match(delivery.section.items[0].value.exportId, /^[a-f0-9]{64}$/u);
});

test('AX1/AX6/AX7: cards, CLI, MCP, and browser project one digest; default inventory is compact and advanced tools are opt-in', async (t) => {
  const f = fixture('projection');
  cleanup(t, f.application);
  const value = registry();
  const card = f.application.card();
  assert.equal(card.agentExperience.registryDigest, value.digest);
  for (const surface of ['direct', 'cli', 'web', 'mcp', 'browser']) {
    assert.deepEqual(card.agentExperience.projections[surface].operations, value.defaultOperations);
  }

  const mcpPrincipal = {
    userId: 'operator', sessionId: 'phase67-mcp',
    capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: ['repo-phase67'], expiresAt: new Date(Date.now() + 60_000).toISOString(), revoked: false,
  };
  const common = {
    coordinator: f.driver.coordinator,
    coordination: f.driver.coordination,
    application: f.application,
    shutdownPrincipal: principal('phase67-mcp-host'),
    principal: mcpPrincipal,
    repoIds: ['repo-phase67'],
    maxWaitMs: 2_000,
    maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  };
  const ordinary = new McpFleetServer(common);
  // M4b: the canonical grammar tools render beside the retained legacy tools (docs/36 §9 M4).
  // MCP-W1/W2 (v1.0.1): waves.*/doctor/decision.answer/settlement join the ordinary surface.
  // Facade-projection epic (#87+#48): the six workflow-surface tools join the compact default.
  assert.deepEqual(ordinary.toolDefinitions.map((tool) => tool.name), [
    'baton_help', 'baton_runs', 'baton_run_start', 'baton_run_inspect', 'baton_run_episode',
    'baton_run_workstreams', 'baton_workstream_notify', 'baton_workstream_stop',
    'baton_run_act', 'baton_run_stop', 'baton_waves_attach',
    'baton_waves_start', 'baton_waves_progress', 'baton_waves_send', 'baton_waves_stop', 'baton_waves_list', 'baton_waves_run', 'baton_waves_compile',
    'baton_deployment_doctor', 'baton_decision_answer',
    'baton_scratchpad_elevate', 'baton_scratchpad_settle', 'baton_knowledge_promote', 'baton_knowledge_settlement_lease',
    'baton_run_message_send', 'baton_run_message_receipt', 'baton_run_attention_watch',
    'baton_run_scratchpad_read', 'baton_run_scratchpad_elevate', 'baton_run_scratchpad_append', 'baton_run_knowledge_seed',
    'baton_run_do', 'baton_run_view', 'baton_run_member_view', 'baton_run_member_send',
    'baton_run_member_stop', 'baton_application_help',
  ]);
  assert.equal(ordinary.toolDefinitions.every((tool) => tool.inputSchema.additionalProperties === false), true);
  assert.equal(ordinary.toolDefinitions.every((tool) => tool._meta?.['baton/registryDigest'] === value.digest), true);
  assert.equal(ordinary.toolDefinitions.some((tool) => /spawn|worker|kill|drain|ledger|shutdown/u.test(tool.name)), false);

  const advanced = new McpFleetServer({ ...common, surface: 'advanced' });
  assert.equal(advanced.toolNames.has('fleet_spawn'), true);
  assert.equal(advanced.toolNames.has('fleet_kill'), true);
  assert.equal(advanced.toolNames.has('fleet_drain'), true);

  const contextualHelp = parseBatonCli(['help', 'run.inspect.plan']);
  assert.equal(contextualHelp.name, 'application.help');
  assert.deepEqual(contextualHelp.args, { topic: 'run.inspect.plan', depth: 'outline' });
  const show = parseBatonCli(['run', 'show', 'run-phase67-cli']);
  assert.equal(show.name, 'run.inspect');
  assert.deepEqual(show.args, { runId: 'run-phase67-cli', depth: 'outline' });

  const browser = operatorAsset('/control/app.js').body;
  assert.match(browser, /actionId/u);
  assert.match(browser, /inputSchema/u);
  for (const adapterCascade of ['run_adopt', 'run_integrate', 'run_recover', 'run_export']) {
    assert.equal(browser.includes(adapterCascade), false, `browser hard-coded ${adapterCascade}`);
  }
  for (const advancedControl of ["command('list'", "command('kill'", "command('drain'"]) {
    assert.equal(browser.includes(advancedControl), false, `ordinary browser exposed ${advancedControl}`);
  }
});

test('AX2d: singleton section summary addresses bind to authoritative Goal/Plan version, stay stable across a coordination-only cursor advance, and fail closed when stale', async (t) => {
  const f = fixture('stable-address');
  cleanup(t, f.application);
  const runId = 'run-phase67-stable-address';
  await f.application.command('run.start', { intent: intent(runId) }, principal('owner'));

  const first = await f.application.command('run.inspect', {
    runId, depth: 'section', section: 'budget',
  }, principal('owner'));
  assert.ok(first.section.items.length > 0, 'budget section projects at least one summary item');
  const firstId = first.section.items[0].id;
  assert.match(firstId, /^section-summary:budget:g\d+:p\d+$/u,
    'a singleton summary address binds to the authoritative Goal/Plan version, not the cursor');
  assert.doesNotMatch(firstId, /:c\d+$/u, 'no cursor suffix leaks into the item address');

  // A coordination-only cursor advance (transport noise) does not change Goal/Plan authority,
  // so the same summary item keeps the same address.
  f.driver.coordination.recordWebAudit({
    kind: 'operator_read_authorized', resourceClass: 'application_card',
  }, { actor: 'web:stable-address-noise', key: 'phase67:stable-address-noise' });
  const second = await f.application.command('run.inspect', {
    runId, depth: 'section', section: 'budget',
  }, principal('owner'));
  assert.ok(second.cursor > first.cursor, 'the durable cursor advanced between inspections');
  assert.equal(second.section.items[0].id, firstId,
    'the address is stable across a coordination-only cursor advance');

  // An old selector pinned to a different Plan authority version is stale and fails closed;
  // it is never silently aliased to the current content.
  const stalePlanId = firstId.replace(/p\d+$/u, 'p9999');
  await assert.rejects(f.application.command('run.inspect', {
    runId, depth: 'item', section: 'budget', item: stalePlanId,
  }, principal('owner')), expectCode('application_inspect_item_invalid'));

  // A legacy cursor-suffixed address is not silently resolved either.
  await assert.rejects(f.application.command('run.inspect', {
    runId, depth: 'item', section: 'budget', item: `${firstId}:c${first.cursor}`,
  }, principal('owner')), expectCode('application_inspect_item_invalid'));

  // Every singleton section shares the same authority-bound helper.
  for (const sectionId of ['route', 'verification', 'cleanup']) {
    const expanded = await f.application.command('run.inspect', {
      runId, depth: 'section', section: sectionId,
    }, principal('owner'));
    assert.ok(expanded.section.items.length > 0, `${sectionId} projects a summary item`);
    assert.match(expanded.section.items[0].id, new RegExp(`^section-summary:${sectionId}:g\\d+:p\\d+$`, 'u'),
      `${sectionId} summary address is authority-bound through the shared helper`);
  }
});
