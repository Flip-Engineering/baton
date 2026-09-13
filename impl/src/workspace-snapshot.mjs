// workspace-snapshot.mjs — bounded live-workspace snapshot primitive.
//
// Root's contribution capture (worktree.mjs captureCommit) requires a paused turn:
// it runs `git add -A` against the REAL index and commits on the branch, so it is
// only safe once a worker is no longer running. A native implementer cannot use it
// mid-turn (the turn cannot end until the tool returns). This module snapshots the
// visible work of an ACTIVE workspace into an immutable commit instead:
//
//   - all index work happens in an isolated temporary GIT_INDEX_FILE created OUTSIDE
//     the worktree (os.tmpdir()); the real index bytes are never written;
//   - the snapshot commit is built with write-tree/commit-tree and touches no ref:
//     HEAD, branch refs, and worktree files are unchanged by construction;
//   - the parent of the snapshot commit names the actual HEAD observed before capture;
//   - custody is the CALLER's job: validate resource ownership before and after and
//     pin the returned sha via the existing retainCheckpoint. This primitive never
//     invents custody and never updates refs itself.
//
// A live snapshot records visible FILE VERSIONS (staged, unstaged, untracked —
// whatever the worktree shows, with staged-then-re-modified files recorded at their
// visible on-disk version). It is not a claim of an atomic transaction across
// concurrent editors; the root serializes capture requests for the same physical
// checkout. This module itself takes no locks that could block ordinary agent work
// (`--no-optional-locks` on every invocation; the only lock ever taken is on the
// temporary index, which nobody else uses).
//
// The temporary index is seeded by COPYING the real index rather than by
// `read-tree <baseSha>` so that index metadata survives verbatim: skip-worktree
// entries (sparse checkouts) keep absent files from becoming deletions. Clear
// assume-unchanged only in the temporary index so visible edits are still captured.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve as pathResolve } from 'node:path';

export class WorkspaceSnapshotError extends Error {
  constructor(message, code, cause) {
    super(message); this.name = 'WorkspaceSnapshotError'; this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

const GIT_AUTHOR = 'baton-live-snapshot';
const GIT_EMAIL = 'baton-live-snapshot@localhost';

function gitEnv(gitIndexFile) {
  // Strip every inherited GIT_* variable (they could redirect GIT_DIR/GIT_WORK_TREE/
  // GIT_INDEX_FILE at the capture), then pin exactly what this module needs.
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...(gitIndexFile ? { GIT_INDEX_FILE: gitIndexFile } : {}),
  };
}

function git(args, cwd, gitIndexFile, input) {
  const output = execFileSync('git', ['--no-optional-locks', ...args], {
    cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: gitEnv(gitIndexFile), input,
  });
  return args.includes('-z') ? output : output.trim();
}

/** A path is safe to exclude only if it names something strictly inside the worktree. */
function validateExcludedPaths(excludedPaths) {
  if (!Array.isArray(excludedPaths)) {
    throw new TypeError('excludedPaths must be an array of relative paths');
  }
  const seen = new Set();
  for (const raw of excludedPaths) {
    if (typeof raw !== 'string' || raw.length === 0 || raw.includes('\0')) {
      throw new WorkspaceSnapshotError(`unsafe excluded path: ${JSON.stringify(raw ?? null)}`, 'workspace_snapshot_invalid_exclusion');
    }
    if (isAbsolute(raw)) {
      throw new WorkspaceSnapshotError(`unsafe excluded path (absolute): ${raw}`, 'workspace_snapshot_invalid_exclusion');
    }
    const segments = raw.split('/');
    if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new WorkspaceSnapshotError(`unsafe excluded path (escapes the worktree): ${raw}`, 'workspace_snapshot_invalid_exclusion');
    }
    if (segments.some((segment) => segment.toLowerCase() === '.git')) {
      throw new WorkspaceSnapshotError(`unsafe excluded path (git metadata): ${raw}`, 'workspace_snapshot_invalid_exclusion');
    }
    seen.add(raw);
  }
  return [...seen].sort();
}

/**
 * Snapshot the visible work of an active worktree into an immutable commit.
 *
 * @param {{worktree: string, baseSha: string, excludedPaths?: string[]}} args
 * @returns {Promise<{sha: string, baseSha: string, changedPaths: string[], snapshotted: true}>}
 *   changedPaths is the exact path set of the immutable snapshot tree versus baseSha
 *   (NOT the live tree, which may keep moving after capture).
 */
export async function snapshotWorkspace({ worktree, baseSha, excludedPaths = [] }) {
  // ---- shape validation (pure, before anything touches git) ----
  if (typeof worktree !== 'string' || worktree.length === 0 || worktree.includes('\0')) {
    throw new TypeError('worktree must be a non-empty path string');
  }
  if (typeof baseSha !== 'string' || baseSha.length === 0 || baseSha.includes('\0')) {
    throw new TypeError('baseSha must be a non-empty string');
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(baseSha)) {
    throw new WorkspaceSnapshotError('baseSha must identify a full commit SHA', 'workspace_snapshot_invalid_base');
  }
  const excluded = validateExcludedPaths(excludedPaths);

  // ---- worktree validation (read-only) ----
  let stat;
  try { stat = lstatSync(worktree); } catch (error) {
    throw new WorkspaceSnapshotError(`worktree path does not exist: ${worktree}`, 'workspace_snapshot_invalid_worktree', error);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new WorkspaceSnapshotError(`worktree path is not a real directory: ${worktree}`, 'workspace_snapshot_invalid_worktree');
  }
  // The path must BE the root of a git worktree — not merely inside one. A scratch
  // directory nested in some outer repository would otherwise resolve to that outer
  // repo and silently snapshot the wrong tree.
  let toplevel = '';
  try { toplevel = git(['rev-parse', '--show-toplevel'], worktree); } catch { /* not a work tree */ }
  if (!toplevel || realpathSync(toplevel) !== realpathSync(worktree)) {
    throw new WorkspaceSnapshotError(`path is not the root of a git worktree: ${worktree}`, 'workspace_snapshot_invalid_worktree');
  }

  // ---- base and HEAD validation (read-only) ----
  let resolvedBase = '';
  try { resolvedBase = git(['rev-parse', '--verify', '--quiet', `${baseSha}^{commit}`], worktree); } catch { /* invalid base */ }
  if (!resolvedBase) throw new WorkspaceSnapshotError(`baseSha is not a resolvable commit: ${baseSha}`, 'workspace_snapshot_invalid_base');

  let headSha = '';
  try { headSha = git(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], worktree); } catch { /* unborn HEAD */ }
  if (!headSha) {
    throw new WorkspaceSnapshotError('HEAD is unborn; a live snapshot must name the observed HEAD as parent', 'workspace_snapshot_invalid_head');
  }

  // ---- exclusion authority (read-only, still before any mutation) ----
  // A snapshot cannot "exclude" a path that is already tracked: dropping it would
  // fabricate a deletion; keeping it would betray the exclusion. Refuse and let the
  // caller resolve the force-tracked projection instead.
  if (excluded.length > 0) {
    const raw = git(['ls-files', '-z', '--', ...excluded.map((path) => `:(literal)${path}`)], worktree);
    const tracked = raw.split('\0').filter(Boolean);
    if (tracked.length > 0) {
      throw new WorkspaceSnapshotError(
        `excluded paths are force-tracked in the index and cannot be excluded: ${tracked.join(', ')}`,
        'workspace_snapshot_projection_tracked',
      );
    }
  }

  // ---- isolated temporary index, outside the worktree ----
  let tempRoot = null;
  try {
    tempRoot = mkdtempSync(join(tmpdir(), 'baton-live-snapshot-'));
    const tempIndex = join(tempRoot, 'index');
    const realIndexRaw = git(['rev-parse', '--git-path', 'index'], worktree);
    const realIndex = isAbsolute(realIndexRaw) ? realIndexRaw : pathResolve(worktree, realIndexRaw);
    if (existsSync(realIndex) && lstatSync(realIndex).isFile()) copyFileSync(realIndex, tempIndex);
    else throw new WorkspaceSnapshotError('Workspace index is unavailable', 'workspace_snapshot_index_unavailable');

    const assumed = git(['ls-files', '-v', '-z'], worktree, tempIndex).split('\0')
      .filter((row) => /^[a-z] /u.test(row)).map((row) => row.slice(2));
    if (assumed.length) git(['update-index', '--no-assume-unchanged', '-z', '--stdin'],
      worktree, tempIndex, `${assumed.join('\0')}\0`);

    // Literal pathspec exclusions cannot reinterpret a dependency name as an ignore glob.
    // Keep the repository's existing ignore configuration, including info/exclude.
    git(['-c', 'core.fsmonitor=false', 'add', '-A', '--', '.',
      ...excluded.map((path) => `:(exclude,literal)${path}`)], worktree, tempIndex);

    const treeSha = git(['write-tree'], worktree, tempIndex);
    const message = `baton live snapshot\n\nBaton-Base: ${resolvedBase}\nBaton-Head: ${headSha}\nBaton-Excluded: ${excluded.length}\n`;
    const sha = git([
      '-c', `user.name=${GIT_AUTHOR}`, '-c', `user.email=${GIT_EMAIL}`,
      'commit-tree', treeSha, '-p', headSha, '-m', message,
    ], worktree);

    // changedPaths comes from the immutable snapshot tree vs base — not from the
    // live worktree, which concurrent editors may already have moved again.
    const raw = git(['diff-tree', '-r', '--name-only', '-z', '--no-commit-id', resolvedBase, treeSha], worktree);
    const changedPaths = [...new Set(raw.split('\0').filter(Boolean))].sort();
    return Object.freeze({ sha, baseSha: resolvedBase, changedPaths, snapshotted: true });
  } catch (error) {
    if (error instanceof WorkspaceSnapshotError) throw error;
    throw new WorkspaceSnapshotError(`workspace snapshot failed: ${error?.message ?? error}`, 'workspace_snapshot_failed', error);
  } finally {
    // Every exit path cleans the temporary index and excludes file.
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  }
}
