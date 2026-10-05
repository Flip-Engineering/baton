// Checker CLI mode contract tests. These execute the real checker as a
// subprocess: discovery needs no compiler; mode refusals must happen before
// any compiler resolution; the ordinary invocation without a compiler fails
// with its availability message instead of entering a mode.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../laws-check.mjs';

const CHECKER = join(ROOT, 'bend2', 'scripts', 'laws-check.mjs');
const NO_COMPILER = join(ROOT, '.scratch', 'capacity-controls-tests', 'absent-bend');

test('unknown modes refuse before compiler resolution', () => {
  const run = spawnSync(process.execPath, [CHECKER, '--plan'], {
    encoding: 'utf8',
    env: { ...process.env, BEND: NO_COMPILER },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /unknown mode --plan/);
  assert.doesNotMatch(run.stderr, /Bend is unavailable/);
});

test('group mode refuses missing required options before compiler resolution', () => {
  const run = spawnSync(process.execPath, [CHECKER, '--group'], {
    encoding: 'utf8',
    env: { ...process.env, BEND: NO_COMPILER },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /group: option --group needs a value/);
});

test('the ordinary invocation without a compiler fails with the availability message', () => {
  const run = spawnSync(process.execPath, [CHECKER], {
    encoding: 'utf8',
    env: { ...process.env, BEND: NO_COMPILER },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Bend is unavailable/);
});

test('classify mode requires a bundle directory', () => {
  const run = spawnSync(process.execPath, [CHECKER, '--classify'], {
    encoding: 'utf8',
    env: { ...process.env, BEND: NO_COMPILER },
  });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /exactly one bundle directory/);
});

test('discover answers the same records the module API discovers', async () => {
  const { discoveryRecords, bindingOf } = await import('./work-set.mjs');
  const cli = spawnSync(process.execPath, [CHECKER, '--discover'], { encoding: 'utf8', maxBuffer: Infinity });
  assert.equal(cli.status, 0, cli.stderr);
  const records = cli.stdout.split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
  assert.ok(records.length > 0);
  assert.equal(new Set(records.map((record) => record.id)).size, records.length);
  assert.equal(bindingOf(records), bindingOf(discoveryRecords()));
});
