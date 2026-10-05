// Suite runner.
//
// Admission runs first over the union of every fixture's executed entries, before
// any fixture child is spawned. Under a historical pin only the registered
// fixtures run, against the pinned closure, so eras are never mixed.
//
// Full stdout and stderr are persisted per fixture child, including failed
// fixtures, and the machine-readable summary is written separately with the
// floor executable identity.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EnvironmentRefusal, observedDigestLines, openEnvironmentOrExit, SUITE_DIR, unionEntries,
} from './lib/env.mjs';
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
  environment = openEnvironmentOrExit(unionEntries());
} catch (error) {
  if (error instanceof EnvironmentRefusal) {
    process.stdout.write(`FAIL environment ${error.condition}${error.detail === null ? '' : `: ${error.detail}`}\n`);
    process.exit(3);
  }
  throw error;
}

let fixtures = CANDIDATE_FIXTURES;
let mode = 'candidate';
if (environment.pin !== null) {
  const pin = HISTORICAL_PINS[environment.pinName];
  fixtures = pin.fixtures.map((name) => `${name}.mjs`);
  mode = `historical:${environment.pinName}`;
}

const results = [];
for (const fixture of fixtures) {
  const run = spawnSync(process.execPath, [join(SUITE_DIR, 'fixtures', fixture)], {
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
    refusalLine: stdout.split('\n').find((line) => line.startsWith('FAIL environment')) ?? null,
  });
  process.stdout.write(`[${run.status === 0 ? 'PASS' : 'FAIL'}] ${fixture} exit=${run.status} signal=${run.signal} error=${run.error?.code ?? ''}\n`);
}

const failed = results.filter((entry) => entry.status !== 0 || entry.signal !== null);
const summary = {
  suite: 'bend2/tests/runtime-security',
  mode,
  platform: environment.platform,
  floorNode: environment.floorNode,
  floorNodeSha256: environment.floorNodeSha256,
  producerRoot: environment.producerRoot,
  expectedManifest: environment.expectedPath,
  closureFiles: environment.closureFiles,
  observedDigests: observedDigestLines(environment),
  historicalScope: environment.historicalScope,
  fixtureCount: fixtures.length,
  failed: failed.map((entry) => entry.fixture),
  results,
};
writeFileSync(join(environment.evidenceDir, 'run-all.summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
process.exit(failed.length === 0 ? 0 : 1);
