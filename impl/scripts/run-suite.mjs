#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const parent = resolve(process.env.BATON_TEST_TMP_PARENT || tmpdir());
mkdirSync(parent, { recursive: true, mode: 0o700 });
const suiteRoot = mkdtempSync(join(parent, 'baton-suite-'));
chmodSync(suiteRoot, 0o700);

let cleaned = false;
let cleanupError = null;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    rmSync(suiteRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  } catch (error) {
    cleanupError = error;
  }
}

process.once('exit', cleanup);

const detached = process.platform !== 'win32';
const child = spawn(process.execPath, ['--test', ...process.argv.slice(2)], {
  detached,
  stdio: 'inherit',
  env: {
    ...process.env,
    BATON_TEST_SUITE_ROOT: suiteRoot,
    TMPDIR: suiteRoot,
    TMP: suiteRoot,
    TEMP: suiteRoot,
  },
});

let requestedSignal = null;
let forceTimer = null;
let finished = false;

function signalChild(signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  signalGroup(signal);
}

function signalGroup(signal) {
  try {
    if (detached) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function groupAlive() {
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
  const termDeadline = Date.now() + 5000;
  while (groupAlive() && Date.now() < termDeadline) await sleep(25);
  if (!groupAlive()) return true;
  signalGroup('SIGKILL');
  const killDeadline = Date.now() + 1000;
  while (groupAlive() && Date.now() < killDeadline) await sleep(25);
  return !groupAlive();
}

function requestStop(signal) {
  if (requestedSignal) return;
  requestedSignal = signal;
  signalChild(signal);
  forceTimer = setTimeout(() => signalGroup('SIGKILL'), 5000);
  forceTimer.unref();
}

process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

const signalStatus = { SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
function finish(code, signal, spawnError = null, groupReaped = true) {
  if (finished) return;
  finished = true;
  if (forceTimer) clearTimeout(forceTimer);
  cleanup();

  if (spawnError) {
    process.stderr.write(`baton test runner could not start: ${spawnError.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (cleanupError) {
    process.stderr.write(`baton test runner could not reap its fixture root: ${cleanupError.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (!groupReaped) {
    process.stderr.write('baton test runner could not reap its test process group\n');
    process.exitCode = 1;
    return;
  }
  const terminalSignal = requestedSignal || signal;
  process.exitCode = terminalSignal ? (signalStatus[terminalSignal] ?? 1) : (code ?? 1);
}

const terminal = await new Promise((resolveTerminal) => {
  child.once('error', (error) => resolveTerminal({ code: null, signal: null, error }));
  child.once('close', (code, signal) => resolveTerminal({ code, signal, error: null }));
});
const groupReaped = terminal.error ? true : await reapProcessGroup();
finish(terminal.code, terminal.signal, terminal.error, groupReaped);
