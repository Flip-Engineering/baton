import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeWorkflowRevision, workflowRevisionDigest,
} from '../src/workflow-revision.mjs';

const hex = (character) => character.repeat(64);

function revision(overrides = {}) {
  const changedPaths = ['src/a.mjs', 'src/b.mjs'];
  return {
    schemaVersion: 1,
    kind: 'candidate_feedback_revision',
    round: 1,
    workflow: { definitionDigest: hex('a') },
    predecessorPlan: { planId: `plan:${hex('b')}`, version: 1, digest: hex('c') },
    parent: {
      role: 'builder', nodeKey: 'attempt:builder', taskId: 'task-builder',
      candidateId: `candidate:${hex('d')}`, candidateDigest: hex('d'),
      resultSha: 'e'.repeat(40), retainedResultRef: `refs/baton/results/${'e'.repeat(40)}`,
      treeIdentityDigest: hex('f'), changedPaths,
      changedPathsDigest: workflowRevisionDigest(changedPaths), evidenceDigest: hex('1'),
      commitArtifact: { id: `artifact:${hex('2')}`, digest: hex('3') },
      verificationArtifact: { id: `artifact:${hex('4')}`, digest: hex('5') },
    },
    feedback: [{
      feedbackId: `feedback:${hex('6')}`, feedbackDigest: hex('7'), eventSeq: 42,
      feedback: {
        summary: 'Correct the exact retained Candidate.',
        findings: [{
          kind: 'defect', severity: 'high', message: 'Fix the changed line.',
          path: 'src/a.mjs', line: 4,
        }],
      },
    }],
    decision: {
      actionId: 'action-revise', principalScopeDigest: hex('8'), reasonDigest: hex('9'),
    },
    ...overrides,
  };
}

test('RF0: revision envelopes are closed, canonical, and content-addressed', () => {
  const first = normalizeWorkflowRevision(revision());
  const reordered = revision();
  reordered.parent.changedPaths = [...reordered.parent.changedPaths].reverse();
  reordered.parent.changedPathsDigest = workflowRevisionDigest([...reordered.parent.changedPaths].sort());
  const second = normalizeWorkflowRevision(reordered);
  assert.equal(first.revisionId, `revision:${first.revisionDigest}`);
  assert.equal(first.revisionDigest, second.revisionDigest);
  assert.deepEqual(first.parent.changedPaths, ['src/a.mjs', 'src/b.mjs']);
  assert.equal(Object.isFrozen(first), true);
  assert.deepEqual(normalizeWorkflowRevision(first), first);
});

test('RF0: every authority-bearing revision coordinate changes identity or refuses', () => {
  const baseline = normalizeWorkflowRevision(revision());
  const changed = [
    { round: 2 },
    { predecessorPlan: { planId: `plan:${hex('b')}`, version: 2, digest: hex('0') } },
    { decision: { actionId: 'action-revise', principalScopeDigest: hex('8'), reasonDigest: hex('0') } },
  ];
  for (const override of changed) {
    assert.notEqual(normalizeWorkflowRevision(revision(override)).revisionDigest,
      baseline.revisionDigest);
  }
  assert.throws(() => normalizeWorkflowRevision({ ...revision(), surprise: true }),
    (error) => error?.code === 'workflow_revision_invalid');
  assert.throws(() => normalizeWorkflowRevision(revision({
    parent: { ...revision().parent, retainedResultRef: `refs/baton/results/${'0'.repeat(40)}` },
  })), (error) => error?.code === 'workflow_revision_invalid');
  assert.throws(() => normalizeWorkflowRevision(revision({
    feedback: [{
      ...revision().feedback[0],
      feedback: {
        summary: 'Reject secret=abcdefghijklmnopqrstuvwxyz.',
        findings: revision().feedback[0].feedback.findings,
      },
    }],
  })), (error) => error?.code === 'workflow_revision_invalid');
});
