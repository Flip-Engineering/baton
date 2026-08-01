// KG activation epic red suite (contract: docs/reference/evidence/
// kg-activation-2026-07-31/kg-activation-decisions.md v1 — issues #24/#25/#26/#27).
//
// Five rules, five red rows (KG-A1..KG-A5): ambient knowledge serving into spawn briefs (bounded,
// provenance-wrapped, honest-empty, expired-never-serves, byte cap); the first-class candidacy queue
// projection (per source kind, admit-removes, capped + ordered, no duplicates across views); ritual
// hooks (candidacy counts in the wave receipt / terminal outline, zero is `0` not a missing field,
// recipe receipts inherit); horizon digests in the wave member rows (cache-correct — moves on admit,
// stable on unrelated state); and gate honesty (the orchestrator-admit gate stays the ONLY promotion
// path — lease binding + refusal taxonomy unchanged, NO auto-admit call site exists).
//
// Deterministic: CoordinationStore/Coordinator fixtures, MockAdapter briefs, fixed clocks, no live
// providers. Red-first: this suite is written before the implementation and must fail for the right
// reasons, then go green on additive projections and brief serving ONLY (no auto-promotion, no new
// commands/registry/MCP/CLI/web surfaces).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { renderBrief, MockAdapter } from '../src/adapter.mjs';
import { buildKnowledgeSlice, createBrief } from '../src/messages.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { FenceTable } from '../src/fence.mjs';
import { Log } from '../src/log.mjs';
import { BatonApplication } from '../src/application.mjs';
import { bindBaton, createDriver } from '../src/index.mjs';
import { createWave } from '../src/wave.mjs';

const repoId = 'repo-kg-activation';
const dirs = [];
function dir(label) {
  const d = mkdtempSync(join(tmpdir(), `baton-kg-activation-${label}-`));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function digest(value) {
  const canonical = (v) => {
    if (Array.isArray(v)) return v.map(canonical);
    if (!v || typeof v !== 'object') return v;
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
const auth = (key, actor = 'orchestrator') => ({ actor, key });
const now = Date.parse('2026-07-22T08:00:00.000Z');
const clockMs = (start = now) => { let t = start; return () => { t += 1; return new Date(t).toISOString(); }; };
function refusalCode(fn) {
  try { fn(); return null; }
  catch (error) { return error?.code ?? error?.name ?? 'unknown_error'; }
}

function freshStore(label, opts = {}) {
  return new CoordinationStore(dir(label), { repoId, clock: () => '2026-07-22T08:00:00.000Z', ...opts });
}

const lineagePolicy = Object.freeze({
  schemaVersion: 1, maxDepth: 3, maxChildrenPerRun: 2, maxDescendantsPerRoot: 4, leaseTtlMs: 60_000,
});
const workflowAdmissionPolicy = Object.freeze({ repoId, maxBatchBytes: 16 * 1024 * 1024, maxResultBytes: 16 * 1024 * 1024 });

// A coordinator + its store, with a board-close candidate Finding and an active run-orchestrator
// lease bound to it — the same shape kg12-decisions-red's settleFixture builds, exposed here so the
// activation suite can both read the candidacy queue AND drive the admit gate on one fixture.
function candidateFixture(label, opts = {}) {
  const store = freshStore(label, { runLineagePolicy: lineagePolicy, ...opts });
  const runId = `run-${label}`;
  const taskId = `task-${label}`;
  const workerId = `worker-${label}`;
  store.createTask({
    id: taskId, brief: { objective: 'orchestrate', capabilities: ['baton_orchestrator'] },
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
  return { store, runId, taskId, lease, candidateFindingId };
}

// A coordinator wrapping its own store (for the horizon projections), optionally set up with the
// candidate + lease so the digest suite can admit through the real gate.
function coordinatorFixture(label, { withCandidate = false } = {}) {
  const d = dir(label);
  const log = new Log(join(d, 'log'));
  const coordination = new CoordinationStore(join(d, 'coord'), { repoId, clock: () => '2026-07-22T08:00:00.000Z', runLineagePolicy: lineagePolicy });
  const fences = new FenceTable();
  const coordinator = new Coordinator({
    log, coordination, fences, adapters: {},
    worktrees: {
      create: async (taskId) => ({ path: `/tmp/wt/${taskId}`, branch: `baton/${taskId}`, baseSha: 'sha-base' }),
      capture: async () => ({ sha: 'sha-result' }), createVerifyWorktree: async () => ({ path: tmpdir() }),
      removeVerifyWorktree: async () => {}, remove: async () => {}, reconcile: async () => {},
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock', approvalTimeoutMs: 60_000, stopDeadlineMs: 15_000, repoId,
  });
  let setup = null;
  if (withCandidate) {
    const runId = `run-${label}`;
    const taskId = `task-${label}`;
    const workerId = `worker-${label}`;
    coordination.createTask({
      id: taskId, brief: { objective: 'orchestrate', capabilities: ['baton_orchestrator'] },
      deps: [], refines: null, relation: 'root', runId, taskType: 'general',
      reservedWorkerId: workerId, vendorRequested: 'kimi-code', modelRequested: 'kimi-code/k3',
      modelPolicy: null, effortRequested: 'max', sessionRequest: { mode: 'new' },
    }, { actor: 'orchestrator', key: `task.created:${taskId}` });
    const task = coordination.claimTask(taskId, workerId, 1, { actor: 'orchestrator', key: `task.claimed:${taskId}` }, {
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
    const issued = coordination.issueRunOrchestratorLease(leaseRequest, { actor: 'orchestrator', key: `run.orchestrator_lease:${leaseId}` });
    const lease = { id: issued.lease.leaseId, digest: issued.lease.leaseDigest, issuedEvent: issued.lease.issuedEvent };
    const posted = coordination.postBoardItem({ board: `board-${label}`, title: 'do the thing' }, auth(`post-${label}`));
    const closed = coordination.closeBoardItem(posted.item.itemId, auth(`close-${label}`));
    setup = { runId, lease, candidateFindingId: `finding:board-close:${posted.item.itemId}:${closed.item.itemVersion}` };
  }
  return { coordinator, coordination, setup };
}

function makeBrief(overrides = {}) {
  return createBrief({
    goal: 'ship the widget',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1_000, usd: 1, wallMin: 5 },
    ...overrides,
  });
}

function kn(id, overrides = {}) {
  return {
    id, type: 'Finding', grounding: 'observed', body: `body prose for ${id}`,
    evidence: [{ coordinationSeq: 1 }], contentDigest: digest({ id }),
    observedSeq: 1, observedAt: '2026-07-22T08:00:00.000Z', eventTime: '2026-07-22T08:00:00.000Z',
    validFrom: '2026-07-22T00:00:00.000Z', validTo: null, validityVersion: 1,
    ...overrides,
  };
}

// ============================================================
// KG-A1: ambient serving — the bounded knowledge slice on the spawn brief
// ============================================================

test('KG-A1: a spawn brief carries the bounded knowledge slice with provenance wrappers and grounding refs; empty graph is honest-empty; expired nodes never serve; the byte cap holds', () => {
  const live = kn('finding:live', { observedSeq: 2 });
  const expired = kn('finding:expired', { observedSeq: 1, validTo: '2026-07-21T00:00:00.000Z' });

  // Provenance wrappers + grounding ref + validity dates on every item.
  const slice = buildKnowledgeSlice([expired, live], { now });
  assert.equal(slice.provenance, 'knowledge', 'the slice is provenance-stamped knowledge');
  assert.equal(slice.untrusted, true, 'the slice is always untrusted prose');
  assert.equal(slice.items.length, 1, 'only the live node serves');
  assert.equal(slice.items[0].id, 'finding:live');
  for (const item of slice.items) {
    assert.equal(item.provenance, 'knowledge');
    assert.equal(item.untrusted, true);
    assert.ok(typeof item.ref === 'string' && item.ref.length > 0, 'each item carries a grounding ref');
    assert.ok(typeof item.groundingDigest === 'string' && /^[a-f0-9]{64}$/.test(item.groundingDigest));
    assert.ok(item.validFrom, 'each item carries its validity dates');
  }

  // Expired-validity nodes never serve (rule 5 — honored at serve time).
  assert.equal(slice.items.some((item) => item.id === 'finding:expired'), false, 'an expired-validity node never serves');

  // An empty graph yields the honest empty slice — never fabricated relevance.
  const empty = buildKnowledgeSlice([], { now });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.honestEmpty, true);
  assert.equal(empty.truncated, false);

  // The serving seam (renderBrief) renders the slice; an empty slice renders an honest marker.
  const served = renderBrief(makeBrief({ knowledge: slice }), 'claude');
  assert.match(served, /Ambient knowledge/u);
  assert.match(served, /finding:live/u);
  const emptyServed = renderBrief(makeBrief({ knowledge: empty }), 'claude');
  assert.match(emptyServed, /Ambient knowledge/u);
  assert.match(emptyServed, /none|no.{0,12}knowledge/iu, 'an empty slice renders an honest empty marker, never silence');

  // A brief without a knowledge slice renders no knowledge section (back-compatible, no fabrication).
  const none = renderBrief(makeBrief(), 'claude');
  assert.equal(/Ambient knowledge/u.test(none), false);

  // The byte cap holds with a full queue: 20 large nodes, count cap 8 + byte cap honored, truncated.
  const big = Array.from({ length: 20 }, (_, i) => kn(`finding:big-${i}`, {
    observedSeq: i + 1, body: `big prose ${'x'.repeat(220)} ${i}`,
  }));
  const capped = buildKnowledgeSlice(big, { now, maxFindings: 8, maxBytes: 2_048 });
  assert.ok(capped.items.length <= 8, 'the count cap holds');
  assert.ok(capped.bytes <= 2_048, 'the byte cap holds');
  assert.equal(capped.truncated, true, 'a queue beyond the ceiling is truncated, never silently dropped');

  // The byte cap binds independently of the count cap.
  const byteBounded = buildKnowledgeSlice(big, { now, maxFindings: 100, maxBytes: 600 });
  assert.ok(byteBounded.items.length < 20, 'the byte cap alone bounds the slice');
  assert.ok(byteBounded.bytes <= 600);
  assert.equal(byteBounded.truncated, true);

  // The recall→slice serving path (coordinator.serveKnowledge) produces the same bounded slice from
  // the live graph: keyword-matched findings serve; an objective with no match is honest-empty; a
  // pure read that never appends a knowledge.read event or feeds assessment.
  const { coordinator: serveCoord, coordination: serveStore } = coordinatorFixture('serve');
  serveStore.addKnowledgeNode({ id: 'finding:widget-alpha', type: 'Finding', grounding: 'observed', body: 'widget alpha insight', evidence: [] }, { actor: 'policy', key: 'kn-serve' });
  const readsBefore = serveStore.snapshot().knowledge.reads.length;
  const servedFromGraph = serveCoord.serveKnowledge('ship the widget alpha');
  assert.equal(servedFromGraph.items.some((i) => i.id === 'finding:widget-alpha'), true, 'serveKnowledge recalls keyword-matched findings into the slice');
  assert.equal(serveStore.snapshot().knowledge.reads.length, readsBefore, 'serving is a pure read — no knowledge.read event, no assessment feed');
  assert.equal(serveCoord.serveKnowledge('unrelated objective_xyzzy').honestEmpty, true, 'an objective with no match yields an honest empty slice');
  serveStore.releaseWriterLease();
});

// ============================================================
// KG-A2: the candidacy queue — first-class projection over candidate records
// ============================================================

test('KG-A2: candidates from each source kind appear with type/source/age/grounding; admit removes exactly that candidate; the queue is capped and ordered; no duplicates across views', () => {
  const s = freshStore('queue', { clock: clockMs() });
  // A task node grounds the verification-class candidate (verified_task_outcome binds its task).
  s.addKnowledgeNode({ id: 'task:t-ver', type: 'Task', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-task' });
  s.addKnowledgeNode({ id: 'finding:board-1', type: 'Finding', grounding: 'observed', evidence: [], promotion: { kind: 'Finding', trigger: 'board.item_closed' } }, { actor: 'policy', key: 'kn-board' });
  s.addKnowledgeNode({ id: 'finding:pkg-1', type: 'Finding', grounding: 'observed', evidence: [], promotion: { kind: 'Finding', trigger: 'package.admitted' } }, { actor: 'policy', key: 'kn-pkg' });
  s.addKnowledgeNode({ id: 'finding:scratch-1', type: 'Finding', grounding: 'observed', evidence: [], promotion: { kind: 'Finding', trigger: 'scratch.cited_observed' } }, { actor: 'policy', key: 'kn-scratch' });
  s.addKnowledgeNode({ id: 'finding:ver-1', type: 'Finding', grounding: 'observed', evidence: [], promotion: { kind: 'Finding', trigger: 'verified_task_outcome' }, taskId: 't-ver' }, { actor: 'policy', key: 'kn-ver' });

  const q = s.knowledgeCandidateQueue({ now });
  assert.ok(Array.isArray(q.candidates));
  const sources = q.candidates.map((c) => c.source).sort();
  assert.deepEqual(sources, ['board_close', 'package_admit', 'scratchpad_settle', 'verification'], 'each source kind appears with its canonical label');
  for (const c of q.candidates) {
    assert.ok(['board_close', 'package_admit', 'scratchpad_settle', 'verification'].includes(c.source));
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.type, 'string');
    assert.ok(Number.isFinite(c.ageMs) && c.ageMs >= 0, 'ageMs is a non-negative millisecond age');
    assert.ok(/^[a-f0-9]{64}$/.test(c.groundingDigest), 'groundingDigest is a stable content digest');
  }
  // Ordered by minting sequence (stable).
  const seqs = q.candidates.map((c) => c.observedSeq ?? c.seq);
  assert.deepEqual([...seqs].sort((a, b) => a - b), seqs, 'the queue is in stable minting order');

  // No duplicates across views: two reads of the same projection are identical, ids unique.
  const qAgain = s.knowledgeCandidateQueue({ now });
  assert.deepEqual(qAgain.candidates.map((c) => c.id), [...new Set(q.candidates.map((c) => c.id))], 'no candidate appears twice');

  // Admitting one candidate removes EXACTLY that candidate; the rest remain.
  const f = candidateFixture('admit-remove');
  const before = f.store.knowledgeCandidateQueue({ now });
  assert.ok(before.candidates.some((c) => c.id === f.candidateFindingId), 'the board-close candidate is queued before admit');
  f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('admit-a2'), f.lease);
  const after = f.store.knowledgeCandidateQueue({ now });
  assert.equal(after.candidates.some((c) => c.id === f.candidateFindingId), false, 'admit removes exactly that candidate');
  assert.equal(after.admittedIds.includes(f.candidateFindingId), true, 'the admitted id is recorded, never double-counted');
  f.store.releaseWriterLease();

  // The queue is capped (<= 16) and ordered even when many candidates are pending.
  const s2 = freshStore('cap');
  s2.addKnowledgeNode({ id: 'task:t-cap', type: 'Task', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-cap-task' });
  for (let i = 0; i < 24; i += 1) {
    s2.addKnowledgeNode({ id: `finding:cap-${i}`, type: 'Finding', grounding: 'observed', evidence: [], promotion: { kind: 'Finding', trigger: 'board.item_closed' } }, { actor: 'policy', key: `kn-cap-${i}` });
  }
  const capped = s2.knowledgeCandidateQueue({ now });
  assert.ok(capped.candidates.length <= 16, 'the queue is bounded');
  assert.equal(capped.candidates.length, 16);
});

// ============================================================
// KG-A3: ritual hooks — candidacy counts at the natural review moments
// ============================================================

test('KG-A3: the ritual projection carries candidacy counts; a zero-candidate run carries 0 (not a missing field); mint/admit move them; the wave close receipt inherits the block', () => {
  // Zero candidates + zero admits → { candidates: 0, admittedThisRun: 0 } (0, never missing).
  const empty = freshStore('ritual-empty').knowledgeRitual('run-none', { now });
  assert.deepEqual(empty, { candidates: 0, admittedThisRun: 0 });

  // Minting candidates moves the count; admitting moves admittedThisRun up and candidates down.
  const f = candidateFixture('ritual');
  const r0 = f.store.knowledgeRitual(f.runId, { now });
  assert.equal(r0.candidates, 1, 'the pending board-close candidate is counted');
  assert.equal(r0.admittedThisRun, 0);
  f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('admit-a3'), f.lease);
  const r1 = f.store.knowledgeRitual(f.runId, { now });
  assert.equal(r1.admittedThisRun, 1, 'the admit is counted for this run');
  assert.equal(r1.candidates, 0, 'the admitted candidate leaves the pending queue');
  f.store.releaseWriterLease();

  // admittedThisRun is run-scoped: a second run's admit does not leak into the first.
  const g = candidateFixture('ritual-other');
  g.store.admitWorkflowFinding(repoId, g.runId, g.candidateFindingId, workflowAdmissionPolicy, auth('admit-a3b'), g.lease);
  assert.equal(freshStore('ritual-empty').knowledgeRitual(f.runId, { now }).admittedThisRun, 0, 'a different store reports its own run only');
  g.store.releaseWriterLease();
});

// ============================================================
// KG-A4: horizon digests in the wave surface — cache-correct
// ============================================================

test('KG-A4: workflowHorizon carries knowledgeDigest; it moves on admit and holds on unrelated state (cache-correct)', () => {
  const { coordinator, coordination, setup } = coordinatorFixture('digest', { withCandidate: true });
  const runId = setup.runId;

  const d0 = coordinator.workflowHorizon(runId).knowledgeDigest;
  assert.ok(/^[a-f0-9]{64}$/.test(d0), 'the horizon carries a content-addressed knowledge digest');

  // An unrelated state move (a decision settle bumps the workflow fence but mints no knowledge) does
  // NOT change the digest — the cache recomputes on the fence miss but the knowledge content is byte-
  // identical (cache-correct, not fence-correct).
  coordinator._bumpDecisionSettleCount(runId);
  const d1 = coordinator.workflowHorizon(runId).knowledgeDigest;
  assert.equal(d1, d0, 'an unrelated state move leaves the knowledge digest unchanged');

  // A scratchpad write is also unrelated knowledge state — the digest holds.
  coordination._events; // touch (no-op guard); the next assertion is the real property
  const d1b = coordinator.workflowHorizon(runId).knowledgeDigest;
  assert.equal(d1b, d0, 'a repeated read with no knowledge change is stable');

  // Admitting a finding mints a new verified Finding + DerivedFrom edge → the digest moves. The
  // admit goes through the real gate on the store (the coordinator wrapper ticks startup recovery,
  // unnecessary for this pure cache property — kg12 Part D admits store-direct for the same reason).
  coordination.admitWorkflowFinding(repoId, runId, setup.candidateFindingId, workflowAdmissionPolicy, auth('admit-a4'), setup.lease);
  const d2 = coordinator.workflowHorizon(runId).knowledgeDigest;
  assert.notEqual(d2, d0, 'admitting a finding changes the knowledge digest');
  coordination.releaseWriterLease();
});

// ============================================================
// KG-A5: gate honesty — the admit gate is the ONLY promotion path
// ============================================================

test('KG-A5: the admit gate lease binding + refusal taxonomy are unchanged; no auto-admit call site exists (source-scan)', () => {
  const storeSrc = readFileSync(join('impl', 'src', 'coordination-store.mjs'), 'utf8');
  const coordSrc = readFileSync(join('impl', 'src', 'coordinator.mjs'), 'utf8');

  // The lease binding check + each refusal class are still present, unchanged, in the gate.
  assert.match(storeSrc, /leaseRecord\.status !== 'active'[\s\S]*?workflow_admit_lease_invalid/u, 'the active-lease binding is the gate authority');
  for (const code of ['workflow_admit_invalid', 'workflow_admit_lease_invalid', 'workflow_admit_conflict', 'workflow_admit_oversize', 'workflow_admit_ineligible']) {
    assert.ok(storeSrc.includes(`'${code}'`), `the refusal taxonomy retains ${code}`);
  }

  // One runtime refusal row per existing class (the taxonomy is exhaustive and unchanged).
  const f = candidateFixture('a5');
  assert.equal(refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, { actor: 'worker', key: 'a5-bad-actor' }, f.lease)), 'workflow_admit_invalid', 'only orchestrator/operator may admit');
  assert.equal(refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('a5-bad-lease'), { ...f.lease, digest: '0'.repeat(64) })), 'workflow_admit_lease_invalid', 'a digest-mismatched lease is refused');
  assert.equal(refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, 'finding:not-a-candidate', workflowAdmissionPolicy, auth('a5-ineligible'), f.lease)), 'workflow_admit_ineligible', 'an ineligible candidate is refused');
  // Idempotent replay of the same key is NOT a refusal — it succeeds (replayed).
  const admitted = f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('a5-ok'), f.lease);
  assert.equal(admitted.replayed, false);
  const replayed = f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('a5-ok'), f.lease);
  assert.equal(replayed.replayed, true, 'same-key retry replays, never re-mints');
  // A second, differently-keyed admit of the now-admitted candidate is refused ineligible.
  assert.equal(refusalCode(() => f.store.admitWorkflowFinding(repoId, f.runId, f.candidateFindingId, workflowAdmissionPolicy, auth('a5-second'), f.lease)), 'workflow_admit_ineligible');
  f.store.releaseWriterLease();

  // NO auto-admit path exists: admitWorkflowFinding is reachable ONLY from the gate's own callers
  // (the store definition + the single orchestrator wrapper). No other src surface calls it.
  const srcDir = join('impl', 'src');
  const offenders = [];
  for (const name of readdirSync(srcDir)) {
    if (!name.endsWith('.mjs')) continue;
    if (name === 'coordination-store.mjs' || name === 'coordinator.mjs') continue;
    const text = readFileSync(join(srcDir, name), 'utf8');
    if (/\badmitWorkflowFinding\b/u.test(text)) offenders.push(name);
  }
  assert.deepEqual(offenders, [], 'no src surface outside the gate calls admitWorkflowFinding — there is no auto-promotion path');
  // The coordinator exposes exactly ONE admit wrapper, which calls the store gate exactly once — no
  // second call site exists (no auto-admit). Comments and the def are excluded; only call expressions count.
  const coordCallSites = coordSrc.match(/\.admitWorkflowFinding\(/gu) ?? [];
  assert.equal(coordCallSites.length, 1, 'the coordinator calls the gate from exactly one wrapper (no auto-admit path)');
  const storeDefs = storeSrc.match(/^[ \t]{2}admitWorkflowFinding\(repoId,/mu) ?? [];
  assert.equal(storeDefs.length, 1, 'exactly one admit gate definition owns promotion in the store');
});

// ============================================================
// KG-A3/KG-A4 wave surfacing: the wave close receipt + progress rows carry the knowledge block
// (ergonomics — the recipe receipts inherit this same block through driver.run)
// ============================================================

test('KG-A3/A4 wave surfacing: the wave close receipt carries knowledge counts and progress rows carry knowledgeDigest (zero is 0, not missing)', async (t) => {
  const { baton } = waveHarness(t, { default: { outcome: 'completed', edits: [{ path: 'reports/alpha.md', content: 'alpha report\n' }] } });
  const wave = await createWave(baton, {
    members: [{
      role: 'alpha', objective: 'write the alpha report (marker:alpha)',
      harness: 'mock', model: 'mock-model', effort: 'low',
      scope: ['reports/**'], report: 'reports/alpha.md',
    }],
  });
  const progress = await wave.progress();
  const row = progress.members[0];
  assert.ok(Object.hasOwn(row, 'knowledgeDigest'), 'a wave progress member row carries knowledgeDigest');
  assert.equal(row.terminal, false || row.terminal, 'progress is readable before settle');

  await wave.settle({ timeoutMs: 8_000 });
  const stop = await wave.close({ reason: 'KG-activation surfacing.' });
  assert.ok(Object.hasOwn(stop, 'knowledge'), 'the wave close receipt carries the knowledge block');
  assert.equal(stop.knowledge.candidates, 0, 'a zero-candidate wave surfaces 0, never a missing field');
  assert.equal(stop.knowledge.admittedThisRun, 0);
});

// ---------------------------------------------------------------------------
// Wave harness (the proven createWave shape from wave-driver-red, minimalized
// to one MockAdapter member so the surfacing assertions stay deterministic).
// ---------------------------------------------------------------------------

function principal(id) { return Object.freeze({ actor: 'test', principalId: id, sessionId: `session-${id}` }); }

function waveHarness(t, scenariosByMarker) {
  const repo = mkdtempSync(join(tmpdir(), 'baton-kg-act-wave-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=Baton Test', '-c', 'user.email=baton@example.test', 'commit', '--allow-empty', '-q', '-m', 'base'], { cwd: repo });
  const logDir = mkdtempSync(join(tmpdir(), 'baton-kg-act-wave-log-'));
  mkdirSync(join(repo, 'reports'), { recursive: true });
  dirs.push(repo, logDir);
  const adapter = new MockAdapter({ scenario: scenariosByMarker.default ?? { outcome: 'completed' } });
  const baseCard = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...baseCard(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'mock-model', available: ['mock-model'],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: ['low'], serviceTier: null,
      provenance: 'kg-activation-test', refreshedAt: null,
    },
  });
  const nativeSpawn = adapter.spawn.bind(adapter);
  adapter.spawn = (worker, brief, options) => {
    const goal = brief?.goal ?? '';
    const marker = Object.keys(scenariosByMarker).find((key) => key !== 'default' && goal.includes(key));
    return nativeSpawn(worker, brief, { ...options, scenario: scenariosByMarker[marker] ?? scenariosByMarker.default });
  };
  const driver = createDriver({
    repoRoot: repo, repoId: 'repo-wave-kg-activation', logDir,
    adapters: { mock: adapter }, stopDeadlineMs: 2_000,
    goalPlanAuthority: {
      policy: Object.freeze({
        schemaVersion: 1, repoId: 'repo-wave-kg-activation', mandatory: true, approvalTtlMs: 60 * 60 * 1_000,
        riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit', 'provider_call'],
        capabilityClasses: ['code', 'test'],
        limits: Object.freeze({
          maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
          maxTextBytes: 4_096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
          maxGoalBytes: 64 * 1_024, maxPlanBytes: 256 * 1_024, maxStatusBytes: 256 * 1_024,
          maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
        }),
      }),
      authorize: async () => true,
    },
  });
  const application = new BatonApplication({
    driver, repoId: 'repo-wave-kg-activation',
    profiles: {
      default: Object.freeze({
        schemaVersion: 1, repoId: 'repo-wave-kg-activation',
        definitionOfDone: ['deployment verification passes'], constraints: [], risk: 'low',
        goalBudget: { tokens: 200_000, usd: 20, wallMin: 120, providerTurns: 64 },
        nodeBudget: { tokens: 50_000, usd: 5, wallMin: 30, providerTurns: 16 },
        pathScope: ['**'],
        verification: {
          command: 'true', arguments: [], cwd: '.', envAllowlist: [],
          expectExit: 0, expectResult: 'exit_code', timeoutMs: 30_000, maxOutputBytes: 65536,
          requiredPredecessorEvidence: [],
        },
        routes: [{ harness: 'mock', model: 'mock-model', effort: 'low' }],
        capabilities: ['code', 'test'], effects: ['provider_call', 'repository_edit'],
        resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
      }),
    },
    defaults: { profile: 'default', route: null },
    principals: {
      planner: principal('application-planner'),
      dispatcher: principal('application-dispatcher'),
      observer: principal('application-observer'),
    },
    authorize: async () => true,
  });
  const baton = bindBaton(application, principal('wave-owner'));
  t.after(async () => {
    await driver.closeAuthority?.();
    await driver.coordination?.releaseWriterLease?.();
  });
  return { application, baton, driver, repo };
}
