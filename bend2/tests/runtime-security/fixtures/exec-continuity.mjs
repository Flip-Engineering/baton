// Fixture: bootstrap -> process.execve continuity and environment boundary.
//
// The child is spawned in the approved shape: /usr/bin/env -i <explicit base>
// <exact floor Node> <producer bootstrap.mjs>, with the complete launch document
// written to initial stdin through EOF.
//
// Continuity is established from the parent-observed spawned child pid and the
// target's own reported pid, so the fixture does not depend on any particular
// bootstrap log line. This is NOT keeper birth identity: the spawned child is
// the process this fixture itself created, and the limit is recorded.
//
// The declared environment is checked by key AND by value, and the platform
// text-encoding addition is allowed on darwin and must be absent on linux.
import { spawn } from 'node:child_process';
import { EnvironmentRefusal, openEnvironmentOrExit, observedDigestLines } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment, writeReport } from '../lib/assert.mjs';
import { historicalExpectation } from '../lib/pins.mjs';

let environment;
try {
  environment = openEnvironmentOrExit();
  if (environment.historicalPin !== null) historicalExpectation(environment, 'exec-continuity');
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('exec-continuity', environment);
const bootstrap = environment.runtimePath('bootstrap.mjs');
const target = environment.helperPath('target.mjs');
const declared = {
  PATH: '/usr/bin:/bin',
  HOME: '/tmp/baton-fixture-home',
  LC_ALL: 'C',
  BATON_FIXTURE_DECLARED: 'target-value',
};
const document = JSON.stringify({
  version: 1,
  node: environment.floorNode,
  argv: [environment.floorNode, target, 'arg-one'],
  env: declared,
});
const argv = [
  '/usr/bin/env', '-i',
  'PATH=/usr/bin:/bin', 'HOME=/tmp/baton-fixture-home', 'TMPDIR=/tmp', 'LC_ALL=C',
  environment.floorNode, bootstrap,
];

const child = spawn(argv[0], argv.slice(1), {
  cwd: environment.evidenceDir,
  env: { ...process.env, BATON_FIXTURE_MARKER: 'MARKER_MUST_NOT_APPEAR' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
// Observation is installed before any work so an early exit cannot be missed.
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stderr += chunk));
const exitObservation = new Promise((resolve) => {
  child.on('close', (code, signal) => resolve({ code, signal, at: Date.now() }));
  child.on('error', (error) => resolve({ error: error.code ?? String(error), at: Date.now() }));
});
child.stdin.end(document);

const requestedSignals = [];
let timeoutFired = false;
const timeout = setTimeout(() => {
  timeoutFired = true;
  requestedSignals.push('SIGKILL');
  child.kill('SIGKILL');
}, 30000);
const observed = await exitObservation;
clearTimeout(timeout);

let targetResult = null;
for (const line of stdout.trim().split('\n').filter(Boolean)) {
  try {
    targetResult = JSON.parse(line);
  } catch {
    targetResult = null;
  }
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

reporter.check('child:started', targetResult !== null, { stdout: stdout.slice(0, 400), stderr: stderr.slice(0, 400) });
reporter.check('child:no-timeout', timeoutFired === false, { requestedSignals, observed });
reporter.check('child:exit-zero', observed.code === 0 && observed.signal === null, observed);
reporter.check('continuity:spawned-pid-equals-target-pid',
  targetResult !== null && targetResult.target_pid === child.pid,
  { spawnedChildPid: child.pid, targetPid: targetResult?.target_pid ?? null });
reporter.check('env:marker-absent', !(stdout + stderr).includes('MARKER_MUST_NOT_APPEAR'),
  targetResult?.env?.BATON_FIXTURE_MARKER ?? null);
reporter.check('env:no-unexpected-extra-key', unexpectedExtra.length === 0,
  { extraKeys, allowedExtra: environment.platformInjectedEnvKeys, platform: process.platform });
reporter.check('env:no-missing-declared-key', missingKeys.length === 0, missingKeys);
reporter.check('env:declared-values-exact', valueMismatches.length === 0, valueMismatches);
reporter.check('stdin:at-eof', targetResult?.stdin_bytes === 0, targetResult?.stdin_bytes ?? null);

const report = reporter.finalize({
  declaredTargetEnv: declared,
  spawnArgv: argv,
  spawnedChildPid: child.pid,
  requestedSignals,
  observedOutcome: observed,
  targetResult,
  producerRecordKinds: producerRecords.map((record) => record.kind ?? null),
});
writeReport(environment, 'exec-continuity.result.json', report);
writeReport(environment, 'exec-continuity.observed.sha256.json',
  { observedDigests: observedDigestLines(environment), closureSha256Observed: environment.closureSha256 });
reporter.note('continuity limit: the compared pid is the spawned child of this fixture, not a keeper birth identity');
finish(environment, 'exec-continuity.result.json', report);
