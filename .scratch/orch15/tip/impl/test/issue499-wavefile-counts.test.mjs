import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRAME_LIMITS } from '../src/limits.mjs';
import { compileWavefile } from '../src/workflow-dsl.mjs';
import { admitSpec } from '../src/workflow-interpreter.mjs';

// Issue #499 — the wavefile and workflow-spec member/scope ceilings read the registry
// (FRAME_LIMITS['wave.members'] and ['wave.member.scope']) instead of re-declaring the 64
// literal. The ceilings themselves are structural admission bounds on ONE wave payload
// (docs/audits/2026-09-13-runtime-policy/admission.md §4 F7); this suite pins that the
// declarations are single-sourced and that the refusal behavior is byte-identical.

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

function sourceWithoutComments(filename) {
  return readFileSync(join(srcDir, filename), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

test('499-W1: the wavefile and interpreter declare no local member/scope constants', () => {
  for (const file of ['workflow-dsl.mjs', 'workflow-interpreter.mjs']) {
    const src = sourceWithoutComments(file);
    assert.ok(!/const MAX_MEMBERS = 64/u.test(src), `${file} re-declares the MAX_MEMBERS literal`);
    assert.ok(!/const MAX_SCOPE = 64/u.test(src), `${file} re-declares the MAX_SCOPE literal`);
    assert.ok(src.includes("FRAME_LIMITS['wave.members'].value"),
      `${file} reads FRAME_LIMITS['wave.members'].value`);
    assert.ok(src.includes("FRAME_LIMITS['wave.member.scope'].value"),
      `${file} reads FRAME_LIMITS['wave.member.scope'].value`);
  }
});

function wavefileWithMembers(count) {
  const members = [];
  for (let i = 1; i <= count; i++) {
    members.push([
      `member m${i}`,
      '  harness mock',
      '  model mock-model',
      '  effort low',
      `  objectiveRef reports/a${i}.md`,
    ].join('\n'));
  }
  return ['wave big', 'scope reports/**', ...members].join('\n');
}

test('499-W2: a 65-member wavefile refuses with the unchanged ceiling text', () => {
  assert.throws(
    () => compileWavefile(wavefileWithMembers(65)),
    (error) => error.message.includes('the wavefile exceeds the member ceiling'),
    'the 65-member wavefile must refuse on the member ceiling',
  );
  // 64 members passes the ceiling check (later stages may refuse for other reasons —
  // e.g. the mock objectiveRef file — but never the member ceiling).
  try {
    compileWavefile(wavefileWithMembers(64));
  } catch (error) {
    assert.ok(!String(error.message).includes('member ceiling'),
      'a 64-member wavefile must not refuse on the member ceiling');
  }
});

function specWithMembers(count) {
  return {
    schemaVersion: 1,
    idempotencyKey: 'issue499-count-registry',
    members: Array.from({ length: count }, (_, i) => ({
      role: `m${i + 1}`,
      exact: { harness: 'mock', model: 'mock-model', effort: 'low' },
      scope: ['reports/**'],
      objectiveRef: 'reports/a.md',
    })),
    harvest: { paths: [] },
  };
}

test('499-W3: a 65-member workflow spec refuses with the unchanged ceiling text', () => {
  assert.throws(
    () => admitSpec(specWithMembers(65), __dirname),
    (error) => error.message.includes('exceeds the 64-member ceiling'),
    'the 65-member spec must refuse on the member ceiling',
  );
});

test('499-W4: a member with 65 scope paths refuses with the unchanged bounded-array text', () => {
  const spec = specWithMembers(1);
  spec.members[0].scope = Array.from({ length: 65 }, (_, i) => `reports/dir${i}/**`);
  assert.throws(
    () => admitSpec(spec, __dirname),
    (error) => error.message.includes('"scope" must be a non-empty bounded array'),
    'the 65-path scope must refuse on the scope ceiling',
  );
});
