// Cluster 2 (Workers & Trust) — worktree.mjs test suite.
// All tests run against REAL temporary git repositories (git init + a base commit,
// created inline in each test) — no mocking of git itself, per spec §3.
//
// D7 (spec/RECONCILIATION.md, authoritative) pins worktree.mjs's exports as the
// coordinator's ONE dependency interface (no separate WorktreeManager shape):
// pinBaseSha, createFromBase, captureCommit, freshVerifySandbox, changedLines, reap,
// reconcile, listWorktrees — every name below matches D7 verbatim. `markStopped` is
// not in D7's literal list but remains a real export per IMPLEMENTATION.md §3 (W5) —
// its cross-cluster call site is pinned explicitly at IMPLEMENTATION.md line 1301:
// the coordinator calls `worktree.markStopped` + `worktree.reap` ONLY after observing
// an interrupted/killed session settle, never on normal task completion (which only
// ever reaps the *verify sandbox*, via `sandbox.cleanup()` — see D4). That resolves
// red workers-trust#3's danger (every normal completion throwing WorktreeLockedError)
// without deleting the precondition itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pinBaseSha,
  createFromBase,
  captureCommit,
  freshVerifySandbox,
  markStopped,
  reap,
  reconcile,
  changedLines,
  listWorktrees,
  DirtyRepoError,
  BranchAlreadyCheckedOutError,
  WorktreeAlreadyExistsError,
  WorktreeLockedError,
  InvalidShaError,
} from '../src/worktree.mjs';
import { MockAdapter } from '../src/adapter.mjs';

// ---------- helpers ----------

function sh(cmd, args, cwd, input) {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', ...(input !== undefined ? { input } : {}) }).trim();
}

/** A real git repo with one base commit. Returns { dir, baseSha }. */
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'baton-wt-test-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Baton Test'], dir);
  writeFileSync(join(dir, 'README.md'), '# base\n');
  sh('git', ['add', '-A'], dir);
  sh('git', ['commit', '-q', '-m', 'base'], dir);
  const baseSha = sh('git', ['rev-parse', 'HEAD'], dir);
  return { dir, baseSha };
}

function stubLog() {
  const events = [];
  return { events, log: { append: (e) => { events.push(e); return e; } } };
}

function isClean(dir) {
  return sh('git', ['status', '--porcelain'], dir) === '';
}

// ============================================================
// pinBaseSha — behaviors 23-25
// ============================================================

test('pinBaseSha on a clean repo returns {sha: HEAD, stashed:false}', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = await pinBaseSha(dir);
  assert.equal(result.sha, baseSha);
  assert.equal(result.stashed, false);
});

test('pinBaseSha on a dirty repo with autoStash:false (default) throws DirtyRepoError and leaves the repo untouched', async (t) => {
  const { dir } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'dirty.txt'), 'uncommitted');

  await assert.rejects(() => pinBaseSha(dir), DirtyRepoError);
  assert.ok(existsSync(join(dir, 'dirty.txt')), 'the dirty file is still there');
  assert.ok(!isClean(dir), 'the repo is still dirty — nothing was stashed');
});

test('pinBaseSha on a dirty repo with autoStash:true stashes and returns a clean repo at the same sha', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'dirty.txt'), 'uncommitted');

  const result = await pinBaseSha(dir, { autoStash: true });
  assert.equal(result.stashed, true);
  assert.equal(typeof result.stashRef, 'string');
  assert.equal(sh('git', ['rev-parse', 'HEAD'], dir), baseSha);
  assert.ok(isClean(dir), 'repo is clean after auto-stash');

  // W4 ("never auto-popped"), asserted DIRECTLY: the stash referenced by result.stashRef
  // must still be present in `git stash list`, not just inferred from repo-cleanliness.
  const stashList = sh('git', ['stash', 'list'], dir);
  const stashIndex = result.stashRef.replace(/^stash@\{|\}$/g, '');
  assert.ok(
    stashList.split('\n').some((line) => line.startsWith(`stash@{${stashIndex}}`) || line.includes(result.stashRef)),
    `git stash list must contain ${result.stashRef}, got:\n${stashList}`,
  );
});

// ============================================================
// createFromBase — behaviors 26-28
// ============================================================

test('createFromBase produces <repoRoot>/.baton/wt/<taskId> on branch baton/<taskId> at baseSha', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const handle = await createFromBase(dir, 't1', baseSha);
  assert.equal(handle.dir, join(dir, '.baton', 'wt', 't1'));
  assert.equal(handle.branch, 'baton/t1');
  assert.ok(existsSync(handle.dir));
  assert.equal(sh('git', ['log', '-1', '--pretty=%H'], handle.dir), baseSha);
  const currentBranch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD'], handle.dir);
  assert.equal(currentBranch, 'baton/t1');
});

test('createFromBase called twice with the same taskId throws WorktreeAlreadyExistsError', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  await createFromBase(dir, 't1', baseSha);
  await assert.rejects(() => createFromBase(dir, 't1', baseSha), WorktreeAlreadyExistsError);
});

test('createFromBase throws BranchAlreadyCheckedOutError when baton/<taskId> is already checked out elsewhere', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const manualDir = mkdtempSync(join(tmpdir(), 'baton-manual-wt-'));
  t.after(() => rmSync(manualDir, { recursive: true, force: true }));
  sh('git', ['worktree', 'add', '-b', 'baton/t1', manualDir, baseSha], dir);

  await assert.rejects(() => createFromBase(dir, 't1', baseSha), BranchAlreadyCheckedOutError);
});

// ============================================================
// captureCommit — behaviors 29-31
// ============================================================

test('captureCommit on an already-committed worktree: snapshotted:false, sha equals the worker\'s own commit', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handle = await createFromBase(dir, 't1', baseSha);

  writeFileSync(join(handle.dir, 'work.txt'), 'work');
  sh('git', ['add', '-A'], handle.dir);
  sh('git', ['commit', '-q', '-m', 'worker commit'], handle.dir);
  const workerSha = sh('git', ['rev-parse', 'HEAD'], handle.dir);

  const result = await captureCommit(dir, 't1');
  assert.equal(result.snapshotted, false);
  assert.equal(result.sha, workerSha);
});

test('captureCommit on a dirty worktree snapshots a commit with the vendor trailer and leaves it clean', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handle = await createFromBase(dir, 't1', baseSha);
  writeFileSync(join(handle.dir, 'dirty.txt'), 'dirty');

  const result = await captureCommit(dir, 't1', { vendor: 'mock' });
  assert.equal(result.snapshotted, true);
  assert.ok(isClean(handle.dir));
  const message = sh('git', ['log', '-1', '--pretty=%B'], handle.dir);
  assert.match(message, /Baton-Task:\s*t1/);
  assert.match(message, /Baton-Vendor:\s*mock/);

  // Strengthened per red workers-trust#10: a substring match anywhere in the message
  // body (including the SUBJECT line) would also pass; require these to be structurally
  // valid trailers via `git interpret-trailers --parse`, i.e. actually trailing footer
  // key:value pairs, not merely matching text.
  const trailers = sh('git', ['interpret-trailers', '--parse'], handle.dir, message);
  assert.match(trailers, /^Baton-Task:\s*t1$/m, 'Baton-Task must be a real trailer, not incidental text');
  assert.match(trailers, /^Baton-Vendor:\s*mock$/m, 'Baton-Vendor must be a real trailer, not incidental text');
});

test('captureCommit on an unchanged worktree does not create an empty commit', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await createFromBase(dir, 't1', baseSha);

  const result = await captureCommit(dir, 't1');
  assert.equal(result.snapshotted, false);
  assert.equal(result.sha, baseSha);
});

// ============================================================
// freshVerifySandbox — behaviors 32-35
// ============================================================

test('freshVerifySandbox produces a directory distinct from the worker worktree, detached at sha, with that commit\'s content', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handle = await createFromBase(dir, 't1', baseSha);

  writeFileSync(join(dir, 'main-branch-file.txt'), 'from-main');
  sh('git', ['add', '-A'], dir);
  sh('git', ['commit', '-q', '-m', 'second commit on main'], dir);
  const resultSha = sh('git', ['rev-parse', 'HEAD'], dir);

  const sandbox = await freshVerifySandbox(dir, 't1-result', resultSha);
  t.after(() => sandbox.cleanup());

  assert.notEqual(sandbox.dir, handle.dir);
  assert.ok(!sandbox.dir.startsWith(handle.dir + '/') && !handle.dir.startsWith(sandbox.dir + '/'));
  assert.equal(sandbox.sha, resultSha);
  const head = sh('git', ['rev-parse', 'HEAD'], sandbox.dir);
  assert.equal(head, resultSha);
  const branch = sh('git', ['branch', '--show-current'], sandbox.dir);
  assert.equal(branch, '', 'detached HEAD — not on any branch');
  assert.ok(existsSync(join(sandbox.dir, 'main-branch-file.txt')));
});

test('two freshVerifySandbox calls with the same label produce two non-colliding directories', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const s1 = await freshVerifySandbox(dir, 'dup-label', baseSha);
  const s2 = await freshVerifySandbox(dir, 'dup-label', baseSha);
  t.after(() => { s1.cleanup(); s2.cleanup(); });

  assert.notEqual(s1.dir, s2.dir);
  assert.ok(existsSync(s1.dir));
  assert.ok(existsSync(s2.dir));
});

test('sandbox.cleanup() removes the directory and is idempotent', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const sandbox = await freshVerifySandbox(dir, 'cleanup-test', baseSha);
  await sandbox.cleanup();
  assert.ok(!existsSync(sandbox.dir));
  await assert.doesNotReject(() => sandbox.cleanup());
});

test('freshVerifySandbox with a garbage sha throws InvalidShaError before creating any directory', async (t) => {
  const { dir } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const before = existsSync(join(dir, '.baton', 'verify'));
  await assert.rejects(() => freshVerifySandbox(dir, 'bad-sha', 'not-a-real-sha-0000'), InvalidShaError);
  if (!before) assert.ok(!existsSync(join(dir, '.baton', 'verify')) || sh('git', ['worktree', 'list'], dir).split('\n').length === 1);
});

// ============================================================
// reap — behaviors 36-39
// ============================================================

test('reap() on a worktree that was never markStopped throws WorktreeLockedError and leaves the directory intact', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handle = await createFromBase(dir, 't1', baseSha);

  await assert.rejects(() => reap(dir, 't1'), WorktreeLockedError);
  assert.ok(existsSync(handle.dir));
});

test('reap() after markStopped succeeds: the directory is gone and git worktree list no longer shows it', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handle = await createFromBase(dir, 't1', baseSha);

  await markStopped(dir, 't1');
  await reap(dir, 't1');

  assert.ok(!existsSync(handle.dir));
  const list = sh('git', ['worktree', 'list'], dir);
  assert.ok(!list.includes('.baton/wt/t1'));
});

test('reap() with opts.force:true succeeds even without markStopped', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handle = await createFromBase(dir, 't1', baseSha);

  await reap(dir, 't1', { force: true });
  assert.ok(!existsSync(handle.dir));
});

test('reap() called twice on the same taskId is a no-op both times', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await createFromBase(dir, 't1', baseSha);
  await markStopped(dir, 't1');

  await assert.doesNotReject(() => reap(dir, 't1'));
  await assert.doesNotReject(() => reap(dir, 't1'));
});

// ============================================================
// Interrupt-then-reap sequencing (integration w/ adapter.mjs) — behavior 40
// ============================================================

test('interrupt-then-reap sequencing: an aborted MockAdapter run can be markStopped + reaped, discarding the partial commit', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handle = await createFromBase(dir, 't1', baseSha);

  const ac = new AbortController();
  const scenario = {
    outcome: 'completed',
    edits: [
      { path: 'a.txt', content: 'a', delayMs: 5 },
      { path: 'b.txt', content: 'b', delayMs: 5000 },
    ],
  };
  const adapter = new MockAdapter({ scenario });
  let editCount = 0;
  const log = { append: (e) => { if (e.kind === 'content.file_edit') { editCount += 1; if (editCount === 1) ac.abort(); } } };

  const result = await adapter.run(
    { goal: 'g', constraints: [], pathScope: [], definitionOfDone: 'd', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1, usd: 1, wallMin: 1 } },
    { worktree: handle.dir, timeoutMs: 20000, signal: ac.signal, log },
  );
  assert.equal(result.status, 'cancelled');
  assert.ok(existsSync(join(handle.dir, 'a.txt')), 'partial commit exists before reap');

  await markStopped(dir, 't1');
  await reap(dir, 't1');

  assert.ok(!existsSync(handle.dir), 'the partial work is discarded along with the directory');
});

// ============================================================
// crash/abort landing mid-git-op — red workers-trust#11
// ============================================================

test('a same-tick abort (delayMs:0) during a MockAdapter run never leaves a git lockfile behind, and the worktree can still be markStopped + reaped cleanly', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const handle = await createFromBase(dir, 't1', baseSha);

  const ac = new AbortController();
  const scenario = {
    outcome: 'completed',
    edits: [{ path: 'a.txt', content: 'a', delayMs: 0 }],
  };
  const adapter = new MockAdapter({ scenario });
  const runPromise = adapter.run(
    { goal: 'g', constraints: [], pathScope: [], definitionOfDone: 'd', verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1, usd: 1, wallMin: 1 } },
    { worktree: handle.dir, timeoutMs: 20000, signal: ac.signal },
  );
  ac.abort(); // fires essentially concurrently with the scripted git add+commit
  await runPromise;

  // A5/A8: an in-flight git write is atomic w.r.t. abort — the worktree is always in a
  // git-valid state afterward, never a half-written index.
  assert.doesNotThrow(() => sh('git', ['status', '--porcelain'], handle.dir));
  assert.ok(!existsSync(join(handle.dir, '.git', 'index.lock')));

  await markStopped(dir, 't1');
  await assert.doesNotReject(() => reap(dir, 't1'));
  assert.ok(!existsSync(handle.dir));
});

// ============================================================
// reconcile — behaviors 41-42
// ============================================================

test('reconcile removes leftover .baton/wt/* directories not in expectedActiveTaskIds, then is idempotent', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await createFromBase(dir, 'zombie1', baseSha);
  await createFromBase(dir, 'zombie2', baseSha);

  const report1 = await reconcile(dir, []);
  assert.ok(report1.removedZombieDirs.some((p) => p.includes('zombie1')));
  assert.ok(report1.removedZombieDirs.some((p) => p.includes('zombie2')));
  assert.ok(!existsSync(join(dir, '.baton', 'wt', 'zombie1')));
  assert.ok(!existsSync(join(dir, '.baton', 'wt', 'zombie2')));

  const report2 = await reconcile(dir, []);
  assert.deepEqual(report2.removedZombieDirs, []);
});

test('reconcile leaves directories whose taskId is in expectedActiveTaskIds alone', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keep = await createFromBase(dir, 'keep-me', baseSha);
  await createFromBase(dir, 'remove-me', baseSha);

  const report = await reconcile(dir, ['keep-me']);
  assert.ok(existsSync(keep.dir), 'expected-active worktree survives reconcile');
  assert.ok(!existsSync(join(dir, '.baton', 'wt', 'remove-me')));
  assert.ok(report.removedZombieDirs.some((p) => p.includes('remove-me')));
  assert.ok(!report.removedZombieDirs.some((p) => p.includes('keep-me')));
});

// ============================================================
// reconcile() log-event attribution — red workers-trust#9
// ============================================================

test('reconcile() emits one worktree.reconciled event per removed directory, each attributed to that directory\'s own taskId', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await createFromBase(dir, 'zombie1', baseSha);
  await createFromBase(dir, 'zombie2', baseSha);
  const { events, log } = stubLog();

  const report = await reconcile(dir, [], { log });

  const reconciledEvents = events.filter((e) => e.kind === 'worktree.reconciled');
  assert.equal(reconciledEvents.length, 2, 'one worktree.reconciled event per removed directory, not one aggregate event for both');

  const workers = reconciledEvents.map((e) => e.worker).sort();
  assert.deepEqual(workers, ['zombie1', 'zombie2'], 'each removal event is attributed to that directory\'s own taskId, never a shared "worktree" sentinel');

  // Cross-check against the report itself: every removed dir has a matching per-taskId event.
  for (const removedPath of report.removedZombieDirs) {
    const match = reconciledEvents.find((e) => removedPath.includes(e.worker));
    assert.ok(match, `no worktree.reconciled event found attributed to ${removedPath}`);
  }
});

test('changedLines reports added lines in a new file and modified lines in an existing file', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'baton-wt-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'Baton Test'], dir);
  writeFileSync(join(dir, 'bar.js'), 'line1\nline2\n');
  sh('git', ['add', '-A'], dir);
  sh('git', ['commit', '-q', '-m', 'base'], dir);
  const baseSha = sh('git', ['rev-parse', 'HEAD'], dir);

  writeFileSync(join(dir, 'foo.js'), 'a\nb\nc\n');
  writeFileSync(join(dir, 'bar.js'), 'line1\nLINE2\n');
  sh('git', ['add', '-A'], dir);
  sh('git', ['commit', '-q', '-m', 'change'], dir);
  const toSha = sh('git', ['rev-parse', 'HEAD'], dir);

  const result = await changedLines(dir, baseSha, toSha);
  assert.deepEqual(result['foo.js'], [1, 2, 3]);
  assert.deepEqual(result['bar.js'], [2]);
});

test('changedLines between identical SHAs returns {}', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const result = await changedLines(dir, baseSha, baseSha);
  assert.deepEqual(result, {});
});

// ============================================================
// listWorktrees — behavior 45
// ============================================================

test('listWorktrees reports created worktrees and verify sandboxes with correct fields', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const h1 = await createFromBase(dir, 't1', baseSha);
  const h2 = await createFromBase(dir, 't2', baseSha);
  const sandbox = await freshVerifySandbox(dir, 't1-result', baseSha);
  t.after(() => sandbox.cleanup());

  const list = await listWorktrees(dir);
  assert.equal(list.length, 3);

  const byDir = Object.fromEntries(list.map((w) => [w.dir, w]));
  assert.ok(byDir[h1.dir]);
  assert.equal(byDir[h1.dir].branch, 'baton/t1');
  assert.equal(byDir[h1.dir].detached, false);

  assert.ok(byDir[h2.dir]);
  assert.equal(byDir[h2.dir].branch, 'baton/t2');

  assert.ok(byDir[sandbox.dir]);
  assert.equal(byDir[sandbox.dir].detached, true);
  assert.equal(byDir[sandbox.dir].sha, baseSha);
});

// ============================================================
// log emission — behavior 46
// ============================================================

test('createFromBase, captureCommit, freshVerifySandbox, reap, reconcile each append at least one documented-prefix log event, correctly attributed via `worker`', async (t) => {
  const { dir, baseSha } = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const prefixOk = (kind) => /^(lifecycle\.|worktree\.)/.test(kind);

  {
    const { events, log } = stubLog();
    const handle = await createFromBase(dir, 't1', baseSha, { log });
    assert.ok(events.length >= 1);
    assert.ok(events.every((e) => prefixOk(e.kind)), 'createFromBase log kinds');
    assert.ok(events.every((e) => e.worker === 't1'), 'createFromBase events are attributed to the taskId, not a generic sentinel');
    void handle;
  }
  {
    const { events, log } = stubLog();
    writeFileSync(join(dir, '.baton', 'wt', 't1', 'x.txt'), 'x');
    await captureCommit(dir, 't1', { log });
    assert.ok(events.length >= 1);
    assert.ok(events.every((e) => prefixOk(e.kind)), 'captureCommit log kinds');
    assert.ok(events.every((e) => e.worker === 't1'));
  }
  {
    const { events, log } = stubLog();
    const sandbox = await freshVerifySandbox(dir, 't1-log', baseSha, { log });
    t.after(() => sandbox.cleanup());
    assert.ok(events.length >= 1);
    assert.ok(events.every((e) => prefixOk(e.kind)), 'freshVerifySandbox log kinds');
  }
  {
    await markStopped(dir, 't1');
    const { events, log } = stubLog();
    await reap(dir, 't1', { log });
    assert.ok(events.length >= 1);
    assert.ok(events.every((e) => prefixOk(e.kind)), 'reap log kinds');
    assert.ok(events.every((e) => e.worker === 't1'));
  }
  {
    await createFromBase(dir, 'zombie', baseSha);
    const { events, log } = stubLog();
    await reconcile(dir, [], { log });
    assert.ok(events.length >= 1);
    assert.ok(events.every((e) => prefixOk(e.kind)), 'reconcile log kinds');
    assert.ok(events.every((e) => e.worker === 'zombie'), 'per-directory reconcile attribution (red workers-trust#9)');
  }
});
