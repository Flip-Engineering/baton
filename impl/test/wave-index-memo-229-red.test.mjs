import { test } from 'node:test';
import assert from 'node:assert/strict';

// #229 red pin — the waves.list loop-starvation wedge, root-caused live (2026-08-20):
// _runWaveIndex() rebuilt its map with a FULL ledger scan (140k events / 73MB in prod) per
// waves.list/waves.progress call, on the resident's single event loop. Multi-second bursts
// starved the HTTP parser — 'TCP accepts, HTTP never answers', 3x in production, captured
// twice today with `sample`: main thread 100% inside one eventsView filter cascade.
//
// The measured cost is ITERATION over the vector, not the eventsView() call itself (a memo
// still asks the store for its length/cursor). The spy therefore counts how many EVENTS each
// read materialized: a memoized unchanged-ledger read touches 0 events.
//
// RED   = every read materializes the full vector (N events × 4 reads).
// GREEN = repeated reads on an unchanged ledger materialize 0 events; only appended
//         events are scanned (the delta scan), and the memo still resolves every run.

test('WAVE-INDEX-MEMO (#229): repeated wave-index reads on an unchanged ledger iterate zero events', async () => {
  const { BatonApplication } = await import('../src/application.mjs');

  const N = 50_000;
  const rawEvents = [];
  for (let i = 0; i < N; i++) {
    rawEvents.push(i % 5_000 === 0
      ? { kind: 'driver.recorded', payload: { kind: 'steering.registered', runId: `run-${i}`, waveId: `wave-${i}`, waveRole: 'row' } }
      : { kind: 'evidence.mapped', payload: { kind: 'content.tool_call' } });
  }

  let materialized = 0;
  const eventsView = (fromSeq = 1, limit = null) => {
    const start = Math.max(0, (Number.isSafeInteger(fromSeq) ? fromSeq : 1) - 1);
    const end = limit === null ? rawEvents.length : Math.min(rawEvents.length, start + limit);
    materialized += end - start;
    return rawEvents.slice(start, end);
  };
  const app = Object.create(BatonApplication.prototype);
  app.driver = { coordination: { eventsView, eventCursor: () => rawEvents.length } };

  const first = app._runWaveIndex();
  assert.equal(first.byRunId.size, 10, 'the index sees the 10 steering-registered records');
  const firstCost = materialized;
  assert.ok(firstCost >= N, `the cold read scans the vector (${firstCost} events)`);

  materialized = 0;
  app._runWaveIndex();
  app._runWaveIndex();
  const warm = app._runWaveIndex();
  assert.equal(warm.byRunId.size, 10, 'the memoized index still resolves every run');
  assert.equal(materialized, 0,
    `unchanged-ledger reads materialized ${materialized} events (expected 0 — the memo must serve without rescanning; this full rescan is the #229 wedge source)`);

  // Delta correctness: appended steering records are picked up by the next read.
  rawEvents.push(
    { kind: 'driver.recorded', payload: { kind: 'steering.registered', runId: 'run-new', waveId: 'wave-new', waveRole: 'late' } },
    { kind: 'evidence.mapped', payload: { kind: 'content.message' } },
  );
  const afterAppend = app._runWaveIndex();
  assert.equal(afterAppend.byRunId.get('run-new')?.waveId, 'wave-new',
    'appended steering records are indexed by the delta scan');
  assert.equal(afterAppend.byRunId.size, 11);
});
