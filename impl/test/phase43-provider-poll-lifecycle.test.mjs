import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderPollSupervisor, ProviderProcessingSupervisor } from '../src/index.mjs';

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

test('DP6: one global processing scan is active or scheduled and close aborts then awaits it', async () => {
  const clock = timers(); let calls = 0; let settled = false;
  const coordinator = { reconcileDueProviderProcessing({ signal }) { calls += 1; return new Promise((resolve, reject) => { signal.addEventListener('abort', () => { settled = true; reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }, { once: true }); }); } };
  const supervisor = new ProviderProcessingSupervisor({ coordinator, intervalMs: 20, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  assert.equal(supervisor.start(), true); assert.deepEqual(clock.rows().map((row) => row.delay), [0]); clock.run(clock.rows()[0].id); await flush(); assert.equal(calls, 1); assert.equal(supervisor.status().active, true); assert.deepEqual(clock.rows(), []);
  const closing = supervisor.close(); await flush(); assert.equal(settled, true); assert.equal(await closing, true); assert.equal(supervisor.status().active, false); assert.equal(supervisor.status().scheduled, false); assert.equal(await supervisor.close(), false);
});

test('DP6: processing lifecycle exposes only bounded counts and a closed supervisor error code', async () => {
  const clock = timers(); const events = []; let calls = 0;
  const coordinator = { async reconcileDueProviderProcessing() { calls += 1; if (calls === 1) return { dueCount: 3, results: [{ result: 'ignored_non_adverse' }, { result: 'deferred' }, { result: 'stale' }] }; throw Object.assign(new Error('secret dependency'), { code: 'SECRET_PROVIDER_CODE' }); } };
  const supervisor = new ProviderProcessingSupervisor({ coordinator, intervalMs: 20, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, onEvent: (event) => events.push(event) });
  supervisor.start(); clock.run(clock.rows()[0].id); await flush(); assert.deepEqual(clock.rows().map((row) => row.delay), [20]); assert.deepEqual(events.at(-1), { kind: 'provider.processing_scan_completed', scan: 1, dueCount: 3, completed: 1, deferred: 1, stale: 1 });
  clock.run(clock.rows()[0].id); await flush(); assert.equal(supervisor.status().lastErrorCode, 'provider_processing_failed'); assert.equal(JSON.stringify(events).includes('SECRET_PROVIDER_CODE'), false); assert.equal(JSON.stringify(events).includes('secret dependency'), false); await supervisor.close();
  assert.throws(() => new ProviderProcessingSupervisor({ coordinator, intervalMs: 24 * 60 * 60 * 1_000 + 1 }), /interval/);
});
