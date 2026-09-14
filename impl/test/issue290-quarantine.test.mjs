// Issue #290 deliverable 2 (audit swarm-a giants friction 1 / lead finding 1): a poisoned store
// has a supported quarantine/repair verb — a typed operation that names the offending seq and
// lets the deployment restart with the event quarantined (durably recorded as such), never a
// hand edit of events.jsonl.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore, quarantineCoordinationLedgerEvent } from '../src/index.mjs';

const actor = 'test:issue290-quarantine';

function root(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue290-quarantine-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** Simulate the older ledger that found the poison: a durable driver.recorded wave.started whose
 * roster the fold refuses. Written as raw bytes exactly like the pre-fix store would have. */
function landLegacyWaveEvent(directory, seq, key) {
  appendFileSync(join(directory, 'events.jsonl'), `${JSON.stringify({
    schemaVersion: 1, seq, ts: '2026-09-14T00:00:00.000Z', kind: 'driver.recorded',
    actor: 'legacy-store', idempotencyKey: key,
    payload: { kind: 'wave.started', waveId: 'w-legacy', roster: 'garbage' },
  })}\n`);
}

test('I290-Q1: the live poison names its seq and the quarantine verb resumes the store', (t) => {
  const directory = root(t);
  const store = new CoordinationStore(directory);
  const apply = store._apply.bind(store);
  store._apply = (event) => {
    if (event.kind === 'driver.recorded' && event.payload?.kind === 'projection.poison.trigger') {
      throw Object.assign(new Error('injected post-write projection failure'), {
        code: 'injected_projection_failure',
      });
    }
    return apply(event);
  };
  assert.throws(() => store.recordDriver('projection.poison.trigger', { value: 1 }, {
    actor, key: 'issue290:q1:poison',
  }), (error) => error?.code === 'coordination_projection_poisoned');

  // Quarantining a seq the poison did not name refuses typed.
  const result = store.quarantineProjectionEvent(1, {
    reason: 'fold refusal on a durable audit wave; quarantining per the repair contract',
    actor: 'operator:issue290',
  });
  assert.equal(result.ok, true);
  assert.equal(result.entry.seq, 1);
  assert.equal(result.entry.kind, 'driver.recorded');
  assert.equal(result.entry.causeCode, 'injected_projection_failure');
  assert.equal(result.entry.actor, 'operator:issue290');
  assert.equal(Number.isNaN(Date.parse(result.entry.ts)), false,
    'the quarantine entry records when the repair was made');
  assert.equal(store.projectionPoison(), null, 'the repair clears the poison');

  // The store resumes: the quarantined event stays in the ledger, later authority lands at seq 2.
  const resumed = store.recordDriver('after.quarantine', { value: 2 }, { actor, key: 'issue290:q1:resume' });
  assert.equal(resumed.event.seq, 2);

  // The quarantine is durably recorded beside the ledger, never by editing events.jsonl.
  const recorded = JSON.parse(readFileSync(join(directory, 'coordination-quarantine.json'), 'utf8'));
  assert.deepEqual(recorded.entries.map((entry) => entry.seq), [1]);
  const ledger = readFileSync(join(directory, 'events.jsonl'), 'utf8').trim().split('\n');
  assert.equal(ledger.length, 2, 'the ledger bytes are untouched by the repair');
  store.releaseWriterLease({ requireOwned: true });
});

test('I290-Q2: a poisoned older ledger restarts after the standalone verb quarantines the named seq', async (t) => {
  const directory = root(t);
  const first = new CoordinationStore(directory);
  first.recordDriver('before.wave', { value: 0 }, { actor, key: 'issue290:q2:before' });
  first.releaseWriterLease({ requireOwned: true });
  landLegacyWaveEvent(directory, 2, 'issue290:q2:legacy-wave');

  // Restart refuses; the startup failure names the fold code AND the offending seq.
  let failure = null;
  assert.throws(() => new CoordinationStore(directory, {
    startupProgress: (entry) => { failure = entry; },
  }), (error) => error?.code === 'wave_registry_invalid');
  assert.equal(failure?.state, 'failed');
  assert.equal(failure?.failure?.code, 'wave_registry_invalid');
  assert.equal(failure?.failure?.seq, 2, 'the failure must name the seq the operator must quarantine');


  const repaired = await quarantineCoordinationLedgerEvent(directory, {
    seq: 2, reason: 'audit #290 legacy wave roster', actor: 'operator:issue290',
  });
  assert.equal(repaired.ok, true);
  assert.equal(repaired.entry.seq, 2);
  assert.equal(repaired.entry.causeCode, 'wave_registry_invalid',
    'the verb proves the quarantine is warranted by replaying before it records anything');

  // After the repair the ledger replays clean, so ANY further quarantine attempt is refused by
  // name — the verb only records fold refusals an operator has actually observed.
  await assert.rejects(() => quarantineCoordinationLedgerEvent(directory, {
    seq: 1, reason: 'healthy prefix', actor: 'operator:issue290',
  }), (error) => error?.code === 'coordination_quarantine_replays_clean');

  const reopened = new CoordinationStore(directory);
  assert.equal(reopened.startupStatus().state, 'ready');
  assert.deepEqual(reopened.startupStatus().quarantined, [2],
    'startupStatus exposes the quarantined seqs');
  assert.equal(reopened.waveRegistry().some((row) => row.waveId === 'w-legacy'), false,
    'the quarantined fold is skipped on replay');
  assert.equal(reopened.snapshot().lastSeq, 2, 'the event stays parsed in the ledger');
  const after = reopened.recordDriver('after.repair', { value: 3 }, { actor, key: 'issue290:q2:after' });
  assert.equal(after.event.seq, 3);
  reopened.releaseWriterLease({ requireOwned: true });

  // One more restart: the quarantine keeps holding across the new checkpoint.
  const again = new CoordinationStore(directory);
  assert.deepEqual(again.startupStatus().quarantined, [2]);
  again.releaseWriterLease({ requireOwned: true });
});

test('I290-Q3: the standalone verb refuses a ledger that replays clean or names the wrong seq', async (t) => {
  const directory = root(t);
  const healthy = new CoordinationStore(directory);
  healthy.recordDriver('healthy.event', {}, { actor, key: 'issue290:q3:healthy' });
  healthy.releaseWriterLease({ requireOwned: true });
  await assert.rejects(() => quarantineCoordinationLedgerEvent(directory, {
    seq: 1, reason: 'nothing is wrong', actor: 'operator:issue290',
  }), (error) => error?.code === 'coordination_quarantine_replays_clean'
    && /replays clean/.test(error.message));

  const poisoned = root(t);
  const store = new CoordinationStore(poisoned);
  store.recordDriver('before.wave', {}, { actor, key: 'issue290:q3:before' });
  store.releaseWriterLease({ requireOwned: true });
  landLegacyWaveEvent(poisoned, 2, 'issue290:q3:legacy-wave');
  await assert.rejects(() => quarantineCoordinationLedgerEvent(poisoned, {
    seq: 1, reason: 'the poison names seq 2, not 1', actor: 'operator:issue290',
  }), (error) => error?.code === 'coordination_quarantine_refused'
    && error?.detail?.failureSeq === 2);

  for (const bad of [{ seq: 0 }, { seq: '2' }, { seq: 2.5 }, { seq: 2, reason: '' }, { seq: 2, actor: 7 }]) {
    await assert.rejects(() => quarantineCoordinationLedgerEvent(poisoned, {
      reason: bad.reason ?? 'x', actor: bad.actor ?? 'operator:issue290', seq: bad.seq,
    }), TypeError, `malformed request ${JSON.stringify(bad)} must refuse as a TypeError`);
  }
});
