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
    location: 'mini.mini_admitted_gate_is_open',
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

test('group parity runs the complete fixture work set and aggregates exhaustively', async () => {
  const bend = process.env.BEND;
  assert.ok(bend, 'group parity requires BEND pointing at the pinned Bend 2.0.25 compiler; run on the admitted runner');
  const timeTool = process.env.TIME_TOOL ?? '/usr/bin/time';
  const timeFlag = process.env.TIME_FLAG ?? '-l';
  assert.ok(existsSync(timeTool), `time tool is unavailable: ${timeTool}`);
  const { records, mutation } = fixtureRecords();
  const fixtureBend2 = join(ROOT, 'bend2', 'scripts', 'capacity-controls', 'fixtures', 'mini-laws', 'bend2');
  // The complete fixture work set comes from the shared discovery authority
  // over the fixture tree and its actual definitions; the executed selection
  // is per module and must never be empty.
  const expectedRecords = records;
  const expectedIds = new Set(expectedRecords.map((record) => record.id));
  assert.equal(expectedIds.size, expectedRecords.length);
  const evidence = mkdtempSync(join(tmpdir(), 'capacity-controls-parity-'));
  // Evidence is retained on failure: cleanup happens only after every
  // assertion has passed, so a failed run keeps its manifests and streams.
  const groups = [];
  for (const moduleName of ['bend2/src/mini.bend', 'bend2/src/main.bend']) {
    const selected = expectedRecords.filter((record) => record.module === moduleName);
    assert.ok(selected.length > 0, `the fixture work set must select ${moduleName}`);
    const groupDir = join(evidence, `group-${moduleName.replaceAll('/', '_')}`);
    const { manifest } = await runGroup({
      module: moduleName,
      evidenceDir: groupDir,
      timeTool,
      timeFlag,
      bend,
      records: expectedRecords,
      mutationDefinitions: [mutation],
      copyDir: fixtureBend2,
      entry: 'bend2/src/main.bend',
      sourceRoot: null,
    });
    groups.push({ moduleName, groupDir, manifest, selected });
  }
  for (const { moduleName, manifest, selected } of groups) {
    assert.equal(manifest.entry, 'bend2/src/main.bend');
    assert.equal(manifest.baseline.process.state, 'exited');
    assert.equal(manifest.baseline.process.exit_code, 0);
    // Exact produced identities: the selected set, whole and in order of none
    // other than the discovery records themselves.
    assert.deepEqual(
      manifest.results.map((result) => result.case.id).sort(),
      selected.map((record) => record.id).sort(),
    );
    for (const result of manifest.results) {
      const definition = expectedRecords.find((record) => record.id === result.case.id);
      assert.ok(definition, `produced case ${result.case.id} is not in the fixture discovery`);
      assert.equal(result.case.module, moduleName);
      assert.equal(result.case.law, definition.law);
      assert.equal(result.case.definition_sha256, definition.definition_sha256);
      assert.equal(result.setup, 'applied');
      assert.equal(result.diagnostic.class, 'intended-law-refusal');
      assert.equal(result.diagnostic.attributed_law, result.case.law);
      assert.ok(result.process.started >= manifest.baseline.process.ended);
    }
    const ends = manifest.results.map((result) => result.process.ended);
    const starts = manifest.results.map((result) => result.process.started);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] >= ends[i - 1]);
  }
  // Exhaustive aggregation across both groups with the fixture's own tree
  // root, entry and definitions; every discovered case arrives exactly once.
  const { summary } = aggregate({
    dir: evidence,
    records: expectedRecords,
    definitions: [mutation],
    moduleRoot: fixtureBend2,
  });
  assert.equal(summary.expected_cases, expectedRecords.length);
  assert.equal(summary.distinct_cases, expectedRecords.length);
  assert.equal(summary.groups, 2);
  assert.deepEqual(summary.rejections, []);
  assert.equal(accepted(summary), true);
  rmSync(evidence, { recursive: true, force: true });
});
