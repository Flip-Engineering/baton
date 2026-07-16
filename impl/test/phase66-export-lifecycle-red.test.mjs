// Phase 66 CE13-CE18 acceptance-red tests. These deliberately pin the lifecycle seams that the
// original CE10 prose left implicit. They should fail because the seams are absent, never because
// of sleeps, process timing, or an uncontrolled filesystem race.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { acquireResultExportRootLease, materializeResultTree, ResultExportLifecycle } from '../src/result-export.mjs';

const POLICY = Object.freeze({ format: 'directory-v1', maxFiles: 32, maxBytes: 1024 * 1024 });
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalDigest = (value) => sha256(JSON.stringify(canonical(value)));

function temporary(t, label) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), `baton-export-lifecycle-${label}-`)));
  t.after(() => {
    try { chmodSync(path, 0o700); } catch {}
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}

function repository(t, label) {
  const repo = temporary(t, `${label}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'phase66@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Phase 66'], { cwd: repo });
  writeFileSync(join(repo, 'accepted.txt'), 'accepted result\n');
  execFileSync('git', ['add', '--all'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'accepted result'], { cwd: repo });
  return {
    repo,
    resultSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  };
}

function materializationArguments(t, label, overrides = {}) {
  const { repo, resultSha } = repository(t, label);
  const exportRoot = temporary(t, `${label}-exports`);
  chmodSync(exportRoot, 0o700);
  const exportId = sha256(`phase66-lifecycle:${label}`);
  const stagingNonce = randomUUID();
  return {
    repoRoot: repo,
    exportRoot,
    exportId,
    stagingNonce,
    resultSha,
    manifestCore: {
      repoId: 'repo-phase66-lifecycle',
      runId: `run-${label}`,
      nodeKey: 'work',
      taskId: `task-${label}`,
      resultSha,
      evidenceDigest: 'a'.repeat(64),
      profileDigest: 'b'.repeat(64),
      exportPolicyDigest: 'c'.repeat(64),
      goal: { id: `goal-${label}`, version: 1, digest: 'd'.repeat(64) },
      plan: {
        id: `plan-${label}`, version: 1, digest: 'e'.repeat(64),
        approvalDigest: 'f'.repeat(64),
      },
      adoptionReceiptDigest: '1'.repeat(64),
      semanticReviewReceiptDigest: null,
      integrationAfterSha: null,
    },
    policy: POLICY,
    ...overrides,
  };
}

test('CE13/CE14 RED: materialization delegates its final boundary to atomic no-replace publication', (t) => {
  let publicationCalls = 0;
  let observedTemporary = null;
  const args = materializationArguments(t, 'no-replace', {
    publishNoReplace({ root, temporary, final, exportId }) {
      publicationCalls += 1;
      observedTemporary = temporary;
      assert.equal(root, args.exportRoot);
      assert.equal(final, join(args.exportRoot, args.exportId));
      assert.equal(exportId, args.exportId);
      assert.equal(basename(temporary), `.tmp-${args.exportId}-${args.stagingNonce}`);

      // Deterministically create the race loser at the exact publication boundary. It is empty on
      // purpose: ordinary POSIX rename may replace an empty directory, while rename-no-replace may
      // not replace any occupied name.
      mkdirSync(final, { mode: 0o700 });
      const occupied = new Error('destination already exists');
      occupied.code = 'EEXIST';
      throw occupied;
    },
  });

  assert.throws(() => materializeResultTree(args), (error) =>
    error?.code === 'result_export_output_mismatch',
  'an occupied final must be verified and refused, never replaced');

  assert.equal(publicationCalls, 1, 'the materializer bypassed the required no-replace seam');
  assert.deepEqual(readdirSync(join(args.exportRoot, args.exportId)), [],
    'the empty race-winning destination was replaced by the completed export');
  assert.equal(observedTemporary === null || existsSync(observedTemporary), false,
    'the exact lifecycle-owned losing temporary was not reaped');
});

test('CE13: one exact deployment lease excludes a second owner and clean release permits restart', (t) => {
  const exportRoot = temporary(t, 'root-lease');
  chmodSync(exportRoot, 0o700);
  const first = acquireResultExportRootLease(exportRoot);
  assert.equal(first.assertHeld(), true);
  assert.throws(() => acquireResultExportRootLease(exportRoot),
    (error) => error?.code === 'result_export_root_busy');
  assert.equal(first.release(), true);
  assert.deepEqual(readdirSync(exportRoot), []);
  const restarted = acquireResultExportRootLease(exportRoot);
  assert.equal(restarted.assertHeld(), true);
  assert.equal(restarted.release(), true);
});

test('lifecycle close drains an active rejection, excludes restart, and releases exactly once', async (t) => {
  const exportRoot = temporary(t, 'lifecycle-drain');
  chmodSync(exportRoot, 0o700);
  let releaseOperation;
  const operationGate = new Promise((resolve) => { releaseOperation = resolve; });
  let releases = 0;
  const lifecycle = new ResultExportLifecycle(exportRoot, {
    acquireLease: (root) => {
      const lease = acquireResultExportRootLease(root);
      return Object.freeze({
        ...lease,
        release: () => { releases += 1; return lease.release(); },
      });
    },
  });
  const active = lifecycle.materialize(async () => {
    await operationGate;
    throw Object.assign(new Error('materialization rejected'), { code: 'injected_rejection' });
  });
  const closing = lifecycle.close();
  assert.throws(() => lifecycle.materialize(() => null),
    (error) => error?.code === 'result_export_lifecycle_closed');
  assert.throws(() => acquireResultExportRootLease(exportRoot),
    (error) => error?.code === 'result_export_root_busy');
  assert.equal(releases, 0, 'the export-root lease was released while materialization was active');
  releaseOperation();
  await assert.rejects(active, (error) => error?.code === 'injected_rejection');
  await closing;
  assert.equal(releases, 1);
  await lifecycle.close();
  assert.equal(releases, 1, 'repeated close released the export-root lease again');
  const restarted = acquireResultExportRootLease(exportRoot);
  assert.equal(restarted.release(), true);
});

test('CE16 RED: startup reaps only nonce-bound staging and quarantines an unknown reserved entry', async (t) => {
  const exportsModule = await import('../src/result-export.mjs');
  assert.equal(typeof exportsModule.reconcileResultExportStaging, 'function',
    'RED-today: result-export has no startup staging reconciliation authority');

  const exportRoot = temporary(t, 'startup-reconcile');
  chmodSync(exportRoot, 0o700);
  const pendingId = sha256('pending-export');
  const cancelledId = sha256('cancelled-export');
  const unknownId = sha256('unknown-export');
  const pendingNonce = randomUUID();
  const cancelledNonce = randomUUID();
  const unknownNonce = randomUUID();
  const pendingName = `.tmp-${pendingId}-${pendingNonce}`;
  const cancelledName = `.tmp-${cancelledId}-${cancelledNonce}`;
  const unknownName = `.tmp-${unknownId}-${unknownNonce}`;

  for (const name of [pendingName, cancelledName, unknownName]) {
    mkdirSync(join(exportRoot, name), { mode: 0o700 });
    writeFileSync(join(exportRoot, name, 'partial'), name);
  }
  writeFileSync(join(exportRoot, 'operator-owned-note'), 'leave me alone\n');

  const first = exportsModule.reconcileResultExportStaging({
    exportRoot,
    exports: [
      { exportId: pendingId, status: 'pending', stagingNonce: pendingNonce },
      { exportId: cancelledId, status: 'cancelled', stagingNonce: cancelledNonce },
    ],
  });

  assert.deepEqual(first.removed.map((entry) => entry.name).sort(),
    [cancelledName, pendingName].sort());
  assert.deepEqual(first.quarantined.map((entry) => entry.name), [unknownName]);
  assert.equal(first.quarantined[0].reason, 'unbound_stage');
  assert.match(first.quarantined[0].quarantineName,
    /^\.quarantine-stage-[a-f0-9]{64}-[0-9a-f-]{36}$/u);
  assert.equal(existsSync(join(exportRoot, first.quarantined[0].quarantineName)), true);
  assert.equal(readFileSync(join(exportRoot, 'operator-owned-note'), 'utf8'), 'leave me alone\n');

  const second = exportsModule.reconcileResultExportStaging({
    exportRoot,
    exports: [
      { exportId: pendingId, status: 'pending', stagingNonce: pendingNonce },
      { exportId: cancelledId, status: 'cancelled', stagingNonce: cancelledNonce },
    ],
  });
  assert.deepEqual(second.removed, []);
  assert.deepEqual(second.quarantined, []);
  assert.equal(readdirSync(exportRoot).includes('operator-owned-note'), true);
  assert.equal(basename(first.quarantined[0].quarantineName), first.quarantined[0].quarantineName);
});

test('CE16: startup removes a completed stage only beside an exactly verified completed final', async (t) => {
  const exportsModule = await import('../src/result-export.mjs');
  const args = materializationArguments(t, 'completed-stage');
  const materialized = exportsModule.materializeResultTree(args);
  const core = {
    schemaVersion: 1, state: 'completed', format: 'directory-v1',
    runId: args.manifestCore.runId, nodeKey: args.manifestCore.nodeKey,
    resultSha: args.resultSha, evidenceDigest: args.manifestCore.evidenceDigest,
    exportId: args.exportId, locator: `export:${args.exportId}`,
    treeOid: materialized.treeOid, manifestDigest: materialized.manifestDigest,
    fileCount: materialized.fileCount, byteCount: materialized.byteCount,
    checks: { acceptedResultReverified: true, manifestVerified: true, treeExact: true },
    effects: { adopted: false, checkoutChanged: false, deployed: false, integrated: false, published: false },
  };
  const receipt = { ...core, receiptDigest: canonicalDigest(core) };
  const stageName = `.tmp-${args.exportId}-${args.stagingNonce}`;
  mkdirSync(join(args.exportRoot, stageName), { mode: 0o700 });
  writeFileSync(join(args.exportRoot, stageName, 'partial'), 'crash residue\n');

  const result = exportsModule.reconcileResultExportStaging({
    exportRoot: args.exportRoot,
    exports: [{ exportId: args.exportId, status: 'completed', stagingNonce: args.stagingNonce, receipt }],
  });
  assert.deepEqual(result.removed, [{ name: stageName, reason: 'completed_stage' }]);
  assert.equal(existsSync(join(args.exportRoot, args.exportId)), true);
});

test('CE16: malformed and unsafe reserved stages are quarantined or retained without traversal', async (t) => {
  const exportsModule = await import('../src/result-export.mjs');
  const exportRoot = temporary(t, 'malformed-stage');
  chmodSync(exportRoot, 0o700);
  const malformed = '.tmp-malformed-operator-entry';
  mkdirSync(join(exportRoot, malformed), { mode: 0o700 });
  writeFileSync(join(exportRoot, malformed, 'payload'), 'retain through quarantine\n');
  const linkedId = sha256('linked-stage');
  const linkedName = `.tmp-${linkedId}-${randomUUID()}`;
  symlinkSync('/private/tmp', join(exportRoot, linkedName));

  const result = exportsModule.reconcileResultExportStaging({ exportRoot, exports: [] });
  assert.deepEqual(result.examined.map((entry) => entry.name), [malformed, linkedName].sort());
  assert.deepEqual(result.quarantined.map((entry) => [entry.name, entry.reason]), [
    [malformed, 'malformed_stage'],
  ]);
  assert.deepEqual(result.retained, [{ name: linkedName, reason: 'unproved_stage' }]);
  assert.equal(existsSync(join(exportRoot, malformed)), false);
  assert.equal(existsSync(join(exportRoot, linkedName)), true);
});
