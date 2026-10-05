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
  // The recording compiler answers the version probe with the pinned version
  // string and succeeds silently for every compile.
  const fakeBend = join(fakeBendDir, 'bend');
  writeFileSync(fakeBend, '#!/bin/sh\nif [ "$1" = version ]; then echo "bend 2.0.25"; exit 0; fi\nexit 0\n');
  chmodSync(fakeBend, 0o755);
  const scratchRoot = join(ROOT, '.scratch');
  mkdirSync(scratchRoot, { recursive: true });
  const before = new Set(readdirSync(scratchRoot));
  // Original bytes of one mutation target and one untouched non-target, for
  // the restoration and inventory assertions.
  const targetRel = MUTATIONS[0].file;
  const targetBefore = readFileSync(join(ROOT, targetRel));
  const nonTargetRel = 'bend2/src/coordinator/main.bend';
  const nonTargetBefore = readFileSync(join(ROOT, nonTargetRel));

  const run = spawnSync(process.execPath, [CHECKER, fakeBend], {
    encoding: 'utf8', maxBuffer: Infinity,
  });
  // The child's complete streams are retained before any assertion, so a
  // failure keeps the actual gate output and never reports an empty record.
  writeFileSync(join(fakeBendDir, 'checker.stdout'), run.stdout ?? '');
  writeFileSync(join(fakeBendDir, 'checker.stderr'), run.stderr ?? '');
  assert.equal(run.status, 1, `the gate must end red when every control accepts; stderr: ${run.stderr}\nstdout: ${run.stdout}`);
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
      assert.equal(readFileSync(join(scratch, stream.path)).toString('utf8'), '', `case ${entry.id} ${key} must be retained`);
      assert.equal(stream.bytes, 0);
      assert.match(stream.sha256, /^[0-9a-f]{64}$/);
    }
  }
  // The recorded compiler argv is the fake bend; no wrapper is used here.
  assert.equal(index.cases[0].argv[0], fakeBend);

  // Restoration in the run scratch: the mutated target and a non-target must
  // both equal their original bytes inside the copied tree.
  assert.ok(readFileSync(join(scratch, targetRel)).equals(targetBefore), 'the mutated target must be restored byte for byte in the scratch tree');
  assert.ok(readFileSync(join(scratch, nonTargetRel)).equals(nonTargetBefore), 'a non-target file must be unchanged in the scratch tree');
  // The live tree is untouched as well.
  assert.ok(readFileSync(join(ROOT, targetRel)).equals(targetBefore), 'the live tree must be byte-identical after the run');

  // The run-private scratch is retained evidence on this route; remove only
  // this test's own fake-bend directory.
  rmSync(fakeBendDir, { recursive: true, force: true });
});
