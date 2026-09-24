// issue562-snapshot-inherited-paths.test.mjs — issue #562. A lane worktree's base is the
// deployment's own effective-tree snapshot (`repositorySnapshot`, application-deployment.mjs):
// `read-tree HEAD` + `add -A .`, committed under the `baton-snapshot@localhost` identity. So the
// snapshot's tree is the RESIDENT's checkout, and any file the resident held untracked-and-unignored
// when it was taken sits in every lane's base. The landing squashes `merge-base(target, tip)..tip`,
// and the target does not have those files, so before this fix every such file landed on the target
// as the lane's own addition — the observed case being three lane-local codex-*.md documents that
// the deployment root carried and that a landing from any snapshot-based lane would have added.
//
//   562a — an addition whose first commit in the lane's history is the snapshot is NOT landed, and
//           the receipt names it under `inherited`;
//   562b — a file the LANE added (no snapshot commit in its history) still lands, so the filter
//           narrows nothing a lane actually wrote;
//   562c — a lane that MODIFIES an inherited file does not land it either, and the receipt says so
//           rather than dropping the path silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { SNAPSHOT_COMMIT_EMAIL } from '../src/worktree.mjs';

const principal = { actor: 'direct:issue562-root', principalId: 'issue562-root', sessionId: 'issue562-root' };
const QUIET_GIT_ENV = { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

const git = (repo, ...args) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
}).trim();

const gitWith = (repo, env, ...args) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV, ...env },
}).trim();

function write(repo, path, content) {
  const full = join(repo, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const contractBody = ({ subject, sha, branch, observedHead, rebasedOnto }) => ({
  subject,
  base: { observedHead, rebasedOnto },
  commit: { sha, branch },
  items: [{ id: 'lane', status: 'delivered', change: subject, files: ['impl/src/lane.mjs'], test: 'node --test', evidence: 'fixture' }],
  verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
  carriedForward: [],
  needsFromOthers: [],
});

/** A real repository whose lane branch descends from a REAL deployment snapshot commit: `base` is
 * the plain commit the snapshot was taken at, `snapshot` adds the two files the resident's checkout
 * carried untracked (`docs/inherited.md` and `docs/edited.md`), and the lane branch starts there. */
async function world(t, { lane } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue562-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', '-b', 'master', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  git(repo, 'config', 'user.name', 'Issue 562');
  git(repo, 'config', 'user.email', 'issue562@example.invalid');
  write(repo, 'README.md', 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');

  // The resident's effective-tree snapshot: the same content, plus what its checkout had untracked.
  write(repo, 'docs/inherited.md', 'lane-local note the deployment carried\n');
  write(repo, 'docs/edited.md', 'lane-local note the resident also carried\n');
  git(repo, 'add', '-A');
  // `write-tree` reads the INDEX — the step `repositorySnapshot` takes after its own `add -A` — so
  // the snapshot commit carries the untracked files, exactly as the deployment's snapshot does.
  const tree = git(repo, 'write-tree');
  const snapshot = gitWith(repo, {
    GIT_AUTHOR_NAME: 'baton (deployment snapshot)',
    GIT_AUTHOR_EMAIL: SNAPSHOT_COMMIT_EMAIL,
    GIT_COMMITTER_NAME: 'baton (deployment snapshot)',
    GIT_COMMITTER_EMAIL: SNAPSHOT_COMMIT_EMAIL,
  }, 'commit-tree', tree, '-p', base, '-m', 'Baton private effective-tree snapshot');

  const observedHead = snapshot;
  git(repo, 'checkout', '-q', '-b', 'baton/lane-1', snapshot);
  write(repo, 'impl/src/lane.mjs', '// the lane owns this file\n');
  if (lane === 'edit-inherited') write(repo, 'docs/edited.md', 'the lane edited an inherited note\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'lane one (#562)');
  const tip = git(repo, 'rev-parse', 'HEAD');

  git(repo, 'checkout', '-q', 'master');
  const targetHead = git(repo, 'rev-parse', 'master');
  assert.equal(git(repo, 'rev-parse', 'master'), base);

  const remote = join(directory, 'shared.git');
  execFileSync('git', ['init', '-q', '--bare', remote], { env: { ...process.env, ...QUIET_GIT_ENV } });
  const store = new CoordinationStore(join(directory, 'ledger'));
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [] },
    authorize: async () => true,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
    prepareRun: (request) => request,
    integration: {
      repoRoot: repo,
      publishRemote: remote,
      regenerate: async () => {},
      runGates: async (dir, files) => ({ files, verdictLine: `green — ${files.length} file(s)`, unexpected: [] }),
    },
  });
  t.after(() => {
    runtime.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'land the lane', idempotencyKey: 'i562:create' }, principal);
  const record = (kind, payload, key) => store.recordSwarm(kind, { swarmId: 's1', ...payload },
    { actor: principal.actor, key: `i562:${key}` });
  record('swarm.participant_joined', { participantId: 'lane-a', role: 'Builder' }, 'join');
  record('swarm.work_updated', { workId: 'w1', objective: 'land the lane' }, 'work');
  record('swarm.contribution_recorded', {
    contributionId: 'contribution:1', participantId: 'lane-a', workId: 'w1',
    body: contractBody({ subject: 'Land the lane', sha: tip, branch: 'baton/lane-1', observedHead, rebasedOnto: targetHead }),
  }, 'contribution');
  record('swarm.contribution_reviewed',
    { contributionId: 'contribution:1', decision: 'accept', reviewerId: 'lane-a', reason: 'verified' }, 'accept');

  const integrate = () => runtime.command('swarm.integrate', {
    swarmId: 's1', contributionId: 'contribution:1', target: 'master', idempotencyKey: 'i562:integrate',
  }, principal);
  const foldRow = () => store.swarm('s1').contributions['contribution:1'];
  return { repo, base, snapshot, tip, integrate, foldRow };
}

const targetHas = (repo, path) => {
  try { git(repo, 'cat-file', '-e', `master:${path}`); return true; } catch { return false; }
};

test('562a: an inherited path is not landed, and the receipt names it', needsGit, async (t) => {
  const w = await world(t);
  await w.integrate();
  const row = w.foldRow();
  assert.equal(row.integration.dryRun, false);
  assert.deepEqual(row.integration.inherited, ['docs/edited.md', 'docs/inherited.md'],
    'both files the deployment checkout carried are named, in order');
  assert.equal(targetHas(w.repo, 'docs/inherited.md'), false, 'the inherited note is not on master');
  assert.equal(targetHas(w.repo, 'docs/edited.md'), false);
  assert.equal(targetHas(w.repo, 'impl/src/lane.mjs'), true, "the lane's own file is on master");
  assert.deepEqual(row.integration.changedPaths, ['impl/src/lane.mjs']);
});

test('562b: a file the lane added itself still lands', needsGit, async (t) => {
  const w = await world(t);
  await w.integrate();
  const row = w.foldRow();
  assert.equal(targetHas(w.repo, 'impl/src/lane.mjs'), true);
  assert.equal(git(w.repo, 'show', 'master:impl/src/lane.mjs'), '// the lane owns this file');
});

test('562c: a lane that edits an inherited path does not land it either, and the receipt says so', needsGit, async (t) => {
  const w = await world(t, { lane: 'edit-inherited' });
  await w.integrate();
  const row = w.foldRow();
  assert.deepEqual(row.integration.inherited, ['docs/edited.md', 'docs/inherited.md'],
    'the path the lane edited is named, never dropped silently');
  assert.equal(targetHas(w.repo, 'docs/edited.md'), false,
    'a resident-carried note does not become repository content because a lane edited it');
});
