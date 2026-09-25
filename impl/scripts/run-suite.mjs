#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lintDefaultTestDirectory } from './fixture-clock-lint.mjs';
import {
  addedFixtureDirectories, snapshotFixtureDirectories, sweepStaleSuiteRoots,
  writeSuiteOwnerReceipt,
} from './suite-hygiene.mjs';
import {
  computeVerdict, createProgressDeadline, environmentPrerequisites, formatVerdict, verdictDocument,
} from './suite-verdict.mjs';
import {
  deriveSuiteCoverage, renderSuiteCoverageNote, renderSuiteVerdictHeadline,
} from '../src/verification-presentation.mjs';
import { selectFromRepository } from '../src/verification-selection.mjs';

// Issue #77: the load-aware suite calibration. One record per run — measured at start, or
// injected verbatim through the BATON_RG_CALIBRATION observation seam (a nested gate under
// test injects its record because a gate probing the exact load the suite governs must never
// measure real host load) — is printed once on stderr and handed to every test child as
// BATON_SUITE_CALIBRATION, so a flake report cites the load context its row ran under
// (RG-01/RG-02/RG-07). A measurement that cannot be taken refuses the run (RG-10, fail-closed).
const { deriveTestConcurrency, measureCalibration } = await import(
  new URL('./suite-calibration.mjs', import.meta.url).href
);

let suiteCalibration;
try {
  suiteCalibration = process.env.BATON_RG_CALIBRATION !== undefined
    ? JSON.parse(process.env.BATON_RG_CALIBRATION)
    : null;
} catch (error) {
  process.stderr.write(`baton suite calibration refused (${error?.code ?? 'error'}): ${error?.message ?? error}\n`);
  process.exit(1);
}

// D3.1: the file-level concurrency this run declares — max(1, ceil((cores - 1) / factor)); an
// idle run (factor 1) preserves node's os.availableParallelism() - 1 default.
// BATON_SUITE_TEST_CONCURRENCY is the operator's explicit override that replaces the
// derivation (contract-fold.md hole 4). Without an injected record the thin re-executing
// parent derives from the idle default — the factor scales a row against a RECORDED baseline
// and this runner loads none, so the real measurement (below, in the runner proper) cannot
// move the posture the flag declares.
const overrideConcurrency = Number.parseInt(process.env.BATON_SUITE_TEST_CONCURRENCY ?? '', 10);
const suiteConcurrency = Number.isInteger(overrideConcurrency) && overrideConcurrency > 0
  ? overrideConcurrency
  : deriveTestConcurrency(availableParallelism(), suiteCalibration?.factor ?? 1);

// The derived value rides the runner's OWN command line: a test file's direct parent is this
// runner process, so the flag observed there is the concurrency posture this run actually
// carries, and a caller's earlier --test-concurrency is overridden by the derivation (D3.1
// precedence). A run whose argv does not already end in the derived value re-executes itself
// once with the flag appended and forwards the verdict; the re-executed runner is the real one.
const signalStatus = { SIGINT: 130, SIGTERM: 143, SIGKILL: 137 };
if (lastArgValue('--test-concurrency') !== String(suiteConcurrency)) {
  // The thin parent forwards the operator's stop signals to the real runner below, so a
  // SIGTERM/SIGINT reaches the lanes exactly as it did before the hop, and the forwarded exit
  // code is the runner's own verdict (TF2/TF3).
  let real = null;
  process.on('SIGTERM', () => real?.kill('SIGTERM'));
  process.on('SIGINT', () => real?.kill('SIGINT'));
  const forwarded = await new Promise((doneForward) => {
    const child = spawn(process.execPath, [...process.argv.slice(1), '--test-concurrency', String(suiteConcurrency)], {
      detached: false, stdio: 'inherit', env: process.env,
    });
    real = child;
    child.once('error', (error) => doneForward({ error }));
    child.once('close', (code, signal) => doneForward({ code, signal }));
  });
  if (forwarded.error) {
    process.stderr.write(`baton test runner could not re-execute with its derived concurrency: ${forwarded.error.message}\n`);
    process.exit(1);
  }
  process.exit(forwarded.signal ? (signalStatus[forwarded.signal] ?? 1) : (forwarded.code ?? 1));
}

// The runner proper carries the ONE real measurement — the load read and the K-sample
// event-loop-gap probe — for the record it prints and hands to every test child. A measurement
// that cannot be taken refuses the run (RG-10, fail-closed), never a silent factor 1.
if (suiteCalibration === null) {
  try {
    suiteCalibration = await measureCalibration();
  } catch (error) {
    process.stderr.write(`baton suite calibration refused (${error?.code ?? 'error'}): ${error?.message ?? error}\n`);
    process.exit(1);
  }
}
const suiteCalibrationJson = JSON.stringify(suiteCalibration);
process.stderr.write(`baton suite calibration: ${suiteCalibrationJson}\n`);

/** The value of the LAST occurrence of `flag` in this process's own argv, or null. */
function lastArgValue(flag) {
  for (let index = process.argv.length - 2; index >= 2; index -= 1) {
    if (process.argv[index] === flag) return process.argv[index + 1] ?? null;
  }
  return null;
}

// 2026-09-14 audit R-1: the prerequisites a run needs from ITS MACHINE are derived from the ONE
// declaration the deployment doctor and route readiness use — the served route registry and the
// omp route-readiness derivation in impl/src/application-deployment.mjs — never a second list of
// paths here. A clone-hosted or credential-less host therefore reports which prerequisite was
// absent instead of leaving a reader to guess why rows went red.
const {
  DEFAULT_BATON_DEPLOYMENT_ROUTES, KIMI_THROUGH_CLAUDE_ROUTE,
  ompProviderKeyFile, ompRouteReadiness, routeReadinessContract,
} = await import(new URL('../src/application-deployment.mjs', import.meta.url).href);

// Issue #297: the runner's DEFAULT parallelism is the ONE host-capacity derivation every
// resident on this machine shares (impl/src/host-capacity.mjs) — one core for the runner's own
// loop, no more lanes than the memory the host funds at one share per lane. It is a derivation
// from os measurements, not a guess and not a constant; `BATON_SUITE_PARALLELISM` remains the
// OPERATOR OVERRIDE (an explicit, documented decision that replaces the derivation, never a
// second default).
const { defaultSuiteParallelism } = await import(new URL('../src/host-capacity.mjs', import.meta.url).href);

// Issue #333: the runner's host-wide verify lease lives behind this seam (suite-host-lease.mjs)
// so tests can stage the authority — the runner itself always admits through the shared host
// directory, prints the #329 queued row while it waits, and stays bypassed under
// BATON_HOST_CAPACITY_DISABLED=1 with its children unwired.
// Issue #424: a seat's suite subset is a verdict like any other — the seat's participant holder
// names its lease, and only the parent's own token digest (BATON_SUITE_VERIFY_LEASE, published to
// this run's children below) nests a runner; the inherited BATON_TEST_SUITE_ROOT never does.
const {
  acquireSuiteVerifyLease, formatSuiteAdmissionRefusal, formatSuiteDegradedWarning,
  formatSuitePlan, SUITE_VERIFY_LEASE_ENV, suiteLeaseTokenDigest,
} = await import(new URL('./suite-host-lease.mjs', import.meta.url).href);


/** The machine-local prerequisites this run observed, named by the readiness declaration. */
function suiteEnvironment(repoRootPath) {
  const routes = [...DEFAULT_BATON_DEPLOYMENT_ROUTES];
  const conditionalServed = routes.some((route) => (
    route.harness === KIMI_THROUGH_CLAUDE_ROUTE.harness
    && route.provider === KIMI_THROUGH_CLAUDE_ROUTE.provider
    && route.model === KIMI_THROUGH_CLAUDE_ROUTE.model));
  if (!conditionalServed) routes.push(KIMI_THROUGH_CLAUDE_ROUTE);
  return environmentPrerequisites({
    routes,
    routeReadiness: (route) => ompRouteReadiness(repoRootPath, route.model),
    providerKeyFile: ompProviderKeyFile,
    readinessContract: routeReadinessContract,
  });
}

// Issue #42: a time-bomb fixture must be red on the author's machine the moment it is written,
// not hours after merge when wall time crosses its literal.
const clockFindings = lintDefaultTestDirectory();
if (clockFindings.length > 0) {
  for (const finding of clockFindings) {
    process.stderr.write(`fixture-clock-lint: ${finding.file}:${finding.line}: ${finding.reason}\n`);
  }
  process.exit(1);
}
const repositoryRoot = new URL('../../', import.meta.url);

// Unix-domain socket fixtures need their paths to remain below sockaddr_un.sun_path. `/tmp` is
// the short system-temp spelling on Unix (including the `/private/tmp` target on macOS). An
// explicit parent remains available to hermetic runner tests and operators.
const defaultSuiteParent = process.platform === 'win32' ? tmpdir() : '/tmp';
const parent = resolve(process.env.BATON_TEST_TMP_PARENT || defaultSuiteParent);
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

// Issue #260: the runner schedules every test FILE as its own in-process run (the file executed
// directly with the verdict reporter attached), never through `node --test`'s parent/child TAP
// round trip — that parent is what spun for hours on this suite. Each file is bounded by its own
// progress deadline, so a hang costs exactly that file. The parallel lane runs the host-capacity
// derivation's lane count (one core's share per lane, #297); the process-heavy files of
// suite-lanes.json run one
// at a time afterwards. Explicit file arguments run through the same scheduler; any other
// node --test option (--watch, --test-name-pattern, …) keeps the legacy passthrough.
const runnerFlags = new Set(['--test-concurrency']);
// #300: `--changed <paths…>` selects the affected test files through the import graph
// (verification-selection.mjs) instead of naming files by hand. The paths are the capture's
// changedPaths — the flag's INPUT, never passthrough file names — and the selection itself is
// computed from this checkout, which is exactly the tree this run tests.
const changedFlagIndex = process.argv.indexOf('--changed');
const changedPaths = [];
const changedFlagArgs = new Set();
if (changedFlagIndex !== -1) {
  changedFlagArgs.add(changedFlagIndex);
  for (let index = changedFlagIndex + 1; index < process.argv.length && !process.argv[index].startsWith('-'); index += 1) {
    changedFlagArgs.add(index);
    changedPaths.push(process.argv[index]);
  }
}
const passthroughArgs = process.argv.slice(2).filter((arg, index, argv) => (
  !runnerFlags.has(arg)
  && !(index > 0 && argv[index - 1] === '--test-concurrency')
  && !changedFlagArgs.has(index + 2)
));
const explicitFiles = passthroughArgs.filter((arg) => !arg.startsWith('-'));
const legacyPassthrough = passthroughArgs.some((arg) => arg.startsWith('-'));
// #300 refusals: a selection is a partial run, so it obeys the same contracts an explicit file
// list does — and it cannot be combined with one, because two subset selectors in one run would
// make "what was and was not run" ambiguous.
const changedRequested = changedFlagIndex !== -1;
if (changedRequested && changedPaths.length === 0) {
  process.stderr.write('baton test runner: --changed names the changed paths to select through — it refuses to run with no paths (--changed impl/src/a.mjs docs/x.md), because an unnamed selection would silently mean the whole suite\n');
  process.exit(1);
}
if (changedPaths.length > 0 && (explicitFiles.length > 0 || legacyPassthrough)) {
  process.stderr.write('baton test runner: --changed selects the affected files itself — it does not combine with explicit file arguments or node --test passthrough options, because two subset selectors in one run cannot say what was and was not run; use one or the other\n');
  process.exit(1);
}
const implRoot = new URL('../', import.meta.url);
const implRootPath = fileURLToPath(implRoot);
const testRoot = new URL('../test/', import.meta.url);
// Issue #463: the checkout root this runner lives in (`impl/..`), the SECOND root a positional
// file name may be spelled against — the repo-relative form the #300 pre-verdict contract appends.
const checkoutRootPath = fileURLToPath(new URL('../../', import.meta.url));
const reporterUrl = new URL('./suite-verdict-reporter.mjs', import.meta.url).href;
const watchdogUrl = new URL('./suite-orphan-watchdog.mjs', import.meta.url).href;
const lanesPath = new URL('./suite-lanes.json', import.meta.url);
// The runner's own liveness bound: a file that emits no test event for this long is hung and
// is reaped instead of holding the verdict hostage. A wall-clock bound on the runner is a real
// resource constraint (an operator waiting), so it is configurable, never hidden.
const idleMs = Number.parseInt(process.env.BATON_SUITE_IDLE_MS ?? '', 10) > 0
  ? Number.parseInt(process.env.BATON_SUITE_IDLE_MS, 10) : 600_000;
// Issue #297: the default comes from the shared host-capacity derivation; BATON_SUITE_PARALLELISM
// is the documented operator override that replaces it.
const parallelism = Number.parseInt(process.env.BATON_SUITE_PARALLELISM ?? '', 10) > 0
  ? Number.parseInt(process.env.BATON_SUITE_PARALLELISM, 10) : defaultSuiteParallelism();

// Issue #424: the token digest this run publishes to the children it spawns — null until the
// verdict lease is held (and for a run that holds none, so no child inherits a digest this run
// cannot back). A runner spawned BY one of those children reads it as `nested` and stays unwired;
// a seat-run suite has no parent token and admits like any other verdict.
let suiteLeaseDigest = null;

/** Resolve one positional file name to the name this run REPORTS and hands `node --test`.
 *
 * Issue #463: a name is read against the runner's OWN roots, never the caller's working directory.
 * The SUITE ROOT comes first — the root this runner derives its lanes, its verdict rows and its
 * file arguments from, where a test file is `test/<file>` — then the CHECKOUT root, the
 * repo-relative spelling the pre-verdict contract appends (`impl/test/<file>`). A landing ran this
 * runner from the scratch checkout root and handed it bare basenames, so every name resolved one
 * directory too high and `node --test` answered "exited 1 without reporting" for a file that was
 * never there; the caller's cwd is not part of the contract. A name outside both roots keeps its
 * absolute path, so a fixture may still run a file it owns. */
function relativeTestPath(file) {
  const named = `${file}`;
  const fromSuiteRoot = resolve(implRootPath, named);
  const absolute = [fromSuiteRoot, resolve(checkoutRootPath, named)]
    .find((candidate) => !relative(implRootPath, candidate).startsWith('..')) ?? fromSuiteRoot;
  const rel = relative(implRootPath, absolute);
  return rel.startsWith('..') ? absolute : rel;
}

// Issue #508: a file the runner schedules must register its tests with the framework the verdict
// reporter reads. The #300 selection and a directly named file both reach driver scripts and
// helper modules under test/ (issue480-citation-driver.mjs, seam-member-source.mjs), and such a
// file produces no test events when run. The file's own source decides: a quoted `node:test`
// specifier is the registration the reporter needs. A file without one is skipped and named in
// the verdict with that reason; the verdict judges only the files that ran.
const TEST_FRAMEWORK_IMPORT = /['"`]node:test['"`]/u;

function fileImportsTestFramework(file) {
  try {
    return TEST_FRAMEWORK_IMPORT.test(readFileSync(file, 'utf8'));
  } catch {
    return true; // unreadable here is the lane's report to make, not the scheduler's guess
  }
}

function laneFiles(changedSelection = null) {
  const lanes = JSON.parse(readFileSync(lanesPath, 'utf8'));
  const serial = new Set(lanes.serial);
  const all = readdirSync(testRoot).filter((name) => name.endsWith('.test.mjs')).map((name) => `test/${name}`).sort();
  const missing = [...serial].filter((file) => !all.includes(file));
  if (missing.length > 0) {
    process.stderr.write(`baton test runner: suite-lanes.json names files that do not exist: ${missing.join(', ')}\n`);
    process.exit(1);
  }
  const requested = explicitFiles.length > 0
    ? explicitFiles.map(relativeTestPath)
    // A selected file keeps its lane discipline: process-heavy files still run one at a time.
    : changedSelection
      ? changedSelection.files.map((file) => relativeTestPath(join(fileURLToPath(repositoryRoot), file)))
      : all;
  const runnable = [];
  const skipped = [];
  for (const file of requested) {
    const path = resolve(implRootPath, file);
    // A checkout-relative requested file that does not exist is a file this change deleted. The
    // landing gate's table half derives names from the resident's own tree, so a deleted test's
    // own issue-numbered name still reaches the runner after the squash removed the file (#582:
    // a removal lands on its merits). There is nothing to run and the absence is the change
    // itself, so it skips as a named deletion — the verdict judges only the files that ran.
    if (!isAbsolute(file) && !existsSync(path)) {
      skipped.push({ file, reason: 'file absent from the checkout (deleted by this change)' });
      continue;
    }
    // The #508 classification guards the suite's own territory: a file under impl/ that never
    // imports `node:test` is not a runnable test. A file outside the suite root kept its
    // absolute path (relativeTestPath) because it is a fixture the caller owns, and it runs
    // as named.
    if (isAbsolute(file) || fileImportsTestFramework(path)) runnable.push(file);
    else skipped.push({ file, reason: 'no test-framework import' });
  }
  return {
    parallel: runnable.filter((file) => !serial.has(file)),
    serial: runnable.filter((file) => serial.has(file)),
    canonical: all.length,
    skipped,
  };
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

function childEnv(summaryFile, fileTempRoot = suiteRoot) {
  const env = {
    ...process.env,
    BATON_TEST_SUITE_ROOT: suiteRoot,
    BATON_SUITE_WATCHDOG: '1',
    BATON_SUITE_WATCHDOG_PPID: String(process.pid),
    // #77: the run's calibration record — identical to the stderr line — rides to every child.
    BATON_SUITE_CALIBRATION: suiteCalibrationJson,
    // #297: a test file's deployments run UNWIRED from the host-wide capacity throttle. The
    // throttle is a production multi-resident mechanism; a suite host runs nine parallel files
    // and is oversubscribed BY DESIGN, so its real load observation would queue every fixture
    // recruit behind a full host. The host-capacity semantics are pinned by tests that inject
    // the authority directly.
    BATON_HOST_CAPACITY_DISABLED: '1',
    ...(summaryFile ? { BATON_SUITE_SUMMARY_FILE: summaryFile } : {}),
    TMPDIR: fileTempRoot, TMP: fileTempRoot, TEMP: fileTempRoot,
    ...(suiteLeaseDigest !== null ? { [SUITE_VERIFY_LEASE_ENV]: suiteLeaseDigest } : {}),
  };
  // Each file runs as its OWN process with its own reporter. A NODE_TEST_CONTEXT inherited from
  // an outer `node --test` (the runner itself driven from a test)
  // would instead make the file report into that outer runner and leave this run's summary file
  // unwritten — the file then reads as "exited without reporting". The child's context is this
  // run's, never the caller's.
  delete env.NODE_TEST_CONTEXT;
  // The verdict path belongs to this run. A test file that drives a nested runner would otherwise
  // write its own verdict there, and a caller reading the path after this run died (a landing
  // gate) would read the nested run's verdict as this run's.
  delete env.BATON_SUITE_VERDICT_FILE;
  // The parent token is this run's own admission, never an inherited one: a run that holds no
  // lease hands its children no token (they are already unwired by the pin above).
  if (suiteLeaseDigest === null) delete env[SUITE_VERIFY_LEASE_ENV];
  return env;
}

/** Run one test file in its own process; resolve with its summary (or a synthesized failure row). */
async function runFile(file) {
  const id = ++jobCounter;
  const summaryFile = join(suiteRoot, `summary-${id}.json`);
  const fileTempRoot = join(suiteRoot, `file-${id}`);
  mkdirSync(fileTempRoot, { recursive: true, mode: 0o700 });
  const fixturesBefore = snapshotFixtureDirectories(fileTempRoot, suiteRoot);
  const started = Date.now();
  const child = spawn(process.execPath, [
    '--import', watchdogUrl, `--test-reporter=${reporterUrl}`, '--test-reporter-destination=stdout', file,
  ], { detached, stdio: ['ignore', 'pipe', 'pipe'], cwd: implRootPath, env: childEnv(summaryFile, fileTempRoot) });
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
  const leakedFixtures = addedFixtureDirectories(
    fixturesBefore,
    snapshotFixtureDirectories(fileTempRoot, suiteRoot),
  );
  try {
    rmSync(fileTempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  } catch (error) {
    failed.push({
      file, name: '(file temp directory could not be reaped)', failureType: 'fixtureLeak',
      message: error?.message ?? String(error),
    });
  }
  if (leakedFixtures.length > 0) {
    failed.push({
      // The name is the same for every run of the file, so a gate compares it by file; the
      // leaked directory names ride the message.
      file, name: '(file leaked fixture directories)',
      failureType: 'fixtureLeak', message: `leaked fixture directories: ${leakedFixtures.join(', ')}`,
    });
  }
  if (job.hung) {
    failed.push({ file, name: `(file hung: no test event for ${job.hung.idleMs} ms after ${job.hung.lastEvent ?? 'start'})`, failureType: 'fileHung', message: 'hung' });
  } else if (terminal.error) {
    failed.push({ file, name: '(file could not start)', failureType: 'fileCrashed', message: terminal.error.message });
  } else if (summary === null && !(isAbsolute(file) && terminal.code === 0)) {
    // A file outside the suite root is a fixture the caller owns (relativeTestPath keeps its
    // absolute path): it is judged by its exit code, because only a file that registers with
    // node:test produces the report the verdict reads. A clean exit names no failure row; a
    // failing caller fixture still does.
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
  const child = spawn(process.execPath, ['--import', watchdogUrl, '--test', '--test-force-exit', ...passthroughArgs, '--test-concurrency', String(suiteConcurrency)], {
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
  let changedSelection = null;
  if (changedPaths.length > 0) {
    changedSelection = selectFromRepository({
      root: fileURLToPath(repositoryRoot),
      changedPaths,
    });
    process.stderr.write(`baton test runner: --changed selected ${changedSelection.files.length} test file(s) from ${changedPaths.length} changed path(s) — ${changedSelection.reason}\n`);
    for (const provenance of changedSelection.provenance) {
      process.stderr.write(`  ${provenance.path} (${provenance.reason}${provenance.via ? `: ${provenance.via}` : ''})\n`);
    }
  }
  const files = laneFiles(changedSelection);
  for (const row of files.skipped) {
    process.stderr.write(`baton test runner: skipped (${row.reason}): ${row.file}\n`);
  }
  // Issue #424: the plan — what this run expanded and the lane width it resolved (the derivation
  // reads the host's load, so a saturated host resolves one lane) — prints BEFORE admission and
  // before any lane. A reader sees the size of the run even when the host queues the verdict,
  // degrades it to no lease, or refuses it.
  process.stderr.write(`${formatSuitePlan({
    expanded: files.parallel.length + files.serial.length,
    changedPaths: changedPaths.length,
    parallel: files.parallel.length,
    serial: files.serial.length,
    parallelism,
    idleMs,
  })}\n`);
  // Issue #333: the runner holds one host-wide verify lease for the whole verdict — a full
  // suite costs every core but the hub's, so two residents each running a suite would repeat
  // the 2026-09-14 load incident. Admission waits IN ORDER printing the #329 queued row until
  // the verdicts ahead release (#541: the wait is not bounded, never refused for waiting); a host
  // that cannot fund a suite at all answers degraded at once and the run proceeds without a
  // lease, with a warning. The lease releases at the verdict whichever way it ends. A bypassed
  // run acquires nothing.
  // Issue #512: an admission that fails for a real reason is terminal and names itself.
  let suiteLease = null;
  try {
    suiteLease = await acquireSuiteVerifyLease();
    if (suiteLease.degraded) process.stderr.write(`${formatSuiteDegradedWarning(suiteLease.degraded)}\n`);
  } catch (error) {
    process.stderr.write(`baton test runner: ${error?.message ?? error}\n`);
    process.stderr.write(`${formatSuiteAdmissionRefusal(error)}\n`);
    finish(1, null, null, true);
  }
  if (suiteLease !== null) {
    suiteLeaseDigest = suiteLease.token ? suiteLeaseTokenDigest(suiteLease.token) : null;
    try {
      const results = [...await runLane(files.parallel, parallelism), ...await runLane(files.serial, 1)];
      const spawnError = results.find((result) => result.error)?.error ?? null;
      const groupReaped = results.every((result) => result.groupReaped);
      if (requestedSignal || spawnError || !groupReaped) {
        finish(1, requestedSignal, spawnError, groupReaped);
      } else {
        // Every lane summary carries the rows its files reported. A file that stops reporting is
        // named by its own progress deadline (runFile above) as a hung row, which the verdict
        // reads as the hang dimension (#521).
        const summaries = [{ lane: 'suite', passed: results.flatMap((r) => r.passed), failed: results.flatMap((r) => r.failed), skipped: files.skipped }];
        {
          const judged = computeVerdict(summaries, { environment: suiteEnvironment(fileURLToPath(repositoryRoot)) });
          // Issue #399: ONE coverage value from what the runner already knows — `full`
          // when the file set is the canonical selection, `subset` when files were named
          // or --changed narrowed them. The subset headline and the consumer's subset
          // sentence both read the verdict document, never a second file list.
          const coverage = deriveSuiteCoverage({
            subset: explicitFiles.length > 0 || changedPaths.length > 0,
            files: files.parallel.length + files.serial.length,
            canonical: files.canonical,
          });
          const document = { ...verdictDocument(judged), coverage: { ...coverage } };
          process.stderr.write(`${renderSuiteVerdictHeadline(formatVerdict(judged), coverage)}\n`);
          const coverageNote = renderSuiteCoverageNote(document);
          if (coverageNote !== null) process.stderr.write(`${coverageNote}\n`);
          if (process.env.BATON_SUITE_VERDICT_FILE) {
            writeFileSync(process.env.BATON_SUITE_VERDICT_FILE, `${JSON.stringify(document, null, 2)}\n`);
          }
          finish(judged.green ? 0 : 1, null, null, true);
        }
      }
    } finally {
      await suiteLease.release();
    }
  }
}
