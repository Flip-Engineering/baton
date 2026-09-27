import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';

test('CP85-P1: a post-write apply failure poisons the writer until exact replay', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase85-projection-poison-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new CoordinationStore(root);
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
    actor: 'test:projection-poison', key: 'projection-poison:1',
  }), (error) => error?.code === 'coordination_projection_poisoned'
    && error?.cause?.code === 'injected_projection_failure');
  assert.deepEqual(store._projectionPoison, {
    schemaVersion: 1, seq: 1, kind: 'driver.recorded',
    causeCode: 'injected_projection_failure',
  });
  const ledger = join(root, 'events.jsonl');
  assert.equal(readFileSync(ledger, 'utf8').trim().split('\n').length, 1,
    'the triggering event is already durable');
  assert.throws(() => store.recordDriver('projection.must.not.append', { value: 2 }, {
    actor: 'test:projection-poison', key: 'projection-poison:2',
  }), (error) => error?.code === 'coordination_projection_poisoned');
  assert.equal(readFileSync(ledger, 'utf8').trim().split('\n').length, 1,
    'a poisoned projection must never append later authority');
  store.releaseWriterLease({ requireOwned: true });

  const reopened = new CoordinationStore(root);
  const appended = reopened.recordDriver('projection.replayed.then.appended', { value: 3 }, {
    actor: 'test:projection-poison', key: 'projection-poison:3',
  });
  assert.equal(appended.event.seq, 2,
    'restart must rebuild the valid durable prefix before accepting later authority');
  reopened.releaseWriterLease({ requireOwned: true });
});
