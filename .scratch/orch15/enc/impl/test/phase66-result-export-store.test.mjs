import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationIntegrityError, CoordinationRefusal, CoordinationStore,
} from '../src/coordination-store.mjs';

const REPO_ID = 'repo-phase66-export-store';
const RUN_ID = 'run-phase66-export-store';
const NODE_KEY = 'work';
const TASK_ID = 'task-phase66-export-store';
const RESULT_SHA = 'a'.repeat(40);
const RESULT_REF = `refs/baton/results/${RESULT_SHA}`;

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const budget = (tokens) => ({ tokens, usd: 1, wallMin: 10, providerTurns: 4 });
const ref = (kind, value) => ({ [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest });

const POLICY = Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const VERIFICATION = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000,
  requiredPredecessorEvidence: [],
});

function authority(principalId, key) {
  return {
    actor: `direct:${principalId}`,
    principalId,
    sessionDigest: digest(`session:${principalId}`),
    repoId: REPO_ID,
    runId: RUN_ID,
    key,
  };
}

function fixture(t, name, { appendFile = appendFileSync } = {}) {
  const directory = mkdtempSync(join(tmpdir(), `baton-phase66-export-store-${name}-`));
  const operational = new Map();
  const operationalRead = (worker, seq) => operational.get(`${worker}:${seq}`) ?? null;
  const store = new CoordinationStore(directory, {
    goalPlanPolicy: POLICY,
    operationalRead,
    appendFile,
    clock: () => '2026-07-14T18:00:00.000Z',
  });
  t.after(() => {
    try { store.releaseWriterLease(); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  const goal = store.defineGoal({
    objective: 'Export one exact accepted result',
    definitionOfDone: ['The durable export receipt is exact'],
    constraints: ['Do not mutate the checkout'],
    risk: 'high',
    budget: budget(20_000),
    predecessor: null,
  }, authority('goal-owner', `${name}:goal`)).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal),
    predecessor: null,
    nodes: [{
      key: NODE_KEY,
      objective: 'Produce one accepted result for export',
      definitionOfDone: ['The durable export receipt is exact'],
      deps: [], pathScope: ['impl/**'], risk: 'high', budget: budget(10_000),
      verification: VERIFICATION,
      routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
      capabilities: ['code', 'test'], effects: ['repository_edit'],
    }],
  }, authority('planner', `${name}:plan`)).plan;
  const approval = store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null, disposition: 'approved',
  }, authority('approver', `${name}:approve`)).approval;
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey: NODE_KEY, expectedDispatchVersion: 0,
    capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const route = { vendor: 'mock', model: 'model-a', effort: 'low' };
  const preview = store.previewPlanDispatch(gate, route);
  store.createPlanGatedTask({
    id: TASK_ID,
    brief: preview.brief,
    deps: preview.resolvedDeps,
    refines: null,
    runId: RUN_ID,
    taskType: 'general',
    reservedWorkerId: 'worker-export',
    vendorRequested: route.vendor,
    modelRequested: route.model,
    modelPolicy: null,
    effortRequested: route.effort,
    effortResolved: null,
    effortObserved: null,
    routeKey: null,
    sessionRequest: { mode: 'new' },
  }, gate, route, authority('dispatcher', `${name}:dispatch`));
  const claimed = store.claimTask(TASK_ID, 'worker-export', 1, {
    actor: 'orchestrator', key: `${name}:claim`,
  });
  const verify = {
    worker: 'worker-export', taskId: TASK_ID, seq: 7,
    ts: '2026-07-14T18:00:00.000Z', kind: 'verify.reverified', actor: 'policy',
    payload: { accept: true },
  };
  operational.set('worker-export:7', verify);
  const mapped = store.mapOperationalEvent(verify, { actor: 'policy', key: `${name}:map` });
  const terminal = store.transitionTaskWithArtifacts(TASK_ID, 'completed', claimed.task.version, [
    {
      taskId: TASK_ID, kind: 'commit',
      refs: { sha: RESULT_SHA, retainedResultRef: RESULT_REF },
      mediaType: 'application/vnd.git.commit', accepted: true, provenance: [mapped.evidence],
    },
    {
      taskId: TASK_ID, kind: 'verification',
      refs: { worker: 'worker-export', workerSeq: 7 },
      mediaType: 'application/vnd.baton.verdict+json', accepted: true, provenance: [mapped.evidence],
    },
  ], { actor: 'policy', key: `${name}:terminal` }, mapped.evidence);
  return { directory, operationalRead, store, goal, plan, approval, terminal, evidence: mapped.evidence };
}

function exportRequest(overrides = {}) {
  const core = {
    repoId: REPO_ID,
    runId: RUN_ID,
    nodeKey: NODE_KEY,
    taskId: TASK_ID,
    resultSha: RESULT_SHA,
    evidenceDigest: 'b'.repeat(64),
    profileDigest: 'c'.repeat(64),
    exportPolicyDigest: 'd'.repeat(64),
    exportRootDigest: 'e'.repeat(64),
    adoptionReceiptDigest: null,
    semanticReviewTaskId: null,
    semanticReviewReceiptDigest: null,
    integrationAfterSha: null,
    format: 'directory-v1',
    maxFiles: 128,
    maxBytes: 4 * 1024 * 1024,
    stagingNonce: '00000000-0000-4000-8000-000000000066',
    ...overrides,
  };
  const exportId = digest(core);
  return { schemaVersion: 1, ...core, exportId, requestDigest: exportId };
}

function admissionAuth(actor = 'direct:exporter') {
  return { actor, key: `run.result_export:${RUN_ID}:${NODE_KEY}` };
}

function exactCompletionAuth(exportId, actor = 'direct:exporter') {
  return { actor, key: `run.result_export.complete:${exportId}` };
}

function exportReceipt(admission, changes = {}) {
  const core = {
    schemaVersion: 1,
    state: 'completed',
    format: admission.format,
    runId: admission.runId,
    nodeKey: admission.nodeKey,
    resultSha: admission.resultSha,
    evidenceDigest: admission.evidenceDigest,
    exportId: admission.exportId,
    locator: admission.locator,
    treeOid: '2'.repeat(40),
    manifestDigest: '3'.repeat(64),
    fileCount: 2,
    byteCount: 256,
    checks: { acceptedResultReverified: true, manifestVerified: true, treeExact: true },
    effects: { adopted: false, checkoutChanged: false, deployed: false, integrated: false, published: false },
    ...changes,
  };
  return { ...core, receiptDigest: digest(core) };
}

function adoptionRequest() {
  const core = {
    repoId: REPO_ID, runId: RUN_ID, nodeKey: NODE_KEY, taskId: TASK_ID,
    resultSha: RESULT_SHA, evidenceDigest: '4'.repeat(64), reasonDigest: '5'.repeat(64),
  };
  return { schemaVersion: 1, ...core, requestDigest: digest(core) };
}

function adoptionReceipt(adoption) {
  const core = {
    schemaVersion: 1, state: 'adopted', scope: 'run-result', repoId: REPO_ID,
    runId: RUN_ID, nodeKey: NODE_KEY, taskId: TASK_ID,
    binding: {
      admissionDigest: adoption.adoptionDigest, evidenceDigest: adoption.evidenceDigest,
      goalDigest: adoption.binding.goal.digest, planDigest: adoption.binding.plan.digest,
      approvalDigest: adoption.binding.approvalDigest,
      commitArtifactId: adoption.binding.commitArtifact.id,
      commitArtifactDigest: adoption.binding.commitArtifact.digest,
      verificationArtifactId: adoption.binding.verificationArtifact.id,
      verificationArtifactDigest: adoption.binding.verificationArtifact.digest,
    },
    result: { sha: RESULT_SHA, ref: RESULT_REF },
    checks: {
      taskAccepted: true, verificationAccepted: true, refPinned: true,
      mainUnchanged: true, worktreeIndependent: true,
    },
    effects: { mainHeadChanged: false, indexChanged: false, workingTreeChanged: false, published: false },
  };
  return { ...core, receiptDigest: digest(core) };
}

function completeAdoption(f) {
  const actor = 'direct:adopter';
  const admitted = f.store.admitRunResultAdoption(adoptionRequest(), {
    actor, key: `run.result_adoption:${RUN_ID}:${NODE_KEY}`,
  }).adoption;
  return f.store.completeRunResultAdoption({
    schemaVersion: 1, runId: RUN_ID, nodeKey: NODE_KEY, receipt: adoptionReceipt(admitted),
  }, { actor, key: `run.result_adoption.complete:${RUN_ID}:${NODE_KEY}` }).adoption;
}

function completeSemanticReview(f, name) {
  const reviewTaskId = `review-${name}`;
  const commitArtifact = f.terminal.artifacts.find((artifact) => artifact.kind === 'commit');
  const verificationArtifact = f.terminal.artifacts.find((artifact) => artifact.kind === 'verification');
  const target = {
    repoId: REPO_ID, runId: RUN_ID, nodeKey: NODE_KEY, taskId: TASK_ID, resultSha: RESULT_SHA,
    goalDigest: f.goal.digest, planDigest: f.plan.digest, approvalDigest: f.approval.digest,
    commitArtifact: { id: commitArtifact.id, digest: commitArtifact.digest },
    verificationArtifact: { id: verificationArtifact.id, digest: verificationArtifact.digest },
  };
  f.store.createTask({
    id: reviewTaskId,
    brief: {
      goal: 'Independently review the exact accepted result', constraints: ['Do not change the parent'],
      pathScope: ['impl/**'], definitionOfDone: 'The review is complete', verification: VERIFICATION,
      budget: budget(1_000), outputFormat: 'one bounded report',
    },
    deps: [], refines: TASK_ID, runId: RUN_ID, taskType: 'review',
    reservedWorkerId: 'worker-review', vendorRequested: 'reviewer', modelRequested: 'review-model',
    modelPolicy: null, effortRequested: 'low', effortResolved: null, effortObserved: null,
    routeKey: null, sessionRequest: { mode: 'new' },
    review: {
      kind: 'review', parentTaskId: TASK_ID, parentWorkerId: 'worker-export', resultSha: RESULT_SHA,
      structured: { purpose: 'run_semantic_review', target },
    },
  }, { actor: 'direct:reviewer', key: `${name}:review-create` });
  const claimed = f.store.claimTask(reviewTaskId, 'worker-review', 1, {
    actor: 'orchestrator', key: `${name}:review-claim`,
  });
  const completed = f.store.transitionTask(reviewTaskId, 'completed', claimed.task.version, {
    actor: 'policy', key: `${name}:review-complete`,
  });
  return { taskId: reviewTaskId, task: completed.task, receiptDigest: '6'.repeat(64) };
}

function recordIntegration(f, name) {
  const afterSha = '7'.repeat(40);
  const artifact = f.store.registerArtifact({
    taskId: TASK_ID, kind: 'integration', refs: { resultSha: RESULT_SHA, afterSha },
    mediaType: 'application/vnd.baton.integration+json', accepted: true, provenance: [f.evidence],
  }, { actor: 'policy', key: `${name}:integration` }).artifact;
  return { afterSha, artifact };
}

function assertRefusal(fn, code) {
  assert.throws(fn, (error) => error instanceof CoordinationRefusal && error.code === code);
}

function stopRun(store, name) {
  const core = { repoId: REPO_ID, runId: RUN_ID, reasonDigest: digest(`stop:${name}`) };
  return store.admitRunStop({ schemaVersion: 1, ...core, requestDigest: digest(core) }, {
    actor: 'direct:stopper', key: `run.stop:${RUN_ID}`,
  });
}

test('export admission derives one exact identity and binds accepted result authority', (t) => {
  const f = fixture(t, 'admission');
  const request = exportRequest();
  const expectedIdentity = digest(Object.fromEntries(Object.entries(request)
    .filter(([key]) => !['schemaVersion', 'exportId', 'requestDigest'].includes(key))));
  const admitted = f.store.admitRunResultExport(request, admissionAuth());

  assert.equal(request.exportId, expectedIdentity);
  assert.equal(request.requestDigest, expectedIdentity);
  assert.equal(admitted.result, 'admitted');
  assert.equal(admitted.export.status, 'pending');
  assert.equal(admitted.export.exportId, expectedIdentity);
  assert.equal(admitted.export.locator, `export:${expectedIdentity}`);
  assert.equal(admitted.export.actor, admissionAuth().actor);
  assert.equal(admitted.export.binding.accepted.commitArtifact.id, f.terminal.artifacts[0].id);
  assert.equal(admitted.export.binding.accepted.verificationArtifact.id, f.terminal.artifacts[1].id);
  assert.equal(admitted.export.binding.accepted.goal.digest, f.goal.digest);
  assert.equal(admitted.export.binding.accepted.plan.digest, f.plan.digest);
  assert.equal(admitted.export.binding.accepted.approvalDigest, f.approval.digest);
  assert.deepEqual(admitted.export.binding.adoption, null);
  assert.deepEqual(admitted.export.binding.semanticReview, null);
  assert.deepEqual(admitted.export.binding.integration, null);
  const { admissionDigest, ...admissionCore } = admitted.event.payload;
  assert.equal(admissionDigest, digest(admissionCore));
  assert.deepEqual(f.store.pendingRunResultExports(), [admitted.export]);
});

test('export admission and completion are immutable and exactly idempotent', (t) => {
  const f = fixture(t, 'idempotency');
  const request = exportRequest();
  const admitted = f.store.admitRunResultExport(request, admissionAuth());
  assert.equal(f.store.admitRunResultExport(request, admissionAuth()).result, 'replay');
  assertRefusal(() => f.store.admitRunResultExport(
    exportRequest({ evidenceDigest: '8'.repeat(64) }), admissionAuth(),
  ), 'run_result_export_conflict');
  assertRefusal(() => f.store.admitRunResultExport(request, admissionAuth('direct:other-exporter')),
    'run_result_export_conflict');
  assert.equal(f.store.events().filter((event) => event.kind === 'run.result_export_admitted').length, 1);

  const receipt = exportReceipt(admitted.export);
  const completed = f.store.completeRunResultExport({
    schemaVersion: 1, exportId: admitted.export.exportId, receipt,
  }, exactCompletionAuth(admitted.export.exportId));
  assert.equal(completed.result, 'completed');
  assert.equal(completed.export.status, 'completed');
  assert.deepEqual(completed.export.receipt, receipt);
  assert.deepEqual(f.store.pendingRunResultExports(), []);
  assert.equal(f.store.completeRunResultExport({
    schemaVersion: 1, exportId: admitted.export.exportId, receipt,
  }, exactCompletionAuth(admitted.export.exportId)).result, 'replay');

  const changed = exportReceipt(admitted.export, { manifestDigest: '9'.repeat(64) });
  assertRefusal(() => f.store.completeRunResultExport({
    schemaVersion: 1, exportId: admitted.export.exportId, receipt: changed,
  }, exactCompletionAuth(admitted.export.exportId)), 'run_result_export_conflict');
});

test('completion receipt is closed and proves exact verification with no side effects', (t) => {
  const f = fixture(t, 'receipt');
  const admitted = f.store.admitRunResultExport(exportRequest(), admissionAuth()).export;
  const wrongChecks = exportReceipt(admitted, {
    checks: { acceptedResultReverified: true, manifestVerified: true, treeExact: false },
  });
  assertRefusal(() => f.store.completeRunResultExport({
    schemaVersion: 1, exportId: admitted.exportId, receipt: wrongChecks,
  }, exactCompletionAuth(admitted.exportId)), 'run_result_export_integrity');

  const effectful = exportReceipt(admitted, {
    effects: { adopted: true, checkoutChanged: false, deployed: false, integrated: false, published: false },
  });
  assertRefusal(() => f.store.completeRunResultExport({
    schemaVersion: 1, exportId: admitted.exportId, receipt: effectful,
  }, exactCompletionAuth(admitted.exportId)), 'run_result_export_integrity');

  const unknown = exportReceipt(admitted);
  unknown.callerOwned = true;
  assertRefusal(() => f.store.completeRunResultExport({
    schemaVersion: 1, exportId: admitted.exportId, receipt: unknown,
  }, exactCompletionAuth(admitted.exportId)), 'run_result_export_integrity');
  assert.equal(f.store.runResultExport(RUN_ID, NODE_KEY).status, 'pending');
});

test('completion append failure leaves the exact admission pending and retryable', (t) => {
  let failCompletion = false;
  const f = fixture(t, 'append-failure', {
    appendFile: (...args) => {
      if (failCompletion && args[1].includes('run.result_export_completed')) {
        throw new Error('export completion ledger unavailable');
      }
      return appendFileSync(...args);
    },
  });
  const admitted = f.store.admitRunResultExport(exportRequest(), admissionAuth()).export;
  const payload = { schemaVersion: 1, exportId: admitted.exportId, receipt: exportReceipt(admitted) };
  const before = f.store.snapshot().lastSeq;
  failCompletion = true;
  assert.throws(() => f.store.completeRunResultExport(
    payload, exactCompletionAuth(admitted.exportId),
  ), /export completion ledger unavailable/u);
  assert.equal(f.store.snapshot().lastSeq, before);
  assert.equal(f.store.runResultExport(RUN_ID, NODE_KEY).status, 'pending');
  assert.deepEqual(f.store.pendingRunResultExports(), [f.store.runResultExport(RUN_ID, NODE_KEY)]);
  failCompletion = false;
  assert.equal(f.store.completeRunResultExport(
    payload, exactCompletionAuth(admitted.exportId),
  ).export.status, 'completed');
});

test('restart reconstructs the exact pending reconciliation row and permits same-request completion', (t) => {
  const f = fixture(t, 'restart-pending');
  const request = exportRequest();
  const admitted = f.store.admitRunResultExport(request, admissionAuth()).export;
  f.store.releaseWriterLease({ requireOwned: true });

  const replay = new CoordinationStore(f.directory, {
    goalPlanPolicy: POLICY, operationalRead: f.operationalRead,
  });
  t.after(() => replay.releaseWriterLease());
  assert.deepEqual(replay.runResultExport(RUN_ID, NODE_KEY), admitted);
  assert.deepEqual(replay.pendingRunResultExports(), [admitted]);
  assert.equal(replay.admitRunResultExport(request, admissionAuth()).result, 'replay');
  const completed = replay.completeRunResultExport({
    schemaVersion: 1, exportId: admitted.exportId, receipt: exportReceipt(admitted),
  }, exactCompletionAuth(admitted.exportId));
  assert.equal(completed.export.status, 'completed');
  assert.deepEqual(replay.pendingRunResultExports(), []);
});

test('replay rejects tampered export admission, binding, and completion semantics', async (t) => {
  const cases = [
    ['admission', (event) => { event.payload.admissionDigest = '0'.repeat(64); }],
    ['binding', (event) => { event.payload.binding.accepted.plan.digest = '0'.repeat(64); }],
    ['receipt', (event) => {
      event.payload.receipt.checks.treeExact = false;
      const { receiptDigest: _old, ...core } = event.payload.receipt;
      event.payload.receipt.receiptDigest = digest(core);
    }],
  ];

  for (const [name, tamper] of cases) {
    await t.test(name, (inner) => {
      const f = fixture(inner, `tamper-${name}`);
      const admitted = f.store.admitRunResultExport(exportRequest(), admissionAuth()).export;
      if (name === 'receipt') {
        f.store.completeRunResultExport({
          schemaVersion: 1, exportId: admitted.exportId, receipt: exportReceipt(admitted),
        }, exactCompletionAuth(admitted.exportId));
      }
      f.store.releaseWriterLease({ requireOwned: true });
      const path = join(f.directory, 'events.jsonl');
      const rows = readFileSync(path, 'utf8').trimEnd().split('\n').map(JSON.parse);
      const event = rows.find((row) => row.kind === (name === 'receipt'
        ? 'run.result_export_completed' : 'run.result_export_admitted'));
      tamper(event);
      writeFileSync(path, `${rows.map(JSON.stringify).join('\n')}\n`);

      assert.throws(() => new CoordinationStore(f.directory, {
        goalPlanPolicy: POLICY, operationalRead: f.operationalRead,
      }), (error) => error instanceof CoordinationIntegrityError
        && error.code === 'run_result_export_integrity');
    });
  }
});

test('run stop fences both new export admission and pending export completion', async (t) => {
  await t.test('admission', (inner) => {
    const f = fixture(inner, 'stop-admission');
    stopRun(f.store, 'admission');
    assertRefusal(() => f.store.admitRunResultExport(exportRequest(), admissionAuth()), 'run_stopping');
    assert.equal(f.store.runResultExport(RUN_ID, NODE_KEY), null);
  });

  await t.test('completion', (inner) => {
    const f = fixture(inner, 'stop-completion');
    const admitted = f.store.admitRunResultExport(exportRequest(), admissionAuth()).export;
    stopRun(f.store, 'completion');
    assertRefusal(() => f.store.completeRunResultExport({
      schemaVersion: 1, exportId: admitted.exportId, receipt: exportReceipt(admitted),
    }, exactCompletionAuth(admitted.exportId)), 'run_stopping');
    const cancelled = f.store.runResultExport(RUN_ID, NODE_KEY);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancellation.kind, 'run_stop');
    assert.equal(cancelled.cancellation.runId, RUN_ID);
    assert.equal(cancelled.cancellation.exportId, admitted.exportId);
    assert.match(cancelled.cancellation.cancellationDigest, /^[a-f0-9]{64}$/u);
    assert.deepEqual(f.store.pendingRunResultExports(), []);
  });
});

test('CE15: export completion and stop admission have exactly two durable orderings', async (t) => {
  await t.test('completion wins before stop admission', (inner) => {
    const f = fixture(inner, 'completion-before-stop');
    const admitted = f.store.admitRunResultExport(exportRequest(), admissionAuth()).export;
    f.store.completeRunResultExport({
      schemaVersion: 1, exportId: admitted.exportId, receipt: exportReceipt(admitted),
    }, exactCompletionAuth(admitted.exportId));
    stopRun(f.store, 'after-completion');

    assert.equal(f.store.runResultExport(RUN_ID, NODE_KEY).status, 'completed');
    assert.deepEqual(f.store.pendingRunResultExports(), []);
  });

  await t.test('stop wins before completion', (inner) => {
    const f = fixture(inner, 'stop-before-completion');
    const admitted = f.store.admitRunResultExport(exportRequest(), admissionAuth()).export;
    const stopped = stopRun(f.store, 'before-completion');
    const cancelled = f.store.runResultExport(RUN_ID, NODE_KEY);

    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.cancellation.stopEvent, stopped.event.seq);
    assert.equal(cancelled.cancellation.exportId, admitted.exportId);
    assertRefusal(() => f.store.completeRunResultExport({
      schemaVersion: 1, exportId: admitted.exportId, receipt: exportReceipt(admitted),
    }, exactCompletionAuth(admitted.exportId)), 'run_stopping');
    assert.equal(f.store.runResultExport(RUN_ID, NODE_KEY).status, 'cancelled');
    assert.deepEqual(f.store.pendingRunResultExports(), []);
  });
});

test('CE15/CE16: restart preserves stopped-export cancellation with no publishable work', (t) => {
  const f = fixture(t, 'restart-cancelled');
  const admitted = f.store.admitRunResultExport(exportRequest(), admissionAuth()).export;
  const stopped = stopRun(f.store, 'restart-cancelled');
  f.store.releaseWriterLease({ requireOwned: true });

  const replay = new CoordinationStore(f.directory, {
    goalPlanPolicy: POLICY, operationalRead: f.operationalRead,
  });
  t.after(() => replay.releaseWriterLease());

  const cancelled = replay.runResultExport(RUN_ID, NODE_KEY);
  assert.equal(cancelled.exportId, admitted.exportId);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancellation.stopEvent, stopped.event.seq);
  assert.match(cancelled.cancellation.cancellationDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(replay.pendingRunResultExports(), []);
  assertRefusal(() => replay.completeRunResultExport({
    schemaVersion: 1, exportId: admitted.exportId, receipt: exportReceipt(admitted),
  }, exactCompletionAuth(admitted.exportId)), 'run_stopping');
});

test('asserted adoption, semantic-review, and integration prerequisites require exact durable backing', async (t) => {
  await t.test('all-backed', (inner) => {
    const f = fixture(inner, 'prerequisites-backed');
    const adoption = completeAdoption(f);
    const review = completeSemanticReview(f, 'prerequisites-backed');
    const integration = recordIntegration(f, 'prerequisites-backed');
    const request = exportRequest({
      adoptionReceiptDigest: adoption.receipt.receiptDigest,
      semanticReviewTaskId: review.taskId,
      semanticReviewReceiptDigest: review.receiptDigest,
      integrationAfterSha: integration.afterSha,
    });
    const admitted = f.store.admitRunResultExport(request, admissionAuth()).export;
    assert.deepEqual(admitted.binding.adoption, {
      admissionDigest: adoption.adoptionDigest, receiptDigest: adoption.receipt.receiptDigest,
    });
    assert.deepEqual(admitted.binding.semanticReview, {
      taskId: review.taskId, taskVersion: review.task.version, receiptDigest: review.receiptDigest,
    });
    assert.deepEqual(admitted.binding.integration, {
      artifactId: integration.artifact.id,
      artifactDigest: integration.artifact.digest,
      afterSha: integration.afterSha,
    });
  });

  const rejected = [
    ['adoption', { adoptionReceiptDigest: '9'.repeat(64) }],
    ['semantic-review', {
      semanticReviewTaskId: 'missing-review', semanticReviewReceiptDigest: '8'.repeat(64),
    }],
    ['integration', { integrationAfterSha: '7'.repeat(40) }],
  ];
  for (const [name, override] of rejected) {
    await t.test(`missing-${name}`, (inner) => {
      const f = fixture(inner, `prerequisites-missing-${name}`);
      assertRefusal(() => f.store.admitRunResultExport(
        exportRequest(override), admissionAuth(),
      ), 'run_result_export_unavailable');
      assert.deepEqual(f.store.pendingRunResultExports(), []);
    });
  }
});
