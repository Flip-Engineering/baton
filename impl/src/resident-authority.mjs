import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync,
  mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

function residentError(message, code = 'application_host_authority_invalid') {
  return Object.assign(new Error(message), { code });
}
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys) {
  return record(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function digest(value) { return createHash('sha256').update(value).digest('hex'); }
function identifier(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/u.test(value); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!record(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function bytes(value) { return Buffer.from(`${JSON.stringify(canonical(value))}\n`); }

function fsyncDirectory(path) {
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function privateDirectory(path, ownerUid) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (ownerUid !== null && Number.isInteger(stat.uid) && stat.uid !== ownerUid)) {
    throw residentError('resident authority directory is unsafe');
  }
  chmodSync(path, 0o700);
  return realpathSync(path);
}

function processStartIdentity(pid) {
  try {
    const output = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8', maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1_000,
    }).trim();
    return output && Buffer.byteLength(output) <= 256 ? output : null;
  } catch { return null; }
}

function processState(pid, expectedStart) {
  let alive = false;
  try { process.kill(pid, 0); alive = true; }
  catch (error) {
    if (error?.code === 'EPERM') alive = true;
    else if (error?.code !== 'ESRCH') return 'unknown';
  }
  if (!alive) return 'stale';
  const observed = processStartIdentity(pid);
  if (!observed) return 'unknown';
  return observed === expectedStart ? 'active' : 'stale';
}

function safeRegular(path, ownerUid, maxBytes = 64 * 1024) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1
    || (stat.mode & 0o077) !== 0 || stat.size <= 0 || stat.size > maxBytes
    || (ownerUid !== null && Number.isInteger(stat.uid) && stat.uid !== ownerUid)) {
    throw residentError('resident authority file is unsafe');
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      throw residentError('resident authority file changed while reading');
    }
    return readFileSync(descriptor);
  } finally { closeSync(descriptor); }
}

function writeNew(path, content, mode = 0o600) {
  const descriptor = openSync(path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), mode);
  try {
    fchmodSync(descriptor, mode);
    writeFileSync(descriptor, content);
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
}

function replaceAtomic(path, content) {
  const parent = dirname(path);
  const temporary = join(parent, `.${basename(path)}-${randomUUID()}.tmp`);
  try {
    writeNew(temporary, content);
    renameSync(temporary, path);
    fsyncDirectory(parent);
  } finally { rmSync(temporary, { force: true }); }
}

function readJson(path, ownerUid) {
  let parsed;
  try { parsed = JSON.parse(safeRegular(path, ownerUid).toString('utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error?.code) throw error;
    throw residentError('resident authority JSON is malformed');
  }
  return parsed;
}

function stableDeploymentId(root, repoId, ownerUid) {
  const path = join(root, 'deployment.json');
  if (!existsSync(path)) {
    try {
      writeNew(path, bytes({ schemaVersion: 1, repoId, deploymentId: `deployment-${randomUUID()}` }));
      fsyncDirectory(root);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  const value = readJson(path, ownerUid);
  if (!exact(value, ['schemaVersion', 'repoId', 'deploymentId']) || value.schemaVersion !== 1
    || value.repoId !== repoId || !identifier(value.deploymentId)) {
    throw residentError('resident deployment identity is invalid');
  }
  return value.deploymentId;
}

function leaseOwner(value, repoId, deploymentId) {
  return exact(value, [
    'schemaVersion', 'repoId', 'deploymentId', 'incarnation', 'pid', 'pidStart', 'nonce', 'startedAt',
  ]) && value.schemaVersion === 1 && value.repoId === repoId
    && value.deploymentId === deploymentId && identifier(value.incarnation)
    && Number.isSafeInteger(value.pid) && value.pid > 0
    && typeof value.pidStart === 'string' && value.pidStart.length > 0
    && identifier(value.nonce) && Number.isFinite(Date.parse(value.startedAt));
}

function acquireLease(root, repoId, deploymentId, ownerUid, now) {
  const path = join(root, 'host.lease');
  let reclaimed = false;
  while (true) {
    try { mkdirSync(path, { mode: 0o700 }); break; }
    catch (error) {
      if (error?.code !== 'EEXIST' || reclaimed) {
        throw residentError('resident host is already active', 'application_host_busy');
      }
      let stat;
      let raw;
      let prior;
      try {
        stat = lstatSync(path);
        if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
          || (ownerUid !== null && stat.uid !== ownerUid)) throw new Error('unsafe');
        raw = safeRegular(join(path, 'owner.json'), ownerUid, 16 * 1024);
        prior = JSON.parse(raw.toString('utf8'));
      } catch { throw residentError('resident host ownership is ambiguous', 'application_host_busy'); }
      if (!leaseOwner(prior, repoId, deploymentId)
        || processState(prior.pid, prior.pidStart) !== 'stale') {
        throw residentError('resident host is already active', 'application_host_busy');
      }
      const observed = lstatSync(path);
      const current = safeRegular(join(path, 'owner.json'), ownerUid, 16 * 1024);
      if (observed.dev !== stat.dev || observed.ino !== stat.ino || !current.equals(raw)) {
        throw residentError('resident host ownership changed during recovery', 'application_host_busy');
      }
      rmSync(path, { recursive: true, force: false });
      fsyncDirectory(root);
      reclaimed = true;
    }
  }
  const identity = lstatSync(path);
  const pidStart = processStartIdentity(process.pid);
  if (!pidStart) {
    rmSync(path, { recursive: true, force: true });
    throw residentError('resident process start identity is unavailable');
  }
  const owner = {
    schemaVersion: 1, repoId, deploymentId, incarnation: `instance-${randomUUID()}`,
    pid: process.pid, pidStart, nonce: randomUUID(), startedAt: new Date(now()).toISOString(),
  };
  const raw = bytes(owner);
  try {
    writeNew(join(path, 'owner.json'), raw);
    fsyncDirectory(path);
    fsyncDirectory(root);
  } catch (error) {
    rmSync(path, { recursive: true, force: true });
    throw error;
  }
  let active = true;
  const assertHeld = () => {
    if (!active) throw residentError('resident host lease is released', 'application_host_lease_lost');
    const observed = lstatSync(path);
    const current = safeRegular(join(path, 'owner.json'), ownerUid, 16 * 1024);
    if (observed.dev !== identity.dev || observed.ino !== identity.ino || !current.equals(raw)) {
      throw residentError('resident host lease changed', 'application_host_lease_lost');
    }
    return true;
  };
  const release = () => {
    if (!active) return false;
    assertHeld();
    rmSync(path, { recursive: true, force: false });
    fsyncDirectory(root);
    active = false;
    return true;
  };
  return Object.freeze({ ...owner, assertHeld, release });
}

function safeConfigRoot(env, home, ownerUid) {
  if (typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.length > 0
    && !isAbsolute(env.XDG_CONFIG_HOME)) {
    throw residentError('XDG_CONFIG_HOME must be absolute');
  }
  const base = typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.length > 0
    ? env.XDG_CONFIG_HOME
    : typeof home === 'string' && isAbsolute(home) ? join(home, '.config') : null;
  if (!base) throw residentError('resident user configuration home is unavailable');
  return privateDirectory(join(base, 'baton', 'connections'), ownerUid);
}

function socketRoot(ownerUid) {
  const uid = ownerUid === null ? 'owner' : String(ownerUid);
  const preferred = join(tmpdir(), `baton-${uid}`);
  const root = privateDirectory(preferred, ownerUid);
  if (Buffer.byteLength(join(root, 'x'.repeat(48))) > 103) {
    return privateDirectory(`/tmp/baton-${uid}`, ownerUid);
  }
  return root;
}

function removeIfExact(path, expected, ownerUid) {
  if (!existsSync(path)) return false;
  const current = safeRegular(path, ownerUid, Math.max(64 * 1024, expected.length));
  if (!current.equals(expected)) return false;
  unlinkSync(path);
  fsyncDirectory(dirname(path));
  return true;
}

/** Deployment-owned resident identity, lease and publication authority. Secrets and paths remain
 * internal; public projection is deliberately limited to stable deployment and fresh incarnation. */
export class ResidentAuthority {
  constructor({
    deploymentRoot, commonDir, repoId,
    env = process.env, home = env.HOME ?? homedir(),
    ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
    now = Date.now,
  }) {
    if (!isAbsolute(deploymentRoot) || !isAbsolute(commonDir) || !identifier(repoId)
      || typeof now !== 'function') throw residentError('resident authority configuration is invalid');
    this.ownerUid = ownerUid;
    this.repoId = repoId;
    this.commonDir = realpathSync(commonDir);
    this.root = privateDirectory(join(deploymentRoot, 'resident'), ownerUid);
    this.deploymentId = stableDeploymentId(this.root, repoId, ownerUid);
    this.lease = acquireLease(this.root, repoId, this.deploymentId, ownerUid, now);
    this.incarnation = this.lease.incarnation;
    this.startedAt = this.lease.startedAt;
    this.origin = 'https://baton.local';
    this.profile = `resident-${digest(repoId).slice(0, 16)}`;
    this.configRoot = safeConfigRoot(env, home, ownerUid);
    this.socketRoot = socketRoot(ownerUid);
    this.socketPath = join(this.socketRoot,
      `${digest(repoId).slice(0, 16)}-${digest(this.incarnation).slice(0, 12)}.sock`);
    if (Buffer.byteLength(this.socketPath) > 103) {
      this.lease.release();
      throw residentError('resident socket coordinate is too long');
    }
    this.sessionRoot = privateDirectory(join(this.root, 'sessions'), ownerUid);
    this.profilePath = join(this.configRoot, `${this.profile}.json`);
    this.tokenPath = join(this.configRoot, `${this.profile}.token`);
    this.selectorRoot = privateDirectory(join(this.commonDir, 'baton'), ownerUid);
    this.selectorPath = join(this.selectorRoot, 'connection.json');
    this._publication = null;
    this._socketIdentity = null;
    this._closed = false;
  }

  card() {
    return Object.freeze({
      schemaVersion: 1,
      deploymentId: this.deploymentId,
      incarnation: this.incarnation,
      transport: 'local',
      startedAt: this.startedAt,
    });
  }

  confirmSocket() {
    this.lease.assertHeld();
    const stat = lstatSync(this.socketPath);
    if (!stat.isSocket() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
      || (this.ownerUid !== null && stat.uid !== this.ownerUid)) {
      throw residentError('resident socket authority is unsafe', 'application_host_socket_invalid');
    }
    this._socketIdentity = Object.freeze({ dev: stat.dev, ino: stat.ino, uid: stat.uid });
    return true;
  }

  publish({ token, registryDigest }) {
    this.lease.assertHeld();
    if (!this._socketIdentity) {
      throw residentError('resident socket is not confirmed', 'application_host_socket_invalid');
    }
    if (this._publication) return this.publicOutline();
    if (typeof token !== 'string' || token.length < 40 || token.includes('\n') || token.includes('\r')
      || !/^[a-f0-9]{64}$/u.test(registryDigest ?? '')) {
      throw residentError('resident publication authority is invalid');
    }
    const selector = {
      schemaVersion: 2, profile: this.profile, repoId: this.repoId,
      deploymentId: this.deploymentId, incarnation: this.incarnation,
      transport: 'local', registryDigest, startedAt: this.startedAt,
    };
    const profile = {
      schemaVersion: 2, transport: 'local', socketPath: this.socketPath,
      url: this.origin, origin: this.origin, tokenFile: basename(this.tokenPath),
      deploymentId: this.deploymentId, incarnation: this.incarnation,
      registryDigest, startedAt: this.startedAt,
    };
    const selectorBytes = bytes(selector);
    const profileBytes = bytes(profile);
    const tokenBytes = Buffer.from(`${token}\n`);
    if (existsSync(this.selectorPath)) {
      const prior = readJson(this.selectorPath, this.ownerUid);
      const replaceable = prior?.schemaVersion === 2 && prior.repoId === this.repoId
        && prior.profile === this.profile && prior.deploymentId === this.deploymentId;
      if (!replaceable) {
        throw residentError('repository already selects a different Baton authority',
          'application_host_publication_conflict');
      }
    }
    replaceAtomic(this.tokenPath, tokenBytes);
    replaceAtomic(this.profilePath, profileBytes);
    replaceAtomic(this.selectorPath, selectorBytes);
    this._publication = Object.freeze({ selectorBytes, profileBytes, tokenBytes });
    return this.publicOutline();
  }

  publicOutline() {
    return Object.freeze({
      schemaVersion: 1,
      state: this._publication ? 'published' : 'private',
      transport: 'local',
      repoId: this.repoId,
      deploymentId: this.deploymentId,
      incarnation: this.incarnation,
      startedAt: this.startedAt,
    });
  }

  close() {
    if (this._closed) return Object.freeze({ schemaVersion: 1, state: 'closed' });
    this.lease.assertHeld();
    if (this._publication) {
      removeIfExact(this.selectorPath, this._publication.selectorBytes, this.ownerUid);
      removeIfExact(this.profilePath, this._publication.profileBytes, this.ownerUid);
      removeIfExact(this.tokenPath, this._publication.tokenBytes, this.ownerUid);
    }
    if (existsSync(this.socketPath)) {
      const stat = lstatSync(this.socketPath);
      if (!this._socketIdentity || !stat.isSocket() || stat.isSymbolicLink()
        || stat.dev !== this._socketIdentity.dev || stat.ino !== this._socketIdentity.ino
        || (this.ownerUid !== null && stat.uid !== this.ownerUid)) {
        throw residentError('resident socket ownership changed during close',
          'application_host_reconciliation_required');
      }
      unlinkSync(this.socketPath);
    }
    this.lease.release();
    this._closed = true;
    return Object.freeze({ schemaVersion: 1, state: 'closed' });
  }
}
