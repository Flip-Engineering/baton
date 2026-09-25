// Issue #434: master could not serve after the #351 lane 3 landing. createDriver opened the
// coordination store DEFERRED and started the chunked replay, then constructed the Coordinator
// synchronously — whose constructor reads the projection (snapshot, task seeding, plan-node
// settlement, worker-log replay) and APPENDS settle rows. On a ledger with unsettled plan-node
// tasks the append ran before the load finished (TypeError reading 'update' on the ledger hash)
// and the rows it did write carried a partial-projection seq, leaving a sequence gap behind.
//
// Pinned here, red at HEAD before the fix:
//   (a) on the async-open path the Coordinator reads NO projection before the replay resolves —
//       the store's snapshot() is not called synchronously by createDriver, and the startup
//       reconstruction runs exactly once, after coordinationOpened resolves;
//   (b) an append on a deferred store whose load has not resolved refuses typed
//       (coordination_store_loading), never a bare TypeError;
//   (c) after the replay resolves the deferred flag is cleared, so the ledger/projection
//       equality check and appends are live again (a plain append succeeds).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { CoordinationStore, loadCoordinationStoreAsync } from '../src/coordination-store.mjs';
import { createDriver } from '../src/index.mjs';

const roots = [];
function temp(label) {
  const root = mkdtempSync(join(tmpdir(), `baton-issue434-${label}-`));
  roots.push(root);
  return root;
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function repository() {
  const root = temp('repo');
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'issue434@example.com']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'issue434']);
  execFileSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'seed']);
  return root;
}

test('434-a: the async open reads no projection before the replay resolves, then reconstructs once', async () => {
  const repo = repository();
  const logDir = join(temp('log'), 'state');
  mkdirSync(logDir, { recursive: true });
  const snapshotCalls = [];
  const original = CoordinationStore.prototype.snapshot;
  CoordinationStore.prototype.snapshot = function patched(...args) {
    snapshotCalls.push(new Error('snapshot').stack.split('\n').slice(1, 6).join(' | '));
    return original.apply(this, args);
  };
  let driver;
  try {
    driver = createDriver({
      repoRoot: repo, repoId: 'issue434-repo', logDir, adapters: {}, coordinationAsyncOpen: true,
    });
    const before = snapshotCalls.length;
    assert.equal(before, 0,
      `createDriver read the projection synchronously on the async-open path (${before} snapshot call(s)):\n${snapshotCalls.join('\n')}`);
    assert.ok(driver.coordinationOpened, 'the async-open path exposes coordinationOpened');
    assert.equal(driver.coordinator._startupReconstructionPending, true,
      'the coordinator defers its projection-derived startup until the replay resolves');
    await driver.coordinationOpened;
    assert.equal(driver.coordinator._startupReconstructionPending, false, 'the reconstruction ran once the replay resolved');
    assert.ok(snapshotCalls.length >= 1, 'the reconstruction read the loaded projection');
    assert.equal(driver.coordinator.completeDeferredStartup(), false, 'a second completion is a no-op receipt');
    assert.equal(driver.coordination._deferredLoad, false, 'the deferred flag clears once the replay resolves');
  } finally {
    CoordinationStore.prototype.snapshot = original;
    await driver?.coordinator?.close?.();
  }
});

test('434-b: an append on a deferred store whose load has not resolved refuses typed', async () => {
  const root = join(temp('store'), 'coordination');
  const store = new CoordinationStore(root, { deferLoad: true });
  store.claimWriterLease();
  assert.throws(
    () => store._append('driver.recorded', { kind: 'issue434.probe' }, { actor: 'issue434', key: 'issue434:early' }),
    (error) => {
      assert.equal(error.code, 'coordination_store_loading', `typed, never a bare TypeError: ${error.message}`);
      assert.match(error.message, /loadCoordinationStoreAsync/u, 'the refusal names the completion it waits on');
      return true;
    },
  );
  await loadCoordinationStoreAsync(store);
  assert.equal(store._deferredLoad, false, '434-c: the flag clears after the replay');
  const record = store.recordSwarm ? null : null; // no swarm fixture needed: a plain append proves admission
  void record;
  assert.doesNotThrow(() => store._append('driver.recorded', { kind: 'issue434.probe' }, { actor: 'issue434', key: 'issue434:late' }),
    '434-c: a plain append after the replay is admitted');
  store.releaseWriterLease?.();
});
