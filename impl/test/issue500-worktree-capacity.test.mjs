import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import test from 'node:test';

import {
  WorkspaceOwnerDiagnostic, allocatePhysicalWorkspaceOwner, normalizePhysicalOwnerId,
  normalizeSparsePaths, physicalWorkspaceOwnerReceipt, validateToolchainProjectionMetadata,
} from '../src/worktree.mjs';

// Issue #500 — the worktree disk, path and identity bounds carried no cited derivation. Each is
// operator-declared: no file in the repository derives the number (see the #500 comments in
// worktree.mjs). These rows pin the live value of each bound at its boundary and the refusal the
// reader raises past it. No value or behavior changes here: a record exactly at a bound is read,
// one byte (or path, or segment) past it refuses.
//
// #530 removed the four sparse-checkout bounds — the path count, the path byte length, the segment
// depth and the aggregate byte ceiling — so 500-cap-a measures their absence: a set is admitted for
// its shape at any size, and the shape refusals the reader shares
// still refuse a path that is not a safe relative literal, a path that escapes the repository, and
// a duplicate or overlapping set.

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-500-cap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue500@example.invalid', GIT_COMMITTER_EMAIL: 'issue500@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 500', GIT_COMMITTER_NAME: 'Issue 500' });
  execFileSync('git', ['commit', '-qm', 'issue 500 capacity fixture', '--allow-empty'], { cwd: root });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  return { root, sha };
}

/** The receipt lives under the repository's own `baton/workspace-owners`, keyed off the git
 * common dir (worktree.mjs workspaceOwnerRoot), not off the repo's working tree. */
function ownerReceiptPath(root, physicalOwnerId) {
  const raw = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const common = isAbsolute(raw) ? raw : join(root, raw);
  return join(realpathSync(common), 'baton', 'workspace-owners', `${physicalOwnerId}.json`);
}

function privateFile(path, text) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

test('500-cap-a: the sparse checkout path family carries no count, path-byte, depth or aggregate bound', () => {
  const paths = Array.from({ length: 1_025 }, (_, index) => `p${index}`);
  assert.equal(normalizeSparsePaths(paths).length, 1_025, 'a 1 025-path set is admitted');

  const longPath = 'a'.repeat(2_049);
  assert.deepEqual(normalizeSparsePaths([longPath]), [longPath], 'a 2 049-byte path is admitted');

  const deep = Array.from({ length: 65 }, () => 'd').join('/');
  assert.deepEqual(normalizeSparsePaths([deep]), [deep], 'a 65-segment path is admitted');

  // 129 paths of 2 048 bytes are 264 192 bytes, past the 256 KiB aggregate ceiling #530 removed.
  const wide = (index) => `${'a'.repeat(2040)}${String(index).padStart(8, '0')}`;
  const aggregate = Array.from({ length: 129 }, (_, index) => wide(index));
  assert.equal(normalizeSparsePaths(aggregate).length, 129, 'a set summing past 256 KiB is admitted');

  assert.throws(() => normalizeSparsePaths(['a path with spaces']), /safe relative literal/u,
    'a path that is not a safe relative literal still refuses');
  assert.throws(() => normalizeSparsePaths(['../escape']), /escapes repository/u,
    'a path that escapes the repository still refuses');
  assert.throws(() => normalizeSparsePaths(['p0', 'p0']), /unique and non-overlapping/u,
    'a duplicate set still refuses');
});

test('500-cap-b: one physical owner id is bounded at 128 B', () => {
  const atBound = 'a'.repeat(128);
  assert.equal(normalizePhysicalOwnerId(atBound), atBound, '128 bytes are admitted');
  assert.throws(() => normalizePhysicalOwnerId('a'.repeat(129)), { name: 'TypeError' },
    'a 129th byte refuses as more than one bounded path and ref component');
});

test('500-cap-c: the lane metadata reader admits 1 MiB and reads one byte over as absent', (t) => {
  const { root } = repository(t);
  mkdirSync(join(root, '.baton', 'wt'), { recursive: true, mode: 0o700 });
  const file = join(root, '.baton', 'wt', 'lane.meta.json');
  const body = JSON.stringify({ toolchainProjection: { a: 1 }, toolchainProjectionTargets: ['x'] });
  const padded = (bytes) => body + ' '.repeat(bytes - body.length);

  privateFile(file, padded(1024 * 1024));
  assert.equal(validateToolchainProjectionMetadata(root, 'lane', { a: 1 }), true,
    'a metadata record at the 1 MiB bound is read');
  privateFile(file, padded(1024 * 1024 + 1));
  assert.equal(validateToolchainProjectionMetadata(root, 'lane', { a: 1 }), false,
    'a metadata record one byte over the bound reads as absent');
});

test('500-cap-d: an owner receipt at 64 KiB is read and one byte over is refused as unsafe', (t) => {
  const { root, sha } = repository(t);
  const authority = {
    controllerId: 'c'.repeat(64), deploymentId: 'd'.repeat(64), pid: process.pid, pidStart: 'start',
  };
  const owner = allocatePhysicalWorkspaceOwner(root, {
    attemptId: 'attempt-1', baseSha: sha, logicalTaskId: 'lane', processGeneration: 1, runId: 'run-1',
  }, authority);
  const file = ownerReceiptPath(root, owner.physicalOwnerId);
  const receipt = readFileSync(file, 'utf8');
  const atBound = receipt + ' '.repeat((64 * 1024) - Buffer.byteLength(receipt));

  privateFile(file, atBound);
  assert.equal(physicalWorkspaceOwnerReceipt(root, owner.physicalOwnerId).physicalOwnerId,
    owner.physicalOwnerId, 'a receipt exactly at the 64 KiB bound is admitted');
  privateFile(file, `${atBound} `);
  assert.throws(() => physicalWorkspaceOwnerReceipt(root, owner.physicalOwnerId), (error) => {
    assert.ok(error instanceof WorkspaceOwnerDiagnostic, 'the over-bound receipt refuses typed');
    assert.equal(error.code, 'workspace_owner_receipt_invalid');
    assert.match(error.message, /unsafe/u, 'the refusal is the size guard, not the field check');
    return true;
  });
});

test('500-cap-e: the owner-text identity default admits 4 096 bytes and refuses 4 097', (t) => {
  const { root, sha } = repository(t);
  const authority = {
    controllerId: 'c'.repeat(64), deploymentId: 'd'.repeat(64), pid: process.pid, pidStart: 'start',
  };
  const admitted = allocatePhysicalWorkspaceOwner(root, {
    attemptId: 'attempt-1', baseSha: sha, logicalTaskId: 'x'.repeat(4096), processGeneration: 1, runId: null,
  }, authority);
  assert.equal(Buffer.byteLength(admitted.logicalTaskId), 4096, 'a 4 096-byte logical task id is admitted');
  assert.throws(() => allocatePhysicalWorkspaceOwner(root, {
    attemptId: 'attempt-2', baseSha: sha, logicalTaskId: 'x'.repeat(4097), processGeneration: 1, runId: null,
  }, authority), { name: 'TypeError' }, 'a 4 097-byte logical task id refuses the binding');
});