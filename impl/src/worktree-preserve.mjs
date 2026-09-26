// worktree-preserve.mjs — issue #594. Seat work preservation.
//
// Baton holds every seat's commits, worktrees and uncommitted changes on one disk: the
// resident checkout's own object store. On 2026-09-25 a power loss erased the /private/tmp
// resident, and the operator's cron-driven sweep then pushed 73 refs and 23 uncommitted
// snapshots that existed only on that host (preserve-sweep.log, 20260925T065021Z). This module
// is that sweep's function in the runtime, driven by the events that produce the work instead
// of a timer: a seat commit publishes when its observation drains, a contribution publishes
// when its record lands, and a seat's uncommitted changes publish when the runtime observes
// the turn boundary they belong to. The destination is the deployment's DECLARED shared
// remote (`advanced.integration.publishRemote`, the same remote a landing publishes to), under
// `refs/baton/preserve/*`:
//
//   refs/baton/preserve/branches/<seat>/<branch>      every seat commit and contribution
//   refs/baton/preserve/uncommitted/<seat>            the turn-end snapshot of uncommitted work
//
// Refs are named by the seat, never by time: a later push replaces the earlier ref for the
// same seat, and the history stays in the commits. A push that fails is recorded with its
// cause and retried on the next such event (the sweep's own log records the FAILED pushes it
// saw); no timer runs. The worktrees are untouched: an uncommitted snapshot is a commit built
// from a private index (`GIT_INDEX_FILE` pointed at a temporary file), so the seat's own index
// and working tree never observe it.
//
// Issue #379: every preserve git call runs on an AWAITED child serialized through the
// preserver's own queue — the event that produced the work answers at once, and a slow push
// (a cold remote, a credential helper) or an `add --all` over a large checkout never holds the
// resident's loop. The queue is the ordering authority the per-ref dedupe and the pending
// retry already reason about: one job at a time, in the order the events produced them.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The ref namespace every preserve push publishes under. */
export const PRESERVE_REF_PREFIX = 'refs/baton/preserve/';

const GIT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

/** The branch preserve ref one seat's commit publishes to. A commit on no branch (a detached
 * HEAD) preserves under `detached`, so the work is published with a name the next push on
 * that checkout replaces. */
export function preserveBranchRef(participantId, branch) {
  return `${PRESERVE_REF_PREFIX}branches/${participantId}/${branch}`;
}

/** The uncommitted-snapshot preserve ref one seat publishes to: one ref per seat, the newest
 * snapshot replacing the earlier one. */
export function preserveUncommittedRef(participantId) {
  return `${PRESERVE_REF_PREFIX}uncommitted/${participantId}`;
}

/** The environment one preserve git call runs under: the shared remote is addressed by URL or
 * path, so ambient worktree variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`) would
 * redirect the call away from the repository it names, and a prompt-hungry credential helper
 * would hang the runtime — both are kept out. */
function preserveGitEnv(indexFile = null) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = '0';
  if (indexFile !== null) env.GIT_INDEX_FILE = indexFile;
  return env;
}

/** The ONE preservation authority a runtime holds: it resolves the publish remote, keeps the
 * per-ref dedupe and retry state of this incarnation, and records every push outcome as a
 * durable row through the `record` callback the runtime binds to its store. Every method
 * answers without throwing: a push that fails is a recorded outcome, never a fault in the
 * event that carried it. The methods return the queued job's promise, so a caller that needs
 * the outcome awaits it — the runtime's event paths fire and forget. */
export class WorktreePreserver {
  /** `record(kind, payload, key)` appends one driver row; the runtime binds its store so the
   * rows land in the ONE ledger every reader already folds. A null or empty remote leaves the
   * preserver inert: a deployment that declares no shared remote preserves nothing, and a real
   * landing refuses separately (integrate_publish_undeclared). */
  constructor({ repoRoot, remote, record }) {
    this.repoRoot = typeof repoRoot === 'string' && repoRoot.length > 0 ? repoRoot : null;
    this.remote = typeof remote === 'string' && remote.length > 0 ? remote : null;
    this.record = typeof record === 'function' ? record : null;
    // This incarnation's successful pushes, per ref: the dedupe that answers a replayed event
    // and an unchanged turn boundary with no push at all. A restart drops it — the re-push it
    // allows is a re-run, which is an acceptable result of a crash.
    this.pushed = new Map();
    // The pushes of this incarnation waiting for their next event, one entry per ref: a newer
    // push to the same ref supersedes the older, and the newer tip carries the older by
    // ancestry.
    this.pending = new Map();
    // The serialization queue (#379): one preserve git call at a time, in event order.
    this.queue = Promise.resolve();
  }

  get available() {
    return this.remote !== null && this.repoRoot !== null;
  }

  /** Queue one job after everything this preserver has already started. A job that throws is
   * its own recorded outcome (the methods never throw), and a rejection never blocks the next. */
  enqueue(job) {
    const run = this.queue.then(job, job);
    this.queue = run.then(() => {}, () => {});
    // The caller's promise settles when the job settles; a job's failure is a recorded row,
    // never an unhandled rejection on the event path that fired the work.
    return run.then(() => {}, () => {});
  }
  async drain() {
    await this.queue;
  }

  /** One git call from the repository the seats' worktrees share: their commits and the
   * preserve refs all live in the one object store and ref namespace. */
  git(args, { cwd = this.repoRoot, indexFile = null } = {}) {
    return new Promise((resolve) => {
      let out = '';
      let err = '';
      let child;
      try {
        child = spawn('git', args, { cwd, env: preserveGitEnv(indexFile) });
      } catch (error) {
        resolve({ ok: false, out: '', err: '', cause: error?.message ?? 'git spawn failed' });
        return;
      }
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.on('error', (error) => {
        resolve({ ok: false, out: '', err: '', cause: error?.message ?? 'git spawn failed' });
      });
      child.on('close', (status) => {
        resolve({
          ok: status === 0, out: out.trim(), err: err.trim(),
          cause: status === 0 ? null : (err.trim().split('\n').at(-1) ?? `exit ${status}`),
        });
      });
    });
  }

  /** The branch a commit sits on, read from the one ref namespace the seat worktrees share;
   * `detached` when no branch points at it. */
  async branchOf(sha) {
    const ran = await this.git(['for-each-ref', '--format=%(refname:short)', '--sort=refname',
      '--points-at', sha, 'refs/heads']);
    return ran.ok && ran.out.length > 0 ? ran.out.split('\n')[0] : 'detached';
  }

  /** Record one outcome row. The key is the push's own identity, so a replayed event records
   * nothing twice and a retry that fails again extends nothing. */
  row(kind, payload, key) {
    if (this.record === null) return;
    try { this.record(kind, { ...payload, at: new Date().toISOString() }, key); } catch { /* the ledger's own fault is the caller's to surface */ }
  }

  /** Publish one commit to its seat-and-branch preserve ref. The producing event names the
   * seat and the commit; the branch is read from the ref namespace at push time. */
  preserveCommit(request = {}) {
    const { swarmId, participantId, workspaceId = null, sha, work = 'commit' } = request;
    if (!this.available || !GIT_SHA.test(sha ?? '')) return Promise.resolve();
    return this.enqueue(async () => {
      const ref = preserveBranchRef(participantId, await this.branchOf(sha));
      await this.pushSha({ work, swarmId, participantId, workspaceId, sha, ref });
    });
  }

  /** Push one sha to one preserve ref, with the dedupe, the retry of earlier failed pushes,
   * and the outcome rows. A commit whose paths cannot be read is recorded as failed and waits
   * for no retry: the event that carried it is already durable, and the next commit of that
   * seat carries its work by ancestry. */
  async pushSha(entry) {
    if (this.pushed.get(entry.ref) === entry.sha) return;
    await this.retryPending();
    if ((await this.commitPaths(entry.sha)) === null) {
      this.row('worktree.preserve_failed',
        { swarmId: entry.swarmId, participantId: entry.participantId, workspaceId: entry.workspaceId,
          sha: entry.sha, ref: entry.ref, remote: this.remote, work: entry.work,
          cause: 'the commit could not be read' },
        `worktree-preserve-failed:${entry.swarmId}:${entry.participantId}:${entry.sha}`);
      return;
    }
    await this.pushRef(entry);
  }

  /** The push itself, shared by the fresh pushes and the retries. */
  async pushRef(entry) {
    const ran = await this.git(['push', '--force', this.remote, `${entry.sha}:${entry.ref}`]);
    if (ran.ok) {
      this.pushed.set(entry.ref, entry.sha);
      this.pending.delete(entry.ref);
      this.row('worktree.preserve_pushed',
        { swarmId: entry.swarmId, participantId: entry.participantId, workspaceId: entry.workspaceId,
          sha: entry.sha, ref: entry.ref, remote: this.remote, work: entry.work },
        `worktree-preserve-pushed:${entry.swarmId}:${entry.participantId}:${entry.sha}`);
      return true;
    }
    this.pending.set(entry.ref, entry);
    this.row('worktree.preserve_failed',
      { swarmId: entry.swarmId, participantId: entry.participantId, workspaceId: entry.workspaceId,
        sha: entry.sha, ref: entry.ref, remote: this.remote, work: entry.work, cause: ran.cause },
      `worktree-preserve-failed:${entry.swarmId}:${entry.participantId}:${entry.sha}`);
    return false;
  }

  /** Retry every push this incarnation has pending. Called from the same events that carry
   * fresh work — a failed push rides its next commit, its next turn boundary, or any other
   * preserve push this runtime performs, and no timer runs. */
  async retryPending() {
    if (!this.available) return;
    for (const [ref, entry] of [...this.pending]) {
      if (this.pending.get(ref) !== entry) continue;
      await this.pushRef({ ...entry, ref });
    }
  }

  /** The changed paths one commit carries, or null when the commit cannot be read. */
  async commitPaths(sha) {
    const ran = await this.git(['diff-tree', '-r', '--name-only', '--root', sha]);
    return ran.ok ? ran.out.split('\n').filter((line) => line.length > 0) : null;
  }

  /** Snapshot one seat's uncommitted changes without touching its worktree: a tree is written
   * from a private index over the checkout, committed against the checkout's HEAD, and pushed
   * to the seat's uncommitted ref, which the next snapshot replaces. A clean checkout, a
   * checkout with no commits, or a state this incarnation already published records nothing
   * and pushes nothing — absence is the honest outcome, never a repeated row. After a restart
   * the first boundary of an unchanged dirty state publishes it again: a re-push is a re-run,
   * an acceptable result of a crash. */
  preserveUncommitted(request = {}) {
    const { swarmId, participantId, workspaceId = null, worktree } = request;
    if (!this.available || typeof worktree !== 'string' || worktree.length === 0) return Promise.resolve();
    return this.enqueue(() => this._preserveUncommittedNow({ swarmId, participantId, workspaceId, worktree }));
  }

  async _preserveUncommittedNow({ swarmId, participantId, workspaceId = null, worktree }) {
    const ref = preserveUncommittedRef(participantId);
    const head = await this.git(['rev-parse', 'HEAD'], { cwd: worktree });
    if (!head.ok || !GIT_SHA.test(head.out)) return; // no commits: nothing to parent the snapshot against
    const headTree = await this.git(['rev-parse', 'HEAD^{tree}'], { cwd: worktree });
    const index = mkdtempSync(join(tmpdir(), 'baton-preserve-'));
    try {
      const indexFile = join(index, 'index');
      const read = await this.git(['read-tree', 'HEAD'], { cwd: worktree, indexFile });
      const add = read.ok ? await this.git(['add', '--all'], { cwd: worktree, indexFile }) : { ok: false };
      // Issue #254 (the operator ruling on the debris the 2026-09-26 branches carried): the
      // repository's ignore rules decide what an untracked path may carry into a snapshot. The
      // checkout's own .gitignore can be stale — the node_modules symlink rode exactly that gap —
      // so the staged additions are judged against the deployment repository's OWN ignore rules
      // (evaluated at the repo root), and every match leaves the private index before the tree is
      // written. The dropped paths are named on the snapshot commit, never a silent filter.
      const debris = [];
      if (add.ok) {
        const added = await this.git(['diff', '--cached', '--name-only', '--diff-filter=A'], { cwd: worktree, indexFile });
        for (const path of added.ok ? added.out.split('\n').filter((line) => line.length > 0) : []) {
          if (!(await this.git(['check-ignore', '-q', '--no-index', '--', path])).ok) continue;
          const removed = await this.git(['rm', '--cached', '--quiet', '--', path], { cwd: worktree, indexFile });
          if (removed.ok) debris.push(path);
        }
      }
      const wrote = add.ok ? await this.git(['write-tree'], { cwd: worktree, indexFile }) : { ok: false };
      if (!wrote.ok || !GIT_SHA.test(wrote.out)) return;
      const tree = wrote.out;
      if (headTree.ok && headTree.out === tree) return; // clean checkout: nothing uncommitted
      const debrisNote = debris.length === 0 ? ''
        : `; ignored additions dropped: ${debris.slice(0, 16).join(', ')}${debris.length > 16 ? `, and ${debris.length - 16} more` : ''}`;
      const pushedSha = this.pushed.get(ref) ?? null;
      if (pushedSha !== null) {
        const deref = await this.git(['rev-parse', `${pushedSha}^{tree}`]);
        if (deref.ok && deref.out === tree) return; // this exact state is already the ref's tip
      }
      const message = `preserve: uncommitted state of ${participantId} (private-index snapshot, worktree untouched)${debrisNote}`;
      const commit = await this.git(['commit-tree', tree, '-p', head.out, '-m', message], { cwd: worktree });
      if (!commit.ok || !GIT_SHA.test(commit.out)) return;
      await this.pushRef({ work: 'uncommitted', swarmId, participantId, workspaceId, sha: commit.out, ref });
    } finally {
      rmSync(index, { recursive: true, force: true });
    }
  }
}
