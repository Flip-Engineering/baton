// KG-1 + KG-2 red suite (docs/reference/evidence/repl-kg-wave-2026-07-22/kg12-decisions.md, v2
// FINAL, issues #24/#25). Part A: three horizon projections (task/workflow/project) sharing one
// union-fence cache rule, including the store-level projectionInputFence() backstop (P1-1 fix).

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



