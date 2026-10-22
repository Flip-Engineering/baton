import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyRecovery, planRecovery } from '../scripts/worktree-remap.mjs';

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function readRows(database) {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    return db.prepare('SELECT id, workspace, endpoint, branch FROM sessions ORDER BY id').all();
  } finally {
    db.close();
  }
}

// A repository and a worktree with uncommitted work, recorded under a run prefix.
// The directory is then renamed, so the recorded run spelling no longer exists and
// the persistent spelling does, as after the storage moves under a new mount.
function scenario(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'baton-972-remap-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const run = join(base, 'run');
  const repo = join(run, 'repo');
  const worktree = join(run, 'wt');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '--quiet', '-b', 'main', repo]);
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git(repo, ['add', 'a.txt']);
  git(repo, ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'init']);
  git(repo, ['worktree', 'add', '--quiet', '-b', 'wt-972', worktree, 'HEAD']);
  writeFileSync(join(worktree, 'a.txt'), 'two, uncommitted\n');
  writeFileSync(join(worktree, 'u.txt'), 'untracked\n');
  const status = git(worktree, ['status', '--porcelain']);
  mkdirSync(join(run, 'bin'));
  writeFileSync(join(run, 'bin', 'tool'), 'tool\n');

  const database = join(base, 'orchestra.db');
  const seed = new DatabaseSync(database);
  seed.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, workspace TEXT, endpoint TEXT, branch TEXT)');
  const insert = seed.prepare('INSERT INTO sessions (id, workspace, endpoint, branch) VALUES (?, ?, ?, ?)');
  insert.run('player-972', worktree, JSON.stringify(['node', join(run, 'bin', 'tool'), 'receive', 'player-972']), 'wt-972');
  insert.run('player-gone', join(run, 'gone'), null, null);
  seed.close();

  const persist = join(base, 'persist');
  renameSync(run, persist);
  return {
    database,
    from: run,
    to: persist,
    repo: join(persist, 'repo'),
    worktree: join(persist, 'wt'),
    status,
  };
}

test('recorded run paths are rewritten after the tree moves and the worktree is repaired', (t) => {
  const s = scenario(t);
  const before = readRows(s.database);

  const plan = planRecovery(s.database, { from: s.from, to: s.to });
  assert.deepEqual(plan.rows.map((row) => [row.id, row.skip]), [
    ['player-972', null],
    ['player-gone', 'workspace-target-missing'],
  ]);
  assert.deepEqual(plan.repairs, [{ repo: s.repo, worktree: s.worktree }]);
  assert.deepEqual(readRows(s.database), before, 'a plan writes nothing');

  applyRecovery(s.database, plan);
  const after = readRows(s.database);
  const moved = after.find((row) => row.id === 'player-972');
  assert.equal(moved.workspace, s.worktree);
  assert.deepEqual(JSON.parse(moved.endpoint), ['node', join(s.to, 'bin', 'tool'), 'receive', 'player-972']);
  assert.equal(after.find((row) => row.id === 'player-gone').workspace, join(s.from, 'gone'), 'a skipped row is unchanged');

  assert.ok(git(s.repo, ['worktree', 'list', '--porcelain']).split('\n').includes(`worktree ${s.worktree}`));
  assert.equal(git(s.worktree, ['status', '--porcelain']), s.status);
  assert.equal(readFileSync(join(s.worktree, 'a.txt'), 'utf8'), 'two, uncommitted\n');
  assert.equal(readFileSync(join(s.worktree, 'u.txt'), 'utf8'), 'untracked\n');
});

test('a second recovery run plans nothing and changes nothing', (t) => {
  const s = scenario(t);
  applyRecovery(s.database, planRecovery(s.database, { from: s.from, to: s.to }));
  const rows = readRows(s.database);
  const worktrees = git(s.repo, ['worktree', 'list', '--porcelain']);

  const plan = planRecovery(s.database, { from: s.from, to: s.to });
  assert.deepEqual(plan.repairs, []);
  assert.deepEqual(plan.rows.filter((row) => row.to !== null || row.endpointTo !== null), []);
  applyRecovery(s.database, plan);

  assert.deepEqual(readRows(s.database), rows);
  assert.equal(git(s.repo, ['worktree', 'list', '--porcelain']), worktrees);
  assert.equal(git(s.worktree, ['status', '--porcelain']), s.status);
});
