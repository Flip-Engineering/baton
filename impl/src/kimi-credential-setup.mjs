import { randomUUID } from 'node:crypto';
import {
  chmodSync, closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync,
  mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';

const FILE_MAX_BYTES = 16 * 1024;
const PROMPT_MAX_BYTES = 12 * 1024;

function setupError(code) {
  return Object.assign(new Error(`Kimi credential setup: ${code}`), { code, credentialSetupError: true });
}

function safePath(value, code) {
  if (typeof value !== 'string' || !isAbsolute(value) || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw setupError(code);
  }
  return value;
}

/** Resolve only Baton's private Kimi-through-Claude credential; native Kimi uses its own login. */
export function kimiCredentialPath({ env = process.env, home = env.HOME ?? homedir() } = {}) {
  const selectedHome = safePath(home, 'home_invalid');
  const configured = env.XDG_CONFIG_HOME;
  const configRoot = configured === undefined || configured === ''
    ? join(selectedHome, '.config')
    : safePath(configured, 'xdg_config_home_invalid');
  return join(configRoot, 'baton', 'credentials', 'kimi.json');
}

function validateToken(value) {
  if (typeof value !== 'string' || value.length === 0 || /\s/u.test(value) || value.includes('\0')) {
    throw setupError('token_invalid');
  }
  const bytes = Buffer.from(`${JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: value } })}\n`);
  if (bytes.length > FILE_MAX_BYTES) throw setupError('token_invalid');
  return bytes;
}

function ensureConfigRoot(path) {
  if (!existsSync(path)) {
    try { mkdirSync(path, { recursive: true, mode: 0o700 }); chmodSync(path, 0o700); }
    catch { throw setupError('config_directory_unavailable'); }
  }
  let stat;
  try { stat = statSync(path); } catch { throw setupError('config_directory_unavailable'); }
  if (!stat.isDirectory()) throw setupError('config_directory_unsafe');
}

function ensurePrivateDirectory(path, ownerUid) {
  try {
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    const before = lstatSync(path);
    if (!before.isDirectory() || before.isSymbolicLink()) throw setupError('credential_directory_unsafe');
    if (ownerUid !== null && Number.isInteger(before.uid) && before.uid !== ownerUid) {
      throw setupError('credential_directory_owner');
    }
    chmodSync(path, 0o700);
    const after = lstatSync(path);
    if (!after.isDirectory() || after.isSymbolicLink() || (after.mode & 0o077) !== 0
      || (ownerUid !== null && Number.isInteger(after.uid) && after.uid !== ownerUid)) {
      throw setupError('credential_directory_unsafe');
    }
  } catch (error) {
    if (error?.credentialSetupError === true) throw error;
    throw setupError('credential_directory_unavailable');
  }
}

function existingTargetIsReplaceable(path, ownerUid) {
  if (!existsSync(path)) return;
  let stat;
  try { stat = lstatSync(path); } catch { throw setupError('credential_file_unavailable'); }
  if (!stat.isFile() || stat.isSymbolicLink()) throw setupError('credential_file_unsafe');
  if (ownerUid !== null && Number.isInteger(stat.uid) && stat.uid !== ownerUid) {
    throw setupError('credential_file_owner');
  }
}

/**
 * Atomically install an already collected token. `advanced.rename` is a deterministic failure seam
 * for tests; callers should use promptAndInstallKimiCredential so the token never crosses argv.
 */
export function installKimiCredential({
  token, env = process.env, home = env.HOME ?? homedir(),
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
  advanced = {},
} = {}) {
  if (!advanced || typeof advanced !== 'object' || Array.isArray(advanced)
    || Object.keys(advanced).some((key) => key !== 'rename')
    || (advanced.rename !== undefined && typeof advanced.rename !== 'function')) {
    throw setupError('advanced_invalid');
  }
  const bytes = validateToken(token);
  const target = kimiCredentialPath({ env, home });
  const configRoot = env.XDG_CONFIG_HOME || join(home, '.config');
  const batonRoot = join(configRoot, 'baton');
  const credentialsRoot = join(batonRoot, 'credentials');
  const temporary = join(credentialsRoot, `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const previousUmask = process.umask(0o077);
  let descriptor = null;
  try {
    ensureConfigRoot(configRoot);
    ensurePrivateDirectory(batonRoot, ownerUid);
    ensurePrivateDirectory(credentialsRoot, ownerUid);
    existingTargetIsReplaceable(target, ownerUid);
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
      | (constants.O_NOFOLLOW ?? 0), 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    const written = fstatSync(descriptor);
    if (!written.isFile() || written.size !== bytes.length || (written.mode & 0o077) !== 0
      || (ownerUid !== null && Number.isInteger(written.uid) && written.uid !== ownerUid)) {
      throw setupError('credential_file_write_failed');
    }
    closeSync(descriptor);
    descriptor = null;
    (advanced.rename ?? renameSync)(temporary, target);
    const installed = lstatSync(target);
    if (!installed.isFile() || installed.isSymbolicLink() || installed.dev !== written.dev
      || installed.ino !== written.ino || installed.size !== written.size || (installed.mode & 0o077) !== 0
      || (ownerUid !== null && Number.isInteger(installed.uid) && installed.uid !== ownerUid)) {
      throw setupError('credential_file_publish_failed');
    }
    const directory = openSync(credentialsRoot, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return Object.freeze({
      schemaVersion: 1,
      installedPath: target,
      credentialPresence: 'present',
    });
  } catch (error) {
    if (descriptor !== null) {
      try { closeSync(descriptor); } catch { /* fixed diagnostic below */ }
    }
    if (existsSync(temporary)) {
      try { unlinkSync(temporary); } catch { /* fixed diagnostic below */ }
    }
    if (error?.credentialSetupError === true) throw error;
    throw Object.assign(setupError('install_failed'), { cause: error });
  } finally {
    process.umask(previousUmask);
  }
}

/** Read one hidden token from a real terminal. Redirected stdin is deliberately unsupported. */
export function readHiddenKimiCredential({
  input = process.stdin, output = process.stderr, signals = process,
} = {}) {
  if (input?.isTTY !== true || output?.isTTY !== true || typeof input.setRawMode !== 'function'
    || typeof input.on !== 'function' || typeof input.removeListener !== 'function'
    || typeof output.write !== 'function') {
    return Promise.reject(setupError('tty_required'));
  }
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const previousRaw = input.isRaw === true;
    const wasPaused = typeof input.isPaused === 'function' ? input.isPaused() : false;
    let settled = false;
    const signalNames = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const onSignal = () => finish(setupError('input_cancelled'));
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      input.removeListener('data', onData);
      input.removeListener('error', onError);
      if (typeof signals?.removeListener === 'function') {
        for (const name of signalNames) signals.removeListener(name, onSignal);
      }
      try { input.setRawMode(previousRaw); } catch { /* fixed diagnostic below */ }
      if (wasPaused && typeof input.pause === 'function') input.pause();
      output.write('\n');
      if (error) reject(error);
      else {
        const token = bytes.toString('utf8');
        try { validateToken(token); resolve(token); }
        catch (cause) { reject(cause); }
      }
      bytes.fill(0);
      bytes = Buffer.alloc(0);
    };
    const onError = () => finish(setupError('input_failed'));
    const onData = (chunk) => {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      for (const byte of incoming) {
        if (byte === 0x03 || byte === 0x04) { finish(setupError('input_cancelled')); return; }
        if (byte === 0x0a || byte === 0x0d) { finish(); return; }
        if (byte === 0x08 || byte === 0x7f) { bytes = bytes.subarray(0, Math.max(0, bytes.length - 1)); continue; }
        if (byte < 0x20 || byte === 0x1b) { finish(setupError('input_invalid')); return; }
        if (bytes.length >= PROMPT_MAX_BYTES) { finish(setupError('token_invalid')); return; }
        bytes = Buffer.concat([bytes, Buffer.from([byte])]);
      }
    };
    try {
      input.setRawMode(true);
      if (typeof signals?.once === 'function') {
        for (const name of signalNames) signals.once(name, onSignal);
      }
      input.on('data', onData);
      input.on('error', onError);
      if (typeof input.resume === 'function') input.resume();
      output.write('Kimi API key: ');
    } catch {
      finish(setupError('tty_unavailable'));
    }
  });
}

export async function promptAndInstallKimiCredential(options = {}) {
  const token = await readHiddenKimiCredential({
    input: options.input, output: options.output, signals: options.signals,
  });
  try {
    return installKimiCredential({
      token, env: options.env, home: options.home, ownerUid: options.ownerUid,
      advanced: options.advanced,
    });
  } finally {
    // Strings cannot be zeroed in JavaScript; keep the value scoped to this call and never return it.
  }
}

export function formatKimiCredentialInstallResult(result) {
  if (!result || result.credentialPresence !== 'present'
    || typeof result.installedPath !== 'string') throw setupError('result_invalid');
  return `installed: ${result.installedPath}\ncredential-presence: ${result.credentialPresence}`;
}

export const KIMI_CREDENTIAL_HELP = `usage:
  baton credentials install kimi
  baton credentials --help

Installs the Kimi API key used only by the Kimi K3-through-Claude route.
The prompt is hidden and requires a terminal; keys are never accepted on argv or redirected stdin.
Native Kimi subscription login and the user's global Claude installation are not changed.`;
