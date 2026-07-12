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
  cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, lstatSync, realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename, join, dirname, isAbsolute, sep, resolve as pathResolve, relative as pathRelative,
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
export class StructuredMergeError extends Error {
  constructor(message, code = 'structured_merge_failed') { super(message); this.name = 'StructuredMergeError'; this.code = code; }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', ...(cmd === 'git' ? { env: localGitEnv() } : {}) }).trim();
}

function localGitEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
}

function gitFile(args, cwd, opts = {}, extraEnv = {}) {
  return execFileSync('git', args, { ...opts, cwd, env: localGitEnv(extraEnv) });
}

function isClean(dir) {
  return sh('git', ['status', '--porcelain'], dir) === '';
}

function mergeError(message, code, cause) {
  return Object.assign(new StructuredMergeError(message, code), cause ? { cause } : {});
}

function postEffectMergeError(message, cause) {
  return Object.assign(mergeError(message, 'structured_post_effect_inconsistent', cause), { postEffect: true });
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

function dependencySources(repoRoot, dependencyDirs = []) {
  const realRepo = realpathSync(repoRoot);
  return dependencyDirs.map((rel) => {
    if (typeof rel !== 'string' || rel.length === 0 || isAbsolute(rel)) throw new TypeError('dependency directory must be relative');
    const source = pathResolve(realRepo, rel); const within = pathRelative(realRepo, source);
    if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new TypeError('dependency directory escapes repository');
    if (!existsSync(source)) throw new TypeError('dependency directory does not exist');
    const realSource = realpathSync(source); const realWithin = pathRelative(realRepo, realSource);
    if (realWithin === '..' || realWithin.startsWith(`..${sep}`) || isAbsolute(realWithin) || !lstatSync(realSource).isDirectory()) throw new TypeError('dependency directory is not confined');
    return { rel, realSource };
  });
}

function materializeDependencies(dir, sources) {
  const copied = [];
  for (const { rel, realSource } of sources) {
    const target = pathResolve(dir, rel); mkdirSync(dirname(target), { recursive: true });
    cpSync(realSource, target, { recursive: true, dereference: true, force: false, errorOnExist: true });
    copied.push(rel);
  }
  return copied;
}

function sparseProjection(paths = []) {
  if (!Array.isArray(paths)) throw new TypeError('sparse verification paths must be an array');
  return paths.map((path) => {
    if (typeof path !== 'string' || path.length === 0 || isAbsolute(path) || !/^[A-Za-z0-9._/-]+$/.test(path)) throw new TypeError('sparse verification path must be a safe relative literal');
    const parts = path.split('/'); if (parts.some((part) => part === '' || part === '.' || part === '..')) throw new TypeError('sparse verification path escapes repository');
    return path;
  });
}

// ---------------------------------------------------------------------------
// ensureBatonExcluded
// ---------------------------------------------------------------------------

/** Idempotently ensures '.baton/' is present in Git's info/exclude for repoRoot, preserving
 * existing content. Ask Git for the path because `.git` is a file in linked worktrees.
 * Additive export per RECONCILIATION.md D7's addendum (C6). */
export function ensureBatonExcluded(repoRoot) {
  const rawExcludePath = sh('git', ['rev-parse', '--git-path', 'info/exclude'], repoRoot);
  const excludePath = isAbsolute(rawExcludePath) ? rawExcludePath : pathResolve(repoRoot, rawExcludePath);
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
 * @param {{log?: object, dependencyDirs?: string[]}} [opts]
 * @returns {Promise<{taskId:string, dir:string, branch:string, baseSha:string, createdAt:string,copiedDependencies:string[]}>}
 */
export async function createFromBase(repoRoot, taskId, baseSha, opts = {}) {
  const dir = wtDirFor(repoRoot, taskId);
  if (existsSync(dir)) {
    throw new WorktreeAlreadyExistsError(`createFromBase: ${dir} already exists`);
  }
  const sources = dependencySources(repoRoot, opts.dependencyDirs ?? []);
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
  let copiedDependencies;
  try {
    copiedDependencies = materializeDependencies(dir, sources);
  } catch (err) {
    try { sh('git', ['worktree', 'remove', '--force', dir], repoRoot); }
    catch { rmSync(dir, { recursive: true, force: true }); }
    try { sh('git', ['branch', '-D', branch], repoRoot); } catch { /* best-effort */ }
    try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* best-effort */ }
    throw err;
  }
  const createdAt = new Date().toISOString();
  writeMeta(repoRoot, taskId, { taskId, branch, baseSha, createdAt, stoppedAt: null });
  logEvent(opts, taskId, 'worktree.created', { dir, branch, baseSha, copiedDependencies });
  return { taskId, dir, branch, baseSha, createdAt, copiedDependencies };
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
    if (opts.effort) trailerLines.push(`Baton-Effort: ${opts.effort}`);
    const message = `baton snapshot: ${taskId}\n\n${trailerLines.join('\n')}\n`;
    sh('git', ['commit', '-q', '-m', message, `--author=${authorName} <${authorEmail}>`], dir);
    snapshotted = true;
  }
  const sha = sh('git', ['rev-parse', 'HEAD'], dir);
  logEvent(opts, taskId, 'worktree.captured', { sha, snapshotted });
  return { sha, snapshotted };
}

// ---------------------------------------------------------------------------
// Structured integration staging (Phase 26 SM1-SM9)
// ---------------------------------------------------------------------------

const CONFLICT_MARKER = /(?:<{7,}|\|{7,}|={7,}|>{7,})/;

function integrationRoot(repoRoot) { return join(repoRoot, '.baton', 'integrate'); }

export async function removeStructuredIntegration(repoRoot, stage) {
  const dir = typeof stage === 'string' ? stage : stage?.stagePath;
  if (typeof dir === 'string' && dir.length > 0) {
    try { sh('git', ['worktree', 'remove', '--force', dir], repoRoot); } catch { rmSync(dir, { recursive: true, force: true }); }
  }
  try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* best effort */ }
  const root = integrationRoot(repoRoot);
  try { if (existsSync(root) && readdirSync(root).length === 0) rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

export async function stageStructuredIntegration(repoRoot, taskId, resultSha, opts = {}) {
  ensureBatonExcluded(repoRoot);
  if (!isClean(repoRoot)) throw mergeError('structured integration requires a clean main checkout', 'structured_main_dirty');
  let rightSha;
  try { rightSha = sh('git', ['rev-parse', '--verify', `${resultSha}^{commit}`], repoRoot); }
  catch (error) { throw mergeError('structured integration result is not a commit', 'structured_invalid_result', error); }
  const beforeSha = sh('git', ['rev-parse', 'HEAD'], repoRoot);
  try { sh('git', ['merge-base', '--is-ancestor', rightSha, beforeSha], repoRoot); throw mergeError('structured integration result is already contained by main', 'structured_already_integrated'); }
  catch (error) { if (error?.code === 'structured_already_integrated') throw error; }
  const mergeBaseSha = sh('git', ['merge-base', beforeSha, rightSha], repoRoot);
  const root = integrationRoot(repoRoot); mkdirSync(root, { recursive: true });
  const stagePath = join(root, `${taskId}-${randomBytes(4).toString('hex')}`);
  try { sh('git', ['worktree', 'add', '--detach', stagePath, beforeSha], repoRoot); }
  catch (error) { throw mergeError('structured integration stage could not be created', 'structured_stage_failed', error); }
  const classes = []; const resolutions = [];
  try {
    let mergeClean = true;
    try { gitFile(['-c', 'core.hooksPath=/dev/null', '-c', 'merge.conflictStyle=diff3', 'merge', '--no-verify', '--no-commit', '--no-ff', rightSha], stagePath, { encoding: 'utf8', stdio: 'pipe' }); }
    catch { mergeClean = false; }
    const unmergedRaw = gitFile(['diff', '--name-only', '--diff-filter=U', '-z'], stagePath, { encoding: 'utf8' });
    const conflictedPaths = unmergedRaw.split('\0').filter(Boolean);
    if (mergeClean) classes.push({ path: null, class: 'clean_textual' });
    else {
      if (conflictedPaths.length === 0) throw mergeError('Git merge failed without resolvable text conflicts', 'structured_merge_failed');
      if (!opts.resolver || typeof opts.resolver.resolve !== 'function') throw mergeError('structured merge resolver is unavailable', 'structured_tool_unavailable');
      if (!Number.isSafeInteger(opts.resolver.maxFileBytes) || opts.resolver.maxFileBytes <= 0) throw mergeError('structured resolver lacks a deployment-derived file ceiling', 'structured_policy_invalid');
      const realStagePath = realpathSync(stagePath);
      for (const relativePath of conflictedPaths) {
        const absolutePath = pathResolve(stagePath, relativePath); const within = pathRelative(stagePath, absolutePath);
        if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within) || !existsSync(absolutePath) || !lstatSync(absolutePath).isFile()) throw mergeError(`unsupported structured conflict path: ${relativePath}`, 'structured_unsupported_path');
        const realConflictPath = realpathSync(absolutePath); const realWithin = pathRelative(realStagePath, realConflictPath);
        if (realWithin === '..' || realWithin.startsWith(`..${sep}`) || isAbsolute(realWithin)) throw mergeError(`structured conflict escapes stage: ${relativePath}`, 'structured_unsupported_path');
        const conflict = readFileSync(absolutePath); if (conflict.includes(0)) throw mergeError(`structured conflict is binary: ${relativePath}`, 'structured_binary_conflict');
        if (conflict.byteLength > opts.resolver.maxFileBytes) throw mergeError(`structured conflict exceeds file budget: ${relativePath}`, 'structured_file_too_large');
        const isolatedRoot = realpathSync(mkdtempSync(join(tmpdir(), 'baton-structured-conflict-'))); const isolatedName = basename(relativePath); const isolatedPath = join(isolatedRoot, isolatedName);
        let resolution; let merged;
        try {
          writeFileSync(isolatedPath, conflict, { mode: 0o600 });
          resolution = await opts.resolver.resolve({ cwd: isolatedRoot, relativePath: isolatedName, absolutePath: isolatedPath });
          if (resolution?.status === 'resolved') {
            if (!existsSync(isolatedPath) || !lstatSync(isolatedPath).isFile()) throw mergeError(`structured resolver replaced the candidate path: ${relativePath}`, 'structured_unsupported_path');
            merged = readFileSync(isolatedPath); if (merged.byteLength > opts.resolver.maxFileBytes) throw mergeError(`structured resolution exceeds file budget: ${relativePath}`, 'structured_file_too_large');
            if (merged.includes(0)) throw mergeError(`structured resolution is binary: ${relativePath}`, 'structured_binary_conflict');
          }
        } finally { rmSync(isolatedRoot, { recursive: true, force: true }); }
        resolutions.push({ path: relativePath, ...resolution });
        if (resolution?.status === 'parse_fallback') throw mergeError(`structured resolver fell back for ${relativePath}`, 'structured_parse_fallback');
        if (resolution?.status !== 'resolved') throw mergeError(`structured resolver did not resolve ${relativePath}`, resolution?.status === 'unknown' ? 'structured_tool_unknown' : 'structured_unresolved');
        const mergedText = new TextDecoder('utf-8', { fatal: true }).decode(merged);
        if (CONFLICT_MARKER.test(mergedText)) throw mergeError(`structured conflict markers remain in ${relativePath}`, 'structured_unresolved');
        let writePath; try { writePath = realpathSync(absolutePath); } catch { throw mergeError(`structured conflict path changed during resolution: ${relativePath}`, 'structured_unsupported_path'); }
        if (writePath !== realConflictPath) throw mergeError(`structured conflict path changed during resolution: ${relativePath}`, 'structured_unsupported_path');
        writeFileSync(absolutePath, merged, { mode: 0o600 });
        gitFile(['add', '--', relativePath], stagePath, { stdio: 'pipe' });
        classes.push({ path: relativePath, class: 'structured_resolved' });
      }
    }
    const remaining = gitFile(['diff', '--name-only', '--diff-filter=U', '-z'], stagePath, { encoding: 'utf8' });
    if (remaining.length > 0) throw mergeError('structured merge left unmerged index entries', 'structured_unresolved');
    try { gitFile(['diff', '--check', '--cached'], stagePath, { stdio: 'pipe' }); }
    catch (error) { throw mergeError('structured merge candidate fails git diff --check', 'structured_diff_invalid', error); }
    gitFile(['-c', 'core.hooksPath=/dev/null', 'commit', '--no-verify', '-q', '-m', `baton structured integration: ${taskId}`], stagePath, { stdio: 'pipe' },
      { GIT_AUTHOR_NAME: 'baton-merge', GIT_AUTHOR_EMAIL: 'baton-merge@localhost', GIT_COMMITTER_NAME: 'baton-merge', GIT_COMMITTER_EMAIL: 'baton-merge@localhost' });
    const stageSha = sh('git', ['rev-parse', 'HEAD'], stagePath);
    const parents = sh('git', ['show', '-s', '--format=%P', stageSha], stagePath).split(' ');
    if (parents.length !== 2 || parents[0] !== beforeSha || parents[1] !== rightSha) throw mergeError('structured candidate does not have the exact merge parents', 'structured_parent_mismatch');
    return Object.freeze({ taskId, beforeSha, resultSha: rightSha, mergeBaseSha, stageSha, stagePath, classes, resolutions, resolver: opts.resolver?.identity?.() ?? null });
  } catch (error) {
    await removeStructuredIntegration(repoRoot, { stagePath });
    if (error?.code?.startsWith('structured_')) throw error;
    throw mergeError(String(error?.message ?? error), 'structured_merge_failed', error);
  }
}

export async function finalizeStructuredIntegration(repoRoot, stage) {
  if (!stage?.beforeSha || !stage?.stageSha || !stage?.stagePath) throw mergeError('invalid structured stage descriptor', 'structured_stage_invalid');
  if (!isClean(repoRoot)) throw mergeError('main became dirty after structured staging', 'structured_main_dirty');
  if (sh('git', ['rev-parse', 'HEAD'], repoRoot) !== stage.beforeSha) throw mergeError('main advanced after structured staging', 'structured_main_advanced');
  const parents = sh('git', ['show', '-s', '--format=%P', stage.stageSha], repoRoot).split(' ');
  if (parents.length !== 2 || parents[0] !== stage.beforeSha || parents[1] !== stage.resultSha) throw mergeError('structured candidate parent identity changed', 'structured_parent_mismatch');
  try { gitFile(['-c', 'core.hooksPath=/dev/null', 'merge', '--no-verify', '--ff-only', stage.stageSha], repoRoot, { encoding: 'utf8', stdio: 'pipe' }); }
  catch (error) { throw mergeError('main could not fast-forward to verified structured candidate', 'structured_main_advanced', error); }
  try {
    const afterSha = sh('git', ['rev-parse', 'HEAD'], repoRoot);
    if (afterSha !== stage.stageSha) throw new Error('main did not remain on the verified structured candidate after fast-forward');
    if (!isClean(repoRoot)) throw new Error('main became dirty after the verified structured candidate fast-forwarded');
    return { beforeSha: stage.beforeSha, resultSha: stage.resultSha, mergeBaseSha: stage.mergeBaseSha, stageSha: stage.stageSha, afterSha, classes: stage.classes, resolutions: stage.resolutions, resolver: stage.resolver };
  } catch (error) {
    if (error?.postEffect === true) throw error;
    throw postEffectMergeError(String(error?.message ?? error), error);
  }
}

export async function inspectStructuredIntegration(repoRoot, stage) {
  if (!stage?.beforeSha || !stage?.stageSha) throw mergeError('invalid structured stage descriptor', 'structured_stage_invalid');
  const headSha = sh('git', ['rev-parse', 'HEAD'], repoRoot);
  return Object.freeze({ headSha, stageSha: stage.stageSha, beforeSha: stage.beforeSha, effectApplied: headSha === stage.stageSha, clean: isClean(repoRoot) });
}

// ---------------------------------------------------------------------------
// freshVerifySandbox
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {string} label
 * @param {string} sha
 * @param {{log?: object, dependencyDirs?: string[], sparsePaths?: string[]}} [opts]
 * @returns {Promise<{dir:string, sha:string, copiedDependencies:string[], sparsePaths:string[], cleanup:() => Promise<void>}>}
 * @throws {InvalidShaError}
 */
export async function freshVerifySandbox(repoRoot, label, sha, opts = {}) {
  let fullSha;
  try {
    fullSha = sh('git', ['rev-parse', '--verify', `${sha}^{commit}`], repoRoot);
  } catch {
    throw new InvalidShaError(`freshVerifySandbox: "${sha}" does not resolve to a commit in ${repoRoot}`);
  }
  // Validate every source before registering a worktree. Invalid configuration therefore cannot
  // create a detached checkout that no caller has a cleanup handle for.
  const sources = dependencySources(repoRoot, opts.dependencyDirs ?? []);
  const sparsePaths = sparseProjection(opts.sparsePaths ?? []);

  const verifyRoot = join(repoRoot, '.baton', 'verify');
  mkdirSync(verifyRoot, { recursive: true });
  const suffix = randomBytes(4).toString('hex');
  const dir = join(verifyRoot, `${label}-${suffix}`);
  let registered = false;

  const cleanup = async () => {
    if (registered || existsSync(dir)) {
      try {
        sh('git', ['worktree', 'remove', '--force', dir], repoRoot);
      } catch {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* best-effort */ }
  };

  // Source stays commit-fresh while explicitly configured installed dependencies are copied into
  // the sandbox. Never symlink/hardlink the main checkout: the pinned verification command must
  // not be able to mutate the orchestrator's toolchain through its dependency path. Any copy
  // failure removes and prunes the worktree before the error escapes.
  const copiedDependencies = [];
  try {
    sh('git', ['worktree', 'add', '--detach', ...(sparsePaths.length ? ['--no-checkout'] : []), dir, fullSha], repoRoot);
    registered = true;
    if (sparsePaths.length) {
      gitFile(['sparse-checkout', 'set', '--no-cone', '--stdin'], dir, { input: `${sparsePaths.map((path) => `/${path}`).join('\n')}\n`, encoding: 'utf8' });
      gitFile(['checkout', '--detach', fullSha], dir, { stdio: 'pipe' });
    }
    copiedDependencies.push(...materializeDependencies(dir, sources));
  } catch (err) {
    await cleanup();
    throw err;
  }

  logEvent(opts, 'worktree', 'worktree.verify_sandbox_created', { dir, sha: fullSha, label, copiedDependencies, sparsePaths });
  return { dir, sha: fullSha, copiedDependencies, sparsePaths, cleanup };
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
 * @returns {Promise<{prunedAdminEntries:string[], removedZombieDirs:string[], removedIntegrationDirs:string[], errors:string[]}>}
 */
export async function reconcile(repoRoot, expectedActiveTaskIds = [], opts = {}) {
  const report = { prunedAdminEntries: [], removedZombieDirs: [], removedIntegrationDirs: [], errors: [] };
  try {
    sh('git', ['worktree', 'prune'], repoRoot);
  } catch (err) {
    report.errors.push(`prune: ${err.message || err}`);
  }

  // Structured integration is never resumed after coordinator restart: without an in-memory
  // operation holding the freshly observed verification verdict, a candidate is evidence only.
  // Reap every detached stage and require a new attempt to reconstruct and reverify it.
  const mergeRoot = integrationRoot(repoRoot);
  if (existsSync(mergeRoot)) {
    for (const entry of readdirSync(mergeRoot)) {
      const fullDir = join(mergeRoot, entry);
      let isDir = false; try { isDir = statSync(fullDir).isDirectory(); } catch { continue; }
      if (!isDir) continue;
      try {
        try { sh('git', ['worktree', 'remove', '--force', fullDir], repoRoot); }
        catch { rmSync(fullDir, { recursive: true, force: true }); }
        report.removedIntegrationDirs.push(fullDir);
        logEvent(opts, entry, 'worktree.integration_reconciled', { dir: fullDir });
      } catch (err) { report.errors.push(`${entry}: ${err.message || err}`); }
    }
    try { if (readdirSync(mergeRoot).length === 0) rmSync(mergeRoot, { recursive: true, force: true }); } catch { /* best effort */ }
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
  const diff = gitFile(['diff', '--unified=0', '--no-color', fromSha, toSha], repoRoot, { encoding: 'utf8' });
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
