import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from '../src/coordination-store.mjs';

// #229/#223 red pin — the inline projection checkpoint wedges the request path.
//
// Measured live (2026-08-20, the #229 chain's final furnace): a 401-refused web request —
// which executes NO command, only one audit append — took 49.5s. The append crossed a
// checkpoint boundary (event.seq % checkpointInterval === 0; 140,032 = 547×256) and paid
// the full 140MB v8-serialize + sha256 checkpoint INLINE in _append. Under the original
// #229 member-evidence flood, appends stream continuously → a checkpoint every 256 events
// → the loop lives inside checkpointing → 'TCP accepts, HTTP never answers'.
//
// The contract: _append never blocks on the checkpoint write. The checkpoint is
// housekeeping (crash-recovery acceleration; the ledger stays authoritative) — it runs
// deferred off the append path, coalesced (one pending write at a time), and still lands
// (setImmediate + the clean-shutdown write both guarantee it).
//
// RED   = the append that crosses the boundary returns only AFTER the checkpoint file
//         was written (mtime advanced before _append returned).
// GREEN = the boundary append returns immediately; the checkpoint lands on the NEXT
//         macrotask; a flood crossing several boundaries coalesces to one write.

function freshStore(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bt229-ckpt-'));
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  const store = new CoordinationStore(dir, { checkpointInterval: 256, now: () => new Date().toISOString() });
  return { store, checkpointFile: join(dir, 'projection.checkpoint') };
}

const append = (store, i) => store._append('evidence.mapped', { i }, { actor: 'test', key: `k-${i}` });

test('CHECKPOINT-DEFERRED (#229): the boundary append returns before the checkpoint write', async (t) => {
  const { store, checkpointFile } = freshStore(t);
  store._assertWriterLease ? null : null;
  // reach seq 255, one before the boundary
  for (let i = 0; i < 255; i++) append(store, i);
  let beforeMtime = null;
  try { beforeMtime = statSync(checkpointFile).mtimeMs; } catch { /* none yet */ }

  const t0 = process.hrtime.bigint();
  const returned = append(store, 255); // seq 256 — the boundary
  const appendMs = Number(process.hrtime.bigint() - t0) / 1e6;

  assert.ok(returned, 'the append completed');
  // THE PIN: at return time the checkpoint has NOT yet been written — the append never
  // blocks on housekeeping. (A fresh file or an unchanged mtime both prove deferral.)
  let duringMtime = null;
  try { duringMtime = statSync(checkpointFile).mtimeMs; } catch { /* absent — still deferred */ }
  assert.ok(duringMtime === null || duringMtime === beforeMtime,
    `the checkpoint wrote INLINE (mtime ${beforeMtime} → ${duringMtime}) during an append that took ${appendMs.toFixed(1)}ms — the request-path wedge`);
  // And it lands by the next macrotask drain.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  const afterMtime = statSync(checkpointFile).mtimeMs;
  assert.notEqual(afterMtime, beforeMtime, 'the deferred checkpoint landed');
});
