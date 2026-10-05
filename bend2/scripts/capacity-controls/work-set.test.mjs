// Discovery contract tests over the checker's own executed definitions. No
// compiler runs: discovery reads the tree and hashes definition bytes.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';
import { MUTATIONS } from '../laws-mutations.mjs';
import { ROOT } from '../laws-check.mjs';
import { bindingOf, discoveryRecords, groupModules, mutationDefinition, proofDefinition, recordsForModule, sha256Hex } from './work-set.mjs';

test('discovery records are unique and stable', () => {
  const records = discoveryRecords();
  assert.equal(records.length > 0, true);
  const ids = new Set(records.map((record) => record.id));
  assert.equal(ids.size, records.length);
  for (const record of records) {
    assert.deepEqual(Object.keys(record), ['id', 'kind', 'law', 'module', 'definition_sha256']);
    assert.match(record.id, /^(proof|mutation):/);
    assert.match(record.definition_sha256, /^[0-9a-f]{64}$/);
  }
  const again = discoveryRecords();
  assert.deepEqual(bindingOf(records), bindingOf(again));
});

test('binding is order independent over the same set', () => {
  const records = discoveryRecords();
  assert.equal(bindingOf(records), bindingOf([...records].reverse()));
});

test('groups partition the record set exactly', () => {
  const records = discoveryRecords();
  const grouped = groupModules(records).flatMap((module) => recordsForModule(records, module).map((record) => record.id));
  assert.equal(grouped.length, records.length);
  assert.equal(new Set(grouped).size, records.length);
});

test('definition bytes hash the law line plus the removed block', () => {
  const record = discoveryRecords().find((entry) => entry.kind === 'proof-removal');
  const text = readFileSync(join(ROOT, record.module), 'utf8');
  assert.equal(sha256Hex(proofDefinition(text, record.law)), record.definition_sha256);
  // Removing the block from the definition bytes leaves the law line.
  const lines = proofDefinition(text, record.law).split('\n');
  assert.match(lines[0], new RegExp(`^law ${record.law}:$`));
});

test('mutation definition bytes bind file, find, replace and law', () => {
  const record = discoveryRecords().find((entry) => entry.kind === 'mutation');
  assert.equal(sha256Hex(mutationDefinition(MUTATIONS.find((mutation) => `mutation:${mutation.name}` === record.id))), record.definition_sha256);
  for (const mutation of MUTATIONS) {
    for (const field of ['name', 'file', 'find', 'replace', 'law']) {
      assert.equal(typeof mutation[field], 'string', `mutation ${mutation.name} field ${field} must be a string`);
      assert.ok(mutation[field] !== '', `mutation ${mutation.name} field ${field} is empty`);
    }
  }
});

test('the exported D1 control applies first replacement against its accepted source when composed', () => {
  const d1 = MUTATIONS.find((mutation) => mutation.name === 'reviewed-selection-D1-stops-after-commit');
  assert.ok(d1, 'the exported D1 control must exist');
  const sourcePath = join(ROOT, d1.file);
  const text = readFileSync(sourcePath, 'utf8');
  if (!text.includes(d1.find)) {
    assert.fail('the accepted selection source is absent from this tree; D1 requires the 6fb composition before remote execution');
  }
  const changed = text.replace(d1.find, d1.replace);
  // First-occurrence semantics: exactly one occurrence is replaced, and the
  // law-suffix occurrence stays byte-identical and nonempty.
  assert.equal(changed.split(d1.find).length - 1, text.split(d1.find).length - 2);
  const lawLeaf = d1.law;
  const suffixPattern = new RegExp(`law ${lawLeaf}:[\\s\\S]*?$`);
  const originalSuffix = suffixPattern.exec(text)?.[0];
  const changedSuffix = suffixPattern.exec(changed)?.[0];
  assert.ok(originalSuffix, 'the D1 law suffix must exist in the composed source');
  assert.ok(changedSuffix, 'the D1 law suffix must survive first-occurrence replacement');
  assert.equal(changedSuffix, originalSuffix);
});

test('the checker discovery CLI answers with one record per line', () => {
  const stdout = execFileSync(process.execPath, [join(ROOT, 'bend2', 'scripts', 'laws-check.mjs'), '--discover'], {
    encoding: 'utf8', maxBuffer: Infinity,
  });
  const lines = stdout.split('\n').filter((line) => line !== '');
  assert.equal(lines.length, discoveryRecords().length);
  const parsed = lines.map((line) => JSON.parse(line));
  assert.equal(new Set(parsed.map((record) => record.id)).size, parsed.length);
  assert.deepEqual(bindingOf(parsed), bindingOf(discoveryRecords()));
});
