#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { lintDefaultTestDirectory } from './fixture-clock-lint.mjs';
import { collectSurfaceInventory } from './surface-audit.mjs';
import {
  checkEnumStrings,
  checkLedgerMonotone,
  classifySurfaces,
} from './surface-conformance.mjs';
import { sweepStaleSuiteRoots, writeSuiteOwnerReceipt } from './suite-hygiene.mjs';

// Issue #42: a time-bomb fixture must be red on the author's machine the moment it is written,
// not hours after merge when wall time crosses its literal.
const clockFindings = lintDefaultTestDirectory();
if (clockFindings.length > 0) {
  for (const finding of clockFindings) {
    process.stderr.write(`fixture-clock-lint: ${finding.file}:${finding.line}: ${finding.reason}\n`);
  }
  process.exit(1);
}

const ledgerPath = new URL('./surface-divergence-ledger.json', import.meta.url);
let currentLedger;
try {
  currentLedger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
} catch (error) {
  process.stderr.write(`surface-conformance: could not read divergence ledger: ${error.message}\n`);
  process.exit(1);
}
const inventory = collectSurfaceInventory();
const surfaceFindings = classifySurfaces(inventory, currentLedger).novel;
const enumFindings = checkEnumStrings(inventory.phaseLiterals, currentLedger).novel;
for (const finding of [...surfaceFindings, ...enumFindings]) {
  process.stderr.write(
    `surface-conformance: novel divergence: ${finding.surface}:${finding.name}:${finding.dimension}\n`,
  );
}
if (surfaceFindings.length > 0 || enumFindings.length > 0) process.exit(1);

const repositoryRoot = new URL('../../', import.meta.url);
let previousLedger = null;
try {
  previousLedger = JSON.parse(execFileSync(
    'git',
    ['show', 'HEAD:impl/scripts/surface-divergence-ledger.json'],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 2_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ));
} catch (error) {
  const missingBaseline = error?.status === 128
    && String(error?.stderr).includes('exists on disk, but not in');
  if (!missingBaseline) {
    process.stderr.write(`surface-conformance: could not read the HEAD ledger: ${error.message}\n`);
    process.exit(1);
  }
}
if (previousLedger) {
  try {
    checkLedgerMonotone(previousLedger, currentLedger);
  } catch (error) {
    process.stderr.write(`surface-conformance: ${error.message}\n`);
    process.exit(1);
  }
}

const parent = resolve(process.env.BATON_TEST_TMP_PARENT || tmpdir());
mkdirSync(parent, { recursive: true, mode: 0o700 });
// Issue #40: reclaim sibling roots whose recorded owner process is provably dead — the residue
// of a SIGKILL-class death of an earlier run-suite, which runs no cleanup handler.
for (const swept of sweepStaleSuiteRoots(parent)) {
  process.stderr.write(`baton test runner reclaimed a dead suite root: ${swept}\n`);
}
const suiteRoot = mkdtempSync(join(parent, 'baton-suite-'));
chmodSync(suiteRoot, 0o700);
writeSuiteOwnerReceipt(suiteRoot);

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
// Issue #40: the detached group also watches its own parent — if this process dies without
// handlers (SIGKILL-class), the test runner terminates itself instead of working headless.
const watchdogUrl = new URL('./suite-orphan-watchdog.mjs', import.meta.url).href;
const child = spawn(process.execPath, ['--import', watchdogUrl, '--test', ...process.argv.slice(2)], {
  detached,
  stdio: 'inherit',
  env: {
    ...process.env,
    BATON_TEST_SUITE_ROOT: suiteRoot,
    BATON_SUITE_WATCHDOG: '1',
    BATON_SUITE_WATCHDOG_PPID: String(process.pid),
    TMPDIR: suiteRoot,
    TMP: suiteRoot,
    TEMP: suiteRoot,
  },
});

let requestedSignal = null;
let forceTimer = null;
let finished = false;
let stopCaptureFailed = false;
const trackedGroup = new Map();

function processTable() {
  if (!detached) return new Map();
  try {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], {
      encoding: 'utf8',
      timeout: 1000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const table = new Map();
    for (const line of output.split('\n')) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
      if (!match) continue;
      table.set(Number(match[1]), { group: Number(match[2]), started: match[3] });
    }
    return table;
  } catch {
    return null;
  }
}

function captureProcessGroup(table = processTable()) {
  if (!detached) return true;
  if (table === null) return false;
  for (const [pid, identity] of table) {
    if (identity.group === child.pid && !trackedGroup.has(pid)) {
      trackedGroup.set(pid, identity.started);
    }
  }
  return true;
}

function trackedGroupAlive(table) {
  for (const [pid, started] of trackedGroup) {
    const current = table.get(pid);
    if (current?.started === started) return true;
    if (current) continue;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      if (error?.code !== 'ESRCH') return true;
    }
  }
  return false;
}

async function waitForTrackedGroup(deadline) {
  if (!detached) return true;
  while (Date.now() < deadline) {
    const table = processTable();
    if (table !== null) {
      captureProcessGroup(table);
      if (!trackedGroupAlive(table)) return true;
    }
    await sleep(10);
  }
  const table = processTable();
  return table !== null && captureProcessGroup(table) && !trackedGroupAlive(table);
}

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
  const captured = captureProcessGroup();
  if (groupAlive()) {
    signalGroup('SIGTERM');
    const termDeadline = Date.now() + 5000;
    while (groupAlive() && Date.now() < termDeadline) {
      captureProcessGroup();
      await sleep(25);
    }
  }
  if (groupAlive()) {
    signalGroup('SIGKILL');
    const killDeadline = Date.now() + 1000;
    while (groupAlive() && Date.now() < killDeadline) {
      captureProcessGroup();
      await sleep(25);
    }
  }
  const groupReaped = !groupAlive();
  const identitiesReaped = await waitForTrackedGroup(Date.now() + 1000);
  return captured && !stopCaptureFailed && groupReaped && identitiesReaped;
}

function requestStop(signal) {
  if (requestedSignal) return;
  requestedSignal = signal;
  if (!captureProcessGroup()) stopCaptureFailed = true;
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
