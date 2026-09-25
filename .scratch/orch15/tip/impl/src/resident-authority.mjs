import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync,
  mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

function residentError(message, code = 'application_host_authority_invalid', detail = undefined) {
  return Object.assign(new Error(message), { code, ...(detail === undefined ? {} : { detail }) });
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
  try { mkdirSync(path, { recursive: true, mode: 0o700 }); }
  catch (error) { throw authorityDirectoryRefusal(error, path); }
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (ownerUid !== null && Number.isInteger(stat.uid) && stat.uid !== ownerUid)) {
    throw residentError('resident authority directory is unsafe');
  }
  try { chmodSync(path, 0o700); }
  catch (error) { throw authorityDirectoryRefusal(error, path); }
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

/** Is the process that published an authority still the one that published it? `active` is the
 * only answer that proves the publication and the process agree; `stale` names a process that
 * is gone (or a live pid that was reused), which is exactly the release-then-SIGKILL state a
 * reader must never follow (U-F10/U-I11, #288). */
export function processState(pid, expectedStart) {
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

// #132 D2.2/F3 (wave-observability-2026-08-06/contract.md §D2.2): exported so the deployment host
// (`openBatonDeployment`) threads the SAME resident deployment id into the BatonApplication options
// that the ResidentAuthority would later read — one durable identity, no second file.
export function stableDeploymentId(root, repoId, ownerUid) {
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

function leaseOwner(value, repoId, deploymentId = null) {
  return exact(value, [
    'schemaVersion', 'repoId', 'deploymentId', 'incarnation', 'pid', 'pidStart', 'nonce', 'startedAt',
  ]) && value.schemaVersion === 1 && value.repoId === repoId
    && (deploymentId === null || value.deploymentId === deploymentId) && identifier(value.incarnation)
    && Number.isSafeInteger(value.pid) && value.pid > 0
    && typeof value.pidStart === 'string' && value.pidStart.length > 0
    && identifier(value.nonce) && Number.isFinite(Date.parse(value.startedAt));
}

/** U-E14 (#288): an errno on a resident authority directory — the lease directory or any of the
 * private directories the resident places it under — is a filesystem fact, never a busy resident.
 * The refusal names the errno, the path and that errno's own remedy, so an agent is never sent to
 * look for a holder that does not exist. Exported because it is the ONE derivation both the
 * directory creation and the lease acquisition refuse through. */
export function authorityDirectoryRefusal(error, path) {
  const errno = typeof error?.code === 'string' ? error.code : null;
  const parent = dirname(path);
  const remedy = {
    EACCES: `grant this user write access to ${parent}`,
    EPERM: `grant this user write access to ${parent}`,
    EROFS: `move the resident root off the read-only filesystem holding ${parent}`,
    ENOSPC: `free space on the filesystem holding ${parent}`,
    ENOTDIR: `replace the non-directory component of ${path} with a directory`,
    ENOENT: `create ${parent}`,
    ELOOP: `remove the symbolic-link loop at ${path}`,
    ENAMETOOLONG: `shorten ${path}`,
    EMFILE: 'raise this process file-descriptor budget',
    ENFILE: 'raise the system file-descriptor budget',
  }[errno] ?? `fix the filesystem condition ${errno ?? 'the kernel'} reports for ${parent}`;
  return residentError(
    `resident authority directory is unavailable (${errno ?? 'unknown errno'}: ${error?.message ?? 'the filesystem refused it'} at ${path}); ${remedy}`,
    'application_host_lease_unavailable',
    { errno, path, syscall: error?.syscall ?? 'mkdir', remedy },
  );
}

/** Withdraw exactly the bytes one write published, and REPORT what happened: `publish()`'s failure
 * path must not leave an orphan private file (U-E13, #288), and a withdrawal that itself fails is
 * evidence on the error the caller sees, never a silent drop. */
function withdrawPartial(path, expected, ownerUid) {
  try { return removeIfExact(path, expected, ownerUid) ? 'removed' : 'absent'; }
  catch (error) { return `failed:${error?.code ?? error?.name ?? 'error'}`; }
}

function acquireLease(root, repoId, deploymentId, ownerUid, now, {
  name = 'host.lease', bindDeployment = true,
} = {}) {
  const path = join(root, name);
  let reclaimed = false;
  while (true) {
    try { mkdirSync(path, { mode: 0o700 }); break; }
    catch (error) {
      if (error?.code !== 'EEXIST') throw authorityDirectoryRefusal(error, path);
      if (reclaimed) {
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
      if (!leaseOwner(prior, repoId, bindDeployment ? deploymentId : null)
        || processState(prior.pid, prior.pidStart) !== 'stale') {
        // Name the holder: one resident serves every worktree of this repository, so the
        // operator's next step is to use it (or stop it), not to look for a second one.
        const holder = leaseOwner(prior, repoId, null)
          ? { deploymentId: prior.deploymentId, incarnation: prior.incarnation, pid: prior.pid, startedAt: prior.startedAt } : null;
        throw residentError(holder
          ? `resident host is already active: deployment ${holder.deploymentId} (pid ${holder.pid}, since ${holder.startedAt}) publishes it; every worktree of this repository shares one resident`
          : 'resident host is already active', 'application_host_busy', { holder });
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
    // A lease directory that cannot be read is a lease this process does not hold — the SAME
    // refusal as a changed holder, never a raw errno (the caller reconciles either way).
    let observed;
    let current;
    try {
      observed = lstatSync(path);
      current = safeRegular(join(path, 'owner.json'), ownerUid, 16 * 1024);
    } catch (error) {
      throw residentError('resident host lease is unreadable', 'application_host_lease_lost', {
        path, cause: error?.code ?? error?.name ?? 'error',
      });
    }
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
  // sockaddr_un.sun_path is 104 bytes including the NUL terminator on Darwin (108 on Linux),
  // so 103 bytes is the portable ceiling; fall back to /tmp when the tmpdir root is deeper.
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
    // Bind publication files to one durable deployment. A stale deployment can therefore never
    // have its private profile/token overwritten before the repository selector changes.
    this.profile = `resident-${digest(repoId).slice(0, 12)}-${digest(this.deploymentId).slice(0, 12)}`;
    this.configRoot = safeConfigRoot(env, home, ownerUid);
    this.socketRoot = socketRoot(ownerUid);
    this.socketPath = join(this.socketRoot,
      `${digest(repoId).slice(0, 16)}-${digest(this.incarnation).slice(0, 12)}.sock`);
    // sockaddr_un.sun_path is 104 bytes including the NUL terminator on Darwin (108 on Linux),
    // so 103 bytes is the portable ceiling for a Unix socket path.
    if (Buffer.byteLength(this.socketPath) > 103) {
      this.lease.release();
      throw residentError('resident socket coordinate is too long');
    }
    this.sessionRoot = privateDirectory(join(this.root, 'sessions'), ownerUid);
    this.selectorRoot = privateDirectory(join(this.commonDir, 'baton'), ownerUid);
    this.profilePath = join(this.configRoot, `${this.profile}.json`);
    this.tokenPath = join(this.configRoot, `${this.profile}.token`);
    this.selectorPath = join(this.selectorRoot, 'connection.json');
    try {
      this.publicationLease = acquireLease(
        this.selectorRoot, repoId, this.deploymentId, ownerUid, now,
        { name: 'publication.lease', bindDeployment: false },
      );
    } catch (error) {
      this.lease.release();
      throw error;
    }
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

  /** Publish the resident's transport, its stream endpoints, and its registry identity.
   *
   * Issue #294: an orchestrator attaches to the resident's wake stream by READING this record, so
   * the stream endpoints belong in it. `streams` names them: `wakes` is the deployment-scope wake
   * feed, `events` is the ticketed per-Run feed, and `websocket` — when the operator declared the
   * loopback binding — carries the {host, port, path} an agent may attach to.
   *
   * The HTTP endpoints are derived from the transport this record already declares, so they are
   * written by default. A DECLARED binding is written only when the caller names it: every reader
   * of the on-disk record enforces an exact key set (application-cli.mjs `RESIDENT_PROFILE_FIELDS`),
   * so a new key on the profile is a reader-visible protocol change and is never smuggled in. */
  publish({ token, registryDigest, streams = undefined }) {
    this.lease.assertHeld();
    this.publicationLease.assertHeld();
    if (!this._socketIdentity) {
      throw residentError('resident socket is not confirmed', 'application_host_socket_invalid');
    }
    // A malformed declaration is the caller's error whether or not this incarnation already
    // published: it is refused before the idempotent replay below can hand back the record.
    const endpoints = this._streamEndpoints(streams);
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
      ownerPid: this.lease.pid, ownerPidStart: this.lease.pidStart,
      ...(streams === undefined ? {} : { streams: endpoints }),
    };
    const selectorBytes = bytes(selector);
    const profileBytes = bytes(profile);
    const tokenBytes = Buffer.from(`${token}\n`);
    let priorSelectorBytes = null;
    let recoveredStaleAuthority = false;
    if (existsSync(this.selectorPath)) {
      priorSelectorBytes = safeRegular(this.selectorPath, this.ownerUid);
      let prior;
      try { prior = JSON.parse(priorSelectorBytes.toString('utf8')); }
      catch { throw residentError('repository Baton authority is malformed', 'application_host_publication_conflict'); }
      const replaceable = prior?.schemaVersion === 2 && prior.repoId === this.repoId
        && prior.profile === this.profile && prior.deploymentId === this.deploymentId;
      if (!replaceable) {
        const residentProfilePrefix = `resident-${digest(this.repoId).slice(0, 12)}`;
        const legacyResidentProfile = `resident-${digest(this.repoId).slice(0, 16)}`;
        const identityMatches = prior?.schemaVersion === 2 && prior.repoId === this.repoId
          && (prior.profile === legacyResidentProfile
            || prior.profile.startsWith(`${residentProfilePrefix}-`))
          && prior.transport === 'local'
          && identifier(prior.deploymentId) && identifier(prior.incarnation);
        const priorProfilePath = identityMatches
          ? join(this.configRoot, `${prior.profile}.json`) : null;
        const priorProfile = priorProfilePath ? readJson(priorProfilePath, this.ownerUid) : null;
        const ownerFields = Object.hasOwn(priorProfile ?? {}, 'ownerPid')
          || Object.hasOwn(priorProfile ?? {}, 'ownerPidStart');
        const profileMatches = record(priorProfile)
          && priorProfile.schemaVersion === 2 && priorProfile.transport === 'local'
          && priorProfile.deploymentId === prior.deploymentId
          && priorProfile.incarnation === prior.incarnation
          && isAbsolute(priorProfile.socketPath ?? '') && !priorProfile.socketPath.includes('\0')
          && (!ownerFields || (Number.isSafeInteger(priorProfile.ownerPid)
            && priorProfile.ownerPid > 0 && typeof priorProfile.ownerPidStart === 'string'
            && priorProfile.ownerPidStart.length > 0));
        const socketAbsent = profileMatches && !existsSync(priorProfile.socketPath);
        const ownerStale = !ownerFields || processState(
          priorProfile.ownerPid, priorProfile.ownerPidStart,
        ) === 'stale';
        if (!identityMatches || !profileMatches || !socketAbsent || !ownerStale) {
          throw residentError('repository already selects a different Baton authority',
            'application_host_publication_conflict');
        }
        recoveredStaleAuthority = true;
      }
    }
    // U-E13 (#288): the private files are written before the selector because the selector is the
    // publication. A failure past this point (the reconciliation check below, or an errno from the
    // selector write) means this call published nothing, so the bytes it wrote are withdrawn —
    // exactly, by content — instead of surviving as an orphan token in the user's config root.
    try {
      replaceAtomic(this.tokenPath, tokenBytes);
      replaceAtomic(this.profilePath, profileBytes);
      if (priorSelectorBytes !== null) {
        const current = safeRegular(this.selectorPath, this.ownerUid);
        if (!current.equals(priorSelectorBytes)) {
          throw residentError('repository Baton authority changed during publication',
            'application_host_reconciliation_required');
        }
      }
      replaceAtomic(this.selectorPath, selectorBytes);
    } catch (error) {
      error.withdrawal = Object.freeze({
        token: withdrawPartial(this.tokenPath, tokenBytes, this.ownerUid),
        profile: withdrawPartial(this.profilePath, profileBytes, this.ownerUid),
      });
      throw error;
    }
    this._publication = Object.freeze({
      selectorBytes, profileBytes, tokenBytes, recoveredStaleAuthority,
      ...(streams === undefined ? {} : { streams: endpoints }),
    });
    return this.publicOutline();
  }

  /** The stream endpoints this publication serves. The two HTTP paths are the resident's own — the
   * wake feed and the ticketed Run event feed — and a declared loopback binding is admitted only
   * when it names a real host, a non-ephemeral port, and the wake path. */
  _streamEndpoints(streams) {
    const declared = streams === undefined || streams === null ? null : streams;
    if (declared !== null && (!record(declared)
      || Object.keys(declared).some((key) => key !== 'websocket'))) {
      throw residentError('resident stream endpoints are invalid');
    }
    const websocket = declared?.websocket ?? null;
    if (websocket !== null && (!record(websocket)
      || Object.keys(websocket).sort().join('\0') !== ['host', 'path', 'port'].sort().join('\0')
      || typeof websocket.host !== 'string' || websocket.host.length === 0
      || !Number.isSafeInteger(websocket.port) || websocket.port <= 0 || websocket.port > 65_535
      || websocket.path !== '/v1/wakes')) {
      throw residentError('resident wake binding declaration is invalid');
    }
    return Object.freeze({
      wakes: '/v1/wakes',
      events: '/v1/events',
      ...(websocket === null ? {} : { websocket: Object.freeze({ ...websocket }) }),
    });
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
      recoveredStaleAuthority: this._publication?.recoveredStaleAuthority ?? false,
      ...(this._publication?.streams === undefined ? {} : { streams: this._publication.streams }),
    });
  }

  close() {
    if (this._closed) return Object.freeze({ schemaVersion: 1, state: 'closed' });
    // U-E12/U-I10 (#288, #276(3)): withdraw the publication BEFORE asserting the leases. The
    // selector, the private profile/token and the socket are the only coordinates another
    // process can follow into this one, so a disturbed lease must be reported AFTER they are
    // gone — no publication ever points at an exiting process, and a close that cannot release
    // its lease (or is interrupted right here) still leaves nothing to follow.
    const withdrawn = this._publication;
    this._publication = null;
    if (withdrawn) {
      removeIfExact(this.selectorPath, withdrawn.selectorBytes, this.ownerUid);
      removeIfExact(this.profilePath, withdrawn.profileBytes, this.ownerUid);
      removeIfExact(this.tokenPath, withdrawn.tokenBytes, this.ownerUid);
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
    this.lease.assertHeld();
    this.publicationLease.assertHeld();
    this.publicationLease.release();
    this.lease.release();
    this._closed = true;
    return Object.freeze({ schemaVersion: 1, state: 'closed' });
  }
}
