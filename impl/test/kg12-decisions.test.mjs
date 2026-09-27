// KG-1 + KG-2 red suite (docs/reference/evidence/repl-kg-wave-2026-07-22/kg12-decisions.md, v2
// FINAL, issues #24/#25). Part A: three horizon projections (task/workflow/project) sharing one
// union-fence cache rule, including the store-level projectionInputFence() backstop (P1-1 fix).
// Part B: board-item close mints a candidate `Finding` atomically. Part C: context-package
// admission mints a content-addressed `Source` bridge + package `Finding` + `DerivedFrom` edges.
// Part D: the settle-time orchestrator-admit gate (`knowledge.workflow_admitted`), gated on
// promotionActor + an active run-orchestrator lease, never a free-string actor.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, coordinationForLog } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { DEFAULT_CONTEXT_PROGRAM_POLICY, normalizeContextProgramPolicy } from '../src/context-program-policy.mjs';

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

function lightweightCoordinator() {
  const d = dir('coordinator');
  const log = new Log(join(d, 'log'));
  const coordination = coordinationForLog(log);
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

  const first = coordinator.taskHorizon(taskId, { board: 'shared' });
  const again = coordinator.taskHorizon(taskId, { board: 'shared' });
  assert.equal(again, first, 'an unchanged fence tuple must return the identical cached value');

  coordination.postBoardItem({ board: 'shared', title: 'X' }, auth('post-1'));
  const afterBoard = coordinator.taskHorizon(taskId, { board: 'shared' });
  assert.notEqual(afterBoard, first, 'a board post must miss the task-horizon cache (boardFence moved)');

  coordinator._bumpInteractionGeneration(taskId);
  const afterInteraction = coordinator.taskHorizon(taskId, { board: 'shared' });
  assert.notEqual(afterInteraction, afterBoard, 'an interaction ask/resolve must miss independently');

  coordination.addKnowledgeNode({ id: 'finding:unrelated', type: 'Finding', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-1' });
  const afterProjectionInput = coordinator.taskHorizon(taskId, { board: 'shared' });
  assert.notEqual(afterProjectionInput, afterInteraction,
    'a direct knowledge write on an unrelated scope must miss via projectionInputFence alone (P1-1 regression)');

  const stable = coordinator.taskHorizon(taskId, { board: 'shared' });
  assert.equal(stable, afterProjectionInput, 'with nothing changed, the next read is a cache hit again');
});

test('KG-1b (P1-1 fix): a board claim/report, a package admission, or an unrelated knowledge write misses the task/workflow cache via projectionInputFence alone', () => {
  const { coordinator, coordination } = lightweightCoordinator();
  const taskId = 'task-b';
  coordinator._tasks.set(taskId, { id: taskId, assignee: 'worker-b', runId: 'run-b' });
  const posted = coordination.postBoardItem({ board: 'shared-b', title: 'X', owner: 'worker-b' }, auth('post-b1'));

  const before = coordinator.taskHorizon(taskId, { board: 'shared-b' });
  coordination.requestBoardClaim({ itemId: posted.item.itemId, owner: 'worker-b', expectedBoardFence: 1 }, auth('claim-b1', 'worker'));
  const afterClaim = coordinator.taskHorizon(taskId, { board: 'shared-b' });
  assert.notEqual(afterClaim, before, 'board.claim_requested never bumps boardFence but must still miss');

  coordination.submitBoardReport({ itemId: posted.item.itemId, itemVersion: 1, itemDigest: posted.item.itemDigest, owner: 'worker-b', body: 'note' }, auth('report-b1', 'worker'));
  const afterReport = coordinator.taskHorizon(taskId, { board: 'shared-b' });
  assert.notEqual(afterReport, afterClaim, 'board.report_submitted never bumps boardFence but must still miss');
});

test('KG-1c: workflow horizon fence unions every board attached to the run; a decision settle bumps it, an approval/question resolve does not', () => {
  const { coordinator, coordination } = lightweightCoordinator();
  const runId = 'run-c';
  coordination.postBoardItem({ board: 'run-c-board', title: 'X' }, auth('post-c1'));
  // A direct attachment covers rule 3's `board:<name>` scope convention without requiring a full
  // context-program-policy fixture (this lightweight coordinator's store has none configured).
  coordination._contextPackageAttachments.set(runId, [
    { packageDigest: 'pkg-c1', scope: 'board:run-c-board', attachedEvent: 1, attachedAt: coordination._clock() },
  ]);
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
  coordination.postBoardItem({ board: 'proj-board', title: 'X' }, auth('post-proj1'));
  const after = coordinator.projectHorizon(repoId);
  assert.notEqual(after, first, 'any applied event advances this._events.length and must miss');
});

test('KG-1e: no horizon read of any kind appends a knowledge read event', () => {
  const { coordinator, coordination } = lightweightCoordinator();
  coordinator._tasks.set('task-e', { id: 'task-e', assignee: 'worker-e', runId: 'run-e' });
  const before = coordination.queryKnowledge({}).length + 0;
  const beforeReads = coordination._knowledgeReads.length;
  coordinator.taskHorizon('task-e', { board: null });
  coordinator.workflowHorizon('run-e');
  coordinator.projectHorizon(repoId);
  assert.equal(coordination._knowledgeReads.length, beforeReads, 'a horizon projection must never append to _knowledgeReads');
  assert.equal(before, before, 'sanity guard: queryKnowledge itself remains a pure read');
});

test('KG-1f (P1-1 property, acceptance P1): ANY queryKnowledge-visible mutation misses the task/workflow horizon cache — a Task node minted by task.created, a Finding dropped by knowledge.invalidated', () => {
  const { coordinator, coordination } = lightweightCoordinator();
  const taskId = 'task-f';
  coordinator._tasks.set(taskId, { id: taskId, assignee: 'worker-f', runId: 'run-f' });

  const first = coordinator.taskHorizon(taskId, { board: 'shared-f' });
  assert.equal(coordinator.taskHorizon(taskId, { board: 'shared-f' }), first, 'no write: cache hit');

  // task.created mints a live Task node through the knowledge fold (coordination-store.mjs
  // :7616) — visible to queryKnowledge({}) but absent from the old kind-allowlist.
  coordination.createTask({
    id: 'task-minted', brief: { objective: 'minted for the fence property', capabilities: [] },
    deps: [], refines: null, relation: 'root', runId: 'run-f', taskType: 'general',
    reservedWorkerId: 'worker-minted', vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
    modelPolicy: null, effortRequested: 'high', sessionRequest: { mode: 'new' },
  }, { actor: 'orchestrator', key: 'task.created:minted' });
  const afterTask = coordinator.taskHorizon(taskId, { board: 'shared-f' });
  assert.notEqual(afterTask, first, 'a Task node minted by task.created must miss the horizon cache');

  // knowledge.invalidated flips a node's validTo — the node drops out of queryKnowledge({}).
  coordination.addKnowledgeNode({ id: 'finding:doomed', type: 'Finding', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-f1' });
  const afterAdd = coordinator.taskHorizon(taskId, { board: 'shared-f' });
  assert.notEqual(afterAdd, afterTask, 'the node admission itself misses');
  coordination.invalidateKnowledge('finding:doomed', 1, 'superseded by the fence property test', { actor: 'policy', key: 'kn-doom' });
  const afterInvalidation = coordinator.taskHorizon(taskId, { board: 'shared-f' });
  assert.notEqual(afterInvalidation, afterAdd, 'knowledge.invalidated must miss — the node dropped out of the projection');
  assert.equal(coordinator.taskHorizon(taskId, { board: 'shared-f' }), afterInvalidation, 'nothing further changed: cache hit');

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
// Part B (KG-2 rule 5): board-close mints a candidate Finding
// ============================================================

test('KG-2/B1: closing a board item mints exactly one Finding, grounding observed, evidence at the close event own seq, and a matching boardItemRef', () => {
  const store = freshStore('board-close-1');
  const posted = store.postBoardItem({ board: 'b1', title: 'do the thing', owner: 'w1' }, auth('post-1'));
  const before = store.queryKnowledge({ types: ['Finding'] }).length;
  const closed = store.closeBoardItem(posted.item.itemId, auth('close-1'));
  assert.equal(closed.event.kind, 'board.item_closed');
  const findings = store.queryKnowledge({ types: ['Finding'] });
  assert.equal(findings.length, before + 1, 'exactly one Finding is minted');
  const finding = findings.find((node) => node.id === `finding:board-close:${posted.item.itemId}:${posted.item.itemVersion + 1}`);
  assert.ok(finding, 'the Finding id is deterministic per closed item-version');
  assert.equal(finding.grounding, 'observed');
  assert.deepEqual(finding.evidence, [{ coordinationSeq: closed.event.seq }], 'evidence points at the close event own seq');
  assert.deepEqual(finding.boardItemRef, {
    itemId: posted.item.itemId, itemVersion: closed.item.itemVersion, itemDigest: closed.item.itemDigest,
  }, 'boardItemRef carries the exact closed-item triple');
  assert.equal(finding.promotion?.trigger, 'board.item_closed');
  const mintEvent = store._events.find((event) => event.payload?.id === finding.id);
  assert.equal(mintEvent.actor, 'policy', 'the Finding is minted with a hardcoded policy actor regardless of the close actor');
  store.releaseWriterLease();
});

test('KG-2/B2: a hardcoded policy actor applies regardless of the actor passed to closeBoardItem', () => {
  const store = freshStore('board-close-2');
  const posted = store.postBoardItem({ board: 'b2', title: 'x' }, auth('post-1', 'operator:op-1'));
  store.closeBoardItem(posted.item.itemId, auth('close-1', 'operator:op-1'));
  const findingId = `finding:board-close:${posted.item.itemId}:${posted.item.itemVersion + 1}`;
  const mintEvent = store._events.find((event) => event.payload?.id === findingId);
  assert.equal(mintEvent.actor, 'policy');
  store.releaseWriterLease();
});

test('KG-2/B3: replaying the same idempotency key mints no duplicate Finding; a second close with a different key refuses board_item_not_open', () => {
  const store = freshStore('board-close-3');
  const posted = store.postBoardItem({ board: 'b3', title: 'x' }, auth('post-1'));
  store.closeBoardItem(posted.item.itemId, auth('close-1'));
  const countAfterFirst = store.queryKnowledge({ types: ['Finding'] }).length;
  store.closeBoardItem(posted.item.itemId, auth('close-1'));
  assert.equal(store.queryKnowledge({ types: ['Finding'] }).length, countAfterFirst, 'idempotent replay mints nothing new');
  assert.equal(
    refusalCode(() => store.closeBoardItem(posted.item.itemId, auth('close-2'))),
    'board_item_not_open',
    'a second close with a different idempotency key is refused by the state-machine guard, not id collision',
  );
  assert.equal(store.queryKnowledge({ types: ['Finding'] }).length, countAfterFirst, 'the refused second close mints nothing');
  store.releaseWriterLease();
});

test('KG-2/B4: the Finding id never collides across two different items or two versions of the same item', () => {
  const store = freshStore('board-close-4');
  const a = store.postBoardItem({ board: 'b4', title: 'a' }, auth('post-a'));
  const b = store.postBoardItem({ board: 'b4', title: 'b' }, auth('post-b'));
  store.closeBoardItem(a.item.itemId, auth('close-a'));
  store.closeBoardItem(b.item.itemId, auth('close-b'));
  const findings = store.queryKnowledge({ types: ['Finding'] });
  const ids = findings.map((node) => node.id);
  assert.equal(new Set(ids).size, ids.length, 'no id collision across different items');

  const c = store.postBoardItem({ board: 'b4', title: 'c' }, auth('post-c'));
  store.retitleBoardItem(c.item.itemId, { title: 'c2' }, auth('retitle-c'));
  store.closeBoardItem(c.item.itemId, auth('close-c'));
  const findingsAfterRetitle = store.queryKnowledge({ types: ['Finding'] });
  assert.equal(new Set(findingsAfterRetitle.map((node) => node.id)).size, findingsAfterRetitle.length,
    'a retitled-then-closed item still mints a uniquely-versioned Finding id');
  store.releaseWriterLease();
});

// ============================================================
// Part C (KG-2 rule 6): package citation, Source-node bridge
// ============================================================

const programPolicy = normalizeContextProgramPolicy(DEFAULT_CONTEXT_PROGRAM_POLICY);

function packageStore(label) {
  return freshStore(label, {
    deploymentBaseSha: '1'.repeat(40),
    contextProgramPolicy: DEFAULT_CONTEXT_PROGRAM_POLICY,
    contextEnvironmentDigest: '2'.repeat(64),
    contextReferenceIdentity: '3'.repeat(64),
    contextReferenceRead: () => { throw Object.assign(new Error('unused in this suite'), { code: 'context_artifact_unavailable' }); },
    contextSourceAttest: () => { throw new Error('not used in this suite'); },
  });
}

function valueRefBranch(name, store, seed = name) {
  const artifactDigest = digest({ a: seed });
  const schemaId = `schema:${digest({ s: seed })}`;
  const valueDigest = digest({ v: seed });
  const lineageDigest = digest({ l: seed });
  const artifactId = `artifact:${seed}`;
  store._artifacts.set(artifactId, { id: artifactId, digest: artifactDigest });
  const valueId = `pvalue:${digest({ artifactDigest, schemaId, valueDigest, lineageDigest })}`;
  return {
    name, source: null, artifact: null, schema: null,
    valueRef: { kind: 'value_ref', valueId, artifactId, artifactDigest, schemaId, valueDigest, lineageDigest },
  };
}

function packageFields(branches, overrides = {}) {
  return {
    schemaVersion: 1, kind: 'baton.context_package', branches,
    provenance: { runId: overrides.runId ?? 'run-pkg', principalId: overrides.principalId ?? 'principal-pkg' },
    policyDigest: programPolicy.policyDigest,
  };
}

test('KG-2/C1: N branches wrapping M unique cells mint exactly M Source nodes and M DerivedFrom edges from one package Finding, all with a hardcoded policy actor', () => {
  const store = packageStore('package-1');
  const branches = [
    valueRefBranch('one', store), valueRefBranch('two', store),
    valueRefBranch('one-again', store, 'one'), // same cell content, wrapped a second time in this package
  ];
  const admitted = store.admitContextPackage(packageFields(branches), auth('admit-1'));
  const findingId = `finding:package:${admitted.package.packageDigest}`;
  const sources = store.queryKnowledge({ types: ['Source'] });
  assert.equal(sources.length, 2, 'exactly M=2 unique Source nodes are minted for N=3 branches');
  const edges = store.queryKnowledgeEdges({ types: ['DerivedFrom'] }).filter((edge) => edge.from === findingId);
  assert.equal(edges.length, 2, 'exactly M DerivedFrom edges from the one package Finding');
  const finding = store.queryKnowledge({ ids: [findingId] })[0];
  assert.ok(finding, 'the package Finding is minted unconditionally');
  assert.equal(finding.grounding, 'observed');
  for (const source of sources) {
    const mintEvent = store._events.find((event) => event.kind === 'knowledge.node_added' && event.payload?.id === source.id);
    assert.equal(mintEvent.actor, 'policy', 'every Source mint carries the hardcoded policy actor');
  }
  const findingMint = store._events.find((event) => event.payload?.id === findingId);
  assert.equal(findingMint.actor, 'policy');
  store.releaseWriterLease();
});

test('KG-2/C2: re-wrapping an already-cited cell in a second package mints zero additional Source nodes and reuses the existing one', () => {
  const store = packageStore('package-2');
  const first = store.admitContextPackage(packageFields([valueRefBranch('shared', store)], { runId: 'run-first' }), auth('admit-1'));
  const sourceCountAfterFirst = store.queryKnowledge({ types: ['Source'] }).length;
  const second = store.admitContextPackage(packageFields([valueRefBranch('shared', store)], { runId: 'run-second' }), auth('admit-2'));
  assert.equal(store.queryKnowledge({ types: ['Source'] }).length, sourceCountAfterFirst, 'no new Source node is minted');
  const sourceId = `source:cell:${digest({ v: 'shared' })}`;
  const firstFindingId = `finding:package:${first.package.packageDigest}`;
  const secondFindingId = `finding:package:${second.package.packageDigest}`;
  assert.notEqual(firstFindingId, secondFindingId, 'each package admission still mints its own Finding');
  const edgeToShared = store.queryKnowledgeEdges({ types: ['DerivedFrom'] }).filter((edge) => edge.to === sourceId);
  assert.equal(edgeToShared.length, 2, 'both packages DerivedFrom-cite the identical, reused Source node');
  store.releaseWriterLease();
});

test('KG-2/C3: a branch with no valueRef produces no Source node and no DerivedFrom edge', () => {
  const store = packageStore('package-3');
  const bareBranch = {
    name: 'bare', valueRef: null, schema: null,
    source: { kind: 'context_source', ref: `ctx:sha256:${'4'.repeat(64)}`, digest: '4'.repeat(64), mediaType: 'application/json', itemCount: 1 },
    artifact: null,
  };
  store._contextReferenceRead = (reference) => {
    if (reference.ref === bareBranch.source.ref) return { hello: 'bare' };
    throw Object.assign(new Error('unavailable'), { code: 'context_artifact_unavailable' });
  };
  const admitted = store.admitContextPackage(packageFields([bareBranch]), auth('admit-1'));
  assert.equal(store.queryKnowledge({ types: ['Source'] }).length, 0, 'no Source node for a bare source/artifact ref');
  const findingId = `finding:package:${admitted.package.packageDigest}`;
  assert.ok(store.queryKnowledge({ ids: [findingId] })[0], 'the package Finding is still minted');
  assert.equal(store.queryKnowledgeEdges({ types: ['DerivedFrom'] }).filter((edge) => edge.from === findingId).length, 0);
  store.releaseWriterLease();
});

// ============================================================
// Part D (KG-2 rule 7): the settle-time orchestrator-admit gate
// ============================================================

const lineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4, leaseTtlMs: 60_000,
});
const workflowAdmissionPolicy = Object.freeze({ repoId, maxBatchBytes: 16 * 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });

function settleFixture(label) {
  const store = freshStore(label, { runLineagePolicy: lineagePolicy });
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
  const posted = store.postBoardItem({ board: `board-${label}`, title: 'do the thing' }, auth(`post-${label}`));
  const closed = store.closeBoardItem(posted.item.itemId, auth(`close-${label}`));
  const candidateFindingId = `finding:board-close:${posted.item.itemId}:${closed.item.itemVersion}`;
  return { store, runId, taskId, lease, candidateFindingId, closed };
}

test('KG-2/D1: admitWorkflowFinding refuses an ineligible candidate (not observed / not a Finding) with workflow_admit_ineligible', () => {
  const f = settleFixture('settle-1');
  assert.equal(
    refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, 'finding:does-not-exist', workflowAdmissionPolicy, auth('admit-wf-1'), f.lease)),
    'workflow_admit_ineligible',
  );
  f.store.addKnowledgeNode({ id: 'finding:verified-already', type: 'Finding', grounding: 'verified', evidence: [{ coordinationSeq: 1 }], promotion: { kind: 'Finding', trigger: 'board.item_closed' } }, { actor: 'policy', key: 'kn-verified' });
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
