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

test('first-occurrence replacement preserves the law suffix occurrence', () => {
  // The defined application semantics are String.includes plus String.replace,
  // which changes the first occurrence only. A find text that also occurs in
  // the operative law must leave that occurrence byte-identical.
  const source = '    first call(FIND)\nlaw pinned_behavior:\n  {call(FIND) == ok : T}\n';
  const find = 'call(FIND)';
  const replace = 'call(REPLACED)';
  const changed = source.includes(find) ? source.replace(find, replace) : source;
  assert.equal(changed.split(find).length - 1, 1);
  assert.equal(changed.includes('law pinned_behavior:\n  {call(FIND) == ok : T}\n'), true);
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
