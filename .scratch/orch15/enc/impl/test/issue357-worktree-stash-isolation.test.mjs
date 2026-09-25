// Issue #357 — lane worktrees share one git stash stack (`refs/stash` is one per
// repository, not one per worktree), so a seat's `git stash` round-trip can push onto the
// shared stack and another seat's `git stash pop` applies the wrong entry in the wrong tree.
// The seat's private runtime PATH must therefore project a `git` wrapper that refuses
// `git stash` and forwards everything else to the real git unchanged. Since #520 the
// refusal is scoped to the lease's own checkout (#447's scope rule): a stash a test runs
// against its own scratch repository forwards to the real git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuntimeIsolation, WORKTREE_STASH_BRIEF_SENTENCE } from '../src/runtime-isolation.mjs';
import { renderBrief } from '../src/adapter.mjs';
import { createBrief } from '../src/messages.mjs';

const HAVE_GIT = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

const QUIET_GIT_ENV = {
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  GIT_TERMINAL_PROMPT: '0',
};

function makeIsolation(tag) {
  const repoRoot = mkdtempSync(join(tmpdir(), `baton-357-${tag}-`));
  return new RuntimeIsolation({
    repoRoot,
    baseEnv: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent-operator-home', LANG: 'C' },
  });
}

function initRepo(dir) {
  execFileSync('git', ['init'], { cwd: dir, env: { ...process.env, ...QUIET_GIT_ENV } });
  execFileSync('git', ['config', 'user.email', 'seat-357@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'seat-357'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  writeFileSync(join(dir, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: dir, env: { ...process.env, ...QUIET_GIT_ENV } });
}

// Run `git` exactly as a worker seat would: PATH lookup inside the projected scope env,
// so the projected wrapper (when present) is what answers.
function seatGit(scope, args, cwd) {
  return spawnSync('git', args, { cwd, env: { ...scope.env, ...QUIET_GIT_ENV }, encoding: 'utf8' });
}

function realGitPath() {
  for (const dir of String(process.env.PATH ?? '/usr/bin:/bin').split(':')) {
    if (!dir) continue;
    try {
      const candidate = join(dir, 'git');
      if (statSync(candidate).isFile()) return candidate;
    } catch { /* keep scanning */ }
  }
  throw new Error('no real git on PATH');
}

function stashRef(scope, cwd) {
  const probe = spawnSync('git', ['rev-parse', '--verify', 'refs/stash'],
    { cwd, env: { ...scope.env, ...QUIET_GIT_ENV }, encoding: 'utf8' });
  return probe.status === 0 ? probe.stdout.trim() : null;
}

test('issue357 (a): the projected scope refuses git stash in every spelling, refs/stash unchanged',
  needsGit, () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-357-a-'));
    initRepo(dir);
    const isolation = makeIsolation('a');
    const scope = isolation.create('seat-a', 'codex');

    assert.equal(stashRef(scope, dir), null, 'fresh repo has no stash entry yet');
    const spellings = [
      ['stash'],
      ['stash', 'push'],
      ['stash', 'push', '-m', 'seat-a'],
      ['stash', 'save', 'seat-a'],
      ['stash', 'pop'],
      ['stash', 'apply'],
      ['stash', 'drop'],
      ['stash', 'list'],
      ['stash', 'branch', 'seat-357-branch'],
    ];
    for (const args of spellings) {
      const result = seatGit(scope, args, dir);
      assert.equal(result.status, 1, `git ${args.join(' ')} exits 1`);
      const line = String(result.stderr ?? '').trim();
      assert.ok(line.length > 0, `git ${args.join(' ')} refuses on stderr`);
      assert.equal(line.includes('\n'), false, `git ${args.join(' ')} refusal is one line`);
      assert.ok(line.includes('stash_refused'), `git ${args.join(' ')} refusal is typed`);
      assert.ok(line.includes('git worktree add <scratch-dir> <base>'), 'refusal names the scratch-worktree alternative');
      assert.ok(line.includes('git show <base>:<path>'), 'refusal names the one-file alternative');
      assert.ok(line.includes('git commit -m wip'), 'refusal names the set-aside alternative');
    }
    // A global option before the subcommand is still a stash invocation.
    const globalOpt = seatGit(scope, ['-C', dir, 'stash', 'list'], tmpdir());
    assert.equal(globalOpt.status, 1, 'git -C <dir> stash list is refused');
    assert.ok(String(globalOpt.stderr).includes('stash_refused'));

    assert.equal(stashRef(scope, dir), null, 'no refused spelling moved refs/stash');
    assert.equal(readFileSync(join(dir, 'base.txt'), 'utf8'), 'base\n', 'worktree left untouched');
    isolation.remove('seat-a');
  });

test('issue357 (b): status and commit through the wrapper behave exactly as the real git',
  needsGit, () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-357-b-'));
    initRepo(dir);
    const isolation = makeIsolation('b');
    const scope = isolation.create('seat-b', 'codex');
    const real = realGitPath();
    const runReal = (args) => spawnSync(real, args,
      { cwd: dir, env: { ...scope.env, ...QUIET_GIT_ENV }, encoding: 'utf8' });

    for (const args of [['status', '--porcelain'], ['rev-parse', 'HEAD'], ['log', '--format=%H', '-1']]) {
      const throughWrapper = seatGit(scope, args, dir);
      const direct = runReal(args);
      assert.equal(throughWrapper.status, direct.status, `git ${args.join(' ')} exit code matches`);
      assert.equal(throughWrapper.stdout, direct.stdout, `git ${args.join(' ')} stdout matches`);
    }

    writeFileSync(join(dir, 'seat-b.txt'), 'seat-b work\n');
    assert.equal(seatGit(scope, ['add', 'seat-b.txt'], dir).status, 0, 'git add forwards');
    const commit = seatGit(scope, ['commit', '-m', 'seat-b work'], dir);
    assert.equal(commit.status, 0, 'git commit forwards with exit 0');
    const log = runReal(['log', '--format=%s', '-1']);
    assert.equal(log.stdout.trim(), 'seat-b work', 'the commit landed via the wrapper');
    isolation.remove('seat-b');
  });

test('issue357 (c): two projected scopes over two worktrees cannot move each other\'s edits through stash',
  needsGit, () => {
    const dir = mkdtempSync(join(tmpdir(), 'baton-357-c-'));
    initRepo(dir);
    const env = { ...process.env, ...QUIET_GIT_ENV };
    const wtA = join(dir, 'wt-a');
    const wtB = join(dir, 'wt-b');
    execFileSync('git', ['worktree', 'add', '-b', 'seat-a', wtA, 'HEAD'], { cwd: dir, env });
    execFileSync('git', ['worktree', 'add', '-b', 'seat-b', wtB, 'HEAD'], { cwd: dir, env });
    try {
      writeFileSync(join(wtA, 'base.txt'), 'seat-a edits\n');
      writeFileSync(join(wtB, 'base.txt'), 'seat-b edits\n');

      const isolation = makeIsolation('c');
      const scopeA = isolation.create('seat-a', 'codex');
      const scopeB = isolation.create('seat-b', 'codex');

      assert.equal(seatGit(scopeA, ['stash', 'push', '-m', 'seat-a'], wtA).status, 1, 'seat A cannot stash');
      assert.equal(seatGit(scopeB, ['stash', 'push', '-m', 'seat-b'], wtB).status, 1, 'seat B cannot stash');
      assert.equal(seatGit(scopeA, ['stash', 'pop'], wtA).status, 1, 'seat A cannot pop either');

      assert.equal(readFileSync(join(wtA, 'base.txt'), 'utf8'), 'seat-a edits\n', "A's edits stayed in A's tree");
      assert.equal(readFileSync(join(wtB, 'base.txt'), 'utf8'), 'seat-b edits\n', "B's edits stayed in B's tree");
      const list = spawnSync(realGitPath(), ['stash', 'list'], { cwd: dir, env, encoding: 'utf8' });
      assert.equal(list.stdout.trim(), '', 'the shared stash stack gained no entry');
      assert.equal(stashRef(scopeA, dir), null, 'refs/stash still absent');
      isolation.remove('seat-a');
      isolation.remove('seat-b');
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', wtA], { cwd: dir, env });
      execFileSync('git', ['worktree', 'remove', '--force', wtB], { cwd: dir, env });
    }
  });

test('issue520 (f): the stash refusal is scoped to the lease\'s own checkout', needsGit, () => {
  const lane = mkdtempSync(join(tmpdir(), 'baton-520-lane-'));
  const fixture = mkdtempSync(join(tmpdir(), 'baton-520-fixture-'));
  initRepo(lane);
  initRepo(fixture);
  const isolation = makeIsolation('f');
  const scope = isolation.create('seat-f', 'codex');
  try {
    assert.equal(isolation.projectCheckout('seat-f', lane), true, 'the lease records its checkout');

    // In the recorded checkout the refusal holds for its stated reason: the repository's
    // shared refs/stash stack.
    writeFileSync(join(lane, 'dirty.txt'), 'seat-f edits\n');
    const refused = seatGit(scope, ['stash', 'push', '-u', '-m', 'seat-f'], lane);
    assert.equal(refused.status, 1, 'git stash push in the checkout is refused');
    assert.ok(String(refused.stderr ?? '').includes('stash_refused'), 'the refusal is typed');

    // A scratch repository under the test's own temp dir is another repository: the same
    // spelling forwards to the real git and lands in the fixture's own stash stack, and
    // the checkout's (nonexistent) stack gains nothing.
    writeFileSync(join(fixture, 'dirty.txt'), 'fixture work\n');
    const forwarded = seatGit(scope, ['stash', 'push', '-u', '-m', 'fixture'], fixture);
    assert.equal(forwarded.status, 0, 'git stash push in a scratch repository forwards');
    assert.match(stashRef(scope, fixture) ?? '', /^[a-f0-9]{40}$/, 'the fixture repo holds the stash entry');
    assert.equal(stashRef(scope, lane), null, 'the checkout gained no stash entry');

    // The -C spelling resolves the target the same way: the wrapper reads the target, not
    // the cwd the wrapper happens to run in.
    writeFileSync(join(fixture, 'dirty2.txt'), 'more fixture work\n');
    const viaC = seatGit(scope, ['-C', fixture, 'stash', 'push', '-u', '-m', 'fixture-2'], lane);
    assert.equal(viaC.status, 0, 'git -C <fixture> stash push forwards');

    // A lease with no recorded checkout keeps the #357 refusal everywhere.
    const scopeBare = isolation.create('seat-f-bare', 'codex');
    try {
      const bare = seatGit(scopeBare, ['stash', 'list'], fixture);
      assert.equal(bare.status, 1, 'a lease with no recorded checkout refuses stash');
      assert.ok(String(bare.stderr ?? '').includes('stash_refused'), 'the no-checkout refusal is typed');
    } finally {
      isolation.remove('seat-f-bare');
    }
  } finally {
    isolation.remove('seat-f');
    rmSync(lane, { recursive: true, force: true });
    rmSync(fixture, { recursive: true, force: true });
  }
});

test('issue357 (d): runtime.scope_created records the refusing git wrapper', () => {
  const isolation = makeIsolation('d');
  const scope = isolation.create('seat-d', 'codex');
  try {
    assert.deepEqual(scope.posture.git, { mechanism: 'wrapper', refuses: ['stash'] });
    // The coordinator maps the lease posture onto runtime.scope_created as
    // `{ ...lease.posture, active: true }` — the record it emits must carry the wrapper.
    const scopeCreated = { ...scope.posture, active: true };
    assert.deepEqual(scopeCreated.git, { mechanism: 'wrapper', refuses: ['stash'] });
    assert.equal(scopeCreated.active, true);
    assert.ok(typeof scope.paths.bin === 'string', 'the private bin dir rides the lease paths');
    assert.ok(String(scope.env.PATH).split(':')[0] === scope.paths.bin, 'the private bin dir leads PATH');
    assert.equal(statSync(scope.paths.bin).mode & 0o777, 0o700, 'the bin dir is private');
    assert.equal(statSync(join(scope.paths.bin, 'git')).mode & 0o777, 0o700, 'the wrapper is owner-only');
  } finally {
    isolation.remove('seat-d');
  }
});

test('issue357 (e): the brief carries the safe-baseline sentence', () => {
  assert.equal(WORKTREE_STASH_BRIEF_SENTENCE.includes('\n'), false, 'the guidance is one sentence');
  assert.ok(WORKTREE_STASH_BRIEF_SENTENCE.includes('git worktree add'),
    'the sentence names the safe baseline comparison');
  assert.ok(WORKTREE_STASH_BRIEF_SENTENCE.includes('git stash'),
    'the sentence says git stash is refused in a lane worktree');
  const brief = createBrief({
    goal: 'Do the lane work',
    constraints: [],
    pathScope: ['impl/**'],
    definitionOfDone: 'The lane is done',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 1000, usd: 1, wallMin: 10 },
    laneContract: WORKTREE_STASH_BRIEF_SENTENCE,
  });
  const rendered = renderBrief(brief, 'mock');
  assert.ok(rendered.includes('## Lane contract'), 'the lane contract section renders');
  assert.ok(rendered.includes(WORKTREE_STASH_BRIEF_SENTENCE), 'the brief carries the sentence');
});
