import assert from 'node:assert/strict';
import test from 'node:test';

import { operatorAsset } from '../src/web-operator.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

// Issue #499 — the web operator's objective textarea carried maxlength="4096",
// which silently truncated in the browser when the registry's run.objective lane
// uses SPILL_BODY_BYTES (1 048 576). The textarea's maxlength must be at least
// the registry value so the browser does not discard valid input before the
// server-side admission can judge it.

const html = operatorAsset('/control').body;

test('499-web-a: the objective textarea maxlength is at least the registry run.objective ceiling', () => {
  const row = FRAME_LIMITS['run.objective'];
  assert.ok(row, 'the registry declares a run.objective lane');

  const match = html.match(/id="objective"[^>]*maxlength="(\d+)"/);
  assert.ok(match, 'the objective textarea declares a maxlength attribute');

  const maxlength = Number(match[1]);
  assert.ok(maxlength >= row.value,
    `objective maxlength ${maxlength} must be >= run.objective value ${row.value}`);
});
