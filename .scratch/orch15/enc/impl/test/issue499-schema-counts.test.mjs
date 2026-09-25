import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRAME_LIMITS } from '../src/limits.mjs';

// Issue #499 — the MCP and semantic-registry wave schema counts read the registry COUNTS rows.
// The member roster ceilings (maxItems) read FRAME_LIMITS['wave.members'].value, the member
// scope ceilings read FRAME_LIMITS['wave.member.scope'].value, and the workflow team ceiling
// reads FRAME_LIMITS['workflow.team.members'].value. One bare `maxItems: 64` per file SURVIVES
// by triage: the scratchpad entryIds batch (application-semantics.mjs knowledge scratch
// correction input, mcp-northbound.mjs its MCP face) — a different bound whose derivation is
// not yet on file (flagged in the lane's triage table, not silently coupled to a view row).

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..', 'src');

function sourceWithoutComments(filename) {
  return readFileSync(join(srcDir, filename), 'utf8')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

test('499-M1: each schema file carries exactly one surviving bare 64 (the triaged entryIds batch)', () => {
  for (const file of ['application-semantics.mjs', 'mcp-northbound.mjs']) {
    const src = sourceWithoutComments(file);
    const bare64 = src.split('maxItems: 64').length - 1;
    assert.equal(bare64, 1, `${file} keeps exactly one triaged maxItems: 64 (the entryIds batch), found ${bare64}`);
    assert.ok(src.includes("FRAME_LIMITS['wave.members'].value"),
      `${file} reads FRAME_LIMITS['wave.members'].value`);
    assert.ok(src.includes("FRAME_LIMITS['wave.member.scope'].value"),
      `${file} reads FRAME_LIMITS['wave.member.scope'].value`);
  }
});

test('499-M2: the workflow team ceiling reads the registry row', () => {
  const src = sourceWithoutComments('application-semantics.mjs');
  assert.ok(!src.includes('maxItems: 16'),
    'application-semantics.mjs re-declares the team ceiling as a bare literal');
  assert.ok(src.includes("FRAME_LIMITS['workflow.team.members'].value"),
    'application-semantics.mjs reads FRAME_LIMITS[\'workflow.team.members\'].value');
});
