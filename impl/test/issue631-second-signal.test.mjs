// Issue #631 (root ruling 2026-09-28T20:38Z): a second signal is the operator's escalation.
//
// The observed run: the resident took SIGTERM at 2026-09-28T19:07:22Z, drained, and hung with no
// harness process alive. At 19:12Z the operator sent SIGINT — it did nothing — and the operator had
// to SIGKILL the resident. A second signal now records what the stop still waits on, by
// participant, and then ends the resident process. It kills no seat: the seats' own processes are
// left to the next start's recovery.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BatonWebHost, SignalLifecycleOwner, describeStopWait } from '../src/application-host.mjs';

test('631: a second signal escalates once and ends the process; the first one does not', async () => {
  const signals = new EventEmitter();
  const escalated = [];
  const exits = [];
  const owner = new SignalLifecycleOwner({
    signalEmitter: signals,
    // A drain that never converges — the shape of the observed run.
    shutdown: () => new Promise(() => {}),
    escalate: (kind) => { escalated.push(kind); },
    exit: (code) => { exits.push(code); },
  });
  const running = owner.run(async ({ signal }) => {
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return { state: 'interrupted' };
  });
  const settled = () => new Promise((resolve) => setImmediate(resolve));

  signals.emit('SIGTERM');
  await settled();
  assert.deepEqual(exits, [], 'the first signal never ends the process');

  signals.emit('SIGINT');
  await settled();
  assert.deepEqual(escalated, ['SIGINT'], 'the second signal escalates exactly once');
  assert.deepEqual(exits, [130], 'the process ends with 128 + the signal it was escalated by');

  signals.emit('SIGINT');
  await settled();
  assert.deepEqual(escalated, ['SIGINT'], 'a third signal does not escalate again');
  assert.deepEqual(exits, [130], 'a third signal ends nothing a second time');
  void running.catch(() => {});
});

test('631: a bare lifecycle with no exit authority ends nothing', async () => {
  const signals = new EventEmitter();
  const owner = new SignalLifecycleOwner({
    signalEmitter: signals,
    shutdown: () => new Promise(() => {}),
  });
  const running = owner.run(async ({ signal }) => {
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return { state: 'interrupted' };
  });
  signals.emit('SIGTERM');
  signals.emit('SIGHUP');
  await new Promise((resolve) => setImmediate(resolve));
  // The caller still owns its own stop: the lifecycle did not reach for the process.
  assert.equal(owner.escalated, true);
  void running.catch(() => {});
});

test('631: the escalation record names the participants the stop still waits on', () => {
  const wait = describeStopWait({
    waitingOn: [
      { workerId: 'w-101', waiting: [{ resource: 'local_resources:worktree', reaper: 'drain-reap', since: '2026-09-28T19:07:32.000Z' }], released: [] },
      { workerId: 'w-104', waiting: [{ resource: 'local_resources:cleanupPending', reaper: 'drain-reap', since: '2026-09-28T19:07:32.000Z' }], released: [] },
      { workerId: 'w-109', waiting: [{ resource: 'capacity:verify-lease', reaper: null, since: null }], released: [] },
    ],
  });
  assert.equal(wait.on, 'worker', 'the record is a participant wait');
  assert.deepEqual([...wait.ids], ['w-101', 'w-104'],
    'a row whose only wait is a capacity reservation names no participant to kill');
  assert.deepEqual(wait.entries.map((entry) => entry.resource),
    ['local_resources:worktree', 'local_resources:cleanupPending', 'capacity:verify-lease']);
});

test('631: the host escalation writes one durable host.stop_waiting row by participant', async () => {
  const lines = [];
  const written = [];
  const host = Object.create(BatonWebHost.prototype);
  host.report = (line) => lines.push(line);
  host.stopRecords = {
    requested: () => ({ line: null, recorded: false }),
    stopped: () => ({ line: null }),
    waiting: async ({ wait }) => {
      written.push(wait);
      return { line: `baton serve: host.stop_waiting on ${wait.on} ${wait.ids.join(',')}` };
    },
    waits: () => [{
      workerId: 'w-101',
      waiting: [{ resource: 'local_resources:worktree', reaper: 'drain-reap', since: '2026-09-28T19:07:32.000Z' }],
      released: [],
    }],
  };
  await host.escalateStop('SIGINT');
  assert.equal(written.length, 1, 'exactly one row is written for the escalation');
  assert.equal(written[0].on, 'worker');
  assert.deepEqual([...written[0].ids], ['w-101']);
  assert.ok(lines.some((line) => line.includes('host.stop_waiting on worker w-101')),
    'the operator line names the participant');
});
