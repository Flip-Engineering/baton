// Issue #447 (wrapper half) — the projected git wrapper spools a commit observation ONLY for a
// commit made in the seat's own checkout.
//
// OBSERVED (2026-09-18 08:58–10:09Z, the live clone): the ledger collected
// `worktree.commit_recorded` rows for swarm `s1`, participants `peer`/`writer`, written by the
// wave-14 seats' own `node --test` runs — the issue425 / issue438 fixtures build temporary
// repositories under the lane worktree, and every `git commit` there ran the seat's projected
// wrapper. The root-side drain skips an observation naming a swarm this deployment does not hold
// (c3707286), but the wrapper stamps a fixture commit with the SEAT'S OWN identity (swarm,
// participant, workspace), so only the wrapper's own scope rule can stop the row at its source.
//
// The contract this file pins:
//   W1 a lease the deployment records a checkout for spools exactly one observation for a commit
//      in that checkout — the #425 attribution (swarm, participant, workspace, sha, paths) is
//      intact;
//   W2 a commit in a temporary repository created UNDER that checkout spools nothing and
//      succeeds: the wrapper stays transparent to git;
//   W3 a commit in a repository elsewhere on disk — a separate repository, or a worktree of the
//      same repository created by hand — spools nothing;
//   W4 the coordinator records the checkout it confirmed on the seat's lease, so a production
//      seat's own `node --test` run (W2's shape) records no row it did not make.
//
// Hermetic: real git repositories (the seat's checkout is a real `git worktree`), the real
// RuntimeIsolation wrapper, no store, no runtime. The real git is resolved from a wrapper-free
// PATH — this test runs inside a seat whose PATH leads with a projected wrapper, and a fixture
// commit must never pass a second lease's spool.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuntimeIsolation } from '../src/runtime-isolation.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';

const SWARM = 's1';
const SEAT = 'peer';
const WORKSPACE = `ws-${'a'.repeat(32)}`;

const CLEAN_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
const REAL_GIT = (() => {
  const found = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8', env: { ...process.env, PATH: CLEAN_PATH } });
  return (found.stdout ?? '').trim() || null;
})();
const needsGit = { skip: REAL_GIT ? false : 'git binary unavailable' };

const QUIET_GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0',
};

function fixture(t) {
  const world = mkdtempSync(join(tmpdir(), 'baton-issue447-wrapper-'));
  const repo = join(world, 'repo');
  mkdirSync(repo);
  const git = (args, cwd = repo) => execFileSync(REAL_GIT, args, {
    cwd, encoding: 'utf8', env: { ...process.env, ...QUIET_GIT_ENV },
  }).trim();
  const initRepo = (dir) => {
    mkdirSync(dir, { recursive: true });
    git(['init', '-q'], dir);
    Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 447', GIT_COMMITTER_NAME: 'Issue 447' });
    Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue447@example.invalid', GIT_COMMITTER_EMAIL: 'issue447@example.invalid' });
  };
  // The deployment's repository, and the seat's own checkout: a real lane worktree of it, the
  // shape worktree.mjs mints for every seat.
  initRepo(repo);
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(['add', 'base.txt']);
  git(['commit', '-qm', 'base']);
  const checkout = join(repo, '.baton', 'wt', WORKSPACE);
  mkdirSync(join(repo, '.baton', 'wt'), { recursive: true });
  git(['worktree', 'add', '-b', `baton/${WORKSPACE}`, checkout, 'HEAD']);
  const scopes = new RuntimeIsolation({
    repoRoot: repo,
    baseEnv: { PATH: CLEAN_PATH, HOME: '/nonexistent-operator-home', LANG: 'C' },
  });
  t.after(() => rmSync(world, { recursive: true, force: true }));
  return { world, repo, checkout, scopes, git, initRepo };
}

/** One lease, with the seat's live writer projection — the checkout identity is the caller's. */
const seatLease = (scopes, workerId, selection = {}) => {
  const lease = scopes.create(workerId, { card: { harness: 'omp' }, ...selection });
  scopes.projectWriterCoupling(workerId, { workspaceId: WORKSPACE, couplingId: '', writer: '' });
  return lease;
};

/** A commit made by the seat's own hand: the checkout's projected wrapper answers `git`. */
const commitThrough = (scope, dir, name) => {
  writeFileSync(join(dir, name), `${name}\n`);
  const env = {
    ...scope.env, ...QUIET_GIT_ENV,
    BATON_SWARM_BRIDGE_SWARM_ID: SWARM, BATON_SWARM_BRIDGE_PARTICIPANT_ID: SEAT,
  };
  const gitBin = join(scope.paths.bin, 'git');
  const staged = spawnSync(gitBin, ['add', name], { cwd: dir, env, encoding: 'utf8' });
  if (staged.status !== 0) return staged;
  return spawnSync(gitBin, ['commit', '-m', name], { cwd: dir, env, encoding: 'utf8' });
};

test('447a: a commit in the seat\'s own checkout spools one observation naming the seat', needsGit, (t) => {
  const f = fixture(t);
  const lease = seatLease(f.scopes, 'w-seat');
  assert.equal(f.scopes.projectCheckout('w-seat', f.checkout), true,
    'the lease records the checkout the seat works in');

  const committed = commitThrough(lease, f.checkout, 'own.txt');
  assert.equal(committed.status, 0, committed.stderr);

  const observations = f.scopes.takeCommitObservations();
  assert.equal(observations.length, 1, 'the seat\'s own commit is observed once');
  assert.deepEqual({
    swarmId: observations[0].swarmId,
    participantId: observations[0].participantId,
    workspaceId: observations[0].workspaceId,
    paths: observations[0].paths,
  }, {
    swarmId: SWARM, participantId: SEAT, workspaceId: WORKSPACE, paths: ['own.txt'],
  }, 'the observation names the seat\'s swarm, participant and workspace');
  assert.match(observations[0].sha ?? '', /^[0-9a-f]{40,64}$/u, 'and the commit it observed');
});

test('447b: a commit in a fixture repository under the checkout spools nothing and succeeds', needsGit, (t) => {
  const f = fixture(t);
  const lease = seatLease(f.scopes, 'w-seat', { checkout: f.checkout });

  // The fixture shape that polluted the live ledger: a temporary repository created under the
  // seat's checkout, committed by a test the seat ran there.
  const fixtureRepo = join(f.checkout, '.fixture', 'repo');
  f.initRepo(fixtureRepo);
  writeFileSync(join(fixtureRepo, 'seed.txt'), 'seed\n');
  f.git(['add', 'seed.txt'], fixtureRepo);
  f.git(['commit', '-qm', 'seed'], fixtureRepo);

  const committed = commitThrough(lease, fixtureRepo, 'one.txt');
  assert.equal(committed.status, 0, 'the wrapper never refuses a commit outside its checkout');
  assert.deepEqual(f.scopes.takeCommitObservations(), [],
    'a repository that is not the seat\'s checkout spools no observation');
});

test('447c: a commit in a repository elsewhere on disk spools nothing', needsGit, (t) => {
  const f = fixture(t);
  const lease = seatLease(f.scopes, 'w-seat', { checkout: f.checkout });

  const elsewhere = join(f.world, 'elsewhere');
  f.initRepo(elsewhere);
  writeFileSync(join(elsewhere, 'seed.txt'), 'seed\n');
  f.git(['add', 'seed.txt'], elsewhere);
  f.git(['commit', '-qm', 'seed'], elsewhere);
  assert.equal(commitThrough(lease, elsewhere, 'other.txt').status, 0, 'the commit lands');
  assert.deepEqual(f.scopes.takeCommitObservations(), [], 'a separate repository spools nothing');

  // The same repository, a checkout made by hand: the identity is the PATH the lease was
  // installed for, never "a worktree of the deployment's repository".
  const handMade = join(f.world, 'scratch-wt');
  f.git(['worktree', 'add', '-b', 'scratch', handMade, 'HEAD'], f.checkout);
  assert.equal(commitThrough(lease, handMade, 'scratch.txt').status, 0, 'the commit lands');
  assert.deepEqual(f.scopes.takeCommitObservations(), [],
    'a hand-made worktree of the same repository is not the seat\'s checkout');
});

class SeamAdapter {
  constructor() {
    this._card = {
      harness: 'mock', version: '1.0.0', authPosture: 'api_key',
      concurrencyCeiling: null, maxContext: 100000, verbs: { spawn: 'native' },
    };
    this.spawned = [];
  }
  card() { return this._card; }
  onEvent() { /* no seat events in this row */ }
  async spawn(worker) { this.spawned.push(worker); return { ok: true }; }
}

const makeBrief = (overrides = {}) => ({
  goal: 'do the thing',
  constraints: [],
  pathScope: ['.'],
  definitionOfDone: 'tests pass',
  verification: { command: 'true', expectExit: 0 },
  budget: { tokens: 100000, usd: 5, wallMin: 30 },
  ...overrides,
});

test('447d: the coordinator records the confirmed checkout on the seat\'s lease', needsGit, async (t) => {
  const f = fixture(t);
  const scopes = new RuntimeIsolation({
    repoRoot: f.repo,
    baseEnv: { PATH: CLEAN_PATH, HOME: '/nonexistent-operator-home', LANG: 'C' },
  });
  const log = new Log(join(f.world, 'log'));
  let minted = null;
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters: { mock: new SeamAdapter() },
    worktrees: {
      // The deployment's own manager mints the lane worktree a seat works in.
      create: (taskId) => {
        minted = join(f.repo, '.baton', 'wt', taskId);
        f.git(['worktree', 'add', '-b', `baton/${taskId}`, minted, 'HEAD']);
        return { path: minted, branch: `baton/${taskId}`, baseSha: f.git(['rev-parse', 'HEAD'], minted) };
      },
      worktreeAvailable: () => true,
      remove: async () => {},
    },
    referee: async () => ({ reverified: true, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock',
    runtimeScopes: scopes,
  });
  t.after(() => { try { coordinator.closeAuthority(); } catch { /* the row's seat is never reaped */ } });

  const handle = await coordinator.spawn('mock', makeBrief());
  const seat = coordinator._workers.get(handle.id);
  assert.ok(seat?.worktreeReady, 'the seat owns a worktree readiness gate');
  await seat.worktreeReady;
  assert.equal(seat.worktree, minted, 'the seat\'s checkout is confirmed');
  const lease = seat.runtimeLease;
  assert.ok(lease, 'the spawn installed a runtime lease');
  scopes.projectWriterCoupling(seat.id, { workspaceId: WORKSPACE, couplingId: '', writer: '' });

  // The seat's own commit is attributed...
  const own = commitThrough(lease, seat.worktree, 'seat.txt');
  assert.equal(own.status, 0, own.stderr);
  assert.deepEqual(
    scopes.takeCommitObservations().map((row) => [row.participantId, row.paths]),
    [[SEAT, ['seat.txt']]],
    'the confirmed checkout is the seat\'s own: its commit is attributed',
  );

  // ...and the fixture run that follows it records nothing.
  const fixtureRepo = join(seat.worktree, '.fixture', 'repo');
  f.initRepo(fixtureRepo);
  writeFileSync(join(fixtureRepo, 'seed.txt'), 'seed\n');
  f.git(['add', 'seed.txt'], fixtureRepo);
  f.git(['commit', '-qm', 'seed'], fixtureRepo);
  assert.equal(commitThrough(lease, fixtureRepo, 'one.txt').status, 0, 'the fixture commit lands');
  assert.deepEqual(scopes.takeCommitObservations(), [],
    'a seat spawned by the coordinator records no commit row it did not make');
});
