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

test('classify mode refuses positional arguments and malformed requests', () => {
  const positional = spawnSync(process.execPath, [CHECKER, '--classify', '/some/dir'], {
    encoding: 'utf8',
    env: { ...process.env, BEND: NO_COMPILER },
  });
  assert.equal(positional.status, 2);
  assert.match(positional.stderr, /classify: no positional arguments/);
  const malformed = spawnSync(process.execPath, [CHECKER, '--classify'], {
    input: '{not json', encoding: 'utf8',
    env: { ...process.env, BEND: NO_COMPILER },
  });
  assert.equal(malformed.status, 2);
  assert.match(malformed.stderr, /classify: request is not JSON/);
  assert.equal(malformed.stdout, '');
});

test('mode modules import cleanly after the entry module, without cycles', async () => {
  // The executable dispatch order: the entry module evaluates first, then
  // dynamically imports a mode module. Before the leaf split, that order
  // produced an unsettled top-level await against the entry's back-imports.
  const checker = await import('../laws-check.mjs');
  const aggregate = await import('../capacity-controls/aggregate.mjs');
  const workSet = await import('../capacity-controls/work-set.mjs');
  const groupRun = await import('../capacity-controls/group-run.mjs');
  assert.equal(typeof checker.main, 'function');
  assert.equal(typeof aggregate.aggregate, 'function');
  assert.equal(typeof aggregate.classifyCli, 'function');
  assert.equal(typeof workSet.discoveryRecords, 'function');
  assert.equal(typeof groupRun.runGroup, 'function');
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
