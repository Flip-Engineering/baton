// workspace-snapshot.mjs test suite.
// All tests run against REAL temporary git repositories (git init + a base commit,
// created inline in each test) — no mocking of git itself, per spec §3 — because the
// primitive's entire safety claim (isolated temp GIT_INDEX_FILE, no ref updates,
// byte-preserved real index) is only meaningful against a real git binary.
//
// Under test: snapshotWorkspace({worktree, baseSha, excludedPaths}) snapshots the
// VISIBLE work of an active worktree (staged + unstaged + untracked, repo ignores
// respected) into an immutable commit whose parent names the HEAD observed before
// capture — without touching HEAD, branch refs, real index bytes, or worktree files.
// Custody stays with the caller (retainCheckpoint); this module never updates refs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotWorkspace, WorkspaceSnapshotError } from '../src/workspace-snapshot.mjs';

// ---------- helpers ----------

function sh(cmd, args, cwd) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function shOk(cmd, args, cwd) {
  try { sh(cmd, args, cwd); return true; } catch { return false; }
}

/** A real git repo with one base commit (README.md + .gitignore). */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-snapshot-test-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Baton Test'], dir);
  writeFileSync(join(dir, 'README.md'), '# base\n');
  writeFileSync(join(dir, '.gitignore'), '*.log\n');
  sh('git', ['add', '-A'], dir);
  sh('git', ['commit', '-q', '-m', 'base'], dir);
  const baseSha = sh('git', ['rev-parse', 'HEAD'], dir);
  return { dir, baseSha };
}

function headSha(dir) { return sh('git', ['rev-parse', 'HEAD'], dir); }
function branchRef(dir) { return sh('git', ['symbolic-ref', 'HEAD'], dir); }
function status(dir) { return sh('git', ['status', '--porcelain'], dir); }
function indexBytes(dir) {
  return createHash('sha256').update(readFileSync(join(dir, '.git', 'index'))).digest('hex');
}
function treeOf(dir, sha) { return sh('git', ['rev-parse', `${sha}^{tree}`], dir); }
function parentOf(dir, sha) { return sh('git', ['show', '-s', '--format=%P', sha], dir); }
function blobAt(dir, sha, path) {
  // Raw, untrimmed: blob content is asserted byte-for-byte.
  return execFileSync('git', ['show', `${sha}:${path}`], { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
function inTree(dir, sha, path) { return shOk('git', ['cat-file', '-e', `${sha}:${path}`], dir); }

function liveSnapshotDirs() {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('baton-live-snapshot-'));
}

// ============================================================
// visible work: staged + unstaged + untracked, exact changedPaths
// ============================================================

test('snapshot records staged, unstaged, and untracked work at their visible versions with exact changedPaths', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // staged version of a.txt, then re-modified on disk: the visible (on-disk)
  // version is what a live snapshot records.
  writeFileSync(join(dir, 'a.txt'), 'staged line\n');
  sh('git', ['add', 'a.txt'], dir);
  writeFileSync(join(dir, 'a.txt'), 'staged line\nunstaged line\n');
  // unstaged-only edit
  writeFileSync(join(dir, 'README.md'), '# base\nedited\n');
  // untracked (not ignored)
  writeFileSync(join(dir, 'c.txt'), 'untracked\n');
  // ignored by the committed .gitignore: never visible work
  writeFileSync(join(dir, 'debug.log'), 'ignored\n');

  const statusBefore = status(dir);
  const indexBefore = indexBytes(dir);
  const result = await snapshotWorkspace({ worktree: dir, baseSha });

  assert.equal(result.snapshotted, true);
  assert.equal(result.baseSha, baseSha);
  assert.equal(sh('git', ['cat-file', '-t', result.sha], dir), 'commit');
  // EXACT changedPaths, from the immutable snapshot vs base — sorted, complete.
  assert.deepEqual(result.changedPaths, ['README.md', 'a.txt', 'c.txt']);

  assert.equal(blobAt(dir, result.sha, 'a.txt'), 'staged line\nunstaged line\n');
  assert.equal(blobAt(dir, result.sha, 'README.md'), '# base\nedited\n');
  assert.equal(blobAt(dir, result.sha, 'c.txt'), 'untracked\n');
  assert.equal(inTree(dir, result.sha, 'debug.log'), false, 'ignored files are not visible work');

  // no live-state side effects
  assert.equal(status(dir), statusBefore);
  assert.equal(indexBytes(dir), indexBefore);
  assert.equal(headSha(dir), baseSha);
});

// ============================================================
// real index preservation across a partial stage
// ============================================================

test('prior staged partial content survives and real index bytes are preserved exactly', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  writeFileSync(join(dir, 'a.txt'), 'line one\nline two\n');
  sh('git', ['add', 'a.txt'], dir); // partial content staged...
  writeFileSync(join(dir, 'a.txt'), 'line one\nline two\nline three\n'); // ...then extended

  const indexBefore = indexBytes(dir);
  const stagedRowsBefore = sh('git', ['ls-files', '-s', 'a.txt'], dir);
  const result = await snapshotWorkspace({ worktree: dir, baseSha });

  assert.equal(indexBytes(dir), indexBefore, 'real index bytes are byte-identical after capture');
  assert.equal(sh('git', ['ls-files', '-s', 'a.txt'], dir), stagedRowsBefore, 'staged blob/mode row unchanged');
  // The snapshot carries the VISIBLE on-disk version; the real index still holds
  // the staged partial content — the primitive staged the visible tree, it did not
  // rewrite the caller's staging decisions.
  assert.equal(blobAt(dir, result.sha, 'a.txt'), 'line one\nline two\nline three\n');
  const stagedBlob = stagedRowsBefore.split(' ')[1];
  assert.ok(sh('git', ['diff', '--cached', '--name-only'], dir).includes('a.txt'), 'staged state is still staged');
  assert.equal(sh('git', ['cat-file', '-t', stagedBlob], dir), 'blob');
});

// ============================================================
// HEAD / branch / worktree immutability, parent names observed HEAD
// ============================================================

test('snapshot leaves HEAD, branch refs, and worktree files untouched and names the observed HEAD as parent', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  sh('git', ['branch', 'feature'], dir); // a second ref that must not move either
  writeFileSync(join(dir, 'w.txt'), 'live work\n');

  const before = { head: headSha(dir), branch: branchRef(dir), feature: sh('git', ['rev-parse', 'feature'], dir) };
  const result = await snapshotWorkspace({ worktree: dir, baseSha });

  assert.equal(headSha(dir), before.head, 'HEAD unchanged');
  assert.equal(branchRef(dir), before.branch, 'current branch unchanged');
  assert.equal(sh('git', ['rev-parse', 'feature'], dir), before.feature, 'other branch refs unchanged');
  assert.equal(parentOf(dir, result.sha), before.head, 'snapshot parent names the actual HEAD observed before capture');
  assert.notEqual(result.sha, before.head, 'snapshot is a new immutable commit, not a ref move');
  assert.equal(sh('git', ['branch', '--contains', result.sha], dir), '', 'snapshot is reachable from no branch (custody is the caller\'s job)');
  assert.ok(existsSync(join(dir, 'w.txt')), 'worktree files untouched');
});

// ============================================================
// excluded projected toolchain paths
// ============================================================

test('untracked projected toolchain paths are excluded from the snapshot but left on disk', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, 'proj', 'toolchain'), { recursive: true });
  writeFileSync(join(dir, 'proj', 'toolchain', 'bin'), 'projected toolchain bytes\n');
  writeFileSync(join(dir, 'real.txt'), 'real work\n');

  const result = await snapshotWorkspace({ worktree: dir, baseSha, excludedPaths: ['proj/toolchain'] });

  assert.deepEqual(result.changedPaths, ['real.txt'], 'excluded projection does not appear in changedPaths');
  assert.equal(inTree(dir, result.sha, 'proj/toolchain/bin'), false, 'projection is not in the snapshot tree');
  assert.ok(existsSync(join(dir, 'proj', 'toolchain', 'bin')), 'projection is still on disk (worktree untouched)');
  assert.equal(blobAt(dir, result.sha, 'real.txt'), 'real work\n');
});

test('a force-tracked projection path refuses the snapshot before any git mutation', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, 'proj', 'toolchain'), { recursive: true });
  writeFileSync(join(dir, 'proj', 'toolchain', 'bin'), 'force-added projection\n');
  sh('git', ['add', '-f', 'proj/toolchain/bin'], dir);

  const indexBefore = indexBytes(dir);
  const headBefore = headSha(dir);
  await assert.rejects(
    () => snapshotWorkspace({ worktree: dir, baseSha, excludedPaths: ['proj/toolchain'] }),
    (error) => error instanceof WorkspaceSnapshotError && error.code === 'workspace_snapshot_projection_tracked',
  );
  assert.equal(indexBytes(dir), indexBefore, 'refusal leaves the real index untouched');
  assert.equal(headSha(dir), headBefore, 'refusal leaves HEAD untouched');
  assert.equal(liveSnapshotDirs().length, 0, 'refusal happens before any temporary index is created');
});

// ============================================================
// no-change tree
// ============================================================

test('a no-change worktree still snapshots, with an empty changedPaths and the base tree', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = await snapshotWorkspace({ worktree: dir, baseSha });

  assert.equal(result.snapshotted, true);
  assert.deepEqual(result.changedPaths, []);
  assert.equal(treeOf(dir, result.sha), treeOf(dir, baseSha), 'snapshot tree equals the base tree when nothing is visible');
  assert.equal(parentOf(dir, result.sha), baseSha);
  assert.equal(sh('git', ['cat-file', '-t', result.sha], dir), 'commit');
});

// ============================================================
// validation refusals before git mutation
// ============================================================

test('missing or invalid base is rejected without touching the repo', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'w.txt'), 'work\n');

  const treeSha = treeOf(dir, baseSha); // valid object, but not a commit
  const indexBefore = indexBytes(dir);
  for (const bad of ['deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', treeSha, 'not-a-ref']) {
    await assert.rejects(
      () => snapshotWorkspace({ worktree: dir, baseSha: bad }),
      (error) => error instanceof WorkspaceSnapshotError && error.code === 'workspace_snapshot_invalid_base',
      `expected invalid_base refusal for ${bad}`,
    );
  }
  await assert.rejects(
    () => snapshotWorkspace({ worktree: dir, baseSha: undefined }),
    TypeError,
  );
  assert.equal(headSha(dir), baseSha);
  assert.equal(indexBytes(dir), indexBefore);
});

test('non-worktree paths are rejected', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // A plain directory that merely SITS INSIDE some outer git repository must still
  // be refused: the snapshot authority is the named worktree root, not whatever
  // repo git finds by walking upward.
  const plain = mkdtempSync(join(tmpdir(), 'baton-snapshot-nongit-'));
  t.after(() => rmSync(plain, { recursive: true, force: true }));

  for (const bad of [join(dir, '.git'), plain, join(dir, 'does-not-exist')]) {
    await assert.rejects(
      () => snapshotWorkspace({ worktree: bad, baseSha }),
      (error) => error instanceof WorkspaceSnapshotError && error.code === 'workspace_snapshot_invalid_worktree',
      `expected invalid_worktree refusal for ${bad}`,
    );
  }
  await assert.rejects(() => snapshotWorkspace({ worktree: 42, baseSha }), TypeError);
  // The real worktree itself keeps working.
  const result = await snapshotWorkspace({ worktree: dir, baseSha });
  assert.equal(result.snapshotted, true);
});

test('unsafe excluded paths are rejected before any git mutation', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const indexBefore = indexBytes(dir);

  const unsafe = ['/etc/passwd', '../escape.txt', 'a/../b', 'a//b', './x', '.', '.git/config', 'sub/.git/x', 'trail/', 42, 'bad\0nul'];
  for (const bad of unsafe) {
    await assert.rejects(
      () => snapshotWorkspace({ worktree: dir, baseSha, excludedPaths: [bad] }),
      (error) => error instanceof WorkspaceSnapshotError && error.code === 'workspace_snapshot_invalid_exclusion',
      `expected invalid_exclusion refusal for ${JSON.stringify(bad)}`,
    );
  }
  await assert.rejects(() => snapshotWorkspace({ worktree: dir, baseSha, excludedPaths: 'not-an-array' }), TypeError);
  await snapshotWorkspace({ worktree: dir, baseSha, excludedPaths: new Array(1025).fill('x') });
  assert.equal(indexBytes(dir), indexBefore);
  assert.equal(liveSnapshotDirs().length, 0);
});

// ============================================================
// paths with spaces
// ============================================================

test('paths with spaces are snapshotted exactly', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, 'my notes'), { recursive: true });
  writeFileSync(join(dir, 'my notes', 'final draft.txt'), 'draft one\n');
  sh('git', ['add', 'my notes'], dir);
  writeFileSync(join(dir, 'my notes', 'final draft.txt'), 'draft one\ndraft two\n');
  mkdirSync(join(dir, 'scratch pad'), { recursive: true });
  writeFileSync(join(dir, 'scratch pad', 'idea two.md'), 'untracked with spaces\n');

  const result = await snapshotWorkspace({ worktree: dir, baseSha });

  assert.deepEqual(result.changedPaths, ['my notes/final draft.txt', 'scratch pad/idea two.md']);
  assert.equal(blobAt(dir, result.sha, 'my notes/final draft.txt'), 'draft one\ndraft two\n');
  assert.equal(blobAt(dir, result.sha, 'scratch pad/idea two.md'), 'untracked with spaces\n');
});

// ============================================================
// failure cleanup
// ============================================================

test('a git failure mid-capture leaves no temporary index behind', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'w.txt'), 'work\n');
  assert.equal(liveSnapshotDirs().length, 0);

  // Corrupt the real index: the copy succeeds, then `git add -A` fails parsing it —
  // a failure that happens strictly after the temporary index was created.
  writeFileSync(join(dir, '.git', 'index'), Buffer.from('this is not an index file\n'));

  await assert.rejects(
    () => snapshotWorkspace({ worktree: dir, baseSha }),
    (error) => error instanceof WorkspaceSnapshotError && error.code === 'workspace_snapshot_failed',
  );
  assert.equal(liveSnapshotDirs().length, 0, 'the temporary index and excludes file are cleaned on the failure path');
});

// ============================================================
// sparse checkout: non-visible tracked files are not deletions
// ============================================================

test('a sparse checkout worktree does not misrecord non-materialized tracked files as deletions', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  mkdirSync(join(dir, 'out'), { recursive: true });
  writeFileSync(join(dir, 'out', 'o.txt'), 'outside cone\n');
  sh('git', ['add', '-A'], dir);
  sh('git', ['commit', '-q', '-m', 'two dirs'], dir);
  const secondBase = headSha(dir);

  sh('git', ['sparse-checkout', 'init', '--cone'], dir);
  sh('git', ['sparse-checkout', 'set', 'my notes'], dir);
  mkdirSync(join(dir, 'my notes'), { recursive: true });
  writeFileSync(join(dir, 'my notes', 'k.txt'), 'inside cone\n');
  writeFileSync(join(dir, 'untracked.txt'), 'also visible\n');

  const result = await snapshotWorkspace({ worktree: dir, baseSha: secondBase });

  assert.deepEqual(result.changedPaths, ['my notes/k.txt', 'untracked.txt'],
    'non-materialized out/o.txt is neither a change nor a deletion');
  assert.equal(inTree(dir, result.sha, 'out/o.txt'), true, 'non-visible tracked file stays in the snapshot at its base state');
  assert.equal(blobAt(dir, result.sha, 'out/o.txt'), 'outside cone\n');
});

// ============================================================
// credentials/private runtime: configured excludesFile is preserved
// ============================================================

test('a repo-configured core.excludesFile keeps ignoring private runtime files in the snapshot', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  // Private runtime patterns live in a configured excludes file OUTSIDE the
  // checkout (mirroring Baton's .baton/ runtime state).
  const outside = mkdtempSync(join(tmpdir(), 'baton-snapshot-excludes-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'private-excludes'), 'secret-*.key\n.env*\n');
  sh('git', ['config', 'core.excludesFile', join(outside, 'private-excludes')], dir);
  writeFileSync(join(dir, 'secret-api.key'), 'credential material\n');
  writeFileSync(join(dir, '.env.runtime'), 'private\n');
  writeFileSync(join(dir, 'code.txt'), 'visible\n');

  const result = await snapshotWorkspace({ worktree: dir, baseSha });

  assert.deepEqual(result.changedPaths, ['code.txt']);
  assert.equal(inTree(dir, result.sha, 'secret-api.key'), false, 'credentials never enter the snapshot');
  assert.equal(inTree(dir, result.sha, '.env.runtime'), false, 'private runtime never enters the snapshot');
});

test('literal exclusions preserve neighboring filenames and changedPaths preserves leading whitespace', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, ' leading.txt'), 'visible\n');
  writeFileSync(join(dir, 'dep*.txt'), 'generated\n');
  writeFileSync(join(dir, 'departure.txt'), 'source\n');
  const result = await snapshotWorkspace({ worktree: dir, baseSha, excludedPaths: ['dep*.txt'] });
  assert.deepEqual(result.changedPaths, [' leading.txt', 'departure.txt']);
  assert.equal(inTree(dir, result.sha, 'dep*.txt'), false);
  assert.equal(blobAt(dir, result.sha, 'departure.txt'), 'source\n');
});

test('a split index snapshots without rewriting its source index', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  sh('git', ['update-index', '--split-index'], dir);
  writeFileSync(join(dir, 'README.md'), 'live edit\n');
  const before = indexBytes(dir);
  const result = await snapshotWorkspace({ worktree: dir, baseSha });
  assert.equal(indexBytes(dir), before);
  assert.equal(blobAt(dir, result.sha, 'README.md'), 'live edit\n');
});

test('assume-unchanged is not a reason to omit a visible tracked edit', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  sh('git', ['update-index', '--assume-unchanged', 'README.md'], dir);
  writeFileSync(join(dir, 'README.md'), 'visible despite index flag\n');
  const before = indexBytes(dir);
  const result = await snapshotWorkspace({ worktree: dir, baseSha });
  assert.equal(indexBytes(dir), before);
  assert.equal(blobAt(dir, result.sha, 'README.md'), 'visible despite index flag\n');
});
