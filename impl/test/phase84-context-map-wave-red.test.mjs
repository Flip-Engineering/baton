import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationStore, Coordinator, MockAdapter, createDriver, openBaton,
} from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { goalPlanDigest, planRouteMatches } from '../src/goal-plan.mjs';

const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'kimi-code', model: 'k3', effort: 'high' });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function canonicalDigest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase84@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 84'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  writeFileSync(join(root, 'alpha.mjs'), 'export const alpha = 1;\n');
  writeFileSync(join(root, 'beta.mjs'), 'export const beta = 2;\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter(route, tracker, {
  mapDelayMs = 60_000, mapDelaysMs = null, mapOutcome = 'completed', mapOutcomes = null,
  sourceDelayMs = 60_000,
} = {}) {
  const value = new MockAdapter({
    harness: route.harness,
    scenario: {
      outcome: 'completed',
      edits: [{ path: `${route.harness}-source.txt`, content: 'source\n', delayMs: sourceDelayMs }],
    },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(), authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'phase84-context-map-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: [] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: [] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], configuredPreferences: [], observation: 'unavailable' },
    },
  });
  const nativeSpawn = value.spawn.bind(value);
  let count = 0;
  value.spawn = (...args) => {
    count += 1;
    tracker.calls.push({
      harness: route.harness, model: args[2]?.model, effort: args[2]?.reasoningEffort,
      at: Date.now(), brief: structuredClone(args[1]),
    });
    if (count > 1) {
      const selectedOutcome = Array.isArray(mapOutcomes)
        ? mapOutcomes[count - 2] ?? mapOutcome : mapOutcome;
      const selectedDelayMs = Array.isArray(mapDelaysMs)
        ? mapDelaysMs[count - 2] ?? mapDelayMs : mapDelayMs;
      args[2] = {
        ...args[2],
        scenario: {
          outcome: selectedOutcome,
          edits: [{
            path: `reviews/context-map-${count}.md`, content: `map ${count}\n`,
            delayMs: selectedDelayMs,
          }],
        },
      };
    }
    return nativeSpawn(...args);
  };
  return value;
}

function options(repo, deploymentRoot, tracker, timing = {}) {
  return {
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, tracker, timing),
        'kimi-code': adapter(routeB, tracker, timing),
      },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  };
}

test('CM85-E1: one advertised context_eval compiles the pure AST and rejects effects pre-cell', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-context-eval-deployment-'));
  const tracker = { calls: [] };
  let driver;
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBatonDeployment(options(repo, deploymentRoot, tracker), (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  const workflow = await deployment.workflow('Evaluate one closed pure Context expression.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const ready = await workflow.inspect();
  assert.deepEqual(ready.outline.actions.filter(({ kind }) => kind.startsWith('context_'))
    .map(({ kind }) => kind), ['context_eval']);
  const context = workflow.context();
  const expression = context.source('repository').search('alpha', { mode: 'literal' })
    .project(['path', 'text']).sort(['path']);
  const evaluated = await context.evaluate(expression, { role: 'critic' });
  assert.ok((await evaluated.output()).items.length > 0);
  const directCompatibility = await context.evaluate(
    context.source('repository').search('alpha', { mode: 'literal' }),
    { role: 'critic' },
  );
  const compatibility = await context.search('alpha', {
    branch: 'repository', mode: 'literal', role: 'critic',
  });
  assert.equal(compatibility.id, directCompatibility.id,
    'compatibility sugar must lower to the same durable cell identity');
  const cellsBeforeRefusal = driver.coordination.snapshot().context.cells.length;
  const providerCallsBeforeRefusal = tracker.calls.length;
  await assert.rejects(async () => workflow.act('context_eval', {
    role: 'critic',
    program: {
      schemaVersion: 1, kind: 'baton.context_program',
      expression: {
        op: 'map', input: { op: 'source', branch: 'repository' },
        role: 'critic', instruction: 'attempt a provider effect',
      },
    },
  }), (error) => error?.code === 'application_context_effect_forbidden');
  assert.equal(driver.coordination.snapshot().context.cells.length, cellsBeforeRefusal);
  assert.equal(tracker.calls.length, providerCallsBeforeRefusal);
  await workflow.stop('Reap the context_eval acceptance fixture.');
});

test('CM84-W1: map prebinds Plan v2 with zero new provider calls, then approval launches one real parallel Wave and stop reaps it', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-deployment-'));
  const tracker = { calls: [] };
  let driver;
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBatonDeployment(options(repo, deploymentRoot, tracker), (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  const workflow = await deployment.workflow('Review immutable Context through a successor Wave.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  assert.equal(tracker.calls.length, 2);

  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const output = await parts.output();
  assert.ok(output.items.length >= 2);
  const providerCallsBeforeMap = tracker.calls.length;
  const contextCellArtifacts = driver.coordination.contextCellArtifacts.bind(driver.coordination);
  driver.coordination.contextCellArtifacts = (cellId) => {
    const artifacts = contextCellArtifacts(cellId);
    const evidence = structuredClone(artifacts.evidence);
    evidence.schemaVersion = 1;
    delete evidence.outputLineages;
    delete evidence.outputLineageDigest;
    return { output: artifacts.output, evidence };
  };
  try {
    await assert.rejects(workflow.context().map(parts, {
      role: 'critic', instruction: 'Never dispatch from aggregate-only legacy evidence.',
    }), (error) => error?.code === 'context_output_lineage_required');
  } finally {
    driver.coordination.contextCellArtifacts = contextCellArtifacts;
  }
  assert.equal(tracker.calls.length, providerCallsBeforeMap);
  const mapped = await workflow.context().map(parts, {
    role: 'critic', instruction: 'Write one grounded authority review for this exact partition.',
  });
  const proposed = await mapped.outline();
  assert.equal(proposed.item.state, 'awaiting_plan_approval');
  assert.equal(tracker.calls.length, providerCallsBeforeMap,
    'map proposal must not cross the provider-effect edge');

  const events = readFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const plans = events.filter((event) => event.kind === 'plan.version_proposed');
  const callEvent = events.find((event) => event.kind === 'context.call_admitted');
  const definitions = events.filter((event) => (
    event.kind === 'driver.recorded'
      && event.payload?.kind === 'application.workflow_definition_bound'
  ));
  assert.equal(plans.length, 2);
  assert.equal(definitions.length, 2);
  const [rootDefinition, successorDefinition] = definitions.map((event) => event.payload);
  assert.equal(rootDefinition.schemaVersion, 3);
  assert.equal(rootDefinition.roleCatalog.kind, 'baton.workflow_role_catalog');
  assert.deepEqual(rootDefinition.roleCatalog.roles.map((role) => role.role), [
    'builder', 'critic',
  ]);
  assert.equal(rootDefinition.roleCatalog.roles.every((role) => (
    /^[a-f0-9]{64}$/u.test(role.nodeTemplateDigest)
      && role.nodeTemplate && typeof role.nodeTemplate === 'object'
  )), true);
  assert.deepEqual(rootDefinition.lineage, {
    generation: 1, rootDefinitionDigest: null, parentDefinitionDigest: null,
  });
  assert.equal(successorDefinition.schemaVersion, 3);
  assert.deepEqual(successorDefinition.roleCatalog, rootDefinition.roleCatalog,
    'synthetic successor Attempts must retain the complete root semantic role catalog');
  assert.deepEqual(successorDefinition.lineage, {
    generation: 2,
    rootDefinitionDigest: rootDefinition.definitionDigest,
    parentDefinitionDigest: rootDefinition.definitionDigest,
  });
  assert.equal(successorDefinition.attempts.every((attempt, index) => (
    attempt.logicalRole === 'critic'
      && attempt.role === `critic:${String(index + 1).padStart(4, '0')}`
      && attempt.nodeKey === `attempt:${attempt.role}`
      && attempt.nodeTemplateDigest === rootDefinition.roleCatalog.roles.find((role) => (
        role.role === 'critic'
      )).nodeTemplateDigest
  )), true);
  assert.ok(callEvent);
  assert.equal(callEvent.payload.schemaVersion, 2);
  assert.equal(callEvent.payload.call.schemaVersion, 1);
  assert.equal(callEvent.payload.call.operator, 'map');
  assert.match(callEvent.payload.call.source.outputLineageDigest, /^[a-f0-9]{64}$/u);
  assert.equal(callEvent.payload.call.units.every((unit, index) => (
    unit.index === index
      && unit.inputs[0].itemDigest === canonicalDigest(output.items[index])
      && /^[a-f0-9]{64}$/u.test(unit.coordinateDigest)
      && /^[a-f0-9]{64}$/u.test(unit.inputs[0].lineageDigest)
  )), true);
  assert.ok(callEvent.seq < plans[1].seq);
  assert.equal(plans[1].payload.plan.predecessor.digest, plans[0].payload.plan.digest);
  assert.equal(plans[1].payload.plan.nodes.length, output.items.length);
  assert.equal(plans[1].payload.plan.nodes.every((node) => (
    node.contextCall.callId === mapped.id
      && node.routes.schemaVersion === 2
      && node.routes.allowed.length === 1
      && node.routes.allowed[0].harness === routeA.harness
      && node.routes.allowed[0].model === routeA.model
      && node.routes.allowed[0].effort === routeA.effort
  )), true);

  await workflow.approve();
  assert.equal(tracker.calls.length, providerCallsBeforeMap + output.items.length);
  assert.equal((await workflow.context().outline()).providerEffects, output.items.length);
  assert.equal(tracker.calls.slice(providerCallsBeforeMap).every((call) => (
    call.harness === routeA.harness && call.model === routeA.model && call.effort === routeA.effort
  )), true);
  assert.deepEqual(
    tracker.calls.slice(providerCallsBeforeMap).map((call) => call.brief.contextInput?.value),
    output.items,
    'each provider Brief must receive exactly its selected immutable partition',
  );
  assert.deepEqual(
    tracker.calls.slice(providerCallsBeforeMap).map((call) => (
      canonicalDigest(call.brief.contextInput?.sourceCoordinates)
    )),
    callEvent.payload.call.units.map((unit) => unit.coordinateDigest),
    'each provider Brief must receive only its selected exact source coordinates',
  );
  assert.deepEqual(
    tracker.calls.slice(providerCallsBeforeMap).map((call) => (
      call.brief.contextInput?.lineageDigest
    )),
    callEvent.payload.call.units.map((unit) => unit.inputs[0].lineageDigest),
  );
  assert.equal(tracker.calls.slice(providerCallsBeforeMap).every((call, index) => (
    call.brief.contextInput?.unitId === callEvent.payload.call.units[index].unitId
      && call.brief.contextCall.unit.unitId === callEvent.payload.call.units[index].unitId
  )), true);
  const coordinationText = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  );
  assert.equal(coordinationText.includes('contextInput'), false,
    'physical partition bytes must not be copied into the coordination ledger');
  const postDispatchEvents = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  const waveDispatches = postDispatchEvents.filter((event) => (
    event.batch?.kind === 'goal_plan_wave_dispatch'
      && event.kind === 'plan.node_dispatched'
      && event.payload?.binding?.planId === plans[1].payload.plan.planId
      && event.payload?.binding?.planVersion === plans[1].payload.plan.version
  ));
  assert.equal(new Set(waveDispatches.map((event) => event.batch.id)).size, 1);
  const waveBatchId = waveDispatches[0].batch.id;
  const waveEvents = postDispatchEvents.filter((event) => event.batch?.id === waveBatchId);
  assert.equal(waveEvents.length, output.items.length * 2);
  assert.deepEqual(waveEvents.map((event) => event.batch.index),
    Array.from({ length: waveEvents.length }, (_, index) => index));
  assert.equal(waveEvents.every((event) => event.batch.count === waveEvents.length), true);
  assert.equal(new Set(waveEvents.map((event) => event.ts)).size, 1,
    'the successor tasks must be admitted in one atomic Wave append');
  assert.equal(new Set(waveDispatches.map((event) => event.payload.wave.digest)).size, 1);
  assert.deepEqual(waveDispatches.map((event) => event.payload.wave.index),
    Array.from({ length: output.items.length }, (_, index) => index));
  assert.equal(waveDispatches.every((event) => (
    event.payload.wave.count === output.items.length
  )), true);
  const waveTaskIds = waveDispatches.map((event) => event.payload.taskId);
  const waveHandles = driver.coordinator.list().filter((handle) => (
    waveTaskIds.includes(handle.taskId)
  ));
  assert.equal(waveHandles.length, output.items.length);
  assert.equal(waveHandles.every((handle) => (
    driver.coordinator.localResourceOwnership(handle.id)?.owned === true
  )), true, 'all atomically admitted map children must overlap as live owned work');

  const stopped = await workflow.stop('Interrupt the live Context map Wave and prove full reap.');
  assert.equal(stopped.outline.phase, 'stopped');
  assert.equal(stopped.outline.resources.ownedCount, 0);
  assert.equal(stopped.outline.context.lastCall.state, 'stopped');
  const stoppedEvents = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  const stopAdmission = stoppedEvents.find((event) => event.kind === 'run.stop_admitted');
  const stopCompletion = stoppedEvents.find((event) => event.kind === 'run.stop_completed');
  assert.equal(stopAdmission.payload.schemaVersion, 3);
  assert.deepEqual(stopAdmission.payload.targetContextCallIds, [mapped.id]);
  assert.deepEqual(stopCompletion.payload.receipt.context, {
    targetSessionCount: 1,
    targetCellCount: 0,
    targetCallCount: 1,
    remainingSessionCount: 0,
    remainingCellCount: 0,
    remainingCallCount: 0,
  });
});

test('CM85-L1: a replayed v2 root maps through one exact v3 catalog upgrade', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-legacy-map-deployment-'));
  const tracker = { calls: [] };
  let driver;
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  const deploymentOptions = options(repo, deploymentRoot, tracker);
  const factory = (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  };
  deployment = await openBatonDeployment(deploymentOptions, factory);
  const workflow = await deployment.workflow('Upgrade one replayed v2 Context map.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  const runId = workflow.id;
  await deployment.close();

  const eventFile = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  const historical = readFileSync(eventFile, 'utf8').trim().split('\n').map((line) => (
    JSON.parse(line)
  ));
  const rootEvent = historical.find((event) => (
    event.kind === 'driver.recorded'
      && event.payload?.kind === 'application.workflow_definition_bound'
  ));
  assert.ok(rootEvent);
  const current = rootEvent.payload;
  const legacyCore = {
    schemaVersion: 2,
    repoId: current.repoId, runId: current.runId,
    goalDigest: current.goalDigest, planDigest: current.planDigest,
    profileDigest: current.profileDigest,
    workflowPolicy: current.workflowPolicy,
    workflowPolicyDigest: current.workflowPolicyDigest,
    strategy: current.strategy, workspace: current.workspace, join: current.join,
    workItem: current.workItem,
    attempts: current.attempts.map((attempt) => ({
      role: attempt.role, nodeKey: attempt.nodeKey, route: attempt.route,
    })),
  };
  rootEvent.payload = {
    kind: 'application.workflow_definition_bound', ...legacyCore,
    definitionDigest: canonicalDigest(legacyCore),
  };
  writeFileSync(eventFile, `${historical.map((event) => JSON.stringify(event)).join('\n')}\n`);

  deployment = await openBatonDeployment(deploymentOptions, factory);
  let recovered = deployment.open(runId);
  await recovered.approve();
  const parts = await recovered.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const mapped = await recovered.context().map(parts, {
    role: 'critic', instruction: 'Preserve this exact historical role through the upgrade.',
  });
  assert.equal((await mapped.outline()).item.state, 'awaiting_plan_approval');

  const replayed = readFileSync(eventFile, 'utf8').trim().split('\n').map((line) => (
    JSON.parse(line)
  ));
  const definitions = replayed.filter((event) => (
    event.kind === 'driver.recorded'
      && event.payload?.kind === 'application.workflow_definition_bound'
  )).map((event) => event.payload);
  assert.equal(definitions.length, 2);
  assert.equal(definitions[0].schemaVersion, 2);
  assert.equal(definitions[1].schemaVersion, 3);
  assert.deepEqual(definitions[1].roleCatalog.roles.map((role) => role.role), [
    'builder', 'critic',
  ]);
  assert.deepEqual(definitions[1].lineage, {
    generation: 2,
    rootDefinitionDigest: definitions[0].definitionDigest,
    parentDefinitionDigest: definitions[0].definitionDigest,
  });
  assert.equal(definitions[1].attempts.every((attempt) => (
    attempt.logicalRole === 'critic' && attempt.route.harness === routeA.harness
      && attempt.route.model === routeA.model && attempt.route.effort === routeA.effort
  )), true);
  await deployment.close();
  deployment = await openBatonDeployment(deploymentOptions, factory);
  recovered = deployment.open(runId);
  assert.equal((await recovered.status()).phase, 'awaiting_plan_approval');
  const stopped = await recovered.stop('Reap the legacy upgrade fixture.');
  assert.equal(stopped.outline.phase, 'stopped');
  assert.equal(stopped.outline.resources.ownedCount, 0);
});

test('CM84-W2: restart after call/Plan prebinding replays one identity and approval dispatches only the missing successor Wave', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-replay-'));
  const tracker = { calls: [] };
  const deploymentOptions = options(repo, deploymentRoot, tracker);
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton(deploymentOptions);
  const workflow = await deployment.workflow('Replay one prebound Context successor exactly.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const partitionCount = (await parts.output()).items.length;
  const originalPropose = Coordinator.prototype.proposePlan;
  let interrupted = false;
  Coordinator.prototype.proposePlan = function interruptContextSuccessor(fields, auth) {
    if (!interrupted && fields?.predecessor && fields.nodes?.every((node) => node.contextCall)) {
      interrupted = true;
      throw Object.assign(new Error('injected crash after Context call admission'), {
        code: 'injected_context_plan_gap',
      });
    }
    return originalPropose.call(this, fields, auth);
  };
  try {
    await assert.rejects(workflow.context().map(parts, {
      role: 'critic', instruction: 'Review this exact replay-bound partition.',
    }), (error) => error?.code === 'injected_context_plan_gap');
  } finally {
    Coordinator.prototype.proposePlan = originalPropose;
  }
  const eventPath = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  let events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const callId = events.find((event) => event.kind === 'context.call_admitted')?.payload?.call?.callId;
  assert.match(callId, /^context-call:[a-f0-9]{64}$/u);
  assert.equal(events.filter((event) => event.kind === 'plan.version_proposed').length, 1,
    'the injected gap must retain call admission without its successor Plan');
  assert.equal(tracker.calls.length, 2);

  await deployment.close();
  deployment = await openBaton(deploymentOptions);
  const replay = deployment.open(workflow.id);
  assert.equal((await replay.status()).phase, 'awaiting_plan_approval');
  const replayedCall = await replay.context().call(callId).outline();
  assert.equal(replayedCall.item.id, callId);
  assert.equal(replayedCall.item.state, 'awaiting_plan_approval');
  assert.equal(tracker.calls.length, 2, 'restart must not respawn predecessor work or map children');

  await replay.approve();
  assert.equal(tracker.calls.length, 2 + partitionCount);
  events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_admitted').length, 1);
  assert.equal(events.filter((event) => event.kind === 'plan.version_proposed').length, 2);
  await replay.stop('Reap the replayed Context successor Wave.');
  assert.equal((await replay.status()).phase, 'stopped');
});

test('CM84-W3: Context call ledger substitution fails typed replay before provider effect', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-tamper-'));
  const tracker = { calls: [] };
  const deploymentOptions = options(repo, deploymentRoot, tracker);
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton(deploymentOptions);
  const workflow = await deployment.workflow('Reject substituted Context call authority.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  await workflow.context().map(parts, {
    role: 'critic', instruction: 'Bind this exact partition before replay.',
  });
  await deployment.close();
  deployment = null;
  const eventPath = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  const events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const call = events.find((event) => event.kind === 'context.call_admitted');
  call.payload.call.units[0].inputs[0].itemDigest = 'f'.repeat(64);
  writeFileSync(eventPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  const callsBeforeReplay = tracker.calls.length;
  await assert.rejects(() => openBaton(deploymentOptions), (error) => (
    error?.code === 'context_call_integrity'
  ));
  assert.equal(tracker.calls.length, callsBeforeReplay,
    'integrity failure must occur before adapter/provider effects');
});

test('CM84-W4: terminal children attach once to a durable ContextValue/evidence settlement and replay exactly', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-settlement-'));
  const tracker = { calls: [] };
  const deploymentOptions = options(repo, deploymentRoot, tracker, { mapDelayMs: 20 });
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton(deploymentOptions);
  const workflow = await deployment.workflow('Attach terminal Context map children durably.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const partitionCount = (await parts.output()).items.length;
  const mapped = await workflow.context().map(parts, {
    role: 'critic', instruction: 'Write one grounded result for this partition.',
  });
  await workflow.approve();
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');
  const completed = await mapped.outline();
  assert.equal(completed.item.state, 'completed');
  const output = completed.item.value.output;
  assert.equal(output.kind, 'baton.context_value');
  assert.equal(output.items.length, partitionCount);
  assert.equal(output.items.every((result) => (
    result.kind === 'baton.context_provider_result_ref'
      && /^context-unit:[a-f0-9]{64}$/u.test(result.unitId)
      && /^[a-f0-9]{64}$/u.test(result.childDigest)
      && /^context-result:[a-f0-9]{64}$/u.test(result.capsuleId)
      && /^[a-f0-9]{64}$/u.test(result.capsuleDigest)
      && /^[a-f0-9]{64}$/u.test(result.resultSourceDigest)
      && result.capsuleRef?.kind === 'context_provider_result'
      && /^[a-f0-9]{64}$/u.test(result.resultRefDigest)
  )), true);
  const evidence = await mapped.evidence();
  assert.equal(evidence.evidence.some((row) => row.kind === 'context_call_evidence'), true);
  assert.equal(evidence.evidence.some((row) => row.kind === 'context_call_cleanup'), true);
  const callEvidence = evidence.evidence.find((row) => row.kind === 'context_call_evidence').value;
  assert.equal(callEvidence.schemaVersion, 4);
  assert.equal(callEvidence.outputLineages.length, partitionCount);
  assert.match(callEvidence.outputLineageDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    callEvidence.outputLineages.map(({ index, itemDigest }) => ({ index, itemDigest })),
    output.items.map((item, index) => ({ index, itemDigest: canonicalDigest(item) })),
  );
  assert.equal(callEvidence.outputLineages.every((lineage, index) => (
    lineage.parents.length === 1
      && lineage.parents[0].sourceKind === 'cell_output'
      && lineage.parents[0].sourceId === callEvidence.call.source.id
      && lineage.parents[0].outputIndex === index
      && lineage.derivations.length === 1
      && lineage.derivations[0].kind === 'provider_attempt'
      && lineage.derivations[0].unitId === output.items[index].unitId
      && Number.isSafeInteger(lineage.derivations[0].terminalEvent)
      && lineage.derivations[0].resultCapsuleDigest === output.items[index].capsuleDigest
  )), true);
  const eventPath = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  let events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length, 1);
  const settlement = events.find((event) => event.kind === 'context.call_settled');
  assert.equal(settlement.payload.result.providerResults.length, partitionCount);
  assert.match(settlement.payload.result.providerResultDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(output.items, settlement.payload.result.providerResults);
  assert.deepEqual(
    settlement.payload.result.providerResults.map((result) => result.unitId),
    settlement.payload.result.children.map((child) => child.unitId),
  );
  assert.deepEqual(
    settlement.payload.result.providerResults.map((result) => result.childDigest),
    settlement.payload.result.children.map((child) => child.childDigest),
  );
  assert.equal(JSON.stringify(settlement).includes('map 2'), false,
    'raw provider report content must never enter coordination settlement');
  assert.equal(Object.hasOwn(settlement.payload.result, 'outputLineages'), false,
    'lineage must remain content-addressed evidence, not a duplicate settlement authority');
  assert.equal(settlement.payload.result.cleanup.targetCount, partitionCount);
  assert.equal(settlement.payload.result.cleanup.remainingCount, 0);
  assert.equal(settlement.payload.result.cleanup.targets.every((target) => (
    Number.isSafeInteger(target.releaseEvent) && /^[a-f0-9]{64}$/u.test(target.releaseDigest)
      && target.evidence.kind === 'resource.worker_cleanup_attested'
  )), true);
  assert.equal(events.filter((event) => event.kind === 'task.resources_released').length,
    partitionCount);
  assert.equal(settlement.payload.result.children.every((child) => (
    child.cleanupDigest === settlement.payload.result.cleanup.cleanupDigest
      && child.resourceRelease.releaseDigest
        === settlement.payload.result.cleanup.targets.find((target) => (
          target.unitId === child.unitId
        )).releaseDigest
  )), true);

  const providerCallsBeforeReplay = tracker.calls.length;
  await deployment.close();
  deployment = await openBaton(deploymentOptions);
  assert.equal(tracker.calls.length, providerCallsBeforeReplay,
    'startup reconciliation must not repeat a settled provider effect');
  const replay = deployment.open(workflow.id);
  const replayed = await replay.context().call(mapped.id).outline();
  assert.equal(tracker.calls.length, providerCallsBeforeReplay,
    'successful settled replay must not repeat any predecessor or mapped-child provider effect');
  assert.equal(replayed.item.state, 'completed');
  assert.deepEqual(replayed.item.value.output, output);
  const replayEvidence = await replay.context().call(mapped.id).evidence();
  assert.deepEqual(
    replayEvidence.evidence.find((row) => row.kind === 'context_call_evidence').value,
    callEvidence,
  );
  events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length, 1);
  await replay.stop('Close the settled Context map replay fixture.');
  events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const stopAdmission = events.find((event) => event.kind === 'run.stop_admitted');
  const stopCompletion = events.find((event) => event.kind === 'run.stop_completed');
  assert.equal(stopAdmission.payload.schemaVersion, 3,
    'a completed Context call must remain inside the exact Run-stop target snapshot');
  assert.deepEqual(stopAdmission.payload.targetContextCallIds, [mapped.id]);
  assert.deepEqual(stopCompletion.payload.receipt.context, {
    targetSessionCount: 1,
    targetCellCount: 0,
    targetCallCount: 1,
    remainingSessionCount: 0,
    remainingCellCount: 0,
    remainingCallCount: 0,
  });
  assert.equal((await replay.context().call(mapped.id).outline()).item.state, 'completed',
    'Run stop must preserve an already-completed Context call as terminal history');
  await deployment.close();
  deployment = null;
  const canonicalEvents = readFileSync(eventPath, 'utf8').trim().split('\n')
    .map((line) => JSON.parse(line));
  const releaseTamper = structuredClone(canonicalEvents);
  releaseTamper.find((event) => event.kind === 'task.resources_released')
    .payload.releaseDigest = 'f'.repeat(64);
  writeFileSync(eventPath, `${releaseTamper.map((event) => JSON.stringify(event)).join('\n')}\n`);
  const callsBeforeReleaseTamper = tracker.calls.length;
  await assert.rejects(() => openBaton(deploymentOptions), (error) => (
    error?.code === 'task_resource_release_integrity'
  ));
  assert.equal(tracker.calls.length, callsBeforeReleaseTamper,
    'per-child release tamper must fail replay before provider effects');

  const tampered = structuredClone(canonicalEvents);
  tampered.find((event) => event.kind === 'context.call_settled')
    .payload.result.cleanup.remainingCount = 1;
  writeFileSync(eventPath, `${tampered.map((event) => JSON.stringify(event)).join('\n')}\n`);
  const callsBeforeTamperReplay = tracker.calls.length;
  await assert.rejects(() => openBaton(deploymentOptions), (error) => (
    error?.code === 'context_call_settlement_integrity'
  ));
  assert.equal(tracker.calls.length, callsBeforeTamperReplay,
    'cleanup receipt tamper must fail replay before provider effects');
});

test('CM84-W4b: task release rejects a cleanup attestation borrowing another task process terminal', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase84-release-binding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workerId = 'w-release-binding';
  const taskId = 'release-binding-target';
  const processIdentity = { generation: 7, pid: 41_007, processGroupId: 41_007 };
  const operational = [];
  const store = new CoordinationStore(root, {
    operationalRead: (worker, seq) => (
      worker === workerId ? operational.find((row) => row.seq === seq) ?? null : null
    ),
    operationalRangeRead: (worker, throughSeq) => (
      worker === workerId ? operational.filter((row) => row.seq <= throughSeq) : []
    ),
  });
  store.createTask({
    id: taskId, brief: { goal: 'Bind cleanup to the exact released task process.' },
    deps: [], refines: null, taskType: 'test', reservedWorkerId: workerId,
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  store.claimTask(taskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  });
  const terminal = store.transitionTask(taskId, 'completed', 2, {
    actor: 'worker', key: `task.completed:${taskId}`,
  }).task;

  operational.push({
    schemaVersion: 1, seq: 1, ts: '2026-07-18T00:00:00.000Z',
    worker: workerId, harness: 'mock@test', turnEpoch: 1,
    kind: 'lifecycle.process_started', actor: 'worker',
    taskId, runId: terminal.runId,
    payload: {
      schemaVersion: 1, ...processIdentity, phase: 'initializing',
    },
  });
  operational.push({
    schemaVersion: 1, seq: 2, ts: '2026-07-18T00:00:00.500Z',
    worker: workerId, harness: 'mock@test', turnEpoch: 1,
    kind: 'lifecycle.process_closed', actor: 'worker',
    taskId: 'borrowed-terminal-task', runId: terminal.runId,
    payload: {
      schemaVersion: 1, ...processIdentity, code: 0, signal: null, ready: true,
    },
  });
  const releaseCore = {
    schemaVersion: 1, taskId, taskVersion: terminal.version,
    taskTerminalEvent: terminal.terminalEvent, workerId, runId: terminal.runId,
    process: {
      state: 'closed', ...processIdentity,
      terminalKind: 'lifecycle.process_closed', terminalSeq: 2,
    },
    session: { state: 'historical_only', refDigest: canonicalDigest('session'), recoveryClosed: true },
    worktree: { state: 'absent', ownerTaskId: taskId },
    runtime: { state: 'absent', identityDigest: canonicalDigest('runtime') },
    checks: {
      processClosed: true, sessionDetached: true, worktreeAbsent: true,
      runtimeAbsent: true, interactionsResolved: true, localAuthorityReleased: true,
    },
  };
  const release = { ...releaseCore, releaseDigest: canonicalDigest(releaseCore) };
  operational.push({
    schemaVersion: 1, seq: 3, ts: '2026-07-18T00:00:01.000Z',
    worker: workerId, harness: 'mock@test', turnEpoch: 1,
    kind: 'resource.worker_cleanup_attested', actor: 'policy',
    taskId, runId: terminal.runId, payload: release,
  });
  const mapped = store.mapOperationalEvent(operational[2], {
    actor: 'policy', key: `${workerId}:3`,
  });
  assert.throws(() => store.recordTaskResourceRelease({
    taskId, taskVersion: terminal.version, terminalEvent: terminal.terminalEvent,
    workerId, releaseDigest: release.releaseDigest, evidence: mapped.evidence,
  }, {
    actor: 'policy', key: `task.resources_released:${taskId}:${terminal.terminalEvent}`,
  }), (error) => error?.code === 'task_resource_release_invalid');
});

test('CM84-W4c: task release binds the latest exact start and closed terminal schema', (t) => {
  const attempt = (label, build) => {
    const root = mkdtempSync(join(tmpdir(), `baton-phase84-release-${label}-`));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const workerId = `w-release-${label}`;
    const taskId = `release-${label}`;
    const operational = [];
    const store = new CoordinationStore(root, {
      operationalRead: (worker, seq) => (
        worker === workerId ? operational.find((row) => row.seq === seq) ?? null : null
      ),
      operationalRangeRead: (worker, throughSeq) => (
        worker === workerId ? operational.filter((row) => row.seq <= throughSeq) : []
      ),
    });
    store.createTask({
      id: taskId, brief: { goal: `Reject ${label} process release proof.` },
      deps: [], refines: null, taskType: 'test', reservedWorkerId: workerId,
    }, { actor: 'orchestrator', key: `task.created:${taskId}` });
    store.claimTask(taskId, workerId, 1, {
      actor: 'orchestrator', key: `task.claimed:${taskId}`,
    });
    const task = store.transitionTask(taskId, 'completed', 2, {
      actor: 'worker', key: `task.completed:${taskId}`,
    }).task;
    const built = build({ task, taskId, workerId });
    operational.push(...built.prefix);
    const releaseCore = {
      schemaVersion: 1, taskId, taskVersion: task.version,
      taskTerminalEvent: task.terminalEvent, workerId, runId: task.runId,
      process: built.process,
      session: {
        state: 'historical_only', refDigest: canonicalDigest(`${label}:session`),
        recoveryClosed: true,
      },
      worktree: { state: 'absent', ownerTaskId: taskId },
      runtime: { state: 'absent', identityDigest: canonicalDigest(`${label}:runtime`) },
      checks: {
        processClosed: true, sessionDetached: true, worktreeAbsent: true,
        runtimeAbsent: true, interactionsResolved: true, localAuthorityReleased: true,
      },
    };
    const release = { ...releaseCore, releaseDigest: canonicalDigest(releaseCore) };
    const attestation = {
      schemaVersion: 1, seq: operational.length + 1, ts: '2026-07-18T00:00:02.000Z',
      worker: workerId, harness: 'mock@test', turnEpoch: 1,
      kind: 'resource.worker_cleanup_attested', actor: 'policy',
      taskId, runId: task.runId, payload: release,
    };
    operational.push(attestation);
    const mapped = store.mapOperationalEvent(attestation, {
      actor: 'policy', key: `${workerId}:${attestation.seq}`,
    });
    assert.throws(() => store.recordTaskResourceRelease({
      taskId, taskVersion: task.version, terminalEvent: task.terminalEvent,
      workerId, releaseDigest: release.releaseDigest, evidence: mapped.evidence,
    }, {
      actor: 'policy', key: `task.resources_released:${taskId}:${task.terminalEvent}`,
    }), (error) => error?.code === 'task_resource_release_invalid');
  };

  attempt('stale-generation', ({ task, taskId, workerId }) => {
    const first = { generation: 1, pid: 42_001, processGroupId: 42_001 };
    const second = { generation: 2, pid: 42_002, processGroupId: 42_002 };
    return {
      prefix: [
        {
          schemaVersion: 1, seq: 1, ts: '2026-07-18T00:00:00.000Z', worker: workerId,
          harness: 'mock@test', turnEpoch: 1, kind: 'lifecycle.process_started',
          actor: 'worker', taskId, runId: task.runId,
          payload: { schemaVersion: 1, ...first, phase: 'initializing' },
        },
        {
          schemaVersion: 1, seq: 2, ts: '2026-07-18T00:00:00.250Z', worker: workerId,
          harness: 'mock@test', turnEpoch: 2, kind: 'lifecycle.process_started',
          actor: 'worker', taskId, runId: task.runId,
          payload: { schemaVersion: 1, ...second, phase: 'initializing' },
        },
        {
          schemaVersion: 1, seq: 3, ts: '2026-07-18T00:00:00.500Z', worker: workerId,
          harness: 'mock@test', turnEpoch: 1, kind: 'lifecycle.process_closed',
          actor: 'worker', taskId, runId: task.runId,
          payload: { schemaVersion: 1, ...first, code: 0, signal: null, ready: true },
        },
      ],
      process: {
        state: 'closed', ...first,
        terminalKind: 'lifecycle.process_closed', terminalSeq: 3,
      },
    };
  });

  attempt('malformed-absence', ({ task, taskId, workerId }) => {
    const identity = { generation: 1, pid: 43_001, processGroupId: 43_001 };
    return {
      prefix: [
        {
          schemaVersion: 1, seq: 1, ts: '2026-07-18T00:00:00.000Z', worker: workerId,
          harness: 'mock@test', turnEpoch: 1, kind: 'lifecycle.process_started',
          actor: 'worker', taskId, runId: task.runId,
          payload: { schemaVersion: 1, ...identity, phase: 'initializing' },
        },
        {
          schemaVersion: 1, seq: 2, ts: '2026-07-18T00:00:00.500Z', worker: workerId,
          harness: 'mock@test', turnEpoch: 1, kind: 'control.recovery_process_absent',
          actor: 'policy', taskId, runId: task.runId,
          payload: { schemaVersion: 1, ...identity },
        },
      ],
      process: {
        state: 'absent_after_restart', ...identity,
        terminalKind: 'control.recovery_process_absent', terminalSeq: 2,
      },
    };
  });

  attempt('forged-not-started', ({ task, taskId, workerId }) => {
    const identity = { generation: 1, pid: 44_001, processGroupId: 44_001 };
    return {
      prefix: [{
        schemaVersion: 1, seq: 1, ts: '2026-07-18T00:00:00.000Z', worker: workerId,
        harness: 'mock@test', turnEpoch: 1, kind: 'lifecycle.process_started',
        actor: 'worker', taskId, runId: task.runId,
        payload: { schemaVersion: 1, ...identity, phase: 'initializing' },
      }],
      process: {
        state: 'not_started', generation: null, pid: null, processGroupId: null,
        terminalKind: null, terminalSeq: null,
      },
    };
  });
});

test('CM84-W4e: task release ignores unrelated process starts on a reused worker', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase84-release-reused-worker-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workerId = 'w-release-reused-worker';
  const taskId = 'release-reused-worker-target';
  const unrelatedTaskId = 'release-reused-worker-successor';
  const operational = [];
  const store = new CoordinationStore(root, {
    operationalRead: (worker, seq) => (
      worker === workerId ? operational.find((row) => row.seq === seq) ?? null : null
    ),
    operationalRangeRead: (worker, throughSeq) => (
      worker === workerId ? operational.filter((row) => row.seq <= throughSeq) : []
    ),
  });
  store.createTask({
    id: taskId, brief: { goal: 'Release only this task process identity.' },
    deps: [], refines: null, taskType: 'test', reservedWorkerId: workerId,
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  store.claimTask(taskId, workerId, 1, {
    actor: 'orchestrator', key: `task.claimed:${taskId}`,
  });
  const task = store.transitionTask(taskId, 'completed', 2, {
    actor: 'worker', key: `task.completed:${taskId}`,
  }).task;
  const targetProcess = { generation: 1, pid: 45_001, processGroupId: 45_001 };
  const unrelatedBefore = { generation: 2, pid: 45_002, processGroupId: 45_002 };
  const unrelatedAfter = { generation: 3, pid: 45_003, processGroupId: 45_003 };
  operational.push(
    {
      schemaVersion: 1, seq: 1, ts: '2026-07-18T00:00:00.000Z', worker: workerId,
      harness: 'mock@test', turnEpoch: 1, kind: 'lifecycle.process_started', actor: 'worker',
      taskId, runId: task.runId,
      payload: { schemaVersion: 1, ...targetProcess, phase: 'initializing' },
    },
    {
      schemaVersion: 1, seq: 2, ts: '2026-07-18T00:00:00.250Z', worker: workerId,
      harness: 'mock@test', turnEpoch: 2, kind: 'lifecycle.process_started', actor: 'worker',
      taskId: unrelatedTaskId, runId: task.runId,
      payload: { schemaVersion: 1, ...unrelatedBefore, phase: 'initializing' },
    },
    {
      schemaVersion: 1, seq: 3, ts: '2026-07-18T00:00:00.500Z', worker: workerId,
      harness: 'mock@test', turnEpoch: 1, kind: 'lifecycle.process_closed', actor: 'worker',
      taskId, runId: task.runId,
      payload: { schemaVersion: 1, ...targetProcess, code: 0, signal: null, ready: true },
    },
    {
      schemaVersion: 1, seq: 4, ts: '2026-07-18T00:00:00.750Z', worker: workerId,
      harness: 'mock@test', turnEpoch: 3, kind: 'lifecycle.process_started', actor: 'worker',
      taskId: unrelatedTaskId, runId: task.runId,
      payload: { schemaVersion: 1, ...unrelatedAfter, phase: 'initializing' },
    },
  );
  const releaseCore = {
    schemaVersion: 1, taskId, taskVersion: task.version,
    taskTerminalEvent: task.terminalEvent, workerId, runId: task.runId,
    process: {
      state: 'closed', ...targetProcess,
      terminalKind: 'lifecycle.process_closed', terminalSeq: 3,
    },
    session: {
      state: 'historical_only', refDigest: canonicalDigest('reused-worker:session'),
      recoveryClosed: true,
    },
    worktree: { state: 'absent', ownerTaskId: taskId },
    runtime: { state: 'absent', identityDigest: canonicalDigest('reused-worker:runtime') },
    checks: {
      processClosed: true, sessionDetached: true, worktreeAbsent: true,
      runtimeAbsent: true, interactionsResolved: true, localAuthorityReleased: true,
    },
  };
  const release = { ...releaseCore, releaseDigest: canonicalDigest(releaseCore) };
  const attestation = {
    schemaVersion: 1, seq: 5, ts: '2026-07-18T00:00:01.000Z', worker: workerId,
    harness: 'mock@test', turnEpoch: 1, kind: 'resource.worker_cleanup_attested',
    actor: 'policy', taskId, runId: task.runId, payload: release,
  };
  operational.push(attestation);
  const mapped = store.mapOperationalEvent(attestation, {
    actor: 'policy', key: `${workerId}:${attestation.seq}`,
  });
  const recorded = store.recordTaskResourceRelease({
    taskId, taskVersion: task.version, terminalEvent: task.terminalEvent,
    workerId, releaseDigest: release.releaseDigest, evidence: mapped.evidence,
  }, {
    actor: 'policy', key: `task.resources_released:${taskId}:${task.terminalEvent}`,
  });
  assert.equal(recorded.result, 'recorded');
  assert.equal(recorded.release.releaseDigest, release.releaseDigest);
});

test('CM84-W4f: failed and cancelled terminal tasks retain exact resource-release evidence', (t) => {
  for (const status of ['failed', 'cancelled']) {
    const root = mkdtempSync(join(tmpdir(), `baton-phase85-release-${status}-`));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const workerId = `w-release-${status}`;
    const taskId = `release-${status}`;
    const operational = [];
    const store = new CoordinationStore(root, {
      operationalRead: (worker, seq) => (
        worker === workerId ? operational.find((row) => row.seq === seq) ?? null : null
      ),
      operationalRangeRead: (worker, throughSeq) => (
        worker === workerId ? operational.filter((row) => row.seq <= throughSeq) : []
      ),
    });
    store.createTask({
      id: taskId, brief: { goal: `Retain ${status} terminal cleanup.` },
      deps: [], refines: null, taskType: 'test', reservedWorkerId: workerId,
    }, { actor: 'orchestrator', key: `task.created:${taskId}` });
    store.claimTask(taskId, workerId, 1, {
      actor: 'orchestrator', key: `task.claimed:${taskId}`,
    });
    const task = store.transitionTask(taskId, status, 2, {
      actor: 'worker', key: `task.${status}:${taskId}`,
    }).task;
    const releaseCore = {
      schemaVersion: 1, taskId, taskVersion: task.version,
      taskTerminalEvent: task.terminalEvent, workerId, runId: task.runId,
      process: {
        state: 'not_started', generation: null, pid: null, processGroupId: null,
        terminalKind: null, terminalSeq: null,
      },
      session: { state: 'not_created', refDigest: null, recoveryClosed: true },
      worktree: { state: 'absent', ownerTaskId: taskId },
      runtime: { state: 'absent', identityDigest: null },
      checks: {
        processClosed: true, sessionDetached: true, worktreeAbsent: true,
        runtimeAbsent: true, interactionsResolved: true, localAuthorityReleased: true,
      },
    };
    const release = { ...releaseCore, releaseDigest: canonicalDigest(releaseCore) };
    const attestation = {
      schemaVersion: 1, seq: 1, ts: '2026-07-18T00:00:01.000Z',
      worker: workerId, harness: 'mock@test', turnEpoch: 1,
      kind: 'resource.worker_cleanup_attested', actor: 'policy',
      taskId, runId: task.runId, payload: release,
    };
    operational.push(attestation);
    const mapped = store.mapOperationalEvent(attestation, {
      actor: 'policy', key: `${workerId}:${attestation.seq}`,
    });
    const recorded = store.recordTaskResourceRelease({
      taskId, taskVersion: task.version, terminalEvent: task.terminalEvent,
      workerId, releaseDigest: release.releaseDigest, evidence: mapped.evidence,
    }, {
      actor: 'policy', key: `task.resources_released:${taskId}:${task.terminalEvent}`,
    });
    assert.equal(recorded.release.taskId, taskId);
    assert.equal(recorded.release.workerId, workerId);
    assert.equal(store.task(taskId).status, status);
  }
});

test('CM84-W4d: Context child projections bind the selected dispatch route, not Plan set order', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase84-context-route-truth-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new CoordinationStore(root);
  t.after(() => store.releaseWriterLease());

  const callId = 'context-call-route-truth';
  const planId = 'context-plan-route-truth';
  const planDigest = '1'.repeat(64);
  const partitionId = 'context-partition-route-truth';
  const nodeKey = 'context-node-route-truth';
  const taskId = 'context-task-route-truth';
  const workerId = 'context-worker-route-truth';
  const node = {
    key: nodeKey,
    contextCall: { partition: { partitionId } },
    routes: {
      schemaVersion: 2,
      allowed: [routeA, routeB],
    },
  };
  const plan = { planId, version: 1, digest: planDigest, nodes: [node] };
  const dispatch = {
    taskId,
    binding: { planDigest, nodeKey },
    route: { vendor: routeB.harness, model: routeB.model, effort: routeB.effort },
  };
  const commit = {
    id: 'context-commit-route-truth', kind: 'commit', accepted: true,
    supersededBy: null, digest: '2'.repeat(64), refs: { sha: '3'.repeat(40) },
  };
  const verification = {
    id: 'context-verification-route-truth', kind: 'verification', accepted: true,
    supersededBy: null, digest: '4'.repeat(64), refs: {},
  };
  const call = {
    callId, expectedPlanDigest: planDigest, state: 'plan_pending', admittedEvent: 1,
    source: {
      runId: 'context-run-route-truth', sessionId: 'context-session-route-truth',
      cellId: 'context-cell-route-truth',
    },
    partitions: [{
      partitionId, partitionDigest: '5'.repeat(64), index: 0,
    }],
  };

  store._plans.set(`${planId}:1`, plan);
  store._planApprovals.set(store._planVersionKey(planId, 1), { disposition: 'approved' });
  store._planDispatches.set(store._planNodeKey(planId, 1, nodeKey), dispatch);
  store._tasks.set(taskId, {
    id: taskId, status: 'completed', version: 3, assignee: workerId,
    terminalEvent: 7, artifactIds: [commit.id, verification.id],
  });
  store._artifacts.set(commit.id, commit);
  store._artifacts.set(verification.id, verification);
  store._contextCalls.set(callId, call);

  assert.equal(planRouteMatches(node.routes, {
    vendor: routeA.harness, model: routeB.model, effort: routeB.effort,
  }), false, 'explicit tuple authority must refuse a Cartesian cross-pair');

  assert.deepEqual(store.contextCall(callId).children[0].route, routeB,
    'live/failed child evidence must expose the durable selected dispatch route');
  assert.deepEqual(store.contextCallSettlementChildren(callId)[0].route, routeB,
    'settlement evidence must expose the durable selected dispatch route');
});

test('CM84-W5: a self-consistent forged successor Plan still lacks admitted Context-call authority', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-plan-forgery-'));
  const tracker = { calls: [] };
  const deploymentOptions = options(repo, deploymentRoot, tracker);
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton(deploymentOptions);
  const workflow = await deployment.workflow('Reject forged Context successor Plan authority.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  await workflow.context().map(parts, {
    role: 'critic', instruction: 'Bind this exact partition before Plan replay.',
  });
  await deployment.close();
  deployment = null;

  const eventPath = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  const events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  const planEvent = events.filter((event) => event.kind === 'plan.version_proposed').at(-1);
  for (const node of planEvent.payload.plan.nodes) {
    node.contextCall.callDigest = 'e'.repeat(64);
    node.contextCall.callId = `context-call:${'e'.repeat(64)}`;
  }
  const plan = planEvent.payload.plan;
  const core = {
    schemaVersion: plan.schemaVersion, repoId: plan.repoId, runId: plan.runId,
    goal: plan.goal, predecessor: plan.predecessor, nodes: plan.nodes,
    totals: plan.totals, policyDigest: plan.policyDigest,
  };
  plan.digest = goalPlanDigest(core);
  planEvent.payload.requestDigest = goalPlanDigest({
    proposerPrincipalId: plan.proposerPrincipalId, ...core,
  });
  writeFileSync(eventPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);

  const callsBeforeReplay = tracker.calls.length;
  await assert.rejects(() => openBaton(deploymentOptions), (error) => (
    error?.code === 'goal_plan_integrity'
  ));
  assert.equal(tracker.calls.length, callsBeforeReplay,
    'forged Plan replay must fail before adapter/provider effects');
});

test('CM85-F1: accepted, failed, and cancelled children settle durably after exact release without aggregate output', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-child-failure-'));
  const tracker = { calls: [] };
  const deploymentOptions = options(repo, deploymentRoot, tracker, {
    mapDelayMs: 20,
    mapDelaysMs: [20, 20, 60_000],
    mapOutcomes: ['completed', 'failed', 'completed'],
  });
  let driver;
  let deployment;
  let workflow;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBatonDeployment(deploymentOptions, (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  workflow = await deployment.workflow('Fail Context aggregate when mapped children fail.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const partitionCount = (await parts.output()).items.length;
  const mapped = await workflow.context().map(parts, {
    role: 'critic', instruction: 'This mapped child failure must remain attributable.',
  });
  await workflow.approve();
  const admittedCall = driver.coordination.contextCall(mapped.id);
  const cancelledChild = admittedCall.children[2];
  assert.equal(cancelledChild.state, 'working');
  const killed = await driver.coordinator.kill(
    cancelledChild.workerId, 'application:context-map-cancelled-fixture',
  );
  assert.equal(killed.ok, true);
  await workflow.complete();

  const failed = await mapped.outline();
  assert.equal(failed.item.state, 'failed');
  assert.equal(Object.hasOwn(failed.item.value, 'output'), false);
  assert.equal((await workflow.context().outline()).state, 'failed');
  const failedCall = driver.coordination.contextCall(mapped.id);
  assert.equal(failedCall.version, 2);
  assert.equal(failedCall.state, 'failed');
  assert.equal(failedCall.result.state, 'failed');
  assert.equal(failedCall.result.outputRef, null,
    'a failed call must never invent an aggregate Context value');
  assert.match(failedCall.result.evidenceRef?.digest ?? '', /^[a-f0-9]{64}$/u);
  assert.equal(failedCall.result.children.length, partitionCount);
  assert.equal(failedCall.result.cleanup.targetCount, partitionCount);
  assert.equal(failedCall.result.cleanup.remainingCount, 0);
  assert.deepEqual(failedCall.result.termination, {
    code: 'context_child_failed', retryable: true,
    summary: 'One or more Context map children failed before acceptance.',
  });
  const evidence = await mapped.evidence();
  assert.equal(evidence.evidence.some((row) => row.kind === 'context_call_evidence'), true);
  const failure = evidence.evidence.find((row) => row.kind === 'context_call_failure');
  assert.ok(failure);
  assert.equal(failure.value.state, 'failed');
  assert.equal(failure.value.outputRef, null);
  assert.equal(failure.value.children.length, partitionCount,
    'failure evidence must attribute the complete mapped partition set');
  assert.deepEqual(
    failure.value.children.map((child) => child.unitId),
    failedCall.units.map((unit) => unit.unitId),
  );
  assert.deepEqual(failure.value.children.map((child) => child.state),
    ['accepted', 'failed', 'cancelled']);
  assert.equal(failure.value.children.every((child) => (
    child.route.harness === routeA.harness
      && child.route.model === routeA.model && child.route.effort === routeA.effort
      && child.resourceRelease?.taskId === child.taskId
  )), true);
  assert.match(failure.value.children[0].resultSha, /^[a-f0-9]{40}$/u);
  assert.equal(failure.value.children[0].artifacts.length >= 2, true);
  assert.equal(Object.hasOwn(failure.value.children[0], 'termination'), false);
  assert.equal(failure.value.children[1].resultSha, null);
  assert.deepEqual(failure.value.children[1].artifacts, []);
  assert.equal(failure.value.children[1].termination.code, 'provider_turn_failed');
  assert.equal(failure.value.children[1].termination.retryable, true);
  assert.equal(failure.value.children[2].resultSha, null);
  assert.deepEqual(failure.value.children[2].artifacts, []);
  assert.equal(failure.value.children[2].termination.code, 'context_child_cancelled');
  assert.equal(failure.value.children[2].termination.retryable, true);
  const failedDescendants = failedCall.children.map((child) => ({
    unitId: child.unitId,
    taskId: child.taskId,
    workerId: child.workerId,
    state: child.state,
  }));
  assert.equal(failedDescendants.length, partitionCount);
  assert.equal(new Set(failedDescendants.map((child) => child.taskId)).size, partitionCount);
  assert.equal(new Set(failedDescendants.map((child) => child.workerId)).size, partitionCount);
  assert.equal(failedDescendants.every((child) => {
    const task = driver.coordination.task(child.taskId);
    return task?.runId === failedCall.authority.contextPrincipal.runId
      && task.assignee === child.workerId
      && task.status === child.state;
  }), true, 'every failed partition must retain its exact task/worker/Run identity before reap');
  const failedReleases = failedDescendants.map((child) => (
    driver.coordination.taskResourceRelease(child.taskId)
  ));
  assert.equal(failedReleases.length, partitionCount);
  assert.equal(failedReleases.every((release, index) => (
    release.taskId === failedDescendants[index].taskId
      && release.workerId === failedDescendants[index].workerId
      && release.terminalEvent
        === driver.coordination.task(failedDescendants[index].taskId).terminalEvent
  )), true, 'failed children must retain exact durable cleanup before call failure settles');
  const expectedRunHandles = driver.coordinator.list().filter((handle) => (
    handle.runId === failedCall.authority.contextPrincipal.runId
  ));
  const expectedRunTaskIds = [...new Set(expectedRunHandles.map((handle) => handle.taskId)
    .filter(Boolean))].sort();
  const expectedRunWorkerIds = [...new Set(expectedRunHandles.map((handle) => handle.id))].sort();
  assert.equal(expectedRunTaskIds.length >= failedDescendants.length, true);
  assert.equal(expectedRunWorkerIds.length >= failedDescendants.length, true);
  const sourceCellBeforeStop = driver.coordination.contextCell(failedCall.source.id);
  assert.equal(sourceCellBeforeStop.state, 'completed');
  assert.equal(Number.isSafeInteger(sourceCellBeforeStop.settledEvent), true);
  assert.match(sourceCellBeforeStop.settlementDigest, /^[a-f0-9]{64}$/u);
  const contextBeforeStop = await workflow.context().outline();
  assert.equal(contextBeforeStop.cellCount, 1);
  assert.equal(contextBeforeStop.completedCellCount, 1);
  assert.equal(contextBeforeStop.pendingCellCount, 0,
    'the mapped source cell is durable history, not owned execution requiring stop authority');
  const events = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length, 1);
  const failedSettlement = events.find((event) => event.kind === 'context.call_settled');
  assert.equal(failedSettlement.payload.result.state, 'failed');
  assert.equal(failedSettlement.payload.result.outputRef, null);
  assert.deepEqual(failedSettlement.payload.result.children, failedCall.result.children);
  const acceptedFailedChildren = failedCall.result.children.filter((child) => (
    child.state === 'accepted'
  ));
  assert.equal(failedCall.result.providerEffects, partitionCount);
  assert.equal(failedCall.result.providerResults.length, acceptedFailedChildren.length);
  assert.equal(failedCall.result.providerResults.every((providerResult, index) => (
    providerResult.kind === 'baton.context_provider_result_ref'
      && providerResult.unitId === acceptedFailedChildren[index].unitId
      && providerResult.childDigest === acceptedFailedChildren[index].childDigest
  )), true, 'failed aggregate must retain capsules for accepted children only');
  assert.match(failedCall.result.providerResultDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(failedSettlement.payload.result.cleanup, failedCall.result.cleanup);
  assert.equal(failedSettlement.payload.settlementDigest, failedCall.settlementDigest);
  const settlementAuth = {
    ...structuredClone(failedCall.authority.contextPrincipal),
    key: `context.call.settle:${failedCall.callId}:${failedCall.admissionDigest}`,
  };
  const repeated = driver.coordination.settleContextEffectCall({
    callId: failedCall.callId,
    expectedVersion: 1,
    cleanup: failedCall.result.cleanup,
    result: {
      outputRef: null,
      evidenceRef: failedCall.result.evidenceRef,
      providerResults: failedCall.result.providerResults,
      providerResultDigest: failedCall.result.providerResultDigest,
      termination: failedCall.result.termination,
    },
  }, settlementAuth);
  assert.equal(repeated.result, 'idempotent');
  assert.throws(() => driver.coordination.settleContextEffectCall({
    callId: failedCall.callId,
    expectedVersion: 1,
    cleanup: failedCall.result.cleanup,
    result: {
      outputRef: null,
      evidenceRef: failedCall.result.evidenceRef,
      providerResults: failedCall.result.providerResults,
      providerResultDigest: failedCall.result.providerResultDigest,
      termination: { ...failedCall.result.termination, retryable: false },
    },
  }, settlementAuth), (error) => error?.code === 'context_call_settlement_conflict');

  const runId = workflow.id;
  const providerCallsBeforeReplay = tracker.calls.length;
  const releaseCountBeforeReplay = events.filter((event) => (
    event.kind === 'task.resources_released'
  )).length;
  const failedResultBeforeReplay = structuredClone(failedCall.result);
  await deployment.close();
  deployment = await openBatonDeployment(deploymentOptions, (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  workflow = deployment.open(runId);
  const replayedCall = driver.coordination.contextCall(mapped.id);
  assert.equal(replayedCall.state, 'failed');
  assert.deepEqual(replayedCall.result, failedResultBeforeReplay,
    'restart must preserve the exact failed child, cleanup, termination, and evidence identities');
  assert.equal(tracker.calls.length, providerCallsBeforeReplay,
    'failed-call replay must not repeat a provider effect');
  const replayedEvidence = await workflow.context().call(mapped.id).evidence();
  assert.equal(replayedEvidence.evidence.find((row) => (
    row.kind === 'context_call_failure'
  ))?.digest, failedCall.result.evidenceRef.digest);
  const replayedEvents = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(replayedEvents.filter((event) => event.kind === 'context.call_settled').length, 1,
    'restart must not append a second failed settlement');
  assert.equal(replayedEvents.filter((event) => event.kind === 'task.resources_released').length,
    releaseCountBeforeReplay, 'restart must not repeat failed-child cleanup evidence');
  const stopped = await workflow.stop('Reap failed Context map children.');
  assert.equal(stopped.outline.phase, 'stopped');
  assert.equal(stopped.outline.resources.ownedCount, 0);
  assert.equal(stopped.outline.context.lastCall.state, 'failed');

  const stoppedCall = driver.coordination.contextCall(mapped.id);
  assert.equal(stoppedCall.state, 'failed');
  assert.equal(stoppedCall.settlementDigest, failedCall.settlementDigest,
    'Run stop must retain a durably failed call as terminal history');
  assert.deepEqual(stoppedCall.children.map((child) => ({
    unitId: child.unitId,
    taskId: child.taskId,
    workerId: child.workerId,
    state: child.state,
  })), failedDescendants, 'stop must preserve the exact failed-descendant identity history');
  assert.deepEqual(driver.coordination.contextCell(failedCall.source.id), sourceCellBeforeStop,
    'Run stop must preserve the already-completed source cell as immutable history');

  const stoppedEvents = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  const stopAdmission = stoppedEvents.findLast((event) => event.kind === 'run.stop_admitted');
  const stopCompletion = stoppedEvents.findLast((event) => event.kind === 'run.stop_completed');
  assert.ok(stopAdmission);
  assert.ok(stopCompletion);
  assert.equal(stopAdmission.payload.schemaVersion, 3);
  assert.deepEqual(stopAdmission.payload.targetRunIds,
    [failedCall.authority.contextPrincipal.runId]);
  assert.deepEqual(stopAdmission.payload.targetTaskIds, expectedRunTaskIds,
    'Run stop must target exactly the pre-stop task set, without foreign authority');
  assert.deepEqual(stopAdmission.payload.targetWorkerIds, expectedRunWorkerIds,
    'Run stop must target exactly the pre-stop worker set, without foreign authority');
  assert.deepEqual(stopAdmission.payload.targetContextSessionIds,
    [failedCall.authority.sessionId]);
  assert.deepEqual(stopAdmission.payload.targetContextCellIds, []);
  assert.deepEqual(stopAdmission.payload.targetContextCallIds, [mapped.id]);
  assert.equal(failedDescendants.every((child) => (
    stopAdmission.payload.targetTaskIds.includes(child.taskId)
      && stopAdmission.payload.targetWorkerIds.includes(child.workerId)
  )), true, 'the durable Run-stop target snapshot must include every failed map descendant');
  assert.equal(stopAdmission.payload.targetDigest, canonicalDigest({
    throughSeq: stopAdmission.payload.throughSeq,
    targetRunIds: [failedCall.authority.contextPrincipal.runId],
    targetTaskIds: expectedRunTaskIds,
    targetWorkerIds: expectedRunWorkerIds,
    targetContextSessionIds: [failedCall.authority.sessionId],
    targetContextCellIds: [],
    targetContextCallIds: [mapped.id],
  }), 'the durable Run-stop target digest must bind the independently derived exact set');

  const receipt = stopCompletion.payload.receipt;
  assert.equal(receipt.targetDigest, stopAdmission.payload.targetDigest);
  assert.equal(receipt.targetCount, expectedRunWorkerIds.length);
  assert.equal(receipt.remainingCount, 0);
  assert.equal(
    receipt.counts.pendingCancelled + receipt.counts.killConfirmed
      + receipt.counts.alreadyTerminal,
    receipt.targetCount,
  );
  assert.equal(receipt.counts.processesObserved, receipt.counts.processesClosed);
  assert.deepEqual(receipt.context, {
    targetSessionCount: 1,
    targetCellCount: 0,
    targetCallCount: 1,
    remainingSessionCount: 0,
    remainingCellCount: 0,
    remainingCallCount: 0,
  });
  const { receiptDigest, ...receiptCore } = receipt;
  assert.equal(receiptDigest, canonicalDigest(receiptCore));

  const stoppedHandles = new Map(driver.coordinator.list().map((handle) => [handle.id, handle]));
  const targetHandles = stopAdmission.payload.targetWorkerIds.map((workerId) => (
    stoppedHandles.get(workerId)
  )).filter(Boolean);
  assert.equal(receipt.counts.processesObserved,
    targetHandles.filter((handle) => handle.processRef !== null).length);
  const stoppedOwnership = stopAdmission.payload.targetWorkerIds.map((workerId) => {
    const handle = stoppedHandles.get(workerId);
    return {
      workerId,
      owned: driver.coordinator.localResourceOwnership(workerId)?.owned,
      worktree: handle?.worktree ?? null,
      worktreeAbsent: handle?.worktree == null || !existsSync(handle.worktree),
      releasedWorker: driver.coordination.taskResourceRelease(handle?.taskId)?.workerId ?? null,
      runtimeActive: handle?.runtimeScope?.active ?? null,
      processState: handle?.processRef?.state ?? null,
      pendingApprovalId: handle?.pendingApprovalId ?? null,
      pendingQuestionId: handle?.pendingQuestionId ?? null,
    };
  });
  assert.equal(stoppedOwnership.every((row) => (
    row.owned === false
      && row.worktreeAbsent === true
      && row.runtimeActive !== true
      && [null, 'closed'].includes(row.processState)
      && row.pendingApprovalId === null
      && row.pendingQuestionId === null
  )), true, `every exact Run-stop target must have zero remaining local resource authority: ${JSON.stringify(stoppedOwnership)}`);
  assert.equal(failedDescendants.every((child) => {
    const handle = stoppedHandles.get(child.workerId);
    const task = driver.coordination.task(child.taskId);
    return handle?.taskId === child.taskId
      && handle.runId === failedCall.authority.contextPrincipal.runId
      && task?.runId === failedCall.authority.contextPrincipal.runId
      && task.assignee === child.workerId
      && task.status === child.state;
  }), true, 'reap must not lose or substitute failed descendant task/worker/Run bindings');
  assert.equal((await workflow.status()).phase, 'stopped');
});

test('CM84-W7: restart after descendant reap but before settlement converges through the same cleanup authority', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-cleanup-recovery-'));
  const tracker = { calls: [] };
  const deploymentOptions = options(repo, deploymentRoot, tracker, { mapDelayMs: 20 });
  let driver;
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBatonDeployment(deploymentOptions, (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  const workflow = await deployment.workflow('Recover Context settlement after exact descendant reap.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const mapped = await workflow.context().map(parts, {
    role: 'critic', instruction: 'Reap me before the injected settlement interruption.',
  });
  await workflow.approve();

  const originalSettle = CoordinationStore.prototype.settleContextEffectCall;
  let interrupted = false;
  let interruptedFields = null;
  CoordinationStore.prototype.settleContextEffectCall = function interruptAfterCleanup(fields, auth) {
    if (!interrupted && fields?.callId === mapped.id) {
      interrupted = true;
      interruptedFields = structuredClone(fields);
      throw Object.assign(new Error('injected crash after Context descendant reap'), {
        code: 'injected_context_cleanup_gap',
      });
    }
    return originalSettle.call(this, fields, auth);
  };
  try {
    await assert.rejects(workflow.complete(), (error) => (
      error?.code === 'injected_context_cleanup_gap'
    ));
  } finally {
    CoordinationStore.prototype.settleContextEffectCall = originalSettle;
  }
  const eventPath = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  let events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length, 0);
  const call = driver.coordination.contextCall(mapped.id);
  assert.equal(call.state, 'settlement_ready');
  assert.ok(interruptedFields, 'the injected gap must retain the exact attempted settlement');
  const expectedUnits = structuredClone(call.units);
  const expectedChildren = driver.coordination.contextCallSettlementChildren(
    mapped.id, interruptedFields.cleanup,
  );
  const expectedBindings = call.children.map((child) => ({
    unitId: child.unitId, unitDigest: child.unitDigest,
    index: child.index, nodeKey: child.nodeKey, nodeDigest: child.nodeDigest,
    taskId: child.taskId, taskVersion: child.taskVersion,
    terminalEvent: child.terminalEvent, workerId: child.workerId,
    route: structuredClone(child.route),
    runId: driver.coordination.task(child.taskId)?.runId ?? null,
    release: driver.coordination.taskResourceRelease(child.taskId),
  }));
  assert.equal(call.children.every((child) => (
    driver.coordinator.localResourceOwnership(child.workerId)?.owned === false
  )), true);

  const providerCallsBeforeRecoveryReplay = tracker.calls.length;
  await deployment.close();
  deployment = await openBatonDeployment(deploymentOptions, (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  assert.equal(tracker.calls.length, providerCallsBeforeRecoveryReplay,
    'settlement-ready recovery must attach retained children without another provider effect');
  const replay = deployment.open(workflow.id);
  const recovered = await replay.context().call(mapped.id).outline();
  assert.equal(tracker.calls.length, providerCallsBeforeRecoveryReplay,
    'recovered Context call inspection must remain provider-effect-free');
  assert.equal(recovered.item.state, 'completed');
  const recoveredCall = driver.coordination.contextCall(mapped.id);
  assert.deepEqual(recoveredCall.units, expectedUnits,
    'recovery must preserve the admitted unit order and immutable source identities');
  assert.deepEqual(recoveredCall.result.children, expectedChildren,
    'recovery must settle the exact retained results and selected dispatch routes');
  assert.equal(recoveredCall.result.childDigest, canonicalDigest(expectedChildren));
  const completedSource = driver.coordination.contextCompletedCallSource(mapped.id);
  assert.deepEqual(completedSource, {
    kind: 'call', id: recoveredCall.callId, callDigest: recoveredCall.callDigest,
    generation: recoveredCall.generation, settlementDigest: recoveredCall.settlementDigest,
    outputRef: recoveredCall.result.outputRef, evidenceRef: recoveredCall.result.evidenceRef,
    itemCount: recoveredCall.result.providerResults.length,
    coordinateDigest: driver.coordination.contextCallArtifacts(mapped.id).evidence.coordinateDigest,
    outputLineageDigest:
      driver.coordination.contextCallArtifacts(mapped.id).evidence.outputLineageDigest,
  });
  assert.equal(completedSource.evidenceRef.kind, 'context_call_evidence');
  for (const binding of expectedBindings) {
    const recoveredChild = recoveredCall.children.find((child) => (
      child.unitId === binding.unitId
    ));
    assert.deepEqual({
      unitId: recoveredChild?.unitId,
      unitDigest: recoveredChild?.unitDigest,
      index: recoveredChild?.index,
      nodeKey: recoveredChild?.nodeKey,
      nodeDigest: recoveredChild?.nodeDigest,
      taskId: recoveredChild?.taskId,
      taskVersion: recoveredChild?.taskVersion,
      terminalEvent: recoveredChild?.terminalEvent,
      workerId: recoveredChild?.workerId,
      route: recoveredChild?.route,
      runId: driver.coordination.task(recoveredChild?.taskId)?.runId ?? null,
      release: driver.coordination.taskResourceRelease(recoveredChild?.taskId),
    }, binding, 'recovery must preserve each exact unit/task/worker/Run/release binding');
    assert.equal(driver.coordinator.localResourceOwnership(binding.workerId)?.owned, false,
      'recovered descendants must remain reaped');
  }
  events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length, 1);
  const settlement = events.find((event) => event.kind === 'context.call_settled');
  assert.deepEqual(settlement.payload.authority, call.admissionAuthority,
    'recovered settlement must retain the admitted Context authority');
  assert.deepEqual(settlement.payload.result.children, expectedChildren);
  assert.deepEqual(settlement.payload.result.cleanup, interruptedFields.cleanup,
    'recovery must settle through the exact pre-crash cleanup target set');
  assert.deepEqual(settlement.payload.result.outputRef, interruptedFields.result.outputRef);
  assert.deepEqual(settlement.payload.result.evidenceRef, interruptedFields.result.evidenceRef);
  assert.equal(settlement.payload.result.cleanup.targetCount, expectedBindings.length);
  assert.equal(settlement.payload.result.cleanup.remainingCount, 0);
  assert.equal(settlement.payload.result.cleanup.targetDigest,
    canonicalDigest(settlement.payload.result.cleanup.targets));
  const { cleanupDigest, ...cleanupCore } = settlement.payload.result.cleanup;
  assert.equal(cleanupDigest, canonicalDigest(cleanupCore));
  assert.deepEqual(settlement.payload.result.cleanup.targets.map((target) => ({
    unitId: target.unitId, taskId: target.taskId, workerId: target.workerId,
    releaseDigest: target.releaseDigest,
  })), expectedBindings.map((binding) => ({
    unitId: binding.unitId, taskId: binding.taskId, workerId: binding.workerId,
    releaseDigest: binding.release.releaseDigest,
  })));
  assert.equal(settlement.payload.settlementDigest, canonicalDigest({
    authority: settlement.payload.authority,
    callId: call.callId,
    admissionDigest: call.admissionDigest,
    expectedVersion: settlement.payload.expectedVersion,
    newVersion: settlement.payload.newVersion,
    result: settlement.payload.result,
  }));

  const settlementCountBeforeSecondRestart = events.filter((event) => (
    event.kind === 'context.call_settled'
  )).length;
  const releaseCountBeforeSecondRestart = events.filter((event) => (
    event.kind === 'task.resources_released'
  )).length;
  await deployment.close();
  deployment = await openBatonDeployment(deploymentOptions, (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  assert.equal(tracker.calls.length, providerCallsBeforeRecoveryReplay,
    'a second recovery must not repeat provider effects');
  const secondReplay = deployment.open(workflow.id);
  assert.equal((await secondReplay.context().call(mapped.id).outline()).item.state, 'completed');
  assert.deepEqual(driver.coordination.contextCompletedCallSource(mapped.id), completedSource,
    'the reduce-eligible call source must replay as one content identity');
  events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length,
    settlementCountBeforeSecondRestart,
    'a second recovery must not repeat Context settlement');
  assert.equal(events.filter((event) => event.kind === 'task.resources_released').length,
    releaseCountBeforeSecondRestart,
    'a second recovery must not repeat descendant cleanup receipts');
  await secondReplay.stop('Close recovered Context cleanup fixture.');
});
