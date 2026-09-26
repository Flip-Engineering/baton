import { createHash } from 'node:crypto';

const copy = (value) => structuredClone(value);
const failure = (message, code) => Object.assign(new Error(message), { code });
const identity = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw failure('Contribution operation requires an identity', 'contribution_invalid');
  }
  return value;
};

/** Immutable contribution operations. Session/pause ownership stays with the coordinator;
 * this service owns revision retention and attributable operation receipts. */
export class ContributionService {
  constructor({ worktrees, referee, accept, acceptOptions, capture, record, events, closeVerdict, verificationFor = null, hostCapacity = null, repoRoot = null }) {
    Object.assign(this, { worktrees, captureTree: capture, record, events });
  }

  captured(workerId, contributionId) {
    identity(contributionId);
    return this.events(workerId).find((event) => event.kind === 'contribution.captured'
      && event.payload?.contributionId === contributionId)?.payload ?? null;
  }

  async capture({ task, handle, contributionId }) {
    const prior = this.captured(handle.id, contributionId);
    if (prior) return copy(prior);
    const captured = await this.captureTree(handle, task);
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(captured?.sha ?? '')) {
      throw failure('Contribution capture did not identify a revision', 'capture_failed');
    }
    if (typeof this.worktrees.retainCheckpoint !== 'function'
      || typeof this.worktrees.resolveCheckpoint !== 'function') {
      throw failure('Contribution retention is unavailable', 'contribution_retention_unavailable');
    }
    const ref = await this.worktrees.retainCheckpoint(captured.sha);
    if (await this.worktrees.resolveCheckpoint(ref) !== captured.sha) {
      throw failure('Contribution retention postcheck failed', 'checkpoint_failed');
    }
    const receipt = {
      contributionId, workerId: handle.id, taskId: task.id, runId: task.runId ?? null,
      sha: captured.sha, ref, changedPaths: captured.changedPaths ?? [],
      ...(captured.workspace ? { workspace: copy(captured.workspace) } : {}),
      ...(captured.observedHead ? { observedHead: captured.observedHead } : {}),
      basis: {
        brief: copy(task.brief),
        sessionContext: copy(task.sessionContext ?? {}),
        worktree: handle.worktree ?? task.worktree,
        sparseCheckoutIdentity: captured.sparseCheckoutIdentity ?? null,
      },
    };
    this.record('contribution.captured', receipt, handle, task);
    return copy(receipt);
  }
}
