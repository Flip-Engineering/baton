// Issue #542: a scratch runtime directory can remain nonempty for one filesystem turn while its
// child exits. That transient cleanup state is durable host lifecycle evidence. It does not stop
// the resident from publishing, and reconciliation continues in the background until the scope is
// absent.
import test from 'node:test';
import assert from 'node:assert/strict';

import { _trackStartupCleanup } from '../src/runtime-recovery.mjs';
import { KILL_ESCALATION_GRACE_MS } from '../src/process-lifecycle.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((settle) => { resolve = settle; });
  return { promise, resolve };
}

test('542-a: transient scratch cleanup publishes pending and retries to absence without refusing startup', async () => {
  const retry = deferred();
  const timers = [];
  const rows = [];
  let attempts = 0;
  const coordinator = {
    _closed: false,
    _startupCleanupError: null,
    _startupCleanupPending: 0,
    _startupCleanupPromises: [],
    _startupCleanupBackground: new Set(),
    _startupCleanupIncomplete(error, reconciler) {
      return Object.assign(new Error('startup refused'), {
        code: 'coordinator_cleanup_incomplete', cause: error, reconciler,
      });
    },
    _setTimeout(callback, milliseconds) {
      timers.push({ callback, milliseconds });
      retry.promise.then(callback);
      return { unref() {} };
    },
  };
  const recorder = {
    recordDriver(kind, payload, auth) {
      rows.push({ kind, payload, auth });
      return { ok: true };
    },
  };
  const operation = () => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error('runtime scope is still nonempty'), {
        code: 'runtime_cleanup_failed', record: 'w-dead',
        cause: Object.assign(new Error('directory not empty'), { code: 'ENOTEMPTY' }),
      });
    }
    return { state: 'absent' };
  };

  await _trackStartupCleanup(coordinator, recorder, operation, 'worker_processes');

  assert.equal(coordinator._startupCleanupError, null, 'the transient scratch scope does not refuse startup');
  assert.equal(coordinator._startupCleanupPending, 0, 'background cleanup is not a startup admission fence');
  assert.equal(attempts, 1, 'startup performs one reconciliation pass');
  assert.equal(timers.length, 1, 'the retry is scheduled outside the startup pass');
  assert.equal(timers[0].milliseconds, KILL_ESCALATION_GRACE_MS,
    'the retry cadence is derived from the process reap grace');
  assert.deepEqual(rows.map((row) => ({ kind: row.kind, ...row.payload })), [{
    kind: 'host.cleanup_pending', code: 'runtime_cleanup_failed',
    reconciler: 'worker_processes', record: 'w-dead',
    observed: { code: 'runtime_cleanup_failed', causeCode: 'ENOTEMPTY' },
  }], 'the ledger carries one bounded pending fact');

  retry.resolve();
  await Promise.all([...coordinator._startupCleanupBackground]);
  assert.equal(attempts, 2, 'the background reconciliation reaches absence');
  assert.equal(coordinator._startupCleanupError, null);
  assert.equal(rows.length, 1, 'successful convergence does not duplicate the pending fact');
});

test('542-b: a named live owner remains a fail-closed startup error', async () => {
  const rows = [];
  const coordinator = {
    _closed: false,
    _startupCleanupError: null,
    _startupCleanupPending: 0,
    _startupCleanupPromises: [],
    _startupCleanupBackground: new Set(),
    _startupCleanupIncomplete(error, reconciler) {
      return Object.assign(new Error('startup refused'), {
        code: 'coordinator_cleanup_incomplete', cause: error, reconciler,
      });
    },
    _setTimeout() { throw new Error('a live-owner failure must not schedule scratch cleanup'); },
  };
  const recorder = { recordDriver: (...args) => rows.push(args) };

  await _trackStartupCleanup(coordinator, recorder, () => {
    throw Object.assign(new Error('runtime owner is alive'), {
      code: 'runtime_cleanup_failed', record: 'w-live', observed: { alive: true, pid: 4242 },
    });
  }, 'worker_processes');

  assert.equal(coordinator._startupCleanupError?.code, 'coordinator_cleanup_incomplete');
  assert.equal(coordinator._startupCleanupError?.reconciler, 'worker_processes');
  assert.equal(rows.length, 0, 'a live-owner refusal is not mislabeled as scratch cleanup pending');
});
