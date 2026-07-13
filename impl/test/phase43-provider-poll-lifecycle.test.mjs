import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderPollSupervisor } from '../src/index.mjs';

function timers() {
  let next = 1; const pending = new Map();
  return {
    setTimeout(fn, delay) { const id = next++; pending.set(id, { fn, delay }); return { id, unref() {} }; },
    clearTimeout(handle) { pending.delete(handle?.id ?? handle); },
    rows() { return [...pending.entries()].map(([id, value]) => ({ id, delay: value.delay })); },
    run(id) { const value = pending.get(id); if (!value) return false; pending.delete(id); value.fn(); return true; },
  };
}

const card = (providerId = 'fixture.poll') => ({ providerId, modes: ['poll'], cardDigest: 'a'.repeat(64), poll: { maxBackoffMs: 40 } });
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('PF6: one provider has one scheduled or active poll and close aborts then awaits settlement', async () => {
  const clock = timers(); let calls = 0; let settled = false;
  const coordinator = { reconcileProviderSource(providerId, { signal }) { calls += 1; assert.equal(providerId, 'fixture.poll'); return new Promise((resolve, reject) => { signal.addEventListener('abort', () => { settled = true; reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }, { once: true }); }); } };
  const supervisor = new ProviderPollSupervisor({ coordinator, cards: [card()], intervalMs: 20, initialBackoffMs: 10, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  assert.equal(supervisor.start(), true); assert.deepEqual(clock.rows().map((row) => row.delay), [0]);
  clock.run(clock.rows()[0].id); await flush(); assert.equal(calls, 1); assert.equal(supervisor.status()[0].active, true); assert.deepEqual(clock.rows(), []);
  const closing = supervisor.close(); await flush(); assert.equal(settled, true); assert.equal(await closing, true); assert.equal(supervisor.status()[0].active, false); assert.deepEqual(clock.rows(), []); assert.equal(await supervisor.close(), false);
});

test('PF6: deterministic retry backoff doubles to the card ceiling and success resets it', async () => {
  const clock = timers(); let attempts = 0;
  const coordinator = { async reconcileProviderSource() { attempts += 1; if (attempts < 3) throw Object.assign(new Error('temporary'), { code: 'provider_poll_timeout' }); return { result: 'healthy' }; } };
  const supervisor = new ProviderPollSupervisor({ coordinator, cards: [card()], intervalMs: 20, initialBackoffMs: 10, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  supervisor.start(); clock.run(clock.rows()[0].id); await flush(); assert.deepEqual(clock.rows().map((row) => row.delay), [10]); assert.equal(supervisor.status()[0].backoffMs, 20);
  clock.run(clock.rows()[0].id); await flush(); assert.deepEqual(clock.rows().map((row) => row.delay), [20]); assert.equal(supervisor.status()[0].backoffMs, 40);
  clock.run(clock.rows()[0].id); await flush(); assert.deepEqual(clock.rows().map((row) => row.delay), [20]); assert.equal(supervisor.status()[0].backoffMs, 10); assert.equal(supervisor.status()[0].lastResult, 'healthy');
  await supervisor.close();
});

test('PF6: deployment timing must fit every pinned provider card', () => {
  const coordinator = { async reconcileProviderSource() { return { result: 'not_required' }; } };
  assert.throws(() => new ProviderPollSupervisor({ coordinator, cards: [card()], intervalMs: 41, initialBackoffMs: 10 }), /poll timing/);
  assert.throws(() => new ProviderPollSupervisor({ coordinator, cards: [card()], intervalMs: 20, initialBackoffMs: 0 }), /poll timing/);
  assert.throws(() => new ProviderPollSupervisor({ coordinator, cards: [{ ...card(), poll: { maxBackoffMs: 0 } }], intervalMs: 20, initialBackoffMs: 10 }), /poll card/);
  assert.throws(() => new ProviderPollSupervisor({ coordinator, cards: [card(), card()], intervalMs: 20, initialBackoffMs: 10 }), /duplicated/);
});
