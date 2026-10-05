// Fixture: bootstrap pre-exec validation and exec outcome.
//
// Candidate mode (no historical pin): a directory or a mode-0644 regular file
// named as the target Node must be refused with a structured bootstrap record
// and a numeric non-zero exit status, with no process.execve abort, and the real
// Node control must start the target.
//
// Historical mode runs only when BATON_HISTORICAL_CLOSURE_SHA256 names a pin
// registered for this fixture and the admitted closure matches it exactly. For
// the verified review closure the invalid documents abort with status null and
// signal SIGABRT. The two modes are never mixed in one run.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EnvironmentRefusal, FIXTURE_ENTRIES, openEnvironmentOrExit } from '../lib/env.mjs';
import { createReport, finish, refuseEnvironment } from '../lib/assert.mjs';
import { requirePin } from '../lib/pins.mjs';

let environment;
let historical = false;
try {
  environment = openEnvironmentOrExit(FIXTURE_ENTRIES['bootstrap-exec']);
  if (environment.pin !== null) {
    requirePin(environment, 'bootstrap-exec');
    historical = true;
  }
} catch (error) {
  if (error instanceof EnvironmentRefusal) refuseEnvironment(error);
  throw error;
}

const reporter = createReport('bootstrap-exec', environment);
const work = join(environment.evidenceDir, 'bootstrap-exec-work');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const bootstrap = environment.runtimePath('bootstrap.mjs');
const directory = join(work, 'is-a-directory');
mkdirSync(directory, { recursive: true });
const plain = join(work, 'plain-file');
writeFileSync(plain, 'not executable\n');
chmodSync(plain, 0o644);
const target = join(work, 'target.mjs');
writeFileSync(target, 'process.stdout.write("TARGET_RAN pid=" + process.pid + "\\n");\n');

const cases = [
  { name: 'directory-as-node', node: directory, invalid: true },
  { name: 'nonexecutable-file-as-node', node: plain, invalid: true },
  { name: 'real-node-control', node: environment.floorNode, extra: [target], invalid: false },
];

const REFUSAL_EXCLUDES = ['launchAdopted'];
const results = [];
for (const item of cases) {
  const document = JSON.stringify({
    version: 1,
    node: item.node,
    argv: [item.node, ...(item.extra ?? [join(work, 'x.mjs')])],
    env: { BATON_FIXTURE_DECLARED: 'target-value' },
  });
  const argv = [
    '/usr/bin/env', '-i',
    'PATH=/usr/bin:/bin', 'HOME=/tmp/baton-fixture-home', 'TMPDIR=/tmp', 'LC_ALL=C',
    environment.floorNode, bootstrap,
  ];
  const run = spawnSync(argv[0], argv.slice(1), {
    input: document, encoding: 'utf8', cwd: work, timeout: 30000,
  });
  const stderr = run.stderr ?? '';
  const records = stderr.split('\n')
    .filter((line) => line.trim().startsWith('{'))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((value) => value !== null);
  const kinds = records.map((record) => record.kind).filter((kind) => typeof kind === 'string');
  const executiveAdoption = kinds.filter((kind) => !REFUSAL_EXCLUDES.includes(kind));
  const targetRan = /TARGET_RAN/.test(run.stdout ?? '');
  const execAbort = /process\.execve failed/.test(stderr);
  results.push({
    name: item.name,
    document,
    argv,
    status: run.status,
    signal: run.signal,
    statusIsNull: run.status === null,
    stdout: run.stdout,
    stderr,
    kinds,
    nonAdoptionRecords: executiveAdoption,
    execAbort,
    targetRan,
  });

  const label = item.name;
  reporter.check(`${label}:no-target-start-on-invalid`, item.invalid ? !targetRan : targetRan, { targetRan });
  if (!item.invalid) {
    reporter.check(`${label}:exit-zero`, run.status === 0 && run.signal === null,
      { status: run.status, signal: run.signal });
    continue;
  }
  if (historical) {
    reporter.check(`${label}:aborts-with-signal`,
      run.status === null && run.signal === 'SIGABRT', { status: run.status, signal: run.signal });
  } else {
    reporter.check(`${label}:structured-refusal`,
      run.signal === null && typeof run.status === 'number' && run.status !== 0 && executiveAdoption.length > 0,
      { status: run.status, signal: run.signal, kinds });
    reporter.check(`${label}:no-exec-abort-on-refusal`, execAbort === false, execAbort);
  }
}

try {
  rmSync(work, { recursive: true, force: true });
} catch {
  // scratch cleanup is best effort; evidence is retained
}

finish(environment, 'bootstrap-exec.result.json', reporter.finalize({ historical, cases: results }));
