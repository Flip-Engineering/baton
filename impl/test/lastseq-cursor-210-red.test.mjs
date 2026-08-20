import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// #210 red pin — the cheap-read callsites that clone the world for a scalar.
//
// The #229 chain killed three furnace instances; 18 `coordination.snapshot()` callsites
// remain in application.mjs. The cheapest class first: 4 callsites call the FULL
// deep-clone snapshot() solely to read `lastSeq` — a number the store already exposes
// O(1) as eventCursor() (the #227 accessor). Each such call deep-clones every task, run,
// lineage row, and receipt in the store to read one integer.
//
// RED   = `snapshot().lastSeq` appears in application.mjs.
// GREEN = every lastSeq consumer calls eventCursor() — zero full-store clones for scalars.

test('LASTSEQ-CURSOR (#210): no callsite clones the whole store to read a scalar', () => {
  const src = readFileSync(resolve(import.meta.dirname, '../src/application.mjs'), 'utf8');
  const offenders = [...src.matchAll(/coordination\.snapshot\(\)\.lastSeq/g)].length;
  assert.equal(offenders, 0,
    `${offenders} callsites deep-clone the entire store to read lastSeq — a scalar the store exposes O(1) as eventCursor() (the #227 accessor)`);
  // and the cursor path is actually used
  assert.ok(src.includes('eventCursor()'),
    'the bounded eventCursor() accessor is the lastSeq read path');
});
