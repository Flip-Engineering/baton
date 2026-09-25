// Issue #563, the naming parity half — a recorded base that is no longer the checkout's past is
// three facts with three remedies, and #563 landed that naming on the SESSION path
// (`session_worktree_base_rewound|diverged|unknown`, impl/test/issue563-session-context-rewound).
// The SAME mismatch reaches the CAPTURE and LANDING paths through `validateOwnedWorktree`, where it
// answered one bare sentence — "owned worktree base identity mismatch" — naming neither the
// revisions nor a way out, so an operator who met it from a capture had nothing to act on.
//
// Rows:
//   (a) a healthy owned checkout validates and reads `contained`, so nothing narrows on the happy
//       path;
//   (b) a checkout whose branch was rewound BEHIND its recorded base refuses naming that fact,
//       both revisions and both remedies;
//   (c) a checkout whose history diverged from the recorded base names THAT fact instead;
//   (d) the one classification answers `unknown` for a commit this repository does not hold, and
//       every relation's sentence is the remedy the issue names.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  createFromBase, sessionBaseRelation, sessionBaseRelationReason, validateOwnedWorktree,
  UnknownWorktreeError,
} from '../src/worktree.mjs';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
}

/** Three commits on the lane's line, so a recorded base has an ancestor to be rewound to. */
function fixture(label) {
  const world = mkdtempSync(join(tmpdir(), `baton-issue563-own-${label}-`));
  const repo = join(world, 'repo');
  mkdirSync(repo);
  git(['init', '-q'], repo);
  git(['config', 'user.name', 'Baton Issue 563'], repo);
  git(['config', 'user.email', 'issue563@example.invalid'], repo);
  writeFileSync(join(repo, 'base.txt'), 'one\n');
  git(['add', '.'], repo);
  git(['commit', '-qm', 'one'], repo);
  writeFileSync(join(repo, 'base.txt'), 'two\n');
  git(['commit', '-qam', 'two'], repo);
  writeFileSync(join(repo, 'base.txt'), 'three\n');
  git(['commit', '-qam', 'three'], repo);
  return { world, repo, baseSha: git(['rev-parse', 'HEAD'], repo) };
}

test('563-ow-a: a healthy owned checkout validates, and its recorded base reads contained', async (t) => {
  const { world, repo, baseSha } = fixture('healthy');
  t.after(() => rmSync(world, { force: true, recursive: true }));

  const handle = await createFromBase(repo, 'healthy-lane', baseSha);
  assert.doesNotThrow(() => validateOwnedWorktree(repo, 'healthy-lane', { expectedBaseSha: baseSha }),
    'the owned checkout validates');
  assert.deepEqual(sessionBaseRelation(handle.dir, baseSha),
    { relation: 'contained', head: baseSha },
    'the recorded base is the checkout past');
});

test('563-ow-b: a rewound lane refuses naming the fact, both revisions and its remedies', async (t) => {
  const { world, repo, baseSha } = fixture('rewound');
  t.after(() => rmSync(world, { force: true, recursive: true }));

  const handle = await createFromBase(repo, 'rewound-lane', baseSha);
  const behind = git(['rev-parse', `${baseSha}^`], repo);
  git(['reset', '--hard', behind], handle.dir);

  assert.deepEqual(sessionBaseRelation(handle.dir, baseSha),
    { relation: 'rewound', head: behind }, 'the branch moved behind its recorded base');
  assert.throws(
    () => validateOwnedWorktree(repo, 'rewound-lane', {}),
    (error) => {
      assert.ok(error instanceof UnknownWorktreeError, 'the refusal keeps its own error class');
      assert.match(error.message, /^owned worktree base identity mismatch: /u);
      assert.match(error.message, /rewound behind the recorded base/u, 'the fact is named');
      assert.ok(error.message.includes(baseSha), 'the recorded base is named');
      assert.ok(error.message.includes(behind), 'the checkout HEAD is named');
      assert.match(error.message,
        /restore the recorded base as an ancestor of HEAD, or admit a fresh seat at/u,
        'the remedies the session verdict names are here too');
      return true;
    },
  );
});

test('563-ow-c: a diverged history refuses naming that fact, not the rewound one', async (t) => {
  const { world, repo, baseSha } = fixture('diverged');
  t.after(() => rmSync(world, { force: true, recursive: true }));

  const handle = await createFromBase(repo, 'diverged-lane', baseSha);
  // An unrelated root: it neither contains the recorded base nor is contained by it.
  const emptyTree = git(['hash-object', '-t', 'tree', '/dev/null'], repo);
  const unrelated = git(['commit-tree', emptyTree, '-m', 'unrelated root'], repo);
  git(['reset', '--hard', unrelated], handle.dir);

  assert.deepEqual(sessionBaseRelation(handle.dir, baseSha),
    { relation: 'diverged', head: unrelated }, 'neither revision contains the other');
  assert.throws(
    () => validateOwnedWorktree(repo, 'diverged-lane', {}),
    (error) => {
      assert.match(error.message, /history diverged from the recorded base/u);
      assert.ok(!/rewound/u.test(error.message), 'the rewound fact is not claimed here');
      assert.ok(error.message.includes(baseSha) && error.message.includes(unrelated));
      return true;
    },
  );
});

test('563-ow-d: the one classification answers unknown for a foreign commit, and each relation carries its remedy', async (t) => {
  const { world, repo, baseSha } = fixture('unknown');
  t.after(() => rmSync(world, { force: true, recursive: true }));

  const handle = await createFromBase(repo, 'unknown-lane', baseSha);
  const foreign = 'f'.repeat(40);
  assert.deepEqual(sessionBaseRelation(handle.dir, foreign),
    { relation: 'unknown', head: baseSha }, 'a commit this repository does not hold is unknown');
  assert.equal(sessionBaseRelation(join(repo, 'does-not-exist'), baseSha), null,
    'a checkout that cannot be read is never guessed at');

  for (const relation of ['unknown', 'rewound', 'diverged']) {
    const sentence = sessionBaseRelationReason(relation, baseSha, baseSha);
    assert.ok(sentence.includes(baseSha), `${relation} names the recorded base`);
  }
  assert.match(sessionBaseRelationReason('unknown', baseSha, baseSha),
    /is not a commit in this repository/u);
  for (const relation of ['rewound', 'diverged']) {
    assert.match(sessionBaseRelationReason(relation, baseSha, baseSha),
      /admit a fresh seat at/u, `${relation} names the way out`);
  }
});
