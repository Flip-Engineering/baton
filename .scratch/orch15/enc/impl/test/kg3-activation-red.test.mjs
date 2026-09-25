// KG-3 activation red suite (issue #26, docs/34 §3 rules 8–11, contract kg34-decisions.md v2).
// recallPreview: non-evented, cached to the KG project-horizon fence, fail-open with an explicit
// briefingUnavailable marker, seed pre-filter (seedsDropped), composite ranking with deployment
// weights (a weight of 0 disables its term), contradiction-first WARNING, and contradiction-peel
// before degrade. Plus the `{ brief, briefing }` provider seam (briefDigest bit-stable) and the
// relocated messages.mjs sanitizer.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { boundedAttentionText, createBrief, renderBriefing } from '../src/messages.mjs';

const root = (name = 'root') => mkdtempSync(join(tmpdir(), `baton-kg3-${name}-`));
const task = (id) => ({ id, brief: { goal: id }, deps: [], refines: null, taskType: 'causal-recall', reservedWorkerId: `w-${id}` });
function clock(start = '2026-07-22T00:00:00.000Z') { let now = Date.parse(start); return () => new Date(now++).toISOString(); }
const store = (name) => new CoordinationStore(root(name), { clock: clock() });

const recallPolicy = (overrides = {}) => ({
  repoId: 'repo-a', maxQueryBytes: 4_096, maxQueryTerms: 64, maxCandidates: 128,
  maxCandidateBytes: 256 * 1024, maxResults: 16, maxGraphDepth: 8, maxGraphRows: 256,
  maxSnippetBytes: 64, maxReceiptBytes: 64 * 1024, maxResultBytes: 128 * 1024, ...overrides,
});
const previewExtras = (overrides = {}) => ({
  weightTerm: 1, weightEdgeDegree: 1, weightEvidence: 1, weightRecency: 0,
  autoLinkThresholds: { Supports: 50, Refines: 50, Cites: 50 },
  K: 4, maxBriefingBytes: 4_096, maxSidebarBytes: 2_048, maxPreviewCacheEntries: 64, staleAfterSeq: 2, ...overrides,
});
const policy = (recallOverrides = {}, previewOverrides = {}) => ({ recall: recallPolicy(recallOverrides), preview: previewExtras(previewOverrides) });

function seed(s) { return s.createTask(task('src'), { actor: 'orchestrator', key: 'task:src' }); }
function finding(s, id, body, opts = {}) {
  return s.addKnowledgeNode({ id, type: 'Finding', grounding: opts.grounding ?? 'observed', body, evidence: opts.evidence ?? [] }, { actor: 'policy', key: opts.key ?? id });
}
function contradiction(s, fromId, toId, ev, key) {
  return s.addKnowledgeEdge({ type: 'Contradicts', from: fromId, to: toId, evidence: [{ coordinationSeq: ev }] }, { actor: 'operator:alice', key });
}

test('KG3-A: recallPreview appends no ledger event and pushes nothing to evented reads', () => {
  const s = store('nonevented'); const created = seed(s);
  finding(s, 'finding:alpha', 'alpha beta signal', { evidence: [{ coordinationSeq: created.event.seq }] });
  const before = s.snapshot().lastSeq; const reads = s.snapshot().knowledge.reads.length;
  for (let i = 0; i < 4; i += 1) s.recallPreview('repo-a', { text: 'alpha', limit: 4 }, policy());
  assert.equal(s.snapshot().lastSeq, before, 'a preview appends zero ledger events');
  assert.equal(s.snapshot().knowledge.reads.length, reads, 'a preview pushes nothing to evented reads');
  assert.equal(s.events(1, s.snapshot().lastSeq).some((e) => e.kind === 'knowledge.recall'), false, 'no knowledge.recall receipt exists after N previews (never feeds assessment)');
});

test('KG3-B: the projection is cached to the KG fence — a non-KG event does not bust it, a folded node does', () => {
  const s = store('cache'); const created = seed(s);
  finding(s, 'finding:cacheme', 'cache token here', { evidence: [{ coordinationSeq: created.event.seq }] });
  const first = s.recallPreview('repo-a', { text: 'cache', limit: 4 }, policy());
  const fence = first.projectFence;
  // A non-KG event (claiming the existing task) advances this._events.length but NOT the KG fence.
  const lastSeqBefore = s.snapshot().lastSeq;
  s.claimTask('src', 'w-src', 1, { actor: 'orchestrator', key: 'claim:src' });
  assert.ok(s.snapshot().lastSeq > lastSeqBefore, 'the non-KG event advanced the global event count');
  const second = s.recallPreview('repo-a', { text: 'cache', limit: 4 }, policy());
  assert.equal(second.projectFence, fence, 'the KG fence did not advance on a non-KG event');
  assert.ok(Object.is(second, first), 'the same (fence, query, policy) is served byte-identically from cache');
  // Folding a new node advances the fence and recomputes.
  finding(s, 'finding:cache2', 'cache token again', { evidence: [{ coordinationSeq: created.event.seq }] });
  const third = s.recallPreview('repo-a', { text: 'cache', limit: 4 }, policy());
  assert.ok(third.projectFence > fence, 'a folded node advances the KG fence');
  assert.ok(!Object.is(third, first), 'the preview recomputes on fence advance');
});

test('KG3-C: a ceiling breach fails open with briefingUnavailable and dispatch proceeds; a caller-shape fault throws', () => {
  const s = store('failopen'); const created = seed(s);
  finding(s, 'finding:one', 'over token', { evidence: [{ coordinationSeq: created.event.seq }] });
  finding(s, 'finding:two', 'over token two', { evidence: [{ coordinationSeq: created.event.seq }] });
  const degraded = s.recallPreview('repo-a', { text: 'over', limit: 2 }, policy({ maxCandidates: 1 }));
  assert.equal(degraded.briefingUnavailable, true);
  assert.equal(degraded.reason, 'causal_recall_oversize');
  assert.deepEqual(degraded.nodes, []);
  assert.notEqual(degraded.contradictionFlood, true, 'a non-contradiction ceiling is not a flood');
  // Caller-shape faults are loud (never degraded).
  assert.throws(() => s.recallPreview('repo-a', { text: 'over', limit: 0 }, policy()), (e) => e.code === 'causal_recall_invalid');
  assert.throws(() => s.recallPreview('repo-a', { text: 'over\0hidden', limit: 2 }, policy()), (e) => e.code === 'causal_recall_invalid');
  assert.throws(() => s.recallPreview('repo-a', { text: 'over', limit: 2, extra: true }, policy()), (e) => e.code === 'causal_recall_invalid');
});

test('KG3-D: a decision seed superseded between citation and preview is dropped, never causal_recall_invalid', () => {
  const s = store('seeddrop'); const created = seed(s);
  finding(s, 'finding:cited', 'seed body token', { evidence: [{ coordinationSeq: created.event.seq }] });
  finding(s, 'finding:live', 'seed body token live', { evidence: [{ coordinationSeq: created.event.seq }] });
  s.invalidateKnowledge('finding:cited', 1, 'Superseded before the preview.', { actor: 'operator:alice', key: 'invalidate:cited' });
  const preview = s.recallPreview('repo-a', { text: 'seed', limit: 4, seedNodeIds: ['finding:cited'] }, policy());
  assert.equal(preview.briefingUnavailable, false, 'churn on a cited seed never wedges surfacing');
  assert.deepEqual(preview.seedsDropped, ['finding:cited'], 'the dead seed is dropped, never silently');
  assert.equal(preview.query.seedNodeIds.includes('finding:cited'), false, 'the internal query excludes the dropped seed');
});

test('KG3-E: the split policy is accepted, composite honors deployment weights, and a weight of 0 disables its term', () => {
  const s = store('weights'); const created = seed(s); const ev = created.event.seq;
  // A: stronger term match (two query terms in body). B: weaker term, but three evidence refs.
  finding(s, 'finding:a', 'alpha beta', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:b', 'alpha only', { evidence: [{ coordinationSeq: ev }, { coordinationSeq: ev }, { coordinationSeq: ev }] });
  const byTerm = s.recallPreview('repo-a', { text: 'alpha beta', limit: 4 }, policy({}, { weightTerm: 1, weightEdgeDegree: 0, weightEvidence: 0 }));
  const orderTerm = byTerm.nodes.map((n) => n.id);
  assert.ok(orderTerm.indexOf('finding:a') < orderTerm.indexOf('finding:b'), 'term weight ranks the stronger match first');
  const byEvidence = s.recallPreview('repo-a', { text: 'alpha beta', limit: 4 }, policy({}, { weightTerm: 0, weightEdgeDegree: 0, weightEvidence: 1 }));
  const orderEvidence = byEvidence.nodes.map((n) => n.id);
  assert.ok(orderEvidence.indexOf('finding:b') < orderEvidence.indexOf('finding:a'), 'weightTerm:0 disables the term; evidence weight now ranks B first');
});

test('KG3-F: a node joined by a live Contradicts ranks first with warning:true; a resolved contradiction does not warn', () => {
  const s = store('warn'); const created = seed(s); const ev = created.event.seq;
  finding(s, 'gamma:plain', 'gamma plain strong', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:w', 'gamma weak', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:v', 'unrelated peer', { evidence: [{ coordinationSeq: ev }] });
  contradiction(s, 'finding:w', 'finding:v', ev, 'contra:wv');
  const preview = s.recallPreview('repo-a', { text: 'gamma', limit: 8 }, policy());
  assert.equal(preview.nodes[0].warning, true, 'a contradiction party ranks ahead of a higher-composite plain node');
  const plain = preview.nodes.find((n) => n.id === 'gamma:plain');
  assert.equal(plain.warning, false);
  assert.ok(preview.nodes.indexOf(plain) > 0, 'the plain node is demoted behind the contradiction bundle');

  const s2 = store('resolved'); const c2 = seed(s2); const ev2 = c2.event.seq;
  finding(s2, 'finding:win', 'delta winner', { evidence: [{ coordinationSeq: ev2 }] });
  finding(s2, 'finding:lose', 'delta loser', { evidence: [{ coordinationSeq: ev2 }] });
  const edge = contradiction(s2, 'finding:win', 'finding:lose', ev2, 'contra:wl');
  s2.resolveKnowledgeContradiction({ edgeId: edge.edge.id, winnerId: 'finding:win', loserId: 'finding:lose', expectedWinnerValidityVersion: 1, expectedLoserValidityVersion: 1, expectedEdgeValidityVersion: 1, reason: 'Winner verified.' }, { actor: 'operator:alice', key: 'resolve:wl' });
  const resolved = s2.recallPreview('repo-a', { text: 'delta', limit: 8 }, policy());
  const winner = resolved.nodes.find((n) => n.id === 'finding:win');
  assert.equal(winner.warning, false, 'a resolved contradiction never warns');
});

test('KG3-G: a Contradicts bundle over maxResults peels the ranked tail, still surfaces the top contradiction, and dispatch proceeds', () => {
  const s = store('peel'); const created = seed(s); const ev = created.event.seq;
  // Three contradiction pairs; a/e/g match the query, b/f/h join only via the bundle. maxResults=3
  // so selecting all three tops overflows; peel to a single top preserves the top warning.
  finding(s, 'peel:a', 'peel top strong', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:e', 'peel middle', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:g', 'peel middle two', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:b', 'contra peer one', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:f', 'contra peer two', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:h', 'contra peer three', { evidence: [{ coordinationSeq: ev }] });
  contradiction(s, 'peel:a', 'finding:b', ev, 'contra:ab');
  contradiction(s, 'finding:e', 'finding:f', ev, 'contra:ef');
  contradiction(s, 'finding:g', 'finding:h', ev, 'contra:gh');
  const preview = s.recallPreview('repo-a', { text: 'peel', limit: 3 }, policy({ maxResults: 3 }));
  assert.equal(preview.briefingUnavailable, false, 'peel keeps dispatch flowing');
  assert.ok(preview.contradictionPeeled > 0, 'the peel count is surfaced, never silent');
  assert.equal(preview.nodes[0].warning, true, 'the top contradiction still surfaces with a WARNING');
  assert.ok(preview.nodes.some((n) => n.id === 'peel:a'), 'the highest-ranked contradicted node is preserved');
});

test('KG3-H: the { brief, briefing } seam leaves the inner brief (and briefDigest) bit-stable, and is inert without a provider', () => {
  const inner = createBrief({ goal: 'ship the widget', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1_000, usd: 1, wallMin: 5 } });
  const snapshot = JSON.stringify(inner);
  const ctxA = { _contextBriefMaterializer: null, _knowledgeBriefingProvider: () => ({ text: 'briefing-A' }) };
  const outA = Coordinator.prototype._providerBrief.call(ctxA, inner);
  assert.equal(outA.goal, 'ship the widget', 'adapters still read the inner brief fields');
  assert.equal(outA.briefing.text, 'briefing-A', 'the briefing rides a separate provider-visible block');
  assert.equal(Object.hasOwn(inner, 'briefing'), false, 'the briefing never enters task.brief');
  const ctxB = { _contextBriefMaterializer: null, _knowledgeBriefingProvider: () => ({ text: 'briefing-B-changed' }) };
  const outB = Coordinator.prototype._providerBrief.call(ctxB, inner);
  assert.equal(JSON.stringify(inner), snapshot, 'a briefing that changes between spawn and recovery cannot move briefDigest');
  assert.notEqual(outB.briefing.text, outA.briefing.text);
  const ctx0 = { _contextBriefMaterializer: null, _knowledgeBriefingProvider: null };
  assert.ok(Object.is(Coordinator.prototype._providerBrief.call(ctx0, inner), inner), 'the seam is inert (identical) without a briefing provider');
});

test('KG3-I: the relocated sanitizer redacts credential-shaped prose, bounds bytes, and marks derived provenance', () => {
  assert.match(boundedAttentionText('token is api_key=ABCDEFGH12345678 end'), /\[redacted\]/u);
  assert.equal(boundedAttentionText('token is api_key=ABCDEFGH12345678 end').includes('ABCDEFGH12345678'), false);
  assert.ok(Buffer.byteLength(boundedAttentionText('x'.repeat(9_000), 128)) <= 128, 'the byte ceiling is honored');
  const rendered = renderBriefing({ briefingUnavailable: false, nodes: [{ id: 'finding:x', type: 'Finding', snippet: 'hello', warning: true, confidence: { label: 'HIGH' }, staleness: null }], contradictions: [] });
  assert.equal(rendered.provenance, 'hub-derived');
  assert.equal(rendered.untrusted, true);
  assert.match(rendered.text, /WARNING: finding:x/u);
  const unavailable = renderBriefing({ briefingUnavailable: true, reason: 'causal_recall_oversize', nodes: [] });
  assert.match(unavailable.text, /briefing unavailable \(causal_recall_oversize\)/u);
  const flood = renderBriefing({ briefingUnavailable: true, reason: 'causal_recall_oversize', contradictionFlood: true, nodes: [] });
  assert.match(flood.text, /contradictions present/u);
  const truncated = renderBriefing({ briefingUnavailable: false, nodes: [{ id: 'finding:y', type: 'Finding', snippet: 'z'.repeat(500), warning: false, confidence: null, staleness: null }], contradictions: [] }, 64);
  assert.equal(truncated.truncated, true);
  assert.ok(Buffer.byteLength(truncated.text) <= 64);
});
