// Suite runner: executes every fixture in this directory as a child process
// with the same injected environment, records each exit status, and exits
// non-zero when any fixture failed or its environment was refused.
//
// Run it with the exact floor Node executable; the child fixtures inherit that
// executable through process.execPath and spawn their own children with
// BATON_FLOOR_NODE.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvironmentRefusal, loadEnvironment, producerDigestLines, SUITE_DIR } from './lib/env.mjs';

const FIXTURES = [
  'exec-continuity.mjs',
  'json-list-fields.mjs',
  'inspector-boundary.mjs',
  'bootstrap-exec.mjs',
  'grants-admission.mjs',
  'endpoint-watch.mjs',
  'endpoint-replacement.mjs',
];

let environment;
try {
  environment = loadEnvironment();
} catch (error) {
  if (error instanceof EnvironmentRefusal) {
    process.stdout.write(`FAIL environment ${error.condition}${error.detail === null ? '' : `: ${error.detail}`}\n`);
    process.exit(3);
  }
  throw error;
}

const results = [];
for (const fixture of FIXTURES) {
  const path = join(SUITE_DIR, 'fixtures', fixture);
  const run = spawnSync(process.execPath, [path], {
    cwd: SUITE_DIR,
    env: process.env,
    encoding: 'utf8',
    timeout: 180000,
  });
  results.push({
    fixture,
    status: run.status,
    signal: run.signal,
    timedOut: run.error?.code === 'ETIMEDOUT',
    stderrTail: (run.stderr ?? '').trim().split('\n').slice(-3),
  });
  process.stdout.write(`[${run.status === 0 ? 'PASS' : 'FAIL'}] ${fixture} exit=${run.status} signal=${run.signal}\n`);
}

const failed = results.filter((entry) => entry.status !== 0 || entry.signal !== null);
const summary = {
  suite: 'bend2/tests/runtime-security',
  expect: environment.expect,
  platform: environment.platform,
  producerRoot: environment.producerRoot,
  producerDigests: producerDigestLines(environment),
  producerHashMismatches: environment.mismatches,
  producerHashMissing: environment.missing,
  fixtureCount: FIXTURES.length,
  failed: failed.map((entry) => entry.fixture),
  results,
};
writeFileSync(join(environment.evidenceDir, 'run-all.summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exit(failed.length === 0 ? 0 : 1);
