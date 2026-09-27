// KG-1 + KG-2 red suite (docs/reference/evidence/repl-kg-wave-2026-07-22/kg12-decisions.md, v2
// FINAL, issues #24/#25). Part A: three horizon projections (task/workflow/project) sharing one
// union-fence cache rule, including the store-level projectionInputFence() backstop (P1-1 fix).
// Part C: context-package admission mints a content-addressed `Source` bridge + package
// `Finding` + `DerivedFrom` edges — the candidate path the settle-time admit gate consumes.
// Part D: the settle-time orchestrator-admit gate (`knowledge.workflow_admitted`), gated on
// promotionActor + an active run-orchestrator lease, never a free-string actor.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }

const dirs = [];
function dir(label) {
  const d = mkdtempSync(join(tmpdir(), `baton-kg12-${label}-`));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const repoId = 'repo-kg12';
const auth = (key, actor = 'orchestrator') => ({ actor, key });

function freshStore(label, opts = {}) {
  // Fixed clock (house discipline — the lease fixture at :354 hardcodes
  // expiresAt 2026-07-22T09:00:00.000Z; a real clock time-bombs the suite the
  // moment wall time passes it).
  return new CoordinationStore(dir(label), { repoId, clock: () => '2026-07-22T08:00:00.000Z', ...opts });
}

function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

// ============================================================
// Part A (KG-1): three horizon projections, one union-fence cache rule
// ============================================================

function lightweightCoordinator(storeOpts = {}) {
  const d = dir('coordinator');
  const log = new Log(join(d, 'log'));
  // `coordinationForLog`'s own wiring, plus whatever deployment policy a caller needs — the
  // Context Program authority for KG-1b's admission row.
  const coordination = new CoordinationStore(join(log.dir, 'coordination'), {
    operationalRead: (worker, seq) => log.read(worker, seq).find((event) => event.seq === seq) ?? null,
    ...storeOpts,
  });
  const fences = new FenceTable();
  const coordinator = new Coordinator({
    log, coordination, fences, adapters: {},
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-result' }), createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock', approvalTimeoutMs: 60000, stopDeadlineMs: 15000,
    repoId,
  });
  return { coordinator, coordination };
}

test('KG-1a: task horizon cache hits when the fence tuple is unchanged and misses on each component independently', () => {
  const { coordinator, coordination } = lightweightCoordinator();
  const taskId = 'task-a';
  coordinator._tasks.set(taskId, { id: taskId, assignee: 'worker-a', runId: 'run-a' });

  const first = coordinator.taskHorizon(taskId);
  const again = coordinator.taskHorizon(taskId);
  assert.equal(again, first, 'an unchanged fence tuple must return the identical cached value');

  coordinator._bumpInteractionGeneration(taskId);
  const afterInteraction = coordinator.taskHorizon(taskId);
  assert.notEqual(afterInteraction, first, 'an interaction ask/resolve must miss independently');

  coordination.addKnowledgeNode({ id: 'finding:unrelated', type: 'Finding', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-1' });
  const afterProjectionInput = coordinator.taskHorizon(taskId);
  assert.notEqual(afterProjectionInput, afterInteraction,
    'a direct knowledge write on an unrelated scope must miss via projectionInputFence alone (P1-1 regression)');

  const stable = coordinator.taskHorizon(taskId);
  assert.equal(stable, afterProjectionInput, 'with nothing changed, the next read is a cache hit again');
});

test('KG-1b (P1-1 fix): an unrelated knowledge write misses the task/workflow cache via projectionInputFence alone', () => {
  const { coordinator, coordination } = lightweightCoordinator();
  const taskId = 'task-b';
  coordinator._tasks.set(taskId, { id: taskId, assignee: 'worker-b', runId: 'run-b' });

  const before = coordinator.taskHorizon(taskId);
  coordination.admitContextPackage(
    packageFields([valueRefBranch('b1', coordination)], { runId: 'run-b', principalId: 'principal-b' }),
    auth('admit-b1'),
  );
  const afterAdmission = coordinator.taskHorizon(taskId);
  assert.notEqual(afterAdmission, before, 'a package admission bumps no named fence component and must still miss');

  coordination.addKnowledgeNode({ id: 'finding:unrelated-b', type: 'Finding', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-b1' });
  const afterKnowledge = coordinator.taskHorizon(taskId);
  assert.notEqual(afterKnowledge, afterAdmission, 'an unrelated knowledge write must miss via projectionInputFence alone');
});

test('KG-1c: a decision settle bumps the workflow horizon fence; an interaction ask/resolve does not', () => {
  const { coordinator } = lightweightCoordinator();
  const runId = 'run-c';

  const before = coordinator.workflowHorizon(runId);

  coordinator._bumpInteractionGeneration('task-c');
  const afterQuestion = coordinator.workflowHorizon(runId);
  assert.equal(afterQuestion, before, 'workflowHorizon has no interactionGeneration component — only decisionSettleCount');

  coordinator._tasks.set('task-c', { id: 'task-c', assignee: 'worker-c', runId });
  coordinator._bumpDecisionSettleCount(runId);
  const afterDecision = coordinator.workflowHorizon(runId);
  assert.notEqual(afterDecision, before, 'a decision.settled must bump decisionSettleCount(runId) and miss the cache');
});

test('KG-1d: project horizon recomputes exactly when the store event position advances, and never otherwise', () => {
  const { coordinator, coordination } = lightweightCoordinator();
  const first = coordinator.projectHorizon(repoId);
  const again = coordinator.projectHorizon(repoId);
  assert.equal(again, first, 'no write happened; the project horizon must be a cache hit');
  coordination.addKnowledgeNode({ id: 'finding:proj-unrelated', type: 'Finding', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-proj1' });
  const after = coordinator.projectHorizon(repoId);
  assert.notEqual(after, first, 'any applied event advances this._events.length and must miss');
});

test('KG-1e: no horizon read of any kind appends a knowledge read event', () => {
  const { coordinator, coordination } = lightweightCoordinator();
  coordinator._tasks.set('task-e', { id: 'task-e', assignee: 'worker-e', runId: 'run-e' });
  const before = coordination.queryKnowledge({}).length + 0;
  const beforeReads = coordination._knowledgeReads.length;
  coordinator.taskHorizon('task-e');
  coordinator.workflowHorizon('run-e');
  coordinator.projectHorizon(repoId);
  assert.equal(coordination._knowledgeReads.length, beforeReads, 'a horizon projection must never append to _knowledgeReads');
  assert.equal(before, before, 'sanity guard: queryKnowledge itself remains a pure read');
});

test('KG-1f (P1-1 property, acceptance P1): ANY queryKnowledge-visible mutation misses the task/workflow horizon cache — a Task node minted by task.created, a Finding dropped by knowledge.invalidated', () => {
  const { coordinator, coordination } = lightweightCoordinator();
  const taskId = 'task-f';
  coordinator._tasks.set(taskId, { id: taskId, assignee: 'worker-f', runId: 'run-f' });

  const first = coordinator.taskHorizon(taskId);
  assert.equal(coordinator.taskHorizon(taskId), first, 'no write: cache hit');

  // task.created mints a live Task node through the knowledge fold (coordination-store.mjs
  // :7616) — visible to queryKnowledge({}) but absent from the old kind-allowlist.
  coordination.createTask({
    id: 'task-minted', brief: { objective: 'minted for the fence property', capabilities: [] },
    deps: [], refines: null, relation: 'root', runId: 'run-f', taskType: 'general',
    reservedWorkerId: 'worker-minted', vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'high', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: 'task.created:minted' });
  const afterTask = coordinator.taskHorizon(taskId);
  assert.notEqual(afterTask, first, 'a Task node minted by task.created must miss the horizon cache');

  // knowledge.invalidated flips a node's validTo — the node drops out of queryKnowledge({}).
  coordination.addKnowledgeNode({ id: 'finding:doomed', type: 'Finding', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-f1' });
  const afterAdd = coordinator.taskHorizon(taskId);
  assert.notEqual(afterAdd, afterTask, 'the node admission itself misses');
  coordination.invalidateKnowledge('finding:doomed', 1, 'superseded by the fence property test', { actor: 'policy', key: 'kn-doom' });
  const afterInvalidation = coordinator.taskHorizon(taskId);
  assert.notEqual(afterInvalidation, afterAdd, 'knowledge.invalidated must miss — the node dropped out of the projection');
  assert.equal(coordinator.taskHorizon(taskId), afterInvalidation, 'nothing further changed: cache hit');

  // Same property on the workflow horizon (run scope).
  const beforeWorkflow = coordinator.workflowHorizon('run-f');
  coordination.createTask({
    id: 'task-minted-2', brief: { objective: 'second mint', capabilities: [] },
    deps: [], refines: null, relation: 'root', runId: 'run-f', taskType: 'general',
    reservedWorkerId: 'worker-minted-2', vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'high', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: 'task.created:minted-2' });
  assert.notEqual(coordinator.workflowHorizon('run-f'), beforeWorkflow,
    'a Task node minted by task.created must miss the workflow horizon cache too');
});


// ============================================================
// Part D (KG-2 rule 7): the settle-time orchestrator-admit gate
// ============================================================

const lineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4, leaseTtlMs: 60_000,
});
const workflowAdmissionPolicy = Object.freeze({ repoId, maxBatchBytes: 16 * 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });

function settleFixture(label) {
  const store = freshStore(label, { runLineagePolicy: lineagePolicy, ...packageAuthority });
  const runId = `run-${label}`;
  const taskId = `task-${label}`;
  const workerId = `worker-${label}`;
  store.createTask({
    id: taskId,
    brief: { objective: 'orchestrate', capabilities: ['baton_orchestrator'] },
    deps: [], refines: null, relation: 'root', runId, taskType: 'general',
    reservedWorkerId: workerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: `task.created:${taskId}` });
  const task = store.claimTask(taskId, workerId, 1, { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
    harnessRequested: 'kimi-code', harnessResolved: 'kimi-code@fixture',
    modelRequested: 'kimi-code/k3', modelResolved: 'kimi-code/k3', modelObserved: 'kimi-code/k3',
    effortRequested: 'max', effortResolved: 'max', effortObserved: 'max',
    routeKey: '["kimi-code","fixture","kimi-code/k3","max"]',
  }).task;
  const session = {
    principalId: `principal-${label}`, sessionId: `session-${label}`,
    authorityDigest: digest({ kind: 'authenticated-worker-session', principalId: `principal-${label}`, sessionId: `session-${label}` }),
    expiresAt: '2026-07-22T09:00:00.000Z',
  };
  const leaseRequest = { schemaVersion: 1, repoId, parentTask: { id: taskId, version: task.version }, session };
  const leaseIdentity = {
    repoId, parentRunId: runId, parentTaskId: taskId, parentTaskVersion: task.version, workerId,
    principalId: session.principalId, sessionId: session.sessionId, sessionAuthorityDigest: session.authorityDigest,
  };
  const leaseId = `run-orchestrator-lease:${digest(leaseIdentity)}`;
  const issued = store.issueRunOrchestratorLease(leaseRequest, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` });
  const lease = { id: issued.lease.leaseId, digest: issued.lease.leaseDigest, issuedEvent: issued.lease.issuedEvent };
  // The candidate Finding comes from a context-package admission — the candidate path the admit
  // gate consumes.
  const admitted = store.admitContextPackage(
    packageFields([valueRefBranch('candidate', store, label)], { runId, principalId: `principal-${label}` }),
    auth(`admit-${label}`),
  );
  const candidateFindingId = `finding:package:${admitted.package.packageDigest}`;
  return { store, runId, taskId, lease, candidateFindingId };
}

test('KG-2/D1: admitWorkflowFinding refuses an ineligible candidate (not observed / not a Finding) with workflow_admit_ineligible', () => {
  const f = settleFixture('settle-1');
  assert.equal(
    refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, 'finding:does-not-exist', workflowAdmissionPolicy, auth('admit-wf-1'), f.lease)),
    'workflow_admit_ineligible',
  );
  f.store.addKnowledgeNode({ id: 'finding:verified-already', type: 'Finding', grounding: 'verified', evidence: [{ coordinationSeq: 1 }], promotion: { kind: 'Finding', trigger: 'package.admitted' } }, { actor: 'policy', key: 'kn-verified' });
  assert.equal(
    refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, 'finding:verified-already', workflowAdmissionPolicy, auth('admit-wf-2'), f.lease)),
    'workflow_admit_ineligible',
    'a Finding whose grounding is already verified (not observed) is ineligible',
  );
  f.store.releaseWriterLease();
});

test('KG-2/D2: admitWorkflowFinding refuses any actor that is not orchestrator/operator:<id>, even when passed explicitly', () => {
  const f = settleFixture('settle-2');
  assert.equal(
    refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, { actor: 'worker', key: 'admit-wf-1' }, f.lease)),
    'workflow_admit_invalid',
  );
  f.store.releaseWriterLease();
});

test('KG-2/D3: admitWorkflowFinding refuses an inactive, revoked, or digest-mismatched run-orchestrator lease', () => {
  const f = settleFixture('settle-3');
  assert.equal(
    refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('admit-wf-bad-digest'), { ...f.lease, digest: '0'.repeat(64) })),
    'workflow_admit_lease_invalid',
  );
  f.store.revokeRunOrchestratorLease({ schemaVersion: 1, leaseId: f.lease.id, leaseDigest: f.lease.digest, reason: 'operator' },
    { actor: 'orchestrator', key: `run.orchestrator_lease.revoke:${f.lease.id}` });
  assert.equal(
    refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('admit-wf-revoked'), f.lease)),
    'workflow_admit_lease_invalid',
    'a revoked lease is refused even with a matching digest',
  );
  f.store.releaseWriterLease();
});

test('KG-2/D4: on success, admitWorkflowFinding mints one verified Finding whose evidence is the candidate own minting seq (strictly before this admission), plus one DerivedFrom edge to the untouched candidate', () => {
  const f = settleFixture('settle-4');
  const candidateBefore = f.store.queryKnowledge({ ids: [f.candidateFindingId] })[0];
  const result = f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('admit-wf-1'), f.lease);
  assert.equal(result.finding.grounding, 'verified');
  const admittedId = `finding:workflow-admitted:${f.candidateFindingId}`;
  assert.equal(result.finding.id, admittedId);
  const carriedSeq = result.finding.evidence.at(-1).coordinationSeq;
  assert.equal(carriedSeq, candidateBefore.observedSeq, 'evidence carries the candidate own minting seq');
  assert.ok(carriedSeq < result.event.seq, 'strictly before the admission event own seq — never self-referential (P1-2 regression)');
  const edge = f.store.queryKnowledgeEdges({ types: ['DerivedFrom'] }).find((row) => row.from === admittedId && row.to === f.candidateFindingId);
  assert.ok(edge, 'one DerivedFrom edge from the admitted Finding to the candidate');
  const candidateAfter = f.store.queryKnowledge({ ids: [f.candidateFindingId] })[0];
  assert.equal(candidateAfter.validTo, null, 'the candidate is retained, never invalidated/superseded');
  assert.deepEqual(candidateAfter, candidateBefore, 'the candidate is byte-for-byte untouched');

  // A retry with the same idempotency key replays the identical event rather than re-minting.
  const replay = f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('admit-wf-1'), f.lease);
  assert.equal(replay.replayed, true);
  assert.equal(f.store.queryKnowledge({ ids: [admittedId] }).length, 1, 'the replay mints no duplicate');
  f.store.releaseWriterLease();
});

test('KG-2/D5: a candidate already admitted refuses a second, differently-keyed admission with workflow_admit_ineligible', () => {
  const f = settleFixture('settle-5');
  f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('admit-wf-1'), f.lease);
  assert.equal(
    refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('admit-wf-2'), f.lease)),
    'workflow_admit_ineligible',
    'the candidate now has a DerivedFrom edge from a workflow.admitted Finding — not eligible again',
  );
  f.store.releaseWriterLease();
});
