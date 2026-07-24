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
  chmodSync, closeSync, cpSync, existsSync, fsyncSync, mkdirSync, mkdtempSync, openSync, renameSync,
  linkSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, lstatSync, realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename, join, dirname, isAbsolute, sep, resolve as pathResolve, relative as pathRelative,
} from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ToolchainProjectionError } from './toolchain-projection.mjs';
import { foldCanonicalCase } from './canonical-order.mjs';

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
export class WorkspaceOwnerDiagnostic extends Error {
  constructor(message, code = 'workspace_owner_ambiguous') {
    super(message); this.name = 'WorkspaceOwnerDiagnostic'; this.code = code;
  }
}
export class SparseCheckoutError extends Error {
  constructor(message, code = 'worker_sparse_projection_changed') { super(message); this.name = 'SparseCheckoutError'; this.code = code; }
}
export class StructuredMergeError extends Error {
  constructor(message, code = 'structured_merge_failed') { super(message); this.name = 'StructuredMergeError'; this.code = code; }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    ...(cmd === 'git' ? { env: localGitEnv() } : {}),
  }).trim();
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

const AUTHORITY_ROOTS = new Set(['integrate', 'verify', 'wt']);

function authorityRoot(repoRoot, name, { create = false } = {}) {
  if (!AUTHORITY_ROOTS.has(name)) throw new TypeError('unknown worktree authority root');
  const repoPath = pathResolve(repoRoot); const repo = realpathSync(repoPath); const baton = join(repoPath, '.baton'); const root = join(baton, name);
  for (const path of [baton, root]) {
    if (!existsSync(path)) {
      if (!create) return null;
      mkdirSync(path, { mode: 0o700 });
    }
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new WorktreeCleanupError(`${name} root is not a confined directory`);
    chmodSync(path, 0o700);
    const real = realpathSync(path); const within = pathRelative(repo, real);
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new WorktreeCleanupError(`${name} root escapes repository ownership`);
  }
  return root;
}

function authorityChild(repoRoot, name, child, { createRoot = false, kind = 'directory', mustExist = false } = {}) {
  const root = authorityRoot(repoRoot, name, { create: createRoot });
  const base = root ?? join(realpathSync(repoRoot), '.baton', name);
  const candidate = join(base, child); const within = pathRelative(base, candidate);
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new WorktreeCleanupError(`${name} child escapes repository ownership`);
  if (!existsSync(candidate)) {
    if (mustExist) throw new WorktreeCleanupError(`${name} child is missing`);
    return candidate;
  }
  const stat = lstatSync(candidate);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile())) throw new WorktreeCleanupError(`${name} child is not an owned ${kind}`);
  const real = realpathSync(candidate); const realWithin = pathRelative(realpathSync(base), real);
  if (realWithin === '' || realWithin === '..' || realWithin.startsWith(`..${sep}`) || isAbsolute(realWithin)) throw new WorktreeCleanupError(`${name} child escapes repository ownership`);
  return candidate;
}

export function validateOwnedAuthorityPath(repoRoot, name, candidate, opts = {}) {
  const root = authorityRoot(repoRoot, name, { create: false });
  if (!root) throw new WorktreeCleanupError(`${name} root is missing`);
  const resolved = pathResolve(candidate); const within = pathRelative(root, resolved);
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new WorktreeCleanupError(`${name} cleanup path is outside Baton ownership`);
  return authorityChild(repoRoot, name, within, { kind: opts.kind ?? 'directory', mustExist: opts.mustExist ?? true });
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
  let f;
  try { f = authorityChild(repoRoot, 'wt', `${taskId}.meta.json`, { kind: 'file' }); }
  catch { return null; }
  if (!existsSync(f)) return null;
  try {
    const stat = lstatSync(f);
    if ((stat.mode & 0o077) !== 0 || stat.size > 1024 * 1024) return null;
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
}

function writeMeta(repoRoot, taskId, meta) {
  const f = authorityChild(repoRoot, 'wt', `${taskId}.meta.json`, { createRoot: true, kind: 'file' });
  const temp = `${f}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temp, f);
    try {
      const parent = openSync(dirname(f), 'r');
      try { fsyncSync(parent); } finally { closeSync(parent); }
    } catch { /* directory fsync is unavailable on some filesystems */ }
  } catch (error) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* no-op */ }
    rmSync(temp, { force: true });
    throw error;
  }
}

function writePrivateJson(f, value, { exclusive = false } = {}) {
  mkdirSync(dirname(f), { recursive: true, mode: 0o700 });
  chmodSync(dirname(f), 0o700);
  if (exclusive) {
    const temp = `${f}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    let fd;
    let linked = false;
    let durable = false;
    try {
      fd = openSync(temp, 'wx', 0o600);
      writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      fsyncSync(fd);
      closeSync(fd); fd = undefined;
      // A same-directory hard link is an atomic no-replace publication: unlike rename(), it
      // cannot overwrite another controller's receipt after a collision.
      linkSync(temp, f);
      linked = true;
      const parent = openSync(dirname(f), 'r');
      try { fsyncSync(parent); durable = true; } finally { closeSync(parent); }
      // The final name is authoritative after its directory fsync. Temp unlink and the fsync
      // which persists that unlink are hygiene only: neither may erase or invalidate the owner.
      try {
        rmSync(temp);
        const cleanedParent = openSync(dirname(f), 'r');
        try { fsyncSync(cleanedParent); } finally { closeSync(cleanedParent); }
      } catch { /* exact retry/release cleans a same-inode publication temp */ }
      return;
    } catch (error) {
      if (fd !== undefined) try { closeSync(fd); } catch { /* no-op */ }
      if (durable) return;
      // A wrapped/injected link can report failure after performing the effect. Only regard the
      // final name as ours when it is the same inode as our fully synced private temp.
      if (!linked && existsSync(f) && existsSync(temp)) {
        try {
          const finalStat = statSync(f); const tempStat = statSync(temp);
          linked = finalStat.dev === tempStat.dev && finalStat.ino === tempStat.ino;
        } catch { /* the target remains someone else's collision */ }
      }
      let absenceDurable = !linked;
      if (linked) {
        try { rmSync(f); } catch { /* retain the exact allocation below */ }
        try {
          const parent = openSync(dirname(f), 'r');
          try {
            fsyncSync(parent);
            absenceDurable = !existsSync(f);
          } finally { closeSync(parent); }
        } catch { /* absence was not durably proven */ }
      }
      // Once final-name absence is durable, temp residue is not an allocation and may be cleaned
      // independently. Before that point it preserves the exact random ID for a retry.
      if (absenceDurable) {
        try { rmSync(temp, { force: true }); } catch { /* harmless unpublished temp residue */ }
        try {
          const parent = openSync(dirname(f), 'r');
          try { fsyncSync(parent); } finally { closeSync(parent); }
        } catch { /* final-name absence was already committed */ }
      }
      if (!absenceDurable) {
        throw Object.assign(new WorkspaceOwnerDiagnostic(
          'physical workspace owner publication outcome is unknown',
          'workspace_owner_publication_unknown',
        ), {
          cause: error,
          physicalOwnerId: value.physicalOwnerId,
          ownerReceipt: Object.freeze(JSON.parse(JSON.stringify(value))),
        });
      }
      throw error;
    }
  }
  const temp = `${f}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temp, f);
    try { const parent = openSync(dirname(f), 'r'); try { fsyncSync(parent); } finally { closeSync(parent); } }
    catch { /* directory fsync is unavailable on some filesystems */ }
  } catch (error) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* no-op */ }
    rmSync(temp, { force: true });
    throw error;
  }
}

function workspaceOwnerRoot(repoRoot, create = false) {
  const raw = sh('git', ['rev-parse', '--git-common-dir'], repoRoot);
  const common = isAbsolute(raw) ? raw : pathResolve(repoRoot, raw);
  const commonReal = realpathSync(common);
  const batonRoot = join(commonReal, 'baton');
  const root = join(batonRoot, 'workspace-owners');
  if (create && !existsSync(batonRoot)) {
    try { mkdirSync(batonRoot, { mode: 0o700 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  if (existsSync(batonRoot)) {
    const stat = lstatSync(batonRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(batonRoot) !== batonRoot) {
      throw new WorkspaceOwnerDiagnostic('physical workspace owner parent is unsafe', 'workspace_owner_root_invalid');
    }
  }
  if (create && !existsSync(root)) {
    try { mkdirSync(root, { mode: 0o700 }); }
    catch (error) { if (error?.code !== 'EEXIST') throw error; }
  }
  if (existsSync(root)) {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) {
      throw new WorkspaceOwnerDiagnostic('physical workspace owner root is unsafe', 'workspace_owner_root_invalid');
    }
    chmodSync(root, 0o700);
  }
  return root;
}

function workspaceOwnerReceiptPath(repoRoot, physicalOwnerId) {
  normalizePhysicalOwnerId(physicalOwnerId, 'physical workspace owner');
  return join(workspaceOwnerRoot(repoRoot, false), `${physicalOwnerId}.json`);
}

function validOwnerText(value, maxBytes = 4_096, nullable = false) {
  return (nullable && value === null) || (typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value) <= maxBytes && !value.includes('\0'));
}

function receiptCore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { receiptDigest: _receiptDigest, ...core } = value;
  return core;
}

function validateWorkspaceOwnerReceipt(value, repoRoot, expectedOwnerId = null) {
  const fields = [
    'attemptId', 'baseSha', 'branch', 'controller', 'controllerId', 'createdAt',
    'deploymentId', 'logicalTaskId', 'physicalOwnerId', 'processGeneration', 'receiptDigest',
    'runId', 'schemaVersion', 'state', 'worktree',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== fields.sort().join(',')
    || value.schemaVersion !== 1
    || !/^ws-[a-f0-9]{32}$/u.test(value.physicalOwnerId ?? '')
    || (expectedOwnerId !== null && value.physicalOwnerId !== expectedOwnerId)
    || value.branch !== `baton/${value.physicalOwnerId}`
    || value.worktree !== pathResolve(repoRoot, '.baton', 'wt', value.physicalOwnerId)
    || !/^[a-f0-9]{40}$/u.test(value.baseSha ?? '')
    || !validOwnerText(value.logicalTaskId)
    || !validOwnerText(value.runId, 4_096, true)
    || !validOwnerText(value.attemptId, 4_096)
    || !Number.isSafeInteger(value.processGeneration) || value.processGeneration <= 0
    || !/^[a-f0-9]{64}$/u.test(value.deploymentId ?? '')
    || !/^[a-f0-9]{64}$/u.test(value.controllerId ?? '')
    || !value.controller || typeof value.controller !== 'object' || Array.isArray(value.controller)
    || Object.keys(value.controller).sort().join(',') !== ['pid', 'pidStart'].join(',')
    || !Number.isSafeInteger(value.controller.pid) || value.controller.pid <= 0
    || !validOwnerText(value.controller.pidStart, 256)
    || !['allocated', 'ready', 'stopped'].includes(value.state)
    || !Number.isFinite(Date.parse(value.createdAt))
    || value.receiptDigest !== canonicalDigest(receiptCore(value))) {
    throw new WorkspaceOwnerDiagnostic('physical workspace owner receipt is invalid', 'workspace_owner_receipt_invalid');
  }
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

function readWorkspaceOwnerReceipt(repoRoot, physicalOwnerId) {
  let f;
  try { f = workspaceOwnerReceiptPath(repoRoot, physicalOwnerId); } catch { return null; }
  if (!existsSync(f)) return null;
  try {
    const stat = lstatSync(f);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 64 * 1024) {
      throw new WorkspaceOwnerDiagnostic('physical workspace owner receipt is unsafe', 'workspace_owner_receipt_invalid');
    }
    return validateWorkspaceOwnerReceipt(JSON.parse(readFileSync(f, 'utf8')), repoRoot, physicalOwnerId);
  } catch (error) {
    if (error instanceof WorkspaceOwnerDiagnostic) throw error;
    throw Object.assign(new WorkspaceOwnerDiagnostic('physical workspace owner receipt is unreadable', 'workspace_owner_receipt_invalid'), { cause: error });
  }
}

// A receipt that fails this-repoRoot validation may still be a live FOREIGN controller's
// structurally sound receipt — its `worktree`/`branch` are relative to that controller's root, so
// they never match here (validateWorkspaceOwnerReceipt line ~332). Such a record is another
// deployment's business, not this repo's orphan residue, so reconcile must retain-and-proceed
// rather than refuse. Genuine corruption (bad field set, digest mismatch) returns null → refusal.
function foreignConsistentReceipt(repoRoot, physicalOwnerId) {
  let f;
  try { f = workspaceOwnerReceiptPath(repoRoot, physicalOwnerId); } catch { return null; }
  if (!existsSync(f)) return null;
  try {
    const stat = lstatSync(f);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 64 * 1024) return null;
    const value = JSON.parse(readFileSync(f, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const fields = [
      'attemptId', 'baseSha', 'branch', 'controller', 'controllerId', 'createdAt',
      'deploymentId', 'logicalTaskId', 'physicalOwnerId', 'processGeneration', 'receiptDigest',
      'runId', 'schemaVersion', 'state', 'worktree',
    ];
    if (Object.keys(value).sort().join(',') !== fields.sort().join(',')
      || value.schemaVersion !== 1
      || value.physicalOwnerId !== physicalOwnerId
      || !/^ws-[a-f0-9]{32}$/u.test(value.physicalOwnerId ?? '')
      || value.branch !== `baton/${value.physicalOwnerId}`
      || value.receiptDigest !== canonicalDigest(receiptCore(value))) return null;
    return value;
  } catch { return null; }
}

function receiptMatchesAllocation(receipt, binding, authority) {
  return receipt.state === 'allocated'
    && receipt.logicalTaskId === binding.logicalTaskId
    && receipt.runId === binding.runId
    && receipt.attemptId === binding.attemptId
    && receipt.processGeneration === binding.processGeneration
    && receipt.baseSha === binding.baseSha
    && receipt.deploymentId === authority.deploymentId
    && receipt.controllerId === authority.controllerId
    && receipt.controller.pid === authority.pid
    && receipt.controller.pidStart === authority.pidStart;
}

function readWorkspaceOwnerTemp(repoRoot, root, name, physicalOwnerId) {
  const candidate = join(root, name);
  try {
    const stat = lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
      || stat.size > 64 * 1024) return null;
    return validateWorkspaceOwnerReceipt(
      JSON.parse(readFileSync(candidate, 'utf8')), repoRoot, physicalOwnerId,
    );
  } catch { return null; }
}

function workspaceOwnerPublicationTempNames(root, physicalOwnerId) {
  if (!existsSync(root)) return [];
  const prefix = `${physicalOwnerId}.json.tmp-`;
  return readdirSync(root).filter((name) => name.startsWith(prefix)).sort();
}

function readWorkspaceOwnerTempReceipt(repoRoot, physicalOwnerId) {
  const root = workspaceOwnerRoot(repoRoot, false);
  const names = workspaceOwnerPublicationTempNames(root, physicalOwnerId);
  if (names.length === 0) return null;
  const receipts = names.map((name) => readWorkspaceOwnerTemp(
    repoRoot, root, name, physicalOwnerId,
  ));
  if (receipts.some((receipt) => receipt === null)
    || new Set(receipts.map((receipt) => receipt.receiptDigest)).size !== 1) {
    throw new WorkspaceOwnerDiagnostic(
      'physical workspace owner publication temp is invalid or ambiguous',
      'workspace_owner_receipt_invalid',
    );
  }
  return receipts[0];
}

function cleanupWorkspaceOwnerPublicationTemps(
  repoRoot, physicalOwnerId, { strict = false } = {},
) {
  const root = workspaceOwnerRoot(repoRoot, false);
  if (!root || !existsSync(root)) return;
  const names = workspaceOwnerPublicationTempNames(root, physicalOwnerId);
  let removed = false;
  for (const name of names) {
    const candidate = join(root, name);
    try {
      if (!readWorkspaceOwnerTemp(repoRoot, root, name, physicalOwnerId)) {
        throw new WorkspaceOwnerDiagnostic(
          'physical workspace owner publication temp is invalid',
          'workspace_owner_receipt_invalid',
        );
      }
      rmSync(candidate); removed = true;
    } catch (error) { if (strict) throw error; }
  }
  if (!removed) return;
  try {
    const parent = openSync(root, 'r');
    try { fsyncSync(parent); } finally { closeSync(parent); }
  } catch (error) { if (strict) throw error; }
}

function canonicalPathIncludingMissingLeaf(value) {
  let cursor = pathResolve(value); const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return pathResolve(value);
    suffix.unshift(basename(cursor)); cursor = parent;
  }
  try { return join(realpathSync(cursor), ...suffix); }
  catch { return pathResolve(value); }
}

function removeExactWorktreeRegistration(repoRoot, worktreePath) {
  const registered = listWorktrees(repoRoot).some((entry) => (
    canonicalPathIncludingMissingLeaf(entry.dir)
      === canonicalPathIncludingMissingLeaf(worktreePath)
  ));
  if (!registered) return false;
  const commonRaw = sh('git', ['rev-parse', '--git-common-dir'], repoRoot);
  const common = realpathSync(isAbsolute(commonRaw) ? commonRaw : pathResolve(repoRoot, commonRaw));
  const adminRoot = join(common, 'worktrees');
  if (!existsSync(adminRoot)) throw new WorktreeCleanupError('worktree administration root is missing');
  const rootStat = lstatSync(adminRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new WorktreeCleanupError('worktree administration root is unsafe');
  }
  const expectedGitFile = canonicalPathIncludingMissingLeaf(join(worktreePath, '.git'));
  const matches = [];
  for (const name of readdirSync(adminRoot)) {
    const admin = join(adminRoot, name);
    try {
      const stat = lstatSync(admin);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      const gitdirFile = join(admin, 'gitdir');
      const gitdirStat = lstatSync(gitdirFile);
      if (!gitdirStat.isFile() || gitdirStat.isSymbolicLink() || gitdirStat.size > 64 * 1024) continue;
      const raw = readFileSync(gitdirFile, 'utf8').trim();
      if (!raw || raw.includes('\0')) continue;
      const observed = canonicalPathIncludingMissingLeaf(
        isAbsolute(raw) ? raw : pathResolve(admin, raw),
      );
      if (observed === expectedGitFile) matches.push(admin);
    } catch { /* unrelated or concurrently removed administration */ }
  }
  if (matches.length !== 1) {
    throw new WorktreeCleanupError('exact worktree administration is ambiguous');
  }
  rmSync(matches[0], { recursive: true });
  const parent = openSync(adminRoot, 'r');
  try { fsyncSync(parent); } finally { closeSync(parent); }
  if (listWorktrees(repoRoot).some((entry) => (
    canonicalPathIncludingMissingLeaf(entry.dir)
      === canonicalPathIncludingMissingLeaf(worktreePath)
  ))) throw new WorktreeCleanupError('exact worktree administration remained after cleanup');
  return true;
}

function recoverWorkspaceOwnerPublication(repoRoot, root, binding, authority) {
  const candidates = new Map();
  for (const name of readdirSync(root).sort()) {
    const match = /^(ws-[a-f0-9]{32})\.json(?:\.tmp-[A-Za-z0-9-]+)?$/u.exec(name);
    if (!match) continue;
    const physicalOwnerId = match[1];
    let receipt = null;
    if (name === `${physicalOwnerId}.json`) {
      try { receipt = readWorkspaceOwnerReceipt(repoRoot, physicalOwnerId); } catch { continue; }
    } else receipt = readWorkspaceOwnerTemp(repoRoot, root, name, physicalOwnerId);
    if (!receipt || !receiptMatchesAllocation(receipt, binding, authority)) continue;
    const prior = candidates.get(physicalOwnerId) ?? { receipt, temps: [] };
    if (name !== `${physicalOwnerId}.json`) prior.temps.push(join(root, name));
    candidates.set(physicalOwnerId, prior);
  }
  if (candidates.size === 0) return null;
  if (candidates.size !== 1) {
    throw new WorkspaceOwnerDiagnostic(
      'more than one exact physical workspace owner allocation is retained',
      'workspace_owner_allocation_ambiguous',
    );
  }
  const [physicalOwnerId, candidate] = [...candidates.entries()][0];
  const finalPath = join(root, `${physicalOwnerId}.json`);
  try {
    if (!existsSync(finalPath)) linkSync(candidate.temps[0], finalPath);
    const durable = readWorkspaceOwnerReceipt(repoRoot, physicalOwnerId);
    if (!durable || !receiptMatchesAllocation(durable, binding, authority)) {
      throw new WorkspaceOwnerDiagnostic(
        'retained physical workspace owner publication does not match its allocation',
        'workspace_owner_publication_unknown',
      );
    }
    const parent = openSync(root, 'r');
    try { fsyncSync(parent); } finally { closeSync(parent); }
    cleanupWorkspaceOwnerPublicationTemps(repoRoot, physicalOwnerId);
    return durable;
  } catch (error) {
    throw Object.assign(new WorkspaceOwnerDiagnostic(
      'physical workspace owner publication outcome is unknown',
      'workspace_owner_publication_unknown',
    ), {
      cause: error, physicalOwnerId, ownerReceipt: candidate.receipt,
    });
  }
}

function ownerProcessStart(pid) {
  try {
    const observed = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8', maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1_000,
    }).trim();
    return observed && Buffer.byteLength(observed) <= 256 ? observed : null;
  } catch { return null; }
}

function workspaceOwnerAuthorityState(receipt, authority) {
  if (authority && receipt.deploymentId === authority.deploymentId) {
    return receipt.controllerId === authority.controllerId ? 'current' : 'local_dead';
  }
  let alive = false;
  try { process.kill(receipt.controller.pid, 0); alive = true; }
  catch (error) {
    if (error?.code === 'EPERM') alive = true;
    else if (error?.code !== 'ESRCH') return 'ambiguous_foreign';
  }
  if (!alive) return 'dead_foreign';
  const observed = ownerProcessStart(receipt.controller.pid);
  if (observed === null) return 'ambiguous_foreign';
  return observed === receipt.controller.pidStart ? 'live_foreign' : 'dead_foreign';
}

function expectedWorkspaceOwnerBindingCode(receipt, binding, expectationId, handleRunId) {
  if (!receipt) return 'workspace_owner_receipt_missing';
  if (expectationId !== receipt.attemptId || handleRunId !== receipt.runId) {
    return 'workspace_owner_handle_mismatch';
  }
  const fields = [
    'attemptId', 'baseSha', 'branch', 'logicalTaskId', 'ownerBound', 'physicalOwnerId',
    'processGeneration', 'receiptDigest', 'runId', 'worktree',
  ];
  const ownerBoundFields = [
    'attemptId', 'baseSha', 'branch', 'controllerId', 'deploymentId', 'logicalTaskId',
    'physicalOwnerId', 'processGeneration', 'receiptDigest', 'runId', 'schemaVersion', 'worktree',
  ];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).sort().join(',') !== fields.sort().join(',')
    || !binding.ownerBound || typeof binding.ownerBound !== 'object' || Array.isArray(binding.ownerBound)
    || Object.keys(binding.ownerBound).sort().join(',') !== ownerBoundFields.sort().join(',')) {
    return 'workspace_owner_binding_missing';
  }
  const expected = {
    physicalOwnerId: receipt.physicalOwnerId,
    receiptDigest: receipt.receiptDigest,
    logicalTaskId: receipt.logicalTaskId,
    runId: receipt.runId,
    attemptId: receipt.attemptId,
    processGeneration: receipt.processGeneration,
    branch: receipt.branch,
    worktree: receipt.worktree,
    baseSha: receipt.baseSha,
  };
  const observed = {
    physicalOwnerId: binding.physicalOwnerId,
    receiptDigest: binding.receiptDigest,
    logicalTaskId: binding.logicalTaskId,
    runId: binding.runId,
    attemptId: binding.attemptId,
    processGeneration: binding.processGeneration,
    branch: binding.branch,
    worktree: binding.worktree,
    baseSha: binding.baseSha,
  };
  const ownerBound = binding.ownerBound;
  const bound = {
    physicalOwnerId: ownerBound.physicalOwnerId,
    receiptDigest: ownerBound.receiptDigest,
    logicalTaskId: ownerBound.logicalTaskId,
    runId: ownerBound.runId,
    attemptId: ownerBound.attemptId,
    processGeneration: ownerBound.processGeneration,
    branch: ownerBound.branch,
    worktree: ownerBound.worktree,
    baseSha: ownerBound.baseSha,
  };
  if (!['ready', 'stopped'].includes(receipt.state)
    || canonicalDigest(observed) !== canonicalDigest(expected)
    || canonicalDigest(bound) !== canonicalDigest(expected)
    || ownerBound.schemaVersion !== 1
    || ownerBound.deploymentId !== receipt.deploymentId
    || ownerBound.controllerId !== receipt.controllerId) {
    return 'workspace_owner_binding_mismatch';
  }
  try {
    if (realpathSync(binding.worktree) !== realpathSync(receipt.worktree)) {
      return 'workspace_owner_binding_mismatch';
    }
  } catch { return 'workspace_owner_binding_mismatch'; }
  return null;
}

/** Allocate an opaque physical workspace owner before any branch/worktree effect. */
export function allocatePhysicalWorkspaceOwner(repoRoot, binding, authority) {
  const bindingFields = ['attemptId', 'baseSha', 'logicalTaskId', 'processGeneration', 'runId'];
  const authorityFields = ['controllerId', 'deploymentId', 'pid', 'pidStart'];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).sort().join(',') !== bindingFields.sort().join(',')
    || !validOwnerText(binding.logicalTaskId) || !validOwnerText(binding.runId, 4_096, true)
    || !validOwnerText(binding.attemptId) || !/^[a-f0-9]{40}$/u.test(binding.baseSha ?? '')
    || !Number.isSafeInteger(binding.processGeneration) || binding.processGeneration <= 0
    || !authority || typeof authority !== 'object' || Array.isArray(authority)
    || Object.keys(authority).sort().join(',') !== authorityFields.sort().join(',')
    || !/^[a-f0-9]{64}$/u.test(authority.deploymentId ?? '')
    || !/^[a-f0-9]{64}$/u.test(authority.controllerId ?? '')
    || !Number.isSafeInteger(authority.pid) || authority.pid <= 0
    || !validOwnerText(authority.pidStart, 256)) {
    throw new TypeError('physical workspace owner binding is invalid');
  }
  try { gitFile(['cat-file', '-e', `${binding.baseSha}^{commit}`], repoRoot, { stdio: 'ignore' }); }
  catch { throw new InvalidShaError('physical workspace owner base SHA is not an exact commit'); }
  const root = workspaceOwnerRoot(repoRoot, true);
  const recovered = recoverWorkspaceOwnerPublication(repoRoot, root, binding, authority);
  if (recovered) return recovered;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const physicalOwnerId = `ws-${randomBytes(16).toString('hex')}`;
    normalizePhysicalOwnerId(physicalOwnerId, 'physical workspace owner');
    const core = {
      schemaVersion: 1,
      physicalOwnerId,
      deploymentId: authority.deploymentId,
      controllerId: authority.controllerId,
      controller: { pid: authority.pid, pidStart: authority.pidStart },
      runId: binding.runId,
      attemptId: binding.attemptId,
      logicalTaskId: binding.logicalTaskId,
      processGeneration: binding.processGeneration,
      branch: `baton/${physicalOwnerId}`,
      worktree: pathResolve(repoRoot, '.baton', 'wt', physicalOwnerId),
      baseSha: binding.baseSha,
      state: 'allocated',
      createdAt: new Date().toISOString(),
    };
    const receipt = Object.freeze({ ...core, receiptDigest: canonicalDigest(core) });
    try {
      writePrivateJson(join(root, `${physicalOwnerId}.json`), receipt, { exclusive: true });
      return validateWorkspaceOwnerReceipt(receipt, repoRoot, physicalOwnerId);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new WorktreeAlreadyExistsError('could not allocate a collision-free physical workspace owner');
}

function updateWorkspaceOwnerState(repoRoot, physicalOwnerId, state) {
  const prior = readWorkspaceOwnerReceipt(repoRoot, physicalOwnerId);
  if (!prior) throw new WorkspaceOwnerDiagnostic('physical workspace owner receipt is absent', 'workspace_owner_receipt_absent');
  const core = { ...receiptCore(prior), state };
  const next = { ...core, receiptDigest: canonicalDigest(core) };
  writePrivateJson(workspaceOwnerReceiptPath(repoRoot, physicalOwnerId), next);
  cleanupWorkspaceOwnerPublicationTemps(repoRoot, physicalOwnerId, { strict: true });
  return validateWorkspaceOwnerReceipt(next, repoRoot, physicalOwnerId);
}

export function physicalWorkspaceOwnerReceipt(repoRoot, physicalOwnerId) {
  return readWorkspaceOwnerReceipt(repoRoot, physicalOwnerId);
}

export function physicalWorkspaceOwnerCleanupAbsent(repoRoot, physicalOwnerId) {
  try {
    normalizePhysicalOwnerId(physicalOwnerId, 'physical workspace owner');
    if (readWorkspaceOwnerReceipt(repoRoot, physicalOwnerId)
      || workspaceOwnerPublicationTempNames(
        workspaceOwnerRoot(repoRoot, false), physicalOwnerId,
      ).length > 0) return false;
    const worktree = pathResolve(repoRoot, '.baton', 'wt', physicalOwnerId);
    const registered = listWorktrees(repoRoot).some((entry) => (
      canonicalPathIncludingMissingLeaf(entry.dir) === canonicalPathIncludingMissingLeaf(worktree)
    ));
    let branchPresent = false;
    try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${physicalOwnerId}`], repoRoot); branchPresent = true; } catch { /* absent */ }
    return !existsSync(worktree) && !existsSync(`${worktree}.meta.json`)
      && !existsSync(`${worktree}.projection.exclude`) && !registered && !branchPresent;
  } catch { return false; }
}

export function releasePhysicalWorkspaceOwner(repoRoot, physicalOwnerId, opts = {}) {
  const finalPath = workspaceOwnerReceiptPath(repoRoot, physicalOwnerId);
  const receipt = readWorkspaceOwnerReceipt(repoRoot, physicalOwnerId)
    ?? readWorkspaceOwnerTempReceipt(repoRoot, physicalOwnerId);
  if (!receipt) {
    const worktree = pathResolve(repoRoot, '.baton', 'wt', physicalOwnerId);
    const registered = listWorktrees(repoRoot).some((entry) => (
      canonicalPathIncludingMissingLeaf(entry.dir) === canonicalPathIncludingMissingLeaf(worktree)
    ));
    let branchPresent = false;
    try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${physicalOwnerId}`], repoRoot); branchPresent = true; } catch { /* absent */ }
    return !existsSync(worktree) && !registered && !branchPresent;
  }
  if (opts.requireAllocated === true && receipt.state !== 'allocated') return false;
  const registered = listWorktrees(repoRoot).some((entry) => (
    canonicalPathIncludingMissingLeaf(entry.dir)
      === canonicalPathIncludingMissingLeaf(receipt.worktree)
  ));
  let branchPresent = false;
  try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/${receipt.branch}`], repoRoot); branchPresent = true; } catch { /* absent */ }
  if (existsSync(receipt.worktree) || registered || branchPresent) return false;
  cleanupWorkspaceOwnerPublicationTemps(repoRoot, physicalOwnerId, {
    strict: true,
  });
  if (existsSync(finalPath)) rmSync(finalPath);
  try { const parent = openSync(workspaceOwnerRoot(repoRoot, false), 'r'); try { fsyncSync(parent); } finally { closeSync(parent); } }
  catch { /* directory fsync is unavailable on some filesystems */ }
  return true;
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
  const excludePath = authorityChild(repoRoot, 'wt', `${taskId}.projection.exclude`, { createRoot: true, kind: 'file' });
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

const SPARSE_MAX_PATHS = 1024;
const SPARSE_MAX_PATH_BYTES = 2048;
const SPARSE_MAX_TOTAL_PATH_BYTES = 256 * 1024;
const SPARSE_MAX_DEPTH = 64;

function canonicalDigest(value) {
  const canonical = (item) => Array.isArray(item) ? item.map(canonical) : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])])) : item;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function normalizePhysicalOwnerId(value, label = 'worktree owner') {
  const folded = typeof value === 'string' ? foldCanonicalCase(value) : '';
  if (typeof value !== 'string' || value.length === 0 || Buffer.byteLength(value) > 128
    || value.normalize('NFC') !== value || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
    || value.endsWith('.') || value.includes('..') || foldCanonicalCase(value) === '.git'
    || foldCanonicalCase(value) === '.baton' || ['.lock', '.meta.json', '.projection.exclude'].some((suffix) => folded.endsWith(suffix))) throw new TypeError(`${label} must be one bounded path and ref component`);
  return value;
}

function assertNoPhysicalOwnerCollision(repoRoot, taskId) {
  const root = authorityRoot(repoRoot, 'wt', { create: false });
  if (!root) return;
  const requested = foldCanonicalCase(taskId);
  for (const entry of readdirSync(root)) {
    const candidate = entry.endsWith('.meta.json') ? entry.slice(0, -'.meta.json'.length)
      : entry.endsWith('.projection.exclude') ? entry.slice(0, -'.projection.exclude'.length) : entry;
    if (candidate !== taskId && foldCanonicalCase(candidate) === requested) {
      throw new WorktreeAlreadyExistsError(`createFromBase: worktree owner collides with existing owner "${candidate}"`);
    }
  }
}

export function normalizeSparsePaths(paths = []) {
  if (!Array.isArray(paths) || paths.length > SPARSE_MAX_PATHS) throw new TypeError('sparse checkout paths must be a bounded array');
  let totalBytes = 0;
  const normalized = paths.map((path) => {
    const bytes = typeof path === 'string' ? Buffer.byteLength(path) : 0; totalBytes += bytes;
    if (typeof path !== 'string' || path.length === 0 || bytes > SPARSE_MAX_PATH_BYTES
      || path.normalize('NFC') !== path || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)
      || isAbsolute(path) || !/^[A-Za-z0-9._/-]+$/u.test(path)) throw new TypeError('sparse checkout path must be a safe relative literal');
    const parts = path.split('/');
    if (parts.length > SPARSE_MAX_DEPTH || parts.some((part) => part === '' || part === '.' || part === '..')
      || ['.git', '.baton'].includes(foldCanonicalCase(parts[0]))) throw new TypeError('sparse checkout path escapes repository');
    return path;
  }).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (totalBytes > SPARSE_MAX_TOTAL_PATH_BYTES) throw new TypeError('sparse checkout paths exceed the aggregate byte ceiling');
  for (let index = 0; index < normalized.length; index += 1) {
    const left = foldCanonicalCase(normalized[index]);
    for (let other = index + 1; other < normalized.length; other += 1) {
      const right = foldCanonicalCase(normalized[other]);
      if (left === right || right.startsWith(`${left}/`) || left.startsWith(`${right}/`)) {
        throw new TypeError('sparse checkout paths must be unique and non-overlapping');
      }
    }
  }
  return Object.freeze(normalized);
}

export function sparseCheckoutIdentity(paths = []) {
  const normalized = normalizeSparsePaths(paths);
  const core = Object.freeze({
    schemaVersion: 1,
    mode: normalized.length === 0 ? 'full' : 'non-cone-literal',
    paths: normalized,
  });
  return Object.freeze({ ...core, digest: canonicalDigest(core) });
}

export function normalizeSparseCheckoutIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== ['digest', 'mode', 'paths', 'schemaVersion'].sort().join(',')) throw new TypeError('sparse checkout identity is invalid');
  const expected = sparseCheckoutIdentity(value.paths);
  if (value.schemaVersion !== expected.schemaVersion || value.mode !== expected.mode || value.digest !== expected.digest) throw new TypeError('sparse checkout identity is invalid');
  return expected;
}

export function sparseCheckoutCoversPath(identity, path) {
  const normalized = normalizeSparseCheckoutIdentity(identity);
  if (normalized.mode === 'full') return true;
  return normalized.paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function sameSparseIdentity(left, right) {
  try { return normalizeSparseCheckoutIdentity(left).digest === normalizeSparseCheckoutIdentity(right).digest; }
  catch { return false; }
}

function sparseError(message, code) { return new SparseCheckoutError(message, code); }

function liveSparseCheckoutIdentity(dir) {
  let enabled = false;
  try { enabled = sh('git', ['config', '--bool', 'core.sparseCheckout'], dir) === 'true'; } catch { enabled = false; }
  if (!enabled) return sparseCheckoutIdentity([]);
  let cone;
  try { cone = sh('git', ['config', '--bool', 'core.sparseCheckoutCone'], dir); } catch { cone = ''; }
  if (cone !== 'false') throw new TypeError('sparse checkout mode is not the admitted non-cone literal mode');
  const listed = gitFile(['sparse-checkout', 'list'], dir, { encoding: 'utf8' }).split('\n').filter(Boolean).map((path) => path.startsWith('/') ? path.slice(1) : path);
  return sparseCheckoutIdentity(listed);
}

function trackedPathsAtCommit(repoRoot, sha) {
  const raw = gitFile(['ls-tree', '-r', '--name-only', '-z', sha], repoRoot, { encoding: 'utf8' });
  return raw.split('\0').filter(Boolean);
}

function changedPathsFromBase(dir, baseSha) {
  const paths = new Set();
  for (const args of [
    ['diff', '--cached', '--name-only', '-z', baseSha],
    ['diff', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ]) {
    const raw = gitFile(args, dir, { encoding: 'utf8' });
    for (const path of raw.split('\0').filter(Boolean)) paths.add(path);
  }
  return [...paths].sort();
}

function assertSparseIndexState(dir, baseSha, identity) {
  const normalized = normalizeSparseCheckoutIdentity(identity);
  if (normalized.mode === 'full') return;
  const rows = gitFile(['ls-files', '-t', '-z'], dir, { encoding: 'utf8' }).split('\0').filter(Boolean);
  const states = new Map(rows.map((row) => [row.slice(2), row.slice(0, 1)]));
  for (const path of trackedPathsAtCommit(dir, baseSha)) {
    if (!sparseCheckoutCoversPath(normalized, path) && states.get(path) !== 'S') {
      throw sparseError(`sparse checkout index state escaped policy at ${path}`, 'worker_sparse_scope_violation');
    }
  }
}

function assertChangedPathsCovered(paths, identity, projectionTargets = []) {
  for (const path of paths) {
    if (projectionTargets.some((target) => path === target || path.startsWith(`${target}/`))) {
      throw new ToolchainProjectionError('toolchain projection entered the result tree', 'toolchain_projection_materialization_failed');
    }
    if (!sparseCheckoutCoversPath(identity, path)) throw sparseError(`worker change escaped sparse policy at ${path}`, 'worker_sparse_scope_violation');
  }
}

function trackedProjectionPathsAtCommit(repoRoot, sha, targetPaths) {
  if (targetPaths.length === 0) return [];
  const raw = gitFile(['ls-tree', '-r', '--name-only', '-z', sha, '--', ...targetPaths], repoRoot, { encoding: 'utf8' });
  return raw.split('\0').filter(Boolean);
}

function validatedMetadata(repoRoot, taskId) {
  const meta = readMeta(repoRoot, taskId);
  const baseFields = ['schemaVersion', 'taskId', 'branch', 'baseSha', 'createdAt', 'stoppedAt', 'copiedDependencies', 'sparsePaths', 'sparseCheckoutIdentity'];
  const projectionFields = ['toolchainProjection', 'toolchainProjectionTargets', 'projectionExclude'];
  const expectedFields = meta?.toolchainProjection ? [...baseFields, ...projectionFields] : baseFields;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)
    || Object.keys(meta).sort().join(',') !== expectedFields.sort().join(',')
    || meta.schemaVersion !== 1 || meta.taskId !== taskId || meta.branch !== `baton/${taskId}`
    || typeof meta.baseSha !== 'string' || !/^[a-f0-9]{40}$/u.test(meta.baseSha)
    || typeof meta.createdAt !== 'string' || (meta.stoppedAt !== null && typeof meta.stoppedAt !== 'string')
    || !Array.isArray(meta.copiedDependencies) || !Array.isArray(meta.sparsePaths)) throw sparseError('owned worktree metadata is missing or invalid', 'worker_sparse_metadata_invalid');
  let identity;
  try { identity = normalizeSparseCheckoutIdentity(meta.sparseCheckoutIdentity); }
  catch (cause) { throw Object.assign(sparseError('owned worktree sparse identity metadata is invalid', 'worker_sparse_metadata_invalid'), { cause }); }
  if (JSON.stringify(identity.paths) !== JSON.stringify(normalizeSparsePaths(meta.sparsePaths))) throw sparseError('owned worktree sparse metadata disagrees', 'worker_sparse_metadata_invalid');
  if (meta.toolchainProjection && (!Array.isArray(meta.toolchainProjectionTargets) || meta.projectionExclude !== `${taskId}.projection.exclude`)) throw sparseError('owned worktree projection metadata is invalid', 'worker_sparse_metadata_invalid');
  return Object.freeze({ ...meta, sparsePaths: identity.paths, sparseCheckoutIdentity: identity });
}

export function validateOwnedWorktree(repoRoot, taskId, opts = {}) {
  normalizePhysicalOwnerId(taskId, 'taskId');
  const dir = authorityChild(repoRoot, 'wt', taskId, { kind: 'directory', mustExist: true });
  if (!existsSync(dir)) throw new UnknownWorktreeError(`no owned worktree for taskId "${taskId}"`);
  const meta = validatedMetadata(repoRoot, taskId);
  const realDir = realpathSync(dir);
  if (opts.expectedPath !== undefined && realpathSync(opts.expectedPath) !== realDir) throw new UnknownWorktreeError('owned worktree path identity mismatch');
  if (realpathSync(sh('git', ['rev-parse', '--show-toplevel'], dir)) !== realDir) throw new UnknownWorktreeError('owned worktree Git root identity mismatch');
  if (sh('git', ['branch', '--show-current'], dir) !== meta.branch) throw new UnknownWorktreeError('owned worktree branch identity mismatch');
  if (opts.expectedBranch !== undefined && meta.branch !== opts.expectedBranch) throw sparseError('owned worktree branch metadata disagrees with admitted branch', 'worker_sparse_metadata_invalid');
  if (opts.expectedBaseSha !== undefined && meta.baseSha !== opts.expectedBaseSha) throw sparseError('owned worktree base metadata disagrees with admitted base', 'worker_sparse_metadata_invalid');
  try { gitFile(['merge-base', '--is-ancestor', meta.baseSha, 'HEAD'], dir, { stdio: 'ignore' }); }
  catch { throw new UnknownWorktreeError('owned worktree base identity mismatch'); }
  const expectedIdentity = opts.sparseCheckoutIdentity === undefined ? meta.sparseCheckoutIdentity : normalizeSparseCheckoutIdentity(opts.sparseCheckoutIdentity);
  if (!sameSparseIdentity(meta.sparseCheckoutIdentity, expectedIdentity)) throw sparseError('owned worktree sparse deployment identity mismatch', 'worker_sparse_projection_changed');
  let liveIdentity;
  try { liveIdentity = liveSparseCheckoutIdentity(dir); }
  catch (cause) { throw Object.assign(sparseError('owned worktree live sparse identity is invalid', 'worker_sparse_projection_changed'), { cause }); }
  if (!sameSparseIdentity(liveIdentity, expectedIdentity)) throw sparseError('owned worktree live sparse identity mismatch', 'worker_sparse_projection_changed');
  assertSparseIndexState(dir, meta.baseSha, expectedIdentity);
  return Object.freeze({ dir: realDir, meta, sparseCheckoutIdentity: expectedIdentity });
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
 * @param {{log?: object, dependencyDirs?: string[], sparsePaths?:string[], toolchainProjection?: object}} [opts]
 * @returns {Promise<{taskId:string, dir:string, branch:string, baseSha:string, createdAt:string,copiedDependencies:string[], sparsePaths:string[], toolchainProjection?: object}>}
 */
export async function createFromBase(repoRoot, taskId, baseSha, opts = {}) {
  normalizePhysicalOwnerId(taskId, 'taskId');
  const externallyOwnedReceipt = opts.ownerReceipt !== undefined;
  let ownerReceipt = null;
  if (opts.ownerReceipt !== undefined) {
    ownerReceipt = validateWorkspaceOwnerReceipt(opts.ownerReceipt, repoRoot, taskId);
    if (ownerReceipt.baseSha !== baseSha || ownerReceipt.branch !== `baton/${taskId}`
      || ownerReceipt.worktree !== pathResolve(repoRoot, '.baton', 'wt', taskId)
      || ownerReceipt.state !== 'allocated') {
      throw new WorkspaceOwnerDiagnostic('physical workspace owner receipt disagrees with creation', 'workspace_owner_receipt_mismatch');
    }
    const durable = readWorkspaceOwnerReceipt(repoRoot, taskId);
    if (!durable || durable.receiptDigest !== ownerReceipt.receiptDigest) {
      throw new WorkspaceOwnerDiagnostic('physical workspace owner receipt is not durable', 'workspace_owner_receipt_mismatch');
    }
  }
  try { gitFile(['check-ref-format', '--branch', `baton/${taskId}`], repoRoot, { stdio: 'ignore' }); }
  catch { throw new TypeError('taskId must produce one valid Baton branch ref'); }
  assertNoPhysicalOwnerCollision(repoRoot, taskId);
  const wtRoot = authorityRoot(repoRoot, 'wt', { create: true });
  const dir = join(wtRoot, taskId);
  if (existsSync(dir)) {
    throw new WorktreeAlreadyExistsError(`createFromBase: ${dir} already exists`);
  }

  // TP10: Reject mixed legacy dependency and new toolchain projection configuration
  if (opts.toolchainProjection && (opts.dependencyDirs && opts.dependencyDirs.length > 0)) {
    throw new Error('cannot combine dependencyDirs with toolchainProjection (ambiguous configuration)');
  }

  const sources = dependencySources(repoRoot, opts.dependencyDirs ?? []);
  const sparsePaths = normalizeSparsePaths(opts.sparsePaths ?? []);
  const sparseIdentity = sparseCheckoutIdentity(sparsePaths);
  const branch = `baton/${taskId}`;
  if (opts.toolchainProjection) {
    const collisions = trackedProjectionPathsAtCommit(repoRoot, baseSha, opts.toolchainProjection.targetPaths());
    if (collisions.length > 0) throw new ToolchainProjectionError('toolchain projection target is tracked by the worker base commit', 'toolchain_projection_materialization_failed');
  }
  try {
    sh('git', ['worktree', 'add', '-b', branch, ...(sparsePaths.length ? ['--no-checkout'] : []), dir, baseSha], repoRoot);
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
    if (sparsePaths.length) {
      gitFile(['sparse-checkout', 'set', '--no-cone', '--stdin'], dir, { input: `${sparsePaths.map((path) => `/${path}`).join('\n')}\n`, encoding: 'utf8' });
      gitFile(['checkout', '-q', branch], dir, { stdio: 'pipe' });
    }
    if (opts.toolchainProjection) {
      toolchainProjectionTargets = opts.toolchainProjection.targetPaths();
      projectionExcludePath = configureProjectionExcludes(repoRoot, dir, taskId, toolchainProjectionTargets);
      const result = opts.toolchainProjection.materialize(dir);
      toolchainProjection = result.identity;
      if (JSON.stringify(result.materializedTargets) !== JSON.stringify(toolchainProjectionTargets)) throw new ToolchainProjectionError('toolchain materialization is invalid', 'toolchain_projection_materialization_failed');
    } else {
      copiedDependencies = materializeDependencies(dir, sources);
    }
    const createdAt = new Date().toISOString();
    const meta = {
      schemaVersion: 1, taskId, branch, baseSha, createdAt, stoppedAt: null,
      copiedDependencies, sparsePaths: [...sparsePaths], sparseCheckoutIdentity: sparseIdentity,
    };
    if (toolchainProjection) {
      meta.toolchainProjection = toolchainProjection;
      meta.toolchainProjectionTargets = toolchainProjectionTargets;
      meta.projectionExclude = `${taskId}.projection.exclude`;
    }
    writeMeta(repoRoot, taskId, meta);
    validateOwnedWorktree(repoRoot, taskId, { expectedBaseSha: baseSha, expectedBranch: branch, sparseCheckoutIdentity: sparseIdentity });
    if (ownerReceipt) ownerReceipt = updateWorkspaceOwnerState(repoRoot, taskId, 'ready');
    logEvent(opts, taskId, 'worktree.created', {
      dir, branch, baseSha, copiedDependencies, sparsePaths: [...sparsePaths], sparseCheckoutIdentity: sparseIdentity,
      ...(ownerReceipt ? { ownerReceiptDigest: ownerReceipt.receiptDigest } : {}),
      ...(toolchainProjection ? { toolchainProjection } : {}),
    });
    return {
      taskId, dir, branch, baseSha, createdAt, copiedDependencies, sparsePaths: [...sparsePaths], sparseCheckoutIdentity: sparseIdentity,
      ...(ownerReceipt ? { ownerReceipt } : {}),
      ...(toolchainProjection ? { toolchainProjection } : {}),
    };
  } catch (err) {
    // A caller-supplied owner receipt makes creation one outer transaction. In particular, the
    // capacity authority must settle before any checkout, branch, administration, metadata, or
    // receipt is removed. Leave every possible post-add effect for that caller's exact reap.
    if (!externallyOwnedReceipt) {
      try { sh('git', ['worktree', 'remove', '--force', dir], repoRoot); }
      catch { rmSync(dir, { recursive: true, force: true }); }
      try { sh('git', ['branch', '-D', branch], repoRoot); } catch { /* best-effort */ }
      try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* best-effort */ }
      if (projectionExcludePath) rmSync(projectionExcludePath, { force: true });
      rmSync(metaPathFor(repoRoot, taskId), { force: true });
      if (ownerReceipt) releasePhysicalWorkspaceOwner(repoRoot, taskId, { requireAllocated: true });
    }
    throw err;
  }
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
  normalizePhysicalOwnerId(taskId, 'taskId');
  const owned = validateOwnedWorktree(repoRoot, taskId, {
    ...(opts.expectedWorktreePath ? { expectedPath: opts.expectedWorktreePath } : {}),
    ...(opts.expectedBaseSha ? { expectedBaseSha: opts.expectedBaseSha } : {}),
    ...(opts.expectedBranch ? { expectedBranch: opts.expectedBranch } : {}),
    ...(opts.sparseCheckoutIdentity ? { sparseCheckoutIdentity: opts.sparseCheckoutIdentity } : {}),
  });
  const { dir, meta } = owned;
  const projectionTargets = meta.toolchainProjectionTargets ?? [];
  if (opts.toolchainProjectionTargets && JSON.stringify([...opts.toolchainProjectionTargets].sort()) !== JSON.stringify([...projectionTargets].sort())) throw new ToolchainProjectionError('toolchain projection target authority mismatch', 'toolchain_projection_materialization_failed');
  if (trackedProjectionPaths(dir, projectionTargets).length > 0) throw new ToolchainProjectionError('toolchain projection entered the result index', 'toolchain_projection_materialization_failed');
  assertChangedPathsCovered(changedPathsFromBase(dir, meta.baseSha), owned.sparseCheckoutIdentity, projectionTargets);

  let snapshotted = false;
  if (!isClean(dir)) {
    let staged = false;
    try {
      sh('git', ['add', '-A'], dir); staged = true;
      validateOwnedWorktree(repoRoot, taskId, {
        expectedPath: dir, expectedBaseSha: opts.expectedBaseSha ?? meta.baseSha,
        expectedBranch: opts.expectedBranch ?? meta.branch, sparseCheckoutIdentity: owned.sparseCheckoutIdentity,
      });
      if (trackedProjectionPaths(dir, projectionTargets).length > 0) throw new ToolchainProjectionError('toolchain projection entered the result index', 'toolchain_projection_materialization_failed');
      const changedPaths = changedPathsFromBase(dir, meta.baseSha);
      assertChangedPathsCovered(changedPaths, owned.sparseCheckoutIdentity, projectionTargets);
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
    } catch (error) {
      if (staged) try { gitFile(['reset', '-q'], dir, { stdio: 'ignore' }); } catch { /* refusal remains authoritative */ }
      throw error;
    }
  }
  const sha = sh('git', ['rev-parse', 'HEAD'], dir);
  const changedPaths = changedPathsFromBase(dir, meta.baseSha);
  assertChangedPathsCovered(changedPaths, owned.sparseCheckoutIdentity, projectionTargets);
  validateOwnedWorktree(repoRoot, taskId, {
    expectedPath: dir, expectedBaseSha: opts.expectedBaseSha ?? meta.baseSha,
    expectedBranch: opts.expectedBranch ?? meta.branch, sparseCheckoutIdentity: owned.sparseCheckoutIdentity,
  });
  logEvent(opts, taskId, 'worktree.captured', { sha, snapshotted, baseSha: meta.baseSha, changedPaths, sparseCheckoutIdentity: owned.sparseCheckoutIdentity });
  return { sha, snapshotted, baseSha: meta.baseSha, changedPaths, sparseCheckoutIdentity: owned.sparseCheckoutIdentity };
}

// ---------------------------------------------------------------------------
// Structured integration staging (Phase 26 SM1-SM9)
// ---------------------------------------------------------------------------

const CONFLICT_MARKER = /(?:<{7,}|\|{7,}|={7,}|>{7,})/;

function integrationRoot(repoRoot, create = false) { return authorityRoot(repoRoot, 'integrate', { create }); }

export async function removeStructuredIntegration(repoRoot, stage) {
  const dir = typeof stage === 'string' ? stage : stage?.stagePath;
  if (typeof dir === 'string' && dir.length > 0) {
    const confined = validateOwnedAuthorityPath(repoRoot, 'integrate', dir, { kind: 'directory', mustExist: true });
    try { sh('git', ['worktree', 'remove', '--force', confined], repoRoot); } catch { rmSync(confined, { recursive: true, force: true }); }
  }
  try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* best effort */ }
  const root = integrationRoot(repoRoot);
  try { if (existsSync(root) && readdirSync(root).length === 0) rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
}

export async function stageStructuredIntegration(repoRoot, taskId, resultSha, opts = {}) {
  normalizePhysicalOwnerId(taskId, 'structured integration taskId');
  ensureBatonExcluded(repoRoot);
  if (!isClean(repoRoot)) throw mergeError('structured integration requires a clean main checkout', 'structured_main_dirty');
  let rightSha;
  try { rightSha = sh('git', ['rev-parse', '--verify', `${resultSha}^{commit}`], repoRoot); }
  catch (error) { throw mergeError('structured integration result is not a commit', 'structured_invalid_result', error); }
  const beforeSha = sh('git', ['rev-parse', 'HEAD'], repoRoot);
  try { sh('git', ['merge-base', '--is-ancestor', rightSha, beforeSha], repoRoot); throw mergeError('structured integration result is already contained by main', 'structured_already_integrated'); }
  catch (error) { if (error?.code === 'structured_already_integrated') throw error; }
  const mergeBaseSha = sh('git', ['merge-base', beforeSha, rightSha], repoRoot);
  const root = integrationRoot(repoRoot, true);
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
  normalizePhysicalOwnerId(label, 'verification label');
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
  const sparsePaths = normalizeSparsePaths(opts.sparsePaths ?? []);
  const sparseIdentity = sparseCheckoutIdentity(sparsePaths);
  if (Array.isArray(opts.requiredPaths)) assertChangedPathsCovered(opts.requiredPaths, sparseIdentity, []);
  if (opts.toolchainProjection) {
    const collisions = trackedProjectionPathsAtCommit(repoRoot, fullSha, opts.toolchainProjection.targetPaths());
    if (collisions.length > 0) throw new ToolchainProjectionError('toolchain projection target is tracked by the verification commit', 'toolchain_projection_materialization_failed');
  }

  const verifyRoot = authorityRoot(repoRoot, 'verify', { create: true });
  const suffix = randomBytes(4).toString('hex');
  const dir = join(verifyRoot, `${label}-${suffix}`);
  let registered = false;
  let cleanupPromise = null;

  const cleanup = () => {
    if (!cleanupPromise) cleanupPromise = (async () => {
      if (!existsSync(repoRoot)) {
        registered = false;
        return;
      }
      const present = existsSync(dir);
      const administrativelyRegistered = registered && listWorktrees(repoRoot)
        .some((entry) => pathResolve(entry.dir) === pathResolve(dir));
      if (present || administrativelyRegistered) {
        if (present) authorityChild(repoRoot, 'verify', basename(dir), { kind: 'directory', mustExist: true });
        try {
          sh('git', ['worktree', 'remove', '--force', dir], repoRoot);
        } catch (error) {
          if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
          try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* exact postcheck below */ }
          const stillRegistered = listWorktrees(repoRoot)
            .some((entry) => pathResolve(entry.dir) === pathResolve(dir));
          if (stillRegistered) throw new WorktreeCleanupError(
            'verification sandbox administration could not be removed', { cause: error },
          );
        }
      }
      registered = false;
      try { sh('git', ['worktree', 'prune'], repoRoot); }
      catch (error) { throw new WorktreeCleanupError('verification sandbox administration could not be pruned', { cause: error }); }
      if (existsSync(dir) || listWorktrees(repoRoot)
        .some((entry) => pathResolve(entry.dir) === pathResolve(dir))) {
        throw new WorktreeCleanupError('verification sandbox cleanup did not reach an exact absent state');
      }
    })();
    return cleanupPromise;
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
    const liveIdentity = liveSparseCheckoutIdentity(dir);
    if (!sameSparseIdentity(liveIdentity, sparseIdentity)) throw new TypeError('verification sparse checkout identity mismatch');
    assertSparseIndexState(dir, fullSha, sparseIdentity);

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

  logEvent(opts, 'worktree', 'worktree.verify_sandbox_created', { dir, sha: fullSha, label, copiedDependencies, sparsePaths, sparseCheckoutIdentity: sparseIdentity, ...(toolchainProjection ? { toolchainProjection } : {}) });
  return { dir, sha: fullSha, copiedDependencies, sparsePaths, sparseCheckoutIdentity: sparseIdentity, ...(toolchainProjection ? { toolchainProjection } : {}), cleanup };
}

// ---------------------------------------------------------------------------
// markStopped
// ---------------------------------------------------------------------------

/** @param {string} repoRoot @param {string} taskId @returns {Promise<void>} */
export async function markStopped(repoRoot, taskId) {
  normalizePhysicalOwnerId(taskId, 'taskId');
  const meta = { ...validatedMetadata(repoRoot, taskId) };
  meta.stoppedAt = new Date().toISOString();
  writeMeta(repoRoot, taskId, meta);
  try { if (readWorkspaceOwnerReceipt(repoRoot, taskId)) updateWorkspaceOwnerState(repoRoot, taskId, 'stopped'); }
  catch (error) { throw Object.assign(new WorktreeCleanupError('physical workspace owner could not be stopped'), { cause: error }); }
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
  normalizePhysicalOwnerId(taskId, 'taskId');
  const root = authorityRoot(repoRoot, 'wt', { create: false });
  const dir = join(root ?? join(realpathSync(repoRoot), '.baton', 'wt'), taskId);
  const metaFile = join(root ?? dirname(dir), `${taskId}.meta.json`);
  const projectionExclude = join(root ?? dirname(dir), `${taskId}.projection.exclude`);
  if (existsSync(dir)) {
    authorityChild(repoRoot, 'wt', taskId, { kind: 'directory', mustExist: true });
    const meta = readMeta(repoRoot, taskId);
    const stopped = !!meta?.stoppedAt;
    if (!stopped && !opts.force) {
      throw new WorktreeLockedError(`reap: worktree "${taskId}" was never markStopped (pass {force:true} to override)`);
    }
    try { sh('git', ['worktree', 'remove', '--force', dir], repoRoot); }
    catch { rmSync(dir, { recursive: true, force: true }); }
  }
  // A missing directory may still retain Git administration. Remove only the exact path-bound
  // registration; a global prune could destroy another owner's pre-settlement authority.
  try { removeExactWorktreeRegistration(repoRoot, dir); }
  catch (error) { throw Object.assign(new WorktreeCleanupError('owned worktree administration could not be removed'), { cause: error }); }
  if (opts.deleteBranch) {
    try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); sh('git', ['branch', '-D', `baton/${taskId}`], repoRoot); }
    catch {
      // A failed existence probe is the idempotent absent case. A surviving ref below is red.
    }
  }
  if (existsSync(metaFile)) rmSync(authorityChild(repoRoot, 'wt', `${taskId}.meta.json`, { kind: 'file', mustExist: true }), { force: true });
  if (existsSync(projectionExclude)) rmSync(authorityChild(repoRoot, 'wt', `${taskId}.projection.exclude`, { kind: 'file', mustExist: true }), { force: true });
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
  try { releasePhysicalWorkspaceOwner(repoRoot, taskId); }
  catch (error) { throw Object.assign(new WorktreeCleanupError('physical workspace owner receipt could not be released'), { cause: error }); }
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
  const report = {
    prunedAdminEntries: [], removedZombieDirs: [], removedIntegrationDirs: [],
    removedVerifyDirs: [], validatedExpectedOwners: [], retainedExpectedOwners: [],
    validatedExpectedBindings: [], retainedExpectedBindings: [],
    removedPhysicalOwners: [],
    // Receipt-only-loop records retained as ambiguous residue (rule 2's refusal set): the open
    // must fail on these. Loop-1 (checkout-present) records with the same diagnostic code proceed,
    // so the loop origin — known only here — is what the facade keys its refusal on.
    receiptOnlyRefusals: [],
    diagnostics: [], errors: [],
  };
  let registrationsBeforePrune = [];
  try { registrationsBeforePrune = listWorktrees(repoRoot); }
  catch (err) { report.errors.push(`registration-scan: ${err.message || err}`); }
  // Structured integration is never resumed after coordinator restart: without an in-memory
  // operation holding the freshly observed verification verdict, a candidate is evidence only.
  // Reap every detached stage and require a new attempt to reconstruct and reverify it.
  let mergeRoot = null;
  try { mergeRoot = authorityRoot(repoRoot, 'integrate', { create: false }); }
  catch (err) { report.errors.push(`integrate-root: ${err.message || err}`); }
  if (mergeRoot) {
    for (const entry of readdirSync(mergeRoot)) {
      const fullDir = join(mergeRoot, entry);
      let isDir = false; try { isDir = lstatSync(fullDir).isDirectory() && !lstatSync(fullDir).isSymbolicLink(); } catch { continue; }
      if (!isDir) continue;
      try {
        authorityChild(repoRoot, 'integrate', entry, { kind: 'directory', mustExist: true });
        try { sh('git', ['worktree', 'remove', '--force', fullDir], repoRoot); }
        catch { rmSync(fullDir, { recursive: true, force: true }); }
        removeExactWorktreeRegistration(repoRoot, fullDir);
        report.removedIntegrationDirs.push(fullDir);
        logEvent(opts, entry, 'worktree.integration_reconciled', { dir: fullDir });
      } catch (err) { report.errors.push(`${entry}: ${err.message || err}`); }
    }
    try { if (readdirSync(mergeRoot).length === 0) rmSync(mergeRoot, { recursive: true, force: true }); } catch (err) { report.errors.push(`integration-root: ${err.message || err}`); }
  }

  const expected = new Set(expectedActiveTaskIds);
  const expectedBindings = new Map();
  for (const entry of (opts.expectedOwnerBindings ?? [])) {
    if (!entry || typeof entry !== 'object' || typeof entry.physicalOwnerId !== 'string') continue;
    const rows = expectedBindings.get(entry.physicalOwnerId) ?? [];
    rows.push({
      expectationId: entry.expectationId ?? null,
      handleRunId: entry.handleRunId ?? null,
      binding: entry.binding ?? null,
    });
    expectedBindings.set(entry.physicalOwnerId, rows);
  }
  const retainExpected = (physicalOwnerId) => {
    if (!report.retainedExpectedOwners.includes(physicalOwnerId)) {
      report.retainedExpectedOwners.push(physicalOwnerId);
    }
    for (const row of (expectedBindings.get(physicalOwnerId) ?? [])) {
      if (typeof row.expectationId === 'string'
        && !report.retainedExpectedBindings.includes(row.expectationId)) {
        report.retainedExpectedBindings.push(row.expectationId);
      }
    }
  };
  const localWorkerCandidates = new Set();

  // Publication temps carry the exact opaque owner and controller tuple. They are authority,
  // not disposable scratch: include temp-only response-loss records in the same capacity-gated
  // reconciliation transaction as final receipts.
  try {
    const publicationRoot = workspaceOwnerRoot(repoRoot, false);
    if (publicationRoot && existsSync(publicationRoot)) {
      for (const name of readdirSync(publicationRoot)) {
        const match = /^(ws-[a-f0-9]{32})\.json\.tmp-[A-Za-z0-9-]+$/u.exec(name);
        if (match) localWorkerCandidates.add(match[1]);
      }
    }
  } catch (err) { report.errors.push(`receipt-temp-scan: ${err.message || err}`); }

  let wtRoot = null;
  try { wtRoot = authorityRoot(repoRoot, 'wt', { create: false }); }
  catch (err) { report.errors.push(`wt-root: ${err.message || err}`); }
  {
    const candidates = localWorkerCandidates;
    if (wtRoot) {
    for (const entry of readdirSync(wtRoot)) {
      if (entry.endsWith('.meta.json')) candidates.add(entry.slice(0, -'.meta.json'.length));
      else if (entry.endsWith('.projection.exclude')) candidates.add(entry.slice(0, -'.projection.exclude'.length));
      else {
        try { if (lstatSync(join(wtRoot, entry)).isDirectory() && !lstatSync(join(wtRoot, entry)).isSymbolicLink()) candidates.add(entry); } catch { /* inspected below if represented by metadata */ }
      }
    }
    }
    const workerRoot = pathResolve(repoRoot, '.baton', 'wt');
    for (const entry of registrationsBeforePrune) {
      const relative = pathRelative(workerRoot, pathResolve(entry.dir));
      if (relative !== '' && relative !== '..' && !relative.startsWith(`..${sep}`) && !isAbsolute(relative) && !relative.includes(sep)) candidates.add(relative);
    }
    for (const taskId of candidates) {
      let normalizedTaskId;
      try { normalizedTaskId = normalizePhysicalOwnerId(taskId, 'reconciled taskId'); }
      catch (err) { report.errors.push(`${taskId}: ${err.message || err}`); continue; }
      const baseRoot = wtRoot ?? join(realpathSync(repoRoot), '.baton', 'wt');
      const fullDir = join(baseRoot, normalizedTaskId); const metaFile = join(baseRoot, `${normalizedTaskId}.meta.json`); const projectionExclude = join(baseRoot, `${normalizedTaskId}.projection.exclude`);
      let ownerReceipt = null; let ownerState = null;
      try {
        ownerReceipt = readWorkspaceOwnerReceipt(repoRoot, normalizedTaskId);
        if (!ownerReceipt) ownerReceipt = readWorkspaceOwnerTempReceipt(
          repoRoot, normalizedTaskId,
        );
        if (ownerReceipt) ownerState = workspaceOwnerAuthorityState(ownerReceipt, opts.ownerAuthority);
      } catch (error) {
        report.diagnostics.push(Object.freeze({
          code: error?.code ?? 'workspace_owner_ambiguous', physicalOwnerId: normalizedTaskId,
          authority: 'ambiguous', retained: true,
        }));
        if (expected.has(taskId)) retainExpected(normalizedTaskId);
        continue;
      }
      // An expected-owner list is liveness input, not a transferable cleanup capability. A
      // foreign receipt remains authoritative even if a caller names its opaque owner or its
      // local metadata fails this deployment's sparse-policy validation.
      if (ownerReceipt && ['live_foreign', 'ambiguous_foreign', 'dead_foreign'].includes(ownerState)) {
        report.diagnostics.push(Object.freeze({
          code: ownerState === 'live_foreign' ? 'workspace_owner_live_foreign'
            : ownerState === 'dead_foreign' ? 'workspace_owner_dead_foreign_checkout'
              : 'workspace_owner_ambiguous_foreign',
          physicalOwnerId: normalizedTaskId, deploymentId: ownerReceipt.deploymentId,
          logicalTaskId: ownerReceipt.logicalTaskId, authority: ownerState, retained: true,
        }));
        if (expected.has(taskId)) retainExpected(normalizedTaskId);
        continue;
      }
      let expectedBindingValid = false;
      let expectedBindingId = null;
      if (expected.has(taskId) && /^ws-[a-f0-9]{32}$/u.test(normalizedTaskId)) {
        const expectedRows = expectedBindings.get(normalizedTaskId) ?? [];
        if (expectedRows.length !== 1 || typeof expectedRows[0].expectationId !== 'string') {
          report.diagnostics.push(Object.freeze({
            code: 'workspace_owner_binding_ambiguous', physicalOwnerId: normalizedTaskId,
            deploymentId: ownerReceipt?.deploymentId ?? null,
            logicalTaskId: ownerReceipt?.logicalTaskId ?? null,
            authority: ownerReceipt ? ownerState : 'unproven', retained: true,
          }));
          retainExpected(normalizedTaskId);
          continue;
        }
        const bindingCode = expectedWorkspaceOwnerBindingCode(
          ownerReceipt, expectedRows[0].binding,
          expectedRows[0].expectationId, expectedRows[0].handleRunId,
        );
        if (bindingCode) {
          report.diagnostics.push(Object.freeze({
            code: bindingCode, physicalOwnerId: normalizedTaskId,
            expectationId: expectedRows[0].expectationId,
            deploymentId: ownerReceipt?.deploymentId ?? null,
            logicalTaskId: ownerReceipt?.logicalTaskId ?? null,
            authority: ownerReceipt ? ownerState : 'unproven', retained: true,
          }));
          retainExpected(normalizedTaskId);
          continue;
        }
        expectedBindingValid = true;
        expectedBindingId = expectedRows[0].expectationId;
      }
      if (expected.has(taskId) && existsSync(fullDir)) {
        try {
          validateOwnedWorktree(repoRoot, taskId, {
            ...(ownerReceipt ? {
              expectedPath: ownerReceipt.worktree,
              expectedBaseSha: ownerReceipt.baseSha,
              expectedBranch: ownerReceipt.branch,
            } : {}),
            ...(opts.sparseCheckoutIdentity ? { sparseCheckoutIdentity: opts.sparseCheckoutIdentity } : {}),
          });
          if (expectedBindingValid) {
            report.validatedExpectedOwners.push(normalizedTaskId);
            report.validatedExpectedBindings.push(expectedBindingId);
          }
          continue;
        } catch {
          if (/^ws-[a-f0-9]{32}$/u.test(normalizedTaskId)) {
            report.diagnostics.push(Object.freeze({
              code: 'workspace_owner_checkout_invalid', physicalOwnerId: normalizedTaskId,
              expectationId: expectedBindingId,
              deploymentId: ownerReceipt?.deploymentId ?? null,
              logicalTaskId: ownerReceipt?.logicalTaskId ?? null,
              authority: ownerReceipt ? ownerState : 'unproven', retained: true,
            }));
            retainExpected(normalizedTaskId);
            continue;
          }
          // Legacy logical worktree ownership retains the pre-Phase-92 quarantine behavior.
        }
      }
      if (expected.has(taskId) && /^ws-[a-f0-9]{32}$/u.test(normalizedTaskId)
        && !existsSync(fullDir)) {
        report.diagnostics.push(Object.freeze({
          code: 'workspace_owner_checkout_missing', physicalOwnerId: normalizedTaskId,
          deploymentId: ownerReceipt?.deploymentId ?? null,
          logicalTaskId: ownerReceipt?.logicalTaskId ?? null,
          authority: ownerReceipt ? ownerState : 'unproven', retained: true,
        }));
        retainExpected(normalizedTaskId);
        continue;
      }
      if (/^ws-[a-f0-9]{32}$/u.test(normalizedTaskId)) {
        if (!ownerReceipt) {
          report.diagnostics.push(Object.freeze({
            code: 'workspace_owner_receipt_missing', physicalOwnerId: normalizedTaskId,
            authority: 'unproven', retained: true,
          }));
          continue;
        }
        try {
          if (opts.beforeOwnerCleanup
            && opts.beforeOwnerCleanup(normalizedTaskId, ownerReceipt) !== true) {
            throw Object.assign(new Error('capacity settlement was not confirmed'), {
              code: 'workspace_owner_capacity_settlement_refused',
            });
          }
        } catch (error) {
          report.diagnostics.push(Object.freeze({
            code: error?.code === 'workspace_owner_capacity_settlement_refused'
              ? error.code : 'workspace_owner_capacity_settlement_failed',
            physicalOwnerId: normalizedTaskId, deploymentId: ownerReceipt.deploymentId,
            logicalTaskId: ownerReceipt.logicalTaskId, authority: ownerState, retained: true,
          }));
          continue;
        }
      }
      try {
        const hadDir = existsSync(fullDir); const hadResidue = hadDir || existsSync(metaFile) || existsSync(projectionExclude);
        if (hadDir) {
          authorityChild(repoRoot, 'wt', normalizedTaskId, { kind: 'directory', mustExist: true });
          try { sh('git', ['worktree', 'remove', '--force', fullDir], repoRoot); }
          catch { rmSync(fullDir, { recursive: true, force: true }); }
        }
        removeExactWorktreeRegistration(repoRoot, fullDir);
        if (existsSync(metaFile)) rmSync(authorityChild(repoRoot, 'wt', `${normalizedTaskId}.meta.json`, { kind: 'file', mustExist: true }), { force: true });
        if (existsSync(projectionExclude)) rmSync(authorityChild(repoRoot, 'wt', `${normalizedTaskId}.projection.exclude`, { kind: 'file', mustExist: true }), { force: true });
        let branchPresent = false;
        try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); branchPresent = true; } catch { /* absent */ }
        const hadBranch = branchPresent;
        if (branchPresent) sh('git', ['branch', '-D', `baton/${taskId}`], repoRoot);
        try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); branchPresent = true; } catch { branchPresent = false; }
        if (existsSync(fullDir) || existsSync(metaFile) || existsSync(projectionExclude) || branchPresent) throw new WorktreeCleanupError('reconciled worker ownership remained after cleanup');
        if (hadDir) report.removedZombieDirs.push(fullDir);
        if (hadResidue || hadBranch) logEvent(opts, taskId, 'worktree.reconciled', { dir: fullDir });
        if (ownerReceipt) {
          if (!releasePhysicalWorkspaceOwner(repoRoot, normalizedTaskId)) {
            throw new WorktreeCleanupError('reconciled physical owner receipt remained');
          }
          report.removedPhysicalOwners.push(normalizedTaskId);
        }
      } catch (err) {
        report.errors.push(`${taskId}: ${err.message || err}`);
      }
    }
  }

  // A crash can leave only the pre-effect receipt and its branch: no local checkout directory,
  // no metadata, and no Git worktree registration. The shared common-Git receipt is the sole
  // authority that makes this residue attributable. Reap it only when its exact controller is
  // locally proven dead; live and observation-ambiguous foreign owners remain untouched.
  let receiptRoot = null;
  try { receiptRoot = workspaceOwnerRoot(repoRoot, false); } catch { /* non-Git already failed above */ }
  if (receiptRoot && existsSync(receiptRoot)) {
    const registered = listWorktrees(repoRoot);
    for (const name of readdirSync(receiptRoot).filter((entry) => entry.endsWith('.json')).sort()) {
      const physicalOwnerId = name.slice(0, -'.json'.length);
      if (localWorkerCandidates.has(physicalOwnerId)) continue;
      let receipt;
      try { receipt = readWorkspaceOwnerReceipt(repoRoot, physicalOwnerId); }
      catch (error) {
        report.diagnostics.push(Object.freeze({
          code: error?.code ?? 'workspace_owner_receipt_invalid', physicalOwnerId,
          authority: 'ambiguous', retained: true,
        }));
        // A structurally sound receipt bound to a foreign controller's root is retained-and-proceeds
        // (rule 4); only genuine corruption or this-repo orphan residue is refusal-set (rule 2).
        if (expected.has(physicalOwnerId)) retainExpected(physicalOwnerId);
        else if (!foreignConsistentReceipt(repoRoot, physicalOwnerId)) {
          report.receiptOnlyRefusals.push(physicalOwnerId);
        }
        continue;
      }
      if (!receipt) continue;
      if (expected.has(physicalOwnerId)) {
        report.diagnostics.push(Object.freeze({
          code: 'workspace_owner_checkout_missing', physicalOwnerId,
          deploymentId: receipt.deploymentId, logicalTaskId: receipt.logicalTaskId,
          authority: workspaceOwnerAuthorityState(receipt, opts.ownerAuthority), retained: true,
        }));
        retainExpected(physicalOwnerId);
        continue;
      }
      const isRegistered = registered.some((entry) => pathResolve(entry.dir) === receipt.worktree);
      if (existsSync(receipt.worktree) || isRegistered) {
        report.diagnostics.push(Object.freeze({
          code: 'workspace_owner_foreign_checkout_retained', physicalOwnerId,
          deploymentId: receipt.deploymentId, logicalTaskId: receipt.logicalTaskId,
          authority: workspaceOwnerAuthorityState(receipt, opts.ownerAuthority), retained: true,
        }));
        continue;
      }
      const authority = workspaceOwnerAuthorityState(receipt, opts.ownerAuthority);
      if (!['local_dead', 'dead_foreign'].includes(authority)) {
        report.diagnostics.push(Object.freeze({
          code: authority === 'live_foreign' ? 'workspace_owner_live_foreign' : 'workspace_owner_ambiguous_foreign',
          physicalOwnerId, deploymentId: receipt.deploymentId, logicalTaskId: receipt.logicalTaskId,
          authority, retained: true,
        }));
        // live_foreign proceeds (proceed set); ambiguous_foreign is refusal-set residue.
        if (authority !== 'live_foreign') report.receiptOnlyRefusals.push(physicalOwnerId);
        continue;
      }
      let branchPresent = false; let branchSha = null;
      try { branchSha = sh('git', ['rev-parse', '--verify', `refs/heads/${receipt.branch}^{commit}`], repoRoot); branchPresent = true; } catch { /* absent */ }
      if (branchPresent && branchSha !== receipt.baseSha) {
        report.diagnostics.push(Object.freeze({
          code: 'workspace_owner_branch_mismatch', physicalOwnerId,
          deploymentId: receipt.deploymentId, logicalTaskId: receipt.logicalTaskId,
          authority, retained: true,
        }));
        report.receiptOnlyRefusals.push(physicalOwnerId);
        continue;
      }
      try {
        if (opts.beforeOwnerCleanup
          && opts.beforeOwnerCleanup(physicalOwnerId, receipt) !== true) {
          throw Object.assign(new Error('capacity settlement was not confirmed'), {
            code: 'workspace_owner_capacity_settlement_refused',
          });
        }
      } catch (error) {
        report.diagnostics.push(Object.freeze({
          code: error?.code === 'workspace_owner_capacity_settlement_refused'
            ? error.code : 'workspace_owner_capacity_settlement_failed',
          physicalOwnerId, deploymentId: receipt.deploymentId,
          logicalTaskId: receipt.logicalTaskId, authority, retained: true,
        }));
        report.receiptOnlyRefusals.push(physicalOwnerId);
        continue;
      }
      try {
        if (branchPresent) sh('git', ['branch', '-D', receipt.branch], repoRoot);
        // Reconcile has already made the stronger proof (dead controller, absent worktree, branch
        // handled), so it supersedes requireAllocated — the allocated-state gate is a
        // publication-path guard only and is dropped exclusively at this reconcile call site.
        if (!releasePhysicalWorkspaceOwner(repoRoot, physicalOwnerId, {})) {
          throw new WorktreeCleanupError('branch-only physical owner receipt remained');
        }
        report.removedPhysicalOwners.push(physicalOwnerId);
        logEvent(opts, physicalOwnerId,
          branchPresent ? 'worktree.branch_residue_reconciled' : 'worktree.owner_residue_reconciled', {
            branch: receipt.branch, baseSha: receipt.baseSha, logicalTaskId: receipt.logicalTaskId,
            processGeneration: receipt.processGeneration,
          });
      } catch (error) { report.errors.push(`${physicalOwnerId}: ${error.message || error}`); }
    }
  }
  for (const physicalOwnerId of expected) {
    if (!/^ws-[a-f0-9]{32}$/u.test(physicalOwnerId)
      || report.validatedExpectedOwners.includes(physicalOwnerId)
      || report.retainedExpectedOwners.includes(physicalOwnerId)) continue;
    report.diagnostics.push(Object.freeze({
      code: 'workspace_owner_receipt_missing', physicalOwnerId,
      deploymentId: null, logicalTaskId: null, authority: 'unproven', retained: true,
    }));
    retainExpected(physicalOwnerId);
  }

  // Verification sandboxes are never resumable. A crash can occur between sandbox creation and
  // its in-memory finally block, so restart reconciliation owns every abandoned directory.
  let verifyRoot = null;
  try { verifyRoot = authorityRoot(repoRoot, 'verify', { create: false }); }
  catch (err) { report.errors.push(`verify-root: ${err.message || err}`); }
  if (verifyRoot) {
    for (const entry of readdirSync(verifyRoot)) {
      const fullDir = join(verifyRoot, entry);
      try {
        authorityChild(repoRoot, 'verify', entry, { kind: 'directory', mustExist: true });
        try { sh('git', ['worktree', 'remove', '--force', fullDir], repoRoot); }
        catch { rmSync(fullDir, { recursive: true, force: true }); }
        removeExactWorktreeRegistration(repoRoot, fullDir);
        if (existsSync(fullDir)) throw new WorktreeCleanupError('verification sandbox remained after cleanup');
        report.removedVerifyDirs.push(fullDir);
      } catch (err) { report.errors.push(`${entry}: ${err.message || err}`); }
    }
    try { if (readdirSync(verifyRoot).length === 0) rmSync(verifyRoot, { recursive: true, force: true }); } catch (err) { report.errors.push(`verify-root: ${err.message || err}`); }
  }
  try {
    const registered = listWorktrees(repoRoot);
    const retainedOwners = new Set(report.diagnostics.filter((row) => row.retained === true)
      .map((row) => row.physicalOwnerId));
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
        if (!expected.has(taskId) && !retainedOwners.has(taskId)) report.errors.push(`registered-zombie-worker:${taskId}`);
      }
    }
    for (const taskId of localWorkerCandidates) {
      let branchPresent = false;
      try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); branchPresent = true; } catch { /* absent */ }
      if (branchPresent && !retainedOwners.has(taskId)
        && (!expected.has(taskId) || !existsSync(join(wtRoot, taskId)))) report.errors.push(`branch-zombie-worker:${taskId}`);
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
