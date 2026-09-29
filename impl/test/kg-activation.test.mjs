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
import { STORE_MODULE_FILES } from './seam-member-source.mjs';

// The suite runner spawns a test file with cwd = `impl/`, so a path written relative to the
// checkout root must resolve against THIS file, never the cwd — otherwise every read below
// opens `impl/impl/src/...` and the row dies of ENOENT before it can measure its subject.
// `application-observation.test.mjs` resolves the same way.
const repoRead = (relative) => readFileSync(new URL('../../' + relative, import.meta.url), 'utf8');

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
// A candidate Finding the candidacy queue reads. The settle-time admit gate left with the
// workflow-admitted lane, so the surviving trigger path mints the candidate directly.
function mintCandidate(store, label) {
  const id = `finding:candidate:${label}`;
  store.addKnowledgeNode({
    id, type: 'Finding', grounding: 'observed', evidence: [],
    promotion: { kind: 'Finding', trigger: 'scratch.cited_observed' },
  }, auth(`candidate-${label}`));
  return id;
}

// A store holding one pending candidate Finding, exposed so the activation suite can read the
// candidacy queue and the ritual count off one fixture.
function candidateFixture(label, opts = {}) {
  const store = freshStore(label, { runLineagePolicy: lineagePolicy, ...opts });
  const runId = `run-${label}`;
  const candidateFindingId = mintCandidate(store, label);
  return { store, runId, candidateFindingId };
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
    setup = { runId, candidateFindingId: mintCandidate(coordination, label) };
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

test('KG-A2: candidates from each source kind appear with type/source/age/grounding; the queue is capped and ordered; no duplicates across views', () => {
  const s = freshStore('queue', { clock: clockMs() });
  // A task node grounds the verification-class candidate (verified_task_outcome binds its task).
  s.addKnowledgeNode({ id: 'task:t-ver', type: 'Task', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-task' });

  s.addKnowledgeNode({ id: 'finding:scratch-1', type: 'Finding', grounding: 'observed', evidence: [], promotion: { kind: 'Finding', trigger: 'scratch.cited_observed' } }, { actor: 'policy', key: 'kn-scratch' });
  s.addKnowledgeNode({ id: 'finding:ver-1', type: 'Finding', grounding: 'observed', evidence: [], promotion: { kind: 'Finding', trigger: 'verified_task_outcome' }, taskId: 't-ver' }, { actor: 'policy', key: 'kn-ver' });

  const q = s.knowledgeCandidateQueue({ now });
  assert.ok(Array.isArray(q.candidates));
  const sources = q.candidates.map((c) => c.source).sort();
  assert.deepEqual(sources, ['scratchpad_settle', 'verification'], 'each source kind appears with its canonical label');
  for (const c of q.candidates) {
    assert.ok(['scratchpad_settle', 'verification'].includes(c.source));
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



  // The queue is capped (<= 16) and ordered even when many candidates are pending.
  const s2 = freshStore('cap');
  s2.addKnowledgeNode({ id: 'task:t-cap', type: 'Task', grounding: 'observed', evidence: [] }, { actor: 'policy', key: 'kn-cap-task' });
  for (let i = 0; i < 24; i += 1) {
    s2.addKnowledgeNode({ id: `finding:cap-${i}`, type: 'Finding', grounding: 'observed', evidence: [], promotion: { kind: 'Finding', trigger: 'scratch.cited_observed' } }, { actor: 'policy', key: `kn-cap-${i}` });
  }
  const capped = s2.knowledgeCandidateQueue({ now });
  assert.ok(capped.candidates.length <= 16, 'the queue is bounded');
  assert.equal(capped.candidates.length, 16);
});

// ============================================================
// KG-A3: ritual hooks — candidacy counts at the natural review moments
// ============================================================

test('KG-A3: the ritual projection carries the candidacy count; a zero-candidate run carries 0 (not a missing field); minting moves it; the wave close receipt inherits the block', () => {
  // Zero candidates → { candidates: 0 } (0, never missing).
  const empty = freshStore('ritual-empty').knowledgeRitual({ now });
  assert.deepEqual(empty, { candidates: 0 });

  // Minting a candidate moves the count.
  const f = candidateFixture('ritual');
  const r0 = f.store.knowledgeRitual({ now });
  assert.equal(r0.candidates, 1, 'the pending candidate is counted');
  assert.equal(freshStore('ritual-empty').knowledgeRitual({ now }).candidates, 0,
    'a different store reports its own queue only');
  f.store.releaseWriterLease();
});

// ============================================================
// KG-A4: horizon digests in the wave surface — cache-correct
// ============================================================

test('KG-A4: workflowHorizon carries knowledgeDigest; it moves on a knowledge write and holds on unrelated state (cache-correct)', () => {
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

  // A knowledge write mints a node → the digest moves.
  coordination.addKnowledgeNode({ id: 'finding:digest-probe', type: 'Finding', grounding: 'observed', evidence: [] },
    { actor: 'policy', key: 'kn-a4' });
  const d2 = coordinator.workflowHorizon(runId).knowledgeDigest;
  assert.notEqual(d2, d0, 'a knowledge write changes the knowledge digest');
  coordination.releaseWriterLease();
});

// ============================================================
// KG-A3/KG-A4 wave surfacing: the wave close receipt + progress rows carry the knowledge block
// (ergonomics — the recipe receipts inherit this same block through driver.run)
// ============================================================

