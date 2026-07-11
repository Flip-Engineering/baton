// worktree.mjs — git-worktree lifecycle mechanics. Everything shells out to a real
// `git` binary against a real repo — no git library, no mocking of git itself.
//
// D7 (spec/RECONCILIATION.md, authoritative) pins the coordinator's ONE dependency
// interface as exactly this module's exports: pinBaseSha, createFromBase, captureCommit,
// freshVerifySandbox, changedLines, reap, reconcile, listWorktrees (+ markStopped, which
// remains a real export per IMPLEMENTATION.md §3 W5 even though D7's literal list omits it).
//
// Everything this module creates lives under <repoRoot>/.baton/ — `.baton/wt/<taskId>`
// for a worker's own worktree, `.baton/verify/<label>-<suffix>` for a throwaway sandbox.
// The two directories are structurally namespaced apart (W1).

import { execFileSync } from 'node:child_process';
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, realpathSync,
} from 'node:fs';
import {
  join, dirname, resolve as pathResolve, relative as pathRelative,
} from 'node:path';
import { randomBytes } from 'node:crypto';

// ---------------------------------------------------------------------------
// Errors (W7 — typed, never a bare Error wrapping raw stderr)
// ---------------------------------------------------------------------------

export class DirtyRepoError extends Error {
  constructor(message) { super(message); this.name = 'DirtyRepoError'; }
}
export class BranchAlreadyCheckedOutError extends Error {
  constructor(message) { super(message); this.name = 'BranchAlreadyCheckedOutError'; }
}
export class WorktreeAlreadyExistsError extends Error {
  constructor(message) { super(message); this.name = 'WorktreeAlreadyExistsError'; }
}
export class UnknownWorktreeError extends Error {
  constructor(message) { super(message); this.name = 'UnknownWorktreeError'; }
}
export class InvalidShaError extends Error {
  constructor(message) { super(message); this.name = 'InvalidShaError'; }
}
export class WorktreeLockedError extends Error {
  constructor(message) { super(message); this.name = 'WorktreeLockedError'; }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8' }).trim();
}

function isClean(dir) {
  return sh('git', ['status', '--porcelain'], dir) === '';
}

function wtDirFor(repoRoot, taskId) {
  return join(repoRoot, '.baton', 'wt', taskId);
}

function metaPathFor(repoRoot, taskId) {
  return join(repoRoot, '.baton', 'wt', `${taskId}.meta.json`);
}

function readMeta(repoRoot, taskId) {
  const f = metaPathFor(repoRoot, taskId);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function writeMeta(repoRoot, taskId, meta) {
  const f = metaPathFor(repoRoot, taskId);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(meta, null, 2));
}

function logEvent(opts, worker, kind, payload) {
  if (!opts?.log) return;
  opts.log.append({ worker, harness: 'n/a', turnEpoch: 0, kind, actor: 'orchestrator', payload });
}

// ---------------------------------------------------------------------------
// ensureBatonExcluded
// ---------------------------------------------------------------------------

/** Idempotently ensures '.baton/' is present in <repoRoot>/.git/info/exclude, preserving any
 * existing content. Additive export per RECONCILIATION.md D7's addendum (C6). */
export function ensureBatonExcluded(repoRoot) {
  const excludePath = join(repoRoot, '.git', 'info', 'exclude');
  let existing = '';
  if (existsSync(excludePath)) existing = readFileSync(excludePath, 'utf8');
  const lines = existing.split('\n');
  if (lines.some((l) => l.trim() === '.baton/')) return; // already present — no-op
  const withNewline = existing.length > 0 && !existing.endsWith('\n') ? existing + '\n' : existing;
  mkdirSync(dirname(excludePath), { recursive: true });
  writeFileSync(excludePath, `${withNewline}.baton/\n`, 'utf8');
}

// ---------------------------------------------------------------------------
// pinBaseSha
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {{autoStash?: boolean, targetRef?: string}} [opts]
 * @returns {Promise<{sha:string, stashed:boolean, stashRef?:string}>}
 * @throws {DirtyRepoError}
 */
export async function pinBaseSha(repoRoot, opts = {}) {
  ensureBatonExcluded(repoRoot);
  const targetRef = opts.targetRef ?? 'HEAD';
  const dirty = !isClean(repoRoot);
  if (dirty) {
    if (!opts.autoStash) {
      throw new DirtyRepoError(`pinBaseSha: repo at ${repoRoot} is dirty (pass {autoStash:true} to auto-stash)`);
    }
    sh('git', ['stash', 'push', '-u', '-m', 'baton-pinBaseSha-autostash'], repoRoot);
    const sha = sh('git', ['rev-parse', targetRef], repoRoot);
    return { sha, stashed: true, stashRef: 'stash@{0}' };
  }
  const sha = sh('git', ['rev-parse', targetRef], repoRoot);
  return { sha, stashed: false };
}

// ---------------------------------------------------------------------------
// createFromBase
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {string} taskId
 * @param {string} baseSha
 * @param {{log?: object}} [opts]
 * @returns {Promise<{taskId:string, dir:string, branch:string, baseSha:string, createdAt:string}>}
 */
export async function createFromBase(repoRoot, taskId, baseSha, opts = {}) {
  const dir = wtDirFor(repoRoot, taskId);
  if (existsSync(dir)) {
    throw new WorktreeAlreadyExistsError(`createFromBase: ${dir} already exists`);
  }
  const branch = `baton/${taskId}`;
  mkdirSync(join(repoRoot, '.baton', 'wt'), { recursive: true });
  try {
    sh('git', ['worktree', 'add', '-b', branch, dir, baseSha], repoRoot);
  } catch (err) {
    const msg = String(err.stderr || err.message || err);
    if (/already (used by worktree|checked out|exists)/i.test(msg)) {
      throw new BranchAlreadyCheckedOutError(`createFromBase: branch "${branch}" is already checked out elsewhere: ${msg}`);
    }
    throw err;
  }
  const createdAt = new Date().toISOString();
  writeMeta(repoRoot, taskId, { taskId, branch, baseSha, createdAt, stoppedAt: null });
  logEvent(opts, taskId, 'worktree.created', { dir, branch, baseSha });
  return { taskId, dir, branch, baseSha, createdAt };
}

// ---------------------------------------------------------------------------
// captureCommit
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {string} taskId
 * @param {{vendor?: string, model?: string, log?: object}} [opts]
 * @returns {Promise<{sha:string, snapshotted:boolean}>}
 */
export async function captureCommit(repoRoot, taskId, opts = {}) {
  const dir = wtDirFor(repoRoot, taskId);
  if (!existsSync(dir)) {
    throw new UnknownWorktreeError(`captureCommit: no worktree for taskId "${taskId}"`);
  }
  let snapshotted = false;
  if (!isClean(dir)) {
    sh('git', ['add', '-A'], dir);
    const vendor = opts.vendor;
    const authorName = vendor ? `baton-worker-${vendor}` : 'baton-snapshot';
    const authorEmail = `${authorName}@localhost`;
    const trailerLines = [`Baton-Task: ${taskId}`];
    if (vendor) trailerLines.push(`Baton-Vendor: ${vendor}`);
    if (opts.model) trailerLines.push(`Baton-Model: ${opts.model}`);
    const message = `baton snapshot: ${taskId}\n\n${trailerLines.join('\n')}\n`;
    sh('git', ['commit', '-q', '-m', message, `--author=${authorName} <${authorEmail}>`], dir);
    snapshotted = true;
  }
  const sha = sh('git', ['rev-parse', 'HEAD'], dir);
  logEvent(opts, taskId, 'worktree.captured', { sha, snapshotted });
  return { sha, snapshotted };
}

// ---------------------------------------------------------------------------
// freshVerifySandbox
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {string} label
 * @param {string} sha
 * @param {{log?: object}} [opts]
 * @returns {Promise<{dir:string, sha:string, cleanup:() => Promise<void>}>}
 * @throws {InvalidShaError}
 */
export async function freshVerifySandbox(repoRoot, label, sha, opts = {}) {
  let fullSha;
  try {
    fullSha = sh('git', ['rev-parse', '--verify', `${sha}^{commit}`], repoRoot);
  } catch {
    throw new InvalidShaError(`freshVerifySandbox: "${sha}" does not resolve to a commit in ${repoRoot}`);
  }
  const verifyRoot = join(repoRoot, '.baton', 'verify');
  mkdirSync(verifyRoot, { recursive: true });
  const suffix = randomBytes(4).toString('hex');
  const dir = join(verifyRoot, `${label}-${suffix}`);
  sh('git', ['worktree', 'add', '--detach', dir, fullSha], repoRoot);

  const cleanup = async () => {
    if (!existsSync(dir)) return;
    try {
      sh('git', ['worktree', 'remove', '--force', dir], repoRoot);
    } catch {
      rmSync(dir, { recursive: true, force: true });
    }
    try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* best-effort */ }
  };

  logEvent(opts, 'worktree', 'worktree.verify_sandbox_created', { dir, sha: fullSha, label });
  return { dir, sha: fullSha, cleanup };
}

// ---------------------------------------------------------------------------
// markStopped
// ---------------------------------------------------------------------------

/** @param {string} repoRoot @param {string} taskId @returns {Promise<void>} */
export async function markStopped(repoRoot, taskId) {
  const meta = readMeta(repoRoot, taskId) ?? { taskId, stoppedAt: null };
  meta.stoppedAt = new Date().toISOString();
  writeMeta(repoRoot, taskId, meta);
}

// ---------------------------------------------------------------------------
// reap
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {string} taskId
 * @param {{force?: boolean, deleteBranch?: boolean, log?: object}} [opts]
 * @returns {Promise<void>}
 * @throws {WorktreeLockedError}
 */
export async function reap(repoRoot, taskId, opts = {}) {
  const dir = wtDirFor(repoRoot, taskId);
  const metaFile = metaPathFor(repoRoot, taskId);
  if (!existsSync(dir)) {
    if (existsSync(metaFile)) rmSync(metaFile, { force: true });
    return; // idempotent no-op
  }
  const meta = readMeta(repoRoot, taskId);
  const stopped = !!meta?.stoppedAt;
  if (!stopped && !opts.force) {
    throw new WorktreeLockedError(`reap: worktree "${taskId}" was never markStopped (pass {force:true} to override)`);
  }
  try {
    sh('git', ['worktree', 'remove', '--force', dir], repoRoot);
  } catch {
    rmSync(dir, { recursive: true, force: true });
    try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* best-effort */ }
  }
  if (opts.deleteBranch) {
    try { sh('git', ['branch', '-D', `baton/${taskId}`], repoRoot); } catch { /* best-effort */ }
  }
  if (existsSync(metaFile)) rmSync(metaFile, { force: true });
  logEvent(opts, taskId, 'worktree.reaped', { dir });
}

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {string[]} expectedActiveTaskIds
 * @param {{log?: object}} [opts]
 * @returns {Promise<{prunedAdminEntries:string[], removedZombieDirs:string[], errors:string[]}>}
 */
export async function reconcile(repoRoot, expectedActiveTaskIds = [], opts = {}) {
  const report = { prunedAdminEntries: [], removedZombieDirs: [], errors: [] };
  try {
    sh('git', ['worktree', 'prune'], repoRoot);
  } catch (err) {
    report.errors.push(`prune: ${err.message || err}`);
  }

  const expected = new Set(expectedActiveTaskIds);

  const wtRoot = join(repoRoot, '.baton', 'wt');
  if (existsSync(wtRoot)) {
    for (const entry of readdirSync(wtRoot)) {
      if (entry.endsWith('.meta.json')) continue;
      const fullDir = join(wtRoot, entry);
      let isDir = false;
      try { isDir = statSync(fullDir).isDirectory(); } catch { continue; }
      if (!isDir) continue;
      if (expected.has(entry)) continue;
      try {
        try {
          sh('git', ['worktree', 'remove', '--force', fullDir], repoRoot);
        } catch {
          rmSync(fullDir, { recursive: true, force: true });
        }
        const metaFile = metaPathFor(repoRoot, entry);
        if (existsSync(metaFile)) rmSync(metaFile, { force: true });
        report.removedZombieDirs.push(fullDir);
        logEvent(opts, entry, 'worktree.reconciled', { dir: fullDir });
      } catch (err) {
        report.errors.push(`${entry}: ${err.message || err}`);
      }
    }
  }

  // Note: `.baton/verify/*` sandboxes are intentionally NOT swept here. They are always
  // created and reaped synchronously by their own caller (referee/coordinator via
  // `sandbox.cleanup()`) within the same operation, so they never need boot-time zombie
  // detection, and sweeping them here would misattribute reconcile events away from the
  // taskId-scoped `worker` field callers rely on (red workers-trust#9).
  try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* best-effort */ }
  return report;
}

// ---------------------------------------------------------------------------
// changedLines
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {string} fromSha
 * @param {string} toSha
 * @returns {Promise<Record<string, number[]>>}
 */
export async function changedLines(repoRoot, fromSha, toSha) {
  const diff = execFileSync(
    'git',
    ['diff', '--unified=0', '--no-color', fromSha, toSha],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const result = {};
  let currentFile = null;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).trim();
      currentFile = p === '/dev/null' ? null : p.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (m && currentFile) {
        const startLine = parseInt(m[1], 10);
        const count = m[2] !== undefined ? parseInt(m[2], 10) : 1;
        if (count > 0) {
          const arr = result[currentFile] ?? (result[currentFile] = []);
          for (let ln = startLine; ln < startLine + count; ln += 1) arr.push(ln);
        }
      }
    }
  }
  for (const k of Object.keys(result)) result[k].sort((a, b) => a - b);
  return result;
}

// ---------------------------------------------------------------------------
// listWorktrees
// ---------------------------------------------------------------------------

/** @param {string} repoRoot @returns {Promise<Array<{dir:string, sha:string|null, branch:string|null, detached:boolean}>>} */
export async function listWorktrees(repoRoot) {
  const out = sh('git', ['worktree', 'list', '--porcelain'], repoRoot);
  const entries = [];
  let current = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) entries.push(current);
      current = { dir: line.slice('worktree '.length).trim(), sha: null, branch: null, detached: false };
    } else if (line.startsWith('HEAD ')) {
      if (current) current.sha = line.slice('HEAD '.length).trim();
    } else if (line.startsWith('branch ')) {
      if (current) current.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      if (current) current.detached = true;
    }
  }
  if (current) entries.push(current);

  let repoRootReal;
  try { repoRootReal = realpathSync(repoRoot); } catch { repoRootReal = pathResolve(repoRoot); }

  // git reports worktree paths fully realpath-resolved (e.g. macOS /var -> /private/var),
  // which can diverge from the (possibly symlinked) `repoRoot` string callers constructed
  // their own dir/sandbox paths from (createFromBase/freshVerifySandbox both `join(repoRoot, ...)`
  // verbatim). Re-anchor each reported dir onto the caller's own `repoRoot` prefix so the
  // returned `dir` strings are directly comparable to those earlier return values.
  const result = [];
  for (const e of entries) {
    let entryReal;
    try { entryReal = realpathSync(e.dir); } catch { entryReal = pathResolve(e.dir); }
    if (entryReal === repoRootReal) continue; // exclude the main worktree (repoRoot itself)
    const rel = pathRelative(repoRootReal, entryReal);
    const normalizedDir = rel.startsWith('..') ? e.dir : join(repoRoot, rel);
    result.push({ ...e, dir: normalizedDir });
  }
  return result;
}
