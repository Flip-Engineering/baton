#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lintDefaultTestDirectory } from './fixture-clock-lint.mjs';
import { collectSurfaceInventory } from './surface-audit.mjs';
import {
  checkEnumStrings,
  checkLedgerMonotone,
  classifySurfaces,
} from './surface-conformance.mjs';
import { sweepStaleSuiteRoots, writeSuiteOwnerReceipt } from './suite-hygiene.mjs';
import { runSurfaceGate } from './surface-gate.mjs';
import {
  computeVerdict, createProgressDeadline, formatVerdict, isHang, loadExpectedRed, rowKey, writeExpectedRed,
} from './suite-verdict.mjs';

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

// Issue #262: the surface gate (grammar lint, artifact/doc/parity staleness, MCP dispatch
// resolvability) runs before any test so a surface change is refused when it is made.
const gateFindings = await runSurfaceGate();
for (const finding of gateFindings) process.stderr.write(`surface-gate: ${finding}\n`);
if (gateFindings.length > 0) {
  process.stderr.write('surface-gate: refused — regenerate artifacts with `node scripts/surface-gate.mjs --write` and fix the remaining findings\n');
  process.exit(1);
}

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
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const signalStatus = { SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };

// Issue #260: the runner schedules every test FILE as its own in-process run (the file executed
// directly with the verdict reporter attached), never through `node --test`'s parent/child TAP
// round trip — that parent is what spun for hours on this suite. Each file is bounded by its own
// progress deadline, so a hang costs exactly that file. The parallel lane runs
// availableParallelism()-1 files at once; the process-heavy files of suite-lanes.json run one
// at a time afterwards. Explicit file arguments run through the same scheduler; any other
// node --test option (--watch, --test-name-pattern, …) keeps the legacy passthrough.
const passthroughArgs = process.argv.slice(2).filter((arg) => arg !== '--write-expected-red');
const writeExpectedRedRequested = process.argv.includes('--write-expected-red');
const explicitFiles = passthroughArgs.filter((arg) => !arg.startsWith('-'));
const legacyPassthrough = passthroughArgs.some((arg) => arg.startsWith('-'));
const implRoot = new URL('../', import.meta.url);
const implRootPath = fileURLToPath(implRoot);
const testRoot = new URL('../test/', import.meta.url);
const reporterUrl = new URL('./suite-verdict-reporter.mjs', import.meta.url).href;
const watchdogUrl = new URL('./suite-orphan-watchdog.mjs', import.meta.url).href;
const manifestPath = new URL('./expected-red-tests.json', import.meta.url);
const lanesPath = new URL('./suite-lanes.json', import.meta.url);
// The runner's own liveness bound: a file that emits no test event for this long is hung and
// is reaped instead of holding the verdict hostage. A wall-clock bound on the runner is a real
// resource constraint (an operator waiting), so it is configurable, never hidden.
const idleMs = Number.parseInt(process.env.BATON_SUITE_IDLE_MS ?? '', 10) > 0
  ? Number.parseInt(process.env.BATON_SUITE_IDLE_MS, 10) : 600_000;
const parallelism = Number.parseInt(process.env.BATON_SUITE_PARALLELISM ?? '', 10) > 0
  ? Number.parseInt(process.env.BATON_SUITE_PARALLELISM, 10) : Math.max(1, availableParallelism() - 1);

function relativeTestPath(file) {
  const absolute = resolve(process.cwd(), file);
  const rel = relative(implRootPath, absolute);
  return rel.startsWith('..') ? absolute : rel;
}

function laneFiles() {
  const lanes = JSON.parse(readFileSync(lanesPath, 'utf8'));
  const serial = new Set(lanes.serial);
  const all = readdirSync(testRoot).filter((name) => name.endsWith('.test.mjs')).map((name) => `test/${name}`).sort();
  const missing = [...serial].filter((file) => !all.includes(file));
  if (missing.length > 0) {
    process.stderr.write(`baton test runner: suite-lanes.json names files that do not exist: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  if (explicitFiles.length > 0) {
    const requested = explicitFiles.map(relativeTestPath);
    return { parallel: requested.filter((file) => !serial.has(file)), serial: requested.filter((file) => serial.has(file)) };
  }
  return { parallel: all.filter((file) => !serial.has(file)), serial: all.filter((file) => serial.has(file)) };
}

let requestedSignal = null;
let finished = false;
let stopCaptureFailed = false;
const running = new Set();
let jobCounter = 0;

function processTable() {
  if (!detached) return new Map();
  try {
    const output = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,lstart='], {
      encoding: 'utf8', timeout: 1000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
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

function captureProcessGroup(job, table = processTable()) {
  if (!detached) return true;
  if (table === null) return false;
  for (const [pid, identity] of table) {
    if (identity.group === job.child.pid && !job.trackedGroup.has(pid)) job.trackedGroup.set(pid, identity.started);
  }
  return true;
}

function trackedGroupAlive(job, table) {
  for (const [pid, started] of job.trackedGroup) {
    const row = table.get(pid);
    if (row?.started === started) return true;
    if (row) continue;
    try { process.kill(pid, 0); return true; }
    catch (error) { if (error?.code !== 'ESRCH') return true; }
  }
  return false;
}

async function waitForTrackedGroup(job, deadline) {
  if (!detached) return true;
  while (Date.now() < deadline) {
    const table = processTable();
    if (table !== null) {
      captureProcessGroup(job, table);
      if (!trackedGroupAlive(job, table)) return true;
    }
    await sleep(10);
  }
  const table = processTable();
  return table !== null && captureProcessGroup(job, table) && !trackedGroupAlive(job, table);
}

function signalGroup(job, signal) {
  try {
    if (detached) process.kill(-job.child.pid, signal);
    else job.child.kill(signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    // EPERM is the kernel saying the group (or a member) exists and refuses this signal — a member
    // that changed uid, or one mid-exit. The liveness probe below already reads EPERM as alive, so
    // the honest outcome is a recorded refusal on the job and a HUNG row at the deadline, never a
    // runner crash that loses the whole verdict (2026-09-14 audit, R-4: a worker's suite died here).
    if (error?.code === 'EPERM') {
      (job.signalRefused ??= []).push({ signal, code: error.code, at: new Date().toISOString() });
      return false;
    }
    throw error;
  }
}

function groupAlive(job) {
  if (!detached) return job.child.exitCode === null && job.child.signalCode === null;
  try { process.kill(-job.child.pid, 0); return true; }
  catch (error) {
    if (error?.code === 'ESRCH') return false;
    if (error?.code === 'EPERM') return true;
    throw error;
  }
}

async function reapProcessGroup(job) {
  const captured = captureProcessGroup(job);
  if (groupAlive(job)) {
    signalGroup(job, 'SIGTERM');
    const termDeadline = Date.now() + 5000;
    while (groupAlive(job) && Date.now() < termDeadline) { captureProcessGroup(job); await sleep(25); }
  }
  if (groupAlive(job)) {
    signalGroup(job, 'SIGKILL');
    const killDeadline = Date.now() + 1000;
    while (groupAlive(job) && Date.now() < killDeadline) { captureProcessGroup(job); await sleep(25); }
  }
  const groupReaped = !groupAlive(job);
  const identitiesReaped = await waitForTrackedGroup(job, Date.now() + 1000);
  return captured && !stopCaptureFailed && groupReaped && identitiesReaped;
}

function requestStop(signal) {
  if (requestedSignal) return;
  requestedSignal = signal;
  for (const job of running) {
    if (!captureProcessGroup(job)) stopCaptureFailed = true;
    if (job.child.exitCode === null && job.child.signalCode === null) signalGroup(job, signal);
    const force = setTimeout(() => signalGroup(job, 'SIGKILL'), 5000);
    force.unref();
  }
}
process.on('SIGINT', () => requestStop('SIGINT'));
process.on('SIGTERM', () => requestStop('SIGTERM'));

function childEnv(summaryFile) {
  return {
    ...process.env,
    BATON_TEST_SUITE_ROOT: suiteRoot,
    BATON_SUITE_WATCHDOG: '1',
    BATON_SUITE_WATCHDOG_PPID: String(process.pid),
    ...(summaryFile ? { BATON_SUITE_SUMMARY_FILE: summaryFile } : {}),
    TMPDIR: suiteRoot, TMP: suiteRoot, TEMP: suiteRoot,
  };
}

/** Run one test file in its own process; resolve with its summary (or a synthesized failure row). */
async function runFile(file) {
  const id = ++jobCounter;
  const summaryFile = join(suiteRoot, `summary-${id}.json`);
  const started = Date.now();
  const child = spawn(process.execPath, [
    '--import', watchdogUrl, `--test-reporter=${reporterUrl}`, '--test-reporter-destination=stdout', file,
  ], { detached, stdio: ['ignore', 'pipe', 'pipe'], cwd: implRootPath, env: childEnv(summaryFile) });
  const job = { file, child, trackedGroup: new Map(), hung: null, lastEvent: null, output: [], stderr: [] };
  running.add(job);
  const deadline = createProgressDeadline({ timeoutMs: idleMs });
  child.stdout.on('data', (chunk) => {
    job.output.push(chunk);
    deadline.observe();
    const match = /(?:^|\n)(?:not )?ok \d+ - ([^\n]*)/u.exec(String(chunk));
    if (match) job.lastEvent = match[1];
  });
  child.stderr.on('data', (chunk) => { job.stderr.push(chunk); deadline.observe(); });
  const liveness = setInterval(() => {
    if (job.hung || requestedSignal || !deadline.expired()) return;
    job.hung = { lastEvent: job.lastEvent, idleMs: deadline.idleMs() };
    reapProcessGroup(job).catch(() => {});
  }, Math.min(idleMs, 5_000));
  liveness.unref();
  const terminal = await new Promise((resolveTerminal) => {
    child.once('error', (error) => resolveTerminal({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolveTerminal({ code, signal, error: null }));
  });
  clearInterval(liveness);
  const groupReaped = terminal.error ? true : await reapProcessGroup(job);
  running.delete(job);
  const elapsed = Date.now() - started;
  const output = Buffer.concat(job.output).toString('utf8');
  const stderr = Buffer.concat(job.stderr).toString('utf8');
  const refused = job.signalRefused ? `, signal refused ${job.signalRefused.map((row) => `${row.signal}:${row.code}`).join('+')}` : '';
  process.stdout.write(`# file ${file} (${elapsed} ms${job.hung ? ', HUNG' : terminal.code === 0 ? '' : `, exit ${terminal.code ?? terminal.signal}`}${refused})\n${output}`);
  if (stderr.length > 0) process.stderr.write(stderr);
  let summary = null;
  try { summary = JSON.parse(readFileSync(summaryFile, 'utf8')); } catch { summary = null; }
  const failed = summary?.failed ?? [];
  const passed = summary?.passed ?? [];
  if (job.hung) {
    failed.push({ file, name: `(file hung: no test event for ${job.hung.idleMs} ms after ${job.hung.lastEvent ?? 'start'})`, failureType: 'fileHung', message: 'hung' });
  } else if (terminal.error) {
    failed.push({ file, name: '(file could not start)', failureType: 'fileCrashed', message: terminal.error.message });
  } else if (summary === null) {
    failed.push({ file, name: `(file exited ${terminal.code ?? terminal.signal} without reporting)`, failureType: 'fileCrashed', message: stderr.split('\n').filter(Boolean).slice(-3).join(' | ') });
  }
  return { file, passed, failed, groupReaped, error: terminal.error, signal: terminal.signal };
}

async function runLane(files, concurrency) {
  const results = [];
  let index = 0;
  async function worker() {
    for (;;) {
      if (requestedSignal || index >= files.length) return;
      const file = files[index++];
      results.push(await runFile(file));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
  return results;
}

function finish(code, signal, spawnError = null, groupReaped = true) {
  if (finished) return;
  finished = true;
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

if (legacyPassthrough) {
  // Legacy passthrough (node --test options such as --watch or --test-name-pattern): node's own
  // orchestration, its own output, no verdict.
  const child = spawn(process.execPath, ['--import', watchdogUrl, '--test', '--test-force-exit', ...passthroughArgs], {
    detached, stdio: 'inherit', env: childEnv(null),
  });
  const job = { file: '(legacy)', child, trackedGroup: new Map() };
  running.add(job);
  const terminal = await new Promise((resolveTerminal) => {
    child.once('error', (error) => resolveTerminal({ code: null, signal: null, error }));
    child.once('close', (code, signal) => resolveTerminal({ code, signal, error: null }));
  });
  const groupReaped = terminal.error ? true : await reapProcessGroup(job);
  running.delete(job);
  finish(terminal.code, terminal.signal, terminal.error, groupReaped);
} else {
  const files = laneFiles();
  process.stderr.write(`baton test runner: ${files.parallel.length} files in the parallel lane (x${parallelism}), ${files.serial.length} in the serial lane; progress deadline ${idleMs} ms per file\n`);
  const results = [...await runLane(files.parallel, parallelism), ...await runLane(files.serial, 1)];
  const spawnError = results.find((result) => result.error)?.error ?? null;
  const groupReaped = results.every((result) => result.groupReaped);
  if (requestedSignal || spawnError || !groupReaped) {
    finish(1, requestedSignal, spawnError, groupReaped);
  } else {
    const summaries = [{ lane: 'suite', passed: results.flatMap((r) => r.passed), failed: results.flatMap((r) => r.failed), stalled: null }];
    if (writeExpectedRedRequested) {
      const rows = summaries[0].failed.filter((row) => !isHang(row) && row.failureType !== 'fileCrashed').map((row) => rowKey(row.file, row.name));
      const written = writeExpectedRed(manifestPath, rows);
      process.stderr.write(`baton test runner: wrote ${written.length} expected-red rows to scripts/expected-red-tests.json\n`);
    }
    const manifest = loadExpectedRed(manifestPath);
    const verdict = computeVerdict(summaries, manifest);
    // An explicit partial run cannot judge rows it never ran.
    const judged = explicitFiles.length > 0 ? { ...verdict, unseen: [], green: verdict.unexpected.length === 0 && verdict.stale.length === 0 && verdict.hung.length === 0 } : verdict;
    process.stderr.write(`${formatVerdict(judged)}\n`);
    finish(judged.green ? 0 : 1, null, null, true);
  }
}
