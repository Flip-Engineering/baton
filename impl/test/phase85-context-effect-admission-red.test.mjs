import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationStore, MockAdapter, contextEffectCallIdentity, contextEffectNodeBinding,
  createDriver,
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
    const failNext = tracker.failNext === true;
    if (failNext) tracker.failNext = false;
    tracker.calls.push({
      harness: route.harness, model: args[2]?.model, effort: args[2]?.reasoningEffort,
      brief: structuredClone(args[1]),
    });
    args[2] = {
      ...args[2],
      scenario: failNext ? {
        outcome: 'failed', summary: 'generic reduce provider failed', delayMs: 20, edits: [],
      } : {
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

test('CC85-A1: generic reduce shares one store, recovers its Plan, dispatches once, and stops exactly', async (t) => {
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
  assert.throws(() => driver.coordination.settleContextEffectCall({
    callId: `context-call:${'f'.repeat(64)}`,
  }, {}), (error) => error?.code === 'context_call_not_found');
  assert.throws(() => driver.coordination.settleContextMapCall({
    callId: mapped.id,
  }, {}), (error) => error?.code === 'context_map_call_not_found');
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
  const session = driver.coordination.contextSession(
    parent.kind === 'baton.context_effect_call'
      ? parent.authority.sessionId : parent.source.sessionId,
  );
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
      && event.payload.call.callId === call.callId
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
      && event.payload.call.callId === call.callId
  )).length, 1);

  const beforeRestart = eventsAt(deploymentRoot);
  const plansBeforeRestart = beforeRestart.filter((event) => event.kind === 'plan.version_proposed').length;
  const callsBeforeRestart = beforeRestart.filter((event) => event.kind === 'context.call_admitted').length;
  await deployment.close();
  deployment = await open();
  const afterRestart = eventsAt(deploymentRoot);
  assert.equal(afterRestart.filter((event) => event.kind === 'plan.version_proposed').length,
    plansBeforeRestart + 1,
    'restart must recover the exact admitted generic successor Plan');
  assert.equal(afterRestart.filter((event) => event.kind === 'context.call_admitted').length,
    callsBeforeRestart);
  assert.equal(tracker.calls.length, providerCallsBeforeAdmission,
    'restart must neither dispatch nor repeat provider work for generic admission');
  const replayed = driver.coordination.contextCall(call.callId);
  assert.equal(replayed.callDigest, call.callDigest);
  assert.equal(replayed.state, 'awaiting_plan_approval');
  assert.deepEqual(replayed.authority, call.authority,
    'replay must preserve rich call authority rather than overwrite it with the event principal');
  assert.deepEqual(replayed.admissionAuthority, session.authority);

  const replay = deployment.open(workflow.id);
  await replay.approve();
  assert.equal(tracker.calls.length, providerCallsBeforeAdmission + 1,
    'generic approval must dispatch exactly one reduce unit');
  const reduceBrief = tracker.calls.at(-1).brief;
  assert.equal(reduceBrief.contextCall.callId, call.callId);
  assert.equal(reduceBrief.contextInput.kind, 'baton.context_reduction');
  assert.equal(reduceBrief.contextInput.inputs.length, source.itemCount);
  assert.equal(reduceBrief.contextInput.inputs.every((input) => (
    input.resultRef?.kind === 'baton.context_provider_result_ref'
      && input.capsule?.kind === 'baton.context_provider_result'
      && input.source !== undefined
  )), true, 'reduce Brief must carry reverified private source content, not opaque refs alone');
  await deployment.close();
  deployment = await open();
  assert.equal(tracker.calls.length, providerCallsBeforeAdmission + 1,
    'restart must not repeat an already-dispatched generic unit');
  const reopened = deployment.open(workflow.id);
  await reopened.stop('Stop the Run with both historical and generic Context calls.');
  const stoppedEvents = eventsAt(deploymentRoot);
  const stop = stoppedEvents.filter((event) => event.kind === 'run.stop_admitted').at(-1);
  assert.equal(stop.payload.schemaVersion, 3);
  assert.deepEqual(stop.payload.targetContextCallIds.sort(), [mapped.id, call.callId].sort());
  assert.equal(driver.coordination.contextCall(call.callId).state, 'failed');
  const stoppedGenericArtifacts = driver.coordination.contextCallArtifacts(call.callId);
  assert.equal(stoppedGenericArtifacts.output, null);
  assert.equal(stoppedGenericArtifacts.evidence.schemaVersion, 4);
  assert.equal(stoppedGenericArtifacts.evidence.state, 'failed');
  assert.equal(stoppedGenericArtifacts.evidence.cleanup.remainingCount, 0);

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
  const open = async () => openBatonDeployment(options(repo, deploymentRoot, tracker), (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await open();
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
  const stop = eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'run.stop_admitted'
  )).at(-1);
  assert.deepEqual(stop.payload.targetContextCallIds, [call.callId],
    'a plan-pending generic call must be in the exact Run stop snapshot');
  assert.equal(driver.coordination.contextCall(call.callId).state, 'stopped');
  await deployment.close();
  deployment = await open();
  assert.equal(driver.coordination.contextCall(call.callId).state, 'stopped',
    'a canonical stop over a plan-pending generic call must replay');
  await deployment.close();
  deployment = null;
  const incomplete = eventsAt(deploymentRoot);
  const incompleteStop = incomplete.find((event) => event.kind === 'run.stop_admitted');
  incompleteStop.payload.targetContextCallIds = [];
  incompleteStop.payload.targetDigest = digest({
    throughSeq: incompleteStop.payload.throughSeq,
    targetRunIds: incompleteStop.payload.targetRunIds,
    targetTaskIds: incompleteStop.payload.targetTaskIds,
    targetWorkerIds: incompleteStop.payload.targetWorkerIds,
    targetContextSessionIds: incompleteStop.payload.targetContextSessionIds,
    targetContextCellIds: incompleteStop.payload.targetContextCellIds,
    targetContextCallIds: incompleteStop.payload.targetContextCallIds,
  });
  writeFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
    `${incomplete.map((event) => JSON.stringify(event)).join('\n')}\n`);
  await assert.rejects(() => open(), (error) => error?.code === 'run_stop_integrity',
    'a structurally re-digested stop that omits the generic call must fail semantic replay');
});

test('CC85-A3: public reduce proposes, approves, dispatches once, and survives reopen', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-reduce-'));
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
  const workflow = await deployment.workflow('Exercise public Context reduction.', {
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
    role: 'critic', instruction: 'Produce one exact retained result per partition.',
  });
  await workflow.approve();
  await mapped.complete();
  assert.equal((await mapped.outline()).item.state, 'completed');

  const callsBeforeReduce = tracker.calls.length;
  const reduced = await workflow.context().reduce(mapped, {
    role: 'critic', instruction: 'Synthesize the verified private findings into one result.',
  });
  const proposed = await reduced.outline();
  assert.equal(proposed.item.state, 'awaiting_plan_approval');
  assert.equal(proposed.item.value.operation, 'reduce');
  assert.equal(tracker.calls.length, callsBeforeReduce,
    'public reduce proposal must not cross the provider edge');
  const genericAdmission = eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_admitted' && event.payload.schemaVersion === 2
  )).at(-1);
  const successorPlan = eventsAt(deploymentRoot)
    .filter((event) => event.kind === 'plan.version_proposed').at(-1);
  assert.equal(genericAdmission.payload.call.callId, reduced.id);
  assert.ok(genericAdmission.seq < successorPlan.seq);

  await workflow.approve();
  assert.equal(tracker.calls.length, callsBeforeReduce + 1);
  const dispatched = tracker.calls.at(-1);
  assert.deepEqual({
    harness: dispatched.harness, model: dispatched.model, effort: dispatched.effort,
  }, routeA);
  assert.equal(dispatched.brief.contextInput.kind, 'baton.context_reduction');
  assert.equal(dispatched.brief.contextInput.inputs.every((input) => (
    input.source !== undefined && input.capsule?.result?.retainedResultRef
  )), true);

  assert.equal((await reduced.complete()).item.state, 'completed');
  let settled = driver.coordination.contextCall(reduced.id);
  assert.equal(settled.state, 'completed', JSON.stringify({
    children: settled.children, result: settled.result,
  }));
  await deployment.close();
  deployment = await open();
  assert.equal(tracker.calls.length, callsBeforeReduce + 1,
    'reopen must not repeat the reduce dispatch');
  assert.equal(driver.coordination.contextCall(reduced.id).children.length, 1);
  const reopened = deployment.open(workflow.id);
  settled = driver.coordination.contextCall(reduced.id);
  assert.equal(settled.state, 'completed');
  const artifacts = driver.coordination.contextCallArtifacts(reduced.id);
  assert.equal(artifacts.evidence.schemaVersion, 4);
  assert.equal(artifacts.evidence.call.callId, reduced.id);
  assert.equal(artifacts.output.items.length, 1);
  assert.equal(artifacts.output.sourceItems, settled.source.itemCount);
  assert.equal(artifacts.evidence.outputLineages.length, 1);
  assert.equal(artifacts.evidence.outputLineages[0].parents.length,
    settled.source.itemCount);
  assert.equal(artifacts.evidence.outputLineages[0].derivations.length, 1);
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_settled' && event.payload.schemaVersion === 2
      && event.payload.callId === reduced.id
  )).length, 1);
  await assert.rejects(async () => reopened.context().reduce(reduced, {
    role: 'critic', instruction: 'Attempt an out-of-contract second reduction.',
  }), (error) => /context_reduce is unavailable/u.test(error?.message ?? ''));
  await reopened.stop('Reap the completed public reduce workflow.');

  await deployment.close();
  deployment = null;
  const canonicalEvents = eventsAt(deploymentRoot);
  const tampered = structuredClone(canonicalEvents);
  tampered.find((event) => (
    event.kind === 'context.call_settled' && event.payload.schemaVersion === 2
      && event.payload.callId === reduced.id
  )).payload.result.children[0].unitDigest = 'f'.repeat(64);
  writeFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
    `${tampered.map((event) => JSON.stringify(event)).join('\n')}\n`);
  await assert.rejects(open, (error) => error?.code === 'context_call_settlement_integrity');
});

test('CC85-A4: a provider-failed reduce settles once with exact cleanup and replays terminally', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-failure-'));
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
  const workflow = await deployment.workflow('Prove generic Context provider failure.', {
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
    role: 'critic', instruction: 'Produce retained inputs for a failing reducer.',
  });
  await workflow.approve();
  await mapped.complete();
  assert.equal((await mapped.outline()).item.state, 'completed');

  const reduced = await workflow.context().reduce(mapped, {
    role: 'critic', instruction: 'Fail as a provider after exact dispatch.',
  });
  tracker.failNext = true;
  await workflow.approve();
  const providerCalls = tracker.calls.length;
  assert.equal((await reduced.complete()).item.state, 'failed');
  const failed = driver.coordination.contextCall(reduced.id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.result.outputRef, null);
  assert.equal(failed.result.cleanup.schemaVersion, 2);
  assert.equal(failed.result.cleanup.remainingCount, 0);
  assert.equal(failed.result.children.length, 1);
  assert.equal(failed.result.children[0].state, 'failed');
  assert.equal(failed.result.children[0].termination.code, 'provider_turn_failed');
  assert.deepEqual(failed.result.termination, {
    code: 'context_child_failed', retryable: true,
    summary: 'One or more Context reduce children failed before acceptance.',
  });
  const artifacts = driver.coordination.contextCallArtifacts(reduced.id);
  assert.equal(artifacts.output, null);
  assert.equal(artifacts.evidence.schemaVersion, 4);
  assert.equal(artifacts.evidence.call.callId, reduced.id);
  assert.equal(artifacts.evidence.state, 'failed');
  assert.equal(artifacts.evidence.outputRef, null);
  const settlementCount = eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_settled' && event.payload.schemaVersion === 2
      && event.payload.callId === reduced.id
  )).length;
  assert.equal(settlementCount, 1);

  await deployment.close();
  deployment = await open();
  assert.equal(tracker.calls.length, providerCalls,
    'failed generic settlement replay must not repeat provider work');
  assert.equal(driver.coordination.contextCall(reduced.id).state, 'failed');
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_settled' && event.payload.callId === reduced.id
  )).length, settlementCount);
  await deployment.open(workflow.id).stop('Reap the terminal generic failure history.');
});

test('CC85-A5: restart after generic cleanup but before settlement attaches without another effect', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-recovery-'));
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
  const workflow = await deployment.workflow('Recover generic Context settlement.', {
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
    role: 'critic', instruction: 'Produce exact inputs for recovery.',
  });
  await workflow.approve();
  await mapped.complete();
  const reduced = await workflow.context().reduce(mapped, {
    role: 'critic', instruction: 'Recover my settlement without re-execution.',
  });
  await workflow.approve();

  const originalSettle = CoordinationStore.prototype.settleContextEffectCall;
  let interruptedFields = null;
  CoordinationStore.prototype.settleContextEffectCall = function interrupt(fields, auth) {
    if (interruptedFields === null && fields?.callId === reduced.id) {
      interruptedFields = structuredClone(fields);
      throw Object.assign(new Error('injected generic cleanup gap'), {
        code: 'injected_context_effect_cleanup_gap',
      });
    }
    return originalSettle.call(this, fields, auth);
  };
  try {
    await assert.rejects(reduced.complete(), (error) => (
      error?.code === 'injected_context_effect_cleanup_gap'
    ));
  } finally {
    CoordinationStore.prototype.settleContextEffectCall = originalSettle;
  }
  assert.ok(interruptedFields);
  assert.equal(interruptedFields.cleanup.schemaVersion, 2);
  assert.equal(interruptedFields.cleanup.remainingCount, 0);
  assert.equal(driver.coordination.contextCall(reduced.id).state, 'settlement_ready');
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_settled' && event.payload.callId === reduced.id
  )).length, 0);
  const providerCalls = tracker.calls.length;

  await deployment.close();
  deployment = await open();
  assert.equal(tracker.calls.length, providerCalls,
    'generic settlement-ready recovery must not repeat provider work');
  const recovered = await deployment.open(workflow.id).context().call(reduced.id).outline();
  assert.equal(recovered.item.state, 'completed');
  assert.equal(tracker.calls.length, providerCalls);
  const call = driver.coordination.contextCall(reduced.id);
  assert.equal(call.state, 'completed');
  assert.deepEqual(call.result.cleanup, interruptedFields.cleanup);
  assert.equal(driver.coordination.contextCallArtifacts(reduced.id).evidence.schemaVersion, 4);
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_settled' && event.payload.schemaVersion === 2
      && event.payload.callId === reduced.id
  )).length, 1);
  await deployment.open(workflow.id).stop('Reap recovered generic settlement history.');
});

test('CC85-A6: failed generic map retries only failed units and reuses accepted siblings', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-retry-'));
  const tracker = { calls: [] };
  const providerReferenceReads = [];
  const deploymentOptions = options(repo, deploymentRoot, tracker);
  let deployment; let driver;
  const open = async () => openBatonDeployment(deploymentOptions, (driverOptions) => {
    const referenceRead = driverOptions.contextProgram.referenceRead;
    driver = createDriver({
      ...driverOptions,
      contextProgram: {
        ...driverOptions.contextProgram,
        referenceRead(reference) {
          if (reference?.kind === 'context_provider_result') {
            providerReferenceReads.push(reference.digest);
          }
          return referenceRead(reference);
        },
      },
    });
    return driver;
  });
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });

  deployment = await open();
  const workflow = await deployment.workflow('Retry only failed Context map work.', {
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
    role: 'critic', instruction: 'Produce one exact retained result per immutable unit.',
  });
  tracker.failNext = true;
  await workflow.approve();
  const failedView = await mapped.complete();
  assert.equal(failedView.item.state, 'failed');
  const failedCall = driver.coordination.contextCall(mapped.id);
  const eligibility = driver.coordination.contextRetryEligibility(mapped.id);
  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.retryUnitIds.length, 1);
  assert.equal(eligibility.inheritedChildren.length, failedCall.units.length - 1);

  const callsBeforeRetry = tracker.calls.length;
  const retry = await mapped.retry();
  const retryPending = driver.coordination.contextCall(retry.id);
  assert.equal(retryPending.generation, 2);
  assert.equal(retryPending.requestId, failedCall.requestId);
  assert.notEqual(retryPending.callId, failedCall.callId);
  assert.deepEqual(retryPending.executionUnitIds, eligibility.retryUnitIds);
  assert.deepEqual(retryPending.inheritedChildren, eligibility.inheritedChildren);
  assert.equal(retryPending.planRequest.nodes.length, 1);
  assert.equal(tracker.calls.length, callsBeforeRetry,
    'retry admission and Plan proposal must not cross the provider edge');

  tracker.failNext = true;
  await workflow.approve();
  assert.equal(tracker.calls.length, callsBeforeRetry + 1,
    'only the failed logical unit may be dispatched again');
  assert.equal((await retry.complete()).item.state, 'failed');
  const secondGeneration = driver.coordination.contextCall(retry.id);
  assert.equal(secondGeneration.result.providerEffects, 1);
  assert.equal(secondGeneration.result.children.length, failedCall.units.length);
  assert.equal(secondGeneration.result.children.filter((child) => (
    child.origin === 'inherited'
  )).length, failedCall.units.length - 1);
  assert.equal(secondGeneration.result.cleanup.targetCount, 1);
  assert.equal(secondGeneration.result.providerResults.length, failedCall.units.length - 1);

  const secondEligibility = driver.coordination.contextRetryEligibility(retry.id);
  assert.equal(secondEligibility.eligible, true);
  assert.equal(secondEligibility.retryUnitIds.length, 1);
  const callsBeforeThirdGeneration = tracker.calls.length;
  const third = await retry.retry();
  const thirdPending = driver.coordination.contextCall(third.id);
  assert.equal(thirdPending.generation, 3);
  assert.equal(thirdPending.requestId, failedCall.requestId);
  assert.equal(thirdPending.predecessorCall.callId, retry.id);
  assert.deepEqual(thirdPending.executionUnitIds, secondEligibility.retryUnitIds);
  assert.deepEqual(thirdPending.inheritedChildren, secondEligibility.inheritedChildren);
  assert.equal(thirdPending.planRequest.nodes.length, 1);
  assert.equal(tracker.calls.length, callsBeforeThirdGeneration);
  await workflow.approve();
  assert.equal(tracker.calls.length, callsBeforeThirdGeneration + 1);
  assert.equal((await third.complete()).item.state, 'completed');
  const settled = driver.coordination.contextCall(third.id);
  assert.equal(settled.result.providerEffects, 1);
  assert.equal(settled.result.children.length, failedCall.units.length);
  assert.equal(settled.result.children.filter((child) => child.origin === 'inherited').length,
    failedCall.units.length - 1);
  assert.equal(settled.result.cleanup.targetCount, 1);
  assert.equal(settled.result.providerResults.length, failedCall.units.length);
  const content = driver.coordination.contextCallContents(third.id);
  assert.equal(content.kind, 'baton.context_call_content');
  assert.equal(content.callId, third.id);
  assert.equal(content.resultCount, failedCall.units.length);
  assert.equal(content.results.every((result) => (
    result.source.length > 0
      && result.source.every((item) => typeof item.text === 'string' && item.text.length > 0)
  )), true, 'verified Context content must expand every retained result source');
  for (const child of settled.result.children.filter((entry) => entry.origin === 'inherited')) {
    const inherited = settled.result.providerResults.find((entry) => entry.unitId === child.unitId);
    const original = failedCall.result.providerResults.find((entry) => entry.unitId === child.unitId);
    assert.deepEqual(inherited, original, 'inherited provider-result refs must be reused exactly');
  }
  assert.equal(driver.coordination.contextRetryEligibility(mapped.id).code,
    'context_retry_fork');
  assert.equal(driver.coordination.contextRetryEligibility(retry.id).code,
    'context_retry_fork');

  providerReferenceReads.length = 0;
  const reduced = await workflow.context().reduce(third, {
    role: 'critic', instruction: 'Synthesize the exact selective-retry result set once.',
  });
  assert.equal(driver.coordination.contextCall(reduced.id).state, 'awaiting_plan_approval');
  const providerReferenceReadCounts = Object.fromEntries(
    [...new Set(providerReferenceReads)].map((digest) => [
      digest, providerReferenceReads.filter((value) => value === digest).length,
    ]),
  );
  assert.equal(providerReferenceReads.length, settled.result.providerResults.length,
    `reduce proposal must reverify each unique provider result once without recursive rereads: ${JSON.stringify(providerReferenceReadCounts)}`);
  assert.equal(new Set(providerReferenceReads).size, settled.result.providerResults.length);

  const providerCalls = tracker.calls.length;
  await deployment.close();
  writeFileSync(join(repo, 'recovery-drift.txt'),
    'force a new dirty-tree deployment snapshot before selective-retry replay\n');
  deployment = await open();
  assert.equal(tracker.calls.length, providerCalls,
    'retry settlement replay must not repeat inherited or executed work');
  assert.equal(driver.coordination.contextCall(retry.id).state, 'failed');
  assert.equal(driver.coordination.contextCall(third.id).state, 'completed');
  await deployment.open(workflow.id).stop('Close selective Context retry history.');
});
