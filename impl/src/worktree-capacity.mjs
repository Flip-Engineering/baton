// Deployment-owned, repo-scoped worktree capacity reservations. Sparse checkout is an
// optimization and integrity identity, not a quota; this preflight prevents known selected-tree,
// projected-toolchain, and runtime allowances from overcommitting a fleet before Git effects.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmSync, statfsSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { compareCanonicalStrings } from './canonical-order.mjs';
// G-32: this module's git calls (defaultEstimate's `ls-tree -r -l -z` above all) share the ONE
// whole-repository listing bound with worktree.mjs rather than restating a buffer size.
import { gitListingMaxBuffer } from './worktree.mjs';

export class WorktreeCapacityError extends Error {
  constructor(message, code = 'worktree_capacity_exceeded') { super(message); this.name = 'WorktreeCapacityError'; this.code = code; }
}

const POLICY_FIELDS = Object.freeze([
  'maxReservedBytes', 'maxReservedInodes', 'minFreeBytes', 'minFreeInodes',
  'runtimeReserveBytes', 'runtimeReserveInodes',
]);
const RESERVATION_FIELDS = Object.freeze([
  'id', 'kind', 'resourceId', 'ownerId', 'nonce', 'pid', 'bytes', 'inodes', 'baseSha',
  'sparseDigest', 'toolchainProjectionDigest', 'createdAt', 'materializedAt',
  'outstandingBytes', 'outstandingInodes',
]);

// Independent deployments mutate one repository ledger, so every capacity MUTATION serializes on
// a published owner record. READING the ledger takes no lock and never waits: the state is one
// atomically renamed file, so a reader observes a complete committed state while a writer holds
// the critical section. The mutating API is promise-returning (issue #285 G-42): contention is
// absorbed by awaiting short slices until the deadline, so the caller's event loop stays free
// while the wait runs. The deadline is real elapsed time (`performance.now`, monotonic),
// never the injectable domain clock — fixtures freeze that clock for timestamps, and a frozen
// clock must never become an unbounded wait. Every non-progress turn of the acquisition loop ends
// in `_waitSlice`, so no state (live holder, live gate, dead lock, churn) can loop past the
// deadline.
const LOCK_POLL_MS = 5;
const DEFAULT_LOCK_WAIT_MS = 5_000;
const LOCK_LABEL = 'worktree capacity reservation lock';
const REAPER_LABEL = 'worktree capacity reservation lock reaper gate';

/** One awaited poll slice of the acquisition loop (issue #285 G-42): the wait is the caller's to
 * await, so the slice never blocks the thread's event loop. */
function awaitLockSlice(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
}

function fsyncDirectory(path) {
  try { const fd = openSync(path, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); } }
  catch { /* directory fsync is not supported by every platform */ }
}

function readIntegrityKey(path) {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size !== 32) throw typed('worktree capacity integrity key is invalid', 'worktree_capacity_unavailable');
    return readFileSync(path);
  }
  return null;
}

export function loadOrCreateWorktreeCapacityIntegrityKey(repoRoot) {
  const repo = realpathSync(repoRoot); const baton = join(repo, '.baton'); const root = join(baton, 'capacity'); const path = join(root, 'integrity.key');
  for (const directory of [baton, root]) {
    // Concurrent deployment processes opening the same fresh repository race here; losing
    // that race is normal. Only EEXIST is adopted, and the confinement checks below still
    // refuse a pre-existing file, symlink, or escaping directory, so authority is unchanged.
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw typed('worktree capacity key root could not be created', 'worktree_capacity_unavailable', error);
    }
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw typed('worktree capacity key root is not a confined directory', 'worktree_capacity_unavailable');
    chmodSync(directory, 0o700);
    const within = relative(repo, realpathSync(directory));
    if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw typed('worktree capacity key root escapes repository', 'worktree_capacity_unavailable');
  }
  const existing = readIntegrityKey(path);
  if (existing) return existing;
  const key = randomBytes(32); const temp = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`; let fd;
  try {
    fd = openSync(temp, 'wx', 0o600); writeFileSync(fd, key); fsyncSync(fd); closeSync(fd); fd = undefined;
    try { linkSync(temp, path); }
    catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const raced = readIntegrityKey(path);
      if (!raced) throw error;
      return raced;
    } finally { rmSync(temp, { force: true }); }
    fsyncDirectory(root);
    return key;
  } catch (error) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* no-op */ }
    rmSync(temp, { force: true }); throw typed('worktree capacity integrity key could not be created', 'worktree_capacity_unavailable', error);
  }
}

function localGitEnv() {
  const env = {}; for (const [key, value] of Object.entries(process.env)) if (!key.startsWith('GIT_')) env[key] = value;
  return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
}

function git(args, cwd, opts = {}) {
  return execFileSync('git', args, {
    maxBuffer: gitListingMaxBuffer(), cwd, encoding: 'utf8', env: localGitEnv(), ...opts,
  });
}

function typed(message, code = 'worktree_capacity_exceeded', cause) {
  return Object.assign(new WorktreeCapacityError(message, code), cause ? { cause } : {});
}

export function normalizeWorktreeCapacityPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...POLICY_FIELDS].sort().join(',')) throw new TypeError('worktreeCapacity must be one closed policy');
  const normalized = {};
  for (const field of POLICY_FIELDS) {
    const item = value[field];
    // A null ceiling is "no configured ceiling"; a null floor (#307) is "derive this floor from
    // the deployment's own records" — both are configurations, and the digest pins WHICH one is
    // configured so a later switch cannot happen silently under live reservations.
    if ((field.startsWith('maxReserved') || field.startsWith('minFree')) && item === null) {
      normalized[field] = null;
      continue;
    }
    if (!Number.isSafeInteger(item) || item < 0) throw new TypeError(`worktreeCapacity.${field} must be a non-negative safe integer or null`);
    normalized[field] = item;
  }
  if ((normalized.maxReservedBytes !== null && (normalized.maxReservedBytes <= 0
      || normalized.runtimeReserveBytes > normalized.maxReservedBytes))
    || (normalized.maxReservedInodes !== null && (normalized.maxReservedInodes <= 0
      || normalized.runtimeReserveInodes > normalized.maxReservedInodes))) throw new TypeError('worktreeCapacity ceilings are inconsistent');
  return Object.freeze({ ...normalized, digest: digest(normalized) });
}

/** #307: THE FLOOR IS A RECORD, NOT A CONSTANT. The workspace floor beneath one reservation wave
 * is the largest checkout estimate this deployment has ever recorded (its ledger's high-water —
 * "room for one more participant") plus the runtime footprint the deployment measures from its
 * own records (ledger and evidence directories; worker homes are already the checkout estimates
 * the high-water carries). Deployment policy may still pin `minFreeBytes`/`minFreeInodes`
 * explicitly — a configured floor replaces the derivation, and the policy digest pins which of
 * the two regimes is in force. Every input is a measurement or a deployment record; nothing here
 * is chosen. */
export function deriveWorktreeCapacityFloor({
  estimateHighWaterBytes, estimateHighWaterInodes, runtimeFootprintBytes, runtimeFootprintInodes,
}) {
  for (const [field, value] of Object.entries({
    estimateHighWaterBytes, estimateHighWaterInodes, runtimeFootprintBytes, runtimeFootprintInodes,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`worktree capacity floor derivation requires a non-negative safe integer ${field}`);
  }
  return Object.freeze({
    bytes: estimateHighWaterBytes + runtimeFootprintBytes,
    inodes: estimateHighWaterInodes + runtimeFootprintInodes,
  });
}

/** #307: the ONE capacity-pressure predicate. True when the deployment's workspace capacity
 * observation has crossed the floor — the deployment-level fact the view's deployment summary
 * carries (`capacityPressure`) and the wake stream lane turns into a capacity_pressure wake.
 * Reads the doctor/workspace readiness shape: an explicit `pressure` flag, a blocked typed
 * observation, or free-below-floor numbers. */
export function workspaceCapacityPressure(workspace) {
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return false;
  if (workspace.pressure === true) return true;
  if (workspace.state === 'blocked' && workspace.code === 'worktree_capacity_exceeded') return true;
  if (!Number.isSafeInteger(workspace.freeBytes) || !Number.isSafeInteger(workspace.floorBytes)) return false;
  return workspace.freeBytes < workspace.floorBytes
    || (Number.isSafeInteger(workspace.freeInodes) && Number.isSafeInteger(workspace.floorInodes)
      && workspace.freeInodes < workspace.floorInodes);
}

function defaultObserve({ repoRoot }) {
  const stats = statfsSync(repoRoot);
  return {
    freeBytes: Number(stats.bavail) * Number(stats.bsize),
    freeInodes: Number(stats.ffree),
  };
}

function selected(path, sparseIdentity) {
  return sparseIdentity.mode === 'full' || sparseIdentity.paths.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function projectionTargetParents(toolchainProjection, parents) {
  if (!Array.isArray(parents) || parents.length !== toolchainProjection.targetParentDirectoryCount) {
    throw typed('toolchain projection capacity identity is unavailable', 'worktree_capacity_unavailable');
  }
  const unique = new Set();
  for (const parent of parents) {
    if (typeof parent !== 'string' || parent.length === 0 || parent.includes('\\')
      || parent.normalize('NFC') !== parent || /[\u0000-\u001f\u007f]/u.test(parent)) {
      throw typed('toolchain projection capacity identity is unavailable', 'worktree_capacity_unavailable');
    }
    const parts = parent.split('/');
    if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
      throw typed('toolchain projection capacity identity is unavailable', 'worktree_capacity_unavailable');
    }
    unique.add(parent);
  }
  const ordered = [...unique].sort(compareCanonicalStrings);
  if (unique.size !== parents.length || digest(ordered) !== toolchainProjection.targetParentDirectoryDigest) {
    throw typed('toolchain projection capacity identity is unavailable', 'worktree_capacity_unavailable');
  }
  return unique;
}

function defaultEstimate({ repoRoot, baseSha, sparseCheckoutIdentity, toolchainProjection, toolchainProjectionTargetParents, policy }) {
  const raw = git(['ls-tree', '-r', '-l', '-z', baseSha], repoRoot);
  let bytes = policy.runtimeReserveBytes;
  let inodes = policy.runtimeReserveInodes;
  const directories = new Set();
  for (const row of raw.split('\0').filter(Boolean)) {
    const tab = row.indexOf('\t'); if (tab < 0) throw typed('Git tree capacity estimate is malformed', 'worktree_capacity_unavailable');
    const header = row.slice(0, tab).trim().split(/\s+/u); const path = row.slice(tab + 1);
    if (!selected(path, sparseCheckoutIdentity)) continue;
    const size = header.at(-1);
    if (size !== '-' && !/^\d+$/u.test(size)) throw typed('Git tree capacity estimate is malformed', 'worktree_capacity_unavailable');
    if (size !== '-') bytes += Number(size);
    inodes += 1;
    const parts = path.split('/'); for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join('/'));
  }
  if (toolchainProjection) {
    const targetParents = projectionTargetParents(toolchainProjection, toolchainProjectionTargetParents);
    const existingTargetParents = [...targetParents].filter((parent) => directories.has(parent)).length;
    bytes += toolchainProjection.byteCount;
    inodes += toolchainProjection.fileCount + toolchainProjection.directoryCount - existingTargetParents;
  }
  inodes += directories.size;
  return { bytes, inodes };
}

function validateMeasurement(value, label, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...fields].sort().join(',')) throw typed(`${label} returned an invalid shape`, 'worktree_capacity_unavailable');
  for (const field of fields) if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw typed(`${label} returned an invalid value`, 'worktree_capacity_unavailable');
  return value;
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* no-op */ }
    rmSync(temp, { force: true }); throw error;
  }
}

function publishExclusive(root, path, value, generation) {
  const temp = join(root, `.publish-${generation}.tmp`); let fd;
  try {
    fd = openSync(temp, 'wx', 0o600); writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8'); fsyncSync(fd); closeSync(fd); fd = undefined;
    linkSync(temp, path); unlinkSync(temp); fsyncDirectory(root);
  } catch (error) {
    if (fd !== undefined) try { closeSync(fd); } catch { /* no-op */ }
    rmSync(temp, { force: true }); throw error;
  }
}

function livePid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function validLockOwner(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === ['generation', 'ownerId', 'pid', 'schemaVersion'].sort().join(',')
    && value.schemaVersion === 1 && Number.isSafeInteger(value.pid) && value.pid > 0
    && typeof value.ownerId === 'string' && /^[a-f0-9]{32}$/u.test(value.ownerId)
    && typeof value.generation === 'string' && /^[a-f0-9]{32}$/u.test(value.generation);
}

export class WorktreeCapacityAuthority {
  constructor({
    repoRoot, policy, integrityKey, observe = defaultObserve, estimate = defaultEstimate,
    runtimeFootprint = null, now = Date.now, lockWaitMs = DEFAULT_LOCK_WAIT_MS,
  }) {
    this.repoRoot = repoRoot;
    this.policy = normalizeWorktreeCapacityPolicy(policy);
    if (!Buffer.isBuffer(integrityKey) || integrityKey.byteLength !== 32) throw new TypeError('worktree capacity requires one 32-byte integrity key');
    if (typeof observe !== 'function' || typeof estimate !== 'function' || typeof now !== 'function') throw new TypeError('worktree capacity dependencies must be functions');
    if (runtimeFootprint !== null && typeof runtimeFootprint !== 'function') throw new TypeError('worktree capacity runtime footprint must be a function when provided');
    // A derived floor (#307) is resolved at each admission from the ledger high-water plus the
    // deployment-measured runtime footprint; without the footprint dependency the derivation
    // cannot be honest, so a null floor field requires it.
    if ((this.policy.minFreeBytes === null || this.policy.minFreeInodes === null)
      && typeof runtimeFootprint !== 'function') {
      throw new TypeError('worktree capacity derived floors require a runtimeFootprint dependency');
    }
    if (!Number.isSafeInteger(lockWaitMs) || lockWaitMs < 0) throw new TypeError('worktree capacity lock wait deadline must be a non-negative safe integer of milliseconds');
    this.integrityKey = Buffer.from(integrityKey);
    this.observe = observe; this.estimate = estimate; this.now = now; this.lockWaitMs = lockWaitMs;
    this.runtimeFootprint = runtimeFootprint;
    this.ownerId = randomBytes(16).toString('hex');
    this.root = join(repoRoot, '.baton', 'capacity');
    this.statePath = join(this.root, 'reservations.json');
    this.lockPath = join(this.root, 'lock');
    this.reaperPath = `${this.lockPath}.reaper`;
  }

  /** The effective floor for one admission check: per field, a configured policy floor wins;
   * a null field (#307) derives from the ledger's estimate high-water plus the measured runtime
   * footprint. Runs under the lock with the state already read. */
  #effectiveFloor(estimateHighWater) {
    const configuredBytes = this.policy.minFreeBytes;
    const configuredInodes = this.policy.minFreeInodes;
    const highWater = Object.freeze({ ...estimateHighWater });
    if (configuredBytes !== null && configuredInodes !== null) {
      return Object.freeze({ bytes: configuredBytes, inodes: configuredInodes, source: 'configured', estimateHighWater: highWater, runtimeFootprint: null });
    }
    let footprint;
    try {
      footprint = validateMeasurement(this.runtimeFootprint(), 'worktreeCapacityRuntimeFootprint', ['bytes', 'inodes']);
    } catch (error) {
      if (error instanceof WorktreeCapacityError) throw error;
      throw typed('worktree capacity could not measure its runtime footprint', 'worktree_capacity_unavailable', error);
    }
    const derived = deriveWorktreeCapacityFloor({
      estimateHighWaterBytes: highWater.bytes, estimateHighWaterInodes: highWater.inodes,
      runtimeFootprintBytes: footprint.bytes, runtimeFootprintInodes: footprint.inodes,
    });
    return Object.freeze({
      bytes: configuredBytes ?? derived.bytes,
      inodes: configuredInodes ?? derived.inodes,
      source: configuredBytes !== null || configuredInodes !== null ? 'mixed' : 'derived',
      estimateHighWater: highWater, runtimeFootprint: Object.freeze(footprint),
    });
  }

  _seal(state) {
    // Schema 2 records the estimate high-water (#307) beside the reservations; schema 1 ledgers
    // (no high-water field) stay sealed exactly as written so an older writer's state is still
    // verifiable byte-for-byte.
    const core = state.estimateHighWater === undefined
      ? { schemaVersion: 1, policyDigest: state.policyDigest, reservations: state.reservations }
      : { schemaVersion: 2, policyDigest: state.policyDigest, reservations: state.reservations, estimateHighWater: state.estimateHighWater };
    const integrityDigest = createHmac('sha256', this.integrityKey).update(JSON.stringify(canonical(core))).digest('hex');
    return { ...core, integrityDigest };
  }

  _write(state) { atomicWrite(this.statePath, this._seal(state)); }

  _ensureRoot() {
    const repo = realpathSync(this.repoRoot); const baton = join(repo, '.baton');
    for (const path of [baton, this.root]) {
      try { mkdirSync(path, { mode: 0o700 }); }
      catch (error) {
        if (error?.code !== 'EEXIST') throw typed('worktree capacity root could not be created', 'worktree_capacity_unavailable', error);
      }
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw typed('worktree capacity root is not a confined directory', 'worktree_capacity_unavailable');
      chmodSync(path, 0o700);
      const within = relative(repo, realpathSync(path));
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw typed('worktree capacity root escapes repository', 'worktree_capacity_unavailable');
    }
  }

  _read() {
    if (!existsSync(this.statePath)) {
      return { schemaVersion: 2, policyDigest: this.policy.digest, reservations: [], estimateHighWater: { bytes: 0, inodes: 0 } };
    }
    const stateStat = lstatSync(this.statePath);
    if (!stateStat.isFile() || stateStat.isSymbolicLink() || (stateStat.mode & 0o077) !== 0) throw typed('worktree capacity state is not a private regular file', 'worktree_capacity_unavailable');
    let state;
    try { state = JSON.parse(readFileSync(this.statePath, 'utf8')); }
    catch (cause) { throw typed('worktree capacity state is unreadable', 'worktree_capacity_unavailable', cause); }
    // Schema 2 records the estimate high-water (#307); schema 1 ledgers (an older writer) are
    // still verified byte-for-byte and read with a zero high-water.
    const v1Keys = ['integrityDigest', 'policyDigest', 'reservations', 'schemaVersion'].sort().join(',');
    const v2Keys = ['estimateHighWater', 'integrityDigest', 'policyDigest', 'reservations', 'schemaVersion'].sort().join(',');
    const keys = state && typeof state === 'object' && !Array.isArray(state) ? Object.keys(state).sort().join(',') : null;
    const schema = keys === v1Keys ? 1 : keys === v2Keys ? 2 : null;
    const highWaterShape = schema === 2 && (
      !state.estimateHighWater || state.estimateHighWater === null
      || Object.keys(state.estimateHighWater).sort().join(',') !== 'bytes,inodes'
      || !Number.isSafeInteger(state.estimateHighWater.bytes) || state.estimateHighWater.bytes < 0
      || !Number.isSafeInteger(state.estimateHighWater.inodes) || state.estimateHighWater.inodes < 0);
    if (schema === null || !Array.isArray(state.reservations) || highWaterShape) {
      throw typed('worktree capacity state disagrees with deployment policy', 'worktree_capacity_unavailable');
    }
    const expectedIntegrity = this._seal(schema === 1
      ? { schemaVersion: 1, policyDigest: state.policyDigest, reservations: state.reservations }
      : state).integrityDigest;
    if (typeof state.integrityDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(state.integrityDigest)
      || !timingSafeEqual(Buffer.from(state.integrityDigest, 'hex'), Buffer.from(expectedIntegrity, 'hex'))) throw typed('worktree capacity state integrity failed', 'worktree_capacity_unavailable');
    if (state.policyDigest !== this.policy.digest) {
      if (state.reservations.length === 0) return { schemaVersion: 2, policyDigest: this.policy.digest, reservations: [], estimateHighWater: { bytes: 0, inodes: 0 } };
      // G-5: the refusal names the ledger an operator must inspect or clear, and BOTH digests, so
      // a policy change is diagnosable from the error alone instead of from this source.
      const ledger = join('.baton', 'capacity', basename(this.statePath));
      const gracefulPath = `inspect ${ledger} and settle or clear its live reservations under the new policy`;
      throw Object.assign(typed(
        `worktree capacity state disagrees with deployment policy: ${ledger} was written under ${state.policyDigest}, this deployment runs ${this.policy.digest}; ${gracefulPath}`,
        'worktree_capacity_unavailable',
      ), { ledger, statePolicyDigest: state.policyDigest, policyDigest: this.policy.digest, gracefulPath });
    }
    for (const row of state.reservations) {
      if (!row || Object.keys(row).sort().join(',') !== [...RESERVATION_FIELDS].sort().join(',')
        || typeof row.id !== 'string' || row.id.length === 0 || Buffer.byteLength(row.id) > 256
        || !['worker', 'verify'].includes(row.kind) || typeof row.resourceId !== 'string' || row.resourceId.length === 0 || Buffer.byteLength(row.resourceId) > 256
        || typeof row.ownerId !== 'string' || !/^[a-f0-9]{32}$/u.test(row.ownerId) || typeof row.nonce !== 'string' || !/^[a-f0-9]{32}$/u.test(row.nonce)
        || !Number.isSafeInteger(row.pid) || row.pid <= 0
        || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || !Number.isSafeInteger(row.inodes) || row.inodes < 0
        || !Number.isSafeInteger(row.outstandingBytes) || row.outstandingBytes < 0
        || row.outstandingBytes > row.bytes
        || !Number.isSafeInteger(row.outstandingInodes) || row.outstandingInodes < 0
        || row.outstandingInodes > row.inodes
        || typeof row.baseSha !== 'string' || !/^[a-f0-9]{40}$/u.test(row.baseSha)
        || typeof row.sparseDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sparseDigest)
        || (row.toolchainProjectionDigest !== null && (typeof row.toolchainProjectionDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(row.toolchainProjectionDigest)))
        || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))
        || (row.materializedAt !== null && (typeof row.materializedAt !== 'string'
          || !Number.isFinite(Date.parse(row.materializedAt))))
        || (row.materializedAt === null
          ? row.outstandingBytes !== row.bytes || row.outstandingInodes !== row.inodes
          : row.outstandingBytes !== Math.min(row.bytes, this.policy.runtimeReserveBytes)
            || row.outstandingInodes !== Math.min(row.inodes, this.policy.runtimeReserveInodes))) {
        throw typed('worktree capacity reservation state is malformed', 'worktree_capacity_unavailable');
      }
    }
    const totals = state.reservations.reduce((sum, row) => ({ bytes: sum.bytes + row.bytes, inodes: sum.inodes + row.inodes }), { bytes: 0, inodes: 0 });
    if (!Number.isSafeInteger(totals.bytes) || !Number.isSafeInteger(totals.inodes)) throw typed('worktree capacity reservation totals overflow', 'worktree_capacity_unavailable');
    return schema === 1
      ? { ...state, schemaVersion: 1, estimateHighWater: { bytes: 0, inodes: 0 } }
      : state;
  }

  // -----------------------------------------------------------------------------------------
  // Lock protocol. Independent deployment processes share one repository ledger, so every
  // capacity mutation is serialized by a published record naming the exact {ownerId, generation,
  // pid} that holds the critical section:
  //
  //   publish  link(lock)        — atomic; the loser observes the incumbent instead of overwriting.
  //   wait     live incumbent    — bounded by `lockWaitMs` of real elapsed time, then a typed
  //                                PRE-EFFECT refusal: no reservation or release was applied.
  //   reap     dead incumbent    — only while holding the exclusive reaper gate, and only after
  //                                the lock is re-read under that gate and proved to be the same
  //                                dead generation. A live lock is never renamed.
  //   gate     link(lock.reaper) — serializes reapers. A gate whose owner died is inert (nothing
  //                                ever acts under it) but irrecoverable: removing a gate cannot
  //                                be made conditional, so recovery could displace a gate
  //                                published in the meantime and hand two processes the reaper's
  //                                authority. It is therefore never touched: reclamation of a
  //                                dead lock is refused at the deadline while such a gate exists
  //                                (an operator removes the file, named by the refusal). Fresh
  //                                acquisition is unaffected, because no live reaper can exist
  //                                without a live gate.
  //
  // A published lock counts only after re-observation (`_confirmLock`): the exact generation is
  // still at the path and no live gate exists. Corrupt or ambiguous artifacts (a directory,
  // symlink, permissive mode, oversized file, malformed JSON, unknown schema) refuse immediately
  // — never adopted, never waited on, never deleted.
  // -----------------------------------------------------------------------------------------
  async _lock(fn) {
    try { this._ensureRoot(); }
    catch (error) {
      if (error instanceof WorktreeCapacityError) throw error;
      throw typed('worktree capacity root could not be confirmed', 'worktree_capacity_unavailable', error);
    }
    const generation = await this._acquire();
    try { return fn(); }
    catch (error) {
      if (error instanceof WorktreeCapacityError) throw error;
      throw typed('worktree capacity state update failed', 'worktree_capacity_unavailable', error);
    } finally { this._removeOwner(this.lockPath, LOCK_LABEL, generation); }
  }

  // One turn of the acquisition protocol, shared by the awaiting acquisition below and by
  // `_lockNow`'s single attempt: answers the generation this turn published and confirmed, a
  // `null` wait after it reclaimed a proved-dead holder (the next turn may acquire), or the wait
  // a contended turn must absorb.
  _acquireTurn() {
    const gate = this._observeOwner(this.reaperPath, REAPER_LABEL);
    if (gate !== null && livePid(gate.pid)) {
      // A reap is in flight and its tombstone rename may land on any lock published now.
      return { generation: null, wait: { detail: `the live reaper (pid ${gate.pid}) still held the recovery gate`, extra: { holderPid: gate.pid } } };
    }
    const generation = randomBytes(16).toString('hex');
    if (this._publish(this.lockPath, generation) && this._confirmLock(generation)) {
      return { generation, wait: null };
    }
    this._removeOwner(this.lockPath, LOCK_LABEL, generation); // no-op unless we published it
    const observed = this._observeOwner(this.lockPath, LOCK_LABEL);
    if (observed === null) {
      return { generation: null, wait: { detail: 'the lock could not be published and confirmed', extra: {} } };
    }
    if (livePid(observed.pid)) {
      return { generation: null, wait: { detail: `the live holder (pid ${observed.pid}) still held it`, extra: { holderPid: observed.pid } } };
    }
    if (gate !== null) {
      // A dead lock under a dead gate is inert forever, and reclamation needs the gate.
      return { generation: null, wait: { detail: `a dead reaper gate (pid ${gate.pid}) blocks reclamation of the dead holder (pid ${observed.pid})`, extra: { gatePid: gate.pid } } };
    }
    if (!this._reap(observed)) {
      return { generation: null, wait: { detail: `the dead holder (pid ${observed.pid}) could not be reclaimed`, extra: {} } };
    }
    return { generation: null, wait: null };
  }

  // Every turn below returns, throws, or awaits `_waitSlice`, which refuses once the monotonic
  // deadline passes — no observed state can make this loop unbounded.
  async _acquire() {
    const deadline = performance.now() + this.lockWaitMs;
    let firstAttempt = true;
    let lastWait = { detail: 'repeated ownership changes prevented acquisition', extra: {} };
    for (;;) {
      if (!firstAttempt && performance.now() >= deadline) {
        await this._waitSlice(deadline, lastWait.detail, lastWait.extra);
      }
      firstAttempt = false;
      const turn = this._acquireTurn();
      if (turn.generation !== null) return turn.generation;
      if (turn.wait === null) continue;
      lastWait = turn.wait;
      await this._waitSlice(deadline, turn.wait.detail, turn.wait.extra);
    }
  }

  /** The same critical section, attempted with NO wait (issue #285 G-42), for a caller that cannot
   * await — the construction-time reconciliation, whose work must finish before the deployment
   * serves. Contention refuses typed and pre-effect, exactly the semantics `lockWaitMs: 0` already
   * names for the awaiting API, and a turn that reclaimed a proved-dead holder is retried once. */
  _lockNow(fn) {
    try { this._ensureRoot(); }
    catch (error) {
      if (error instanceof WorktreeCapacityError) throw error;
      throw typed('worktree capacity root could not be confirmed', 'worktree_capacity_unavailable', error);
    }
    let contended = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const turn = this._acquireTurn();
      if (turn.generation !== null) {
        try { return fn(); }
        catch (error) {
          if (error instanceof WorktreeCapacityError) throw error;
          throw typed('worktree capacity state update failed', 'worktree_capacity_unavailable', error);
        } finally { this._removeOwner(this.lockPath, LOCK_LABEL, turn.generation); }
      }
      if (turn.wait === null) continue;
      contended = turn.wait;
      break;
    }
    throw Object.assign(typed(
      'worktree capacity reservation lock is busy: '
      + `${contended?.detail ?? 'a proved-dead holder was reclaimed but the lock was republished first'};`
      + ' this call takes no wait, and no capacity effect was applied',
      'worktree_capacity_unavailable',
    ), { lockContention: true, ...(contended?.extra ?? {}) });
  }

  // A published lock counts only once both facts are re-observed: the file still carries this
  // exact generation, and no live reaper gate exists that could be about to tombstone it.
  _confirmLock(generation) {
    try {
      const held = this._observeOwner(this.lockPath, LOCK_LABEL);
      const gate = this._observeOwner(this.reaperPath, REAPER_LABEL);
      return held !== null && held.generation === generation && held.ownerId === this.ownerId
        && (gate === null || !livePid(gate.pid));
    } catch (error) {
      // A lock we cannot verify is not a lock we hold: never leave it published.
      this._removeOwner(this.lockPath, LOCK_LABEL, generation);
      throw error;
    }
  }

  // Awaits one poll slice, or refuses pre-effect once the monotonic deadline has passed.
  async _waitSlice(deadline, detail, extra) {
    const remaining = deadline - performance.now();
    if (remaining <= 0) {
      throw Object.assign(typed(
        `worktree capacity reservation lock is busy: ${detail} at the ${this.lockWaitMs}ms wait deadline; no capacity effect was applied`,
        'worktree_capacity_unavailable',
      ), { lockContention: true, ...extra });
    }
    await awaitLockSlice(Math.min(LOCK_POLL_MS, remaining));
  }

  // Reaps one proved-dead generation and reports whether it made progress. The reaper gate is
  // what makes this safe: only its holder may tombstone the lock, and the lock is re-read under
  // the gate, so a live lock is never renamed away and a lock that changed under us is left for
  // the next turn.
  _reap(observed) {
    const gateGeneration = randomBytes(16).toString('hex');
    if (!this._publish(this.reaperPath, gateGeneration)) return false; // another reaper holds the gate
    try {
      const current = this._observeOwner(this.lockPath, LOCK_LABEL);
      if (current === null || current.generation !== observed.generation
        || current.ownerId !== observed.ownerId || livePid(current.pid)) return false;
      const tombstone = `${this.lockPath}.stale-${gateGeneration}`;
      try { renameSync(this.lockPath, tombstone); }
      catch (error) {
        if (error?.code !== 'ENOENT') throw typed('worktree capacity reservation lock recovery failed', 'worktree_capacity_unavailable', error);
        return false;
      }
      fsyncDirectory(this.root);
      rmSync(tombstone, { force: true });
      fsyncDirectory(this.root);
      return true;
    } finally { this._removeOwner(this.reaperPath, REAPER_LABEL, gateGeneration); }
  }

  // Publishes one exact generation; an existing owner is never overwritten.
  _publish(path, generation) {
    try {
      publishExclusive(this.root, path, { schemaVersion: 1, pid: process.pid, ownerId: this.ownerId, generation }, generation);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw typed('worktree capacity reservation lock publication failed', 'worktree_capacity_unavailable', error);
      return false;
    }
  }

  _removeOwner(path, label, generation) {
    try {
      const observed = this._observeOwner(path, label);
      if (observed !== null && observed.generation === generation && observed.ownerId === this.ownerId) {
        unlinkSync(path);
        fsyncDirectory(this.root);
      }
    } catch { /* a replaced or unreadable artifact is never recursively removed */ }
  }

  // null when the path holds nothing; a typed refusal when it holds anything this deployment did
  // not publish — an ambiguous artifact is never adopted, waited on, or deleted.
  _observeOwner(path, label) {
    let stat;
    try { stat = lstatSync(path); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw typed(`${label} could not be observed`, 'worktree_capacity_unavailable', error);
    }
    // #500: an owner record is one generation tuple (validLockOwner). 4 096 bytes is the largest
    // artifact this protocol reads; a larger lock or reaper file is refused as not a bounded
    // private regular file rather than parsed. Operator-declared: no file in the repository
    // derives the number.
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 4096) {
      throw typed(`${label} is not a bounded private regular file`, 'worktree_capacity_unavailable');
    }
    let raw;
    try { raw = readFileSync(path, 'utf8'); }
    catch (error) {
      // The artifact can vanish between stat and read — a release, a reap, a publication race.
      // That is the ordinary race this protocol absorbs: report absent (the caller retries),
      // never corruption.
      if (error?.code === 'ENOENT') return null;
      throw typed(`${label} owner record is unreadable`, 'worktree_capacity_unavailable', error);
    }
    let owner;
    try { owner = JSON.parse(raw); }
    catch (cause) { throw typed(`${label} owner record is unreadable`, 'worktree_capacity_unavailable', cause); }
    if (!validLockOwner(owner)) throw typed(`${label} owner record is not an exact deployment generation`, 'worktree_capacity_unavailable');
    return owner;
  }

  async reserve(id, request) {
    return (await this.reserveMany([{ id, request }]))[0];
  }

  async reserveMany(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new TypeError('capacity reservation wave must contain a non-empty entry list');
    }
    const prepared = entries.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)
        || Object.keys(entry).sort().join(',') !== ['id', 'request'].sort().join(',')) {
        throw new TypeError('capacity reservation wave entry is invalid');
      }
      const { id, request } = entry;
      if (typeof id !== 'string' || id.length === 0 || Buffer.byteLength(id) > 256) throw new TypeError('capacity reservation id is invalid');
      const separator = id.indexOf(':'); const kind = id.slice(0, separator); const resourceId = id.slice(separator + 1);
      if (!['worker', 'verify'].includes(kind) || !resourceId) throw new TypeError('capacity reservation id kind is invalid');
      let estimate;
      try {
        estimate = validateMeasurement(this.estimate({ ...request, repoRoot: this.repoRoot, policy: this.policy }), 'worktreeCapacityEstimate', ['bytes', 'inodes']);
      } catch (error) {
        if (error instanceof WorktreeCapacityError) throw error;
        throw typed('worktree capacity could not be observed', 'worktree_capacity_unavailable', error);
      }
      return { id, request, kind, resourceId, estimate };
    });
    if (new Set(prepared.map(({ id }) => id)).size !== prepared.length) {
      throw new TypeError('capacity reservation wave contains duplicate ids');
    }
    return this._lock(() => {
      const state = this._read();
      let observation;
      try { observation = validateMeasurement(this.observe({ repoRoot: this.repoRoot }), 'worktreeCapacityObserve', ['freeBytes', 'freeInodes']); }
      catch (error) {
        if (error instanceof WorktreeCapacityError) throw error;
        throw typed('worktree capacity could not be observed', 'worktree_capacity_unavailable', error);
      }
      const requested = new Set(prepared.map(({ id }) => id));
      if (state.reservations.some((row) => requested.has(row.id))) throw typed('worktree capacity reservation already exists', 'worktree_capacity_exceeded');
      const totals = state.reservations.reduce((sum, row) => ({ bytes: sum.bytes + row.bytes, inodes: sum.inodes + row.inodes }), { bytes: 0, inodes: 0 });
      const outstanding = state.reservations.reduce((sum, row) => ({
        bytes: sum.bytes + row.outstandingBytes,
        inodes: sum.inodes + row.outstandingInodes,
      }), { bytes: 0, inodes: 0 });
      const wave = prepared.reduce((sum, row) => ({ bytes: sum.bytes + row.estimate.bytes, inodes: sum.inodes + row.estimate.inodes }), { bytes: 0, inodes: 0 });
      if (!Number.isSafeInteger(wave.bytes) || !Number.isSafeInteger(wave.inodes)
        || !Number.isSafeInteger(totals.bytes + wave.bytes) || !Number.isSafeInteger(totals.inodes + wave.inodes)
        || !Number.isSafeInteger(outstanding.bytes + wave.bytes)
        || !Number.isSafeInteger(outstanding.inodes + wave.inodes)) {
        throw typed('worktree capacity reservation totals overflow', 'worktree_capacity_unavailable');
      }
      // #307: the floor beneath this wave is derived (policy null) or configured (policy set),
      // and the refusal NAMES its numbers — free, reserved, estimate, floor — plus the remedy
      // that would admit this exact request, so "what defines this limit" is answered by the
      // refusal itself and not by reading the source.
      const floor = this.#effectiveFloor(state.estimateHighWater ?? { bytes: 0, inodes: 0 });
      const reasons = [];
      if (this.policy.maxReservedBytes !== null && totals.bytes + wave.bytes > this.policy.maxReservedBytes) reasons.push('maxReservedBytes');
      if (this.policy.maxReservedInodes !== null && totals.inodes + wave.inodes > this.policy.maxReservedInodes) reasons.push('maxReservedInodes');
      const remainingBytes = observation.freeBytes - outstanding.bytes - wave.bytes;
      const remainingInodes = observation.freeInodes - outstanding.inodes - wave.inodes;
      if (remainingBytes < floor.bytes) reasons.push('minFreeBytes');
      if (remainingInodes < floor.inodes) reasons.push('minFreeInodes');
      if (reasons.length > 0) {
        const deficitBytes = Math.max(0, outstanding.bytes + wave.bytes + floor.bytes - observation.freeBytes);
        const deficitInodes = Math.max(0, outstanding.inodes + wave.inodes + floor.inodes - observation.freeInodes);
        const floorLine = floor.source === 'derived'
          ? `the derived floor is ${floor.bytes} bytes and ${floor.inodes} inodes (largest recorded checkout estimate ${floor.estimateHighWater.bytes} bytes plus the measured runtime footprint ${floor.runtimeFootprint.bytes} bytes)`
          : `the configured floor is ${floor.bytes} bytes and ${floor.inodes} inodes (advanced.capacity.policy.minFreeBytes/minFreeInodes)`;
        const remedy = []
          .concat(deficitBytes > 0 || deficitInodes > 0
            ? [`free at least ${deficitBytes} bytes and ${deficitInodes} inodes on the repository volume`]
            : [])
          .concat(reasons.includes('maxReservedBytes') || reasons.includes('maxReservedInodes')
            ? ['settle or release live reservations, or raise advanced.capacity.policy.maxReservedBytes/maxReservedInodes']
            : [])
          .concat(floor.source === 'derived' ? [] : ['or lower advanced.capacity.policy.minFreeBytes/minFreeInodes'])
          .join(', ');
        // #178 (the #169 audit's instance 4): exactly ONE axis is named when the refusal has to
        // name one. The physical floor is judged before the policy ceiling and bytes before inodes
        // on the same tier, so a wave that breaches both axes is reported against the axis
        // admission checked first — the same order `reasons` is pushed in.
        const breachingAxis = remainingBytes < floor.bytes ? 'bytes'
          : remainingInodes < floor.inodes ? 'inodes'
            : reasons.includes('maxReservedBytes') ? 'bytes' : 'inodes';
        throw Object.assign(typed(
          `worktree capacity is unavailable for this reservation wave: ${observation.freeBytes} bytes and ${observation.freeInodes} inodes free,`
          + ` ${outstanding.bytes} bytes and ${outstanding.inodes} inodes reserved outstanding,`
          + ` this wave estimates ${wave.bytes} bytes and ${wave.inodes} inodes; ${floorLine};`
          + ` ${remedy}; then retry`,
          'worktree_capacity_exceeded',
        ), {
          reasons: Object.freeze(reasons),
          freeBytes: observation.freeBytes, freeInodes: observation.freeInodes,
          outstandingBytes: outstanding.bytes, outstandingInodes: outstanding.inodes,
          estimateBytes: wave.bytes, estimateInodes: wave.inodes,
          floorBytes: floor.bytes, floorInodes: floor.inodes, floorSource: floor.source,
          deficitBytes, deficitInodes,
          // #178: the audit's own field names ride beside the #307 ones, so a reader of the
          // refusal — an orchestrating model above all — never has to read the source or run
          // `df -h` to learn the observation, the floor, what is reserved outstanding, which
          // axis breached, and what to do next.
          minFreeBytes: floor.bytes, minFreeInodes: floor.inodes,
          reservedBytes: outstanding.bytes, reservedInodes: outstanding.inodes,
          breachingAxis, next: remedy,
        });
      }
      const createdAt = new Date(this.now()).toISOString();
      const rows = prepared.map(({ id, request, kind, resourceId, estimate }) => Object.freeze({
        id, kind, resourceId, ownerId: this.ownerId, nonce: randomBytes(16).toString('hex'), pid: process.pid,
        bytes: estimate.bytes, inodes: estimate.inodes, baseSha: request.baseSha,
        outstandingBytes: estimate.bytes, outstandingInodes: estimate.inodes,
        sparseDigest: request.sparseCheckoutIdentity.digest,
        toolchainProjectionDigest: request.toolchainProjection?.projectionDigest ?? null,
        createdAt, materializedAt: null,
      }));
      // #307: the wave's largest estimate becomes the ledger's new high-water — "enough room for
      // one more participant" is measured against what this deployment has ACTUALLY checked out,
      // recorded beside the reservations it protects and sealed with them.
      state.estimateHighWater = {
        bytes: Math.max(state.estimateHighWater?.bytes ?? 0, ...prepared.map(({ estimate }) => estimate.bytes)),
        inodes: Math.max(state.estimateHighWater?.inodes ?? 0, ...prepared.map(({ estimate }) => estimate.inodes)),
      };
      state.reservations.push(...rows); this._write(state);
      return Object.freeze(rows);
    });
  }

  async release(token) {
    return (await this.releaseMany([token]))[0];
  }

  async materialize(token, resourcePath) {
    if (!token || typeof token !== 'object' || typeof token.id !== 'string'
      || typeof token.ownerId !== 'string' || typeof token.nonce !== 'string') {
      throw new TypeError('capacity materialization requires an exact reservation token');
    }
    if (typeof resourcePath !== 'string' || resourcePath.length === 0) {
      throw new TypeError('capacity materialization requires an exact resource path');
    }
    return this._lock(() => {
      const state = this._read();
      const row = state.reservations.find((candidate) => (
        candidate.id === token.id && candidate.ownerId === token.ownerId
          && candidate.nonce === token.nonce
      ));
      if (!row) throw typed('capacity materialization reservation is unavailable',
        'worktree_capacity_unavailable');
      const root = join(realpathSync(this.repoRoot), '.baton', row.kind === 'worker' ? 'wt' : 'verify');
      let materializedRoot;
      let materializedPath;
      try {
        const rootStat = lstatSync(root);
        const resourceStat = lstatSync(resourcePath);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()
          || !resourceStat.isDirectory() || resourceStat.isSymbolicLink()) throw new Error();
        materializedRoot = realpathSync(root);
        materializedPath = realpathSync(resourcePath);
      } catch {
        throw typed('capacity materialization resource is unavailable',
          'worktree_capacity_unavailable');
      }
      const within = relative(materializedRoot, materializedPath);
      // G-33: the label is the head field of the reservation's own recorded `resourceId` — the
      // deployment composes a verify reservation as `verify:<label>:<sequence>` (index.mjs
      // createVerifyWorktree/createBaseVerifyWorktree), so the first separator ends the label and
      // a resourceId without one IS the label. Deriving it with lastIndexOf(':') and slice(0, -1)
      // dropped the last character of a separator-less label and then enforced that truncated
      // prefix as an identity guard.
      const separator = row.resourceId.indexOf(':');
      const verifyLabel = separator < 0 ? row.resourceId : row.resourceId.slice(0, separator);
      if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)
        || within.includes(sep)
        || (row.kind === 'worker' && basename(materializedPath) !== row.resourceId)
        || (row.kind === 'verify' && (verifyLabel.length === 0
          || !basename(materializedPath).startsWith(`${verifyLabel}-`)))) {
        throw typed('capacity materialization resource identity changed',
          'worktree_capacity_unavailable');
      }
      if (row.materializedAt !== null) return Object.freeze({ ...row });
      const next = Object.freeze({
        ...row,
        outstandingBytes: Math.min(row.bytes, this.policy.runtimeReserveBytes),
        outstandingInodes: Math.min(row.inodes, this.policy.runtimeReserveInodes),
        materializedAt: new Date(this.now()).toISOString(),
      });
      const index = state.reservations.indexOf(row);
      state.reservations[index] = next;
      this._write(state);
      return next;
    });
  }

  async releaseMany(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      throw new TypeError('capacity release wave must contain a non-empty token list');
    }
    for (const token of tokens) {
      if (!token || typeof token !== 'object' || typeof token.id !== 'string'
        || typeof token.ownerId !== 'string' || typeof token.nonce !== 'string') {
        throw new TypeError('capacity release requires an exact reservation token');
      }
    }
    if (new Set(tokens.map(({ id }) => id)).size !== tokens.length) throw new TypeError('capacity release wave contains duplicate ids');
    return this._lock(() => {
      const state = this._read();
      const exact = new Set(tokens.map((token) => `${token.id}\0${token.ownerId}\0${token.nonce}`));
      const released = new Set();
      state.reservations = state.reservations.filter((row) => {
        const identity = `${row.id}\0${row.ownerId}\0${row.nonce}`;
        if (!exact.has(identity)) return true;
        released.add(row.id); return false;
      });
      if (released.size > 0) this._write(state);
      return Object.freeze(tokens.map(({ id }) => released.has(id)));
    });
  }

  async releaseAbsent(id) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('capacity absent-resource release id is invalid');
    return this._lock(() => {
      const state = this._read(); const before = state.reservations.length;
      state.reservations = state.reservations.filter((row) => row.id !== id);
      if (state.reservations.length !== before) this._write(state);
      return state.reservations.length !== before;
    });
  }

  async settleForCleanup(id) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('capacity cleanup-settlement id is invalid');
    }
    return this._lock(() => this.#settleForCleanup(id));
  }

  /** Issue #285 G-42: the same settlement for a caller that cannot await — the construction-time
   * reconciliation — attempted once and refusing typed on contention (`_lockNow`). */
  settleForCleanupNow(id) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('capacity cleanup-settlement id is invalid');
    }
    return this._lockNow(() => this.#settleForCleanup(id));
  }

  #settleForCleanup(id) {
    const state = this._read();
    const retained = state.reservations.filter((row) => row.id !== id);
    if (retained.length !== state.reservations.length) {
      state.reservations = retained;
      this._write(state);
    }
    return state.reservations.every((row) => row.id !== id);
  }

  async adoptWorker(id) {
    return this._lock(() => {
      const state = this._read(); const index = state.reservations.findIndex((row) => row.id === id && row.kind === 'worker');
      if (index < 0) throw typed('active worker capacity reservation is missing', 'worktree_capacity_unavailable');
      const row = Object.freeze({ ...state.reservations[index], ownerId: this.ownerId, nonce: randomBytes(16).toString('hex'), pid: process.pid });
      state.reservations[index] = row; this._write(state); return row;
    });
  }

  async reconcile(activeWorkerIds = [], retainedWorkerIds = []) {
    return this._lock(() => this.#reconcile(activeWorkerIds, retainedWorkerIds));
  }

  /** Issue #285 G-42: the same reconciliation for a caller that cannot await — the construction-time
   * reconciliation — attempted once and refusing typed on contention (`_lockNow`). */
  reconcileNow(activeWorkerIds = [], retainedWorkerIds = []) {
    return this._lockNow(() => this.#reconcile(activeWorkerIds, retainedWorkerIds));
  }

  #reconcile(activeWorkerIds, retainedWorkerIds) {
    const active = new Set(activeWorkerIds.map((id) => `worker:${id}`));
    const retained = new Set(retainedWorkerIds.map((id) => `worker:${id}`));
    const state = this._read(); const removed = [];
    const adopted = [];
    const retainedVerifiers = [];
    // G-35: a verification running in THIS process is live capacity. Reconciliation can run
    // while its sandbox exists (a drain or close reconciles the same ledger), and settling the
    // row then under-counted the committed bytes and inodes every later reservation sees. Only
    // a proved-dead owner settles a verifier here; an own reservation leaves the ledger when
    // its owner releases or settles it. Adopting one worker is not proof that another
    // controller stopped all its verification either.
    state.reservations = state.reservations.filter((row) => {
      if (row.kind === 'verify') {
        if (!livePid(row.pid)) {
          removed.push(row.id); return false;
        }
        retainedVerifiers.push(row.id); return true;
      }
      // A retained checkout whose physical-owner binding failed validation is not cleanup or
      // adoption authority. Preserve its reservation byte-for-byte for its owning controller.
      if (retained.has(row.id)) return true;
      if (row.ownerId === this.ownerId && !active.has(row.id)) { removed.push(row.id); return false; }
      if (row.ownerId !== this.ownerId && !active.has(row.id) && !livePid(row.pid)) { removed.push(row.id); return false; }
      if (active.has(row.id) && row.ownerId !== this.ownerId) {
        const next = Object.freeze({ ...row, ownerId: this.ownerId, nonce: randomBytes(16).toString('hex'), pid: process.pid });
        adopted.push(next); return false;
      }
      return true;
    });
    state.reservations.push(...adopted);
    if (removed.length > 0 || adopted.length > 0) this._write(state);
    return Object.freeze({
      removed: Object.freeze(removed), adopted: Object.freeze(adopted),
      retainedVerifiers: Object.freeze(retainedVerifiers),
      active: Object.freeze(state.reservations.map((row) => row.id)),
    });
  }

  /** The ledger's current projection, read WITHOUT the lock (issue #285 G-42): every mutation
   * writes the state file by atomic rename, so a reader observes a complete committed state and
   * never waits for a writer. */
  snapshot() {
    const state = this._read();
    const totals = state.reservations.reduce((sum, row) => ({ bytes: sum.bytes + row.bytes, inodes: sum.inodes + row.inodes }), { bytes: 0, inodes: 0 });
    const outstanding = state.reservations.reduce((sum, row) => ({
      bytes: sum.bytes + row.outstandingBytes,
      inodes: sum.inodes + row.outstandingInodes,
    }), { bytes: 0, inodes: 0 });
    const stateDigest = digest({ schemaVersion: state.schemaVersion, policyDigest: state.policyDigest, reservations: state.reservations });
    // #307: the doctor reads the derivation beside the observation — the effective floor, its
    // source, and the records that produced it.
    const floor = this.#effectiveFloor(state.estimateHighWater);
    return Object.freeze({
      policyDigest: this.policy.digest, stateDigest,
      totals: Object.freeze(totals), outstanding: Object.freeze(outstanding),
      estimateHighWater: Object.freeze({ ...state.estimateHighWater }),
      floor,
      reservations: Object.freeze(state.reservations.map((row) => Object.freeze({ ...row }))),
    });
  }

  /** The effective floor, resolved fresh from the ledger and the measured runtime footprint —
   * what the doctor's capacity section shows beside the observation (#307). Read without the
   * lock, like `snapshot()`. */
  floor() {
    const state = this._read();
    return this.#effectiveFloor(state.estimateHighWater);
  }
}
