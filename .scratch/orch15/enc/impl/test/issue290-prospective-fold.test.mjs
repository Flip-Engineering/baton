// Issue #290 deliverable 1 (audit swarm-a giants E11/GAP3/GAP4): the store's pass-through
// recording paths fold prospectively and refuse typed BEFORE the durable append, so a malformed
// event can never reach disk and poison replay — and a poison that an older ledger did land is
// exposed by startupStatus() and a reader instead of being invisible to every reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationStore } from '../src/index.mjs';

const actor = 'test:issue290-fold';

function root(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue290-fold-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('I290-F1: a malformed wave roster is refused before the durable append, never poisoning replay', (t) => {
  const directory = root(t);
  const store = new CoordinationStore(directory);
  // The audit repro: a driver.recorded wave.started whose roster is neither a well-formed
  // object-array nor a well-formed string-array. Pre-fix this appended durably, then the fold
  // refused with wave_registry_invalid and the projection was poisoned.
  for (const roster of ['garbage', [null], { waveId: 'not-an-array' }, [42]]) {
    assert.throws(() => store.recordDriver('wave.started', { waveId: 'w1', roster }, {
      actor, key: `issue290:bad-roster:${JSON.stringify(roster)}`,
    }), (error) => error?.code === 'coordination_record_invalid',
    `roster ${JSON.stringify(roster)} must be refused before the append`);
    assert.equal(existsSync(join(directory, 'events.jsonl')), false,
      'a refused prospective fold must never reach the durable ledger');
  }
  // The store keeps its authority: a well-formed event lands as seq 1.
  const landed = store.recordDriver('wave.started', { waveId: 'w1', roster: ['member-a'] }, {
    actor, key: 'issue290:good-roster',
  });
  assert.equal(landed.event.seq, 1);
  store.releaseWriterLease({ requireOwned: true });

  const reopened = new CoordinationStore(directory);
  assert.equal(reopened.startupStatus().state, 'ready',
    'replay of a ledger that never saw the malformed event must stay clean');
  reopened.releaseWriterLease({ requireOwned: true });
});

test('I290-F2: the audit-class lanes refuse non-plain-object payloads before the append', (t) => {
  const directory = root(t);
  const store = new CoordinationStore(directory);
  const cases = [
    () => store.recordMcpAudit(null, { actor, key: 'issue290:shape:null' }),
    () => store.recordMcpAudit('entry-as-string', { actor, key: 'issue290:shape:string' }),
    () => store.recordWebAudit(42, { actor, key: 'issue290:shape:42' }),
  ];
  for (const attempt of cases) {
    assert.throws(attempt, (error) => error?.code === 'coordination_record_invalid');
  }
  assert.equal(existsSync(join(directory, 'events.jsonl')), false,
    'no refused audit-class payload may reach the ledger');
  store.releaseWriterLease({ requireOwned: true });
});

test('I290-F3: a live poison is exposed by startupStatus and the projectionPoison reader', (t) => {
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
    actor, key: 'issue290:poison:1',
  }), (error) => error?.code === 'coordination_projection_poisoned');
  assert.deepEqual(store.projectionPoison(), {
    schemaVersion: 1, seq: 1, kind: 'driver.recorded', causeCode: 'injected_projection_failure',
  }, 'the poison must be readable, not private to the write path');
  assert.equal(store.startupStatus().poison?.seq, 1,
    'startupStatus exposes the projection poison alongside the startup state');
  store.releaseWriterLease({ requireOwned: true });
});
