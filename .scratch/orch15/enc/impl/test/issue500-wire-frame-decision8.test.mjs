import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { FRAME_LIMITS } from '../src/limits.mjs';

// Issue #500 (DUPLICATED_POLICY) — the wire-frame ceiling DEFAULT_MAX_WIRE_FRAME_BYTES
// was independently declared as `1024 * 1024` in five adapter files, but only omp-rpc.mjs
// correctly read it from the registry's wire.frame substrate row. Per Decision 8
// (limits.mjs header), values in the frame-economics registry must not be re-declared:
// every consumer reads the ONE registry, never a bare literal of the same number.
//
// These tests pin the contract: every adapter that declares DEFAULT_MAX_WIRE_FRAME_BYTES
// derives it from FRAME_LIMITS['wire.frame'].value, and none of them carry a bare
// `1024 * 1024` literal on that declaration line.

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

const ADAPTER_FILES = [
  'cli-adapters.mjs',
  'codex-appserver.mjs',
  'claude-session.mjs',
  'grok-acp.mjs',
  'kimi-acp.mjs',
  'omp-rpc.mjs',
];

test('500-wf: no adapter re-declares DEFAULT_MAX_WIRE_FRAME_BYTES as a bare literal', async (t) => {
  const barePattern = /const\s+DEFAULT_MAX_WIRE_FRAME_BYTES\s*=\s*1024\s*\*\s*1024\s*;/u;
  for (const file of ADAPTER_FILES) {
    await t.test(`${file} does not carry a bare 1024 * 1024 literal`, () => {
      const source = readFileSync(join(srcDir, file), 'utf8');
      assert.equal(barePattern.test(source), false,
        `${file} re-declares DEFAULT_MAX_WIRE_FRAME_BYTES as a bare literal — it must read FRAME_LIMITS['wire.frame'].value (Decision 8)`);
    });
  }
});

test('500-wf: every adapter that declares DEFAULT_MAX_WIRE_FRAME_BYTES derives it from FRAME_LIMITS', async (t) => {
  const registryPattern = /const\s+DEFAULT_MAX_WIRE_FRAME_BYTES\s*=\s*FRAME_LIMITS\[['"]wire\.frame['"]\]\.value\s*;/u;
  for (const file of ADAPTER_FILES) {
    await t.test(`${file} reads from FRAME_LIMITS['wire.frame'].value`, () => {
      const source = readFileSync(join(srcDir, file), 'utf8');
      if (!source.includes('DEFAULT_MAX_WIRE_FRAME_BYTES')) return; // file does not declare the constant
      assert.ok(registryPattern.test(source),
        `${file} declares DEFAULT_MAX_WIRE_FRAME_BYTES but does not derive it from FRAME_LIMITS['wire.frame'].value`);
    });
  }
});

test('500-wf: the registry wire.frame row carries the expected 1 MiB value', () => {
  const row = FRAME_LIMITS['wire.frame'];
  assert.ok(row, 'the wire.frame row exists in the registry');
  assert.equal(row.value, 1048576, 'wire.frame is 1 MiB (1048576 bytes)');
  assert.equal(row.class, 'substrate', 'wire.frame is a substrate row');
  assert.equal(row.unit, 'bytes', 'wire.frame is measured in bytes');
});
