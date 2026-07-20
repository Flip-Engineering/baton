import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { canonicalValueDigest, canonicalValueText, createProgramValueAuthority } from '../src/program-ir/index.mjs';
import { canonicalJson, compareCanonicalStrings } from '../src/canonical-order.mjs';
import { contextValueDigest, normalizeContextProgram } from '../src/context-program.mjs';
import vectors from './fixtures/phase93a-canonical-vectors.mjs';

const authority = createProgramValueAuthority({
  maxJoinMembers: 64, maxProgramBytes: 64 * 1024, maxProgramDepth: 32,
  maxProgramNodes: 256, maxSchemaDefinitions: 64, maxValueBytes: 16 * 1024,
});

test('P93A1-C1: immutable fixtures cover JCS UTF-16 ordering and numeric boundaries', () => {
  assert.equal(Object.isFrozen(vectors), true);
  assert.equal(Object.isFrozen(vectors.values), true);
  for (const vector of vectors.values) {
    assert.equal(canonicalValueText(vector.value, authority), vector.canonical, vector.name);
    assert.equal(canonicalValueDigest(vector.value, authority),
      createHash('sha256').update(vector.canonical).digest('hex'));
  }
  assert.equal(canonicalValueText({ '\uE000': 1, '😀': 2 }, authority), '{"😀":2,"":1}');
});

test('P93A1-C2: Program identity is NFC-stable, insertion-independent, and negative-zero normalized', () => {
  const left = { z: -0, 'e\u0301': { b: 2, a: 1 } };
  const right = { é: { a: 1, b: 2 }, z: 0 };
  assert.equal(canonicalValueText(left, authority), canonicalValueText(right, authority));
  assert.equal(canonicalValueDigest(left, authority), canonicalValueDigest(right, authority));
});

test('P93A1-C3: Phase 63 canonical-order and Phase 81 Context identity remain byte-stable', () => {
  assert.equal(createHash('sha256').update(readFileSync(new URL('../src/canonical-order.mjs', import.meta.url))).digest('hex'),
    '22a00b39101650c0a9ede7c6382261a3c8071aa3af87bb07bab7ec7b758a111f');
  assert.equal(compareCanonicalStrings('😀', '\uE000'), -1);
  assert.deepEqual(canonicalJson({ z: -0, a: 1 }), { a: 1, z: -0 });
  assert.equal(contextValueDigest({ z: 1, a: -0 }),
    '6f8e07a68fb3342735f01b788af3e724a7056b40e2aad3d4321d38f7de49f905');
  assert.equal(normalizeContextProgram({
    schemaVersion: 1, kind: 'baton.context_program', expression: { op: 'source', branch: 'repository' },
  }).programDigest, 'cd02ddd9efc64c5250aa7b0b6a1655a1060632b4d0ddb70110fe6dc4d74cb9b1');
});
