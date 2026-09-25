// issue594-preserve.test.mjs — issue #594: seat work preservation.
//
// The runtime publishes seat work to the deployment's declared shared remote under
// refs/baton/preserve/*: a seat commit on the drain of its own observation, a contribution
// commit when its record lands, and a turn-end snapshot of uncommitted changes built from a
// private index that never touches the worktree. A push that fails is recorded with its cause
// and retried on the next event. Pinned here: the ref naming, the dedupe, the retry, the
// snapshot mechanics, and the runtime wiring that turns the commit drain and a turn boundary
// into pushes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore } from '../src/index.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { WorktreePreserver } from '../src/worktree-preserve.mjs';

const g = (args, cwd) => {
  const ran = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  assert.equal(ran.status, 0, `git ${args.join(' ')} failed: ${ran.stderr}`);
  return ran.stdout.trim();
};

const originRef = (origin, ref) => {
  const ran = spawnSync('git', ['--git-dir', origin, 'rev-parse', ref], { encoding: 'utf8' });
  return ran.status === 0 ? ran.stdout.trim() : null;
};

/** One fixture: a bare origin (the declared remote), a seat checkout with a lane branch, and
 * a preserver whose rows land in `rows` for the assertions to count. */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-594-preserve-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const origin = join(directory, 'origin.git');
  g(['init', '--bare', '--initial-branch', 'baton/lane-1', origin]);
  const checkout = join(directory, 'checkout');
  mkdirSync(checkout);
  g(['init', '--initial-branch', 'baton/lane-1', checkout]);
  g(['config', 'user.email', 'lane@test'], checkout);
  g(['config', 'user.name', 'lane'], checkout);
  writeFileSync(join(checkout, 'file.txt'), 'one\n');
  g(['add', '.'], checkout);
  g(['commit', '-m', 'one'], checkout);
  const rows = [];
  const preserver = new WorktreePreserver({
    repoRoot: checkout, remote: origin,
    record: (kind, payload, key) => rows.push({ kind, payload, key }),
  });
  return { directory, origin, checkout, preserver, rows };
}

const commitAll = (checkout, message) => {
  g(['add', '-A'], checkout);
  g(['commit', '-m', message], checkout);
  return g(['rev-parse', 'HEAD'], checkout);
};

test('594-t1: a seat commit publishes to its seat-and-branch preserve ref, once', (t) => {
  const f = fixture(t);
  const sha = g(['rev-parse', 'HEAD'], f.checkout);
  f.preserver.preserveCommit({ swarmId: 's1', participantId: 'lane', workspaceId: 'ws-1', sha, work: 'commit' });
  assert.equal(originRef(f.origin, 'refs/baton/preserve/branches/lane/baton/lane-1'), sha,
    'the preserve ref names the seat and the branch, and carries the commit');
  assert.equal(f.rows.filter((row) => row.kind === 'worktree.preserve_pushed').length, 1, 'one pushed row');
  f.preserver.preserveCommit({ swarmId: 's1', participantId: 'lane', sha, work: 'commit' });
  assert.equal(f.rows.filter((row) => row.kind === 'worktree.preserve_pushed').length, 1,
    'the same commit pushes once — the dedupe answers the replayed event');
});

test('594-t3: a failed push records its cause and the next event retries it', (t) => {
  const f = fixture(t);
  const first = g(['rev-parse', 'HEAD'], f.checkout);
  f.preserver.preserveCommit({ swarmId: 's1', participantId: 'lane', sha: first, work: 'commit' });
  rmSync(f.origin, { recursive: true, force: true });
  writeFileSync(join(f.checkout, 'file.txt'), 'one\ntwo\n');
  const second = commitAll(f.checkout, 'two');
  f.preserver.preserveCommit({ swarmId: 's1', participantId: 'lane', sha: second, work: 'commit' });
  const failed = f.rows.filter((row) => row.kind === 'worktree.preserve_failed');
  assert.equal(failed.length, 1, 'one failed row');
  assert.equal(failed[0].payload.sha, second, 'the row names the commit that did not publish');
  assert.match(failed[0].payload.cause, /./, 'the row records the cause the push reported');
  g(['init', '--bare', '--initial-branch', 'baton/lane-1', f.origin]);
  f.preserver.preserveCommit({ swarmId: 's1', participantId: 'lane', sha: second, work: 'commit' });
  assert.equal(originRef(f.origin, 'refs/baton/preserve/branches/lane/baton/lane-1'), second,
    'the retried push carries the newest tip, and the newest tip carries the older commit');
});

test('594-t4: the turn-end snapshot publishes uncommitted work and touches nothing', (t) => {
  const f = fixture(t);
  const head = g(['rev-parse', 'HEAD'], f.checkout);
  writeFileSync(join(f.checkout, 'draft.txt'), 'unfinished\n');
  const dirtyBefore = g(['status', '--porcelain'], f.checkout);
  f.preserver.preserveUncommitted({ swarmId: 's1', participantId: 'lane', worktree: f.checkout });
  const snapshot = originRef(f.origin, 'refs/baton/preserve/uncommitted/lane');
  assert.match(snapshot, /^[a-f0-9]{40}$/, 'the snapshot is published under the seat ref');
  assert.match(g(['ls-tree', '--name-only', snapshot], f.checkout), /draft\.txt/,
    'the snapshot tree carries the uncommitted file');
  assert.equal(g(['rev-parse', `${snapshot}^`], f.checkout), head, 'the snapshot commits against the checkout HEAD');
  assert.equal(g(['status', '--porcelain'], f.checkout), dirtyBefore, 'the worktree keeps its dirty state');
  assert.equal(g(['rev-parse', 'HEAD'], f.checkout), head, 'the worktree HEAD never moved');
  const pushed = f.rows.filter((row) => row.kind === 'worktree.preserve_pushed' && row.payload.work === 'uncommitted');
  f.preserver.preserveUncommitted({ swarmId: 's1', participantId: 'lane', worktree: f.checkout });
  assert.equal(f.rows.filter((row) => row.kind === 'worktree.preserve_pushed' && row.payload.work === 'uncommitted').length, 1,
    'the same state snapshots once — the ref already holds that tree');
});

test('594-t5: a clean checkout records nothing', (t) => {
  const f = fixture(t);
  f.preserver.preserveUncommitted({ swarmId: 's1', participantId: 'lane', worktree: f.checkout });
  assert.equal(f.rows.length, 0, 'nothing uncommitted means no rows and no push');
});

test('594-t6: the runtime drains a commit observation into a push, and a turn boundary into a snapshot', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-594-runtime-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const origin = join(directory, 'origin.git');
  g(['init', '--bare', '--initial-branch', 'baton/lane-1', origin]);
  const checkout = join(directory, 'checkout');
  mkdirSync(checkout);
  g(['init', '--initial-branch', 'baton/lane-1', checkout]);
  g(['config', 'user.email', 'lane@test'], checkout);
  g(['config', 'user.name', 'lane'], checkout);
  writeFileSync(join(checkout, 'file.txt'), 'one\n');
  g(['add', '.'], checkout);
  g(['commit', '-m', 'one'], checkout);

  const store = new CoordinationStore(directory);
  const observations = [];
  const workers = [];
  const coordinator = {
    _runtimeScopes: { takeCommitObservations: () => observations.splice(0), leases: new Map() },
    list: () => workers,
    liveWorkspaceHolders: () => [],
    pausedTurns: () => [],
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      workers.push({ id: 'w-1', taskId: 't-1', runId: request.runId, status: 'working',
        turnEpoch: 0, sessionContext: { worktree: checkout, repoRoot: checkout, ownerTaskId: 'ws-1' } });
    },
    integration: { repoRoot: checkout, publishRemote: origin },
  });
  const key = { n: 0 };
  const call = (command, args = {}) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `k-${++key.n}` }), ...args },
    { actor: 'owner', principalId: 'owner', sessionId: 's' });
  await call('create', { purpose: 'preserve wiring (#594)' });
  await call('recruit', { participantId: 'lane', objective: 'hold the lane' });

  const sha = g(['rev-parse', 'HEAD'], checkout);
  observations.push({ swarmId: 'baton', participantId: 'lane', workerId: 'w-1', workspaceId: 'ws-1', sha, at: '2026-09-25T18:00:00.000Z' });
  runtime._drainCommitObservations();
  assert.equal(originRef(origin, 'refs/baton/preserve/branches/lane/baton/lane-1'), sha,
    'the drained observation is published to the seat-and-branch ref');

  writeFileSync(join(checkout, 'draft.txt'), 'unfinished\n');
  workers[0].turnEpoch = 1;
  runtime._drainCommitObservations();
  const snapshot = originRef(origin, 'refs/baton/preserve/uncommitted/lane');
  assert.match(snapshot, /^[a-f0-9]{40}$/, 'the turn boundary published the uncommitted state');

  const view = await call('view', {});
  const seat = (view.participants ?? []).find((row) => row.participantId === 'lane');
  assert.equal(seat.workspace.preserved.work, 'uncommitted', 'the view names the newest preserved push');
  assert.equal(seat.workspace.unpreserved, false, 'the seat holds no unpreserved committed work');
  assert.equal(originRef(origin, 'refs/baton/preserve/branches/lane/baton/lane-1'), sha,
    'and the branch ref still names the seat commit');
});
