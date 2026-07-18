import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationStore, Coordinator, MockAdapter, createDriver, openBaton,
} from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { goalPlanDigest } from '../src/goal-plan.mjs';

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
  mapDelayMs = 60_000, mapOutcome = 'completed', sourceDelayMs = 60_000,
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
      args[2] = {
        ...args[2],
        scenario: {
          outcome: mapOutcome,
          edits: [{ path: `reviews/context-map-${count}.md`, content: `map ${count}\n`, delayMs: mapDelayMs }],
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

test('CM84-W1: map prebinds Plan v2 with zero new provider calls, then approval launches one real parallel Wave and stop reaps it', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-deployment-'));
  const tracker = { calls: [] };
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton(options(repo, deploymentRoot, tracker));
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
  assert.equal(plans.length, 2);
  assert.ok(callEvent);
  assert.ok(callEvent.seq < plans[1].seq);
  assert.equal(plans[1].payload.plan.predecessor.digest, plans[0].payload.plan.digest);
  assert.equal(plans[1].payload.plan.nodes.length, output.items.length);
  assert.equal(plans[1].payload.plan.nodes.every((node) => (
    node.contextCall.callId === mapped.id
      && node.routes.harnesses[0] === routeA.harness
      && node.routes.models[0] === routeA.model
      && node.routes.efforts[0] === routeA.effort
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
  assert.equal(tracker.calls.slice(providerCallsBeforeMap).every((call, index) => (
    call.brief.contextInput?.partitionId
      === callEvent.payload.call.partitions[index].partitionId
      && call.brief.contextCall.partition.partitionId
        === callEvent.payload.call.partitions[index].partitionId
  )), true);
  const coordinationText = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  );
  assert.equal(coordinationText.includes('contextInput'), false,
    'physical partition bytes must not be copied into the coordination ledger');
  const launchedAt = tracker.calls.slice(providerCallsBeforeMap).map(({ at }) => at);
  assert.ok(Math.max(...launchedAt) - Math.min(...launchedAt) < 500,
    'map children must be launched as one overlapping Wave');

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
  call.payload.call.partitions[0].itemDigest = 'f'.repeat(64);
  writeFileSync(eventPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  const callsBeforeReplay = tracker.calls.length;
  await assert.rejects(() => openBaton(deploymentOptions), (error) => (
    error?.code === 'context_map_call_integrity'
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
  assert.deepEqual(output.items.map(({ index }) => index),
    Array.from({ length: partitionCount }, (_, index) => index));
  assert.equal(output.items.every((child) => (
    child.state === 'accepted' && child.route.harness === routeA.harness
      && child.route.model === routeA.model && child.route.effort === routeA.effort
      && /^[a-f0-9]{64}$/u.test(child.cleanupDigest)
  )), true);
  const evidence = await mapped.evidence();
  assert.equal(evidence.evidence.some((row) => row.kind === 'context_call_evidence'), true);
  assert.equal(evidence.evidence.some((row) => row.kind === 'context_call_cleanup'), true);
  const eventPath = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  let events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length, 1);
  const settlement = events.find((event) => event.kind === 'context.call_settled');
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
          target.partitionId === child.partitionId
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
    error?.code === 'context_map_call_settlement_integrity'
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
      harnesses: [routeA.harness, routeB.harness],
      models: [routeA.model, routeB.model],
      efforts: [routeA.effort, routeB.effort],
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
    error?.code === 'context_map_plan_integrity'
  ));
  assert.equal(tracker.calls.length, callsBeforeReplay,
    'forged Plan replay must fail before adapter/provider effects');
});

test('CM84-W6: failed children fail the call without aggregate output or settlement overclaim', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase84-context-map-child-failure-'));
  const tracker = { calls: [] };
  let driver;
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBatonDeployment(options(repo, deploymentRoot, tracker, {
    mapDelayMs: 20, mapOutcome: 'failed',
  }), (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  const workflow = await deployment.workflow('Fail Context aggregate when mapped children fail.', {
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
  await workflow.complete();

  const failed = await mapped.outline();
  assert.equal(failed.item.state, 'failed');
  assert.equal(Object.hasOwn(failed.item.value, 'output'), false);
  assert.equal((await workflow.context().outline()).state, 'failed');
  const failedCall = driver.coordination.contextCall(mapped.id);
  assert.throws(() => driver.coordination.settleContextMapCall({
    callId: mapped.id, expectedVersion: failedCall.version,
    result: { outputRef: null, evidenceRef: null },
  }, {
    actor: 'deployment:context', principalId: 'service-context',
    repoId: failedCall.source.repoId, runId: failedCall.source.runId,
    key: `context.call.settle:${failedCall.callId}:failed-child-test`,
  }), (error) => error?.code === 'context_map_child_failed');
  const evidence = await mapped.evidence();
  assert.equal(evidence.evidence.some((row) => row.kind === 'context_call_evidence'), false);
  const failure = evidence.evidence.find((row) => row.kind === 'context_call_failure');
  assert.ok(failure);
  assert.equal(Array.isArray(failure.value), true);
  assert.equal(failure.value.length, partitionCount,
    'failure evidence must attribute the complete mapped partition set');
  assert.deepEqual(
    failure.value.map((child) => child.partitionId),
    failedCall.partitions.map((partition) => partition.partitionId),
  );
  assert.equal(failure.value.every((child) => (
    child.state === 'failed' && child.route.harness === routeA.harness
      && child.route.model === routeA.model && child.route.effort === routeA.effort
  )), true);
  const failedDescendants = failedCall.children.map((child) => ({
    partitionId: child.partitionId,
    taskId: child.taskId,
    workerId: child.workerId,
  }));
  assert.equal(failedDescendants.length, partitionCount);
  assert.equal(new Set(failedDescendants.map((child) => child.taskId)).size, partitionCount);
  assert.equal(new Set(failedDescendants.map((child) => child.workerId)).size, partitionCount);
  assert.equal(failedDescendants.every((child) => {
    const task = driver.coordination.task(child.taskId);
    return task?.runId === failedCall.source.runId
      && task.assignee === child.workerId
      && task.status === 'failed';
  }), true, 'every failed partition must retain its exact task/worker/Run identity before reap');
  const events = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length, 0);
  const stopped = await workflow.stop('Reap failed Context map children.');
  assert.equal(stopped.outline.phase, 'stopped');
  assert.equal(stopped.outline.resources.ownedCount, 0);
  assert.equal(stopped.outline.context.lastCall.state, 'stopped');

  const stoppedCall = driver.coordination.contextCall(mapped.id);
  assert.equal(stoppedCall.state, 'stopped');
  assert.deepEqual(stoppedCall.children.map((child) => ({
    partitionId: child.partitionId,
    taskId: child.taskId,
    workerId: child.workerId,
  })), failedDescendants, 'stop must preserve the exact failed-descendant identity history');

  const stoppedEvents = readFileSync(
    join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8',
  ).trim().split('\n').map((line) => JSON.parse(line));
  const stopAdmission = stoppedEvents.findLast((event) => event.kind === 'run.stop_admitted');
  const stopCompletion = stoppedEvents.findLast((event) => event.kind === 'run.stop_completed');
  assert.ok(stopAdmission);
  assert.ok(stopCompletion);
  assert.equal(stopAdmission.payload.schemaVersion, 3);
  assert.deepEqual(stopAdmission.payload.targetContextCallIds, [mapped.id]);
  assert.equal(failedDescendants.every((child) => (
    stopAdmission.payload.targetTaskIds.includes(child.taskId)
      && stopAdmission.payload.targetWorkerIds.includes(child.workerId)
  )), true, 'the durable Run-stop target snapshot must include every failed map descendant');

  const receipt = stopCompletion.payload.receipt;
  assert.equal(receipt.targetDigest, stopAdmission.payload.targetDigest);
  assert.equal(receipt.targetCount, stopAdmission.payload.targetWorkerIds.length);
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
  assert.equal(stopAdmission.payload.targetWorkerIds.every((workerId) => {
    const handle = stoppedHandles.get(workerId);
    return driver.coordinator.localResourceOwnership(workerId)?.owned === false
      && handle?.worktree === null
      && handle?.runtimeScope?.active !== true
      && (!handle?.processRef || handle.processRef.state === 'closed')
      && !handle?.pendingApprovalId
      && !handle?.pendingQuestionId;
  }), true, 'every exact Run-stop target must have zero remaining local resource authority');
  assert.equal(failedDescendants.every((child) => {
    const handle = stoppedHandles.get(child.workerId);
    const task = driver.coordination.task(child.taskId);
    return handle?.taskId === child.taskId
      && handle.runId === failedCall.source.runId
      && task?.runId === failedCall.source.runId
      && task.assignee === child.workerId
      && task.status === 'failed';
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

  const originalSettle = CoordinationStore.prototype.settleContextMapCall;
  let interrupted = false;
  let interruptedFields = null;
  CoordinationStore.prototype.settleContextMapCall = function interruptAfterCleanup(fields, auth) {
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
    CoordinationStore.prototype.settleContextMapCall = originalSettle;
  }
  const eventPath = join(deploymentRoot, 'state', 'coordination', 'events.jsonl');
  let events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length, 0);
  const call = driver.coordination.contextCall(mapped.id);
  assert.equal(call.state, 'settlement_ready');
  assert.ok(interruptedFields, 'the injected gap must retain the exact attempted settlement');
  const expectedPartitions = structuredClone(call.partitions);
  const expectedChildren = driver.coordination.contextCallSettlementChildren(
    mapped.id, interruptedFields.cleanup,
  );
  const expectedBindings = call.children.map((child) => ({
    partitionId: child.partitionId, partitionDigest: child.partitionDigest,
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
  assert.deepEqual(recoveredCall.partitions, expectedPartitions,
    'recovery must preserve the admitted partition order and immutable source identities');
  assert.deepEqual(recoveredCall.result.children, expectedChildren,
    'recovery must settle the exact retained results and selected dispatch routes');
  assert.equal(recoveredCall.result.childDigest, canonicalDigest(expectedChildren));
  for (const binding of expectedBindings) {
    const recoveredChild = recoveredCall.children.find((child) => (
      child.partitionId === binding.partitionId
    ));
    assert.deepEqual({
      partitionId: recoveredChild?.partitionId,
      partitionDigest: recoveredChild?.partitionDigest,
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
    }, binding, 'recovery must preserve each exact partition/task/worker/Run/release binding');
    assert.equal(driver.coordinator.localResourceOwnership(binding.workerId)?.owned, false,
      'recovered descendants must remain reaped');
  }
  events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length, 1);
  const settlement = events.find((event) => event.kind === 'context.call_settled');
  assert.deepEqual(settlement.payload.authority, call.authority,
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
    partitionId: target.partitionId, taskId: target.taskId, workerId: target.workerId,
    releaseDigest: target.releaseDigest,
  })), expectedBindings.map((binding) => ({
    partitionId: binding.partitionId, taskId: binding.taskId, workerId: binding.workerId,
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
  events = readFileSync(eventPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.kind === 'context.call_settled').length,
    settlementCountBeforeSecondRestart,
    'a second recovery must not repeat Context settlement');
  assert.equal(events.filter((event) => event.kind === 'task.resources_released').length,
    releaseCountBeforeSecondRestart,
    'a second recovery must not repeat descendant cleanup receipts');
  await secondReplay.stop('Close recovered Context cleanup fixture.');
});
