// These projections use synthetic coordination records to falsify attribution and graph shape.
// They are not live provider, repository-integrator, or PID-reap proof.
import assert from 'node:assert/strict';
import test from 'node:test';

import { BatonApplication } from '../src/index.mjs';

const planDigest = 'a'.repeat(64);
const current = {
  goal: { runId: 'run-episode-attribution', objective: 'Compare two roles', digest: 'b'.repeat(64) },
  plan: { version: 11, digest: planDigest, nodes: [{
    key: 'work', revision: { revisionId: 'revision-current', revisionDigest: '9'.repeat(64) },
  }, { key: 'reviewer' }] },
};
const stoppedReceipt = {
  schemaVersion: 1, role: 'reviewer', completionDigest: 'c'.repeat(64),
  outcome: { targetCount: 1, remainingCount: 0 },
};
const view = {
  workflow: { round: 2 },
  phase: 'running', route: { observed: { harness: 'aggregate', model: 'selected-review', effort: 'high' } },
  verification: { accepted: true, digest: 'd'.repeat(64) },
  result: { state: 'accepted', role: 'reviewer', resultSha: '2'.repeat(40), candidateId: 'candidate-reviewer' },
  nodes: [{ key: 'work', taskId: 'task-work' }, { key: 'reviewer', taskId: 'task-reviewer' }],
  attempts: [{
    role: 'work', nodeKey: 'work', taskId: 'task-work', state: 'accepted',
    route: { observed: { harness: 'codex', model: 'builder', effort: 'high' } },
    verification: { accepted: true, digest: '1'.repeat(64) }, activity: { editedPaths: ['work.mjs'] },
    memberStop: null,
  }, {
    role: 'reviewer', nodeKey: 'reviewer', taskId: 'task-reviewer', state: 'cancelled',
    route: { observed: { harness: 'grok', model: 'reviewer', effort: 'low' } },
    verification: { accepted: false, digest: '2'.repeat(64) }, activity: { editedPaths: ['review.md'] },
    memberStop: { state: 'stopped', receiptDigest: stoppedReceipt.completionDigest },
  }],
  candidates: [{
    role: 'work', candidateId: 'candidate-work', resultSha: '1'.repeat(40), state: 'verified',
  }, {
    role: 'reviewer', candidateId: 'candidate-reviewer', resultSha: '2'.repeat(40), state: 'verified',
  }],
  memberStops: [{ role: 'reviewer', status: 'stopped', receipt: stoppedReceipt }],
  rounds: [{
    round: 1, revision: { id: 'revision-predecessor', digest: '8'.repeat(64) },
    plan: { version: 7, digest: 'e'.repeat(64) },
    attempts: [{
      role: 'reviewer', nodeKey: 'reviewer-old', taskId: 'task-reviewer-old', state: 'accepted',
      route: { observed: { harness: 'claude-code', model: 'reviewer-old', effort: 'high' } },
      verification: { accepted: true, digest: 'f'.repeat(64) },
    }], candidates: [{ role: 'reviewer', candidateId: 'candidate-reviewer-old', resultSha: '3'.repeat(40) }],
  }],
  ownership: { workers: 1 }, terminalCause: null,
};

function fixture() {
  let snapshots = 0;
  const snapshot = {
    artifacts: [{ id: 'artifact-work', taskId: 'task-work', kind: 'commit', digest: '3'.repeat(64),
      recordedEvent: 10, recordedAt: '2026-07-19T10:00:00.000Z' },
    { id: 'artifact-reviewer', taskId: 'task-reviewer', kind: 'verification', digest: '4'.repeat(64),
      recordedEvent: 20, recordedAt: '2026-07-19T11:00:00.000Z' },
    { id: 'artifact-reviewer-old', taskId: 'task-reviewer-old', kind: 'commit', digest: '5'.repeat(64),
      recordedEvent: 5, recordedAt: '2026-07-19T09:00:00.000Z' }],
    representations: [{
      representationId: 'representation:work', taskId: 'task-work', recordedEvent: 12,
      recordedAt: '2026-07-19T10:01:00.000Z', sourceNode: { id: 'artifact:artifact-work' },
      edges: [{ id: 'atlas-derived', type: 'DerivedFrom', from: 'representation:work',
        to: 'artifact:artifact-work', evidence: [{ coordinationSeq: 9 }], observedSeq: 12,
        observedAt: '2026-07-19T10:01:00.000Z', validFrom: '2026-07-19T10:01:00.000Z', validTo: null }],
    }],
    knowledge: { nodes: [{
      id: 'claim:work', taskId: 'task-work', evidence: [{ artifactId: 'artifact-work' }],
      observedSeq: 13, observedAt: '2026-07-19T10:02:00.000Z', validFrom: '2026-07-19T10:02:00.000Z', validTo: null,
    }, {
      id: 'claim:reviewer', taskId: 'task-reviewer', evidence: [{ artifactId: 'artifact-reviewer' }],
      observedSeq: 21, observedAt: '2026-07-19T11:02:00.000Z', validFrom: '2026-07-19T11:02:00.000Z', validTo: null,
    }], edges: [{
      id: 'contradiction-1', type: 'Contradicts', from: 'claim:reviewer', to: 'claim:work',
      evidence: [{ coordinationSeq: 21 }], observedSeq: 22,
      observedAt: '2026-07-19T11:03:00.000Z', validFrom: '2026-07-19T11:03:00.000Z', validTo: null,
    }], reads: [], contamination: [] },
  };
  const application = Object.create(BatonApplication.prototype);
  application.driver = { coordination: { snapshot: () => { snapshots += 1; return snapshot; } } };
  return { application, count: () => snapshots };
}

test('P92-EA1: one context supports every Episode item with O(1) broad snapshots', () => {
  const f = fixture();
  const context = f.application._episodeContext(current, view);
  const items = ['outline', 'output', 'sources', 'derivations', 'contradictions', 'trace',
    'route', 'verification', 'result', 'cleanup', 'help']
    .map((topic) => f.application._episodeItem(current, view, topic, null, context));
  assert.equal(items.every(Boolean), true);
  assert.equal(f.count(), 1);
});

test('P92-EA2: roles cannot claim sibling artifacts, result, route, verification, or cleanup', () => {
  const f = fixture();
  const context = f.application._episodeContext(current, view);
  const workTrace = f.application._episodeItem(current, view, 'trace', 'work', context).value;
  const reviewerTrace = f.application._episodeItem(current, view, 'trace', 'reviewer', context).value;
  assert.equal(JSON.stringify(workTrace).includes('artifact-reviewer'), false);
  assert.equal(JSON.stringify(reviewerTrace).includes('artifact-work'), false);
  assert.equal(f.application._episodeItem(current, view, 'result', 'work', context).value.value.resultSha, '1'.repeat(40));
  assert.equal(f.application._episodeItem(current, view, 'result', null, context).value.value.resultSha, '2'.repeat(40));
  assert.equal(f.application._episodeItem(current, view, 'route', 'work', context).value.value.observed.model, 'builder');
  assert.equal(f.application._episodeItem(current, view, 'verification', 'work', context).value.value.digest, '1'.repeat(64));
  const reviewerCleanup = f.application._episodeItem(current, view, 'cleanup', 'reviewer', context).value;
  assert.equal(reviewerCleanup.state, 'reaped');
  assert.equal(reviewerCleanup.released.length, 1);
  assert.equal(f.application._episodeItem(current, view, 'cleanup', 'work', context).value.state, 'active');
});

test('P92-EA3: contradiction direction and temporal/evidence coordinates survive projection', () => {
  const f = fixture();
  const context = f.application._episodeContext(current, view);
  const edge = f.application._episodeItem(current, view, 'contradictions', null, context)
    .value.edges.find((candidate) => candidate.sourceEdgeType === 'Contradicts');
  assert.equal(edge.from, 'claim:work');
  assert.equal(edge.to, 'claim:reviewer');
  assert.deepEqual(edge.evidence, [{ coordinationSeq: 21 }]);
  assert.deepEqual(edge.temporal, {
    observedSeq: 22, observedAt: '2026-07-19T11:03:00.000Z',
    validFrom: '2026-07-19T11:03:00.000Z', validTo: null,
  });
});

test('P92-EA4: predecessor generations remain exactly addressable and never fall through to current authority', () => {
  const f = fixture();
  const context = f.application._episodeContext(current, view);
  const streams = context.streams.filter((stream) => stream.value.role === 'reviewer');
  assert.deepEqual(streams.map((stream) => stream.value.generation).sort(), [1, 2]);
  assert.deepEqual(streams.find((stream) => stream.value.generation === 1).value.revision,
    { id: 'revision-predecessor', digest: '8'.repeat(64) });
  assert.notEqual(streams.at(-1).value.generation, current.plan.version,
    'semantic generation is the durable workflow round, not an inferred Plan version');
  const predecessor = f.application._episodeItem(current, view, 'trace', 'reviewer', context, 1);
  assert.equal(JSON.stringify(predecessor).includes('artifact-reviewer-old'), true);
  assert.equal(JSON.stringify(predecessor).includes('artifact-reviewer"'), false);
  const currentResult = f.application._episodeItem(current, view, 'result', 'reviewer', context, 2);
  const oldResult = f.application._episodeItem(current, view, 'result', 'reviewer', context, 1);
  assert.equal(currentResult.value.value.resultSha, '2'.repeat(40));
  assert.equal(oldResult.value.value.resultSha, '3'.repeat(40));
});
