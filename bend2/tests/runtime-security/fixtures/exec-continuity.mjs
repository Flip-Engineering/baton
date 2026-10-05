// Fixture: bootstrap -> process.execve continuity and environment boundary.
//
// Continuity is the parent-observed spawned child pid against the target's own
// reported pid; this is this fixture's child, not a keeper birth identity, and
// that limit is recorded. Raw stdout and stderr are written in a `finally`
// block, so a refusal or failure path still leaves them on disk. Requested
// signals and observed close/error outcomes are recorded separately.
import { spawn } from 'node:child_process';
import { EnvironmentRefusal, FIXTURE_ENTRIES, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment, writeReport, writeStream } from '../lib/assert.mjs';
import { cleanupOwned, own } from '../lib/children.mjs';
import { requirePin } from '../lib/pins.mjs';

let environment;
try {
  environment = openEnvironmentOrExit(FIXTURE_ENTRIES['exec-continuity']);
  if (environment.pin !== null) requirePin(environment, 'exec-continuity');
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('exec-continuity', environment);
const declared = {
  PATH: '/usr/bin:/bin',
  HOME: '/tmp/baton-fixture-home',
  LC_ALL: 'C',
  BATON_FIXTURE_DECLARED: 'target-value',
};
const document = JSON.stringify({
  version: 1,
  node: environment.floorNode,
  argv: [environment.floorNode, environment.helperPath('target.mjs'), 'arg-one'],
  env: declared,
});
const argv = [
  '/usr/bin/env', '-i',
  'PATH=/usr/bin:/bin', 'HOME=/tmp/baton-fixture-home', 'TMPDIR=/tmp', 'LC_ALL=C',
  environment.floorNode, environment.runtimePath('bootstrap.mjs'),
];

const child = spawn(argv[0], argv.slice(1), {
  cwd: environment.evidenceDir,
  env: { ...process.env, BATON_FIXTURE_MARKER: 'MARKER_MUST_NOT_APPEAR' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const custody = own(child);
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stderr += chunk));

let outcome = null;
let targetResult = null;
let bodyFailure = null;
let rawStdout = null;
let rawStderr = null;
let custodyReport = null;
const requestedSignals = [];
let timeoutFired = false;

try {
  child.stdin.end(document);
  const timeout = setTimeout(() => {
    timeoutFired = true;
    requestedSignals.push('SIGKILL(timeout)');
    custody.kill('SIGKILL');
  }, 30000);
  outcome = await new Promise((resolve) => {
    const timer = () => clearTimeout(timeout);
    child.on('close', (code, signal) => {
      timer();
      resolve({ closed: true, code, signal });
    });
    child.on('error', (error) => {
      timer();
      resolve({ closed: false, error: error.code ?? String(error) });
    });
  });
  if (outcome.closed) custody.markReaped(outcome);
  for (const line of stdout.trim().split('\n').filter(Boolean)) {
    try {
      targetResult = JSON.parse(line);
    } catch {
      targetResult = null;
    }
  }
} catch (error) {
  bodyFailure = String(error?.stack ?? error);
} finally {
  // Raw streams and awaited custody run on every path.
  rawStdout = writeStream(environment, 'exec-continuity.child.stdout.txt', stdout);
  rawStderr = writeStream(environment, 'exec-continuity.child.stderr.txt', stderr);
  custodyReport = await cleanupOwned({ timeoutMs: 5000 });
}

const producerRecords = stderr.split('\n')
  .filter((line) => line.trim().startsWith('{'))
  .map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  })
  .filter((value) => value !== null);

const declaredKeys = Object.keys(declared).sort();
const observedKeys = targetResult?.envKeys ?? [];
const extraKeys = observedKeys.filter((key) => !declaredKeys.includes(key));
const unexpectedExtra = extraKeys.filter((key) => !environment.platformInjectedEnvKeys.includes(key));
const missingKeys = declaredKeys.filter((key) => !observedKeys.includes(key));
const valueMismatches = declaredKeys
  .filter((key) => key in (targetResult?.env ?? {}))
  .filter((key) => targetResult.env[key] !== declared[key]);

reporter.check('fixture:no-uncaught-failure', bodyFailure === null, bodyFailure);
reporter.check('child:target-started', targetResult !== null, null);
reporter.check('child:close-observed', outcome?.closed === true, outcome);
reporter.check('child:exit-zero', outcome?.closed === true && outcome.code === 0 && outcome.signal === null, outcome);
reporter.check('child:no-timeout', timeoutFired === false, { requestedSignals });
reporter.check('continuity:spawned-pid-equals-target-pid',
  targetResult !== null && targetResult.target_pid === child.pid,
  { spawnedChildPid: child.pid, targetPid: targetResult?.target_pid ?? null });
reporter.check('env:marker-absent', !(stdout + stderr).includes('MARKER_MUST_NOT_APPEAR'), null);
reporter.check('env:no-unexpected-extra-key', unexpectedExtra.length === 0,
  { extraKeys, allowedExtra: environment.platformInjectedEnvKeys, platform: process.platform });
reporter.check('env:no-missing-declared-key', missingKeys.length === 0, missingKeys);
reporter.check('env:declared-values-exact', valueMismatches.length === 0, valueMismatches);
reporter.check('stdin:at-eof', targetResult?.stdin_bytes === 0, targetResult?.stdin_bytes ?? null);
reporter.check('custody:owned-child-resolved', custodyReport.unresolved.length === 0, custodyReport);

reporter.note('continuity limit: compared pid is this fixture\'s spawned child, not a keeper birth identity');
reporter.note(custodyReport.signalObservation);
finish(environment, 'exec-continuity.result.json', reporter.finalize({
  declaredTargetEnv: declared,
  spawnArgv: argv,
  spawnedChildPid: child.pid,
  requestedSignals,
  observedOutcome: outcome,
  bodyFailure,
  rawStdout,
  rawStderr,
  custody: custodyReport,
  producerRecordKinds: producerRecords.map((record) => record.kind ?? null),
  targetResult,
}));
