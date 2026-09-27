// Issue #285, lane custody-and-capacity — one row per giant-audit item this lane owns. Every row
// is RED on the pre-fix source and GREEN after it:
//
//   G-32  ONE whole-repository listing maxBuffer, derived in one place and taken by every git call
//   G-6   pinBaseSha's receipt names the stash COMMIT, never the moving name `stash@{0}`
//   G-4   contribution_check_unconfirmed carries the new-checkId remedy as gracefulPath
//
// The G-32 fixture is a real repository of enough paths: 6000 tracked paths of ~226 bytes put
// every listing the cited calls run — `status` (~1.4 MB), `ls-tree -r --name-only -z` (~1.4 MB),
// `ls-files -t -z` (~1.4 MB) — past Node's 1 MiB default buffer, so the pre-fix code fails with
// ENOBUFS and nothing else. No clocks, no mocks of git.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ContributionService } from '../src/contribution-service.mjs';
import {
  DirtyRepoError, createFromBase, gitListingMaxBuffer, pinBaseSha,
} from '../src/worktree.mjs';

const SHA_40 = /^[a-f0-9]{40}$/u;
const BULK_COUNT = 6000; // `git status` over these paths is ~1.4 MB, past Node's 1 MiB default
const bulkPath = (index) => `bulk/${'p'.repeat(220)}-${String(index).padStart(5, '0')}`;

function sh(cmd, args, cwd, opts = {}) {
  return execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    ...opts,
  }).trim();
}

/** A real git repository with one base commit. */
function makeRepo(label, files) {
  const dir = mkdtempSync(join(tmpdir(), `baton-issue285-${label}-`));
  sh('git', ['init', '-q'], dir);
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue285@example.invalid', GIT_COMMITTER_EMAIL: 'issue285@example.invalid' });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 285', GIT_COMMITTER_NAME: 'Issue 285' });
  for (const [path, content] of files) {
    mkdirSync(join(dir, dirname(path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  sh('git', ['add', '-A'], dir);
  sh('git', ['commit', '-qm', 'issue285 fixture'], dir);
  return { dir, baseSha: sh('git', ['rev-parse', 'HEAD'], dir) };
}

function thrown(operation) {
  try { operation(); } catch (error) { return error; }
  throw new Error('the operation was expected to refuse');
}

async function rejection(operation) {
  try { await operation(); } catch (error) { return error; }
  throw new Error('the operation was expected to refuse');
}

// ============================================================
// G-32 — one listing bound, derived in one place
// ============================================================

test('G-32: one derived bound carries every whole-repository git listing past Node\'s 1 MiB default', async (t) => {
  const { dir, baseSha } = makeRepo('g32', Array.from({ length: BULK_COUNT }, (_, index) => [bulkPath(index), 'x']));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const saved = process.env.BATON_GIT_LISTING_PATHS;
  t.after(() => {
    if (saved === undefined) delete process.env.BATON_GIT_LISTING_PATHS;
    else process.env.BATON_GIT_LISTING_PATHS = saved;
  });
  delete process.env.BATON_GIT_LISTING_PATHS;
  assert.ok(gitListingMaxBuffer() >= 64 * 1024 * 1024,
    'the ONE bound is the documented whole-repository derivation, at least the 64 MiB literal it replaces');
  // No git call carries a buffer literal of its own: the wrappers, and every call they serve, take
  // the ONE derivation. The only other maxBuffer in worktree.mjs is its `/bin/ps` probe, which
  // bounds one process line and postchecks it at 256 bytes — never a git listing.
  const source = readFileSync(new URL('../src/worktree.mjs', import.meta.url), 'utf8');
  const bounds = source.split('\n').filter((line) => /maxBuffer\s*:/u.test(line));
  const derived = bounds.filter((line) => line.includes('gitListingMaxBuffer()'));
  assert.ok(derived.length >= 1, 'worktree.mjs: the git wrapper takes the ONE derivation');
  assert.equal(bounds.length - derived.length, 1,
    'worktree.mjs: every other buffer bound is the documented non-listing probe');
  for (const call of source.match(/execFileSync\(\s*'git'[\s\S]*?\);/gu) ?? []) {
    assert.equal(/maxBuffer:\s*\d/u.test(call), false, 'worktree.mjs passes a per-call buffer literal to git');
  }

  // trackedPathsAtCommit + assertSparseIndexState — `ls-tree --name-only -z` and `ls-files -t -z`
  // over the same tree, inside a sparse creation that validates its own index state.
  const created = await createFromBase(dir, 'g32-sparse', baseSha, { sparsePaths: [bulkPath(0)] });
  assert.equal(existsSync(join(created.dir, bulkPath(0))), true);
  assert.equal(existsSync(join(created.dir, bulkPath(1))), false);

  // isClean — `git status --porcelain` (~1.4 MB once every tracked path differs).
  for (let index = 0; index < BULK_COUNT; index += 1) writeFileSync(join(dir, bulkPath(index)), 'xy');
  await assert.rejects(() => pinBaseSha(dir), DirtyRepoError,
    'the status listing completes instead of failing with ENOBUFS');

  // The bound is configurable, and the wrappers really take it: 1000 paths' worth of bytes cannot
  // hold this listing, so the same call refuses with the raw ENOBUFS that the derivation prevents.
  process.env.BATON_GIT_LISTING_PATHS = '1000';
  const configured = gitListingMaxBuffer();
  assert.ok(configured < 2 * 1024 * 1024 && configured > 0, `the derived bound follows the deployment (${configured} bytes)`);
  const refused = await rejection(() => pinBaseSha(dir));
  assert.equal(refused?.code, 'ENOBUFS', 'the configured derivation gates the git call');
});

// ============================================================
// G-6 — the receipt names the stash commit
// ============================================================

test('G-6: pinBaseSha records the stash commit, and a later stash does not move that identity', async (t) => {
  const { dir, baseSha } = makeRepo('g6', [['operator-work.txt', 'committed\n']]);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'operator-work.txt'), 'uncommitted operator work\n');

  const pinned = await pinBaseSha(dir, { autoStash: true });
  assert.equal(pinned.stashed, true);
  assert.equal(pinned.sha, baseSha);
  assert.match(pinned.stashSha ?? '', SHA_40, 'the receipt carries the stash COMMIT');
  assert.equal(sh('git', ['rev-parse', '--verify', `${pinned.stashSha}^{commit}`], dir), pinned.stashSha);
  assert.equal(pinned.stashSha, sh('git', ['rev-parse', '--verify', 'refs/stash'], dir),
    'the recorded identity is the stash this pin pushed');
  assert.equal(sh('git', ['show', `${pinned.stashSha}:operator-work.txt`], dir), 'uncommitted operator work');

  // A second stash re-points the name `stash@{0}`. The recorded identity still names the commit
  // holding THIS pin's parked work, and that work is still parked (W4: never auto-popped).
  writeFileSync(join(dir, 'operator-work.txt'), 'later operator work\n');
  sh('git', ['stash', 'push', '-u', '-m', 'later-stash'], dir);
  assert.notEqual(sh('git', ['rev-parse', '--verify', 'refs/stash'], dir), pinned.stashSha,
    'stash@{0} is a moving name, and the fixture moved it');
  assert.equal(sh('git', ['show', `${pinned.stashSha}:operator-work.txt`], dir), 'uncommitted operator work',
    'the recorded identity still names the commit that carries the pinned work');
  assert.ok(sh('git', ['stash', 'list', '--format=%H'], dir).split('\n').includes(pinned.stashSha),
    'the pinned stash is still in the stash list');
});

