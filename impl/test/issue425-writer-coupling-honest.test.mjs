import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeIsolation } from '../src/runtime-isolation.mjs';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const principal = { actor: 'direct:issue425-root', principalId: 'issue425-root', sessionId: 'issue425-root' };
const WORKSPACE_A = `ws-${'a'.repeat(32)}`;
const HAVE_GIT = (() => {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const needsGit = { skip: HAVE_GIT ? false : 'git binary unavailable' };

const QUIET_GIT_ENV = { GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue425-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo], { env: { ...process.env, ...QUIET_GIT_ENV } });
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Issue 425', GIT_COMMITTER_NAME: 'Issue 425' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'issue425@example.invalid', GIT_COMMITTER_EMAIL: 'issue425@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', 'base.txt'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo, env: { ...process.env, ...QUIET_GIT_ENV } });

  const scopes = new RuntimeIsolation({
    repoRoot: repo,
    baseEnv: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: '/nonexistent-operator-home', LANG: 'C' },
  });
  const store = new CoordinationStore(join(directory, 'ledger'));
  const runtime = new SwarmRuntime({
    store,
    coordinator: { list: () => [], _runtimeScopes: scopes },
    authorize: async () => true,
    prepareRun: (request) => request,
    startRun: async () => { throw new Error('no native runs in this fixture'); },
    stopRun: async () => {},
  });
  t.after(() => {
    runtime.close();
    try { store.releaseWriterLease({ requireOwned: true }); } catch { /* swept with the tmpdir */ }
    rmSync(directory, { recursive: true, force: true });
  });
  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'commit attribution', idempotencyKey: 'i425:create' }, principal);
  return { directory, repo, scopes, store, runtime };
}

// The deployment merges the bridge identity env AFTER isolation.create(); the projected
// wrapper reads it at commit time to attribute the act.
const seatEnv = (scope, participantId) => ({
  ...scope.env, ...QUIET_GIT_ENV,
  BATON_SWARM_BRIDGE_SWARM_ID: 's1',
  BATON_SWARM_BRIDGE_PARTICIPANT_ID: participantId,
});

const seatCommit = (repo, scope, participantId, ...paths) => {
  for (const name of paths) writeFileSync(join(repo, name), `${name}\n`);
  const env = seatEnv(scope, participantId);
  spawnSync('git', ['add', ...paths], { cwd: repo, env, encoding: 'utf8' });
  return spawnSync('git', ['commit', '-m', paths.join(' ')], { cwd: repo, env, encoding: 'utf8' });
};

async function seat(t, f, participantId, workspaceId, workerId) {
  await f.store.recordSwarm('swarm.participant_joined', {
    swarmId: 's1', participantId, role: 'builder', ...(workspaceId ? { workspaceId } : {}),
  }, { actor: principal.actor, key: `i425:join:${participantId}` });
  await f.store.recordSwarm('swarm.participant_bound', {
    swarmId: 's1', participantId, workerId, taskId: `t-${workerId}`,
  }, { actor: principal.actor, key: `i425:bind:${participantId}` });
  return f.scopes.create(workerId, 'codex');
}


const rowsOfKind = (store, kind) => store.eventsView().filter((event) => (
  event.kind === 'driver.recorded' ? event.payload?.kind === kind : event.kind === kind));


test('425d: the workspace projection lists commits per seat', needsGit, async (t) => {
  const f = await fixture(t);
  const writerScope = await seat(t, f, 'writer', WORKSPACE_A, 'w-writer');
  const peerScope = await seat(t, f, 'peer', WORKSPACE_A, 'w-peer');

  assert.equal(seatCommit(f.repo, writerScope, 'writer', 'w.txt').status, 0);
  assert.equal(seatCommit(f.repo, peerScope, 'peer', 'p1.txt', 'p2.txt').status, 0);

  const view = await f.runtime.command('swarm.view', { swarmId: 's1', projection: 'workspace' }, principal);
  for (const event of rowsOfKind(f.store, 'worktree.commit_recorded')) {
    assert.equal(event.payload.workspaceId, WORKSPACE_A);
  }
  const byId = Object.fromEntries((view.participants ?? []).map((row) => [row.participantId, row]));
  const peerCommits = byId.peer?.workspace?.commits ?? [];
  const writerCommits = byId.writer?.workspace?.commits ?? [];
  assert.deepEqual(peerCommits.map((row) => row.paths), [['p1.txt', 'p2.txt']],
    'the seat\'s commit row names every path of the commit');
  assert.match(peerCommits[0]?.sha ?? '', /^[0-9a-f]{40,64}$/u);
  assert.deepEqual(writerCommits.map((row) => row.paths), [['w.txt']],
    'commits are listed per seat, not per checkout alone');
});
