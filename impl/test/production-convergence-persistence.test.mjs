import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DurableProductionConvergenceRuntime } from '../src/production-deployment-convergence.mjs';

function stateRoot() {
  return mkdtempSync(join(tmpdir(), 'baton-convergence-persist-'));
}

test('journal, member attempts, subscriptions, pins and evaluation survive reopen', async () => {
  const root = stateRoot();
  try {
    const first = new DurableProductionConvergenceRuntime({
      repoRoot: root,
      stateRoot: join(root, 'state'),
      worktreeRoot: join(root, 'worktrees'),
    });
    first.supervisor.addMember({
      memberId: 'member:reviewer', objective: 'review', role: 'reviewer', scope: ['impl/src'],
    });
    first.supervisor.startAttempt('member:reviewer', {
      baseSha: 'a'.repeat(40), worktreeId: 'worktree:reviewer',
      route: { harness: 'fake', model: 'model', effort: 'high' },
      providerSession: 'session:reviewer', fence: 7,
    });
    first.supervisor.classifyDeath('member:reviewer', {
      kind: 'provider_refusal', retriable: true, reattachEligible: true,
      providerEvidenceRef: 'artifact:death',
    });
    const subscription = first.notifications.subscribe({
      principalId: 'operator', runId: 'run:a', cursor: 0,
    });
    const attentionId = first.notifications.publishAttention({
      runId: 'run:a', kind: 'answer_decision', detail: { requestId: 'request:a' },
    });
    const page = first.notifications.poll(subscription.subscriptionId);
    first.notifications.acknowledgeCursor(subscription.subscriptionId, page.nextCursor);
    first.registerTerminalPin('pin:terminal');
    first.recordEvaluation({
      verifiedSuccess: 1, interventions: 2, wallMs: 3, tokens: 4, costUsd: 5,
      retries: 1, strandedAttention: 1, integrationDefects: 1, cleanupFailures: 1,
    });
    const firstPersistedSeq = first.audit().storage.persistedSeq;
    await first.close();

    const second = new DurableProductionConvergenceRuntime({
      repoRoot: root,
      stateRoot: join(root, 'state'),
      worktreeRoot: join(root, 'worktrees'),
    });
    const after = second.audit();
    assert.ok(after.storage.persistedSeq > firstPersistedSeq);
    assert.equal(second.supervisor.member('member:reviewer').currentAttempt.fence, 7);
    assert.equal(
      second.supervisor.member('member:reviewer').currentAttempt.deathCertificate.classification,
      'provider_refusal',
    );
    assert.equal(second.notifications.subscription(subscription.subscriptionId).cursor, page.nextCursor);
    assert.ok(second.notifications.census().openAttention.some((item) => item.id === attentionId));
    assert.ok(second.terminalPins.has('pin:terminal'));
    assert.deepEqual(after.evaluation, {
      verifiedSuccess: 1, interventions: 2, wallMs: 3, tokens: 4, costUsd: 5,
      retries: 1, strandedAttention: 1, integrationDefects: 1, cleanupFailures: 1,
    });
    assert.ok(second.journal.events().some((event) => event.type === 'member.attempt.died'));

    second.notifications.resolveAttention(attentionId, 'operator');
    await second.close();
    const third = new DurableProductionConvergenceRuntime({
      repoRoot: root,
      stateRoot: join(root, 'state'),
      worktreeRoot: join(root, 'worktrees'),
    });
    assert.equal(third.notifications.census().openAttention.length, 0);
    assert.ok(third.audit().storage.persistedSeq > after.storage.persistedSeq);
    await third.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('snapshot projection boundary replays an appended suffix byte-equivalently', async () => {
  const root = stateRoot();
  try {
    const runtime = new DurableProductionConvergenceRuntime({
      repoRoot: root, stateRoot: join(root, 'state'), worktreeRoot: join(root, 'worktrees'),
    });
    runtime.journal.append('command.admitted', {
      commandId: 'cmd:one', command: 'run.start', args: {}, principalId: 'operator',
    });
    await new Promise((resolve) => queueMicrotask(resolve));
    const checkpoint = runtime.checkpoint();
    runtime.journal.append('effect.succeeded', {
      commandId: 'cmd:one', command: 'run.start', resultDigest: 'a'.repeat(64),
    });
    await new Promise((resolve) => queueMicrotask(resolve));
    assert.equal(
      runtime.replayDigest({ snapshot: checkpoint.projection }),
      runtime.replayDigest(),
    );
    await runtime.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
