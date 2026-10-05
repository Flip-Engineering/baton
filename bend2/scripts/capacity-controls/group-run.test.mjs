// Group runner argument contract and compiler-backed parity tests. The
// argument matrix is pure; the parity case requires the pinned compiler and
// time tool, so it fails with an explicit environment message where they are
// absent instead of skipping.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../laws-check.mjs';
import { parseGroupArgs, runGroup, UsageError } from './group-run.mjs';
import { mutationDefinition, proofDefinition, sha256Hex } from './work-set.mjs';
import { accepted, aggregate } from './aggregate.mjs';

test('group argument parsing enforces the option contract', () => {
  const valid = parseGroupArgs([
    '--group', 'bend2/src/coordinator/receive.bend',
    '--evidence-dir', '/tmp/evidence',
    '--time-tool', '/usr/bin/time',
    '--time-flag', '-l',
  ]);
  assert.equal(valid.module, 'bend2/src/coordinator/receive.bend');
  assert.equal(valid.timeFlag, '-l');
  assert.throws(() => parseGroupArgs(['--unknown']), UsageError);
  assert.throws(() => parseGroupArgs(['--group', '--evidence-dir', '/tmp/evidence', '--time-tool', '/usr/bin/time', '--time-flag', '-l']), UsageError);
  assert.throws(() => parseGroupArgs(['--evidence-dir', '/tmp/evidence', '--time-tool', '/usr/bin/time', '--time-flag', '-l']), UsageError);
  assert.throws(() => parseGroupArgs(['--group', 'm', '--evidence-dir', '/tmp/evidence', '--time-tool', '/usr/bin/time']), UsageError);
});

// Fixture work set: the mini entry imports the mini module and both carry
// laws; the mutation pins admitted() to the open gate.
function fixtureRecords() {
  const moduleDir = join(ROOT, 'bend2', 'scripts', 'capacity-controls', 'fixtures', 'mini-laws', 'bend2', 'src');
  const miniText = readFileSync(join(moduleDir, 'mini.bend'), 'utf8');
  const mainText = readFileSync(join(moduleDir, 'main.bend'), 'utf8');
  const mutation = {
    name: 'mini-admitted-returns-refused-gate',
    file: 'bend2/src/mini.bend',
    find: 'def admitted() -> Gate:\n  Gate{True{}}',
    replace: 'def admitted() -> Gate:\n  Gate{False{}}',
    law: 'mini_admitted_gate_is_open',
    expected: 'Gate{True{}}',
    observed: 'Gate{False{}}',
  };
  return {
    mutation,
    records: [
      { id: 'proof:mini_admitted_gate_is_open', kind: 'proof-removal', law: 'mini_admitted_gate_is_open', module: 'bend2/src/mini.bend', definition_sha256: sha256Hex(proofDefinition(miniText, 'mini_admitted_gate_is_open')) },
      { id: 'proof:mini_refused_gate_is_closed', kind: 'proof-removal', law: 'mini_refused_gate_is_closed', module: 'bend2/src/mini.bend', definition_sha256: sha256Hex(proofDefinition(miniText, 'mini_refused_gate_is_closed')) },
      { id: 'proof:mini_entry_answer_is_true', kind: 'proof-removal', law: 'mini_entry_answer_is_true', module: 'bend2/src/main.bend', definition_sha256: sha256Hex(proofDefinition(mainText, 'mini_entry_answer_is_true')) },
      { id: `mutation:${mutation.name}`, kind: 'mutation', law: mutation.law, module: mutation.file, definition_sha256: sha256Hex(mutationDefinition(mutation)) },
    ],
  };
}

test('group parity runs the mini fixture end to end and accepts', async () => {
  const bend = process.env.BEND;
  assert.ok(bend, 'group parity requires BEND pointing at the pinned Bend 2.0.25 compiler; run on the admitted runner');
  const timeTool = process.env.TIME_TOOL ?? '/usr/bin/time';
  const timeFlag = process.env.TIME_FLAG ?? '-l';
  assert.ok(existsSync(timeTool), `time tool is unavailable: ${timeTool}`);
  const { records, mutation } = fixtureRecords();
  const evidence = mkdtempSync(join(tmpdir(), 'capacity-controls-parity-'));
  // Evidence is retained on failure: cleanup happens only after every
  // assertion has passed, so a failed run keeps its manifests and streams.
  const { manifest } = await runGroup({
    module: 'bend2/src/mini.bend',
    evidenceDir: join(evidence, 'group-mini'),
    timeTool,
    timeFlag,
    bend,
    records,
    mutationDefinitions: [mutation],
    copyDir: join(ROOT, 'bend2', 'scripts', 'capacity-controls', 'fixtures', 'mini-laws', 'bend2'),
    entry: 'bend2/src/main.bend',
    sourceRoot: null,
  });
  assert.equal(manifest.entry, 'bend2/src/main.bend');
  assert.equal(manifest.baseline.process.state, 'exited');
  assert.equal(manifest.baseline.process.exit_code, 0);
  for (const result of manifest.results) {
    assert.equal(result.setup, 'applied');
    assert.equal(result.diagnostic.class, 'intended-law-refusal');
    assert.equal(result.diagnostic.attributed_law, result.case.law);
  }
  // Serial intervals: every child starts at or after the baseline ends and
  // children never overlap.
  assert.ok(manifest.results.every((result) => result.process.started >= manifest.baseline.process.ended));
  const ends = manifest.results.map((result) => result.process.ended);
  const starts = manifest.results.map((result) => result.process.started);
  for (let i = 1; i < starts.length; i++) assert.ok(starts[i] >= ends[i - 1]);
  const moduleRecords = records.filter((record) => record.module === 'bend2/src/mini.bend');
  const { summary } = aggregate({ dir: evidence, records: moduleRecords });
  assert.equal(summary.expected_cases, moduleRecords.length);
  assert.deepEqual(summary.rejections, []);
  assert.equal(accepted(summary), true);
  rmSync(evidence, { recursive: true, force: true });
});
