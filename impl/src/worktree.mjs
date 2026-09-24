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
  linkSync, symlinkSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, lstatSync, realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename, join, dirname, isAbsolute, sep, resolve as pathResolve, relative as pathRelative,
} from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ToolchainProjectionError } from './toolchain-projection.mjs';
import { compareCanonicalStrings, foldCanonicalCase } from './canonical-order.mjs';
import { sanitizeVerifierDiagnosticText } from './verifier-diagnostics.mjs';
// Issue #428: the one custody predicate — a second inline opinion about whether cleanup may
// destroy a shared checkout is exactly the drift the surface gate refuses.
import { isPhysicalWorkspaceId, PHYSICAL_WORKSPACE_ID_TOKEN_SOURCE } from './shared-workspace-custody.mjs';

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
export class WorkspaceCustodyError extends Error {
  constructor(message, holders = [], observation = null, code = 'workspace_other_holder_live_retained') {
    super(message);
    this.name = 'WorkspaceCustodyError';
    this.code = code;
    this.retained = true;
    this.holders = Object.freeze([...holders]);
    this.observation = observation;
  }
}
export class WorkspacePreservationError extends Error {
  constructor(message, observation = null, code = 'workspace_uncommitted_content_retained') {
    super(message);
    this.name = 'WorkspacePreservationError';
    this.code = code;
    this.retained = true;
    this.observation = observation;
  }
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

// G-32: ONE bound for every git invocation whose stdout is a whole-repository listing —
// `status`, `ls-tree` and `ls-files` at any scope. The two wrappers below and worktree-capacity's
// `git` all take it from here; no call writes a buffer size of its own. It is derived, not picked:
// the widest row those commands emit, times the number of paths this deployment serves. That row
// is `ls-tree -r -l -z`'s — mode, type, object id, size, tab, path, NUL — whose header is under 64
// bytes and whose path no checkout-able entry exceeds (PATH_MAX, 1024), so 1088 bytes covers any
// row. The product bounds a buffer, it controls no work: a listing larger than it fails with
// ENOBUFS rather than being silently truncated, so a deployment whose repository tracks more
// paths than the default raises BATON_GIT_LISTING_PATHS.
const GIT_LISTING_ROW_BYTES = 1088;
const DEFAULT_GIT_LISTING_PATHS = 61_696; // 1088 bytes/row x 61696 paths is the 64 MiB bound this module trusted once
const GIT_LISTING_PATHS_ENV = 'BATON_GIT_LISTING_PATHS';

/** The ONE maxBuffer for a whole-repository git listing (G-32). */
export function gitListingMaxBuffer() {
  const configured = process.env[GIT_LISTING_PATHS_ENV];
  if (configured === undefined || configured === '') {
    return GIT_LISTING_ROW_BYTES * DEFAULT_GIT_LISTING_PATHS;
  }
  if (!/^[1-9][0-9]*$/u.test(configured)) {
    throw new TypeError(`${GIT_LISTING_PATHS_ENV} must be a positive decimal path count`);
  }
  const bound = GIT_LISTING_ROW_BYTES * Number(configured);
  if (!Number.isSafeInteger(bound)) {
    throw new TypeError(`${GIT_LISTING_PATHS_ENV} exceeds the largest listing bound Node can address`);
  }
  return bound;
}

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: gitListingMaxBuffer(),
    ...(cmd === 'git' ? { env: localGitEnv() } : {}),
  }).trim();
}

function localGitEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', ...extra };
}

function gitFile(args, cwd, opts = {}, extraEnv = {}) {
  // The listing bound is the default for every git call. A caller may raise it in `opts` for a
  // listing it knows is larger than the deployment's path count; no caller does today.
  return execFileSync('git', args, { maxBuffer: gitListingMaxBuffer(), ...opts, cwd, env: localGitEnv(extraEnv) });
}

/** Issue #573: the environment for a REMOTE-directed git call — the landing's pre-flight probe,
 * fetch, push and read-back. `localGitEnv` blanks the global config so a local-only git call
 * stays deterministic, but the credential helper the deployment owner configured for the
 * declared remote lives in exactly that config, so a call that talks to the remote drops the
 * GIT_CONFIG_GLOBAL override while keeping the GIT_* strip and the system-config exemption.
 * Local-only git calls keep `gitFile`'s blanked config. */
function publishGitEnv(extra = {}) {
  const env = localGitEnv(extra);
  delete env.GIT_CONFIG_GLOBAL;
  return env;
}

function gitRemote(args, cwd, opts = {}, extraEnv = {}) {
  return execFileSync('git', args, { maxBuffer: gitListingMaxBuffer(), ...opts, cwd, env: publishGitEnv(extraEnv) });
}

function isClean(dir) {
  return sh('git', ['status', '--porcelain'], dir) === '';
}

function mergeError(message, code, cause) {
  return Object.assign(new StructuredMergeError(message, code), cause ? { cause } : {});
}
/** Issue #573: the stderr classes the publish pre-flight reads as AUTHENTICATION failures — every
 * other `git ls-remote` failure reads as the destination being absent or unreachable. Matched
 * against the bounded tail (`gitStepTail`), case-insensitively, because the wording differs per
 * transport: SSH publickey refusals, HTTP credential prompts the hermetic environment cannot
 * answer, and host-key verification that never reached the credential at all. */
const GIT_REMOTE_AUTH_FAILURE = /permission denied|publickey|could not read username|could not read password|authentication failed|terminal prompts disabled|no such device or address|host key verification|identity file/i;
/** Issue #573: the throwaway ref the publish pre-flight names. `--dry-run` writes nothing on
 * either side, so the ref never exists on the remote; it only gives the simulated push a
 * refspec to carry. */
const PUBLISH_AUTH_PROBE_REF = 'baton-reviewer-auth-probe';

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
      try { mkdirSync(path, { mode: 0o700 }); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
      // Another controller may win creation. The same confinement checks below apply to
      // its result; EEXIST is neither a failure by itself nor proof of a safe directory.
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
    // #500: the lane metadata record this reader parses. 1 MiB is the largest record readMeta
    // accepts; a larger or non-private file reads as absent (null), so a meta.json replaced with
    // bulk data is never parsed as a lane record. Operator-declared: no file in the repository
    // derives the number.
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

// The receipt names in the publication root carry the physical workspace id. Both patterns derive
// from the one spelling of that shape (shared-workspace-custody.mjs), so a change to the id shape
// cannot leave a reader here matching the old one.
const WORKSPACE_OWNER_RECEIPT_NAME = new RegExp(
  `^(${PHYSICAL_WORKSPACE_ID_TOKEN_SOURCE})\\.json(?:\\.tmp-[A-Za-z0-9-]+)?$`, 'u',
);
const WORKSPACE_OWNER_TEMP_NAME = new RegExp(
  `^(${PHYSICAL_WORKSPACE_ID_TOKEN_SOURCE})\\.json\\.tmp-[A-Za-z0-9-]+$`, 'u',
);

// #500: the identity text a workspace owner receipt carries — logical task id, run id, attempt
// id — is bounded at 4 096 bytes each, and the controller's pidStart at 256 bytes. The default is
// the reader's own: validateWorkspaceOwnerReceipt passes no explicit bound for logicalTaskId.
// Operator-declared: no file in the repository derives the numbers.
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
    || !isPhysicalWorkspaceId(value.physicalOwnerId)
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
  const f = workspaceOwnerReceiptPath(repoRoot, physicalOwnerId);
  try {
    const stat = lstatSync(f);
    // #500: a physical workspace owner receipt is one small JSON record. 64 KiB is the largest file
    // readWorkspaceOwnerReceipt will read; a larger one is refused as unsafe rather than parsed.
    // Operator-declared: no file in the repository derives the number.
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 64 * 1024) {
      throw new WorkspaceOwnerDiagnostic('physical workspace owner receipt is unsafe', 'workspace_owner_receipt_invalid');
    }
    return validateWorkspaceOwnerReceipt(JSON.parse(readFileSync(f, 'utf8')), repoRoot, physicalOwnerId);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
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
    // #500: the same 64 KiB receipt bound as readWorkspaceOwnerReceipt. A foreign record larger
    // than it is not adopted here either: this reader returns null and reconcile leaves it alone.
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
      || !isPhysicalWorkspaceId(value.physicalOwnerId)
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
    // #500: the same 64 KiB receipt bound, applied to a publication temp that may hold a receipt.
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
      // #500: a worktree administration gitdir file holds one path to the worktree's `.git` file.
      // 64 KiB bounds what this scan reads; a larger file is skipped, never parsed.
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
    const match = WORKSPACE_OWNER_RECEIPT_NAME.exec(name);
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
    // Issue #428: the lane branch is a durable identity that outlives the checkout, so it is
    // not part of the released resource; only the checkout, its administration and the
    // receipt must be exactly absent.
    return !existsSync(worktree) && !existsSync(`${worktree}.meta.json`)
      && !existsSync(`${worktree}.projection.exclude`) && !registered;
  } catch { return false; }
}

export function releasePhysicalWorkspaceOwner(repoRoot, physicalOwnerId, opts = {}) {
  const finalPath = workspaceOwnerReceiptPath(repoRoot, physicalOwnerId);
  const receipt = readWorkspaceOwnerReceipt(repoRoot, physicalOwnerId)
    ?? readWorkspaceOwnerTempReceipt(repoRoot, physicalOwnerId);
  if (!receipt) {
    const worktree = pathResolve(repoRoot, '.baton', 'wt', physicalOwnerId);
    const registered = listWorktrees(repoRoot).some((entry) => (
      canonicalPathIncludingMissingLeaf(entry.dir)
        === canonicalPathIncludingMissingLeaf(worktree)
    ));
    // Issue #428: a surviving lane branch is retained custody, not a retained resource —
    // the release refuses only while the checkout or its registration still exists.
    return !existsSync(worktree) && !registered;
  }
  if (opts.requireAllocated === true && receipt.state !== 'allocated') return false;
  const registered = listWorktrees(repoRoot).some((entry) => (
    canonicalPathIncludingMissingLeaf(entry.dir)
      === canonicalPathIncludingMissingLeaf(receipt.worktree)
  ));
  // Issue #428: the lane branch is a durable identity that outlives the checkout, so a
  // surviving branch no longer refuses the receipt release — only the checkout and its
  // Git registration do.
  if (existsSync(receipt.worktree) || registered) return false;
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

/** The repository-confined absolute path of ONE repo-relative dependency directory. Shape and
 * containment are decided here — the same two refusals `dependencySources` raises — so a
 * deployment-configured list can never name anything outside the repository, and the integration
 * checkout links exactly what this answers. */
function dependencyDirPath(repoRoot, rel) {
  const realRepo = realpathSync(repoRoot);
  if (typeof rel !== 'string' || rel.length === 0 || isAbsolute(rel)) throw new TypeError('dependency directory must be relative');
  const source = pathResolve(realRepo, rel); const within = pathRelative(realRepo, source);
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new TypeError('dependency directory escapes repository');
  return source;
}

function dependencySources(repoRoot, dependencyDirs = []) {
  const realRepo = realpathSync(repoRoot);
  return dependencyDirs.map((rel) => {
    const source = dependencyDirPath(realRepo, rel);
    if (!existsSync(source)) throw new TypeError('dependency directory does not exist');
    const realSource = realpathSync(source); const realWithin = pathRelative(realRepo, realSource);
    if (realWithin === '..' || realWithin.startsWith(`..${sep}`) || isAbsolute(realWithin) || !lstatSync(realSource).isDirectory()) throw new TypeError('dependency directory is not confined');
    return { rel, realSource };
  });
}

// The directories an installed tree may hide behind are never descended into (an install is a
// destination, not a place to look for more installs), and the walk is bounded in both depth and
// directory count so deriving them can never be the expensive part of a landing.
const DEPENDENCY_SCAN_SKIP = Object.freeze(new Set(['.git', '.baton', '.baton-brief', 'node_modules']));
const DEPENDENCY_SCAN_DEPTH = 4;
// A directory COUNT bound for the walk below — never a byte ceiling, which is why it takes no
// cataloged spelling (impl/src/limits.mjs owns every one of those).
const DEPENDENCY_SCAN_DIRECTORY_CAP = 5_000;
const isDirectoryPath = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };

/**
 * The dependency directories this repository actually carries: every directory that holds a
 * `package.json` with a sibling `node_modules`, repo-relative and ordered (issue #451).
 *
 * The ONE derivation both consumers share: a deployment configures the lane worktrees with it
 * (and now threads the same value into the landing), and the integration checkout falls back to
 * it. It is why a repository whose install lives at `impl/node_modules` — or `packages/worker/…` —
 * links that install instead of nothing: a name is never hard-coded, it is read from the tree.
 */
export function deriveDependencyDirs(repoRoot) {
  const realRepo = realpathSync(repoRoot);
  const found = [];
  const walk = (relative, depth, budget) => {
    const dir = relative === '' ? realRepo : pathResolve(realRepo, relative);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const names = new Set(entries.map((entry) => entry.name));
    if (names.has('package.json') && names.has('node_modules')
      && isDirectoryPath(pathResolve(dir, 'node_modules'))) {
      found.push(relative === '' ? 'node_modules' : join(relative, 'node_modules'));
    }
    if (depth === 0) return;
    for (const entry of entries) {
      if (!entry.isDirectory() || DEPENDENCY_SCAN_SKIP.has(entry.name)) continue;
      if (budget.count >= DEPENDENCY_SCAN_DIRECTORY_CAP) return;
      budget.count += 1;
      walk(relative === '' ? entry.name : join(relative, entry.name), depth - 1, budget);
    }
  };
  walk('', DEPENDENCY_SCAN_DEPTH, { count: 0 });
  return found.sort(compareCanonicalStrings);
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

// #500: the sparse-checkout admission bounds (normalizeSparsePaths, sparseCheckoutIdentity). One
// lane's path set is at most 1 024 paths; one path is at most 2 048 bytes; the set's paths total
// under 256 KiB; and no single path carries more than 64 segments. An admitted identity is a git
// sparse-checkout file this module writes and reads whole, so these bound the file and the
// pathspec list one admission can carry. Operator-declared: no file in the repository derives the
// numbers.
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
  // #500: one physical owner id is a single path component and a single git ref component, so it
  // stays inside the byte budget a filesystem name can carry: 128 B. Operator-declared: no file in
  // the repository derives the number.
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

function stagedPathsFromBase(dir, baseSha) {
  const raw = gitFile(['diff', '--cached', '--name-only', '-z', baseSha], dir, { encoding: 'utf8' });
  return raw.split('\0').filter(Boolean);
}

/** Unstaged tracked modifications plus untracked files: the residue a whole-tree
 * `git add -A` would sweep into a worker-attributed snapshot (issue #52). */
function unstagedPaths(dir) {
  const paths = new Set();
  for (const args of [
    ['diff', '--name-only', '-z'],
    ['ls-files', '--others', '--exclude-standard', '-z'],
  ]) {
    const raw = gitFile(args, dir, { encoding: 'utf8' });
    for (const path of raw.split('\0').filter(Boolean)) paths.add(path);
  }
  return [...paths].sort();
}

function isProjectionPath(path, projectionTargets) {
  return projectionTargets.some((target) => path === target || path.startsWith(`${target}/`));
}

/** Split working-tree residue into paths the declared sparse scope covers (safe to
 * stage) and paths it does not (left unstaged and reported, never swept in). A path
 * below a toolchain projection target is not residue: like the staged check, it fails
 * closed with the projection error. */
function partitionCapturePaths(paths, identity, projectionTargets = []) {
  const covered = [];
  const outOfScope = [];
  for (const path of paths) {
    if (isProjectionPath(path, projectionTargets)) {
      throw new ToolchainProjectionError('toolchain projection entered the result tree', 'toolchain_projection_materialization_failed');
    }
    (sparseCheckoutCoversPath(identity, path) ? covered : outOfScope).push(path);
  }
  return { covered, outOfScope };
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

// ---------------------------------------------------------------------------
// Content preservation at destructive removal boundaries
// ---------------------------------------------------------------------------
//
// A checkout holds two kinds of content the runtime never captured as a revision: work its owner
// had not captured (staged, unstaged, deleted and untracked paths, and anything Git ignores —
// which `--ignored=no` hides completely) and paths the runtime itself materialized. None of it is
// destroyed because an owner is dead or because a caller forces the removal, so `reap` and
// `reconcile` observe the checkout before their first destructive effect and retain it with a
// typed refusal while any of that content is unproven. The only content this boundary destroys
// without a capture is infrastructure the owner metadata itself attests as runtime-materialized:
// `copiedDependencies` and `toolchainProjectionTargets`. No caller option, and no `force`, stands
// in for that attestation. Preservation is by retention — nothing here stages, commits, stashes or
// rewrites the content it judges.

/** Attested runtime-materialized infrastructure roots as safe relative literals. Corrupt or
 * non-conforming metadata attests nothing, so every differing path stays unproven. */
function attestedInfrastructureRoots(meta) {
  if (!meta) return [];
  const roots = new Set();
  for (const value of [...meta.copiedDependencies, ...(meta.toolchainProjectionTargets ?? [])]) {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\\')
      || value.normalize('NFC') !== value || isAbsolute(value)
      || /[\u0000-\u001f\u007f]/u.test(value)) continue;
    const parts = value.split('/').filter((part) => part !== '');
    if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')
      || ['.git', '.baton'].includes(foldCanonicalCase(parts[0]))) continue;
    roots.add(parts.join('/'));
  }
  return [...roots].sort();
}

/** Every path Git reports as differing from the captured revision, ignored paths included: a
 * checkout holding only an ignored `.env` or notes directory is not clean, and deleting it would
 * destroy content no capture recorded. Untracked enumeration is per file, so an attested root
 * nested inside an untracked tree is still classifiable. Attested roots are excluded by pathspec,
 * which is what keeps a copied dependency tree from being walked at all. */
function gitStatusEntries(dir, generatedRoots) {
  // Excluding a generated directory from the expensive untracked walk must not hide a
  // force-added or modified tracked file beneath that same directory.
  const tracked = gitFile(['status', '--porcelain', '-z', '--no-renames', '--untracked-files=no'],
    dir, { encoding: 'utf8' }, { GIT_OPTIONAL_LOCKS: '0' });
  const raw = gitFile(
    ['status', '--porcelain', '-z', '--no-renames', '--untracked-files=all', '--ignored=matching',
      '--', '.', ...generatedRoots.map((root) => `:(exclude,top,literal)${root}`)],
    dir, { encoding: 'utf8' }, { GIT_OPTIONAL_LOCKS: '0' },
  );
  return [...new Set(`${tracked}${raw}`.split('\0').filter(Boolean))];
}

/** Whether `dir` is a checkout of *this* repository. A matching top-level is not enough: another
 * repository checked out at the same path answers `--show-toplevel` for itself, and its status
 * would then be read as evidence about this repository's owner. */
function isThisRepositoryCheckout(repoRoot, dir) {
  try {
    if (realpathSync(sh('git', ['rev-parse', '--show-toplevel'], dir)) !== realpathSync(dir)) return false;
    const common = (cwd) => realpathSync(pathResolve(cwd, sh('git', ['rev-parse', '--git-common-dir'], cwd)));
    return common(dir) === common(repoRoot);
  } catch { return false; }
}

/** Whether a directory Git cannot observe as its own checkout holds content: a plain directory
 * inside the repository resolves to the repository's main worktree, so `git status` there would
 * report somebody else's state. Only a top-level `.git` administration entry and empty directories
 * are provably content-free, and one entry anywhere is enough to answer. */
function hasUnobservedContent(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return true; }
  for (const entry of entries) {
    if (entry === '.git') continue;
    let stat;
    try { stat = lstatSync(join(dir, entry)); } catch { return true; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return true;
    if (hasUnobservedContent(join(dir, entry))) return true;
  }
  return false;
}

/**
 * Observe whether an owned worktree directory holds content no capture recorded.
 * @param {string} repoRoot
 * @param {string} physicalOwnerId
 * @returns {{schemaVersion:number, physicalOwnerId:string, dir:string, state:'absent'|'clean'|'generated'|'dirty'|'empty'|'unobservable', removable:boolean, generatedRoots:string[], dirtyPaths:string[], generatedPaths:string[], headSha:string|null, baseSha:string|null, reason:string|null}}
 */
export function observeOwnedWorktreeContent(repoRoot, physicalOwnerId) {
  normalizePhysicalOwnerId(physicalOwnerId, 'physicalOwnerId');
  const dir = authorityChild(repoRoot, 'wt', physicalOwnerId, { kind: 'directory' });
  let meta = null;
  try { meta = validatedMetadata(repoRoot, physicalOwnerId); } catch { meta = null; }
  const generatedRoots = attestedInfrastructureRoots(meta);
  const row = (state, extra = {}) => Object.freeze({
    schemaVersion: 1, physicalOwnerId, dir, state,
    removable: state !== 'dirty' && state !== 'unobservable',
    generatedRoots,
    dirtyPaths: Object.freeze([]), generatedPaths: Object.freeze([]),
    headSha: null, baseSha: null, reason: null, ...extra,
  });
  if (!existsSync(dir)) return row('absent');
  if (!isThisRepositoryCheckout(repoRoot, dir)) {
    return hasUnobservedContent(dir) ? row('unobservable', {
      reason: 'directory is not this repository\'s checkout and holds entries no capture can record',
    }) : row('empty');
  }
  let entries;
  try { entries = gitStatusEntries(dir, generatedRoots); }
  catch { return row('unobservable', { reason: 'working-tree status could not be observed' }); }
  const dirtyPaths = []; const generatedPaths = [];
  for (const entry of entries) {
    const status = entry.slice(0, 2);
    const path = entry.slice(3).replace(/\/+$/u, '');
    // Only content Git reports as absent from the revision (untracked, ignored) can be runtime
    // infrastructure: a modification of a tracked path is somebody's work whatever metadata says.
    const generated = (status === '??' || status === '!!')
      && generatedRoots.some((root) => path === root || path.startsWith(`${root}/`));
    if (generated) generatedPaths.push(path); else dirtyPaths.push(path);
  }
  dirtyPaths.sort(); generatedPaths.sort();
  const state = dirtyPaths.length > 0 ? 'dirty' : generatedPaths.length > 0 ? 'generated' : 'clean';
  let headSha = null;
  try { headSha = sh('git', ['rev-parse', 'HEAD'], dir); } catch { headSha = null; }
  return row(state, {
    dirtyPaths: Object.freeze(dirtyPaths), generatedPaths: Object.freeze(generatedPaths),
    headSha, baseSha: meta?.baseSha ?? null,
    reason: state === 'dirty' ? 'differing paths have no recorded capture' : null,
  });
}

/** The live holders of one physical checkout, from the injected provider. Absent provider means
 * this manager knows no co-holders (single-holder deployments and direct worktree callers); the
 * controller that owns shared custody always injects it. */
function liveWorkspaceHolders(opts, physicalOwnerId) {
  if (typeof opts?.custodyHolders !== 'function') return Object.freeze([]);
  const holders = opts.custodyHolders(physicalOwnerId, {
    ...(opts.excludeHolderId ? { excludeHandleId: opts.excludeHolderId } : {}),
  });
  return Object.freeze(Array.isArray(holders) ? [...holders] : []);
}

/** Refuse before the first destructive effect while the checkout holds content no capture
 * recorded, or while another live holder is still working in it. Nothing is removed, released or
 * logged here. Custody decides whether cleanup may run at all; preservation decides whether the
 * content may be destroyed — two different reasons, two different refusal codes. */
function assertRemovableContent(repoRoot, physicalOwnerId, opts = {}) {
  const observation = observeOwnedWorktreeContent(repoRoot, physicalOwnerId);
  if (!observation.removable) {
    const unobservable = observation.state === 'unobservable';
    throw new WorkspacePreservationError(
      `worktree "${physicalOwnerId}" was retained: ${unobservable
        ? 'its content could not be observed'
        : `${observation.dirtyPaths.length} differing path(s) have no recorded capture`}`,
      observation,
      unobservable ? 'workspace_content_unobservable_retained' : 'workspace_uncommitted_content_retained',
    );
  }
  const holders = liveWorkspaceHolders(opts, physicalOwnerId);
  if (holders.length > 0) {
    throw new WorkspaceCustodyError(
      `worktree "${physicalOwnerId}" was retained: ${holders.length} other live holder(s) still work in it`,
      holders, observation,
    );
  }
  return observation;
}

export function validateOwnedWorktree(repoRoot, taskId, opts = {}) {
  normalizePhysicalOwnerId(taskId, 'taskId');
  const dir = authorityChild(repoRoot, 'wt', taskId, { kind: 'directory', mustExist: true });
  if (!existsSync(dir)) throw new UnknownWorktreeError(`no owned worktree for taskId "${taskId}"`);
  const meta = validatedMetadata(repoRoot, taskId);
  const realDir = realpathSync(dir);
  const repoReal = realpathSync(pathResolve(repoRoot));
  // Issue #52 defect (1): the resolved workspace is never the repository main
  // checkout. A capture path that ran with the main checkout as the worker workspace
  // sweeps unrelated main-checkout files into a worker-attributed snapshot, so
  // ownership refuses a workspace that IS the main checkout instead of capturing it.
  if (realDir === repoReal) throw new UnknownWorktreeError('owned worktree resolves to the repository main checkout: worker capture requires an owned .baton/wt/ worktree');
  if (opts.expectedPath !== undefined) {
    let expectedReal = null;
    try { expectedReal = realpathSync(opts.expectedPath); } catch { expectedReal = null; }
    if (expectedReal !== null && expectedReal === repoReal) throw new UnknownWorktreeError('worker capture refused: the expected worktree path is the repository main checkout, not an owned .baton/wt/ worktree');
    if (expectedReal !== null) {
      const wtRoot = authorityRoot(repoRoot, 'wt', { create: false });
      const within = wtRoot === null ? '..' : pathRelative(realpathSync(wtRoot), expectedReal);
      if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw new UnknownWorktreeError('worker capture refused: the expected worktree path is outside owned .baton/wt/ worktrees');
    }
    if (realpathSync(opts.expectedPath) !== realDir) throw new UnknownWorktreeError('owned worktree path identity mismatch');
  }
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
 * @returns {Promise<{sha:string, stashed:boolean, stashSha?:string}>}
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
    // G-6: the receipt names the stash COMMIT the push created, never the moving name
    // `stash@{0}` — a later stash re-points that name at a different commit, so a name cannot be
    // the identity this receipt claims. Nothing pops the parked work; the sha is what lets an
    // operator (or a later lane) find it again.
    const stashSha = sh('git', ['rev-parse', '--verify', 'refs/stash'], repoRoot);
    const sha = sh('git', ['rev-parse', targetRef], repoRoot);
    return { sha, stashed: true, stashSha };
  }
  const sha = sh('git', ['rev-parse', targetRef], repoRoot);
  return { sha, stashed: false };
}

// ---------------------------------------------------------------------------
// Worktree git sharing (issue #412)
// ---------------------------------------------------------------------------

/**
 * A Baton lane checkout is workspace separation, not git-ref isolation: `git worktree
 * add -b baton/<taskId>` publishes a repo-visible branch ref for every private checkout
 * and every checkout shares the repository object store. Nothing at the creation seam
 * below isolates either namespace; read this before treating a lane checkout as
 * git-ref isolation.
 */
export const WORKTREE_GIT_SHARING = Object.freeze({
  schemaVersion: 1,
  statement: 'A Baton lane checkout is workspace separation, not git-ref isolation: `git worktree add -b baton/<taskId>` publishes a repo-visible branch ref and every checkout shares the repository object store.',
  refNamespace: 'shared',
  objectStore: 'shared',
  branchForTask: (taskId) => `baton/${taskId}`,
});

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
    // Issue #412: workspace separation is not git-ref isolation — this publishes the
    // repo-visible ref named by WORKTREE_GIT_SHARING.branchForTask and shares the
    // repository object store with every other checkout.
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
 * @returns {Promise<{sha:string, snapshotted:boolean, baseSha:string, changedPaths:string[], sparseCheckoutIdentity:object, warnings:{code:string, paths:string[]}[]}>}
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
  // Issue #52 defect (2): a staged out-of-scope path would enter the snapshot under the
  // worker's attribution, so staged scope violations still fail closed here. Unstaged and
  // untracked residue is scoped out of staging below and reported, never swept in.
  assertChangedPathsCovered(stagedPathsFromBase(dir, meta.baseSha), owned.sparseCheckoutIdentity, projectionTargets);

  let snapshotted = false;
  let warnings = [];
  if (!isClean(dir)) {
    let staged = false;
    try {
      const { covered, outOfScope } = partitionCapturePaths(unstagedPaths(dir), owned.sparseCheckoutIdentity, projectionTargets);
      if (outOfScope.length > 0) {
        warnings = Object.freeze([{ code: 'worker_capture_out_of_scope_residue', paths: Object.freeze([...outOfScope]) }]);
      }
      if (covered.length > 0) {
        // Literal top-relative pathspecs: only covered paths enter the index, and a
        // filename carrying pathspec magic stages itself rather than its reading.
        sh('git', ['add', '--', ...covered.map((path) => `:(literal,top)${path}`)], dir);
        staged = true;
      }
      validateOwnedWorktree(repoRoot, taskId, {
        expectedPath: dir, expectedBaseSha: opts.expectedBaseSha ?? meta.baseSha,
        expectedBranch: opts.expectedBranch ?? meta.branch, sparseCheckoutIdentity: owned.sparseCheckoutIdentity,
      });
      if (trackedProjectionPaths(dir, projectionTargets).length > 0) throw new ToolchainProjectionError('toolchain projection entered the result index', 'toolchain_projection_materialization_failed');
      const stagedAfter = stagedPathsFromBase(dir, meta.baseSha);
      assertChangedPathsCovered(stagedAfter, owned.sparseCheckoutIdentity, projectionTargets);
      if (stagedAfter.length > 0) {
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
    } catch (error) {
      if (staged) try { gitFile(['reset', '-q'], dir, { stdio: 'ignore' }); } catch { /* refusal remains authoritative */ }
      throw error;
    }
  }
  const sha = sh('git', ['rev-parse', 'HEAD'], dir);
  // The reported tree still names warned residue: leaving it out of the commit keeps the
  // snapshot attribution clean while the trust gate observes the same residue here.
  const changedPaths = changedPathsFromBase(dir, meta.baseSha);
  validateOwnedWorktree(repoRoot, taskId, {
    expectedPath: dir, expectedBaseSha: opts.expectedBaseSha ?? meta.baseSha,
    expectedBranch: opts.expectedBranch ?? meta.branch, sparseCheckoutIdentity: owned.sparseCheckoutIdentity,
  });
  warnings = Object.freeze(warnings);
  logEvent(opts, taskId, 'worktree.captured', { sha, snapshotted, baseSha: meta.baseSha, changedPaths, sparseCheckoutIdentity: owned.sparseCheckoutIdentity, warnings });
  return { sha, snapshotted, baseSha: meta.baseSha, changedPaths, sparseCheckoutIdentity: owned.sparseCheckoutIdentity, warnings };
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
// Lane-branch custody (issue #428)
// ---------------------------------------------------------------------------

/** The lane branch of one owned checkout, and whether it already contains the checkout's
 * HEAD. `branchSha` is null when the branch does not exist; `contained` is false whenever
 * containment cannot be proven (`merge-base --is-ancestor`). */
function laneBranchState(repoRoot, taskId, dir) {
  const branch = `baton/${taskId}`;
  let branchSha = null;
  try { branchSha = sh('git', ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`], repoRoot); } catch { branchSha = null; }
  let headSha = null;
  try { headSha = sh('git', ['rev-parse', 'HEAD'], dir); } catch { headSha = null; }
  let contained = false;
  if (branchSha && headSha) {
    try { sh('git', ['merge-base', '--is-ancestor', headSha, branchSha], repoRoot); contained = true; } catch { contained = false; }
  }
  return { branch, branchSha, headSha, contained };
}

/** Whether the lane branch is checked out in a worktree OTHER than `dir` — moving such a
 * branch would corrupt another checkout's view of its own HEAD. */
function laneBranchHeldElsewhere(repoRoot, branch, dir) {
  const ref = `refs/heads/${branch}`;
  return listWorktrees(repoRoot).some((entry) => {
    if (entry.branch !== branch && entry.branch !== ref) return false;
    try { return realpathSync(entry.dir) !== realpathSync(dir); }
    catch { return pathResolve(entry.dir) !== pathResolve(dir); }
  });
}

/**
 * Put a seat's lane branch at its checkout's HEAD before a removal boundary (issue #428).
 * A branch that is missing — or that does not contain the checkout's HEAD — is created or
 * moved to HEAD, so the stop can never destroy work the branch alone named; a detached
 * checkout is reattached to the branch (branch == HEAD, so no file state changes).
 * @param {string} repoRoot
 * @param {string} taskId
 * @param {{worktree: string}} opts `worktree` is the checkout path (validated inside the
 *   `.baton/wt` authority root).
 * @returns {{branch: string, branchSha: string|null, headSha: string, contained: boolean, repaired: boolean}}
 * @throws {WorktreeCleanupError} when HEAD is unreadable or another worktree holds the
 *   branch — the caller retains the checkout, never guesses.
 */
export function ensureLaneBranchAtHead(repoRoot, taskId, opts = {}) {
  normalizePhysicalOwnerId(taskId, 'taskId');
  const dir = authorityChild(repoRoot, 'wt', taskId, { kind: 'directory', mustExist: true });
  const state = laneBranchState(repoRoot, taskId, dir);
  if (!state.headSha) {
    throw new WorktreeCleanupError(`lane branch custody: checkout "${taskId}" HEAD is unreadable`);
  }
  if (state.contained && sh('git', ['branch', '--show-current'], dir) === state.branch) {
    return { ...state, repaired: false };
  }
  if (laneBranchHeldElsewhere(repoRoot, state.branch, dir)) {
    throw new WorktreeCleanupError(`lane branch "${state.branch}" is checked out in another worktree`);
  }
  gitFile(['update-ref', `refs/heads/${state.branch}`, state.headSha], repoRoot, { stdio: 'pipe' });
  if (sh('git', ['branch', '--show-current'], dir) !== state.branch) {
    sh('git', ['checkout', '-q', state.branch], dir);
  }
  return { ...state, branchSha: state.headSha, contained: true, repaired: true };
}

/** The directory token one landing's scratch checkout is named by. A contribution identity is a
 * swarm-label id — `contribution:1` is the ordinary spelling — and a colon is neither a bounded
 * path component under the authority root nor a safe ref name, so the token is folded to the ONE
 * shape the authority accepts. Two identities that fold to the same token collide on purpose: the
 * second landing finds the first checkout and refuses rather than sharing it. */
function integrationSlug(contributionId) {
  const folded = `${contributionId}`.replace(/[^A-Za-z0-9._-]/gu, '-').replace(/^[^A-Za-z0-9]+/u, '');
  return normalizePhysicalOwnerId(folded.length > 0 ? folded : 'contribution', 'integration contributionId');
}

/** Remove one integration checkout's directory AND its worktree administration, exactly. The `git
 * worktree remove` fast path runs first (it tears down the administrative entry with the
 * directory); a checkout a crash left unadministrable falls back to an rm and a prune, and the
 * caller's own postcheck proves the absent state rather than trusting either path. ONE spelling:
 * the landing's own cleanup (issue #296) and the open-time sweep (issue #459) remove a checkout
 * the same way, so a leftover and a live checkout can never be removed by two different rules. */
function removeIntegrationCheckout(repoRoot, dir) {
  try {
    sh('git', ['worktree', 'remove', '--force', dir], repoRoot);
  } catch (error) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    try { sh('git', ['worktree', 'prune'], repoRoot); } catch { /* the caller's postcheck decides */ }
    if (listWorktrees(repoRoot).some((entry) => pathResolve(entry.dir) === pathResolve(dir))) {
      throw new WorktreeCleanupError('integration checkout administration could not be removed', { cause: error });
    }
  }
}

/**
 * Issue #459: sweep the integration checkouts a PREVIOUS incarnation left behind.
 *
 * A landing that dies with its resident (a killed gate run, a stop, a crash) leaves its scratch
 * checkout under `.baton/wt` — and `createIntegrationCheckout` refuses a contribution whose
 * directory already exists, so the next attempt at the same contribution could never start. The
 * open of the resident that owns this repository removes every `integrate-*` checkout and the
 * projection-exclude file beside it, and returns the names it swept so the caller's own row can
 * name them: absence is never silent, and a sweep that removed nothing records nothing.
 *
 * Called at the resident's open, BEFORE any landing of this incarnation exists — a checkout this
 * call can see is therefore one whose landing is gone.
 */
export async function sweepIntegrationCheckouts(repoRoot) {
  const root = authorityRoot(repoRoot, 'wt', { create: false });
  if (root === null || !existsSync(root)) return Object.freeze([]);
  const children = readdirSync(root).sort();
  const swept = [];
  for (const child of children) {
    if (!child.startsWith('integrate-')) continue;
    const dir = join(root, child);
    // Only the checkouts the landing verb names. The projection-exclude file a checkout wrote is
    // removed WITH its checkout: an exclude named on its own (the checkout's own removal already
    // took it) is removed the same way, and a lane worktree's exclude — never `integrate-*` — is
    // none of this sweep's business.
    if (child.endsWith('.projection.exclude')) {
      rmSync(dir, { force: true });
      continue;
    }
    // An entry that vanished between the listing and this stat is already gone; the sweep is not
    // racing anything but its own removals.
    let stat = null;
    try { stat = lstatSync(dir); } catch { continue; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    authorityChild(repoRoot, 'wt', child, { kind: 'directory', mustExist: true });
    removeIntegrationCheckout(repoRoot, dir);
    if (existsSync(dir) || listWorktrees(repoRoot).some((entry) => pathResolve(entry.dir) === pathResolve(dir))) {
      throw new WorktreeCleanupError('integration checkout sweep did not reach an exact absent state');
    }
    rmSync(join(root, `${child}.projection.exclude`), { force: true });
    swept.push(child);
  }
  if (swept.length > 0) {
    try { sh('git', ['worktree', 'prune'], repoRoot); }
    catch (error) { throw new WorktreeCleanupError('integration checkout administration could not be pruned', { cause: error }); }
  }
  return Object.freeze(swept);
}

// ---------------------------------------------------------------------------
// Integration scratch checkout (issue #296)
// ---------------------------------------------------------------------------

/**
 * Create the scratch checkout one landing prepares its squash in.
 *
 * Landing used to mean a root-side human building a throwaway worktree by hand — a `git worktree
 * add`, then a copy of `node_modules` — and the copy is what made it slow and what made two
 * landings on one host fight (`swarm.integrate` prepares and verifies inside this checkout, so the
 * deployment owns it the way it owns every other checkout). The checkout lives under the SAME
 * `.baton/wt` authority root `ensureLaneBranchAtHead` repairs (never a bare `git worktree add`
 * against an unconfined path), starts DETACHED at the target's current head, and links the
 * repository's installed dependencies by symlink — a link is shared, so a gate that needs them
 * reads the same tree the repository always had, and nothing is copied.
 *
 * The caller owns `cleanup()` and MUST await it: a refusal removes the checkout before it escapes,
 * so a landing that could not finish leaves no directory and no administrative entry behind.
 *
 * @param {string} repoRoot
 * @param {string} contributionId the contribution being landed (names the directory)
 * @param {{target?: string, dependencyDirs?: string[], log?: object}} [opts]
 *   `target` is the branch/ref the scratch checkout starts on (default HEAD). `dependencyDirs`
 *   names the repo-relative installs to link (the deployment's own `workerDependencyDirs`, when it
 *   configures them); omitted or empty, `deriveDependencyDirs` reads them from the repository.
 * @returns {Promise<{dir: string, target: string, targetHead: string, branch: string,
 *   dependencyLinks: Array<{name: string, source: string, path: string}>, cleanup: () => Promise<void>}>}
 * @throws {WorktreeAlreadyExistsError} when a checkout for this contribution already exists
 */
export async function createIntegrationCheckout(repoRoot, contributionId, opts = {}) {
  const target = typeof opts.target === 'string' && opts.target.length > 0 ? opts.target : 'HEAD';
  let targetHead;
  try {
    targetHead = sh('git', ['rev-parse', '--verify', `${target}^{commit}`], repoRoot);
  } catch {
    throw new InvalidShaError(`createIntegrationCheckout: target "${target}" does not resolve to a commit in ${repoRoot}`);
  }
  // The scratch checkout is a checkout of the SAME repository, so it needs the same exclusion that
  // keeps `.baton/` out of every other checkout's status — otherwise the first gate that reads
  // `git status` sees the checkout's own authority directory as foreign content.
  ensureBatonExcluded(repoRoot);
  authorityRoot(repoRoot, 'wt', { create: true });
  const child = `integrate-${integrationSlug(contributionId)}`;
  const dir = authorityChild(repoRoot, 'wt', child, { kind: 'directory' });
  if (existsSync(dir)) {
    throw new WorktreeAlreadyExistsError(`createIntegrationCheckout: "${child}" already exists under .baton/wt`);
  }

  let registered = false;
  let excludePath = null;
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
        if (present) authorityChild(repoRoot, 'wt', child, { kind: 'directory', mustExist: true });
        removeIntegrationCheckout(repoRoot, dir);
      }
      registered = false;
      if (excludePath !== null) { rmSync(excludePath, { force: true }); excludePath = null; }
      try { sh('git', ['worktree', 'prune'], repoRoot); }
      catch (error) { throw new WorktreeCleanupError('integration checkout administration could not be pruned', { cause: error }); }
      if (existsSync(dir) || listWorktrees(repoRoot).some((entry) => pathResolve(entry.dir) === pathResolve(dir))) {
        throw new WorktreeCleanupError('integration checkout cleanup did not reach an exact absent state');
      }
    })();
    return cleanupPromise;
  };

  const dependencyLinks = [];
  try {
    sh('git', ['worktree', 'add', '--detach', dir, targetHead], repoRoot);
    registered = true;
    // Link, never copy: the installed tree is large, and a landing that copied it would both pay
    // for it and drift from it the moment the repository's own install changed.
    //
    // Issue #451: the names come from the deployment's own configuration when it sets one (the
    // SAME value the lane worktrees are built with) and from the repository otherwise — never a
    // root-only guess, which links nothing on a repository whose install sits under a
    // sub-directory and leaves every regenerator dying ERR_MODULE_NOT_FOUND.
    const names = Array.isArray(opts.dependencyDirs) && opts.dependencyDirs.length > 0
      ? opts.dependencyDirs : deriveDependencyDirs(repoRoot);
    for (const name of names) {
      const source = dependencyDirPath(repoRoot, name);
      if (!existsSync(source)) continue;
      const path = join(dir, name);
      if (existsSync(path)) continue;
      // A configured install may sit under a directory the target's own tree does not carry yet.
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(source, path, 'dir');
      dependencyLinks.push({ name, source, path });
    }
    if (dependencyLinks.length > 0) {
      // A link is not repository content, and `.gitignore`'s `node_modules/` matches a DIRECTORY —
      // never the symlink — so without this the `git add -A` that builds the squash would stage
      // the link itself into the landed commit. The projection lanes already exclude their own
      // materialized targets this way: one mechanism, never a second ignore vocabulary.
      excludePath = configureProjectionExcludes(repoRoot, dir, child, dependencyLinks.map((link) => link.name));
    }
  } catch (error) {
    await cleanup();
    throw error;
  }

  logEvent(opts, 'worktree', 'worktree.integration_checkout_created',
    { dir, target, targetHead, contributionId, dependencyLinks });
  return { dir, target, targetHead, branch: `integrate/${contributionId}`, dependencyLinks, cleanup };
}


// ---------------------------------------------------------------------------
// The landing itself (issue #296)
// ---------------------------------------------------------------------------

/** The environment one commit is authored under. `localGitEnv` blanks the global config so a
 * landing cannot be signed, templated or hook-steered by whatever the host happens to carry — the
 * identities are stated here or the commit does not happen. */
function commitEnv(author, committer) {
  return {
    GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: committer.name, GIT_COMMITTER_EMAIL: committer.email,
    GIT_AUTHOR_DATE: new Date().toISOString(), GIT_COMMITTER_DATE: new Date().toISOString(),
  };
}

/** The lane scaffolding that is never repository content: the brief the seat was handed, and the
 * deployment's own `.baton/` custody tree. A squash that carried either would land one lane's
 * private scaffolding into every other lane's checkout. */
export const INTEGRATION_EXCLUDED_PREFIXES = Object.freeze(['.baton-brief/', '.baton/']);

/** Issue #562: the identity the deployment's own effective-tree snapshot commits under. That
 * snapshot is a lane worktree's BASE (application-deployment.mjs `repositorySnapshot`), so its tree
 * is the resident's own checkout — including whatever that checkout had untracked-and-unignored at
 * the moment the snapshot was taken. ONE derivation: the snapshot writer commits under it and the
 * landing filter below reads it back. */
export const SNAPSHOT_COMMIT_EMAIL = 'baton-snapshot@localhost';

/**
 * Land one contribution's whole range as ONE squashed commit.
 *
 * The range is `merge-base(target, commitSha)..commitSha` — the lane's own work, never
 * `observedHead`, which is stale the moment a lane rebases. The squash is built in a scratch
 * checkout at the target's current head, so `git merge --squash` performs the three-way merge
 * against the target's real state; the regenerated artifacts the caller asks for are folded INTO
 * that one commit (a landing that committed them separately would put a half-regenerated tree on
 * the target for one commit), and the gate set runs before anything moves.
 *
 * Nothing under `<repoRoot>` changes until the fast-forward: every failure throws with the scratch
 * checkout removed and the target exactly where it was.
 *
 * @param {string} repoRoot
 * @param {object} request
 * @param {string} request.contributionId
 * @param {string} request.target local branch the range lands on
 * @param {string} request.commitSha the tip of the range (exact commit)
 * @param {string} request.message the squash commit's message
 * @param {{name: string, email: string}} request.author the seat's actor (the commit's AUTHOR)
 * @param {{name: string, email: string}} request.committer the landing authority (the COMMITTER)
 * @param {(dir: string, paths: {changed: string[], base: string, targetHead: string}) => Promise<{regenerated?: string[]}>} [request.regenerate]
 * @param {string[]} [request.dependencyDirs] the deployment's own dependency directories, when it
 *   configures them; omitted, the scratch checkout derives them from the repository (#451)
 * @param {(dir: string, files: string[], context: object) => Promise<{files: string[], verdictLine: string|null, unexpected: any[]}>} [request.runGates]
 * @param {string|null} [request.publishRemote] the deployment's DECLARED shared remote (a URL or
 *   path from `advanced.integration.publishRemote`): a real landing with one pre-flights the
 *   remote BEFORE the gate run and refuses typed when the destination does not exist, cannot be
 *   reached, or cannot authenticate this environment (#573), then fetches the remote's target
 *   branch and gates on that tip (#570), builds the squash on it, and pushes the landed ref to it
 *   after the fast-forward, naming the declared value itself, never a remote name. Null on a dry
 *   run or a deployment that declares none — a real landing without one refuses
 *   `integrate_publish_undeclared` before anything moves.
 * @param {boolean} [request.dryRun]
 * @param {object} [request.log]
 * @param {(info: {dir: string, target: string}) => Promise<void>} [request.started] the caller's
 *   start hook (#459): called once, the moment the scratch checkout exists and before the squash
 *   or any gate, so the durable record of a landing names its directory while it is still running
 * @returns {Promise<{base: string, target: string, targetHeadBefore: string, targetHeadAfter: string|null,
 *   squashSha: string, changedPaths: string[], regenerated: string[],
 *   gates: {baseSha: string, files: string[], verdictLine: string|null, unexpected: any[]}, dryRun: boolean}>}
 */
export async function landContribution(repoRoot, request) {
  const { contributionId, target, commitSha, message, author, committer } = request;
  integrationSlug(contributionId);
  let tip;
  try {
    tip = sh('git', ['rev-parse', '--verify', `${commitSha}^{commit}`], repoRoot);
  } catch {
    throw Object.assign(
      mergeError(`the contribution commit ${commitSha} is not in this repository`, 'integrate_commit_unreachable'),
      { sha: commitSha },
    );
  }
  const ref = target.startsWith('refs/') ? target : `refs/heads/${target}`;
  let targetHeadBefore;
  try {
    targetHeadBefore = sh('git', ['rev-parse', '--verify', `${ref}^{commit}`], repoRoot);
  } catch {
    throw mergeError(`the target ${target} is not a local branch of this repository`, 'integrate_change_invalid');
  }
  // Issue #558: `publishRemote` is the deployment's DECLARED shared remote — a configuration
  // value, never `origin` (a resident origin has pointed at a local checkout instead of the
  // shared remote) and never derived from repoId (a hash of the local git dir path, distinct per
  // clone). Both flags are read BEFORE the gate run: a real landing with a declared remote
  // pre-flights that remote (#573 below) and gates on its fetched tip (#570 below); a real
  // landing without one refuses before anything moves.
  const dryRun = request.dryRun === true;
  const publishRemote = typeof request.publishRemote === 'string' && request.publishRemote.length > 0
    && !request.publishRemote.includes('\0') ? request.publishRemote : null;
  // Issue #573: the push is the LAST step of a landing, so a declared remote this environment
  // cannot publish to cost the whole derived gate run before the landing learned it — and the
  // report was a bare git tail. Reads prove nothing here: a public-read remote lists refs to an
  // anonymous fetch and still refuses the push, so the pre-flight is a `git push --dry-run` —
  // the same command as the landing's own push, in the SAME publish environment (publishGitEnv:
  // the deployment owner's configured credentials, prompts disabled), naming a THROWAWAY ref
  // (`--dry-run` writes nothing anywhere; the ref never exists on the remote). It runs before
  // the scratch checkout exists and before any gate file runs, and the refusal names which of
  // the two failed: the destination does not exist or cannot be reached, or it answered but
  // this environment holds no credential it accepts. The push itself, its rollback and the #558
  // refusal keep their places: a remote that breaks between pre-flight and push still refuses
  // `integrate_publish_failed` and rolls the local move back.
  if (!dryRun && publishRemote !== null) {
    try {
      gitRemote(['push', '--dry-run', publishRemote, `${targetHeadBefore}:refs/heads/${PUBLISH_AUTH_PROBE_REF}`], repoRoot,
        { stdio: ['ignore', 'pipe', 'pipe'] }, { GIT_TERMINAL_PROMPT: '0' });
    } catch (error) {
      const unauthenticated = GIT_REMOTE_AUTH_FAILURE.test(gitStepTail(error));
      throw Object.assign(
        mergeError(unauthenticated
          ? `this environment cannot authenticate to the declared shared remote for ${target}; give the landing's git environment the push credential it needs`
          : `the declared shared remote for ${target} does not exist or cannot be reached; correct the destination named by advanced.integration.publishRemote`,
        unauthenticated ? 'integrate_publish_unauthenticated' : 'integrate_publish_unreachable'),
        {
          script: 'git push --dry-run',
          ...(Number.isSafeInteger(error.status) ? { exit: error.status } : {}),
          stderrTail: redactPushTail(gitStepTail(error)),
        },
      );
    }
  }
  // Issue #570: the local target ref can drift behind the declared remote (the resident's own
  // master sat commits behind the published tip), and a squash built on the stale head pushes as
  // a non-fast-forward and rolls the landing back. A real landing with a declared remote
  // therefore fetches the remote's target branch FIRST — one git call, in the same publish
  // environment as the push (#573) — and gates on that tip: the landing requires the local ref
  // to be an
  // ancestor of the fetched tip and refuses typed, naming both heads, when the pair has
  // diverged, builds the squash on the fetched tip, and the compare-and-swap below brings the
  // local ref from its stale head to the landed squash in the same step. A remote that does not
  // hold the branch yet is no tip to gate on: the landing proceeds on the local ref, and the push
  // creates the branch there. A dry run — and any deployment that declares no remote — lands on
  // the local ref exactly as before.
  let ontoHead = targetHeadBefore;
  if (!dryRun && publishRemote !== null) {
    let fetchedTip = null;
    let fetched = false;
    try {
      gitRemote(['fetch', '--no-tags', publishRemote, ref], repoRoot,
        { stdio: 'pipe' }, { GIT_TERMINAL_PROMPT: '0' });
      fetched = true;
    } catch (error) {
      // A remote that does not hold the target branch yet (a fresh declaration publishes the
      // first landing to it) has no remote tip to gate on: one `ls-remote` classifies the failed
      // fetch — an absent branch lets the landing proceed on the local ref exactly as a
      // no-remote deployment does, while an unreachable remote, or a branch the probe still sees
      // after the fetch failed, refuses typed.
      let absent = false;
      try {
        absent = String(gitRemote(['ls-remote', '--heads', publishRemote, ref], repoRoot,
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, { GIT_TERMINAL_PROMPT: '0' })).trim() === '';
      } catch { absent = false; }
      if (!absent) {
        throw Object.assign(
          mergeError(`the declared shared remote could not be fetched for ${target}; declare a reachable remote with advanced.integration.publishRemote`, 'integrate_publish_failed'),
          {
            script: 'git fetch',
            ...(Number.isSafeInteger(error.status) ? { exit: error.status } : {}),
            stderrTail: redactPushTail(gitStepTail(error)),
          },
        );
      }
    }
    if (fetched) fetchedTip = sh('git', ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], repoRoot);
    if (fetchedTip !== null && fetchedTip !== targetHeadBefore) {
      let behind = false;
      try {
        sh('git', ['merge-base', '--is-ancestor', targetHeadBefore, fetchedTip], repoRoot);
        behind = true;
      } catch { behind = false; }
      if (!behind) {
        throw Object.assign(
          mergeError(`the target ${target} has diverged from the declared shared remote: the local head ${targetHeadBefore} is not an ancestor of the fetched tip ${fetchedTip}`, 'integrate_target_diverged'),
          { localSha: targetHeadBefore, fetchedSha: fetchedTip },
        );
      }
      ontoHead = fetchedTip;
    }
  }
  // The base rule (#296 item 1). Never the contribution's recorded observedHead: once a lane
  // rebases, that commit is an ancestor of nothing on the target and a squash from it would replay
  // the lane's ancestors as its own work.
  let base;
  try {
    base = sh('git', ['merge-base', ontoHead, tip], repoRoot);
  } catch {
    throw mergeError(`the contribution commit ${commitSha} and ${target} share no common ancestor`, 'integrate_commit_unreachable');
  }
  // Issue #459: the start callback fires ONCE, at the first scratch checkout this landing opens —
  // the re-base path below prepares a SECOND checkout when the target moved, and a second start
  // row would name a landing that never happened twice.
  let started = false;
  const prepare = async (ontoHead) => {
    const checkout = await createIntegrationCheckout(repoRoot, contributionId, {
      target: ontoHead, log: request.log, dependencyDirs: request.dependencyDirs,
    });
    // The caller's start hook runs as soon as the scratch checkout exists — before the squash and
    // before any gate — so the durable record names the directory while the landing is still in
    // flight, and a caller that never sees the outcome still reads where it opened.
    if (!started && typeof request.started === 'function') {
      started = true;
      await request.started({ dir: checkout.dir, target: ontoHead });
    }
    try {
      // `--squash` is the whole point: it takes the lane's range against the common ancestor and
      // stages it as ONE change, so a lane that pinned two checkpoints lands both deltas.
      try {
        sh('git', ['merge', '--squash', tip], checkout.dir);
      } catch (error) {
        const conflicted = sh('git', ['diff', '--name-only', '--diff-filter=U'], checkout.dir)
          .split('\n').filter((line) => line.length > 0).sort();
        await checkout.cleanup();
        if (conflicted.length > 0) {
          throw Object.assign(
            mergeError(`landing ${contributionId} conflicts with ${target} on ${conflicted.length} path(s)`, 'integrate_conflict'),
            { paths: conflicted },
          );
        }
        throw error;
      }
      // Scaffolding never lands. `git rm --cached` on a path the squash did not carry is a no-op,
      // so the exclusion is unconditional and needs no inventory of what the lane happened to commit.
      for (const prefix of INTEGRATION_EXCLUDED_PREFIXES) {
        try {
          gitFile(['rm', '-r', '--cached', '--ignore-unmatch', '-q', prefix], checkout.dir, { stdio: 'pipe' });
        } catch { /* the squash carried no such path */ }
        rmSync(join(checkout.dir, prefix), { recursive: true, force: true });
      }
      const changedBeforeRegeneration = sh('git', ['diff', '--cached', '--name-only'], checkout.dir)
        .split('\n').filter((line) => line.length > 0).sort();
      // Every changed module must at least parse before a regenerator reads it — a generator that
      // consumed a syntactically broken module would write an artifact describing a broken tree.
      // The changed list names deletions too, and a deleted path has no content to parse: its
      // absence IS the change landing (#575, found landing the wake union's retired stall-stop
      // suite), so only content the squash still carries is checked.
      for (const path of changedBeforeRegeneration.filter((entry) => entry.endsWith('.mjs'))) {
        if (!existsSync(join(checkout.dir, path))) continue;
        try {
          execFileSync(process.execPath, ['--check', join(checkout.dir, path)], {
            cwd: checkout.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
            maxBuffer: gitListingMaxBuffer(),
          });
        } catch (error) {
          throw Object.assign(
            mergeError(`the squashed change does not parse: ${path}`, 'integrate_change_invalid'),
            { path, cause: error },
          );
        }
      }
      // The caller's regenerators run INSIDE the squash, so their output is part of the one commit
      // rather than a second one that would leave the target briefly inconsistent. What they moved
      // is read back from git, never from what the callback claims: a regenerator that wrote
      // nothing regenerated nothing, and the receipt says so.
      if (request.regenerate) {
        await request.regenerate(checkout.dir, {
          changed: changedBeforeRegeneration, base, targetHead: ontoHead,
        });
      }
      gitFile(['add', '-A'], checkout.dir, { stdio: 'pipe' });
      // Issue #562: the paths this squash would carry only because the lane's BASE carried them. A
      // lane worktree's base is the deployment's effective-tree snapshot, whose tree is the
      // resident's checkout, so a file the resident had untracked-and-unignored then sits in every
      // lane's base and the squash would land it as that lane's own addition. A path whose FIRST
      // addition in this lane's history is the snapshot commit is the resident's content, never the
      // lane's work: it leaves the index here, and the receipt names every path it took.
      const inherited = [];
      for (const path of sh('git', ['diff', '--cached', '--name-only', '--diff-filter=A'], checkout.dir)
        .split('\n').filter((line) => line.length > 0)) {
        const addedBy = sh('git', ['log', '--reverse', '--diff-filter=A', '--format=%ae', tip, '--', path], checkout.dir)
          .split('\n').find((line) => line.length > 0) ?? null;
        if (addedBy !== SNAPSHOT_COMMIT_EMAIL) continue;
        gitFile(['rm', '--cached', '--quiet', '--', path], checkout.dir, { stdio: 'pipe' });
        inherited.push(path);
      }
      const changed = sh('git', ['diff', '--cached', '--name-only'], checkout.dir)
        .split('\n').filter((line) => line.length > 0).sort();
      const regenerated = changed.filter((path) => !changedBeforeRegeneration.includes(path));
      if (changed.length === 0) {
        await checkout.cleanup();
        throw mergeError(`the contribution range ${base}..${tip} carries no change to land`, 'integrate_change_invalid');
      }
      gitFile(['commit', '-q', '-m', message], checkout.dir, { stdio: 'pipe' }, commitEnv(author, committer));
      const squashSha = sh('git', ['rev-parse', 'HEAD'], checkout.dir);
      // The paths the TARGET also moved since the same base. Git merged these without a conflict —
      // the "silent" overlap the #296 observation says used to be resolved by hand with no record —
      // so the receipt names them even though nothing had to be decided.
      const targetChanged = sh('git', ['diff', '--name-only', base, ontoHead], checkout.dir)
        .split('\n').filter((line) => line.length > 0).sort();
      const overlaps = changed.filter((path) => targetChanged.includes(path));
      return { checkout, squashSha, changed, regenerated, overlaps, inherited, ontoHead };
    } catch (error) {
      await checkout.cleanup();
      throw error;
    }
  };

  let attempt = await prepare(ontoHead);
  // The target moving between the squash and the fast-forward is a race, not a refusal: re-base
  // ONCE onto the new head and only refuse if it moves again. `update-ref` is the CAS that decides.
  if (sh('git', ['rev-parse', '--verify', ref], repoRoot) !== targetHeadBefore) {
    await attempt.checkout.cleanup();
    const moved = sh('git', ['rev-parse', '--verify', ref], repoRoot);
    attempt = await prepare(moved);
    if (sh('git', ['rev-parse', '--verify', ref], repoRoot) !== moved) {
      await attempt.checkout.cleanup();
      throw mergeError(`${target} advanced again while the landing was prepared`, 'integrate_target_moved');
    }
    targetHeadBefore = moved;
  }

  const { checkout, squashSha, changed, regenerated, overlaps, inherited, ontoHead: gateBase } = attempt;
  try {
    // Issue #570: the gate verdict names the base commit it judged — the head the squash
    // descends from, which is the fetched remote tip when the local ref sat behind the declared
    // remote. A red verdict rides the refusal detail, so a refused landing shows which base
    // produced it; a green one lands on the receipt's gates row.
    const gates = request.runGates
      ? await request.runGates(checkout.dir, changed, { base, targetHeadBefore, squashSha })
      : { files: [], verdictLine: null, unexpected: [] };
    const unexpected = Array.isArray(gates?.unexpected) ? gates.unexpected : [];
    if (unexpected.length > 0) {
      throw Object.assign(
        mergeError(`the derived gate set ran red: ${unexpected.length} test(s) fail with the change and pass on the target`, 'integrate_gates_red'),
        { verdictLine: gates?.verdictLine ?? null, unexpected, baseSha: gateBase },
      );
    }
    // A landing that cannot publish never reports a local success. A dry run lands nothing, so
    // it publishes nothing either.
    if (!dryRun && publishRemote === null) {
      throw mergeError(
        `the deployment declares no shared remote for landings (advanced.integration.publishRemote), so ${target} cannot be published`,
        'integrate_publish_undeclared');
    }
    if (!dryRun) {
      // One atomic compare-and-swap: if anything moved the target after the gates, this fails
      // rather than landing a squash computed against a head the branch no longer has.
      try {
        gitFile(['update-ref', ref, squashSha, targetHeadBefore], repoRoot, { stdio: 'pipe' });
      } catch (error) {
        throw Object.assign(mergeError(`${target} moved before the fast-forward`, 'integrate_target_moved'), { cause: error });
      }
      // Issue #558: publish the landed ref to the declared remote. The push names the declared
      // value itself, never a remote name, so no local remote configuration the resident holds
      // can redirect it — a landing published to the wrong destination is the same failure as
      // never publishing. The push runs under publishGitEnv (#573): the deployment owner's
      // configured credential helper answers the remote, and GIT_TERMINAL_PROMPT=0 so a remote
      // that wants an interactive credential fails typed instead of hanging the landing on a
      // prompt. A failed push rolls the local move back, so the target holds no unpublished
      // squash. Neither step checks out a branch: a detached main checkout stays detached.
      try {
        gitRemote(['push', publishRemote, `${squashSha}:${ref}`], repoRoot,
          { stdio: 'pipe' }, { GIT_TERMINAL_PROMPT: '0' });
        // Issue #556: read the DECLARED destination back. A push reports success against whatever
        // its URL resolved to, so a landing could publish somewhere else — an intermediate
        // checkout, a push-only rewrite — while every in-process signal read as a real publish.
        // The landed ref has to be the tip the declared destination itself reports.
        const observedTip = publishedTip(repoRoot, publishRemote, ref);
        if (observedTip !== squashSha) {
          throw Object.assign(new Error(`${publishRemote} reports ${observedTip ?? 'no tip'} at ${ref}`), {
            code: 'integrate_publish_unverified', observedTip,
          });
        }
      } catch (error) {
        let rolledBack = false;
        try {
          gitFile(['update-ref', ref, targetHeadBefore, squashSha], repoRoot, { stdio: 'pipe' });
          rolledBack = true;
        } catch { /* the refusal below still answers; rolledBack: false names the state */ }
        // #556: a destination that does not report the landed squash is refused under its own code
        // and names the tip it did report; a push that failed keeps #558's vocabulary.
        const unverified = error?.code === 'integrate_publish_unverified';
        throw Object.assign(
          mergeError(unverified
            ? `the declared shared remote does not report the landed ${target}; the push to it is unverified`
            : `the declared shared remote could not publish ${target}; declare a reachable remote with advanced.integration.publishRemote`,
            unverified ? 'integrate_publish_unverified' : 'integrate_publish_failed'),
          {
            script: 'git push',
            ...(Number.isSafeInteger(error.status) ? { exit: error.status } : {}),
            ...(unverified ? { observedTip: error.observedTip ?? null } : {}),
            stderrTail: redactPushTail(gitStepTail(error)),
            rolledBack,
          },
        );
      }
    }
    logEvent(request, 'worktree', 'worktree.contribution_landed', {
      contributionId, target, base, targetHeadBefore, squashSha, changedPaths: changed, dryRun,
      ...(inherited.length === 0 ? {} : { inherited }),
    });
    return {
      base, target, targetHeadBefore,
      targetHeadAfter: dryRun ? null : squashSha,
      squashSha, changedPaths: changed, regenerated, overlaps, inherited,
      gates: {
        baseSha: gateBase,
        files: [...(gates?.files ?? [])],
        verdictLine: gates?.verdictLine ?? null,
        unexpected: [],
      },
      dryRun,
    };
  } finally {
    await checkout.cleanup();
  }
}

// ---------------------------------------------------------------------------
// Workspace carry (issue #385)
// ---------------------------------------------------------------------------

/** The changed paths in a workspace whose owner may be dead — the files a resume-from
 * successor inherits. Returns [] when the workspace has no metadata or no changes. */
export function workspaceChangedPaths(repoRoot, taskId) {
  normalizePhysicalOwnerId(taskId, 'taskId');
  const root = authorityRoot(repoRoot, 'wt', { create: false });
  const dir = join(root ?? join(realpathSync(repoRoot), '.baton', 'wt'), taskId);
  if (!existsSync(dir)) return [];
  const meta = readMeta(repoRoot, taskId);
  if (!meta?.baseSha) return [];
  return changedPathsFromBase(dir, meta.baseSha);
}

/** Whether a workspace directory exists on disk. */
export function workspaceExists(repoRoot, taskId) {
  normalizePhysicalOwnerId(taskId, 'taskId');
  const root = authorityRoot(repoRoot, 'wt', { create: false });
  const dir = join(root ?? join(realpathSync(repoRoot), '.baton', 'wt'), taskId);
  return existsSync(dir);
}

/** The bounded tail of a git step's stderr (the #326 discipline: a readable line, never a raw
 * `Command failed` dump) — the ONE bound every post-effect git failure this module reports. */
const GIT_STEP_TAIL_BYTES = 480;
function gitStepTail(error) {
  const stderr = Buffer.isBuffer(error?.stderr) ? error.stderr.toString('utf8') : String(error?.stderr ?? '');
  const text = stderr.trim().length > 0 ? stderr.trim() : String(error?.message ?? error);
  return text.slice(-GIT_STEP_TAIL_BYTES);
}

/** Issue #556: the tip one ref holds AT a destination, read from that destination. An absent ref
 * answers null; a destination that cannot be read throws, and the caller composes the refusal. The
 * read names the same value the push named, so a rewrite that redirects only the push — a
 * pushInsteadOf rule, a mirror that drops the ref — lands here as a mismatch. */
function publishedTip(repoRoot, remote, ref) {
  const out = gitRemote(['ls-remote', remote, ref], repoRoot,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, { GIT_TERMINAL_PROMPT: '0' });
  const line = String(out).split('\n').map((row) => row.trim()).find((row) => row.length > 0) ?? null;
  return line === null ? null : line.split(/\s+/u)[0] ?? null;
}

/** #453: the bounded cause of a failed snapshot carry — kept on the error so the refusal that
 * answers it names the reason instead of swallowing it into an empty carry. */
function snapshotCarryFailure(cwd, error) {
  const tail = gitStepTail(error);
  return Object.assign(new Error(`snapshot carry into ${cwd} failed: ${tail}`), {
    code: 'snapshot_carry_failed', detail: tail, cause: error,
  });
}

/** The bounded, redacted tail of a failed publish push: the shared sanitizer's vocabulary plus a
 * URL-userinfo mask it carries no row for, so a declared remote with embedded credentials never
 * crosses into a recorded refusal verbatim. */
function redactPushTail(tail) {
  return sanitizeVerifierDiagnosticText(tail).text.replace(/:\/\/[^/\s]+@/gu, '://***@');
}

/** Apply the diff between baseSha and snapshotSha from the repository into a target worktree.
 * Used when a predecessor's workspace was removed but its snapshot commit is available. Returns
 * the changed paths the target now holds; a failure throws with its bounded cause on `detail`
 * (#453), never a silently empty carry. */
export function applySnapshotToWorktree(repoRoot, snapshotSha, targetDir, baseSha) {
  let patch;
  try {
    patch = gitFile(['diff', '--binary', baseSha, snapshotSha], repoRoot, { encoding: 'buffer' });
  } catch (error) {
    throw snapshotCarryFailure(targetDir, error);
  }
  if (patch.length > 0) {
    try {
      gitFile(['apply', '--whitespace=nowarn'], targetDir, { input: patch, stdio: 'pipe' });
    } catch (error) {
      throw snapshotCarryFailure(targetDir, error);
    }
  }
  return changedPathsFromBase(targetDir, baseSha);
}


// ---------------------------------------------------------------------------
// reap
// ---------------------------------------------------------------------------

/**
 * @param {string} repoRoot
 * @param {string} taskId
 * @param {{force?: boolean, deleteBranch?: boolean, retainOwnerReceipt?: boolean, log?: object,
 *   custodyHolders?: Function, excludeHolderId?: string}} [opts]
 *   `custodyHolders` is the injected live-holder provider (see assertRemovableContent) and
 *   `excludeHolderId` names the handle performing this cleanup, which is not a co-holder of it.
 * @returns {Promise<void>}
 * @throws {WorktreeLockedError} when the worktree was never markStopped and `force` is not set
 * @throws {WorkspacePreservationError} when the checkout holds content no capture recorded —
 *   nothing is removed, released or logged in that case
 * @throws {WorkspaceCustodyError} when another live holder still works in the checkout — nothing
 *   is removed, released or logged in that case either
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
    // Preservation and custody are invariants of this boundary: `force` overrides the stop latch,
    // never the retention of content that no capture recorded and never another live holder's
    // checkout.
    assertRemovableContent(repoRoot, taskId, opts);
  }
  if (existsSync(dir)) {
    try { sh('git', ['worktree', 'remove', '--force', dir], repoRoot); }
    catch { rmSync(dir, { recursive: true, force: true }); }
  }
  // A missing directory may still retain Git administration. Remove only the exact path-bound
  // registration; a global prune could destroy another owner's pre-settlement authority.
  try { removeExactWorktreeRegistration(repoRoot, dir); }
  catch (error) { throw Object.assign(new WorktreeCleanupError('owned worktree administration could not be removed'), { cause: error }); }
  // Issue #428: a physical owner's lane branch is a durable identity. Deletion here holds
  // only for a branch provably WITHOUT unique work — its tip exactly the recorded base —
  // so stop/drain can never orphan committed seat work the branch alone named. Legacy
  // logical owners keep the exact prior behavior.
  const physicalOwner = isPhysicalWorkspaceId(taskId);
  let branchRetained = false;
  if (opts.deleteBranch) {
    let deletable = true;
    if (physicalOwner) {
      try {
        const meta = validatedMetadata(repoRoot, taskId);
        deletable = sh('git', ['rev-parse', '--verify', `refs/heads/baton/${taskId}^{commit}`], repoRoot) === meta.baseSha;
      } catch { deletable = false; } // unprovable → the branch is retained custody
    }
    if (deletable) {
      try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); sh('git', ['branch', '-D', `baton/${taskId}`], repoRoot); }
      catch {
        // A failed existence probe is the idempotent absent case. A surviving ref below is red.
      }
    } else {
      branchRetained = true;
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
  // A branch retained under the custody rule above is an outcome, not residue (issue #428).
  if (existsSync(dir) || existsSync(metaFile) || existsSync(projectionExclude) || registered
    || (branchPresent && !branchRetained)) {
    throw new WorktreeCleanupError('owned worktree cleanup did not reach an exact absent state');
  }
  try { if (opts.retainOwnerReceipt !== true) releasePhysicalWorkspaceOwner(repoRoot, taskId); }
  catch (error) { throw Object.assign(new WorktreeCleanupError('physical workspace owner receipt could not be released'), { cause: error }); }
  logEvent(opts, taskId, 'worktree.reaped', { dir });
}

// ---------------------------------------------------------------------------
// reconcile
// ---------------------------------------------------------------------------

/**
 * Reconcile workspace ownership against this controller's authority.
 *
 * Content preservation and shared-checkout custody are invariants of this boundary: a checkout
 * whose owner is not expected and whose controller is not live is removed only when it holds no
 * content this repository's captures never recorded AND no other live holder still works in it.
 * Otherwise it is retained with a typed diagnostic, the owner joins `retainedContentOwners`, and
 * it enters the retained set so its capacity reservation evidence and owner receipt are not
 * settled for a resource that still exists.
 *
 * @param {string} repoRoot
 * @param {string[]} expectedActiveTaskIds
 * @param {{log?: object, ownerAuthority?: object, expectedOwnerBindings?: object[],
 *   sparseCheckoutIdentity?: object, custodyHolders?: Function, beforeOwnerCleanup?: Function}} [opts]
 * @returns {Promise<{prunedAdminEntries:string[], removedZombieDirs:string[], removedIntegrationDirs:string[], removedVerifyDirs:string[], errors:string[]}>}
 */
export function reconcile(repoRoot, expectedActiveTaskIds = [], opts = {}) {
  const report = {
    prunedAdminEntries: [], removedZombieDirs: [], removedIntegrationDirs: [],
    removedVerifyDirs: [], validatedExpectedOwners: [], retainedExpectedOwners: [],
    validatedExpectedBindings: [], retainedExpectedBindings: [],
    removedPhysicalOwners: [],
    // Issue #428: physical-owner checkouts this reconciliation removed, each with the
    // snapshot (the lane-branch tip that already contained every change) backing the removal.
    removedWorkspaces: [],
    // Owners retained because their checkout holds content no capture recorded.
    retainedContentOwners: [],
    // Receipt-only-loop records retained as ambiguous residue (rule 2's refusal set): the open
    // must fail on these. Loop-1 (checkout-present) records with the same diagnostic code proceed,
    // so the loop origin — known only here — is what the facade keys its refusal on.
    receiptOnlyRefusals: [],
    diagnostics: [], errors: [],
  };
  let registrationsBeforePrune = [];
  try { registrationsBeforePrune = listWorktrees(repoRoot); }
  catch (err) { report.errors.push(`registration-scan: ${err.message || err}`); }
  // A shared repository is not an exclusive controller namespace. Verification and
  // integration handles own their explicit cleanup; directory placement alone proves neither
  // abandonment nor process closure. Until these operations carry durable ownership/closure
  // receipts, retain their workspaces and report the uncertainty. Starting or draining another
  // controller must never delete a verifier's cwd or an integration candidate still in use.
  const retainedSandboxes = new Set();
  function retainSandbox(path, kind) {
    const absolute = pathResolve(path);
    if (retainedSandboxes.has(absolute)) return;
    retainedSandboxes.add(absolute);
    report.diagnostics.push(Object.freeze({
      code: 'workspace_auxiliary_owner_unproven', path, kind,
      authority: 'unproven', retained: true,
    }));
  }
  for (const kind of ['integrate', 'verify']) {
    try {
      const root = authorityRoot(repoRoot, kind, { create: false });
      if (!root) continue;
      for (const entry of readdirSync(root)) {
        try {
          const path = authorityChild(repoRoot, kind, entry, { kind: 'directory', mustExist: true });
          retainSandbox(path, kind);
        } catch (error) {
          // The owning operation may have completed cleanup since this snapshot began.
          try { lstatSync(join(root, entry)); }
          catch (observed) { if (observed?.code === 'ENOENT') continue; }
          report.errors.push(`${kind}/${entry}: ${error.message || error}`);
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') report.errors.push(`${kind}-root: ${error.message || error}`);
    }
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
        const match = WORKSPACE_OWNER_TEMP_NAME.exec(name);
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
      if (expected.has(taskId) && isPhysicalWorkspaceId(normalizedTaskId)) {
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
          if (isPhysicalWorkspaceId(normalizedTaskId)) {
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
      if (expected.has(taskId) && isPhysicalWorkspaceId(normalizedTaskId)
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
      if (existsSync(fullDir)) {
        // Content preservation and custody are decided before capacity settlement: a retained
        // checkout still consumes its reservation, so the settlement callback must never be
        // consulted for it.
        try {
          assertRemovableContent(repoRoot, normalizedTaskId, opts);
        } catch (error) {
          if (!(error instanceof WorkspacePreservationError)
            && !(error instanceof WorkspaceCustodyError)) throw error;
          const observation = error.observation;
          report.diagnostics.push(Object.freeze({
            code: error.code, physicalOwnerId: normalizedTaskId,
            deploymentId: ownerReceipt?.deploymentId ?? null,
            logicalTaskId: ownerReceipt?.logicalTaskId ?? null,
            authority: ownerReceipt ? ownerState : 'unproven', retained: true,
            contentState: observation.state,
            dirtyPaths: observation.dirtyPaths,
            headSha: observation.headSha, baseSha: observation.baseSha,
            ...(error instanceof WorkspaceCustodyError ? { holders: error.holders } : {}),
          }));
          if (!report.retainedContentOwners.includes(normalizedTaskId)) {
            report.retainedContentOwners.push(normalizedTaskId);
          }
          // A retained checkout keeps consuming its owner's capacity: joining the retained set is
          // what keeps the reservation row from being settled for a resource that still exists.
          retainExpected(normalizedTaskId);
          continue;
        }
      }
      // Issue #428: a checkout orphaned by a crash whose lane branch does not already
      // contain every change is LEFT IN PLACE — a stop or a resume settles the seat later.
      // Only a checkout whose branch contains its HEAD may be removed here, and the row
      // says so before the removal happens.
      let crashSnapshotSha = null;
      if (isPhysicalWorkspaceId(normalizedTaskId) && existsSync(fullDir)) {
        const lane = laneBranchState(repoRoot, normalizedTaskId, fullDir);
        if (!lane.branchSha || !lane.contained) {
          report.diagnostics.push(Object.freeze({
            code: 'workspace_owner_head_uncontained_retained', physicalOwnerId: normalizedTaskId,
            deploymentId: ownerReceipt?.deploymentId ?? null,
            logicalTaskId: ownerReceipt?.logicalTaskId ?? null,
            authority: ownerReceipt ? ownerState : 'unproven', retained: true,
            headSha: lane.headSha, branch: lane.branch,
          }));
          logEvent(opts, normalizedTaskId, 'worktree.custody_retained', {
            workspaceId: normalizedTaskId, participantId: null,
            code: 'workspace_owner_head_uncontained_retained', reason: 'crash_reconciliation',
            headSha: lane.headSha, branch: lane.branch,
          });
          retainExpected(normalizedTaskId);
          continue;
        }
        crashSnapshotSha = lane.branchSha;
        logEvent(opts, normalizedTaskId, 'worktree.snapshotted', {
          workspaceId: normalizedTaskId, participantId: null,
          sha: lane.branchSha, branch: lane.branch, reason: 'crash_reconciliation',
        });
      }
      if (isPhysicalWorkspaceId(normalizedTaskId)) {
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
        // Issue #428: decide branch custody BEFORE the owner metadata is removed — the
        // workless proof reads the recorded base. A physical owner's lane branch that
        // carries work beyond its base is never deleted by the reconciliation (a surviving
        // branch is the custody outcome, not residue); a provably workless branch (tip
        // exactly the base) is cleaned up as before, and legacy owners keep the exact
        // prior behavior.
        let branchPresent = false;
        try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); branchPresent = true; } catch { /* absent */ }
        const hadBranch = branchPresent;
        const physicalOwner = isPhysicalWorkspaceId(normalizedTaskId);
        let branchWorkless = !physicalOwner;
        if (physicalOwner && branchPresent) {
          try {
            const meta = validatedMetadata(repoRoot, normalizedTaskId);
            branchWorkless = sh('git', ['rev-parse', '--verify', `refs/heads/baton/${taskId}^{commit}`], repoRoot) === meta.baseSha;
          } catch { branchWorkless = false; } // unprovable → the branch is retained custody
        }
        if (existsSync(metaFile)) rmSync(authorityChild(repoRoot, 'wt', `${normalizedTaskId}.meta.json`, { kind: 'file', mustExist: true }), { force: true });
        if (existsSync(projectionExclude)) rmSync(authorityChild(repoRoot, 'wt', `${normalizedTaskId}.projection.exclude`, { kind: 'file', mustExist: true }), { force: true });
        if (branchPresent && branchWorkless) sh('git', ['branch', '-D', `baton/${taskId}`], repoRoot);
        try { sh('git', ['show-ref', '--verify', '--quiet', `refs/heads/baton/${taskId}`], repoRoot); branchPresent = true; } catch { branchPresent = false; }
        if (existsSync(fullDir) || existsSync(metaFile) || existsSync(projectionExclude)
          || (branchPresent && !branchWorkless)) {
          throw new WorktreeCleanupError('reconciled worker ownership remained after cleanup');
        }
        if (hadDir) report.removedZombieDirs.push(fullDir);
        if (hadResidue || hadBranch) logEvent(opts, taskId, 'worktree.reconciled', { dir: fullDir });
        if (hadDir && physicalOwner) {
          logEvent(opts, taskId, 'worktree.removed', {
            workspaceId: normalizedTaskId, participantId: null,
            reason: 'crash_reconciliation', snapshot: crashSnapshotSha,
            branch: `baton/${taskId}`,
          });
        }
        if (hadDir && physicalOwner) {
          report.removedWorkspaces.push(Object.freeze({
            physicalOwnerId: normalizedTaskId, snapshot: crashSnapshotSha,
            branch: `baton/${taskId}`,
          }));
        }
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
      // A receipt whose checkout, registration and branch are all absent is still not reapable
      // while another live holder names it: releasing the lease under a working holder would
      // destroy its cleanup authority. This is the same custody answer the checkout-present path
      // gets, applied to the residue path.
      const heldByOthers = liveWorkspaceHolders(opts, physicalOwnerId);
      if (heldByOthers.length > 0) {
        report.diagnostics.push(Object.freeze({
          code: 'workspace_other_holder_live_retained', physicalOwnerId,
          deploymentId: receipt.deploymentId, logicalTaskId: receipt.logicalTaskId,
          authority: workspaceOwnerAuthorityState(receipt, opts.ownerAuthority), retained: true,
          holders: heldByOthers,
        }));
        if (expected.has(physicalOwnerId)) retainExpected(physicalOwnerId);
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
    if (!isPhysicalWorkspaceId(physicalOwnerId)
      || report.validatedExpectedOwners.includes(physicalOwnerId)
      || report.retainedExpectedOwners.includes(physicalOwnerId)) continue;
    report.diagnostics.push(Object.freeze({
      code: 'workspace_owner_receipt_missing', physicalOwnerId,
      deploymentId: null, logicalTaskId: null, authority: 'unproven', retained: true,
    }));
    retainExpected(physicalOwnerId);
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
        // A registered path may not yet exist (allocation in progress), or may already have
        // been removed by its cleanup owner. Registration is not orphan/cleanup authority.
        retainSandbox(entry.dir, absolute.startsWith(verifyPrefix) ? 'verify' : 'integrate');
        continue;
      }
      const withinWorkers = pathRelative(workerRoot, absolute);
      if (withinWorkers !== '' && withinWorkers !== '..' && !withinWorkers.startsWith(`..${sep}`) && !isAbsolute(withinWorkers)) {
        const taskId = withinWorkers.split(sep)[0];
        if (!expected.has(taskId) && !retainedOwners.has(taskId)) report.errors.push(`registered-zombie-worker:${taskId}`);
      }
    }
    for (const taskId of localWorkerCandidates) {
      // Issue #428: a physical owner's lane branch is a durable identity — a surviving
      // branch after reconciliation is custody, never a zombie. Legacy owners keep the check.
      if (isPhysicalWorkspaceId(taskId)) continue;
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
