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
/** G-9: a verify sandbox `verifyContribution` could not remove is a named fact about the hub.
 * The verdict is untouched by it — a leaked sandbox is never a failed check — but it is also never
 * left for `attempt.cleanup.state` alone to hint at. Recorded only when there IS a leak. */
const cleanupLeak = (cleanupError) => (cleanupError ? Object.freeze({
  state: 'incomplete',
  code: typeof cleanupError.code === 'string' ? cleanupError.code : 'worktree_cleanup_failed',
  paths: Object.freeze([...(Array.isArray(cleanupError.paths) ? cleanupError.paths : [])]),
  message: String(cleanupError.message ?? cleanupError),
}) : null);

/** Immutable contribution operations. Session/pause ownership stays with the coordinator;
 * this service owns revision retention, isolated checks, and attributable operation receipts. */
export class ContributionService {
  constructor({ worktrees, referee, accept, acceptOptions, capture, record, events, closeVerdict, verificationFor = null, hostCapacity = null }) {
    Object.assign(this, { worktrees, referee, accept, acceptOptions, captureTree: capture, record, events, closeVerdict, verificationFor });
    // #297: the host-wide capacity authority every resident shares — a check's full-suite verdict
    // is admitted through it before the deployment's own verification lane orders it.
    this.hostCapacity = hostCapacity;
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
      // boundary. The identity is spent, and the remedy belongs to the caller: a NEW checkId
      // (G-4 — carried on the thrown error as `gracefulPath`, not left in this comment).
      const unavailable = related.find((event) => event.kind === 'contribution.check_unavailable');
      const gracefulPath = `contribution "${contributionId}" check "${checkId}" carries a started check with no verdict — mint a new checkId to check this capture again`;
      const error = failure(`The prior contribution check did not produce a verdict; ${gracefulPath}`,
        unavailable?.payload?.code ?? 'contribution_check_unconfirmed');
      error.verificationAttempt = copy(unavailable?.payload?.attempt ?? null);
      error.gracefulPath = gracefulPath;
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
    // #269: the deployment may check a capture that touches none of its code paths with the
    // docs verification instead of the whole suite; the selection is recorded with the check.
    const selected = typeof this.verificationFor === 'function'
      ? this.verificationFor(captured.changedPaths ?? [], source.brief.verification) : null;
    const selection = selected?.selection ?? 'code';
    if (selected?.verification) source.brief.verification = selected.verification;
    const workspaceId = `contribution-${createHash('sha256')
      .update(JSON.stringify([handle.id, contributionId, checkId])).digest('hex')}`;
    let checked;
    this.record('contribution.check_started', {
      contributionId, checkId, sha: captured.sha, ref: captured.ref,
      verification: { selection, command: source.brief.verification.command },
    }, handle, task);
    // The deployment's verification lane is full: say so durably, so a waiting check reads as a
    // queue position and not as a slow verifier (#269).
    const lane = this.referee?.lane ?? null;
    if (lane && lane.running >= lane.concurrency) {
      this.record('contribution.check_queued', {
        contributionId, checkId, position: lane.queued + 1, running: lane.running, concurrency: lane.concurrency,
      }, handle, task);
    }
    // #297: the host admits this verdict BEFORE the deployment's lane orders it — a check whose
    // suite would be starved waits as a visible host queue entry (its typed queued row is
    // recorded the moment it is enqueued) instead of starting work the machine cannot run. The
    // lease is held for the verdict and released whichever way it ends.
    let admission = null;
    let hostLease = null;
    if (this.hostCapacity && typeof this.hostCapacity.acquire === 'function') {
      let queuedRow = null;
      const admitted = await this.hostCapacity.acquire('verify', {
        holder: `check:${contributionId}:${checkId}`,
        onQueued: (row) => {
          queuedRow = row;
          this.record('contribution.check_host_queued', {
            contributionId, checkId, authority: 'host', kind: 'verify',
            position: row.position, ahead: row.ahead,
            running: row.running, workerLeases: row.workerLeases,
          }, handle, task);
        },
      });
      hostLease = admitted.token;
      admission = {
        state: 'admitted', authority: 'host',
        ...(queuedRow ? { position: queuedRow.position, ahead: queuedRow.ahead,
          queuedAt: admitted.queuedAt ?? null } : {}),
      };
    }
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
      if (hostLease) await this.hostCapacity.release(hostLease).catch(() => {});
      const leak = cleanupLeak(error.cleanupError);
      this.record('contribution.check_unavailable', {
        contributionId, checkId, sha: captured.sha, ref: captured.ref,
        code: error.code ?? 'verification_unavailable', attempt: error.verificationAttempt ?? null,
        ...(leak ? { cleanup: leak } : {}),
      }, handle, task);
      throw error;
    }
    if (hostLease) await this.hostCapacity.release(hostLease).catch(() => {});
    const leak = cleanupLeak(checked.cleanupError);
    const receipt = {
      contributionId, checkId, sha: captured.sha, ref: captured.ref,
      verification: { selection, command: source.brief.verification.command },
      passed: this.accept(checked.observedVerdict, {
        ...this.acceptOptions, expectExit: source.brief.verification.expectExit,
      }) === true,
      verdict: this.closeVerdict(checked.observedVerdict, source.brief.verification),
      attempt: checked.attempt,
      // #297: the typed admission row the check reports beside its verdict.
      ...(admission ? { admission } : {}),
      ...(leak ? { cleanup: leak } : {}),
    };
    this.record('contribution.checked', receipt, handle, task);
    return copy(receipt);
  }
}
