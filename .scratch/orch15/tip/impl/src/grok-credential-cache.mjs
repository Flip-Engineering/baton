import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync, closeSync, constants as fsConstants, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// GrokCredentialCache — the #84 grok OIDC refresh_token controller on the #11 pattern
// (docs/reference/evidence/frontier-sweep-2026-08-03/readiness-credentials-contract.md §4.3.1).
// The operator credential is ~/.grok/auth.json, a scope-keyed record whose subscription/OIDC
// scopes carry access_token (`key`), refresh_token, and an RFC3339 expires_at. The vendor CLI
// owns refresh; this controller owns the bounded, isolated refresh-runtime harness and the
// single-flight / advisory-lockfile / mtime-CAS / revocation-latch discipline — every seam the
// #11 ClaudeCredentialCache built, vendor-adjusted to grok's HOME-relative write-back target
// (`directory/.grok/auth.json`, never the claude flat sibling).

const MAX_CREDENTIAL_BYTES = 64 * 1024;
const MAX_MS_EPOCH = 8_640_000_000_000_000;
const flights = new Map();

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function credentialError(code, message) {
  return Object.assign(new Error(message), { code });
}

function boundedToken(value, required = true) {
  if (value === undefined && !required) return null;
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= MAX_CREDENTIAL_BYTES && !/[\0\r\n]/u.test(value)
    ? value : null;
}

function digest(value) {
  if (value == null) return null;
  try {
    const bytes = Buffer.isBuffer(value) || typeof value === 'string'
      ? value : JSON.stringify(value);
    return createHash('sha256').update(bytes).digest('hex');
  } catch { return null; }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function defaultFileProbe(path) {
  try {
    const stat = lstatSync(path);
    return Object.freeze({ exists: stat.isFile() && !stat.isSymbolicLink(), mtimeMs: stat.mtimeMs });
  } catch { return Object.freeze({ exists: false, mtimeMs: null }); }
}

function defaultFileRead(path) {
  let descriptor;
  try {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink()
      || before.size <= 0 || before.size > MAX_CREDENTIAL_BYTES) return null;
    descriptor = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size <= 0 || opened.size > MAX_CREDENTIAL_BYTES) return null;
    return readFileSync(descriptor);
  } catch { return null; }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

/** The advisory lockfile: O_CREAT|O_EXCL, 0600, typed timeout. The lock timeout is a real-clock
 * resource bound (the credential-lockfile timeout row the suite explicitly permits) — never a
 * work control. */
async function acquireLock(path, { timeoutMs = 30_000, pollMs = 10 } = {}) {
  const started = Date.now();
  for (;;) {
    let descriptor;
    let created = false;
    try {
      descriptor = openSync(path, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600);
      created = true;
      writeFileSync(descriptor, `${process.pid}\n`, 'utf8');
      closeSync(descriptor);
      return () => rmSync(path, { force: true });
    } catch (error) {
      if (descriptor !== undefined) try { closeSync(descriptor); } catch {}
      if (created) rmSync(path, { force: true });
      if (error?.code !== 'EEXIST') throw error;
      if (Date.now() - started >= timeoutMs) {
        throw credentialError('authentication_refresh_locked', 'Grok credential refresh lock timed out');
      }
      await wait(pollMs);
    }
  }
}

/** Refuse partial/corrupt write-backs before freshness is considered. The grok auth.json is a
 * scope-keyed record; the primary scope is the freshest subscription/OIDC entry. */
export function grokCredentialCandidate(value, {
  source = 'unknown', sourceMtimeMs = null, requireRefreshToken = false,
} = {}) {
  let root = value;
  if (typeof root === 'string' || Buffer.isBuffer(root)) {
    if (Buffer.byteLength(root) <= 0 || Buffer.byteLength(root) > MAX_CREDENTIAL_BYTES) return null;
    try { root = JSON.parse(String(root)); } catch { return null; }
  }
  if (!record(root)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(root), 'utf8') > MAX_CREDENTIAL_BYTES) return null;
  } catch { return null; }
  const entries = Object.entries(root);
  if (entries.length === 0 || entries.length > 32) return null;
  let primary = null;
  for (const [scope, entry] of entries) {
    if (scope.length === 0 || scope.length > 1024 || /[\0\r\n]/u.test(scope)) return null;
    if (!record(entry)) return null;
    const access = boundedToken(entry.key);
    const refresh = boundedToken(entry.refresh_token, false);
    // The CLI documents xai::api_key as its non-expiring, locally selected API-key scope; every
    // cached subscription/OIDC session is time-bound and must carry explicit RFC3339 expiry.
    if (scope === 'xai::api_key') {
      if (!access) return null;
      if (!primary) primary = { accessToken: access, refreshToken: null, expiresAt: MAX_MS_EPOCH, scope };
      continue;
    }
    if (!access && !refresh) return null;
    if (typeof entry.expires_at !== 'string' || entry.expires_at.length === 0
      || entry.expires_at.length > 128 || /[\0\r\n]/u.test(entry.expires_at)) return null;
    const expiresAt = Date.parse(entry.expires_at);
    if (!Number.isFinite(expiresAt)) return null;
    if (requireRefreshToken && !refresh) return null;
    if (!primary || expiresAt > primary.expiresAt) {
      primary = { accessToken: access, refreshToken: refresh, expiresAt, scope };
    }
  }
  if (!primary || !primary.accessToken || primary.expiresAt === null) return null;
  if (requireRefreshToken && !primary.refreshToken) return null;
  const freezeWire = (wire) => Object.freeze(Object.fromEntries(
    Object.entries(wire).map(([scope, entry]) => [scope, Object.freeze({ ...entry })]),
  ));
  return Object.freeze({
    accessToken: primary.accessToken,
    refreshToken: primary.refreshToken,
    expiresAt: primary.expiresAt,
    scope: primary.scope,
    source, sourceMtimeMs,
    // The deployment-side refresh runtime needs the vendor schema. This object never enters a
    // worker projection; RuntimeIsolation receives projectionEnv()/projectionFiles() only.
    wire: freezeWire(root),
  });
}

function atomicPersist(path, wire) {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const temporary = join(parent, `.${process.pid}.${randomBytes(8).toString('hex')}.credential.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(wire)}\n`, { mode: 0o600, flag: 'wx' });
    chmodSync(temporary, 0o600);
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

/** The vendor-executed refresh runtime for grok. The vendor CLI owns refresh; this harness owns
 * the bounded, isolated runtime: a throwaway scoped HOME, the credential projected at the
 * vendor-native HOME-relative target (`directory/.grok/auth.json`, contract fold F-3), bounded
 * stdout/stderr capture, invalid_grant|revok detection, SIGKILL timeout, and a write-back read
 * from the same target. cmdEnv merges suite/test seams (e.g. the fixture sentinel + TMPDIR) into
 * the child's scoped env — the claude sibling's env is fully scoped. */
function defaultGrokRefreshRuntime({
  cmd, cmdArgs = [], cmdEnv = {}, credential, directory, timeoutMs = 30_000,
}) {
  const grokPath = join(directory, '.grok', 'auth.json');
  mkdirSync(join(directory, '.grok'), { recursive: true, mode: 0o700 });
  writeFileSync(grokPath, `${JSON.stringify(credential.wire)}\n`, { mode: 0o600 });
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(cmd, [...cmdArgs], {
      env: {
        PATH: process.env.PATH,
        HOME: directory,
        TMPDIR: join(directory, 'tmp'),
        ...cmdEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const append = (current, chunk) => `${current}${String(chunk)}`.slice(-MAX_CREDENTIAL_BYTES);
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => finish({ ok: false, error }));
    child.on('close', (code) => finish({
      ok: code === 0,
      invalidGrant: /invalid_grant|revok/iu.test(`${stdout}\n${stderr}`),
      runtimeCredential: defaultFileRead(grokPath),
      writeBackTarget: 'grok_native_tree',
    }));
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish({ ok: false, error: credentialError('authentication_refresh_timeout', 'Grok credential refresh timed out') });
    }, timeoutMs);
    timer.unref?.();
  });
}

/** Deployment-owned, access-token-only grok credential authority. */
export class GrokCredentialCache {
  static async open(options = {}) {
    const cache = new GrokCredentialCache(options);
    await cache._readAtOpen();
    return cache;
  }

  constructor(options = {}) {
    this.path = options.credentialPath;
    if (typeof this.path !== 'string' || this.path.length === 0) {
      throw new TypeError('Grok credential cache requires credentialPath');
    }
    this.lockPath = options.lockPath ?? `${this.path}.baton-refresh.lock`;
    this.refreshRoot = options.refreshRoot ?? join(dirname(this.path), '.baton-grok-refresh');
    this.now = options.now ?? Date.now;
    this.fileRead = options.fileRead ?? defaultFileRead;
    this.fileProbe = options.fileProbe ?? defaultFileProbe;
    this.refreshRuntime = options.refreshRuntime
      ?? ((input) => defaultGrokRefreshRuntime({
        cmd: options.cmd ?? 'grok', cmdArgs: options.cmdArgs ?? [], cmdEnv: options.cmdEnv ?? {}, ...input,
      }));
    this.persist = options.persist ?? atomicPersist;
    this.onReceipt = options.onReceipt ?? (() => {});
    this.lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
    this.lockPollMs = options.lockPollMs ?? 10;
    this.credential = null;
    this.source = 'absent';
    this.revocationLatched = false;
    this.openDigest = null;
    this.openMtime = null;
  }

  _readOperatorFile() {
    const raw = this.fileRead(this.path);
    return {
      raw,
      digest: digest(raw),
      mtime: this.fileProbe(this.path).mtimeMs,
      candidate: grokCredentialCandidate(raw, {
        source: 'file', sourceMtimeMs: this.fileProbe(this.path).mtimeMs,
      }),
    };
  }

  async _readAtOpen() {
    const file = this._readOperatorFile();
    this.openDigest = file.digest;
    this.openMtime = file.mtime;
    this.credential = file.candidate;
    this.source = file.candidate ? 'file' : 'absent';
  }

  /** The worker env projection — access-token-only; the refresh token never leaves the cache. */
  projectionEnv() {
    return this.credential && !this.revocationLatched
      ? Object.freeze({ XAI_API_KEY: this.credential.accessToken }) : Object.freeze({});
  }

  credentialEnv() { return Object.freeze({ grok: this.projectionEnv() }); }

  /** The FILE-projection surface (suite-declared sibling of projectionEnv()): grok's native
   * worker projection is file-based (the runtime copies ~/.grok/auth.json), so this returns the
   * access-token-only credential file list the deployment wires into RuntimeIsolation. */
  projectionFiles() {
    if (!this.credential || this.revocationLatched) return Object.freeze([]);
    const target = join(this.refreshRoot, 'projected', 'auth.json');
    const wire = {};
    for (const [scope, entry] of Object.entries(this.credential.wire)) {
      const { refresh_token, ...rest } = entry;
      wire[scope] = rest;
    }
    atomicPersist(target, wire);
    return Object.freeze([target]);
  }

  metadata() {
    const credential = this.credential;
    const file = this.fileProbe(this.path);
    const refreshUsable = credential?.refreshToken
      && (credential.expiresAt === MAX_MS_EPOCH || credential.expiresAt > this.now());
    const state = this.revocationLatched || !credential || !refreshUsable
      ? 'expired_needs_login' : credential.expiresAt > this.now() ? 'fresh' : 'stale';
    return Object.freeze({
      expiresAt: credential?.expiresAt ?? null,
      refreshTokenExpiresAt: null,
      state,
      units: 'ms epoch',
      ...(state === 'stale' ? { label: 'refresh-unverified until attempted (#47 tier)' } : {}),
      operatorFile: Object.freeze({ exists: file.exists, mtimeMs: file.mtimeMs }),
    });
  }

  async ensureFresh() {
    if (this.revocationLatched) {
      throw credentialError('authentication_refresh_required', 'Grok credential refresh is blocked until explicit login/refresh');
    }
    if (!this.credential) throw credentialError('authentication_required', 'Grok authentication is absent');
    if (this.credential.expiresAt <= this.now()) return this.refresh({ reason: 'spawn_ttl_gate' });
    return this.credential;
  }

  async refresh({ reason = 'worker_authentication_refresh_required', explicit = false } = {}) {
    if (explicit) this.revocationLatched = false;
    if (this.revocationLatched) {
      throw credentialError('authentication_refresh_required', 'Grok credential refresh is latched after revocation');
    }
    const key = this.path;
    if (flights.has(key)) {
      return flights.get(key).then((credential) => {
        if (!this.credential || credential.expiresAt > this.credential.expiresAt) {
          this.credential = credential;
          this.source = credential.source;
        }
        return credential;
      });
    }
    const flight = this._refreshFlight({ reason, explicit }).finally(() => {
      if (flights.get(key) === flight) flights.delete(key);
    });
    flights.set(key, flight);
    return flight;
  }

  async _refreshFlight({ reason, explicit }) {
    const incumbent = this.credential;
    // Latch before the advisory lockfile so an absent credential (or one with no refresh token)
    // refuses without touching the operator's config tree — never a lockfile/dir creation side
    // effect on a HOME-relative path that may not exist (RT-13a's absent-credential refusal).
    if (!incumbent?.refreshToken) {
      this.revocationLatched = true;
      throw credentialError('authentication_refresh_required', 'Grok refresh token is absent');
    }
    const release = await acquireLock(this.lockPath, {
      timeoutMs: this.lockTimeoutMs, pollMs: this.lockPollMs,
    });
    const directory = join(this.refreshRoot, `${process.pid}-${randomBytes(8).toString('hex')}`);
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const before = this._readOperatorFile();
      const sourceFile = grokCredentialCandidate(this.fileRead(this.path), {
        source: 'operator_file', sourceMtimeMs: this.fileProbe(this.path).mtimeMs,
        requireRefreshToken: true,
      });
      // A fresher operator credential that appeared before this flight (another process refreshed
      // it) is adopted without running the vendor CLI.
      const preexisting = sourceFile && (!incumbent || sourceFile.expiresAt > incumbent.expiresAt)
        ? sourceFile : null;
      if (preexisting) {
        this.credential = preexisting;
        return preexisting;
      }
      const result = await this.refreshRuntime({ credential: incumbent, directory, reason });
      if (result?.invalidGrant === true) {
        this.revocationLatched = true;
        throw credentialError('authentication_refresh_required', 'Grok refresh token was revoked (invalid_grant)');
      }
      const after = this._readOperatorFile();
      const afterCandidate = grokCredentialCandidate(after.raw, {
        source: 'operator_file', sourceMtimeMs: after.mtime, requireRefreshToken: true,
      });
      // mtime-CAS: an operator auth.json change under the flight invalidates the runtime adoption.
      // Re-read the freshest operator value and compare it against the incumbent instead.
      const operatorChanged = before.mtime !== after.mtime || before.digest !== after.digest;
      const runtimeCandidate = operatorChanged ? null : grokCredentialCandidate(result?.runtimeCredential, {
        source: 'runtime_projected_file', requireRefreshToken: true,
      });
      const returnedCandidate = operatorChanged ? null : grokCredentialCandidate(result?.candidate, {
        source: 'refresh_runtime', requireRefreshToken: true,
      });
      const harvest = [afterCandidate, runtimeCandidate, returnedCandidate, incumbent]
        .filter(Boolean).sort((left, right) => right.expiresAt - left.expiresAt)[0];
      if (!harvest || harvest.expiresAt <= incumbent.expiresAt) {
        throw credentialError('authentication_refresh_required', 'Grok refresh produced no strictly fresher schema-valid credential');
      }
      this.credential = harvest;
      this.source = harvest.source;
      this.onReceipt(Object.freeze({ reason, writeBackTarget: result?.writeBackTarget ?? harvest.source }));
      if (explicit) this.persist(this.path, harvest.wire); // explicit-command-only persist-back
      return harvest;
    } finally {
      rmSync(directory, { recursive: true, force: true });
      release();
    }
  }

  async explicitRefresh() {
    this.revocationLatched = false; // explicit `baton credentials refresh grok` clears latch.
    return this.refresh({ reason: 'explicit_command', explicit: true });
  }
}
