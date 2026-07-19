import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MockAdapter, contextEffectCallIdentity, contextEffectNodeBinding, createDriver,
} from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { goalPlanDigest, normalizePlanRequest } from '../src/goal-plan.mjs';
import { validateWorkflowDefinitionV3, workflowAttempt } from '../src/workflow-definition.mjs';

const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'kimi-code', model: 'k3', effort: 'high' });

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-admission-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase85@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 85'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  writeFileSync(join(root, 'alpha.mjs'), 'export const alpha = 1;\n');
  writeFileSync(join(root, 'beta.mjs'), 'export const beta = 2;\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter(route, tracker) {
  const value = new MockAdapter({
    harness: route.harness,
    scenario: {
      outcome: 'completed',
      edits: [{ path: `${route.harness}-source.txt`, content: 'source\n', delayMs: 20 }],
    },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(), authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'phase85-effect-admission-test', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  const nativeSpawn = value.spawn.bind(value);
  let spawnCount = 0;
  value.spawn = (...args) => {
    spawnCount += 1;
    tracker.calls.push({
      harness: route.harness, model: args[2]?.model, effort: args[2]?.reasoningEffort,
    });
    args[2] = {
      ...args[2],
      scenario: {
        outcome: 'completed',
        edits: [{
          path: `reviews/effect-admission-${tracker.calls.length}.md`,
          content: 'provider result\n', delayMs: spawnCount === 1 ? 60_000 : 20,
        }],
      },
    };
    return nativeSpawn(...args);
  };
  return value;
}

function options(repo, deploymentRoot, tracker) {
  return {
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, tracker),
        'kimi-code': adapter(routeB, tracker),
      },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({
          freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER,
        }),
      },
    },
  };
}

function eventsAt(deploymentRoot) {
  return readFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
}

function templateNode({ call, unit = call.units[0], catalogRole, predecessorPlan }) {
  const template = catalogRole.nodeTemplate;
  return {
    definitionOfDone: structuredClone(template.definitionOfDone),
    pathScope: structuredClone(template.pathScope),
    contextScope: structuredClone(template.contextScope),
    risk: template.risk,
    verification: structuredClone(template.verification),
    routes: {
      harnesses: [catalogRole.route.harness], models: [catalogRole.route.model],
      efforts: [catalogRole.route.effort],
    },
    capabilities: structuredClone(template.capabilities),
    effects: structuredClone(template.effects),
    requiredEffects: structuredClone(template.requiredEffects),
    ...(template.workerPolicy ? { workerPolicy: structuredClone(template.workerPolicy) } : {}),
    key: `attempt:${call.role}:${String(unit.index + 1).padStart(4, '0')}`,
    objective: `${call.role} Context ${call.operator} unit ${unit.index + 1}: ${call.instruction}`,
    deps: [], budget: structuredClone(predecessorPlan.nodes[0].budget),
    contextCall: contextEffectNodeBinding(call, unit),
  };
}

test('CC85-A1: generic reduce admission shares one event/store, replays inertly, and stops exactly', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-admission-'));
  const tracker = { calls: [] };
  const deploymentOptions = options(repo, deploymentRoot, tracker);
  let deployment; let driver;
  const open = async () => openBatonDeployment(deploymentOptions, (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });

  deployment = await open();
  const workflow = await deployment.workflow('Prove generic Context admission without dispatch.', {
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
    role: 'critic', instruction: 'Produce one exact retained result for this partition.',
  });
  await workflow.approve();
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');
  assert.equal((await mapped.outline()).item.state, 'completed');

  const source = driver.coordination.contextCompletedCallSource(mapped.id);
  const artifacts = driver.coordination.contextCallArtifacts(mapped.id);
  const beforeAdmissionEvents = eventsAt(deploymentRoot);
  const sourceDefinition = beforeAdmissionEvents.filter((event) => (
    event.kind === 'driver.recorded'
      && event.payload?.kind === 'application.workflow_definition_bound'
  )).at(-1).payload;
  const predecessorPlan = beforeAdmissionEvents
    .filter((event) => event.kind === 'plan.version_proposed').at(-1).payload.plan;
  const goal = beforeAdmissionEvents
    .filter((event) => event.kind === 'goal.version_defined').at(-1).payload.goal;
  const parent = driver.coordination.contextCall(mapped.id);
  const session = driver.coordination.contextSession(parent.source.sessionId);
  const requester = { principalId: 'phase85-owner', sessionId: 'phase85-owner-session' };
  const call = contextEffectCallIdentity({
    schemaVersion: 1, kind: 'baton.context_effect_call', operator: 'reduce',
    generation: 1, predecessorCall: null, inheritedChildren: [],
    authority: {
      contextPrincipal: structuredClone(session.authority), requester,
      sessionId: session.sessionId, manifestDigest: session.manifestDigest,
      treeSha: session.manifest.tree.sha, environmentDigest: session.environmentDigest,
      policyDigest: session.policyDigest, definitionDigest: sourceDefinition.definitionDigest,
      roleCatalogDigest: sourceDefinition.roleCatalog.catalogDigest,
      profileDigest: sourceDefinition.profileDigest,
      predecessorPlan: {
        planId: predecessorPlan.planId, version: predecessorPlan.version,
        digest: predecessorPlan.digest,
      },
    },
    source, role: 'critic', instruction: 'Synthesize every exact retained result.',
    units: [{
      index: 0,
      inputs: artifacts.evidence.outputLineages.map((lineage) => ({
        index: lineage.index, itemDigest: lineage.itemDigest,
        lineageDigest: lineage.lineageDigest,
      })),
      coordinateDigest: source.coordinateDigest,
    }],
  });
  const catalogRole = sourceDefinition.roleCatalog.roles.find((role) => role.role === call.role);
  const node = templateNode({ call, catalogRole, predecessorPlan });
  const planRequest = {
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    predecessor: {
      planId: predecessorPlan.planId, version: predecessorPlan.version,
      digest: predecessorPlan.digest,
    },
    nodes: [node],
  };
  const policy = driver.coordination.goalPlanPolicy();
  const normalizedPlan = normalizePlanRequest(planRequest, policy, goal);
  const expectedPlanDigest = goalPlanDigest({
    schemaVersion: 1, repoId: session.authority.repoId, runId: session.authority.runId,
    goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
    nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
    policyDigest: policy.policyDigest,
  });
  const successorCore = {
    schemaVersion: 3, repoId: sourceDefinition.repoId, runId: sourceDefinition.runId,
    goalDigest: sourceDefinition.goalDigest, planDigest: expectedPlanDigest,
    profileDigest: sourceDefinition.profileDigest,
    workflowPolicy: structuredClone(sourceDefinition.workflowPolicy),
    workflowPolicyDigest: sourceDefinition.workflowPolicyDigest,
    strategy: sourceDefinition.strategy, workspace: sourceDefinition.workspace,
    join: sourceDefinition.join, workItem: structuredClone(sourceDefinition.workItem),
    roleCatalog: structuredClone(sourceDefinition.roleCatalog),
    lineage: {
      generation: sourceDefinition.lineage.generation + 1,
      rootDefinitionDigest: sourceDefinition.lineage.rootDefinitionDigest
        ?? sourceDefinition.definitionDigest,
      parentDefinitionDigest: sourceDefinition.definitionDigest,
    },
    attempts: [workflowAttempt(`${call.role}:0001`, call.role, node.key,
      sourceDefinition.roleCatalog)],
  };
  validateWorkflowDefinitionV3(successorCore, {
    nodes: normalizedPlan.nodes,
    ancestors: beforeAdmissionEvents.filter((event) => (
      event.kind === 'driver.recorded'
        && event.payload?.kind === 'application.workflow_definition_bound'
    )).map((event) => event.payload),
  });
  driver.coordination.recordDriver('application.workflow_definition_bound', {
    ...successorCore, definitionDigest: digest(successorCore),
  }, {
    actor: 'application:workflow-registry',
    key: `application.workflow_definition_bound:${session.authority.runId}:${expectedPlanDigest}`,
  });
  const auth = {
    ...structuredClone(session.authority),
    requesterPrincipalId: requester.principalId,
    requesterSessionId: requester.sessionId,
    key: `context.call:${call.callId}`,
  };
  const providerCallsBeforeAdmission = tracker.calls.length;
  const admitted = driver.coordination.admitContextEffectCall({
    call, planRequest, expectedPlanDigest,
  }, auth);
  assert.equal(admitted.result, 'admitted');
  assert.equal(admitted.event.kind, 'context.call_admitted');
  assert.equal(admitted.event.payload.schemaVersion, 2);
  assert.equal(admitted.call.kind, 'baton.context_effect_call');
  assert.equal(admitted.call.operator, 'reduce');
  assert.equal(admitted.call.state, 'plan_pending');
  assert.equal(admitted.call.plan, null);
  assert.deepEqual(admitted.call.children, []);
  assert.equal(tracker.calls.length, providerCallsBeforeAdmission,
    'generic admission must not cross the provider-effect edge');
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_admitted' && event.payload.schemaVersion === 2
  )).length, 1);
  const repeated = driver.coordination.admitContextEffectCall({
    call, planRequest, expectedPlanDigest,
  }, auth);
  assert.equal(repeated.result, 'idempotent');
  assert.equal(repeated.event.seq, admitted.event.seq);

  const substituted = structuredClone(call);
  substituted.authority.requester.principalId = 'other-owner';
  await assert.rejects(async () => driver.coordination.admitContextEffectCall({
    call: substituted, planRequest, expectedPlanDigest,
  }, auth), (error) => error?.code?.startsWith('context_call_'));
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_admitted' && event.payload.schemaVersion === 2
  )).length, 1);

  const beforeRestart = eventsAt(deploymentRoot);
  const plansBeforeRestart = beforeRestart.filter((event) => event.kind === 'plan.version_proposed').length;
  const callsBeforeRestart = beforeRestart.filter((event) => event.kind === 'context.call_admitted').length;
  await deployment.close();
  deployment = await open();
  const afterRestart = eventsAt(deploymentRoot);
  assert.equal(afterRestart.filter((event) => event.kind === 'plan.version_proposed').length,
    plansBeforeRestart + 1,
    'generic reconciliation must propose its own exactly prebound pending Plan');
  assert.equal(afterRestart.filter((event) => event.kind === 'context.call_admitted').length,
    callsBeforeRestart);
  assert.equal(tracker.calls.length, providerCallsBeforeAdmission,
    'restart proposal must neither dispatch nor repeat provider work without approval');
  const replayed = driver.coordination.contextCall(call.callId);
  assert.equal(replayed.callDigest, call.callDigest);
  assert.deepEqual(replayed.authority, call.authority,
    'replay must preserve rich call authority rather than overwrite it with the event principal');
  assert.deepEqual(replayed.admissionAuthority, session.authority);

  const replay = deployment.open(workflow.id);
  await replay.stop('Stop the Run with both historical and generic Context calls.');
  const stoppedEvents = eventsAt(deploymentRoot);
  const stop = stoppedEvents.filter((event) => event.kind === 'run.stop_admitted').at(-1);
  assert.equal(stop.payload.schemaVersion, 3);
  assert.deepEqual(stop.payload.targetContextCallIds.sort(), [mapped.id, call.callId].sort());
  assert.equal(driver.coordination.contextCall(call.callId).state, 'stopped');

  await deployment.close();
  deployment = null;
  const canonicalEvents = eventsAt(deploymentRoot);
  const tampered = structuredClone(canonicalEvents);
  tampered.find((event) => (
    event.kind === 'context.call_admitted' && event.payload.schemaVersion === 2
  )).payload.call.authority.requester.authorizationDigest = 'f'.repeat(64);
  writeFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
    `${tampered.map((event) => JSON.stringify(event)).join('\n')}\n`);
  const callsBeforeTamperReplay = tracker.calls.length;
  await assert.rejects(() => open(), (error) => error?.code === 'context_call_integrity');
  assert.equal(tracker.calls.length, callsBeforeTamperReplay,
    'generic admission tamper must fail replay before provider effects');
});

test('CC85-A2: generic map admission verifies every exact completed-cell output without dispatch', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-map-admission-'));
  const tracker = { calls: [] };
  let deployment; let driver;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBatonDeployment(options(repo, deploymentRoot, tracker), (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  const workflow = await deployment.workflow('Admit one generic Context map without dispatch.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const cell = driver.coordination.contextCell(parts.id);
  const session = driver.coordination.contextSession(cell.sessionId);
  const artifacts = driver.coordination.contextCellArtifacts(cell.cellId);
  const history = eventsAt(deploymentRoot);
  const definition = history.filter((event) => (
    event.kind === 'driver.recorded'
      && event.payload?.kind === 'application.workflow_definition_bound'
  )).at(-1).payload;
  const predecessorPlan = history
    .filter((event) => event.kind === 'plan.version_proposed').at(-1).payload.plan;
  const goal = history.filter((event) => event.kind === 'goal.version_defined').at(-1).payload.goal;
  const requester = { principalId: 'phase85-map-owner', sessionId: 'phase85-map-session' };
  const call = contextEffectCallIdentity({
    schemaVersion: 1, kind: 'baton.context_effect_call', operator: 'map',
    generation: 1, predecessorCall: null, inheritedChildren: [],
    authority: {
      contextPrincipal: structuredClone(session.authority), requester,
      sessionId: session.sessionId, manifestDigest: session.manifestDigest,
      treeSha: session.manifest.tree.sha, environmentDigest: session.environmentDigest,
      policyDigest: session.policyDigest, definitionDigest: definition.definitionDigest,
      roleCatalogDigest: definition.roleCatalog.catalogDigest,
      profileDigest: definition.profileDigest,
      predecessorPlan: {
        planId: predecessorPlan.planId, version: predecessorPlan.version,
        digest: predecessorPlan.digest,
      },
    },
    source: {
      kind: 'cell', id: cell.cellId, admissionDigest: cell.admissionDigest,
      settlementDigest: cell.settlementDigest,
      outputRef: structuredClone(cell.result.outputRef),
      evidenceRef: structuredClone(cell.result.evidenceRef),
      itemCount: artifacts.output.items.length,
      coordinateDigest: artifacts.evidence.coordinateDigest,
      outputLineageDigest: artifacts.evidence.outputLineageDigest,
    },
    role: 'critic', instruction: 'Review every exact immutable cell output.',
    units: artifacts.evidence.outputLineages.map((lineage) => ({
      index: lineage.index,
      inputs: [{
        index: lineage.index, itemDigest: lineage.itemDigest,
        lineageDigest: lineage.lineageDigest,
      }],
      coordinateDigest: lineage.coordinateDigest,
    })),
  });
  const catalogRole = definition.roleCatalog.roles.find((role) => role.role === call.role);
  const nodes = call.units.map((unit) => templateNode({
    call, unit, catalogRole, predecessorPlan,
  }));
  const planRequest = {
    goal: { goalId: goal.goalId, version: goal.version, digest: goal.digest },
    predecessor: {
      planId: predecessorPlan.planId, version: predecessorPlan.version,
      digest: predecessorPlan.digest,
    },
    nodes,
  };
  const policy = driver.coordination.goalPlanPolicy();
  const normalizedPlan = normalizePlanRequest(planRequest, policy, goal);
  const expectedPlanDigest = goalPlanDigest({
    schemaVersion: 1, repoId: session.authority.repoId, runId: session.authority.runId,
    goal: normalizedPlan.goal, predecessor: normalizedPlan.predecessor,
    nodes: normalizedPlan.nodes, totals: normalizedPlan.totals,
    policyDigest: policy.policyDigest,
  });
  const successorCore = {
    schemaVersion: 3, repoId: definition.repoId, runId: definition.runId,
    goalDigest: definition.goalDigest, planDigest: expectedPlanDigest,
    profileDigest: definition.profileDigest,
    workflowPolicy: structuredClone(definition.workflowPolicy),
    workflowPolicyDigest: definition.workflowPolicyDigest,
    strategy: definition.strategy, workspace: definition.workspace, join: definition.join,
    workItem: structuredClone(definition.workItem),
    roleCatalog: structuredClone(definition.roleCatalog),
    lineage: {
      generation: definition.lineage.generation + 1,
      rootDefinitionDigest: definition.lineage.rootDefinitionDigest ?? definition.definitionDigest,
      parentDefinitionDigest: definition.definitionDigest,
    },
    attempts: call.units.map((unit) => workflowAttempt(
      `${call.role}:${String(unit.index + 1).padStart(4, '0')}`,
      call.role, nodes[unit.index].key, definition.roleCatalog,
    )),
  };
  validateWorkflowDefinitionV3(successorCore, {
    nodes: normalizedPlan.nodes,
    ancestors: history.filter((event) => (
      event.kind === 'driver.recorded'
        && event.payload?.kind === 'application.workflow_definition_bound'
    )).map((event) => event.payload),
  });
  driver.coordination.recordDriver('application.workflow_definition_bound', {
    ...successorCore, definitionDigest: digest(successorCore),
  }, {
    actor: 'application:workflow-registry',
    key: `application.workflow_definition_bound:${session.authority.runId}:${expectedPlanDigest}`,
  });
  const auth = {
    ...structuredClone(session.authority),
    requesterPrincipalId: requester.principalId,
    requesterSessionId: requester.sessionId,
    key: `context.call:${call.callId}`,
  };
  const providerCallsBeforeAdmission = tracker.calls.length;
  const admitted = driver.coordination.admitContextEffectCall({
    call, planRequest, expectedPlanDigest,
  }, auth);
  assert.equal(admitted.result, 'admitted');
  assert.equal(admitted.call.operator, 'map');
  assert.equal(admitted.call.children.length, 0);
  assert.equal(tracker.calls.length, providerCallsBeforeAdmission);
  await assert.rejects(async () => driver.coordination.admitContextEffectCall({
    call, planRequest, expectedPlanDigest,
  }, { ...auth, requesterSessionId: 'substituted-session' }), (error) => (
    error?.code === 'context_call_unauthorized'
  ));
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_admitted' && event.payload.schemaVersion === 2
  )).length, 1);
  await workflow.stop('Stop the generic map admission fixture.');
  assert.equal(driver.coordination.contextCall(call.callId).state, 'stopped');
});
