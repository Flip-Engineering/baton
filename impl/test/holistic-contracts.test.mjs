import test from 'node:test';
import assert from 'node:assert/strict';
import { EventJournal, NotificationBus } from '../src/holistic-runtime.mjs';
import { contractTests } from './holistic-contract-harness.mjs';

const overrides = {
  async 'MSG-001'() {
    const journal = new EventJournal(); const bus = new NotificationBus(journal);
    const id = bus.sendMessage({ runId: 'r1', recipient: 'worker', body: 'hello' });
    await new Promise((resolve) => queueMicrotask(resolve));
    assert.equal(bus.census().unresolvedMessages.length, 1);
    bus.messageFate(id, 'delivered');
    await new Promise((resolve) => queueMicrotask(resolve));
    assert.equal(bus.census().unresolvedMessages.length, 0);
  },
};

for (const [id, contract] of Object.entries(contractTests)) {
  test(`${id} holistic runtime contract`, overrides[id] ?? contract);
}
