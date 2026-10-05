// Fixture: bootstrap -> process.execve continuity and environment boundary.
//
// Continuity is the parent-observed spawned child pid against the target's own
// reported pid. This is the fixture's own spawned child, not a keeper birth
// identity, and that limit is recorded. Full raw stdout and stderr are written
// beside the result. An `error` event is reported separately and never counted
// as an observed close.
import { spawn } from 'node:child_process';
import { EnvironmentRefusal, FIXTURE_ENTRIES, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment, writeReport, writeStream } from '../lib/assert.mjs';
import { own } from '../lib/children.mjs';
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
let errorSeen = null;
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stderr += chunk));
const closeObservation = new Promise((resolve) => {
  child.on('error', (error) => {
    errorSeen = error.code ?? String(error);
    resolve({ closed: false, error: errorSeen });
  });
  child.on('close', (code, signal) => resolve({ closed: true, code, signal }));
});
child.stdin.end(document);

const requestedSignals = [];
let timeoutFired = false;
const timeout = setTimeout(() => {
  timeoutFired = true;
  requestedSignals.push('SIGKILL');
  custody.kill('SIGKILL');
}, 30000);
const outcome = await closeObservation;
clearTimeout(timeout);
if (outcome.closed) custody.markReaped();

writeStream(environment, 'exec-continuity.child.stdout.txt', stdout);
writeStream(environment, 'exec-continuity.child.stderr.txt', stderr);

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

reporter.check('child:target-started', targetResult !== null, null);
reporter.check('child:close-observed', outcome.closed === true, outcome);
reporter.check('child:no-error-event', errorSeen === null, errorSeen);
reporter.check('child:no-timeout', timeoutFired === false, { requestedSignals });
reporter.check('child:exit-zero', outcome.code === 0 && outcome.signal === null, outcome);
reporter.check('continuity:spawned-pid-equals-target-pid',
  targetResult !== null && targetResult.target_pid === child.pid,
  { spawnedChildPid: child.pid, targetPid: targetResult?.target_pid ?? null });
reporter.check('env:marker-absent', !(stdout + stderr).includes('MARKER_MUST_NOT_APPEAR'), null);
reporter.check('env:no-unexpected-extra-key', unexpectedExtra.length === 0,
  { extraKeys, allowedExtra: environment.platformInjectedEnvKeys, platform: process.platform });
reporter.check('env:no-missing-declared-key', missingKeys.length === 0, missingKeys);
reporter.check('env:declared-values-exact', valueMismatches.length === 0, valueMismatches);
reporter.check('stdin:at-eof', targetResult?.stdin_bytes === 0, targetResult?.stdin_bytes ?? null);

reporter.note('continuity limit: compared pid is this fixture\'s spawned child, not a keeper birth identity');
finish(environment, 'exec-continuity.result.json', reporter.finalize({
  declaredTargetEnv: declared,
  spawnArgv: argv,
  spawnedChildPid: child.pid,
  requestedSignals,
  observedOutcome: outcome,
  errorSeen,
  rawStdout: { artifact: 'exec-continuity.child.stdout.txt', bytes: Buffer.byteLength(stdout) },
  rawStderr: { artifact: 'exec-continuity.child.stderr.txt', bytes: Buffer.byteLength(stderr) },
  producerRecordKinds: producerRecords.map((record) => record.kind ?? null),
  targetResult,
}));
