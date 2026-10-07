import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, lstatSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { examineQuerySource, prepareQueryArtifact } from './context-query-artifact.mjs';

function worktree(t) {
  const path = mkdtempSync(join(tmpdir(), 'baton-query-artifact-'));
  execFileSync('git', ['init', '-q', path]);
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

test('prepares a private owner-bound artifact directory and replays its exact identity', (t) => {
  const root = worktree(t);
  const authority = { owner: 'owner-1', worktree: root, query: 'query/1' };
  const first = prepareQueryArtifact(authority);
  assert.equal(first.status, 'prepared');
  assert.equal(lstatSync(first.path).mode & 0o777, 0o700);
  assert.equal(lstatSync(first.identityPath).mode & 0o777, 0o600);
  assert.deepEqual(prepareQueryArtifact(authority), first);
  assert.equal(prepareQueryArtifact({ ...authority, owner: 'owner-2' }).reason, 'queryArtifactIdentityMismatch');
  assert.equal(prepareQueryArtifact({ ...authority, query: 'query/2' }).status, 'prepared');
});

test('refuses a symlinked or accessible artifact parent', (t) => {
  const root = worktree(t);
  mkdirSync(join(root, '.baton'));
  chmodSync(join(root, '.baton'), 0o700);
  symlinkSync(tmpdir(), join(root, '.baton', 'context-artifacts'));
  assert.equal(prepareQueryArtifact({ owner: 'owner', worktree: root, query: 'query' }).reason,
    'queryArtifactDirectoryInvalid');
});

test('refuses a non-worktree root and empty authority fields', () => {
  assert.equal(prepareQueryArtifact({ owner: '', worktree: '/', query: 'query' }).reason,
    'queryArtifactAuthorityMissing');
});

test('examines a regular source path under the authenticated worktree without reading it', (t) => {
  const root = worktree(t);
  writeFileSync(join(root, 'input.bend'), 'module Input\n');
  const result = examineQuerySource({ owner: 'owner', worktree: root, cwd: root, path: 'input.bend' });
  assert.equal(result.status, 'examined');
  assert.equal(result.identity, join(root, 'input.bend'));
  assert.equal(result.readSet.fileCount, 0);
});

test('source examination refuses missing paths and paths that resolve outside the worktree', (t) => {
  const root = worktree(t);
  assert.equal(examineQuerySource({ owner: 'owner', worktree: root, cwd: root, path: 'missing.bend' }).reason,
    'querySourceUnavailable');
  assert.equal(examineQuerySource({ owner: 'owner', worktree: root, cwd: root, path: '../outside.bend' }).reason,
    'querySourceUnavailable');
});
