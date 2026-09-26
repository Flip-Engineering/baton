// Issue #438 — swarm.view NEVER spawns git on the read path.
//
// OBSERVED (2026-09-18 06:40–06:47Z, resident at master 009e686e, ~45 seats):
//   `baton swarm view swarm-backlog-20260916 --projection participants` answered after 185.9 s
//   with `cli_command_pending: ... outlived this caller's request bound`, and the bounded watch
//   (which answers the outline projection) was wedged the same way. The same view answered in
//   ~2 s before the wave-10 landings.
//
// CAUSE: since #428 the participants composer builds every seat's `workspace` row with LIVE
// reads (branch/HEAD/status per seat), the #301 base derivation re-reads the checkout and the
// deployment target per seat, the #357 change-set read spawns one more `git status` per seat,
// and #425's `_settleCheckoutWriterState` re-projected every checkout's writer state on every
// inspect. On a fleet with checkouts on disk that is O(seats) synchronous spawns per read, on
// the resident's request loop, for every caller (each seat's brief refresh, the root's watch).
//
// The contract this file pins (issue #438):
//   C1 the participants and outline projections spawn NOTHING: the workspace row derives from
//      the durable rows (#428 custody rows, #425 commit rows, the binding's own session
//      context) plus the runtime's change-driven `workspaceObservations` cache, and the row
//      says where its truth came from (`workspace.source` ∈ rows|wrapper|turn|live);
//   C2 an explicit `--participant-id X` read spends at most ONE seat's worth of live reads,
//      and that spend does not grow with the roster;
//   C3 a commit the seat's projected wrapper reports lands in the cache with source `wrapper`
//      and the next view shows the new headSha without spawning;
//   C4 the participants view over N=40 seats with checkouts answers inside the transport's
//      request bound (the #394 `web.wait_ceiling_ms` registry row, never a literal).
//
// Hermetic: a real git repository with real lane worktrees, a real CoordinationStore, the real
// RuntimeIsolation commit spool (#425), and a PATH shim that counts (and can slow) every git
// spawn the runtime makes — the spy is the OS-level spawn, so it cannot be fooled by a second
// authority. The test's own git calls go through the resolved real binary.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';
import { WEB_WAIT_CEILING_ROW } from '../src/limits.mjs';

const principal = { actor: 'direct:issue438-root', principalId: 'issue438-root', sessionId: 'issue438-root' };
const SWARM = 'view-no-spawn';
const GIT_SPAWN_DELAY_ENV = 'BATON_ISSUE438_GIT_DELAY';
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

/** The real git the shim forwards to: resolved BEFORE any shim is on PATH. */
const REAL_GIT = (() => {
  const found = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' });
  const path = (found.stdout ?? '').trim();
  return path.length > 0 ? path : null;
})();

const wsId = (index) => `ws-${String(index).padStart(2, '0').repeat(16)}`.slice(0, 35);
const seatName = (index) => `seat-${index}`;
const workerName = (index) => `w-${index}`;

function fixture(t) {
  const world = mkdtempSync(join(tmpdir(), 'baton-issue438-'));
  const repo = join(world, 'repo');
  const bin = join(world, 'bin');
  const spool = join(world, 'git-spawns.log');
  mkdirSync(repo); mkdirSync(bin);
  writeFileSync(spool, '');
  const git = (args, cwd = repo) => execFileSync(REAL_GIT, args, {
    cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
  }).trim();
  git(['init', '-q']);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 438', GIT_COMMITTER_NAME: 'Issue 438' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue438@example.invalid', GIT_COMMITTER_EMAIL: 'issue438@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  git(['add', 'base.txt']);
  git(['commit', '-qm', 'base']);

  // The counting (and optionally slowing) shim: every runtime spawn is one line, then the real
  // git runs with argv and env intact — the read path sees no difference but the count.
  const shim = join(bin, 'git');
  writeFileSync(shim, `#!/bin/sh
printf 'spawn\\n' >> ${JSON.stringify(spool)}
if [ -n "$${GIT_SPAWN_DELAY_ENV}" ]; then sleep "$${GIT_SPAWN_DELAY_ENV}"; fi
exec ${JSON.stringify(REAL_GIT)} "$@"
`);
  chmodSync(shim, 0o755);

  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}:${priorPath ?? ''}`;
  delete process.env[GIT_SPAWN_DELAY_ENV];
  t.after(() => {
    process.env.PATH = priorPath;
    delete process.env[GIT_SPAWN_DELAY_ENV];
    rmSync(world, { recursive: true, force: true });
  });

  const store = new CoordinationStore(world);
  const workers = [];
  const scopes = new RuntimeIsolation({
    repoRoot: repo,
    baseEnv: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent-operator-home', LANG: 'C' },
  });
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers,
      pausedTurns: () => [],
      liveWorkspaceHolders: () => [],
      // The checkout the binding records: the durable workspace identity a dead seat's row
      // derives from, exactly as the real coordinator's attachment answers for a binding.
      workspaceAttachment: (workerId) => {
        const index = workers.findIndex((row) => row.id === workerId);
        return index < 0 ? null : { workspaceId: wsId(index), holderCount: 1 };
      },
      _runtimeScopes: scopes,
    },
    authorize: async () => {},
    prepareRun: async (request) => request,
    startRun: async (request) => {
      workers.push({ id: workerName(workers.length), taskId: `t-${workers.length}`,
        runId: request.runId, status: 'working' });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  t.after(() => {
    runtime.close();
    try { store.releaseWriterLease({ requireOwned: true }); } catch { /* swept with the world */ }
  });

  const call = (command, args = {}, caller = principal) => runtime.command(`swarm.${command}`,
    { swarmId: SWARM, ...args }, caller);
  const recruit = async (index) => {
    await call('recruit', { participantId: seatName(index), objective: `Work as ${seatName(index)}`,
      idempotencyKey: `i438:recruit:${index}` });
    const worker = workers[workers.length - 1];
    const branch = `baton/${seatName(index)}`;
    const worktree = join(repo, '.baton', 'wt', wsId(index));
    mkdirSync(join(repo, '.baton', 'wt'), { recursive: true });
    git(['worktree', 'add', '-b', branch, worktree, 'HEAD']);
    worker.sessionContext = {
      worktree, repoRoot: repo, ownerTaskId: wsId(index), branch,
      baseSha: git(['rev-parse', 'HEAD'], worktree), ownerReceiptDigest: null,
    };
    store.recordSwarm('swarm.participant_bound', {
      swarmId: SWARM, participantId: seatName(index), workerId: worker.id, taskId: worker.taskId,
    }, { actor: principal.actor, key: `i438:bind:${index}` });
    return worker;
  };
  const spawns = () => readFileSync(spool, 'utf8').split('\n').filter((line) => line.length > 0).length;
  return { world, repo, git, store, workers, scopes, runtime, call, recruit, spawns };
}

test('438a: the participants and outline projections spawn NOTHING, and the row still tells its truth', needsGit, async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'no spawn on the read path', idempotencyKey: 'i438:create:a' });
  for (let index = 0; index < 6; index += 1) await f.recruit(index);
  // A seat whose worker is gone: its workspace truth can only come from the durable rows.
  f.workers.find((row) => row.runId === f.store.swarm(SWARM).participants[seatName(5)].runId).status = 'exited';

  const before = f.spawns();
  const participants = await f.call('view', { projection: 'participants' });
  const afterParticipants = f.spawns();
  assert.equal(afterParticipants - before, 0,
    'the participants projection spawns no git at all');

  const outline = await f.call('view', { projection: 'outline' });
  assert.equal(f.spawns() - afterParticipants, 0, 'the outline projection spawns no git at all');
  assert.equal(outline.participants, undefined, 'the outline carries no rows');

  // The row is not empty: it derives its facts from the rows and the cache, and SAYS so.
  const byId = Object.fromEntries(participants.participants.map((row) => [row.participantId, row]));
  const live = byId[seatName(0)].workspace;
  assert.equal(live.workspaceId, wsId(0));
  assert.equal(live.branch, `baton/${seatName(0)}`);
  assert.equal(live.headSha, f.git(['rev-parse', 'HEAD'], join(f.repo, '.baton', 'wt', wsId(0))));
  assert.equal(live.dirty, false);
  assert.equal(live.source, 'rows', 'an unobserved seat names the rows it derived from');
  const gone = byId[seatName(5)].workspace;
  assert.equal(gone.source, 'rows');
  assert.equal(gone.workspaceId, wsId(5));
});

test('438b: an explicit --participant-id read spends at most one seat of live reads, whatever the roster', needsGit, async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'scoped read stays bounded', idempotencyKey: 'i438:create:b' });
  for (let index = 0; index < 12; index += 1) await f.recruit(index);

  const before = f.spawns();
  const scoped = await f.call('view', { participantId: seatName(3), projection: 'participants' });
  const spent = f.spawns() - before;
  assert.ok(spent <= 8, `a scoped read spends one seat's worth of reads, not the roster (spent ${spent})`);
  const row = scoped.participants.find((candidate) => candidate.participantId === seatName(3));
  assert.equal(row.workspace.source, 'live', 'the named seat\'s row is the live one');
  assert.equal(row.workspace.headSha,
    f.git(['rev-parse', 'HEAD'], join(f.repo, '.baton', 'wt', wsId(3))));

  // The spend does not follow the roster: two more seats do not cost two more seats of reads.
  await f.recruit(12);
  await f.recruit(13);
  const beforeTwelve = f.spawns();
  await f.call('view', { participantId: seatName(3), projection: 'participants' });
  assert.equal(f.spawns() - beforeTwelve, spent,
    'a scoped read costs the SAME with a larger roster — never per seat');
});

test('438c: a wrapper-reported commit lands with source wrapper, and the next view shows it without spawning', needsGit, async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'wrapper truth is cached, not re-read', idempotencyKey: 'i438:create:c' });
  const worker = await f.recruit(0);
  const scope = f.scopes.create(worker.id, 'codex');
  const worktree = join(f.repo, '.baton', 'wt', wsId(0));

  writeFileSync(join(worktree, 'landed.txt'), 'landed\n');
  const seatGit = spawnSync(REAL_GIT, ['add', 'landed.txt'], { cwd: worktree, encoding: 'utf8' });
  assert.equal(seatGit.status, 0);
  const committed = spawnSync(join(scope.paths.bin, 'git'), ['commit', '-m', 'landed'], {
    cwd: worktree, encoding: 'utf8',
    env: { ...scope.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
      BATON_SWARM_BRIDGE_SWARM_ID: SWARM, BATON_SWARM_BRIDGE_PARTICIPANT_ID: seatName(0) },
  });
  assert.equal(committed.status, 0, committed.stderr);
  const sha = f.git(['rev-parse', 'HEAD'], worktree);

  const before = f.spawns();
  const view = await f.call('view', { projection: 'participants' });
  assert.equal(f.spawns() - before, 0, 'draining the wrapper spool spawns nothing');
  const row = view.participants.find((candidate) => candidate.participantId === seatName(0));
  assert.equal(row.workspace.headSha, sha, 'the wrapper-reported head is projected');
  assert.equal(row.workspace.source, 'wrapper', 'and the row says where the head came from');
  assert.ok(Array.isArray(row.workspace.commits), 'the commit row list still rides the workspace');
});

test('438d: the participants view over 40 seats with checkouts answers inside the transport bound', needsGit, async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'the roster read is bounded', idempotencyKey: 'i438:create:d' });
  for (let index = 0; index < 40; index += 1) await f.recruit(index);

  // From here every runtime spawn costs real wall time (the shim), so the row measures exactly
  // what the resident pays: the transport's own request bound is the ceiling it must fit.
  process.env[GIT_SPAWN_DELAY_ENV] = '0.1';
  const started = Date.now();
  const view = await f.call('view', { projection: 'participants' });
  const elapsed = Date.now() - started;
  assert.equal(view.participants.length, 40);
  assert.ok(elapsed < WEB_WAIT_CEILING_ROW.value,
    `the participants view answered in ${elapsed} ms, inside the ${WEB_WAIT_CEILING_ROW.lane} bound of ${WEB_WAIT_CEILING_ROW.value} ms`);
});

test('438e: the seat\'s turn seam re-observes the checkout once — source turn — and the roster never pays', needsGit, async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'the turn seam is the change signal', idempotencyKey: 'i438:create:e' });
  const worker = await f.recruit(0);
  const worktree = join(f.repo, '.baton', 'wt', wsId(0));
  worker.turnEpoch = 1;
  // The record view observes the checkout once, recording the turn seam it was taken under,
  // and every later view of the same seam re-observes nothing.
  const opened = await f.call('view', {});
  assert.equal(opened.participants[0].workspace.source, 'live');
  const beforeSteady = f.spawns();
  await f.call('view', {});
  const steady = f.spawns() - beforeSteady;
  assert.ok(steady > 0, 'the record view reads the live base (#301) for the seat — the control cost');

  // The seat ends its turn (a new fence epoch on its worker row) and writes during the next
  // one. No runtime call announced either move: the epoch the worker row publishes IS the
  // turn boundary the read path can see.
  worker.turnEpoch = 2;
  writeFileSync(join(worktree, 'turn-two.txt'), 'two\n');
  const beforeSeam = f.spawns();
  const view = await f.call('view', {});
  const seam = f.spawns() - beforeSeam;
  assert.ok(seam > steady, `the turn seam costs one observation more than a steady view (${seam} > ${steady})`);
  const row = view.participants.find((candidate) => candidate.participantId === seatName(0));
  assert.equal(row.workspace.source, 'turn', 'the row names the turn seam that refreshed it');
  assert.equal(row.workspace.dirty, true, 'and the dirt the new turn left is visible');

  // The same epoch seen twice is not observed twice: one refresh per turn boundary.
  const beforeSecond = f.spawns();
  const settled = await f.call('view', {});
  assert.equal(f.spawns() - beforeSecond, steady, 'a view of an unchanged seam pays only the base control');
  assert.equal(settled.participants[0].workspace.source, 'turn');

  // The roster never observes: a further turn move is carried by the cache until a read that
  // is allowed to make one runs — the roster itself stays free.
  worker.turnEpoch = 3;
  const beforeRoster = f.spawns();
  const roster = await f.call('view', { projection: 'participants' });
  assert.equal(f.spawns() - beforeRoster, 0, 'the roster spends nothing on the turn seam');
  assert.equal(roster.participants[0].workspace.source, 'turn',
    'the roster carries the last observation, never a read of its own');
});
