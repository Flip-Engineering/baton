// Fixture: bootstrap pre-exec validation and exec outcome.
//
// BATON_EXPECT=historical reproduces the current defect: a directory or a
// mode-0644 regular file named as the target Node passes admission, a
// launchAdopted record is emitted, and process.execve aborts the process
// (subprocess status null, signal SIGABRT).
//
// BATON_EXPECT=corrected accepts the fixed candidate: the same documents are
// refused with a structured bootstrap record and a numeric exit status, and no
// process.execve abort. The corrected run must not be required to reproduce
// SIGABRT, and the historical run must not be required to refuse.
//
// The real-Node control must start the target in both modes.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EnvironmentRefusal, loadEnvironment } from '../lib/env.mjs';
import { createReport, finish, failEnvironment } from '../lib/assert.mjs';

let environment;
try {
  environment = loadEnvironment();
} catch (error) {
  if (error instanceof EnvironmentRefusal) failEnvironment(error.condition, error.detail);
  throw error;
}

const reporter = createReport('bootstrap-exec', environment, environment.expect);
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

const REFUSAL_KINDS = [
  'launchRefused', 'launchNodeUnavailable', 'launchNodeNotExecutable',
  'launchExecveUnavailable', 'launchDocumentMalformed',
];

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
  const adopted = kinds.includes('launchAdopted');
  const refusalKind = kinds.find((kind) => REFUSAL_KINDS.includes(kind)) ?? null;
  const execAbort = /process\.execve failed/.test(stderr);
  const targetRan = /TARGET_RAN/.test(run.stdout ?? '');
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
    adoptedBeforeFailure: adopted,
    refusalKind,
    execAbort,
    targetRan,
  });

  const label = item.name;
  reporter.check(`${label}:no-target-start-on-invalid`, item.invalid ? !targetRan : targetRan, { targetRan });
  reporter.check(`${label}:not-timed-out`, run.error === undefined || run.error === null, String(run.error ?? ''));

  if (!item.invalid) {
    reporter.check(`${label}:exit-zero`, run.status === 0 && run.signal === null, { status: run.status, signal: run.signal });
    continue;
  }
  if (environment.expect === 'historical') {
    reporter.check(`${label}:aborts-with-signal`,
      run.status === null && run.signal === 'SIGABRT', { status: run.status, signal: run.signal });
  } else {
    reporter.check(`${label}:structured-refusal`,
      run.signal === null && typeof run.status === 'number' && run.status !== 0 && refusalKind !== null,
      { status: run.status, signal: run.signal, kinds });
    reporter.check(`${label}:no-exec-abort-on-refusal`, execAbort === false, execAbort);
  }
}

try {
  rmSync(work, { recursive: true, force: true });
} catch {
  // evidence directory is retained regardless of fixture scratch cleanup
}

finish(environment, 'bootstrap-exec.result.json', reporter.finalize({ cases: results }));
