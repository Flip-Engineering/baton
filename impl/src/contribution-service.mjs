import { createHash } from 'node:crypto';
import { verifyContribution } from './contribution-verification.mjs';

const copy = (value) => structuredClone(value);
const failure = (message, code) => Object.assign(new Error(message), { code });
const identity = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw failure('Contribution operation requires an identity', 'contribution_invalid');
  }
  return value;
};

/** Immutable contribution operations. Session/pause ownership stays with the coordinator;
 * this service owns revision retention, isolated checks, and attributable operation receipts. */
export class ContributionService {
  constructor({ worktrees, referee, accept, acceptOptions, capture, record, events, closeVerdict }) {
    Object.assign(this, { worktrees, referee, accept, acceptOptions, captureTree: capture, record, events, closeVerdict });
    this.pending = new Map();
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
      // A captured checkout is DESCRIBED, never claimed: which physical workspace it was, whether
      // it was shared (and by how many holders), and the HEAD it showed before the capture. The
      // author/reviewer identity below is unchanged — these fields say nothing about who wrote
      // which line.
      ...(captured.workspace ? { workspace: copy(captured.workspace) } : {}),
      ...(captured.observedHead ? { observedHead: captured.observedHead } : {}),
      // This is the identified acceptance basis, not the author's current working state.
      // Retain it now so checks after further edits or session closure use the same inputs.
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

  async check({ handle, task, contributionId, checkId, signal }) {
    const key = JSON.stringify([handle.id, identity(contributionId), identity(checkId)]);
    if (this.pending.has(key)) return this.pending.get(key);
    const operation = this._check({ handle, task, contributionId, checkId, signal });
    this.pending.set(key, operation);
    try { return await operation; }
    finally { if (this.pending.get(key) === operation) this.pending.delete(key); }
  }

  async _check({ handle, task, contributionId, checkId, signal }) {
    identity(checkId);
    const related = this.events(handle.id).filter((event) => event.payload?.contributionId === contributionId
      && event.payload?.checkId === checkId);
    const prior = related.find((event) => event.kind === 'contribution.checked');
    if (prior) return copy(prior.payload);
    if (related.some((event) => event.kind === 'contribution.check_started')) {
      // Replay restores facts; it must not repeat a command that may have crossed its effect
      // boundary. An explicit new check has a new identity after the caller reviews this fate.
      const unavailable = related.find((event) => event.kind === 'contribution.check_unavailable');
      const error = failure('The prior contribution check did not produce a verdict',
        unavailable?.payload?.code ?? 'contribution_check_unconfirmed');
      error.verificationAttempt = copy(unavailable?.payload?.attempt ?? null);
      throw error;
    }
    const captured = this.captured(handle.id, contributionId);
    if (!captured) throw failure('Contribution has not been captured', 'contribution_unknown');
    if (await this.worktrees.resolveCheckpoint(captured.ref) !== captured.sha) {
      throw failure('Retained contribution no longer resolves to its revision', 'contribution_changed');
    }
    const source = {
      id: captured.taskId, runId: captured.runId,
      brief: copy(captured.basis.brief), sessionContext: copy(captured.basis.sessionContext),
      worktree: captured.basis.worktree,
    };
    const workspaceId = `contribution-${createHash('sha256')
      .update(JSON.stringify([handle.id, contributionId, checkId])).digest('hex')}`;
    let checked;
    this.record('contribution.check_started', {
      contributionId, checkId, sha: captured.sha, ref: captured.ref,
    }, handle, task);
    try {
      checked = await verifyContribution({
        worktrees: this.worktrees, referee: this.referee, task: source,
        capture: { ...captured, sparseCheckoutIdentity: captured.basis.sparseCheckoutIdentity },
        workspaceId, signal,
        beforeVerify: this.acceptOptions.requireCoverage && typeof this.worktrees.changedLines === 'function'
          ? async () => { source.changedLines = await this.worktrees.changedLines(source.sessionContext.baseSha, captured.sha); }
          : null,
      });
    } catch (error) {
      this.record('contribution.check_unavailable', {
        contributionId, checkId, sha: captured.sha, ref: captured.ref,
        code: error.code ?? 'verification_unavailable', attempt: error.verificationAttempt ?? null,
      }, handle, task);
      throw error;
    }
    const receipt = {
      contributionId, checkId, sha: captured.sha, ref: captured.ref,
      passed: this.accept(checked.observedVerdict, {
        ...this.acceptOptions, expectExit: source.brief.verification.expectExit,
      }) === true,
      verdict: this.closeVerdict(checked.observedVerdict, source.brief.verification),
      attempt: checked.attempt,
    };
    this.record('contribution.checked', receipt, handle, task);
    return copy(receipt);
  }
}
