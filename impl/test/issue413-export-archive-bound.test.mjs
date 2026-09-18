// Issue #413 red-first suite — export staging reconciliation re-derives completed-row archives
// with `maxArchiveBytes: Number.MAX_SAFE_INTEGER` (result-export.mjs, the reconcileResultExportStaging
// completed-stage branch), so a large completed stage allocates the whole archive with no
// deployment bound. Owed: the bound is the deployment's export policy read at that site (the
// policy's maxBytes/maxFiles rows plus the registry row bounding the manifest JSON); a stage
// above the bound is refused typed (`result_export_archive_oversize`) — quarantined for
// operator inspection, never re-derived whole and never removed as proved.
//
// Fixture mirrors phase66-export-lifecycle-red.test.mjs: a real materialized completed export
// (stage + exactly verified final + digest-pinned receipt), reconciled under a deployment
// export policy SMALLER than the one the export completed under — the restart-under-a-new-bound
// shape the finding names.

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import * as exportsModule from '../src/result-export.mjs';

const COMPLETED_UNDER = Object.freeze({ format: 'directory-v1', maxFiles: 32, maxBytes: 1024 * 1024 });
const SMALLER_DEPLOYMENT = Object.freeze({ format: 'directory-v1', maxFiles: 4, maxBytes: 64 * 1024 });

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalDigest = (value) => sha256(JSON.stringify(canonical(value)));

function temporary(t, label) {
  const path = realpathSync(mkdtempSync(join(tmpdir(), `baton-issue413-${label}-`)));
  t.after(() => {
    try { chmodSync(path, 0o700); } catch {}
    rmSync(path, { recursive: true, force: true });
  });
  return path;
}

function repository(t, label, acceptedBytes) {
  const repo = temporary(t, `${label}-repo`);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue413@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Issue 413'], { cwd: repo });
  writeFileSync(join(repo, 'accepted.txt'), `${'a'.repeat(acceptedBytes - 'accepted result\n'.length)}\n`);
  execFileSync('git', ['add', '--all'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'accepted result'], { cwd: repo });
  return {
    repo,
    resultSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  };
}

/** Materialize one completed export (stage residue + exactly verified final + pinned receipt),
 * mirroring the phase66 completed-stage fixture. */
function completedExport(t, label, acceptedBytes) {
  const { repo, resultSha } = repository(t, label, acceptedBytes);
  const exportRoot = temporary(t, `${label}-exports`);
  chmodSync(exportRoot, 0o700);
  const exportId = sha256(`issue413:${label}`);
  const stagingNonce = randomUUID();
  const materialized = exportsModule.materializeResultTree({
    repoRoot: repo,
    exportRoot,
    exportId,
    stagingNonce,
    resultSha,
    manifestCore: {
      repoId: 'repo-issue413',
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
    policy: COMPLETED_UNDER,
  });
  const core = {
    schemaVersion: 1, state: 'completed', format: 'directory-v1',
    runId: `run-${label}`, nodeKey: 'work',
    resultSha, evidenceDigest: 'a'.repeat(64),
    exportId, locator: `export:${exportId}`,
    treeOid: materialized.treeOid, manifestDigest: materialized.manifestDigest,
    fileCount: materialized.fileCount, byteCount: materialized.byteCount,
    checks: { acceptedResultReverified: true, manifestVerified: true, treeExact: true },
    effects: { adopted: false, checkoutChanged: false, deployed: false, integrated: false, published: false },
  };
  const receipt = { ...core, receiptDigest: canonicalDigest(core) };
  const stageName = `.tmp-${exportId}-${stagingNonce}`;
  mkdirSync(join(exportRoot, stageName), { mode: 0o700 });
  writeFileSync(join(exportRoot, stageName, 'partial'), 'crash residue\n');
  return {
    exportRoot, exportId, stagingNonce, receipt, stageName,
    row: { exportId, status: 'completed', stagingNonce, receipt },
  };
}

test('I413-1 RED: a completed stage whose archive exceeds the deployment export policy is quarantined unproved, never re-derived whole and removed', (t) => {
  // ~600 KiB of accepted content: inside the policy the export completed under, above the
  // archive ceiling the SMALLER deployment policy derives.
  const completed = completedExport(t, 'over-bound', 600 * 1024);

  const result = exportsModule.reconcileResultExportStaging({
    exportRoot: completed.exportRoot,
    exports: [completed.row],
    exportPolicy: SMALLER_DEPLOYMENT,
  });

  assert.deepEqual(result.removed, [],
    `an archive above the deployment bound is never re-derived whole and removed; today: ${JSON.stringify(result.removed)}`);
  assert.deepEqual(result.quarantined.map((row) => [row.name, row.reason]),
    [[completed.stageName, 'completed_stage_unproved']],
    'the over-bound stage is refused typed at the derive seam and isolated for operator inspection');
  assert.equal(existsSync(join(completed.exportRoot, completed.exportId)), true,
    'the exactly verified completed final is untouched');
});

test('I413-2: a completed stage inside the deployment export policy still reaps beside its proved final', (t) => {
  const completed = completedExport(t, 'in-bound', 4096);

  const result = exportsModule.reconcileResultExportStaging({
    exportRoot: completed.exportRoot,
    exports: [completed.row],
    exportPolicy: COMPLETED_UNDER,
  });

  assert.deepEqual(result.removed, [{ name: completed.stageName, reason: 'completed_stage' }]);
  assert.deepEqual(result.quarantined, []);
});

test('I413-3: the legacy no-policy callers stay working — the receipt bounds its own stage', (t) => {
  const completed = completedExport(t, 'legacy-caller', 4096);

  const result = exportsModule.reconcileResultExportStaging({
    exportRoot: completed.exportRoot,
    exports: [completed.row],
  });

  assert.deepEqual(result.removed, [{ name: completed.stageName, reason: 'completed_stage' }],
    'without an explicit policy the stage is bounded by its own policy-validated receipt rows');
});

test('I413-4 RED: the ONE deployment-derived archive ceiling is exported and registry-sourced', async () => {
  assert.equal(typeof exportsModule.resultExportArchiveCeiling, 'function',
    'RED-today: the deployment-derived archive ceiling is not exported from result-export.mjs');
  const { FRAME_LIMITS } = await import('../src/limits.mjs');
  const policy = { format: 'directory-v1', maxFiles: 4, maxBytes: 64 * 1024 };
  assert.equal(exportsModule.resultExportArchiveCeiling(policy),
    policy.maxBytes + FRAME_LIMITS['view.run.bytes'].value + ((policy.maxFiles + 1) * 1024),
    'the ceiling derives from the export policy rows plus the manifest-bounding registry row — never a hand-typed bound');
  assert.throws(() => exportsModule.resultExportArchiveCeiling({ format: 'directory-v1', maxFiles: 1, maxBytes: Number.NaN }),
    (error) => error?.code === 'result_export_invalid',
    'policy rows that derive a non-bounding value refuse typed');
});
