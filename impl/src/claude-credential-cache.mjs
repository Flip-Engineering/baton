import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync, closeSync, constants as fsConstants, fstatSync, lstatSync, mkdirSync, openSync,
  readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

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

function msEpoch(value, required = true) {
  if ((value === undefined || value === null) && !required) return null;
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_MS_EPOCH ? value : null;
}

/** Refuse partial/corrupt write-backs before freshness is considered. */
export function claudeCredentialCandidate(value, {
  source = 'unknown', sourceMtimeMs = null, requireRefreshToken = false,
} = {}) {
  let root = value;
  if (typeof root === 'string' || Buffer.isBuffer(root)) {
    if (Buffer.byteLength(root) <= 0 || Buffer.byteLength(root) > MAX_CREDENTIAL_BYTES) return null;
    try { root = JSON.parse(String(root)); } catch { return null; }
  }
  if (!record(root) || !record(root.claudeAiOauth)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(root), 'utf8') > MAX_CREDENTIAL_BYTES) return null;
  } catch { return null; }
  const oauth = root.claudeAiOauth;
  const accessToken = boundedToken(oauth.accessToken);
  const refreshToken = boundedToken(oauth.refreshToken, false);
  const expiresAt = msEpoch(oauth.expiresAt);
  const refreshTokenExpiresAt = msEpoch(oauth.refreshTokenExpiresAt, false);
  if (!accessToken || expiresAt === null || (requireRefreshToken && !refreshToken)
    || (oauth.refreshToken !== undefined && refreshToken === null)
    || (oauth.refreshTokenExpiresAt !== undefined && refreshTokenExpiresAt === null)) return null;
  return Object.freeze({
    accessToken, refreshToken, expiresAt, refreshTokenExpiresAt,
    source, sourceMtimeMs,
    // The deployment-side refresh runtime needs the vendor schema. This object never enters a
    // worker projection; RuntimeIsolation receives projectionEnv() only.
    wire: Object.freeze({ ...root, claudeAiOauth: Object.freeze({ ...oauth }) }),
  });
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

async function acquireLock(path, { now, timeoutMs = 30_000, pollMs = 10 } = {}) {
  const started = now();
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
      if ((now() - started) >= timeoutMs) {
        throw credentialError('authentication_refresh_locked', 'Claude credential refresh lock timed out');
      }
      await wait(pollMs);
    }
  }
}

function defaultRefreshRuntime({ cmd, cmdArgs = [], credential, directory, timeoutMs = 30_000 }) {
  const credentialPath = join(directory, '.credentials.json');
  writeFileSync(credentialPath, `${JSON.stringify(credential.wire)}\n`, { mode: 0o600 });
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(cmd, [...cmdArgs, '--print', 'Return OK.', '--output-format', 'json'], {
      env: {
        PATH: process.env.PATH,
        HOME: directory,
        CLAUDE_CONFIG_DIR: directory,
        CLAUDE_CODE_OAUTH_TOKEN: credential.accessToken,
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
      runtimeCredential: defaultFileRead(credentialPath),
      writeBackTarget: defaultFileProbe(credentialPath).mtimeMs === null ? null : 'runtime_projected_file',
    }));
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      finish({ ok: false, error: credentialError('authentication_refresh_timeout', 'Claude credential refresh timed out') });
    }, timeoutMs);
    timer.unref?.();
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

/** Deployment-owned, access-token-only Claude credential authority. */
export class ClaudeCredentialCache {
  static async open(options = {}) {
    const cache = new ClaudeCredentialCache(options);
    await cache._readAtOpen();
    return cache;
  }

  constructor(options = {}) {
    this.path = options.credentialPath;
    if (typeof this.path !== 'string' || this.path.length === 0) {
      throw new TypeError('Claude credential cache requires credentialPath');
    }
    this.lockPath = options.lockPath ?? `${this.path}.baton-refresh.lock`;
    this.refreshRoot = options.refreshRoot ?? join(dirname(this.path), '.baton-claude-refresh');
    this.now = options.now ?? Date.now;
    this.fileRead = options.fileRead ?? defaultFileRead;
    this.fileProbe = options.fileProbe ?? defaultFileProbe;
    this.keychainRead = options.keychainRead ?? (() => null);
    this.keychainMtime = options.keychainMtime ?? (() => null);
    this.refreshRuntime = options.refreshRuntime
      ?? ((input) => defaultRefreshRuntime({
        cmd: options.cmd ?? 'claude', cmdArgs: options.cmdArgs ?? [], ...input,
      }));
    this.persist = options.persist ?? atomicPersist;
    this.onReceipt = options.onReceipt ?? (() => {});
    this.lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
    this.lockPollMs = options.lockPollMs ?? 10;
    this.credential = null;
    this.source = 'absent';
    this.revocationLatched = false;
    this.openKeychainDigest = null;
    this.openKeychainMtime = null;
  }

  async _readKeychain() {
    const raw = await this.keychainRead();
    return {
      raw,
      digest: digest(raw),
      mtime: await this.keychainMtime(),
      candidate: claudeCredentialCandidate(raw, { source: 'keychain' }),
    };
  }

  async _readAtOpen() {
    const keychain = await this._readKeychain();
    this.openKeychainDigest = keychain.digest;
    this.openKeychainMtime = keychain.mtime;
    const file = claudeCredentialCandidate(this.fileRead(this.path), {
      source: 'file', sourceMtimeMs: this.fileProbe(this.path).mtimeMs,
    });
    this.credential = keychain.candidate ?? file;
    this.source = keychain.candidate ? (file ? 'keychain_preferred' : 'keychain_only')
      : file ? 'file_fallback' : 'absent';
  }

  projectionEnv() {
    return this.credential && !this.revocationLatched
      ? Object.freeze({ CLAUDE_CODE_OAUTH_TOKEN: this.credential.accessToken }) : Object.freeze({});
  }

  credentialEnv() { return Object.freeze({ claude: this.projectionEnv() }); }

  metadata() {
    const file = this.fileProbe(this.path); // cheap per-read stat; never calls Keychain.
    const credential = this.credential;
    const refreshUsable = credential?.refreshToken
      && (credential.refreshTokenExpiresAt === null || credential.refreshTokenExpiresAt > this.now());
    const state = this.revocationLatched || !credential || !refreshUsable
      ? 'expired_needs_login' : credential.expiresAt > this.now() ? 'fresh' : 'stale';
    const sourceCode = this.source === 'keychain_only' && !file.exists
      ? 'claude_credentials_keychain_only' : !credential ? 'claude_credentials_absent' : null;
    return Object.freeze({
      expiresAt: credential?.expiresAt ?? null,
      refreshTokenExpiresAt: credential?.refreshTokenExpiresAt ?? null,
      state,
      units: 'ms epoch',
      ...(state === 'stale' ? { label: 'refresh-unverified until attempted (#47 tier)' } : {}),
      ...(sourceCode ? { code: sourceCode } : {}),
      operatorFile: Object.freeze({ exists: file.exists, mtimeMs: file.mtimeMs }),
    });
  }

  async ensureFresh() {
    if (this.revocationLatched) {
      throw credentialError('authentication_refresh_required', 'Claude credential refresh is blocked until explicit login/refresh');
    }
    if (!this.credential) throw credentialError('authentication_required', 'Claude authentication is absent');
    if (this.credential.expiresAt <= this.now()) return this.refresh({ reason: 'spawn_ttl_gate' });
    return this.credential;
  }

  async refresh({ reason = 'worker_authentication_refresh_required', explicit = false } = {}) {
    if (explicit) this.revocationLatched = false;
    if (this.revocationLatched) {
      throw credentialError('authentication_refresh_required', 'Claude credential refresh is latched after revocation');
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
    const release = await acquireLock(this.lockPath, {
      now: this.now, timeoutMs: this.lockTimeoutMs, pollMs: this.lockPollMs,
    });
    const directory = join(this.refreshRoot, `${process.pid}-${randomBytes(8).toString('hex')}`);
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const before = await this._readKeychain();
      const incumbent = this.credential;
      const beforeCandidate = claudeCredentialCandidate(before.raw, {
        source: 'keychain', requireRefreshToken: true,
      });
      const sourceFile = claudeCredentialCandidate(this.fileRead(this.path), {
        source: 'operator_file', sourceMtimeMs: this.fileProbe(this.path).mtimeMs,
        requireRefreshToken: true,
      });
      const preexisting = [beforeCandidate, sourceFile]
        .filter((candidate) => candidate && (!incumbent || candidate.expiresAt > incumbent.expiresAt))
        .sort((left, right) => right.expiresAt - left.expiresAt)[0];
      if (preexisting) {
        this.credential = preexisting;
        return preexisting;
      }
      if (!incumbent?.refreshToken) {
        this.revocationLatched = true;
        throw credentialError('authentication_refresh_required', 'Claude refresh token is absent');
      }
      const result = await this.refreshRuntime({ credential: incumbent, directory, reason });
      if (result?.invalidGrant === true) {
        this.revocationLatched = true;
        throw credentialError('authentication_refresh_required', 'Claude refresh token was revoked (invalid_grant)');
      }
      const after = await this._readKeychain();
      const afterCandidate = claudeCredentialCandidate(after.raw, {
        source: 'keychain', requireRefreshToken: true,
      });
      const keychainChanged = before.mtime !== after.mtime || before.digest !== after.digest;
      // Keychain-mtime CAS: an external change invalidates the runtime-file adoption. Re-read the
      // freshest Keychain value and compare it against the incumbent instead.
      const runtimeCandidate = keychainChanged ? null : claudeCredentialCandidate(result?.runtimeCredential, {
        source: 'runtime_projected_file', requireRefreshToken: true,
      });
      const returnedCandidate = keychainChanged ? null : claudeCredentialCandidate(result?.candidate, {
        source: 'refresh_runtime', requireRefreshToken: true,
      });
      const harvest = [afterCandidate, runtimeCandidate, returnedCandidate, incumbent]
        .filter(Boolean).sort((left, right) => right.expiresAt - left.expiresAt)[0];
      if (!harvest || harvest.expiresAt <= incumbent.expiresAt) {
        throw credentialError('authentication_refresh_required', 'Claude refresh produced no strictly fresher schema-valid credential');
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
    this.revocationLatched = false; // explicit `baton credentials refresh claude` clears latch.
    return this.refresh({ reason: 'explicit_command', explicit: true });
  }
}
