// Issue #419 — duplicate object-literal keys: hand-merge artifacts where the later key silently
// wins a declaration whose author believed there was one.
//
// The issue's application.mjs evidence is the evidence manifest in `_buildEvidence`, whose `core`
// literal declared `integration` twice: the same value, written twice, so the duplicate was
// invisible at runtime and every reader had to notice it by eye.
//
// A duplicate key is not observable behaviour — that is exactly why it survived. The pin is
// therefore structural: parse the module and refuse any object literal that declares one key
// twice. It reads the AST, so it holds regardless of formatting, and it reports the key and the
// second declaration's line. The value is deliberately NOT compared: a duplicate with a different
// value is the same defect wearing a worse disguise.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { Lang, parse } from '@ast-grep/napi';

const MODULES = ['application.mjs'];

/** Every key an object literal declares twice, as `key (line N, first at line M)`. */
function duplicateKeys(source) {
  const root = parse(Lang.JavaScript, source).root();
  const found = [];
  const keyText = (node) => {
    const text = node.text();
    return text.length >= 2 && (text.startsWith("'") || text.startsWith('"') || text.startsWith('`'))
      ? text.slice(1, -1) : text;
  };
  for (const literal of root.findAll({ rule: { kind: 'object' } })) {
    const seen = new Map();
    for (const child of literal.children()) {
      const kind = child.kind();
      if (kind !== 'pair' && kind !== 'shorthand_property_identifier') continue;
      const key = kind === 'pair' ? child.field('key') : child;
      if (!key || key.kind() === 'computed_property_name') continue;
      const text = keyText(key);
      const line = key.range().start.line + 1;
      if (seen.has(text)) found.push(`${text} (line ${line}, first at line ${seen.get(text)})`);
      else seen.set(text, line);
    }
  }
  return found;
}

test('419-a: no module in the application cluster declares an object key twice', () => {
  const offenders = [];
  for (const module of MODULES) {
    const source = readFileSync(new URL(`../src/${module}`, import.meta.url), 'utf8');
    for (const duplicate of duplicateKeys(source)) offenders.push(`${module}: ${duplicate}`);
  }
  assert.deepEqual(offenders, [],
    'a duplicate key silently wins its declaration; it is a hand-merge artifact, never a shape');
});

test('419-b: the scanner finds a duplicate in a literal that has one', () => {
  // The row above is only worth its red-before verdict if the scanner can see a duplicate at all.
  assert.deepEqual(duplicateKeys('const x = { a: 1, b: 2, a: 3 };\n'),
    ['a (line 1, first at line 1)'], 'same-name keys in one literal are refused');
  assert.deepEqual(duplicateKeys("const x = { 'a': 1, a: 3 };\n"),
    ['a (line 1, first at line 1)'], 'a quoted key is the same key');
  assert.deepEqual(duplicateKeys('const x = { a: 1 };\nconst y = { a: 2 };\n'), [],
    'the same key in two literals is two shapes, never a duplicate');
  assert.deepEqual(duplicateKeys('const x = { a: 1, ...rest };\n'), [],
    'a spread is not a declared key');
});

test('419-c: application.mjs still declares the evidence manifest keys once each', () => {
  // The named site: the evidence manifest's `core` literal in `_buildEvidence`. These keys are
  // pinned by existence, never by position, and the pin is the scanner's own answer for the file.
  const source = readFileSync(new URL('../src/application.mjs', import.meta.url), 'utf8');
  assert.deepEqual(duplicateKeys(source), [], 'application.mjs declares every object key once');
  for (const key of ['integration', 'verification', 'semanticReview']) {
    assert.ok(source.includes(`${key}:`), `the evidence manifest still declares ${key}`);
  }
});
