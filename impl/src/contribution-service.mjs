import { createHash } from 'node:crypto';
import { verifyContribution } from './contribution-verification.mjs';
import { selectFromRepository } from './verification-selection.mjs';

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
/** #593: the landing gate's comparison, in the closed verdict vocabulary the durable receipt
 * carries (`closedVerificationVerdict` reads `passed` as given). `observedExit` is the candidate
 * run's own exit — evidence of what the runner returned, never an expectation match: the
 * comparison, not the exit code, decides. */
const comparisonVerdict = (row) => {
  const blocking = Array.isArray(row?.unexpected) ? row.unexpected : [];
  const passed = blocking.length === 0;
  return {
    reverified: true,
    passed,
    observedExit: Number.isSafeInteger(row?.exit) ? row.exit : null,
    locus: 'fresh_sandbox',
    execution: { state: 'completed' },
    outcome: passed ? 'passed' : 'candidate_failed',
    failureOwnership: passed ? null : 'candidate',
    diagnosticCode: passed ? 'verification_passed' : 'verification_exit_mismatch',
  };
};

/** #300: the pre-verdict selection reads the CAPTURED revision, never the hub's own checkout —
 * a capture may be older or newer than the deployment's tree. The ceiling is the widest
 * per-file read the captured-file seam admits (16 MiB): the graph must see every source file
 * whole, and a truncating bound here would silently under-select its importers. */
const PREVERDICT_READ_CEILING = 16 * 1024 * 1024;

/** Immutable contribution operations. Session/pause ownership stays with the coordinator;
 * this service owns revision retention, isolated checks, and attributable operation receipts. */
export class ContributionService {
  constructor({ worktrees, referee, accept, acceptOptions, capture, record, events, closeVerdict, verificationFor = null, hostCapacity = null, repoRoot = null, comparisonGates = null }) {
    Object.assign(this, { worktrees, referee, accept, acceptOptions, captureTree: capture, record, events, closeVerdict, verificationFor, repoRoot });
    // #297: the host-wide capacity authority every resident shares — a check's full-suite verdict
    // is admitted through it before the deployment's own verification lane orders it.
    this.hostCapacity = hostCapacity;
    // #593: the landing gate's own comparison over a capture's selected files (see _check). Null
    // when the deployment wires none: the pinned verification stays the acceptance then.
    this.comparisonGates = comparisonGates;
    this.pending = new Map();
    // #300: the selection is a function of the capture (sha + changed paths) and the captured
    // tree cannot change, so it is computed once per capture and reused by every later check.
    this.preverdictSelections = new Map();
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
    // #300: the affected subset is derived before anything runs, so the started record already
    // names what will run first.
    const preverdict = this._preverdictPlan(captured, selection, source);
    // #593: a code capture with a usable selection is accepted by the LANDING's own comparison —
    // one implementation, shared with the landing gate — over the selected files against the
    // capture's base. A check therefore costs those files instead of the whole suite twice, and a
    // failure the base shares never fails the capture. Anything else (a docs selection, a capture
    // whose imports cannot be read, a deployment with no comparison authority) keeps the pinned
    // verification.
    const baseSha = typeof source.sessionContext?.baseSha === 'string' ? source.sessionContext.baseSha : null;
    const compared = this.comparisonGates !== null && preverdict.selection !== undefined && baseSha !== null;
    const workspaceId = `contribution-${createHash('sha256')
      .update(JSON.stringify([handle.id, contributionId, checkId])).digest('hex')}`;
    let checked;
    this.record('contribution.check_started', {
      contributionId, checkId, sha: captured.sha, ref: captured.ref,
      verification: { selection, command: source.brief.verification.command },
      preverdict: preverdict.contract
        ? { files: preverdict.selection.files.length, command: preverdict.contract.command,
          // #593: the acceptance these files are judged by — the landing gate's comparison
          // against the capture's base, or the pinned verification when no comparison applies.
          ...(compared ? { acceptance: 'comparison', baseSha } : {}) }
        : { skipped: preverdict.skipped },
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
    // lease is held for the verdict (preverdict subset included) and released whichever way it ends.
    //
    // #593: the comparison path takes NO lease here. Its gate run is the runner's own supervised
    // child, which takes the host admission through the runner's seam; a lease held across it
    // would queue that run behind this very call.
    let admission = null;
    let hostLease = null;
    if (!compared && this.hostCapacity && typeof this.hostCapacity.acquire === 'function') {
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
    let preverdictRow;
    let comparisonRow = null;
    try {
      if (compared) {
        comparisonRow = await this.comparisonGates({
          sha: captured.sha, baseSha, files: preverdict.selection.files,
          requiredPaths: captured.changedPaths ?? [], label: workspaceId,
        });
      } else {
        preverdictRow = await this._runPreverdict({ captured, source, preverdict, workspaceId, signal });
        checked = await verifyContribution({
          worktrees: this.worktrees, referee: this.referee, task: source,
          capture: { ...captured, sparseCheckoutIdentity: captured.basis.sparseCheckoutIdentity },
          workspaceId, signal,
          beforeVerify: this.acceptOptions.requireCoverage && typeof this.worktrees.changedLines === 'function'
            ? async () => { source.changedLines = await this.worktrees.changedLines(source.sessionContext.baseSha, captured.sha); }
            : null,
        });
      }
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
    const leak = cleanupLeak(compared ? comparisonRow?.cleanupError : checked.cleanupError);
    const receipt = {
      contributionId, checkId, sha: captured.sha, ref: captured.ref,
      verification: {
        selection, command: source.brief.verification.command,
        // #593: the comparison's own coordinates, so a reader sees what was judged against what.
        ...(compared ? { locus: 'comparison', baseSha, files: preverdict.selection.files.length } : {}),
      },
      // #593: the comparison's own rule decides — a capture passes when its run reported no
      // failure the capture's base does not also report. The referee's signal gates
      // (redGreen/coverage/mutation) belong to a pinned verification and are not applied here.
      passed: compared
        ? (Array.isArray(comparisonRow?.unexpected) ? comparisonRow.unexpected : []).length === 0
        : this.accept(checked.observedVerdict, {
          ...this.acceptOptions, expectExit: source.brief.verification.expectExit,
        }) === true,
      verdict: compared
        ? this.closeVerdict(comparisonVerdict(comparisonRow), source.brief.verification)
        : this.closeVerdict(checked.observedVerdict, source.brief.verification),
      attempt: compared
        ? Object.freeze({
          phase: 'verifier_execution', verifierStarted: true,
          cleanup: Object.freeze({
            state: comparisonRow?.cleanupError ? 'incomplete' : 'closed',
            code: comparisonRow?.cleanupError?.code ?? null,
          }),
        })
        : checked.attempt,
      // #297: the typed admission row the check reports beside its verdict.
      ...(admission ? { admission } : {}),
      // #300: the affected subset's own typed verdict — or the closed reason nothing ran. #593:
      // on the comparison path that subset IS the acceptance, so its verdict is the comparison's.
      preverdict: compared
        ? { selection: preverdict.selection, verdict: this.closeVerdict(comparisonVerdict(comparisonRow), source.brief.verification) }
        : preverdictRow,
      // #593: the comparison's verdict line and the two failure sets it decided between.
      ...(compared ? {
        comparison: {
          baseSha,
          verdictLine: comparisonRow?.verdictLine ?? null,
          blocking: Array.isArray(comparisonRow?.unexpected) ? comparisonRow.unexpected : [],
          sharedOnBase: Array.isArray(comparisonRow?.failingOnTarget) ? comparisonRow.failingOnTarget : [],
        },
      } : {}),
      ...(leak ? { cleanup: leak } : {}),
    };
    this.record('contribution.checked', receipt, handle, task);
    return copy(receipt);
  }

  /** #300: the pre-verdict plan for one capture — which affected test files run first and under
   * which contract, or the closed reason none will. Never throws: an unusable selection must
   * not stop the check, it must be named on the receipt instead. Cached per capture (the
   * captured tree cannot change), so repeated checks of the same sha re-read nothing. */
  _preverdictPlan(captured, selection, source) {
    if (selection === 'docs') return { skipped: 'docs' };
    const contract = source.brief.verification;
    if (!Array.isArray(contract?.arguments)) return { skipped: 'contract_shape' };
    const changedPaths = [...(captured.changedPaths ?? [])].sort();
    const cacheKey = JSON.stringify([captured.sha, changedPaths]);
    if (this.preverdictSelections.has(cacheKey)) return this.preverdictSelections.get(cacheKey);
    const plan = this._derivePreverdictPlan(captured, changedPaths, contract);
    this.preverdictSelections.set(cacheKey, plan);
    return plan;
  }

  _derivePreverdictPlan(captured, changedPaths, contract) {
    if (!this.repoRoot || typeof this.worktrees.readCommitFile !== 'function') {
      return { skipped: 'selection_unavailable' };
    }
    let selected;
    try {
      // The graph is read from the CAPTURED revision: a capture may carry imports or tests the
      // hub's own checkout has never seen, and only the captured tree can say what affects it.
      const readAtCapture = (path) => {
        try { return this.worktrees.readCommitFile(captured.sha, path, PREVERDICT_READ_CEILING).text; }
        catch { return null; }
      };
      selected = selectFromRepository({ root: this.repoRoot, changedPaths, read: readAtCapture });
    } catch {
      return { skipped: 'selection_unavailable' };
    }
    if (selected.files.length === 0) return { skipped: 'no_affected_tests' };
    // The selected files ride the contract's own argv: `npm test --prefix impl <files…>` and a
    // direct runner argv both forward plain positional file arguments unchanged.
    return {
      selection: {
        changedPaths,
        files: selected.files,
        reason: selected.reason,
        provenance: selected.provenance,
      },
      contract: { ...contract, arguments: [...contract.arguments, ...selected.files] },
    };
  }

  /** Run the affected subset first and close its verdict as its own typed receipt row. A subset
   * run that cannot produce a verdict is recorded as exactly that — the full suite after it
   * stays the acceptance authority, so a red or unavailable subset never fails the check alone. */
  async _runPreverdict({ captured, source, preverdict, workspaceId, signal }) {
    if (!preverdict.contract) return { skipped: preverdict.skipped };
    const task = { ...source, brief: { ...source.brief, verification: preverdict.contract } };
    try {
      const observed = await verifyContribution({
        worktrees: this.worktrees, referee: this.referee, task,
        capture: { ...captured, sparseCheckoutIdentity: captured.basis.sparseCheckoutIdentity },
        workspaceId: `${workspaceId}-preverdict`, signal,
      });
      return { selection: preverdict.selection, verdict: this.closeVerdict(observed.observedVerdict, preverdict.contract) };
    } catch (error) {
      if (signal?.aborted) throw error;
      return {
        selection: preverdict.selection,
        verdict: { state: 'unavailable', code: error.code ?? 'verification_unavailable' },
      };
    }
  }
}
