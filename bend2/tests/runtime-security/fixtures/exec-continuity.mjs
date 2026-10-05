// Fixture: bootstrap -> process.execve continuity and environment boundary.
//
// The child is spawned in the approved shape: /usr/bin/env -i <explicit base>
// <exact floor Node> <producer bootstrap.mjs>, with the complete launch document
// written to initial stdin through EOF. The platform text-encoding addition is
// allowed on darwin and must be absent on linux.
import { spawn } from 'node:child_process';
import { EnvironmentRefusal, loadEnvironment } from '../lib/env.mjs';
import { createReport, finish, failEnvironment } from '../lib/assert.mjs';

let environment;
try {
  environment = loadEnvironment();
} catch (error) {
  if (error instanceof EnvironmentRefusal) failEnvironment(error.condition, error.detail);
  throw error;
}

const reporter = createReport('exec-continuity', environment, environment.expect);

for (const name of ['bootstrap.mjs']) {
  reporter.check(`producer:${name}:present`, environment.hashes[name] !== undefined, environment.hashes[name] ?? null);
}
reporter.check('producer:no-hash-mismatch', environment.mismatches.length === 0, environment.mismatches.join('; '));
reporter.check('producer:no-missing-file', environment.missing.length === 0, environment.missing.join('; '));
if (environment.mismatches.length > 0 || environment.missing.length > 0) {
  finish(environment, 'exec-continuity.result.json', reporter.finalize());
}

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
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stderr += chunk));
child.stdin.end(document);

const outcome = await new Promise((resolve) => {
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    resolve({ timedOut: true, code: null, signal: 'SIGKILL' });
  }, 30000);
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    resolve({ timedOut: false, code, signal });
  });
});

let observed = null;
for (const line of stdout.trim().split('\n').filter(Boolean)) {
  try {
    observed = JSON.parse(line);
  } catch {
    observed = null;
  }
}
const bootstrapLine = stderr.split('\n').find((line) => line.startsWith('BOOTSTRAP')) ?? null;
const bootPid = bootstrapLine === null ? null : Number(/pid=(\d+)/.exec(bootstrapLine)?.[1] ?? NaN);

const declaredKeys = Object.keys(declared).sort();
const observedKeys = observed?.envKeys ?? [];
const extraKeys = observedKeys.filter((key) => !declaredKeys.includes(key));
const allowedExtra = environment.platformInjectedEnvKeys;
const unexpectedExtra = extraKeys.filter((key) => !allowedExtra.includes(key));
const missingKeys = declaredKeys.filter((key) => !observedKeys.includes(key));

reporter.check('child:started', observed !== null, outcome);
reporter.check('child:not-timed-out', outcome.timedOut === false, outcome);
reporter.check('child:exit-zero', outcome.code === 0 && outcome.signal === null, outcome);
reporter.check('continuity:pid-equal', bootPid !== null && observed !== null && bootPid === observed.target_pid,
  { bootstrapPid: bootPid, targetPid: observed?.target_pid ?? null });
reporter.check('env:marker-absent', !(stdout + stderr).includes('MARKER_MUST_NOT_APPEAR'),
  observed?.env?.BATON_FIXTURE_MARKER ?? null);
reporter.check('env:no-unexpected-extra-key', unexpectedExtra.length === 0,
  { extraKeys, allowedExtra, platform: process.platform });
reporter.check('env:no-missing-declared-key', missingKeys.length === 0, missingKeys);
reporter.check('stdin:at-eof', observed?.stdin_bytes === 0, observed?.stdin_bytes ?? null);

finish(environment, 'exec-continuity.result.json', reporter.finalize({
  declaredTargetEnv: declared,
  spawnArgv: argv,
  outcome,
  bootstrapLine,
  observed,
}));
