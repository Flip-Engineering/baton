// Issue #405 red-first suite — writeQuarantineEntry's conflict refusal declares a `{seq}`
// detail the CoordinationRefusal class silently discards (the constructor takes (message, code)
// only), so the quarantined seq is lost off the wire. Owed: the detail travels — the refusal
// class carries `detail` (the constructor accepts (message, code, detail = null)) and the
// conflict refusal names the seq on the wire. The neighbouring quarantine refusals already
// attach their detail as a `detail` property (the Object.assign path); the constructor becomes
// the one canonical way that property exists.
//
// Fixture mirrors issue290-quarantine.test.mjs: a real CoordinationStore poisoned by injecting
// a fold failure, with a prior, different repair entry recorded durably beside the ledger —
// the exact two-operator shape the conflict refusal exists for.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationRefusal } from '../src/coordination-internals.mjs';
import { CoordinationStore } from '../src/index.mjs';

const actor = 'test:issue405-quarantine-detail';

function root(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue405-quarantine-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** The issue290 poison injection: the projection fold refuses the trigger event after its
 * durable append, poisoning the projection at that event's seq. */
function poisonAtNextTrigger(store) {
  const apply = store._apply.bind(store);
  store._apply = (event) => {
    if (event.kind === 'driver.recorded' && event.payload?.kind === 'projection.poison.trigger') {
      throw Object.assign(new Error('injected post-write projection failure'), {
        code: 'injected_projection_failure',
      });
    }
    return apply(event);
  };
  return store;
}

test('I405-1 RED: the quarantine conflict refusal names the quarantined seq on the wire as its detail', (t) => {
  const directory = root(t);
  const store = poisonAtNextTrigger(new CoordinationStore(directory));
  assert.throws(() => store.recordDriver('projection.poison.trigger', { value: 1 },
    { actor, key: 'issue405:poison' }), (error) => error?.code === 'coordination_projection_poisoned');

  // A prior, different repair entry for the same seq is already recorded durably beside the
  // ledger — the exact shape the conflict refusal exists to name.
  writeFileSync(join(directory, 'coordination-quarantine.json'), `${JSON.stringify({
    schemaVersion: 1,
    entries: [{
      schemaVersion: 1, seq: 1, kind: 'driver.recorded', causeCode: 'injected_projection_failure',
      reason: 'an earlier operator quarantined this seq with a different entry',
      actor: 'operator:issue405-earlier', ts: '2026-09-01T00:00:00.000Z',
    }],
  }, null, 2)}\n`, { mode: 0o600 });

  assert.throws(() => store.quarantineProjectionEvent(1, {
    reason: 'a second operator quarantines the same seq with a different entry',
    actor: 'operator:issue405-later',
  }), (error) => {
    assert.equal(error?.name, 'CoordinationRefusal');
    assert.equal(error?.code, 'coordination_quarantine_conflict');
    assert.match(error?.message, /seq 1/u, 'the message names the quarantined seq');
    assert.deepEqual(error?.detail, { seq: 1 },
      `the declared {seq} detail must travel on the refusal; today the class discards it: ${JSON.stringify(error?.detail)}`);
    return true;
  });
});

test('I405-2 RED: the refusal class carries detail — the constructor accepts (message, code, detail = null)', () => {
  const named = new CoordinationRefusal('the refusal message', 'coordination_quarantine_conflict', { seq: 7 });
  assert.deepEqual(named.detail, { seq: 7 },
    `the declared detail must travel on the class; today it is dropped: ${JSON.stringify(named.detail)}`);
  assert.equal(new CoordinationRefusal('the refusal message', 'coordination_quarantine_conflict').detail, null,
    'a refusal built without detail carries null, never undefined');
});

test('I405-3: the neighbouring quarantine refusals keep attaching their detail — one detail shape', (t) => {
  const directory = root(t);
  const store = poisonAtNextTrigger(new CoordinationStore(directory));
  assert.throws(() => store.recordDriver('projection.poison.trigger', { value: 1 },
    { actor, key: 'issue405:poison-mismatch' }), (error) => error?.code === 'coordination_projection_poisoned');

  // The Object.assign detail path the neighbouring refusals use stays exactly as it is.
  assert.throws(() => store.quarantineProjectionEvent(2, { reason: 'wrong seq', actor }),
    (error) => {
      assert.equal(error?.code, 'coordination_quarantine_seq_mismatch');
      assert.deepEqual(error?.detail, { requestedSeq: 2, poisonSeq: 1 },
        'the neighbouring refusals keep their detail untouched by the class change');
      return true;
    });
});
