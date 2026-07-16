import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoordinationIntegrityError, CoordinationRefusal, CoordinationStore,
} from '../src/coordination-store.mjs';

const root = (name) => mkdtempSync(join(tmpdir(), `baton-phase64-finalization-${name}-`));
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const resultSha = 'a'.repeat(40);
const resultRef = `refs/baton/results/${resultSha}`;
const runId = 'run-finalization';
const nodeKey = 'work';
const taskId = 'task-finalization';

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-finalization',
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
const budget = (tokens) => ({ tokens, usd: 1, wallMin: 10, providerTurns: 4 });
const verification = Object.freeze({
  command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000,
  requiredPredecessorEvidence: [],
});
const auth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId,
  sessionDigest: digest(`session:${principalId}`), repoId: policy.repoId, runId, key,
});
const ref = (kind, value) => ({ [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest });

function request(fields = {}) {
  const core = {
    repoId: policy.repoId, runId, nodeKey, taskId, resultSha,
    evidenceDigest: 'b'.repeat(64), reasonDigest: 'c'.repeat(64), ...fields,
  };
  return { schemaVersion: 1, ...core, requestDigest: digest(core) };
}

function admissionAuth() {
  return { actor: 'direct:result-owner', key: `run.result_adoption:${runId}:${nodeKey}` };
}

function completionAuth() {
  return { actor: 'direct:result-owner', key: `run.result_adoption.complete:${runId}:${nodeKey}` };
}

function receipt(adoption, changes = {}) {
  const core = {
    schemaVersion: 1, state: 'adopted', scope: 'run-result', repoId: adoption.repoId,
    runId: adoption.runId, nodeKey: adoption.nodeKey, taskId: adoption.taskId,
    binding: {
      admissionDigest: adoption.adoptionDigest, evidenceDigest: adoption.evidenceDigest,
      goalDigest: adoption.binding.goal.digest, planDigest: adoption.binding.plan.digest,
      approvalDigest: adoption.binding.approvalDigest,
      commitArtifactId: adoption.binding.commitArtifact.id,
      commitArtifactDigest: adoption.binding.commitArtifact.digest,
      verificationArtifactId: adoption.binding.verificationArtifact.id,
      verificationArtifactDigest: adoption.binding.verificationArtifact.digest,
    },
    result: { sha: adoption.resultSha, ref: adoption.retainedResultRef },
    checks: {
      taskAccepted: true, verificationAccepted: true, refPinned: true,
      mainUnchanged: true, worktreeIndependent: true,
    },
    effects: { mainHeadChanged: false, indexChanged: false, workingTreeChanged: false, published: false },
    ...changes,
  };
  return { ...core, receiptDigest: digest(core) };
}

function fixture(name, { appendFile = appendFileSync } = {}) {
  const directory = root(name);
  const operational = new Map();
  const operationalRead = (worker, seq) => operational.get(`${worker}:${seq}`) ?? null;
  const store = new CoordinationStore(directory, {
    goalPlanPolicy: policy, operationalRead, appendFile,
    clock: () => '2026-07-14T03:00:00.000Z',
  });
  const goal = store.defineGoal({
    objective: 'Preserve the accepted result without merging it',
    definitionOfDone: ['The accepted commit remains addressable'], constraints: ['Do not merge'],
    risk: 'high', budget: budget(20_000), predecessor: null,
  }, auth('goal-owner', `${name}:goal`)).goal;
  const plan = store.proposePlan({
    goal: ref('goal', goal), predecessor: null,
    nodes: [{
      key: nodeKey, objective: 'Produce one verified retained result',
      definitionOfDone: ['The accepted commit remains addressable'], deps: [], pathScope: ['impl/**'], risk: 'high',
      budget: budget(10_000), verification, routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] },
      capabilities: ['code', 'test'], effects: ['repository_edit'],
    }],
  }, auth('planner', `${name}:plan`)).plan;
  store.approvePlan({
    goal: ref('goal', goal), plan: ref('plan', plan), expectedDisposition: null, disposition: 'approved',
  }, auth('approver', `${name}:approve`));
  const gate = {
    goalId: goal.goalId, goalVersion: goal.version, goalDigest: goal.digest,
    planId: plan.planId, planVersion: plan.version, planDigest: plan.digest,
    nodeKey, expectedDispatchVersion: 0, capabilities: ['code', 'test'], effects: ['repository_edit'],
  };
  const route = { vendor: 'mock', model: 'model-a', effort: 'low' };
  const state = store.previewPlanDispatch(gate, route);
  store.createPlanGatedTask({
    id: taskId, brief: state.brief, deps: state.resolvedDeps, refines: null, runId,
    taskType: 'general', reservedWorkerId: 'worker-finalization', vendorRequested: route.vendor,
    modelRequested: route.model, modelPolicy: null, effortRequested: route.effort,
    effortResolved: null, effortObserved: null, routeKey: null, sessionRequest: { mode: 'new' },
  }, gate, route, auth('dispatcher', `${name}:dispatch`));
  const claimed = store.claimTask(taskId, 'worker-finalization', 1, { actor: 'orchestrator', key: `${name}:claim` });
  const verify = {
    worker: 'worker-finalization', taskId, seq: 7, ts: '2026-07-14T03:00:00.000Z',
    kind: 'verify.reverified', actor: 'policy', payload: { accept: true },
  };
  operational.set('worker-finalization:7', verify);
  const mapped = store.mapOperationalEvent(verify, { actor: 'policy', key: `${name}:map` });
  const terminal = store.transitionTaskWithArtifacts(taskId, 'completed', claimed.task.version, [
    {
      taskId, kind: 'commit', refs: { sha: resultSha, retainedResultRef: resultRef },
      mediaType: 'application/vnd.git.commit', accepted: true, provenance: [mapped.evidence],
    },
    {
      taskId, kind: 'verification', refs: { worker: 'worker-finalization', workerSeq: 7 },
      mediaType: 'application/vnd.baton.verdict+json', accepted: true, provenance: [mapped.evidence],
    },
  ], { actor: 'policy', key: `${name}:terminal` }, mapped.evidence);
  return { directory, operational, operationalRead, store, terminal };
}

test('RF1: accepted commit artifacts may name only their exact deterministic protected result ref', () => {
  const f = fixture('protected-ref');
  assert.equal(f.terminal.artifacts.find((artifact) => artifact.kind === 'commit').refs.retainedResultRef, resultRef);

  const bad = fixture('bad-protected-ref-base');
  const task = bad.store.task(taskId);
  assert.throws(() => bad.store.registerArtifact({
    taskId, kind: 'commit', refs: { sha: resultSha, retainedResultRef: `refs/baton/results/${'d'.repeat(40)}` },
    accepted: true, provenance: [bad.terminal.artifacts[0].provenance[0]],
  }, { actor: 'policy', key: 'bad-protected-ref' }),
  (error) => error instanceof CoordinationRefusal && error.code === 'result_ref_invalid');
  assert.equal(bad.store.task(taskId).artifactIds.length, task.artifactIds.length);

  f.store.releaseWriterLease({ requireOwned: true });
  const replay = new CoordinationStore(f.directory, { goalPlanPolicy: policy, operationalRead: f.operationalRead });
  assert.equal(replay.artifact(f.terminal.artifacts[0].id).refs.retainedResultRef, resultRef);
});

test('RF2: admission binds the exact completed Plan task, active accepted artifacts, evidence, and request identity', () => {
  const f = fixture('admit');
  const admitted = f.store.admitRunResultAdoption(request(), admissionAuth());
  assert.equal(admitted.result, 'admitted');
  assert.equal(admitted.adoption.status, 'pending');
  assert.equal(admitted.adoption.retainedResultRef, resultRef);
  assert.equal(admitted.adoption.binding.commitArtifact.id, f.terminal.artifacts[0].id);
  assert.equal(admitted.adoption.binding.verificationArtifact.id, f.terminal.artifacts[1].id);
  assert.deepEqual(f.store.pendingRunResultAdoptions(), [admitted.adoption]);
  assert.equal(f.store.admitRunResultAdoption(request(), admissionAuth()).result, 'replay');

  const changed = request({ evidenceDigest: 'd'.repeat(64) });
  assert.throws(() => f.store.admitRunResultAdoption(changed, admissionAuth()),
    (error) => error instanceof CoordinationRefusal && error.code === 'run_result_adoption_conflict');
  assert.equal(f.store.events().filter((event) => event.kind === 'run.result_adoption_admitted').length, 1);

  const wrongSha = request({ resultSha: 'e'.repeat(40) });
  assert.throws(() => fixture('wrong-result').store.admitRunResultAdoption(wrongSha, admissionAuth()),
    (error) => error instanceof CoordinationRefusal && error.code === 'run_result_adoption_unavailable');

  const superseded = fixture('superseded-result');
  const replacement = superseded.store.registerArtifact({
    taskId, kind: 'commit', refs: { sha: 'f'.repeat(40) }, accepted: false,
    provenance: [superseded.terminal.artifacts[0].provenance[0]],
  }, { actor: 'policy', key: 'superseded-result:replacement' }).artifact;
  superseded.store.supersedeArtifact(
    superseded.terminal.artifacts[0].id, replacement.id, 1,
    { actor: 'policy', key: 'superseded-result:supersede' },
  );
  assert.throws(() => superseded.store.admitRunResultAdoption(request(), admissionAuth()),
    (error) => error instanceof CoordinationRefusal && error.code === 'run_result_adoption_unavailable');

  const expected = f.store.runResultAdoption(runId, nodeKey);
  f.store.releaseWriterLease({ requireOwned: true });
  const replay = new CoordinationStore(f.directory, { goalPlanPolicy: policy, operationalRead: f.operationalRead });
  assert.deepEqual(replay.runResultAdoption(runId, nodeKey), expected);
  assert.deepEqual(replay.pendingRunResultAdoptions(), [expected]);
});

test('RF3: completion is exact, immutable, idempotent, restart-safe, and removes the pending reconciliation row', () => {
  const f = fixture('complete');
  const admitted = f.store.admitRunResultAdoption(request(), admissionAuth()).adoption;
  const adoptedReceipt = receipt(admitted);
  const completed = f.store.completeRunResultAdoption({
    schemaVersion: 1, runId, nodeKey, receipt: adoptedReceipt,
  }, completionAuth());
  assert.equal(completed.result, 'completed');
  assert.equal(completed.adoption.status, 'adopted');
  assert.deepEqual(completed.adoption.receipt, adoptedReceipt);
  assert.deepEqual(f.store.pendingRunResultAdoptions(), []);
  assert.equal(f.store.completeRunResultAdoption({
    schemaVersion: 1, runId, nodeKey, receipt: adoptedReceipt,
  }, completionAuth()).result, 'replay');

  const changedReceipt = receipt(admitted, { result: { sha: resultSha, ref: `refs/baton/results/${'f'.repeat(40)}` } });
  assert.throws(() => f.store.completeRunResultAdoption({
    schemaVersion: 1, runId, nodeKey, receipt: changedReceipt,
  }, completionAuth()), (error) => error instanceof CoordinationRefusal && error.code === 'run_result_adoption_conflict');

  const expected = f.store.runResultAdoption(runId, nodeKey);
  f.store.releaseWriterLease({ requireOwned: true });
  const replay = new CoordinationStore(f.directory, { goalPlanPolicy: policy, operationalRead: f.operationalRead });
  assert.deepEqual(replay.runResultAdoption(runId, nodeKey), expected);
  assert.deepEqual(replay.pendingRunResultAdoptions(), []);
});

test('RF4: append failure creates neither false admission state nor a durable adoption event', () => {
  let fail = false;
  const f = fixture('append-failure', {
    appendFile: (...args) => {
      if (fail && args[1].includes('run.result_adoption_admitted')) throw new Error('adoption ledger unavailable');
      return appendFileSync(...args);
    },
  });
  const before = f.store.snapshot().lastSeq;
  fail = true;
  assert.throws(() => f.store.admitRunResultAdoption(request(), admissionAuth()), /adoption ledger unavailable/);
  assert.equal(f.store.snapshot().lastSeq, before);
  assert.equal(f.store.runResultAdoption(runId, nodeKey), null);
  assert.deepEqual(f.store.pendingRunResultAdoptions(), []);
});

test('RF4: completion append failure leaves the exact admission pending and retryable', () => {
  let fail = false;
  const f = fixture('completion-append-failure', {
    appendFile: (...args) => {
      if (fail && args[1].includes('run.result_adoption_completed')) throw new Error('completion ledger unavailable');
      return appendFileSync(...args);
    },
  });
  const admitted = f.store.admitRunResultAdoption(request(), admissionAuth()).adoption;
  const adoptedReceipt = receipt(admitted);
  const before = f.store.snapshot().lastSeq;
  fail = true;
  assert.throws(() => f.store.completeRunResultAdoption({
    schemaVersion: 1, runId, nodeKey, receipt: adoptedReceipt,
  }, completionAuth()), /completion ledger unavailable/);
  assert.equal(f.store.snapshot().lastSeq, before);
  assert.equal(f.store.runResultAdoption(runId, nodeKey).status, 'pending');
  assert.equal(f.store.pendingRunResultAdoptions().length, 1);
  fail = false;
  assert.equal(f.store.completeRunResultAdoption({
    schemaVersion: 1, runId, nodeKey, receipt: adoptedReceipt,
  }, completionAuth()).adoption.status, 'adopted');
});

test('RF5: replay rejects tampered adoption binding and malformed protected result refs', () => {
  const binding = fixture('tamper-binding');
  binding.store.admitRunResultAdoption(request(), admissionAuth());
  binding.store.releaseWriterLease({ requireOwned: true });
  const file = join(binding.directory, 'events.jsonl');
  const original = readFileSync(file, 'utf8');
  const rows = original.trimEnd().split('\n').map(JSON.parse);
  rows.find((event) => event.kind === 'run.result_adoption_admitted').payload.binding.plan.digest = '0'.repeat(64);
  writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(binding.directory, {
    goalPlanPolicy: policy, operationalRead: binding.operationalRead,
  }), (error) => error instanceof CoordinationIntegrityError && error.code === 'run_result_adoption_integrity');

  writeFileSync(file, original);
  const artifactRows = original.trimEnd().split('\n').map(JSON.parse);
  artifactRows.find((event) => event.kind === 'artifact.registered' && event.payload.kind === 'commit')
    .payload.refs.retainedResultRef = `refs/baton/results/${'9'.repeat(40)}`;
  writeFileSync(file, `${artifactRows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(binding.directory, {
    goalPlanPolicy: policy, operationalRead: binding.operationalRead,
  }), (error) => error instanceof CoordinationIntegrityError && error.code === 'run_result_ref_integrity');
});

test('RF6: replay recomputes completion semantics instead of trusting a self-consistent forged receipt digest', () => {
  const f = fixture('tamper-completion');
  const admitted = f.store.admitRunResultAdoption(request(), admissionAuth()).adoption;
  f.store.completeRunResultAdoption({
    schemaVersion: 1, runId, nodeKey, receipt: receipt(admitted),
  }, completionAuth());
  f.store.releaseWriterLease({ requireOwned: true });
  const file = join(f.directory, 'events.jsonl');
  const rows = readFileSync(file, 'utf8').trimEnd().split('\n').map(JSON.parse);
  const completion = rows.find((event) => event.kind === 'run.result_adoption_completed');
  completion.payload.receipt.checks.mainUnchanged = false;
  const { receiptDigest: _old, ...core } = completion.payload.receipt;
  completion.payload.receipt.receiptDigest = digest(core);
  writeFileSync(file, `${rows.map(JSON.stringify).join('\n')}\n`);
  assert.throws(() => new CoordinationStore(f.directory, {
    goalPlanPolicy: policy, operationalRead: f.operationalRead,
  }), (error) => error instanceof CoordinationIntegrityError && error.code === 'run_result_adoption_integrity');
});
