// Deployment-owned, repo-scoped worktree capacity reservations. Sparse checkout is an
// optimization and integrity identity, not a quota; this preflight prevents known selected-tree,
// projected-toolchain, and runtime allowances from overcommitting a fleet before Git effects.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync, closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, rmSync, statfsSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

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
  'sparseDigest', 'toolchainProjectionDigest', 'createdAt',
]);

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
    if (!existsSync(directory)) mkdirSync(directory, { mode: 0o700 });
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
  const ordered = [...unique].sort((a, b) => a.localeCompare(b));
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
  constructor({ repoRoot, policy, integrityKey, observe = defaultObserve, estimate = defaultEstimate, now = Date.now }) {
    this.repoRoot = repoRoot;
    this.policy = normalizeWorktreeCapacityPolicy(policy);
    if (!Buffer.isBuffer(integrityKey) || integrityKey.byteLength !== 32) throw new TypeError('worktree capacity requires one 32-byte integrity key');
    if (typeof observe !== 'function' || typeof estimate !== 'function' || typeof now !== 'function') throw new TypeError('worktree capacity dependencies must be functions');
    this.integrityKey = Buffer.from(integrityKey);
    this.observe = observe; this.estimate = estimate; this.now = now;
    this.ownerId = randomBytes(16).toString('hex');
    this.root = join(repoRoot, '.baton', 'capacity');
    this.statePath = join(this.root, 'reservations.json');
    this.lockPath = join(this.root, 'lock');
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
      if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
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
        || typeof row.baseSha !== 'string' || !/^[a-f0-9]{40}$/u.test(row.baseSha)
        || typeof row.sparseDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sparseDigest)
        || (row.toolchainProjectionDigest !== null && (typeof row.toolchainProjectionDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(row.toolchainProjectionDigest)))
        || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))) throw typed('worktree capacity reservation state is malformed', 'worktree_capacity_unavailable');
    }
    const totals = state.reservations.reduce((sum, row) => ({ bytes: sum.bytes + row.bytes, inodes: sum.inodes + row.inodes }), { bytes: 0, inodes: 0 });
    if (!Number.isSafeInteger(totals.bytes) || !Number.isSafeInteger(totals.inodes)) throw typed('worktree capacity reservation totals overflow', 'worktree_capacity_unavailable');
    return state;
  }

  _lock(fn) {
    this._ensureRoot();
    let generation; let owner;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      generation = randomBytes(16).toString('hex'); owner = { schemaVersion: 1, pid: process.pid, ownerId: this.ownerId, generation };
      try {
        if (existsSync(`${this.lockPath}.reaper`)) throw Object.assign(new Error(), { code: 'EEXIST' });
        publishExclusive(this.root, this.lockPath, owner, generation);
        break;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw typed('worktree capacity lock publication failed', 'worktree_capacity_unavailable', error);
        let observed;
        try {
          const stat = lstatSync(this.lockPath);
          if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > 4096) throw new Error();
          observed = JSON.parse(readFileSync(this.lockPath, 'utf8'));
        } catch { throw typed('worktree capacity reservation lock is busy', 'worktree_capacity_unavailable'); }
        if (!validLockOwner(observed) || livePid(observed.pid)) {
          throw typed('worktree capacity reservation lock is busy', 'worktree_capacity_unavailable');
        }
        const reaperPath = `${this.lockPath}.reaper`; const reaperGeneration = randomBytes(16).toString('hex');
        try { publishExclusive(this.root, reaperPath, { schemaVersion: 1, pid: process.pid, ownerId: this.ownerId, generation: reaperGeneration }, reaperGeneration); }
        catch { throw typed('worktree capacity reservation lock is busy', 'worktree_capacity_unavailable'); }
        try {
          const current = JSON.parse(readFileSync(this.lockPath, 'utf8'));
          if (!validLockOwner(current) || current.generation !== observed.generation || current.ownerId !== observed.ownerId || livePid(current.pid)) throw typed('worktree capacity reservation lock changed during recovery', 'worktree_capacity_unavailable');
          const tombstone = `${this.lockPath}.stale-${reaperGeneration}`;
          renameSync(this.lockPath, tombstone); fsyncDirectory(this.root); rmSync(tombstone, { force: true }); fsyncDirectory(this.root);
        } finally {
          try {
            const gate = JSON.parse(readFileSync(reaperPath, 'utf8'));
            if (validLockOwner(gate) && gate.generation === reaperGeneration && gate.ownerId === this.ownerId) { unlinkSync(reaperPath); fsyncDirectory(this.root); }
          } catch { /* replacement gate is not ours */ }
        }
      }
    }
    let acquired;
    try { acquired = JSON.parse(readFileSync(this.lockPath, 'utf8')); } catch { /* validated below */ }
    if (!generation || !validLockOwner(acquired) || acquired.generation !== generation || acquired.ownerId !== this.ownerId) throw typed('worktree capacity reservation lock is unavailable', 'worktree_capacity_unavailable');
    try { return fn(); }
    catch (error) {
      if (error instanceof WorktreeCapacityError) throw error;
      throw typed('worktree capacity state update failed', 'worktree_capacity_unavailable', error);
    } finally {
      try {
        const observed = JSON.parse(readFileSync(this.lockPath, 'utf8'));
        if (validLockOwner(observed) && observed.generation === generation && observed.ownerId === this.ownerId) { unlinkSync(this.lockPath); fsyncDirectory(this.root); }
      } catch { /* a missing/replaced lock is never recursively removed */ }
    }
  }

  reserve(id, request) {
    if (typeof id !== 'string' || id.length === 0 || Buffer.byteLength(id) > 256) throw new TypeError('capacity reservation id is invalid');
    let estimate;
    try {
      estimate = validateMeasurement(this.estimate({ ...request, repoRoot: this.repoRoot, policy: this.policy }), 'worktreeCapacityEstimate', ['bytes', 'inodes']);
    } catch (error) {
      if (error instanceof WorktreeCapacityError) throw error;
      throw typed('worktree capacity could not be observed', 'worktree_capacity_unavailable', error);
    }
    return this._lock(() => {
      const state = this._read();
      let observation;
      try { observation = validateMeasurement(this.observe({ repoRoot: this.repoRoot }), 'worktreeCapacityObserve', ['freeBytes', 'freeInodes']); }
      catch (error) {
        if (error instanceof WorktreeCapacityError) throw error;
        throw typed('worktree capacity could not be observed', 'worktree_capacity_unavailable', error);
      }
      if (state.reservations.some((row) => row.id === id)) throw typed('worktree capacity reservation already exists', 'worktree_capacity_exceeded');
      if (state.reservations.length >= MAX_RESERVATIONS) throw typed('worktree capacity reservation count is exhausted', 'worktree_capacity_exceeded');
      const totals = state.reservations.reduce((sum, row) => ({ bytes: sum.bytes + row.bytes, inodes: sum.inodes + row.inodes }), { bytes: 0, inodes: 0 });
      if (totals.bytes + estimate.bytes > this.policy.maxReservedBytes || totals.inodes + estimate.inodes > this.policy.maxReservedInodes
        || observation.freeBytes - totals.bytes - estimate.bytes < this.policy.minFreeBytes
        || observation.freeInodes - totals.inodes - estimate.inodes < this.policy.minFreeInodes) {
        throw typed('worktree capacity is unavailable for this reservation', 'worktree_capacity_exceeded');
      }
      const separator = id.indexOf(':'); const kind = id.slice(0, separator); const resourceId = id.slice(separator + 1);
      if (!['worker', 'verify'].includes(kind) || !resourceId) throw new TypeError('capacity reservation id kind is invalid');
      const row = Object.freeze({
        id, kind, resourceId, ownerId: this.ownerId, nonce: randomBytes(16).toString('hex'), pid: process.pid, bytes: estimate.bytes, inodes: estimate.inodes,
        baseSha: request.baseSha, sparseDigest: request.sparseCheckoutIdentity.digest,
        toolchainProjectionDigest: request.toolchainProjection?.projectionDigest ?? null,
        createdAt: new Date(this.now()).toISOString(),
      });
      state.reservations.push(row); this._write(state);
      return row;
    });
  }

  release(token) {
    if (!token || typeof token !== 'object' || typeof token.id !== 'string' || typeof token.ownerId !== 'string' || typeof token.nonce !== 'string') throw new TypeError('capacity release requires an exact reservation token');
    return this._lock(() => {
      const state = this._read(); const before = state.reservations.length;
      state.reservations = state.reservations.filter((row) => !(row.id === token.id && row.ownerId === token.ownerId && row.nonce === token.nonce));
      if (state.reservations.length !== before) this._write(state);
      return state.reservations.length !== before;
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

  adoptWorker(id) {
    return this._lock(() => {
      const state = this._read(); const index = state.reservations.findIndex((row) => row.id === id && row.kind === 'worker');
      if (index < 0) throw typed('active worker capacity reservation is missing', 'worktree_capacity_unavailable');
      const row = Object.freeze({ ...state.reservations[index], ownerId: this.ownerId, nonce: randomBytes(16).toString('hex'), pid: process.pid });
      state.reservations[index] = row; this._write(state); return row;
    });
  }

  reconcile(activeWorkerIds = []) {
    const active = new Set(activeWorkerIds.map((id) => `worker:${id}`));
    return this._lock(() => {
      const state = this._read(); const removed = [];
      const adopted = [];
      state.reservations = state.reservations.filter((row) => {
        if (row.kind === 'verify') { removed.push(row.id); return false; }
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
      return Object.freeze({ removed: Object.freeze(removed), adopted: Object.freeze(adopted), active: Object.freeze(state.reservations.map((row) => row.id)) });
    });
  }

  snapshot() {
    return this._lock(() => {
      const state = this._read();
      const totals = state.reservations.reduce((sum, row) => ({ bytes: sum.bytes + row.bytes, inodes: sum.inodes + row.inodes }), { bytes: 0, inodes: 0 });
      const stateDigest = digest({ schemaVersion: state.schemaVersion, policyDigest: state.policyDigest, reservations: state.reservations });
      return Object.freeze({ policyDigest: this.policy.digest, stateDigest, totals: Object.freeze(totals), reservations: Object.freeze(state.reservations.map((row) => Object.freeze({ ...row }))) });
    });
  }
}
