// KG-4 graph-quality red suite (issue #27, docs/34 §3 rules 12–14, contract kg34-decisions.md v2).
// Auto-link restricted to Supports/Refines/Cites with per-type thresholds and a deterministic
// idempotency key (edges carry NO grounding); Contradicts/Supersedes are refused by the store
// directly. MAD read-time confidence (vendored oracle) and read-time staleness are overlays, never
// stored node state.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';

const root = (name = 'root') => mkdtempSync(join(tmpdir(), `baton-kg4-${name}-`));
const task = (id) => ({ id, brief: { goal: id }, deps: [], refines: null, taskType: 'causal-recall', reservedWorkerId: `w-${id}` });
function clock(start = '2026-07-22T00:00:00.000Z') { let now = Date.parse(start); return () => new Date(now++).toISOString(); }

const recallPolicy = (overrides = {}) => ({
  repoId: 'repo-a', maxQueryBytes: 4_096, maxQueryTerms: 64, maxCandidates: 128,
  maxCandidateBytes: 256 * 1024, maxResults: 16, maxGraphDepth: 8, maxGraphRows: 256,
  maxSnippetBytes: 128, maxReceiptBytes: 64 * 1024, maxResultBytes: 128 * 1024, ...overrides,
});
const previewExtras = (overrides = {}) => ({
  weightTerm: 1, weightEdgeDegree: 1, weightEvidence: 1, weightRecency: 0,
  autoLinkThresholds: { Supports: 50, Refines: 50, Cites: 50 },
  K: 4, maxBriefingBytes: 4_096, maxSidebarBytes: 2_048, maxPreviewCacheEntries: 64, staleAfterSeq: 2, ...overrides,
});
const policy = (r = {}, p = {}) => ({ recall: recallPolicy(r), preview: previewExtras(p) });
const auth = (key) => ({ actor: 'policy', key });

function build(name) {
  const dir = root(name); const s = new CoordinationStore(dir, { clock: clock() });
  const created = s.createTask(task('src'), { actor: 'orchestrator', key: 'task:src' });
  return { dir, s, ev: created.event.seq };
}
function finding(s, id, body, opts = {}) {
  return s.addKnowledgeNode({ id, type: 'Finding', grounding: opts.grounding ?? 'observed', body, evidence: opts.evidence ?? [] }, { actor: 'policy', key: opts.key ?? id });
}

test('KG4-A: the store refuses an auto-shaped Contradicts and a stale Supersedes; a Supports admits', () => {
  const { s, ev } = build('refusals');
  finding(s, 'finding:a', 'alpha body', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:b', 'beta body', { evidence: [{ coordinationSeq: ev }] });
  // A similarity score can manufacture neither Contradicts evidence nor a Supersedes version.
  assert.throws(() => s.addKnowledgeEdge({ type: 'Contradicts', from: 'finding:a', to: 'finding:b', evidence: [] }, auth('bad:contra')), (e) => e.code === 'invalid_contradiction');
  assert.throws(() => s.addKnowledgeEdge({ type: 'Supersedes', from: 'finding:a', to: 'finding:b', expectedValidityVersion: 999, evidence: [{ coordinationSeq: ev }] }, auth('bad:super')), (e) => e.code === 'stale_version');
  const supports = s.addKnowledgeEdge({ type: 'Supports', from: 'finding:a', to: 'finding:b', evidence: [] }, auth('good:supports'));
  assert.equal(supports.ok, true);
  assert.equal(supports.edge.type, 'Supports');
  assert.equal(Object.hasOwn(supports.edge, 'grounding'), false, 'edges carry no grounding field');
});

test('KG4-B: auto-link admits above-threshold Supports/Refines/Cites, drops the rest with a tally, and re-proposes idempotently', () => {
  const { s, ev } = build('autolink');
  finding(s, 'finding:src', 'source body', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:hi', 'high target', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:lo', 'low target', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:cx', 'contra target', { evidence: [{ coordinationSeq: ev }] });
  const candidates = [
    { type: 'Supports', to: 'finding:hi', score: 100 },
    { type: 'Cites', to: 'finding:lo', score: 10 },
    { type: 'Contradicts', to: 'finding:cx', score: 100 },
  ];
  const first = s.autoLinkKnowledgeNode('finding:src', candidates, policy(), auth('autolink:src'));
  assert.deepEqual(first.admitted.map((a) => [a.type, a.to, a.result]), [['Supports', 'finding:hi', 'admitted']]);
  assert.deepEqual(new Set(first.autoLinkDropped.map((d) => `${d.type}:${d.reason}`)), new Set(['Cites:below_threshold', 'Contradicts:type_not_allowed']));
  const edges = s.queryKnowledgeEdges({ observedSeq: s.snapshot().lastSeq });
  assert.equal(edges.filter((e) => e.type === 'Supports' && e.from === 'finding:src' && e.to === 'finding:hi').length, 1);
  // Re-proposal under the deterministic key is a clean idempotent no-op, never duplicate_edge.
  const again = s.autoLinkKnowledgeNode('finding:src', candidates, policy(), auth('autolink:src:2'));
  assert.deepEqual(again.admitted.map((a) => a.result), ['idempotent']);
  assert.equal(s.queryKnowledgeEdges({ observedSeq: s.snapshot().lastSeq }).filter((e) => e.type === 'Supports' && e.from === 'finding:src').length, 1, 'no second edge is minted');
});

test('KG4-C: an auto-linked Supports edge folds through knowledge.edge_added and replays identically', () => {
  const { dir, s, ev } = build('replay');
  finding(s, 'finding:src', 'source body', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:dst', 'dest body', { evidence: [{ coordinationSeq: ev }] });
  s.autoLinkKnowledgeNode('finding:src', [{ type: 'Supports', to: 'finding:dst', score: 100 }], policy(), auth('autolink:replay'));
  const before = s.queryKnowledgeEdges({ observedSeq: s.snapshot().lastSeq }).filter((e) => e.type === 'Supports');
  assert.equal(before.length, 1);
  s.releaseWriterLease();
  const replay = new CoordinationStore(dir);
  const after = replay.queryKnowledgeEdges({ observedSeq: replay.snapshot().lastSeq }).filter((e) => e.type === 'Supports');
  assert.deepEqual(after.map((e) => e.id), before.map((e) => e.id), 'the auto-edge survives replay verbatim');
  replay.releaseWriterLease();
});

test('KG4-D: MAD confidence matches the vendored oracle (HIGH/MODERATE/HIGH-INF), normalizes units, guards non-finite, and needs >=3', () => {
  const { s } = build('mad');
  assert.deepEqual(s._madConfidence('runs at 10 ms then 20 ms then 40 ms', 100), { label: 'HIGH', value: 2, unit: 'ms', samples: 3 });
  assert.deepEqual(s._madConfidence('10 ms 20 ms 30 ms', 100), { label: 'MODERATE', value: 1, unit: 'ms', samples: 3 });
  assert.deepEqual(s._madConfidence('10 ms 10 ms 10 ms', 100), { label: 'HIGH-INF', value: null, unit: 'ms', samples: 3 });
  // tok/s and tokens/s normalize to one group.
  assert.equal(s._madConfidence('10 tok/s 20 tokens/s 40 tok/s', 100).unit, 'tok/s');
  assert.equal(s._madConfidence('10 tok/s 20 tokens/s 40 tok/s', 100).label, 'HIGH');
  // A bare-decimal grammar cannot inject NaN/Infinity: 'NaN' has no digits, so only 2 values remain.
  assert.equal(s._madConfidence('10 ms 20 ms NaN ms', 100), null);
  assert.equal(s._madConfidence('only 5 ms and 6 ms', 100), null, 'fewer than 3 unit-matched values yields null');
});

test('KG4-E: confidence is a read-time overlay on Finding preview rows, never a stored node field', () => {
  const { s, ev } = build('confidence');
  finding(s, 'finding:metric', 'latency metricword 10 ms 20 ms 40 ms', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:sparse', 'sparse metricword 10 ms only', { evidence: [{ coordinationSeq: ev }] });
  const preview = s.recallPreview('repo-a', { text: 'metricword', limit: 8 }, policy());
  const metric = preview.nodes.find((n) => n.id === 'finding:metric');
  const sparse = preview.nodes.find((n) => n.id === 'finding:sparse');
  assert.equal(metric.confidence.label, 'HIGH');
  assert.equal(sparse.confidence, null, 'a Finding with <3 unit-matched metrics carries confidence:null');
  const stored = s.queryKnowledge({ observedSeq: s.snapshot().lastSeq }).find((n) => n.id === 'finding:metric');
  assert.equal(Object.hasOwn(stored, 'confidence'), false, 'confidence is never a stored node field');
});

test('KG4-F: staleness is a read-time overlay — contradicted and evented-unreferenced nodes are marked; a live node is not', () => {
  const { s, ev } = build('staleness');
  finding(s, 'finding:old', 'stalecheck old body', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:contra', 'stalecheck contra body', { evidence: [{ coordinationSeq: ev }] });
  finding(s, 'finding:peer', 'stalecheck peer body', { evidence: [{ coordinationSeq: ev }] });
  s.addKnowledgeEdge({ type: 'Contradicts', from: 'finding:contra', to: 'finding:peer', evidence: [{ coordinationSeq: ev }] }, auth('contra:cp'));
  finding(s, 'finding:young', 'stalecheck young body'); // no evidence → eventTimeSeq == fold seq (age 0)
  const preview = s.recallPreview('repo-a', { text: 'stalecheck', limit: 16 }, policy());
  const at = (id) => preview.nodes.find((n) => n.id === id);
  assert.ok(at('finding:old').staleness.reasons.includes('unreferenced'), 'an old evented-unreferenced node is stale');
  assert.ok(at('finding:contra').staleness.reasons.includes('contradicted'), 'a live-contradicted node is stale');
  assert.equal(at('finding:young').staleness, null, 'a young, referenced-enough, uncontradicted node is not stale');
  // Preview traffic is non-evented, so however many previews run, the old node stays unreferenced.
  for (let i = 0; i < 3; i += 1) s.recallPreview('repo-a', { text: 'stalecheck', limit: 16 }, policy());
  const again = s.recallPreview('repo-a', { text: 'stalecheck', limit: 16 }, policy());
  assert.ok(again.nodes.find((n) => n.id === 'finding:old').staleness.reasons.includes('unreferenced'), 'a node referenced only by previews still counts as unreferenced');
  const stored = s.queryKnowledge({ observedSeq: s.snapshot().lastSeq }).find((n) => n.id === 'finding:old');
  assert.equal(Object.hasOwn(stored, 'staleness'), false, 'staleness is never a stored node field');
});
