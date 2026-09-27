import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { BatonApplication, createDriver } from '../src/index.mjs';
import {
  DEFAULT_CONTEXT_PROGRAM_POLICY, DurableContextSession, StatelessContextBench, contextValueDigest,
  normalizeContextManifest, normalizeContextProgram, normalizeContextProgramPolicy,
} from '../src/context-program.mjs';

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256')
  .update(JSON.stringify(canonical(value))).digest('hex');
const gitBlobOid = (text) => {
  const bytes = Buffer.from(text);
  return createHash('sha1').update(Buffer.from(`blob ${bytes.byteLength}\0`))
    .update(bytes).digest('hex');
};
const repoId = 'repo-phase82-context';
const runId = 'run-phase82-context';
const treeSha = '1'.repeat(40);
const environmentDigest = '4'.repeat(64);
const referenceIdentity = '9'.repeat(64);
const route = Object.freeze({ vendor: 'stub', model: 'stub-model', effort: 'high' });
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId, mandatory: true, approvalTtlMs: 3_600_000,
  riskClasses: ['low'], effectClasses: ['provider_call'], capabilityClasses: ['analysis'],
  limits: Object.freeze({
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 8,
    maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 16,
    maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 1_000, maxProviderTurns: 1_000,
  }),
});
const verification = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'],
  expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000,
  maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [],
});
const auth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId, repoId, runId, key,
  sessionDigest: digest(`session:${principalId}`),
});
const ref = (kind, value) => ({
  [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest,
});

function fixture(t, name) {
  const root = mkdtempSync(join(tmpdir(), `baton-phase82-context-${name}-`));
  const artifactRoot = join(root, 'artifacts');
  const source = [
    ['impl/src/context-program.mjs', 'durable context cell authority'],
    ['impl/src/coordination-store.mjs', 'append only replay authority'],
  ].map(([path, text]) => ({
    path, chunk: 0, gitBlobOid: gitBlobOid(text), byteStart: 0,
    byteEnd: Buffer.byteLength(text), contentDigest: contextValueDigest(text),
    language: 'mjs', text,
  }));
  const sourceDigest = contextValueDigest(source);
  const sourceRef = `ctx:sha256:${sourceDigest}`;
  const bench = new StatelessContextBench({
    artifactRoot, sources: { [sourceRef]: source }, environmentDigest,
    policy: DEFAULT_CONTEXT_PROGRAM_POLICY,
  });
  const storeOptions = {
    repoId, deploymentBaseSha: treeSha, goalPlanPolicy,
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: environmentDigest,
    contextReferenceIdentity: referenceIdentity,
    contextReferenceRead: (reference) => bench.readReference(reference),
    contextSourceAttest: ({ manifest, branch, source: admittedSource }) => {
      const proofCoordinates = admittedSource.map((item) => ({
        path: item.path, chunk: item.chunk, gitBlobOid: item.gitBlobOid,
        byteStart: item.byteStart, byteEnd: item.byteEnd, contentDigest: item.contentDigest,
      }));
      const core = {
        schemaVersion: 1, kind: 'baton.context_source_attestation',
        producerIdentity: referenceIdentity, treeSha: manifest.tree.sha,
        nodeDigest: manifest.workflow.node.digest,
        scopeDigest: contextValueDigest(['impl/**']), branch: branch.name,
        sourceRef: branch.ref, sourceDigest: branch.digest, itemCount: branch.itemCount,
        proofDigest: contextValueDigest(proofCoordinates),
        coverage: {
          listedEntries: admittedSource.length, outsideScopeEntries: 0,
          scopedEntries: admittedSource.length, includedFiles: admittedSource.length,
          includedItems: admittedSource.length, excludedSensitivePaths: 0,
          excludedUnsupportedTypes: 0, excludedBinaryOrInvalidText: 0,
          excludedOversizeFiles: 0, excludedSensitiveContent: 0, complete: true,
        },
      };
      return { ...core, receiptDigest: contextValueDigest(core) };
    },
    clock: () => '2026-07-18T20:00:00.000Z',
  };
  const store = new CoordinationStore(join(root, 'coordination'), storeOptions);
  const goal = store.defineGoal({
    objective: 'Analyze addressed context with durable evidence',
    definitionOfDone: ['One pure cell is durably replayable'],
    constraints: ['No provider effect'], risk: 'low',
    budget: { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 2 },
    predecessor: null,
  }, auth('goal-owner', `${name}:goal`)).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal), predecessor: null,
    nodes: [{
      key: 'attempt:root', objective: 'Run the addressed pure Context Program',
      definitionOfDone: goal.definitionOfDone, deps: [], pathScope: ['impl/**'], risk: 'low',
      budget: { tokens: 10_000, usd: 1, wallMin: 10, providerTurns: 2 }, verification,
      routes: { harnesses: [route.vendor], models: [route.model], efforts: [route.effort] },
      capabilities: ['analysis'], effects: ['provider_call'],
    }],
  }, auth('planner', `${name}:plan`)).plan;
  store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null,
    disposition: 'approved',
  }, auth('approver', `${name}:approve`));
  const node = plan.nodes[0];
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: node.key, expectedDispatchVersion: 0,
    capabilities: node.capabilities, effects: node.effects,
  };
  const preview = store.previewPlanDispatch(gate, route);
  const taskId = `task-${name}`;
  store.createPlanGatedTask({
    id: taskId, brief: preview.brief, deps: [], refines: null, runId,
    taskType: 'general', reservedWorkerId: `worker-${name}`, vendorRequested: route.vendor,
    modelRequested: route.model, modelPolicy: null, effortRequested: route.effort,
    effortResolved: null, effortObserved: null, routeKey: null, sessionRequest: { mode: 'new' },
  }, gate, route, auth('dispatcher', `${name}:dispatch`));
  store.claimTask(taskId, `worker-${name}`, 1,
    { actor: 'orchestrator', key: `${name}:claim` }, {
      harnessRequested: route.vendor, harnessResolved: 'stub@1', modelRequested: route.model,
      modelResolved: route.model, modelObserved: route.model, effortRequested: route.effort,
      effortResolved: route.effort, effortObserved: route.effort, routeKey: 'route:stub',
    });
  const task = store.task(taskId);
  const definitionCore = {
    schemaVersion: 1, repoId, runId, goalDigest: goal.digest, planDigest: plan.digest,
  };
  const definitionDigest = digest(definitionCore);
  store.recordDriver('application.workflow_definition_bound', {
    ...definitionCore, definitionDigest,
  }, {
    actor: 'application:workflow-registry',
    key: `application.workflow_definition_bound:${runId}:${plan.digest}`,
  });
  const manifest = normalizeContextManifest({
    schemaVersion: 1, kind: 'baton.context_manifest', repoId,
    tree: { sha: treeSha, source: 'deployment_snapshot' },
    workflow: {
      runId, definitionDigest, goal: ref('goal', goal), plan: ref('plan', plan),
      node: { key: node.key, digest: contextValueDigest(node) },
      task: {
        taskId, version: task.version, createdEvent: task.createdEvent,
        claimedEvent: task.claimedEvent,
      },
    },
    branches: [{
      name: 'repository', ref: sourceRef, summary: 'two addressed implementation symbols',
      digest: sourceDigest, mediaType: 'application/json', itemCount: source.length,
    }],
    policyDigest: DEFAULT_CONTEXT_PROGRAM_POLICY.policyDigest,
  });
  const program = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: {
      op: 'search', input: { op: 'source', branch: 'repository' },
      query: 'authority', mode: 'case_insensitive',
    },
  });
  const cleanup = () => {
    store.releaseWriterLease();
    rmSync(root, { recursive: true, force: true });
  };
  t.after(cleanup);
  return {
    root, artifactRoot, store, storeOptions, bench, manifest, program, goal, plan, task, cleanup,
  };
}

function admitSession(f, name) {
  return f.store.admitContextSession({
    manifest: f.manifest, environmentDigest: f.bench.environmentDigest,
  }, auth('context-root', `context.session:${f.manifest.digest}`));
}

function admitCell(f, session, name, program = f.program) {
  return f.store.admitContextCell({ sessionId: session.session.sessionId, program },
    auth('context-root', `context.cell:${session.session.sessionId}:${program.programDigest}`));
}

function completion(result) {
  return {
    state: 'completed', providerEffects: result.providerEffects,
    outputRef: result.outputRef, evidenceRef: result.evidenceRef,
    sourceCoordinateCount: result.sourceCoordinateCount,
    coordinateDigest: result.coordinateDigest,
  };
}

function stopRun(store, label) {
  const reasonDigest = digest(`stop:${label}`);
  return store.admitRunStop({
    schemaVersion: 1, repoId, runId, reasonDigest,
    requestDigest: digest({ repoId, runId, reasonDigest }),
  }, { actor: 'direct:operator', key: `run.stop:${runId}` });
}

function stopReceipt(stop) {
  const targetCount = stop.targetWorkerIds.length;
  const core = {
    schemaVersion: stop.schemaVersion,
    state: 'stopped', scope: stop.scope ?? 'run', repoId: stop.repoId, runId: stop.runId,
    targetCount, remainingCount: 0, targetDigest: stop.targetDigest,
    counts: {
      pendingCancelled: targetCount, killConfirmed: 0, alreadyTerminal: 0,
      processesObserved: 0, processesClosed: 0,
    },
    checks: { dispatchClosed: true, interactionsResolved: true, runAuthorityReleased: true },
    effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false },
    ...(stop.schemaVersion === 2 ? {
      context: {
        targetSessionCount: stop.targetContextSessionIds.length,
        targetCellCount: stop.targetContextCellIds.length,
        remainingSessionCount: 0,
        remainingCellCount: 0,
      },
    } : {}),
  };
  return { ...core, receiptDigest: digest(core) };
}

test('DC81-1: session admission binds exact current Goal, Plan, definition, node, task, tree, and policy', (t) => {
  const f = fixture(t, 'authority');
  const before = f.store.events().length;
  const admitted = admitSession(f, 'authority');
  assert.equal(f.store.events().length, before + 1);
  assert.equal(admitted.event.kind, 'context.session_admitted');
  assert.equal(admitted.session.manifest.digest, f.manifest.digest);
  assert.equal(f.store.contextSession(admitted.session.sessionId).manifest.digest, f.manifest.digest);
  const replay = admitSession(f, 'authority');
  assert.equal(replay.result, 'idempotent');
  assert.equal(f.store.events().length, before + 1);

  for (const [label, changed] of [
    ['goal', { ...f.manifest.workflow, goal: { ...f.manifest.workflow.goal, version: 2 } }],
    ['plan', { ...f.manifest.workflow, plan: { ...f.manifest.workflow.plan, digest: '0'.repeat(64) } }],
    ['definition', { ...f.manifest.workflow, definitionDigest: '0'.repeat(64) }],
    ['node', { ...f.manifest.workflow, node: { ...f.manifest.workflow.node, digest: '0'.repeat(64) } }],
    ['task', { ...f.manifest.workflow, task: { ...f.manifest.workflow.task, version: 99 } }],
  ]) {
    const manifest = normalizeContextManifest({
      ...f.manifest, workflow: changed, digest: undefined,
    });
    const seq = f.store.events().length;
    assert.throws(() => f.store.admitContextSession({
      manifest, environmentDigest: f.bench.environmentDigest,
    }, auth('context-root', `authority:bad:${label}`)),
    (error) => error?.code === 'context_session_invalid');
    assert.equal(f.store.events().length, seq);
  }
  const environmentSeq = f.store.events().length;
  assert.throws(() => f.store.admitContextSession({
    manifest: f.manifest, environmentDigest: '5'.repeat(64),
  }, auth('context-root', 'authority:bad:environment')),
  (error) => error?.code === 'context_session_invalid');
  assert.equal(f.store.events().length, environmentSeq);
});

test('DC81-2: pure cell admission precedes computation and exact replay restores the full program', (t) => {
  const f = fixture(t, 'admit');
  const session = admitSession(f, 'admit');
  const before = f.bench.stats();
  const admitted = admitCell(f, session, 'admit');
  assert.equal(admitted.event.kind, 'context.cell_admitted');
  assert.equal(admitted.cell.state, 'admitted');
  assert.deepEqual(admitted.cell.program, f.program);
  assert.deepEqual(f.bench.stats(), before);
  assert.deepEqual(f.store.pendingContextCells().map(({ cellId }) => cellId),
    [admitted.cell.cellId]);
  const replay = admitCell(f, session, 'admit');
  assert.equal(replay.result, 'idempotent');
  assert.equal(replay.cell.cellId, admitted.cell.cellId);

  const effect = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: {
      op: 'map', input: { op: 'source', branch: 'repository' },
      role: 'critic', instruction: 'Review one partition.',
    },
  });
  const seq = f.store.events().length;
  assert.throws(() => admitCell(f, session, 'admit-effect', effect),
    (error) => error?.code === 'context_cell_effect_requires_workflow');
  assert.equal(f.store.events().length, seq);
});

test('DC81-3: settlement atomically binds CAS output/evidence and survives exact store restart', (t) => {
  const f = fixture(t, 'settle');
  const session = admitSession(f, 'settle');
  const admitted = admitCell(f, session, 'settle');
  const computed = f.bench.execute({ manifest: f.manifest, program: f.program });
  assert.equal(computed.cellId, admitted.cell.cellId);
  const key = `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`;
  const settled = f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root', key));
  assert.equal(settled.event.kind, 'context.cell_settled');
  assert.equal(settled.cell.state, 'completed');
  assert.equal(settled.cell.version, 2);
  assert.deepEqual(f.store.contextCellArtifacts(settled.cell.cellId), {
    output: computed.output, evidence: f.bench.readEvidence(computed.evidenceRef),
  });
  const seq = f.store.events().length;
  const responseReplay = f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root', key));
  assert.equal(responseReplay.result, 'idempotent');
  assert.equal(f.store.events().length, seq);

  f.store.releaseWriterLease();
  const reopened = new CoordinationStore(join(f.root, 'coordination'), f.storeOptions);
  t.after(() => reopened.releaseWriterLease());
  const restored = reopened.contextCell(admitted.cell.cellId);
  assert.equal(restored.state, 'completed');
  assert.deepEqual(restored.program, f.program);
  assert.deepEqual(reopened.contextCellArtifacts(restored.cellId), {
    output: computed.output, evidence: f.bench.readEvidence(computed.evidenceRef),
  });
  assert.deepEqual(reopened.snapshot().context.sessions.map(({ sessionId }) => sessionId),
    [session.session.sessionId]);
});

test('DC81-4: admitted crash resumes one identity; completed missing CAS is typed and never recomputed', (t) => {
  const f = fixture(t, 'recovery');
  const session = admitSession(f, 'recovery');
  const admitted = admitCell(f, session, 'recovery');
  f.store.releaseWriterLease();
  const reopened = new CoordinationStore(join(f.root, 'coordination'), f.storeOptions);
  t.after(() => reopened.releaseWriterLease());
  assert.deepEqual(reopened.pendingContextCells().map(({ cellId }) => cellId),
    [admitted.cell.cellId]);
  const computed = f.bench.execute({ manifest: f.manifest, program: f.program });
  const settled = reopened.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root',
    `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`));
  assert.equal(settled.cell.cellId, admitted.cell.cellId);
  const computations = f.bench.stats().computations;
  unlinkSync(join(f.artifactRoot, `${computed.outputRef.digest}.json`));
  assert.throws(() => reopened.contextCellArtifacts(admitted.cell.cellId),
    (error) => error?.code === 'context_artifact_unavailable');
  assert.equal(f.bench.stats().computations, computations);

  reopened.releaseWriterLease();
  const replayWithoutCas = new CoordinationStore(join(f.root, 'coordination'), f.storeOptions);
  t.after(() => replayWithoutCas.releaseWriterLease());
  assert.equal(replayWithoutCas.contextCell(admitted.cell.cellId).state, 'completed');
});

test('DC81-5: Run stop fences new cells and prevents a late pure result from attaching', (t) => {
  const before = fixture(t, 'stop-before');
  const beforeSession = admitSession(before, 'stop-before');
  stopRun(before.store, 'before');
  assert.throws(() => admitCell(before, beforeSession, 'stop-before'),
    (error) => error?.code === 'run_stopping');

  const during = fixture(t, 'stop-during');
  const duringSession = admitSession(during, 'stop-during');
  const admitted = admitCell(during, duringSession, 'stop-during');
  const computed = during.bench.execute({ manifest: during.manifest, program: during.program });
  stopRun(during.store, 'during');
  assert.equal(during.store.contextCell(admitted.cell.cellId).state, 'stopped');
  assert.throws(() => during.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root',
    `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`)),
  (error) => error?.code === 'run_stopping');
});

test('DC81-6: durable ContextSession stays Pythonic and reopens without ledger-specific inputs', (t) => {
  const f = fixture(t, 'facade');
  const principal = {
    actor: 'direct:context-root', principalId: 'context-root', repoId, runId,
  };
  const first = new DurableContextSession({
    coordination: f.store, bench: f.bench, manifest: f.manifest, principal,
  });
  assert.equal(first.outline().cells, 0);
  const result = first.search('authority', { branch: 'repository' });
  assert.equal(result.state, 'completed');
  assert.equal(first.outline().cells, 1);
  assert.equal(first.evidence(result.cellId).coordinateDigest, result.coordinateDigest);
  const seq = f.store.events().length;

  const reopened = new DurableContextSession({
    coordination: f.store, bench: f.bench, manifest: f.manifest, principal,
  });
  assert.equal(f.store.events().length, seq);
  assert.equal(reopened.outline().cells, 1);
  assert.equal(reopened.cell(result.cellId).programDigest, result.programDigest);
});

test('DC81-7: every durable Context idempotency key refuses changed authority or content', (t) => {
  const f = fixture(t, 'conflicts');
  const session = admitSession(f, 'conflicts');
  const sessionSeq = f.store.events().length;
  assert.throws(() => f.store.admitContextSession({
    manifest: f.manifest, environmentDigest: '5'.repeat(64),
  }, auth('context-root', `context.session:${f.manifest.digest}`)),
  (error) => error?.code === 'context_session_conflict');
  assert.equal(f.store.events().length, sessionSeq);

  const admitted = admitCell(f, session, 'conflicts');
  const changedProgram = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: {
      op: 'search', input: { op: 'source', branch: 'repository' },
      query: 'replay', mode: 'case_insensitive',
    },
  });
  const cellSeq = f.store.events().length;
  assert.throws(() => f.store.admitContextCell({
    sessionId: session.session.sessionId, program: changedProgram,
  }, auth('context-root', `context.cell:${session.session.sessionId}:${f.program.programDigest}`)),
  (error) => error?.code === 'context_cell_conflict');
  assert.equal(f.store.events().length, cellSeq);

  const computed = f.bench.execute({ manifest: f.manifest, program: f.program });
  const key = `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`;
  f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root', key));
  const settlementSeq = f.store.events().length;
  assert.throws(() => f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1,
    result: { ...completion(computed), coordinateDigest: '6'.repeat(64) },
  }, auth('context-root', key)),
  (error) => error?.code === 'context_cell_settlement_conflict');
  assert.equal(f.store.events().length, settlementSeq);
});

test('DC81-8: Context program ledger substitution fails typed replay before projection', (t) => {
  const f = fixture(t, 'tamper');
  const session = admitSession(f, 'tamper');
  admitCell(f, session, 'tamper');
  f.store.releaseWriterLease();
  const ledger = join(f.root, 'coordination', 'events.jsonl');
  const rows = readFileSync(ledger, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const admission = rows.find((row) => row.kind === 'context.cell_admitted');
  admission.payload.cell.program.expression.query = 'substituted after admission';
  writeFileSync(ledger, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(join(f.root, 'coordination'), f.storeOptions),
    (error) => error?.code === 'context_cell_integrity');
});

test('DC81-9: createDriver pins and re-attests one deployment-owned Context runtime', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase82-context-driver-'));
  const repository = join(root, 'repository');
  mkdirSync(repository, { recursive: true });
  writeFileSync(join(repository, 'README.md'), '# Context driver fixture\n');
  execFileSync('git', ['init', '-q'], { cwd: repository });
  execFileSync('git', ['add', '.'], { cwd: repository });
  execFileSync('git', [
    '-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test',
    'commit', '-q', '-m', 'base',
  ], { cwd: repository });
  const deploymentBaseSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repository, encoding: 'utf8',
  }).trim();
  const referenceRead = () => [];
  const sourceAttest = () => { throw new Error('unused in driver configuration test'); };
  const driver = createDriver({
    repoRoot: repository, repoId, deploymentBaseSha, logDir: join(root, 'driver'), adapters: {},
    contextProgram: {
      environmentDigest, policy: DEFAULT_CONTEXT_PROGRAM_POLICY, referenceIdentity, referenceRead,
      sourceAttest,
    },
  });
  t.after(() => {
    try { driver.close(); } catch { /* test failure still owns cleanup */ }
    rmSync(root, { recursive: true, force: true });
  });
  assert.deepEqual(driver.coordination.contextProgramPolicy(), DEFAULT_CONTEXT_PROGRAM_POLICY);

  const { policyDigest: ignoredPolicyDigest, ...policyBody } = DEFAULT_CONTEXT_PROGRAM_POLICY;
  void ignoredPolicyDigest;
  const changedPolicy = normalizeContextProgramPolicy({
    ...policyBody,
    maxProgramNodes: DEFAULT_CONTEXT_PROGRAM_POLICY.maxProgramNodes - 1,
  });
  assert.throws(() => createDriver({
    repoRoot: repository, repoId, deploymentBaseSha, logDir: join(root, 'mismatched'), adapters: {},
    coordination: driver.coordination,
    contextProgram: {
      environmentDigest, policy: changedPolicy, referenceIdentity, referenceRead, sourceAttest,
    },
  }), /disagrees with deployment Context Program authority/u);
});

test('DC81-10: only the admitted Context principal can settle a cell', (t) => {
  const f = fixture(t, 'settlement-authority');
  const session = admitSession(f, 'settlement-authority');
  const cellKey = `context.cell:${session.session.sessionId}:${f.program.programDigest}`;
  const cellSeq = f.store.events().length;
  assert.throws(() => f.store.admitContextCell({
    sessionId: session.session.sessionId, program: f.program,
  }, auth('intruder', cellKey)), (error) => error?.code === 'context_cell_unauthorized');
  assert.equal(f.store.events().length, cellSeq);
  const admitted = admitCell(f, session, 'settlement-authority');
  const computed = f.bench.execute({ manifest: f.manifest, program: f.program });
  const key = `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`;
  const seq = f.store.events().length;
  assert.throws(() => f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('intruder', key)), (error) => error?.code === 'context_cell_settlement_unauthorized');
  assert.equal(f.store.events().length, seq);
  assert.equal(f.store.contextCell(admitted.cell.cellId).state, 'admitted');
});

test('DC81-11: exact settled replay remains idempotent after Run stop', (t) => {
  const f = fixture(t, 'settled-stop-replay');
  const session = admitSession(f, 'settled-stop-replay');
  const admitted = admitCell(f, session, 'settled-stop-replay');
  const computed = f.bench.execute({ manifest: f.manifest, program: f.program });
  const key = `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`;
  f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root', key));
  stopRun(f.store, 'after-settlement');
  const seq = f.store.events().length;
  const replay = f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root', key));
  assert.equal(replay.result, 'idempotent');
  assert.equal(f.store.events().length, seq);
});

test('DC81-12: a terminal task makes its admitted Context session stale for new cells', (t) => {
  const f = fixture(t, 'stale-task');
  const session = admitSession(f, 'stale-task');
  f.store.transitionTask(f.task.id, 'failed', f.task.version, {
    actor: 'policy', key: 'stale-task:terminal',
  });
  const seq = f.store.events().length;
  assert.throws(() => admitCell(f, session, 'stale-task'),
    (error) => error?.code === 'context_session_stale');
  assert.equal(f.store.events().length, seq);

  const late = fixture(t, 'stale-task-settlement');
  const lateSession = admitSession(late, 'stale-task-settlement');
  const admitted = admitCell(late, lateSession, 'stale-task-settlement');
  const computed = late.bench.execute({ manifest: late.manifest, program: late.program });
  late.store.transitionTask(late.task.id, 'failed', late.task.version, {
    actor: 'policy', key: 'stale-task-settlement:terminal',
  });
  const lateSeq = late.store.events().length;
  assert.throws(() => late.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root',
    `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`)),
  (error) => error?.code === 'context_session_stale');
  assert.equal(late.store.events().length, lateSeq);
});

test('DC81-13: a durable Context facade cannot read another sessions cell', (t) => {
  const f = fixture(t, 'session-scope');
  const principal = {
    actor: 'direct:context-root', principalId: 'context-root', repoId, runId,
  };
  const first = new DurableContextSession({
    coordination: f.store, bench: f.bench, manifest: f.manifest, principal,
  });
  const secondManifest = normalizeContextManifest({
    ...f.manifest,
    branches: f.manifest.branches.map((branch) => ({
      ...branch, summary: 'same immutable source in a distinct addressed context session',
    })),
    digest: undefined,
  });
  const second = new DurableContextSession({
    coordination: f.store, bench: f.bench, manifest: secondManifest, principal,
  });
  const foreignCell = second.search('authority');
  assert.equal(first.cell(foreignCell.cellId), null);
  assert.equal(first.evidence(foreignCell.cellId), null);
});

test('DC81-14: deterministic pure-cell failure settles once and reopens without recomputation', (t) => {
  const f = fixture(t, 'deterministic-failure');
  const principal = {
    actor: 'direct:context-root', principalId: 'context-root', repoId, runId,
  };
  const first = new DurableContextSession({
    coordination: f.store, bench: f.bench, manifest: f.manifest, principal,
  });
  const failed = first.chunk('repository', { by: 'missing_field' });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.termination.code, 'context_program_invalid');
  assert.equal(f.store.pendingContextCells().length, 0);
  const seq = f.store.events().length;
  const stats = f.bench.stats();

  const reopened = new DurableContextSession({
    coordination: f.store, bench: f.bench, manifest: f.manifest, principal,
  });
  const replay = reopened.chunk('repository', { by: 'missing_field' });
  assert.equal(replay.cellId, failed.cellId);
  assert.equal(replay.state, 'failed');
  assert.equal(f.store.events().length, seq);
  assert.deepEqual(f.bench.stats(), stats);
});

test('DC81-15: self-consistent CAS evidence cannot substitute a manifest source item', (t) => {
  const f = fixture(t, 'forged-evidence');
  const session = admitSession(f, 'forged-evidence');
  const admitted = admitCell(f, session, 'forged-evidence');
  const computed = f.bench.execute({ manifest: f.manifest, program: f.program });
  const original = f.bench.readEvidence(computed.evidenceRef);
  const sourceCoordinates = original.sourceCoordinates.map((coordinate, index) => (
    index === 0 ? { ...coordinate, itemDigest: 'f'.repeat(64) } : coordinate
  ));
  const coordinateDigest = contextValueDigest(sourceCoordinates);
  const forged = {
    ...original, sourceCoordinates, coordinateDigest,
  };
  const evidenceDigest = contextValueDigest(forged);
  const serialized = JSON.stringify(canonical(forged));
  writeFileSync(join(f.artifactRoot, `${evidenceDigest}.json`), serialized);
  const evidenceRef = {
    ...computed.evidenceRef,
    handle: `art:sha256:${evidenceDigest}`,
    digest: evidenceDigest,
    bytes: Buffer.byteLength(serialized),
  };
  const seq = f.store.events().length;
  assert.throws(() => f.store.settleContextCell({
    cellId: admitted.cell.cellId,
    expectedVersion: 1,
    result: { ...completion(computed), evidenceRef, coordinateDigest },
  }, auth('context-root',
    `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`)),
  (error) => error?.code === 'context_artifact_integrity');
  assert.equal(f.store.events().length, seq);
});

test('DC81-16: deployment evolution replays historical Context authority without making it current', (t) => {
  const f = fixture(t, 'authority-epoch');
  const session = admitSession(f, 'authority-epoch');
  const admitted = admitCell(f, session, 'authority-epoch');
  const computed = f.bench.execute({ manifest: f.manifest, program: f.program });
  f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root',
    `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`));
  f.store.releaseWriterLease();
  const { policyDigest: ignoredPolicyDigest, ...policyBody } = DEFAULT_CONTEXT_PROGRAM_POLICY;
  void ignoredPolicyDigest;
  const nextPolicy = normalizeContextProgramPolicy({
    ...policyBody,
    maxProgramNodes: policyBody.maxProgramNodes - 1,
    maxArtifactBytes: 128,
  });
  const nextBench = new StatelessContextBench({
    artifactRoot: f.artifactRoot, sources: {}, environmentDigest: '5'.repeat(64),
    policy: nextPolicy,
  });
  const reopened = new CoordinationStore(join(f.root, 'coordination'), {
    ...f.storeOptions,
    deploymentBaseSha: '2'.repeat(40),
    contextEnvironmentDigest: '5'.repeat(64),
    contextReferenceIdentity: '8'.repeat(64),
    contextProgramPolicy: nextPolicy,
    contextReferenceRead: (reference) => nextBench.readReference(reference),
  });
  t.after(() => reopened.releaseWriterLease());
  assert.equal(reopened.contextSession(session.session.sessionId).manifest.digest, f.manifest.digest);
  assert.equal(reopened.contextCell(admitted.cell.cellId).state, 'completed');
  assert.deepEqual(reopened.contextCellArtifacts(admitted.cell.cellId).output, computed.output);
  const newProgram = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'coverage', input: { op: 'source', branch: 'repository' } },
  }, nextPolicy);
  assert.throws(() => reopened.admitContextCell({
    sessionId: session.session.sessionId, program: newProgram,
  }, auth('context-root',
    `context.cell:${session.session.sessionId}:${newProgram.programDigest}`)),
  (error) => error?.code === 'context_session_stale');
});

test('DC81-17: malformed Context principals refuse before JSON can erase authority fields', (t) => {
  const f = fixture(t, 'malformed-principal');
  const before = f.store.events().length;
  assert.throws(() => f.store.admitContextSession({
    manifest: f.manifest, environmentDigest,
  }, {
    actor: 'direct:context-root', principalId: undefined, repoId, runId,
    key: `context.session:${f.manifest.digest}`,
  }), (error) => error?.code === 'context_session_invalid');
  assert.equal(f.store.events().length, before);

  const session = admitSession(f, 'malformed-principal');
  const cellBefore = f.store.events().length;
  assert.throws(() => f.store.admitContextCell({
    sessionId: session.session.sessionId, program: f.program,
  }, {
    actor: 'direct:context-root', principalId: undefined, repoId, runId,
    key: `context.cell:${session.session.sessionId}:${f.program.programDigest}`,
  }), (error) => error?.code === 'context_cell_invalid');
  assert.equal(f.store.events().length, cellBefore);
});

test('DC81-18: Run projection is compact until explicit Context item and evidence depth', (t) => {
  const f = fixture(t, 'application-projection');
  const session = admitSession(f, 'application-projection');
  const admitted = admitCell(f, session, 'application-projection');
  const computed = f.bench.execute({ manifest: f.manifest, program: f.program });
  f.store.settleContextCell({
    cellId: admitted.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root',
    `context.cell.settle:${admitted.cell.cellId}:${admitted.cell.admissionDigest}`));
  const application = Object.create(BatonApplication.prototype);
  application.driver = { coordination: f.store };
  application.repoId = repoId;
  const current = { goal: f.goal, plan: f.plan };

  const projected = application._contextState(current);
  assert.deepEqual(projected.projection.lastCell, {
    id: admitted.cell.cellId, ordinal: 1, state: 'completed', operation: 'search',
  });
  assert.equal(Object.hasOwn(projected.projection, 'manifest'), false);
  const items = application._contextSectionItems(current);
  const cellItem = items.find((item) => item.id === admitted.cell.cellId);
  assert.equal(Object.hasOwn(cellItem.value, 'output'), false);
  assert.deepEqual(application._contextItemDetail(cellItem).value.output, computed.output);
  const evidence = application._contextItemEvidence(current, cellItem);
  assert.deepEqual(evidence.map(({ kind }) => kind), ['context_program', 'context_evidence']);
  assert.equal(evidence[1].value.coordinateDigest, computed.coordinateDigest);
});

test('DC81-19: Run stop v2 binds active Context sessions and only admitted Context cells', (t) => {
  const f = fixture(t, 'stop-context-targets');
  const session = admitSession(f, 'stop-context-targets');
  const completed = admitCell(f, session, 'stop-context-targets');
  const computed = f.bench.execute({ manifest: f.manifest, program: f.program });
  f.store.settleContextCell({
    cellId: completed.cell.cellId, expectedVersion: 1, result: completion(computed),
  }, auth('context-root',
    `context.cell.settle:${completed.cell.cellId}:${completed.cell.admissionDigest}`));
  const pendingProgram = normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program',
    expression: { op: 'coverage', input: { op: 'source', branch: 'repository' } },
  });
  const pending = admitCell(f, session, 'stop-context-targets-pending', pendingProgram);
  const admitted = stopRun(f.store, 'context-targets');
  const stop = admitted.stop;

  assert.equal(stop.schemaVersion, 2);
  assert.deepEqual(stop.targetContextSessionIds, [session.session.sessionId]);
  assert.deepEqual(stop.targetContextCellIds, [pending.cell.cellId]);
  assert.equal(stop.targetDigest, digest({
    targetTaskIds: stop.targetTaskIds,
    targetWorkerIds: stop.targetWorkerIds,
    targetContextSessionIds: stop.targetContextSessionIds,
    targetContextCellIds: stop.targetContextCellIds,
  }));
  assert.equal(f.store.contextSession(session.session.sessionId).state, 'stopped');
  assert.equal(f.store.contextCell(completed.cell.cellId).state, 'completed');
  assert.equal(f.store.contextCell(pending.cell.cellId).state, 'stopped');
});

test('DC81-20: Run stop v2 completion proves zero remaining Context authority separately', (t) => {
  const f = fixture(t, 'stop-context-receipt');
  const session = admitSession(f, 'stop-context-receipt');
  const pending = admitCell(f, session, 'stop-context-receipt');
  const admitted = stopRun(f.store, 'context-receipt');
  const receipt = stopReceipt(admitted.stop);
  const completed = f.store.completeRunStop(runId, receipt, {
    actor: 'direct:operator', key: `run.stop.complete:${runId}`,
  });
  assert.equal(completed.stop.receipt.context.remainingSessionCount, 0);
  assert.equal(completed.stop.receipt.context.remainingCellCount, 0);
  assert.equal(completed.stop.receipt.targetCount, completed.stop.targetWorkerIds.length,
    'worker disposition arithmetic remains separate from Context targets');
  assert.equal(f.store.contextCell(pending.cell.cellId).state, 'stopped');

  const changed = { ...receipt, context: { ...receipt.context, targetCellCount: 0 } };
  assert.throws(() => f.store.completeRunStop(runId, changed, {
    actor: 'direct:operator', key: `run.stop.complete:${runId}`,
  }), (error) => error?.code === 'run_stop_conflict');
});

test('DC81-21: Run stop v2 restart and exact completion replay preserve one proof', (t) => {
  const f = fixture(t, 'stop-context-restart');
  const session = admitSession(f, 'stop-context-restart');
  admitCell(f, session, 'stop-context-restart');
  const admitted = stopRun(f.store, 'context-restart');
  const receipt = stopReceipt(admitted.stop);
  f.store.completeRunStop(runId, receipt, {
    actor: 'direct:operator', key: `run.stop.complete:${runId}`,
  });
  f.store.releaseWriterLease();
  const reopened = new CoordinationStore(join(f.root, 'coordination'), f.storeOptions);
  t.after(() => reopened.releaseWriterLease());
  assert.deepEqual(reopened.runStop(runId).receipt, receipt);
  const seq = reopened.events().length;
  const replay = reopened.completeRunStop(runId, receipt, {
    actor: 'direct:operator', key: `run.stop.complete:${runId}`,
  });
  assert.equal(replay.result, 'replay');
  assert.equal(reopened.events().length, seq);
});

test('DC81-22: recomputed stop digest cannot erase independently reconstructed Context targets', (t) => {
  const f = fixture(t, 'stop-context-tamper');
  const session = admitSession(f, 'stop-context-tamper');
  admitCell(f, session, 'stop-context-tamper');
  stopRun(f.store, 'context-tamper');
  f.store.releaseWriterLease();
  const ledger = join(f.root, 'coordination', 'events.jsonl');
  const rows = readFileSync(ledger, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const admission = rows.find((row) => row.kind === 'run.stop_admitted');
  admission.payload.targetContextCellIds = [];
  admission.payload.targetDigest = digest({
    targetTaskIds: admission.payload.targetTaskIds,
    targetWorkerIds: admission.payload.targetWorkerIds,
    targetContextSessionIds: admission.payload.targetContextSessionIds,
    targetContextCellIds: [],
  });
  writeFileSync(ledger, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(join(f.root, 'coordination'), f.storeOptions),
    (error) => error?.code === 'run_stop_integrity');
});

test('DC81-23: source attestation refuses CAS bytes that lie about their Git blob identity', (t) => {
  const f = fixture(t, 'forged-source-attestation');
  const text = 'self-consistent CAS bytes absent from the attested Git blob';
  const forged = [{
    path: 'impl/src/forged.mjs', chunk: 0, gitBlobOid: 'f'.repeat(40),
    byteStart: 0, byteEnd: Buffer.byteLength(text),
    contentDigest: contextValueDigest(text), language: 'mjs', text,
  }];
  const admittedSource = f.bench.admitSource(forged);
  const manifest = normalizeContextManifest({
    ...f.manifest,
    branches: [{
      name: 'repository', ref: admittedSource.ref,
      summary: 'forged source must not enter durable Context',
      digest: admittedSource.digest, mediaType: admittedSource.mediaType,
      itemCount: admittedSource.itemCount,
    }],
    digest: undefined,
  });
  const seq = f.store.events().length;
  assert.throws(() => f.store.admitContextSession({
    manifest, environmentDigest: f.bench.environmentDigest,
  }, auth('context-root', `context.session:${manifest.digest}`)),
  (error) => error?.code === 'context_source_attestation_invalid');
  assert.equal(f.store.events().length, seq);
});
