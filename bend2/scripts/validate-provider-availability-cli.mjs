#!/usr/bin/env node
// Real CLI fixtures for provider availability. Run under the pinned Node 22 CI job.
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const source = process.env.PROVIDER_SOURCE;
const evidence = process.env.PROVIDER_EVIDENCE;
assert.ok(source, 'PROVIDER_SOURCE must identify the immutable candidate checkout');
assert.ok(evidence, 'PROVIDER_EVIDENCE must identify the raw evidence directory');
mkdirSync(evidence, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'provider-availability-cli-'));
const cli = join(source, 'bend2/scripts/provider-availability.mjs');
const now = '2026-10-07T20:00:00.000Z';

function write(name, contents, mode) {
  const path = join(work, name);
  writeFileSync(path, contents);
  if (mode) chmodSync(path, mode);
  return path;
}

function run(name, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  writeFileSync(join(evidence, `${name}.stdout.txt`), result.stdout ?? '');
  writeFileSync(join(evidence, `${name}.stderr.txt`), result.stderr ?? '');
  writeFileSync(join(evidence, `${name}.status.txt`), `${result.status}\n`);
  assert.equal(result.error, undefined, `${name} process error: ${result.error}`);
  return result;
}

const configured = write('configured.json', JSON.stringify(['zai/glm-5.3', 'zai/absent']));
const history = write('history.json', JSON.stringify([
  { selector: 'zai/glm-5.3', outcome: 'quota-exhausted', detail: 'HTTP 429', observedAt: now },
]));
const catalog = write('catalog.sh', `#!/bin/sh\nprintf '%s' '${JSON.stringify({ models: [
  { provider: 'zai', selector: 'zai/glm-5.3', id: 'glm-5.3', kind: 'chat', name: 'GLM 5.3' },
  { provider: 'zai', selector: 'zai/glm-5.3-flash', id: 'glm-5.3-flash', kind: 'chat', name: 'GLM 5.3 Flash' },
] })}'\n`, 0o755);
const args = ['--omp', catalog, '--configured', configured, '--history', history, '--refused', 'zai/glm-5.3', '--refused-reason', 'HTTP 429', '--now', now];
const catalogResult = run('catalog-history-refused', args);
assert.equal(catalogResult.status, 0);
const report = JSON.parse(catalogResult.stdout);
assert.equal(report.observedAt, now);
assert.equal(report.harnesses.omp.state, 'queried');
assert.deepEqual(report.configured.map(({ selector, state }) => [selector, state]), [
  ['zai/glm-5.3', 'catalogued'], ['zai/absent', 'not-in-catalog'],
]);
assert.deepEqual(report.candidates, ['zai/glm-5.3-flash']);
assert.equal(report.refused.selector, 'zai/glm-5.3');
assert.equal(report.history[0].outcome, 'quota-exhausted');

const malformedCatalog = write('malformed-catalog.sh', "#!/bin/sh\nprintf '%s' '{not json'\n", 0o755);
const malformedResult = run('malformed-catalog-unknown', ['--omp', malformedCatalog, '--configured', configured, '--now', now]);
assert.equal(malformedResult.status, 0);
const malformedReport = JSON.parse(malformedResult.stdout);
assert.equal(malformedReport.harnesses.omp.state, 'unknown');
assert.match(malformedReport.harnesses.omp.reason, /omp models query failed/);
assert.deepEqual(malformedReport.candidates, []);

const invalidResult = run('invalid-option', ['--omp', catalog, '--configured', configured, '--unknown']);
assert.equal(invalidResult.status, 2);
assert.match(invalidResult.stderr, /unknown option: --unknown/);

const tool = process.execPath;
writeFileSync(join(evidence, 'node-version.txt'), `${process.version}\n`);
writeFileSync(join(evidence, 'node-executable.txt'), `${tool}\n`);
writeFileSync(join(evidence, 'fixture-temp-directory.txt'), `${work}\n`);
writeFileSync(join(evidence, 'cli-source-sha256.txt'), `${spawnSync('sha256sum', [cli], { encoding: 'utf8' }).stdout}`);
writeFileSync(join(evidence, 'catalog-fixture-sha256.txt'), `${spawnSync('sha256sum', [catalog], { encoding: 'utf8' }).stdout}`);
writeFileSync(join(evidence, 'malformed-fixture-sha256.txt'), `${spawnSync('sha256sum', [malformedCatalog], { encoding: 'utf8' }).stdout}`);
console.log('provider availability real CLI fixtures passed');
