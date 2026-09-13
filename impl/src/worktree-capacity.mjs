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
import { compareCanonicalStrings } from './canonical-order.mjs';

export class WorktreeCapacityError extends Error {
  constructor(message, code = 'worktree_capacity_exceeded') { super(message); this.name = 'WorktreeCapacityError'; this.code = code; }
}

const POLICY_FIELDS = Object.freeze([
  'maxReservedBytes', 'maxReservedInodes', 'minFreeBytes', 'minFreeInodes',
  'runtimeReserveBytes', 'runtimeReserveInodes',
]);
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_RESERVATIONS = 10_000;
const RESERVATION_FIELDS = Object.freeze([
  'id', 'kind', 'resourceId', 'ownerId', 'nonce', 'pid', 'bytes', 'inodes', 'baseSha',
  'sparseDigest', 'toolchainProjectionDigest', 'createdAt', 'materializedAt',
  'outstandingBytes', 'outstandingInodes',
]);

// Independent deployments mutate one repository ledger, so every capacity mutation serializes on
// a published owner record. This is a synchronous API: it cannot await a live holder, so ordinary
// contention is absorbed by blocking this thread in short slices until a deadline. That deadline is
// real elapsed time (`Date.now`), never the injectable domain clock: fixtures freeze the domain
// clock for timestamps, and a frozen clock must not become an unbounded wait.
const LOCK_POLL_MS = 5;
const DEFAULT_LOCK_WAIT_MS = 5_000;
const MAX_LOCK_WAIT_MS = 600_000;
const LOCK_WAIT_BUFFER = new Int32Array(new SharedArrayBuffer(4));
const LOCK_LABEL = 'worktree capacity reservation lock';
const REAPER_LABEL = 'worktree capacity reservation lock reaper gate';

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
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: localGitEnv(), ...opts });
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
    if (!Number.isSafeInteger(item) || item < 0) throw new TypeError(`worktreeCapacity.${field} must be a non-negative safe integer`);
    normalized[field] = item;
  }
  if (normalized.maxReservedBytes <= 0 || normalized.maxReservedInodes <= 0
    || normalized.runtimeReserveBytes > normalized.maxReservedBytes
    || normalized.runtimeReserveInodes > normalized.maxReservedInodes) throw new TypeError('worktreeCapacity ceilings are inconsistent');
  return Object.freeze({ ...normalized, digest: digest(normalized) });
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

function waitForLockSlice(ms) {
  Atomics.wait(LOCK_WAIT_BUFFER, 0, 0, ms);
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
    now = Date.now, lockWaitMs = DEFAULT_LOCK_WAIT_MS,
  }) {
    this.repoRoot = repoRoot;
    this.policy = normalizeWorktreeCapacityPolicy(policy);
    if (!Buffer.isBuffer(integrityKey) || integrityKey.byteLength !== 32) throw new TypeError('worktree capacity requires one 32-byte integrity key');
    if (typeof observe !== 'function' || typeof estimate !== 'function' || typeof now !== 'function') throw new TypeError('worktree capacity dependencies must be functions');
    if (!Number.isSafeInteger(lockWaitMs) || lockWaitMs < 0 || lockWaitMs > MAX_LOCK_WAIT_MS) throw new TypeError('worktree capacity lock wait deadline must be a bounded millisecond count');
    this.integrityKey = Buffer.from(integrityKey);
    this.observe = observe; this.estimate = estimate; this.now = now; this.lockWaitMs = lockWaitMs;
    this.ownerId = randomBytes(16).toString('hex');
    this.root = join(repoRoot, '.baton', 'capacity');
    this.statePath = join(this.root, 'reservations.json');
    this.lockPath = join(this.root, 'lock');
    this.reaperPath = `${this.lockPath}.reaper`;
  }

  _seal(state) {
    const core = { schemaVersion: 1, policyDigest: state.policyDigest, reservations: state.reservations };
    const integrityDigest = createHmac('sha256', this.integrityKey).update(JSON.stringify(canonical(core))).digest('hex');
    return { ...core, integrityDigest };
  }

  _write(state) { atomicWrite(this.statePath, this._seal(state)); }

  _ensureRoot() {
    const repo = realpathSync(this.repoRoot); const baton = join(repo, '.baton');
    for (const path of [baton, this.root]) {
      // Simultaneous first startup of one repository races here; losing that race is normal.
      // Only EEXIST is adopted, and the confinement checks below still refuse a file, symlink,
      // or escaping directory, so authority is unchanged.
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
    if (!existsSync(this.statePath)) return { schemaVersion: 1, policyDigest: this.policy.digest, reservations: [] };
    const stateStat = lstatSync(this.statePath);
    if (!stateStat.isFile() || stateStat.isSymbolicLink() || (stateStat.mode & 0o077) !== 0 || stateStat.size > MAX_STATE_BYTES) throw typed('worktree capacity state is not a bounded private regular file', 'worktree_capacity_unavailable');
    let state;
    try { state = JSON.parse(readFileSync(this.statePath, 'utf8')); }
    catch (cause) { throw typed('worktree capacity state is unreadable', 'worktree_capacity_unavailable', cause); }
    if (!state || Object.keys(state).sort().join(',') !== ['integrityDigest', 'policyDigest', 'reservations', 'schemaVersion'].sort().join(',')
      || state.schemaVersion !== 1 || !Array.isArray(state.reservations) || state.reservations.length > MAX_RESERVATIONS) throw typed('worktree capacity state disagrees with deployment policy', 'worktree_capacity_unavailable');
    const expectedIntegrity = this._seal(state).integrityDigest;
    if (typeof state.integrityDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(state.integrityDigest)
      || !timingSafeEqual(Buffer.from(state.integrityDigest, 'hex'), Buffer.from(expectedIntegrity, 'hex'))) throw typed('worktree capacity state integrity failed', 'worktree_capacity_unavailable');
    if (state.policyDigest !== this.policy.digest) {
      if (state.reservations.length === 0) return { schemaVersion: 1, policyDigest: this.policy.digest, reservations: [] };
      throw typed('worktree capacity state disagrees with deployment policy', 'worktree_capacity_unavailable');
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
    return state;
  }

  // -------------------------------------------------------------------------------------------
  // Lock protocol. Independent deployment processes share one repository ledger, so every
  // capacity mutation is serialized by a published record naming the exact {ownerId, generation,
  // pid} that holds the critical section:
  //
  //   publish  link(lock)            — atomic; the loser observes the incumbent instead of failing.
  //   wait     live incumbent        — bounded by `lockWaitMs`, then a typed PRE-EFFECT refusal:
  //                                    no reservation, materialization, or release was applied.
  //   reap     proved-dead incumbent — only while holding the exclusive reaper gate, and only
  //                                    after the lock is re-read under that gate and proved to be
  //                                    the same dead generation. A live lock is never stolen.
  //   gate     link(lock.reaper)     — serializes reapers; an abandoned gate (dead owner) is
  //                                    recovered, since it would otherwise refuse every later
  //                                    reap, and therefore every later reservation, forever.
  //
  // A published lock is trusted only after re-observation, so a reap whose rename lands late can
  // never hand a holder a lock that was already tombstoned. Corrupt or ambiguous artifacts (a
  // directory, symlink, permissive mode, oversized file, malformed JSON, unknown schema) are
  // refused outright — never adopted, never waited on, never deleted.
  // -------------------------------------------------------------------------------------------
  _lock(fn) {
    try { this._ensureRoot(); }
    catch (error) {
      if (error instanceof WorktreeCapacityError) throw error;
      throw typed('worktree capacity root could not be confirmed', 'worktree_capacity_unavailable', error);
    }
    const generation = this._acquire();
    try { return fn(); }
    catch (error) {
      if (error instanceof WorktreeCapacityError) throw error;
      throw typed('worktree capacity state update failed', 'worktree_capacity_unavailable', error);
    } finally { this._removeOwner(this.lockPath, LOCK_LABEL, generation); }
  }

  _acquire() {
    const deadline = Date.now() + this.lockWaitMs;
    for (;;) {
      const gate = this._observeOwner(this.reaperPath, REAPER_LABEL);
      if (gate !== null && livePid(gate.pid)) {
        // A reap is in flight, and its tombstone rename may land on any lock published now.
        this._waitForHolder(deadline, gate.pid, 'reaper');
        continue;
      }
      const generation = randomBytes(16).toString('hex');
      if (this._publish(this.lockPath, generation)) {
        if (this._confirmLock(generation)) return generation;
        this._removeOwner(this.lockPath, LOCK_LABEL, generation);
      }
      const observed = this._observeOwner(this.lockPath, LOCK_LABEL);
      if (observed === null) continue;
      if (livePid(observed.pid)) { this._waitForHolder(deadline, observed.pid, 'holder'); continue; }
      this._reap(observed);
    }
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

  _waitForHolder(deadline, pid, role) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw Object.assign(typed(
        `worktree capacity reservation lock is busy: the live ${role} (pid ${pid}) still held it at the ${this.lockWaitMs}ms wait deadline; no capacity effect was applied`,
        'worktree_capacity_unavailable',
      ), { lockContention: true, holderPid: pid });
    }
    waitForLockSlice(Math.min(LOCK_POLL_MS, remaining));
  }

  // Reaps one proved-dead generation. The reaper gate is what makes this safe: only its holder
  // may tombstone the lock, and the lock is re-read under the gate, so a live lock is never
  // renamed away and a lock that changed under us is simply left alone for the next turn.
  _reap(observed) {
    const gateGeneration = randomBytes(16).toString('hex');
    if (!this._publish(this.reaperPath, gateGeneration) && !this._recoverAbandonedGate(gateGeneration)) return;
    try {
      const current = this._observeOwner(this.lockPath, LOCK_LABEL);
      if (current === null || current.generation !== observed.generation
        || current.ownerId !== observed.ownerId || livePid(current.pid)) return;
      const tombstone = `${this.lockPath}.stale-${gateGeneration}`;
      try { renameSync(this.lockPath, tombstone); }
      catch (error) {
        if (error?.code !== 'ENOENT') throw typed('worktree capacity reservation lock recovery failed', 'worktree_capacity_unavailable', error);
        return;
      }
      fsyncDirectory(this.root);
      rmSync(tombstone, { force: true });
      fsyncDirectory(this.root);
    } finally { this._removeOwner(this.reaperPath, REAPER_LABEL, gateGeneration); }
  }

  // A gate whose owner died mid-reap would refuse every later reap forever, so it is recovered
  // under the same proof as the lock: the exact record is re-read immediately before the move,
  // and a live replacement is never displaced.
  _recoverAbandonedGate(generation) {
    const observed = this._observeOwner(this.reaperPath, REAPER_LABEL);
    if (observed === null || livePid(observed.pid)) return false;
    const tombstone = `${this.reaperPath}.stale-${generation}`;
    try { renameSync(this.reaperPath, tombstone); }
    catch (error) {
      if (error?.code !== 'ENOENT') throw typed('worktree capacity reservation lock recovery failed', 'worktree_capacity_unavailable', error);
      return false;
    }
    fsyncDirectory(this.root);
    rmSync(tombstone, { force: true });
    fsyncDirectory(this.root);
    return this._publish(this.reaperPath, generation);
  }

  // Publishes one exact generation; an existing live or dead owner is never overwritten.
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
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 4096) {
      throw typed(`${label} is not a bounded private regular file`, 'worktree_capacity_unavailable');
    }
    let raw;
    try { raw = readFileSync(path, 'utf8'); }
    catch (error) {
      // The artifact can disappear between the stat and the read — a holder releasing its lock, a
      // reaper renaming it away, another deployment recovering a gate. That is the ordinary race
      // this protocol is built to absorb, so it is reported as absent (the caller retries) and
      // never as corruption.
      if (error?.code === 'ENOENT') return null;
      throw typed(`${label} owner record is unreadable`, 'worktree_capacity_unavailable', error);
    }
    let owner;
    try { owner = JSON.parse(raw); }
    catch (cause) { throw typed(`${label} owner record is unreadable`, 'worktree_capacity_unavailable', cause); }
    if (!validLockOwner(owner)) throw typed(`${label} owner record is not an exact deployment generation`, 'worktree_capacity_unavailable');
    return owner;
  }

  reserve(id, request) {
    return this.reserveMany([{ id, request }])[0];
  }

  reserveMany(entries) {
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_RESERVATIONS) {
      throw new TypeError('capacity reservation wave must contain a bounded non-empty entry list');
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
      if (state.reservations.length + prepared.length > MAX_RESERVATIONS) throw typed('worktree capacity reservation count is exhausted', 'worktree_capacity_exceeded');
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
      if (totals.bytes + wave.bytes > this.policy.maxReservedBytes || totals.inodes + wave.inodes > this.policy.maxReservedInodes
        || observation.freeBytes - outstanding.bytes - wave.bytes < this.policy.minFreeBytes
        || observation.freeInodes - outstanding.inodes - wave.inodes < this.policy.minFreeInodes) {
        throw typed('worktree capacity is unavailable for this reservation wave', 'worktree_capacity_exceeded');
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
      state.reservations.push(...rows); this._write(state);
      return Object.freeze(rows);
    });
  }

  release(token) {
    return this.releaseMany([token])[0];
  }

  materialize(token, resourcePath) {
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
      const verifyLabel = row.resourceId.slice(0, row.resourceId.lastIndexOf(':'));
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

  releaseMany(tokens) {
    if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > MAX_RESERVATIONS) {
      throw new TypeError('capacity release wave must contain a bounded non-empty token list');
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

  releaseAbsent(id) {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('capacity absent-resource release id is invalid');
    return this._lock(() => {
      const state = this._read(); const before = state.reservations.length;
      state.reservations = state.reservations.filter((row) => row.id !== id);
      if (state.reservations.length !== before) this._write(state);
      return state.reservations.length !== before;
    });
  }

  settleForCleanup(id) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('capacity cleanup-settlement id is invalid');
    }
    return this._lock(() => {
      const state = this._read();
      const retained = state.reservations.filter((row) => row.id !== id);
      if (retained.length !== state.reservations.length) {
        state.reservations = retained;
        this._write(state);
      }
      return state.reservations.every((row) => row.id !== id);
    });
  }

  adoptWorker(id) {
    return this._lock(() => {
      const state = this._read(); const index = state.reservations.findIndex((row) => row.id === id && row.kind === 'worker');
      if (index < 0) throw typed('active worker capacity reservation is missing', 'worktree_capacity_unavailable');
      const row = Object.freeze({ ...state.reservations[index], ownerId: this.ownerId, nonce: randomBytes(16).toString('hex'), pid: process.pid });
      state.reservations[index] = row; this._write(state); return row;
    });
  }

  reconcile(activeWorkerIds = [], retainedWorkerIds = []) {
    const active = new Set(activeWorkerIds.map((id) => `worker:${id}`));
    const retained = new Set(retainedWorkerIds.map((id) => `worker:${id}`));
    return this._lock(() => {
      const state = this._read(); const removed = [];
      const adopted = [];
      const retainedVerifiers = [];
      state.reservations = state.reservations.filter((row) => {
        // Verifiers have no adoption protocol: a verification reservation belongs to the controller
        // that minted it and cannot be resumed by this one. Settling is therefore limited to the
        // verifiers this authority owns and to verifiers whose owning process is proven gone; a
        // LIVE FOREIGN controller's verifier is preserved byte-for-byte, because settling it
        // strands that controller between reserve() and materialize(). A row naming this very
        // process is this deployment's own generation (an in-process restart settles it), so it is
        // never mistaken for a live foreign owner.
        if (row.kind === 'verify') {
          if (row.ownerId === this.ownerId || row.pid === process.pid || !livePid(row.pid)) {
            removed.push(row.id); return false;
          }
          retainedVerifiers.push(row.id); return true;
        }
        // A retained checkout whose physical-owner binding failed validation is not cleanup or
        // adoption authority. Preserve its reservation byte-for-byte for its owning controller.
        if (row.kind === 'worker' && retained.has(row.id)) return true;
        const ownedInactive = row.ownerId === this.ownerId && !active.has(row.id);
        if (ownedInactive) { removed.push(row.id); return false; }
        const deadForeignInactive = row.ownerId !== this.ownerId && !active.has(row.id) && !livePid(row.pid);
        if (deadForeignInactive) { removed.push(row.id); return false; }
        if (active.has(row.id) && row.kind === 'worker' && row.ownerId !== this.ownerId) {
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
    });
  }

  snapshot() {
    return this._lock(() => {
      const state = this._read();
      const totals = state.reservations.reduce((sum, row) => ({ bytes: sum.bytes + row.bytes, inodes: sum.inodes + row.inodes }), { bytes: 0, inodes: 0 });
      const outstanding = state.reservations.reduce((sum, row) => ({
        bytes: sum.bytes + row.outstandingBytes,
        inodes: sum.inodes + row.outstandingInodes,
      }), { bytes: 0, inodes: 0 });
      const stateDigest = digest({ schemaVersion: state.schemaVersion, policyDigest: state.policyDigest, reservations: state.reservations });
      return Object.freeze({
        policyDigest: this.policy.digest, stateDigest,
        totals: Object.freeze(totals), outstanding: Object.freeze(outstanding),
        reservations: Object.freeze(state.reservations.map((row) => Object.freeze({ ...row }))),
      });
    });
  }
}
