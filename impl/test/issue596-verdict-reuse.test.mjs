// Issue #596 — a landing whose target moves under its gate must not lose the verdict.
//
// The root's rule: when the target moves during a landing's gate run, `swarm integrate` re-bases
// the squash onto the head the target now carries. A clean re-base LANDS ON THE VERDICT THE GATE
// ALREADY PRODUCED, with no re-run of any test; a conflicting re-base refuses exactly as a
// conflicting prepare does. These rows drive the real `landContribution` with a gate that moves
// the target from inside the run, which is the only place the race can be observed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { landContribution } from '../src/worktree.mjs';

const QUIET_GIT_ENV = { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
}).trim();

/** The one path the lane commit moves. */
const LANE_FILE = 'impl/src/lane.mjs';

function write(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** A repository whose lane branch carries one commit ahead of master, and a bare remote the
 * landing can publish to. `record` lands a target-side commit — the move under the gate. */
function world(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-596-'));
  const repo = join(directory, 'repo');
  const remote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  execFileSync('git', ['init', '-q', '--bare', remote], { env: { ...process.env, ...QUIET_GIT_ENV } });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 596', GIT_COMMITTER_NAME: 'Issue 596' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue596@example.invalid', GIT_COMMITTER_EMAIL: 'issue596@example.invalid' });
  write(repo, 'README.md', 'base\n');
  write(repo, LANE_FILE, 'export const lane = 1;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  git(repo, 'checkout', '-q', '-b', 'baton/lane-1');
  write(repo, LANE_FILE, 'export const lane = 2;\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane work');
  const tip = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', 'master');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const record = (path, content, message) => {
    write(repo, path, content);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', message);
    return git(repo, 'rev-parse', 'HEAD');
  };
  return { repo, remote, tip, record };
}

const request = (w, runGates) => ({
  contributionId: 'c596', target: 'master', commitSha: w.tip, message: 'lane work',
  publishRemote: w.remote,
  author: { name: 'lane-a', email: 'lane-a@baton.invalid' },
  committer: { name: 'root', email: 'root@baton.invalid' },
  runGates,
});

test('596a: a target that moves under the gate lands on the verdict already produced', needsGit, async (t) => {
  const w = world(t);
  const runs = [];
  let movedHead = null;
  const answer = await landContribution(w.repo, request(w, async (dir, changed, ctx) => {
    runs.push({ squashSha: ctx.squashSha, changed: [...changed] });
    movedHead = w.record('impl/src/other.mjs', 'export const other = 1;\n', 'unrelated target work');
    return {
      files: ['test/lane.test.mjs'],
      verdictLine: `green — passed 3, squash ${ctx.squashSha.slice(0, 12)}`,
      unexpected: [],
    };
  }));

  assert.equal(runs.length, 1, 'the gate ran ONCE: the verdict was re-used, never re-produced');
  assert.notEqual(answer.squashSha, runs[0].squashSha, 'the landed squash is the re-based one');
  assert.equal(answer.gates.verdictSquash, runs[0].squashSha,
    'the receipt names the commit the verdict judged, never the one that landed');
  assert.equal(answer.gates.reboundOnto, movedHead, 'and the head the re-base took');
  assert.equal(answer.targetHeadBefore, movedHead, 'the landing recorded the head it re-based onto');
  assert.equal(git(w.repo, 'rev-parse', 'master'), answer.squashSha, 'the target holds the re-based squash');
  assert.deepEqual(answer.changedPaths, [LANE_FILE], 'the receipt names what the landed squash carries');
  assert.match(answer.gates.verdictLine, /^green/u, 'the verdict is the run the gate produced');
});

test('596b: a target move the squash cannot re-base onto refuses as a conflict', needsGit, async (t) => {
  const w = world(t);
  let movedHead = null;
  const error = await landContribution(w.repo, request(w, async () => {
    movedHead = w.record(LANE_FILE, 'export const lane = "target";\n', 'target moved the same file');
    return { files: ['test/lane.test.mjs'], verdictLine: 'green', unexpected: [] };
  })).then(() => null, (thrown) => thrown);

  assert.ok(error, 'the landing refused rather than landing a squash it could not re-base');
  assert.equal(error.code, 'integrate_conflict', 'a conflicting re-base keeps the conflict vocabulary');
  assert.equal(git(w.repo, 'rev-parse', 'master'), movedHead, 'nothing moved the target');
});

test('596c: a target that does not move lands as before and discloses no re-base', needsGit, async (t) => {
  const w = world(t);
  const runs = [];
  const answer = await landContribution(w.repo, request(w, async (dir, changed, ctx) => {
    runs.push(ctx.squashSha);
    return { files: ['test/lane.test.mjs'], verdictLine: 'green — passed 3', unexpected: [] };
  }));

  assert.equal(runs.length, 1, 'one gate run');
  assert.equal(answer.squashSha, runs[0], 'the squash the gate judged is the one that landed');
  assert.equal(Object.hasOwn(answer.gates, 'verdictSquash'), false, 'no re-base, nothing to disclose');
  assert.equal(Object.hasOwn(answer.gates, 'reboundOnto'), false);
  assert.equal(git(w.repo, 'rev-parse', 'master'), answer.squashSha);
});
