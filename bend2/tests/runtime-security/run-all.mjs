// Suite runner.
//
// Admission runs first, before any fixture child is spawned: a refused or
// mismatched producer closure stops the run. Under a historical pin only the
// fixtures registered for that pin run, so candidate and historical eras are
// never mixed in one suite run.
//
// Full stdout and stderr are persisted per fixture child, including failed
// fixtures, and the machine-readable summary is written separately.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EnvironmentRefusal, openEnvironmentOrExit, observedDigestLines, SUITE_DIR } from './lib/env.mjs';
import { HISTORICAL_PINS } from './lib/pins.mjs';

const CANDIDATE_FIXTURES = [
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
  environment = openEnvironmentOrExit();
} catch (error) {
  if (error instanceof EnvironmentRefusal) {
    process.stdout.write(`FAIL environment ${error.condition}${error.detail === null ? '' : `: ${error.detail}`}\n`);
    process.exit(3);
  }
  throw error;
}

let fixtures = CANDIDATE_FIXTURES;
let mode = 'candidate';
if (environment.historicalPin !== null) {
  const pin = HISTORICAL_PINS[environment.historicalPin];
  if (pin === undefined || pin.closureSha256 !== environment.closureSha256) {
    process.stdout.write(`FAIL environment historicalPinMismatch${environment.historicalPin === null ? '' : `: ${environment.historicalPin}`}\n`);
    process.exit(3);
  }
  fixtures = pin.fixtures.map((name) => `${name}.mjs`);
  mode = `historical:${environment.historicalPin}`;
}

const results = [];
for (const fixture of fixtures) {
  const path = join(SUITE_DIR, 'fixtures', fixture);
  const run = spawnSync(process.execPath, [path], {
    cwd: SUITE_DIR,
    env: process.env,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  writeFileSync(join(environment.evidenceDir, `${fixture}.child.stdout.txt`), stdout);
  writeFileSync(join(environment.evidenceDir, `${fixture}.child.stderr.txt`), stderr);
  const refusalLine = stdout.split('\n').find((line) => line.startsWith('FAIL environment')) ?? null;
  results.push({
    fixture,
    status: run.status,
    signal: run.signal,
    error: run.error ? (run.error.code ?? String(run.error)) : null,
    timedOut: run.error?.code === 'ETIMEDOUT',
    stdoutBytes: Buffer.byteLength(stdout),
    stderrBytes: Buffer.byteLength(stderr),
    stdoutArtifact: `${fixture}.child.stdout.txt`,
    stderrArtifact: `${fixture}.child.stderr.txt`,
    refusalLine,
  });
  process.stdout.write(`[${run.status === 0 ? 'PASS' : 'FAIL'}] ${fixture} exit=${run.status} signal=${run.signal} error=${run.error?.code ?? ''}\n`);
}

const failed = results.filter((entry) => entry.status !== 0 || entry.signal !== null);
const summary = {
  suite: 'bend2/tests/runtime-security',
  mode,
  platform: environment.platform,
  producerRoot: environment.producerRoot,
  expectedManifest: environment.expectedPath,
  closureSha256Observed: environment.closureSha256,
  historicalPin: environment.historicalPin,
  observedDigests: observedDigestLines(environment),
  fixtureCount: fixtures.length,
  failed: failed.map((entry) => entry.fixture),
  results,
};
writeFileSync(join(environment.evidenceDir, 'run-all.summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exit(failed.length === 0 ? 0 : 1);
