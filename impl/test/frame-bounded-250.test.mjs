import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// #250 red pin — the CLI surfaceSnapshot seam rides the list furnaces.
//
// Measured live (the wave-f baton-top demonstration, 2026-08-20): every `baton top` frame
// fires doctor + runs.list + waves.list + run.inspect in parallel. runs.list and
// waves.list are the #210/#216 bounded-cost furnaces (101.8s per waves_list measured on
// the campaign ledger). At the default 1s refresh the operator seat wedges the resident.
//
// The contract: a frame's snapshot NEVER issues the list projections. The un-scoped frame
// reads doctor only (the pulse/routes seam); a run-scoped frame adds run.inspect; a
// wave-scoped frame adds waves.progress. Fleet roster (when needed) rides the bounded
// coordinator seams — NOT runs.list/waves.list.
//
// RED   = the seam's source contains `runs.list` and `waves.list` command fires.
// GREEN = neither string appears in the surfaceSnapshot body; the scoped reads remain.

test('FRAME-BOUNDED (#250): the CLI surfaceSnapshot never fires the list projections', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../src/production-cli-convergence.mjs'), 'utf8');
  // isolate the surfaceSnapshot seam body (from its key to the next seam key)
  const start = src.indexOf("if (key === 'surfaceSnapshot')");
  const end = src.indexOf("if (key === 'surfaceWatch')");
  assert.ok(start !== -1 && end !== -1 && end > start, 'the surfaceSnapshot seam exists');
  const seam = src.slice(start, end);
  assert.ok(!seam.includes("'runs.list'") && !seam.includes('"runs.list"'),
    'the frame seam must not fire runs.list (the #210 furnace — a frame is bounded reads)');
  assert.ok(!seam.includes("'waves.list'") && !seam.includes('"waves.list"'),
    'the frame seam must not fire waves.list (the #210/#216 furnace — 101.8s measured per call)');
  // the scoped reads stay: run.inspect for run frames, waves.progress for wave frames
  assert.ok(seam.includes('run.inspect'), 'run-scoped frames still read run.inspect (bounded)');
  assert.ok(seam.includes('waves.progress'), 'wave-scoped frames still read waves.progress (bounded)');
});
