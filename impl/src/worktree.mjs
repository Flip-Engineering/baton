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
import { ToolchainProjectionError } from './toolchain-projection.mjs';

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
export class WorktreeCleanupError extends Error {
  constructor(message) { super(message); this.name = 'WorktreeCleanupError'; this.code = 'worktree_cleanup_failed'; }
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

function projectionExcludePathFor(repoRoot, taskId) {
  return join(repoRoot, '.baton', 'wt', `${taskId}.projection.exclude`);
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

function configureProjectionExcludes(repoRoot, worktreeDir, taskId, targetPaths) {
  const excludePath = projectionExcludePathFor(repoRoot, taskId);
  mkdirSync(dirname(excludePath), { recursive: true });
  writeFileSync(excludePath, `${targetPaths.map((path) => `/${path}`).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  gitFile(['config', 'extensions.worktreeConfig', 'true'], repoRoot, { stdio: 'pipe' });
  gitFile(['config', '--worktree', 'core.excludesFile', excludePath], worktreeDir, { stdio: 'pipe' });
  return excludePath;
}

function trackedProjectionPaths(worktreeDir, targetPaths) {
  if (targetPaths.length === 0) return [];
  const raw = gitFile(['ls-files', '-z', '--', ...targetPaths], worktreeDir, { encoding: 'utf8' });
  return raw.split('\0').filter(Boolean);
}

export function validateToolchainProjectionMetadata(repoRoot, taskId, identity) {
  const meta = readMeta(repoRoot, taskId);
  return !!meta?.toolchainProjection && JSON.stringify(meta.toolchainProjection) === JSON.stringify(identity)
    && Array.isArray(meta.toolchainProjectionTargets) && meta.toolchainProjectionTargets.length > 0;
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
 * @param {{log?: object, dependencyDirs?: string[], toolchainProjection?: object}} [opts]
 * @returns {Promise<{taskId:string, dir:string, branch:string, baseSha:string, createdAt:string,copiedDependencies:string[], toolchainProjection?: object}>}
 */
export async function createFromBase(repoRoot, taskId, baseSha, opts = {}) {
  const dir = wtDirFor(repoRoot, taskId);
  if (existsSync(dir)) {
    throw new WorktreeAlreadyExistsError(`createFromBase: ${dir} already exists`);
  }

  // TP10: Reject mixed legacy dependency and new toolchain projection configuration
  if (opts.toolchainProjection && (opts.dependencyDirs && opts.dependencyDirs.length > 0)) {
    throw new Error('cannot combine dependencyDirs with toolchainProjection (ambiguous configuration)');
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

  let copiedDependencies = [];
  let toolchainProjection;
  let toolchainProjectionTargets;
  let projectionExcludePath;

  try {
    if (opts.toolchainProjection) {
      toolchainProjectionTargets = opts.toolchainProjection.targetPaths();
      projectionExcludePath = configureProjectionExcludes(repoRoot, dir, taskId, toolchainProjectionTargets);
      const result = opts.toolchainProjection.materialize(dir);
      toolchainProjection = result.identity;
      if (JSON.stringify(result.materializedTargets) !== JSON.stringify(toolchainProjectionTargets)) throw new ToolchainProjectionError('toolchain materialization is invalid', 'toolchain_projection_materialization_failed');
    } else {
      copiedDependencies = materializeDependencies(dir, sources);
    }
  } catch (err) {
    try { sh('git', ['worktree', 'remove', '--force', dir], repoRoot); }
    catch { rmSync(dir, { recursive: true, force: true }); }
    try { sh('git', ['branch', '-D', branch], repoRoot); } catch { /* best-effort */ }
    try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* best-effort */ }
    if (projectionExcludePath) rmSync(projectionExcludePath, { force: true });
    throw err;
  }

  const createdAt = new Date().toISOString();

  // Store metadata including projection target paths for exclusion
  const meta = { taskId, branch, baseSha, createdAt, stoppedAt: null, copiedDependencies };
  if (toolchainProjection) {
    meta.toolchainProjection = toolchainProjection;
    meta.toolchainProjectionTargets = toolchainProjectionTargets;
    meta.projectionExclude = `${taskId}.projection.exclude`;
  }
  writeMeta(repoRoot, taskId, meta);

  logEvent(opts, taskId, 'worktree.created', { dir, branch, baseSha, copiedDependencies, ...(toolchainProjection ? { toolchainProjection } : {}) });
  return { taskId, dir, branch, baseSha, createdAt, copiedDependencies, ...(toolchainProjection ? { toolchainProjection } : {}) };
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

  // TP5: Read metadata to get projection targets for exclusion
  const meta = readMeta(repoRoot, taskId);
  const projectionTargets = meta?.toolchainProjectionTargets ?? [];
  if (trackedProjectionPaths(dir, projectionTargets).length > 0) throw new ToolchainProjectionError('toolchain projection entered the result index', 'toolchain_projection_materialization_failed');

  let snapshotted = false;
  if (!isClean(dir)) {
    sh('git', ['add', '-A'], dir);
    if (trackedProjectionPaths(dir, projectionTargets).length > 0) throw new ToolchainProjectionError('toolchain projection entered the result index', 'toolchain_projection_materialization_failed');
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
 * @param {{log?: object, dependencyDirs?: string[], sparsePaths?: string[], toolchainProjection?: object}} [opts]
 * @returns {Promise<{dir:string, sha:string, copiedDependencies:string[], sparsePaths:string[], toolchainProjection?: object, cleanup:() => Promise<void>}>}
 * @throws {InvalidShaError}
 */
export async function freshVerifySandbox(repoRoot, label, sha, opts = {}) {
  let fullSha;
  try {
    fullSha = sh('git', ['rev-parse', '--verify', `${sha}^{commit}`], repoRoot);
  } catch {
    throw new InvalidShaError(`freshVerifySandbox: "${sha}" does not resolve to a commit in ${repoRoot}`);
  }

  // TP10: Reject mixed legacy dependency and new toolchain projection configuration
  if (opts.toolchainProjection && (opts.dependencyDirs && opts.dependencyDirs.length > 0)) {
    throw new Error('cannot combine dependencyDirs with toolchainProjection (ambiguous configuration)');
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
  let toolchainProjection;
  try {
    sh('git', ['worktree', 'add', '--detach', ...(sparsePaths.length ? ['--no-checkout'] : []), dir, fullSha], repoRoot);
    registered = true;
    if (sparsePaths.length) {
      gitFile(['sparse-checkout', 'set', '--no-cone', '--stdin'], dir, { input: `${sparsePaths.map((path) => `/${path}`).join('\n')}\n`, encoding: 'utf8' });
      gitFile(['checkout', '--detach', fullSha], dir, { stdio: 'pipe' });
    }

    // Materialize legacy dependencies or toolchain projection
    if (opts.toolchainProjection) {
      const result = opts.toolchainProjection.materialize(dir);
      toolchainProjection = result.identity;
    } else {
      copiedDependencies.push(...materializeDependencies(dir, sources));
    }
  } catch (err) {
    await cleanup();
    throw err;
  }

  logEvent(opts, 'worktree', 'worktree.verify_sandbox_created', { dir, sha: fullSha, label, copiedDependencies, sparsePaths, ...(toolchainProjection ? { toolchainProjection } : {}) });
  return { dir, sha: fullSha, copiedDependencies, sparsePaths, ...(toolchainProjection ? { toolchainProjection } : {}), cleanup };
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
  const projectionExclude = projectionExcludePathFor(repoRoot, taskId);
  if (existsSync(dir)) {
    const meta = readMeta(repoRoot, taskId);
    const stopped = !!meta?.stoppedAt;
    if (!stopped && !opts.force) {
      throw new WorktreeLockedError(`reap: worktree "${taskId}" was never markStopped (pass {force:true} to override)`);
    }
    try { sh('git', ['worktree', 'remove', '--force', dir], repoRoot); }
    catch { rmSync(dir, { recursive: true, force: true }); }
  }
  // A missing directory may still retain a Git administrative registration. Prune and inspect
  // before claiming success; D10 cleanup is about ownership, not only pathname absence.
  try { sh('git', ['worktree', 'prune'], repoRoot); }
  catch (error) { throw new WorktreeCleanupError('owned worktree administration could not be pruned', { cause: error }); }
  if (opts.deleteBranch) {
    try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); sh('git', ['branch', '-D', `baton/${taskId}`], repoRoot); }
    catch {
      // A failed existence probe is the idempotent absent case. A surviving ref below is red.
    }
  }
  if (existsSync(metaFile)) rmSync(metaFile, { force: true });
  if (existsSync(projectionExclude)) rmSync(projectionExclude, { force: true });
  const registered = (await listWorktrees(repoRoot)).some((entry) => {
    try { return realpathSync(entry.dir) === realpathSync(dir); }
    catch { return pathResolve(entry.dir) === pathResolve(dir); }
  });
  let branchPresent = false;
  if (opts.deleteBranch) {
    try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); branchPresent = true; } catch { /* absent */ }
  }
  if (existsSync(dir) || existsSync(metaFile) || existsSync(projectionExclude) || registered || branchPresent) {
    throw new WorktreeCleanupError('owned worktree cleanup did not reach an exact absent state');
  }
  logEvent(opts, taskId, 'worktree.reaped', { dir });
}

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {string[]} expectedActiveTaskIds
 * @param {{log?: object}} [opts]
 * @returns {Promise<{prunedAdminEntries:string[], removedZombieDirs:string[], removedIntegrationDirs:string[], removedVerifyDirs:string[], errors:string[]}>}
 */
export function reconcile(repoRoot, expectedActiveTaskIds = [], opts = {}) {
  const report = { prunedAdminEntries: [], removedZombieDirs: [], removedIntegrationDirs: [], removedVerifyDirs: [], errors: [] };
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
    try { if (readdirSync(mergeRoot).length === 0) rmSync(mergeRoot, { recursive: true, force: true }); } catch (err) { report.errors.push(`integration-root: ${err.message || err}`); }
  }

  const expected = new Set(expectedActiveTaskIds);

  const wtRoot = join(repoRoot, '.baton', 'wt');
  {
    const candidates = new Set();
    if (existsSync(wtRoot)) {
    for (const entry of readdirSync(wtRoot)) {
      if (entry.endsWith('.meta.json')) candidates.add(entry.slice(0, -'.meta.json'.length));
      else if (entry.endsWith('.projection.exclude')) candidates.add(entry.slice(0, -'.projection.exclude'.length));
      else {
        try { if (statSync(join(wtRoot, entry)).isDirectory()) candidates.add(entry); } catch { /* inspected below if represented by metadata */ }
      }
    }
    }
    try {
      for (const taskId of sh('git', ['for-each-ref', '--format=%(refname:strip=3)', 'refs/heads/baton/'], repoRoot).split('\n').filter(Boolean)) candidates.add(taskId);
    } catch (err) { report.errors.push(`worker-branch-scan: ${err.message || err}`); }
    for (const taskId of candidates) {
      const fullDir = join(wtRoot, taskId); const metaFile = metaPathFor(repoRoot, taskId); const projectionExclude = projectionExcludePathFor(repoRoot, taskId);
      if (expected.has(taskId) && existsSync(fullDir)) continue;
      try {
        const hadDir = existsSync(fullDir); const hadResidue = hadDir || existsSync(metaFile) || existsSync(projectionExclude);
        if (hadDir) {
          try { sh('git', ['worktree', 'remove', '--force', fullDir], repoRoot); }
          catch { rmSync(fullDir, { recursive: true, force: true }); }
        }
        if (existsSync(metaFile)) rmSync(metaFile, { force: true });
        if (existsSync(projectionExclude)) rmSync(projectionExclude, { force: true });
        let branchPresent = false;
        try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); branchPresent = true; } catch { /* absent */ }
        const hadBranch = branchPresent;
        if (branchPresent) sh('git', ['branch', '-D', `baton/${taskId}`], repoRoot);
        try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); branchPresent = true; } catch { branchPresent = false; }
        if (existsSync(fullDir) || existsSync(metaFile) || existsSync(projectionExclude) || branchPresent) throw new WorktreeCleanupError('reconciled worker ownership remained after cleanup');
        if (hadDir) report.removedZombieDirs.push(fullDir);
        if (hadResidue || hadBranch) logEvent(opts, taskId, 'worktree.reconciled', { dir: fullDir });
      } catch (err) {
        report.errors.push(`${taskId}: ${err.message || err}`);
      }
    }
  }

  // Verification sandboxes are never resumable. A crash can occur between sandbox creation and
  // its in-memory finally block, so restart reconciliation owns every abandoned directory.
  const verifyRoot = join(repoRoot, '.baton', 'verify');
  if (existsSync(verifyRoot)) {
    for (const entry of readdirSync(verifyRoot)) {
      const fullDir = join(verifyRoot, entry);
      try {
        try { sh('git', ['worktree', 'remove', '--force', fullDir], repoRoot); }
        catch { rmSync(fullDir, { recursive: true, force: true }); }
        if (existsSync(fullDir)) throw new WorktreeCleanupError('verification sandbox remained after cleanup');
        report.removedVerifyDirs.push(fullDir);
      } catch (err) { report.errors.push(`${entry}: ${err.message || err}`); }
    }
    try { if (readdirSync(verifyRoot).length === 0) rmSync(verifyRoot, { recursive: true, force: true }); } catch (err) { report.errors.push(`verify-root: ${err.message || err}`); }
  }
  try { sh('git', ['worktree', 'prune'], repoRoot); }
  catch (err) { report.errors.push(`final-prune: ${err.message || err}`); }
  try {
    const registered = listWorktrees(repoRoot);
    const verifyPrefix = `${pathResolve(repoRoot, '.baton', 'verify')}${sep}`;
    const integrationPrefix = `${pathResolve(repoRoot, '.baton', 'integrate')}${sep}`;
    const workerRoot = pathResolve(repoRoot, '.baton', 'wt');
    for (const entry of registered) {
      const absolute = pathResolve(entry.dir);
      if (absolute.startsWith(verifyPrefix) || absolute.startsWith(integrationPrefix)) {
        report.errors.push(`registered-owned-sandbox:${basename(absolute)}`);
        continue;
      }
      const withinWorkers = pathRelative(workerRoot, absolute);
      if (withinWorkers !== '' && withinWorkers !== '..' && !withinWorkers.startsWith(`..${sep}`) && !isAbsolute(withinWorkers)) {
        const taskId = withinWorkers.split(sep)[0];
        if (!expected.has(taskId)) report.errors.push(`registered-zombie-worker:${taskId}`);
      }
    }
    for (const taskId of sh('git', ['for-each-ref', '--format=%(refname:strip=3)', 'refs/heads/baton/'], repoRoot).split('\n').filter(Boolean)) {
      if (!expected.has(taskId) || !existsSync(join(wtRoot, taskId))) report.errors.push(`branch-zombie-worker:${taskId}`);
    }
  } catch (err) { report.errors.push(`registration-postcheck: ${err.message || err}`); }
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
export function listWorktrees(repoRoot) {
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
