#!/usr/bin/env node

import { spawn } from 'node:child_process';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync,
} from 'node:fs';
import { constants as osConstants, tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const MAX_ARGUMENTS = 256;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_PARENT_PATH_BYTES = 4 * 1024;
const TERM_GRACE_MS = 5_000;
const KILL_GRACE_MS = 1_000;
const POLL_MS = 25;

const argv = process.argv.slice(2);
const runner = argv[0];
const runnerArgs = argv.slice(1);
const rawParent = process.env.BATON_EVIDENCE_TMP_PARENT ?? tmpdir();

function configurationError() {
  if (process.platform === 'win32') return 'exact descendant process-group reaping is unsupported on this platform';
  if (typeof runner !== 'string' || runner.length === 0 || runner.includes('\0')) return 'an evidence runner path is required';
  if (argv.some((value) => typeof value !== 'string' || value.includes('\0'))) return 'evidence runner arguments are invalid';
  if (argv.length > MAX_ARGUMENTS) return `evidence runner arguments exceed ${MAX_ARGUMENTS}`;
  if (argv.reduce((bytes, value) => bytes + Buffer.byteLength(value), 0) > MAX_ARGUMENT_BYTES) return `evidence runner arguments exceed ${MAX_ARGUMENT_BYTES} bytes`;
  if (typeof rawParent !== 'string' || rawParent.length === 0 || rawParent.includes('\0') || Buffer.byteLength(rawParent) > MAX_PARENT_PATH_BYTES) return 'evidence temporary parent is invalid';
  return null;
}

const invalid = configurationError();
if (invalid) {
  process.stderr.write(`baton evidence runner refused configuration: ${invalid}\n`);
  process.exitCode = 1;
} else {
  const parent = resolve(rawParent);
  const runnerPath = isAbsolute(runner) ? runner : resolve(runner);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const ownerRoot = mkdtempSync(join(parent, 'baton-evidence-'));
  const created = lstatSync(ownerRoot, { bigint: true });
  const ownerIdentity = Object.freeze({ dev: created.dev, ino: created.ino, uid: created.uid });
  const expectedUid = typeof process.getuid === 'function' ? BigInt(process.getuid()) : created.uid;
  const matchesOwner = (stat) => stat.isDirectory() && !stat.isSymbolicLink()
    && stat.dev === ownerIdentity.dev && stat.ino === ownerIdentity.ino && stat.uid === ownerIdentity.uid;
  let setupComplete = false;
  process.once('exit', () => {
    if (setupComplete) return;
    try { if (matchesOwner(lstatSync(ownerRoot, { bigint: true }))) rmSync(ownerRoot, { recursive: true, force: true }); } catch { /* setup is already red */ }
  });

  chmodSync(ownerRoot, 0o700);
  const original = lstatSync(ownerRoot, { bigint: true });
  if (!matchesOwner(original) || original.uid !== expectedUid || (original.mode & 0o077n) !== 0n) {
    throw new Error('baton evidence runner could not establish a private owner root');
  }
  setupComplete = true;

  let cleaned = false;
  let cleanupError = null;
  let child = null;
  let requestedSignal = null;
  let forceTimer = null;
  let signalError = null;

  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    try {
      const current = lstatSync(ownerRoot, { bigint: true });
      if (!matchesOwner(current)) throw new Error('evidence owner root identity changed before cleanup');

      // Rename first, then re-check the captured inode. This narrows the check/delete race and
      // ensures rmSync never follows a path that a child replaced after the first lstat.
      const reapingRoot = `${ownerRoot}.reaping-${process.pid}`;
      if (existsSync(reapingRoot)) throw new Error('evidence reaping path already exists');
      renameSync(ownerRoot, reapingRoot);
      const moved = lstatSync(reapingRoot, { bigint: true });
      if (!matchesOwner(moved)) {
        if (!existsSync(ownerRoot)) renameSync(reapingRoot, ownerRoot);
        throw new Error('evidence owner root identity changed during cleanup');
      }
      rmSync(reapingRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
      if (existsSync(reapingRoot) || existsSync(ownerRoot)) throw new Error('evidence owner root cleanup was incomplete');
    } catch (error) {
      cleanupError = error;
    }
  }

  process.once('exit', cleanup);

  const detached = process.platform !== 'win32';

  function signalGroup(signal) {
    if (!child || child.pid === undefined) return;
    try {
      if (detached) process.kill(-child.pid, signal);
      else if (child.exitCode === null && child.signalCode === null) child.kill(signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }

  function groupAlive() {
    if (!child || child.pid === undefined) return false;
    if (!detached) return child.exitCode === null && child.signalCode === null;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      if (error?.code === 'EPERM') return true;
      throw error;
    }
  }

  const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

  async function reapProcessGroup() {
    if (!groupAlive()) return true;
    signalGroup('SIGTERM');
    const termDeadline = Date.now() + TERM_GRACE_MS;
    while (groupAlive() && Date.now() < termDeadline) await sleep(POLL_MS);
    if (!groupAlive()) return true;
    signalGroup('SIGKILL');
    const killDeadline = Date.now() + KILL_GRACE_MS;
    while (groupAlive() && Date.now() < killDeadline) await sleep(POLL_MS);
    return !groupAlive();
  }

  function requestStop(signal) {
    if (requestedSignal) return;
    requestedSignal = signal;
    try { signalGroup(signal); } catch (error) { signalError = error; }
    forceTimer = setTimeout(() => {
      try { signalGroup('SIGKILL'); } catch (error) { signalError ??= error; }
    }, TERM_GRACE_MS);
    forceTimer.unref();
  }

  process.on('SIGINT', () => requestStop('SIGINT'));
  process.on('SIGTERM', () => requestStop('SIGTERM'));

  child = spawn(process.execPath, [runnerPath, ...runnerArgs], {
    detached,
    stdio: 'inherit',
    env: {
      ...process.env,
      BATON_EVIDENCE_OWNER_ROOT: ownerRoot,
      BATON_EVIDENCE_TMP_PARENT: ownerRoot,
      BATON_TEST_TMP_PARENT: ownerRoot,
      TMPDIR: ownerRoot,
      TMP: ownerRoot,
      TEMP: ownerRoot,
    },
  });

  const terminal = await new Promise((resolveTerminal) => {
    child.once('error', (error) => resolveTerminal({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolveTerminal({ code, signal, error: null }));
  });

  let groupReaped = false;
  let reapError = null;
  try { groupReaped = terminal.error ? true : await reapProcessGroup(); }
  catch (error) { reapError = error; }
  if (forceTimer) clearTimeout(forceTimer);
  cleanup();

  if (terminal.error) {
    process.stderr.write(`baton evidence runner could not start: ${terminal.error.message}\n`);
    process.exitCode = 1;
  } else if (signalError || reapError) {
    process.stderr.write(`baton evidence runner could not control its process group: ${(signalError ?? reapError).message}\n`);
    process.exitCode = 1;
  } else if (!groupReaped) {
    process.stderr.write('baton evidence runner could not reap its process group\n');
    process.exitCode = 1;
  } else if (cleanupError) {
    process.stderr.write(`baton evidence runner could not reap its owner root: ${cleanupError.message}\n`);
    process.exitCode = 1;
  } else {
    const terminalSignal = requestedSignal ?? terminal.signal;
    const signalNumber = terminalSignal ? osConstants.signals?.[terminalSignal] : null;
    process.exitCode = terminalSignal ? (Number.isSafeInteger(signalNumber) ? 128 + signalNumber : 1) : (terminal.code ?? 1);
  }
}
