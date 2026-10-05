// Ordinary-route orchestration test with a recording compiler. The fake
// compiler succeeds silently, so the baseline compiles, every negative control
// accepts, and the complete gate must end red with full retained evidence
// instead of crashing. This exercises the actual main() path: snapshot
// discovery from the copied tree, repo-relative control paths, shared-boundary
// qualification, separate stream retention, incremental index and restoration.

import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MUTATIONS } from '../laws-mutations.mjs';
import { laws, ROOT } from '../laws-common.mjs';

const CHECKER = join(ROOT, 'bend2', 'scripts', 'laws-check.mjs');

test('ordinary orchestration records full evidence and restores the tree', () => {
  const rows = laws();
  const expectedCases = rows.length + MUTATIONS.length + 1;
  const fakeBendDir = mkdtempSync(join(tmpdir(), 'capacity-controls-fake-bend-'));
  const fakeBend = join(fakeBendDir, 'bend');
  writeFileSync(fakeBend, '#!/bin/sh\nexit 0\n');
  chmodSync(fakeBend, 0o755);
  const scratchRoot = join(ROOT, '.scratch');
  mkdirSync(scratchRoot, { recursive: true });
  const before = new Set(readdirSync(scratchRoot));
  // One mutable target's bytes before the run, for the restoration assertion.
  const targetRel = MUTATIONS[0].file;
  const targetBefore = readFileSync(join(ROOT, targetRel), 'utf8');

  const run = spawnSync(process.execPath, [CHECKER, fakeBend], {
    encoding: 'utf8', maxBuffer: Infinity,
  });
  assert.equal(run.status, 1, `the gate must end red when every control accepts; stderr: ${run.stderr}`);
  const lines = run.stdout.split('\n').filter((line) => line !== '');
  const rowsJson = lines.filter((line) => line.startsWith('{') && !line.includes('laws-check:'));
  assert.equal(rowsJson.length, expectedCases);
  assert.match(lines[lines.length - 1], /laws-check: red - \d+ laws, \d+ mutations, \d+ compiles, \d+ failures/);

  const created = readdirSync(scratchRoot).filter((name) => !before.has(name) && name.startsWith('bend2-laws-check-'));
  assert.equal(created.length, 1, 'the run must create exactly one run-private scratch directory');
  const scratch = join(scratchRoot, created[0]);
  const index = JSON.parse(readFileSync(join(scratch, 'evidence', 'index.json'), 'utf8'));
  assert.equal(index.schema, 'capacity-controls/ordinary-evidence@1');
  assert.equal(index.complete, true);
  assert.equal(index.cases.length, expectedCases);
  for (const entry of index.cases) {
    assert.ok(entry.outcome.state === 'exited' && entry.outcome.exit_code === 0, `case ${entry.id} must record its actual outcome`);
    assert.ok(Array.isArray(entry.argv) && entry.argv.length === 3);
    for (const key of ['stdout', 'stderr']) {
      const stream = entry[key];
      assert.equal(readFileSync(join(scratch, stream.path), 'utf8'), '', `case ${entry.id} ${key} must be retained`);
      assert.equal(stream.bytes, 0);
      assert.match(stream.sha256, /^[0-9a-f]{64}$/);
    }
  }
  // The recorded compiler argv is the fake bend; the wrapper/tool names stay
  // truthful because no wrapper is used on this route.
  assert.equal(index.cases[0].argv[0], fakeBend);

  // Restoration: the mutated target is byte-identical after the run.
  assert.equal(readFileSync(join(ROOT, targetRel), 'utf8'), targetBefore);

  // The run-private scratch is retained evidence on this route; remove only
  // this test's own fake-bend directory.
  rmSync(fakeBendDir, { recursive: true, force: true });
  void statSync;
});
