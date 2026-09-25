// Issue #425 — the exclusive writer coupling is advisory: a peer committed implementation
// into the shared checkout while another seat held the declared writer coupling, and nothing
// refused, recorded or raised attention. The coupling constrained only who may DECLARE it;
// the checkout was not observed at all.
//
// The contract delivered here (docs/39 §Declared coupling — "the swarm keeps honest"):
//   • the seat's projected git wrapper reads the checkout's live exclusive writer from a
//     projected file the runtime refreshes on every coupling change and binding (written by
//     the ONE component that folds coupling events, in the same synchronous apply path — the
//     read at commit time cannot be stale);
//   • every commit through the wrapper is attributed (`worktree.commit_recorded`);
//   • a NON-writer commit under a live writer coupling records
//     `swarm.coupling_writer_bypassed` and pages BOTH seats (release it, or take it) —
//     never refused: the open team's audit-and-build-on resolution was right, the swarm
//     must SEE it;
//   • the brief carries the writer rule derived from the ONE constant the wrapper embeds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeIsolation, WORKTREE_STASH_BRIEF_SENTENCE } from '../src/runtime-isolation.mjs';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SWARM_NATIVE_GUIDANCE } from '../src/swarm-native-access.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

// Issue #425 lands the brief constant; the soft probe keeps rows (a)–(d) observable red at
// HEAD instead of failing the file at import time.
const { WORKTREE_WRITER_BRIEF_SENTENCE } = await import('../src/runtime-isolation.mjs');

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
  execFileSync('git', ['config', 'user.name', 'Issue 425'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'issue425@example.invalid'], { cwd: repo });
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
  await runtime.command('swarm.create', { swarmId: 's1', purpose: 'writer coupling honesty', idempotencyKey: 'i425:create' }, principal);
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

const writerFileOf = (scopes, workerId) => readFileSync(join(scopes.root, workerId, 'writer-coupling.env'), 'utf8');
const writerStateOf = (scopes, workerId) => Object.fromEntries(writerFileOf(scopes, workerId)
  .split('\n').filter((line) => line.includes('=')).map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }));

async function seat(t, f, participantId, workspaceId, workerId) {
  await f.store.recordSwarm('swarm.participant_joined', {
    swarmId: 's1', participantId, role: 'builder', ...(workspaceId ? { workspaceId } : {}),
  }, { actor: principal.actor, key: `i425:join:${participantId}` });
  await f.store.recordSwarm('swarm.participant_bound', {
    swarmId: 's1', participantId, workerId, taskId: `t-${workerId}`,
  }, { actor: principal.actor, key: `i425:bind:${participantId}` });
  return f.scopes.create(workerId, 'codex');
}

const declareWriter = (f, couplingId, participantId, key) => f.runtime.command('swarm.update', {
  swarmId: 's1', event: 'swarm.coupling_updated',
  payload: { couplingId, coupling: 'writer', action: 'declare', participantId },
  idempotencyKey: key,
}, principal);

const rowsOfKind = (store, kind) => store.eventsView().filter((event) => (
  event.kind === 'driver.recorded' ? event.payload?.kind === kind : event.kind === kind));
const attentionOf = (view, kind) => (view.attention ?? []).filter((row) => row.kind === kind);

test('425a: a non-writer commit under a live writer coupling records the bypass row and pages both seats', needsGit, async (t) => {
  const f = await fixture(t);
  await seat(t, f, 'writer', WORKSPACE_A, 'w-writer');
  const peerScope = await seat(t, f, 'peer', WORKSPACE_A, 'w-peer');
  await declareWriter(f, 'w1', 'writer', 'i425:declare:a');

  // The projected writer file is the one derivation the wrapper reads: the runtime (the ONE
  // component that folds couplings) rewrote it inside the declare's own apply path.
  assert.deepEqual(writerStateOf(f.scopes, 'w-peer'), {
    workspaceId: WORKSPACE_A, couplingId: 'w1', writer: 'writer',
  }, 'the non-writer lease projects the checkout\'s live writer');

  const commit = seatCommit(f.repo, peerScope, 'peer', 'bypass.txt');
  assert.equal(commit.status, 0, 'the wrapper never refuses the non-writer commit');

  const view = await f.runtime.command('swarm.view', { swarmId: 's1' }, principal);

  // Every commit through the wrapper is attributed.
  const commits = rowsOfKind(f.store, 'worktree.commit_recorded');
  assert.equal(commits.length, 1, 'the commit lands as one attribution row');
  assert.deepEqual(commits[0].payload, {
    kind: 'worktree.commit_recorded',
    swarmId: 's1', participantId: 'peer', workspaceId: WORKSPACE_A,
    sha: commits[0].payload.sha, at: commits[0].payload.at, paths: ['bypass.txt'],
  });
  assert.match(commits[0].payload.sha ?? '', /^[0-9a-f]{40,64}$/u, 'the row names the commit sha');

  // The bypass itself is a durable swarm row naming the checkout, the writer and the bypasser.
  const bypasses = rowsOfKind(f.store, 'swarm.coupling_writer_bypassed');
  assert.equal(bypasses.length, 1, 'the bypass lands as one swarm row');
  assert.deepEqual(bypasses[0].payload, {
    swarmId: 's1', couplingId: 'w1', workspaceId: WORKSPACE_A,
    writer: 'writer', by: 'peer', sha: bypasses[0].payload.sha, at: bypasses[0].payload.at,
  });

  // Attention pages BOTH seats with the next action: release the coupling, or take it.
  const paged = attentionOf(view, 'coupling_writer_bypassed');
  assert.equal(paged.length, 2, 'both seats are paged');
  const toWriter = paged.find((row) => row.participantId === 'writer');
  const toPeer = paged.find((row) => row.participantId === 'peer');
  assert.ok(toWriter, 'the writer is paged');
  assert.equal(toWriter.next?.action, 'release', 'the writer\'s remedy is the release');
  assert.equal(toWriter.bypassedBy, 'peer');
  assert.ok(toPeer, 'the bypasser is paged');
  assert.equal(toPeer.next?.action, 'declare', 'the bypasser\'s remedy is to take the coupling');

  // The coupling record keeps the bypass as history on the view.
  const record = (view.couplings ?? []).find((row) => row.couplingId === 'w1');
  assert.equal(record?.bypasses?.length, 1, 'the record carries the bypass');
  assert.equal(record.bypasses[0].by, 'peer');
});

test('425b: the writer\'s own commit records only the attribution row', needsGit, async (t) => {
  const f = await fixture(t);
  const writerScope = await seat(t, f, 'writer', WORKSPACE_A, 'w-writer');
  await declareWriter(f, 'w1', 'writer', 'i425:declare:b');
  assert.equal(writerStateOf(f.scopes, 'w-writer').writer, 'writer', 'the writer lease names itself');

  const commit = seatCommit(f.repo, writerScope, 'writer', 'own.txt');
  assert.equal(commit.status, 0, 'the writer commits as usual');

  const view = await f.runtime.command('swarm.view', { swarmId: 's1' }, principal);
  const commits = rowsOfKind(f.store, 'worktree.commit_recorded');
  assert.equal(commits.length, 1, 'the commit is attributed to the writer');
  assert.equal(commits[0].payload.participantId, 'writer');
  assert.deepEqual(commits[0].payload.paths, ['own.txt']);
  assert.equal(rowsOfKind(f.store, 'swarm.coupling_writer_bypassed').length, 0,
    'a writer seat\'s commit records nothing extra');
  assert.equal(attentionOf(view, 'coupling_writer_bypassed').length, 0);
});

test('425c: no live coupling means attribution without bypass, and a release clears the projection', needsGit, async (t) => {
  const f = await fixture(t);
  const peerScope = await seat(t, f, 'peer', WORKSPACE_A, 'w-peer');

  // No coupling was ever declared: the commit is still attributed, never a bypass.
  assert.equal(seatCommit(f.repo, peerScope, 'peer', 'plain.txt').status, 0);
  await f.runtime.command('swarm.view', { swarmId: 's1' }, principal);
  assert.equal(rowsOfKind(f.store, 'worktree.commit_recorded').length, 1, 'the commit is attributed');
  assert.equal(rowsOfKind(f.store, 'swarm.coupling_writer_bypassed').length, 0, 'no coupling, no bypass row');

  // A released coupling is not a live writer: the projection clears and the next commit bypasses nothing.
  await declareWriter(f, 'w1', 'peer', 'i425:declare:c');
  await f.runtime.command('swarm.update', {
    swarmId: 's1', event: 'swarm.coupling_updated',
    payload: { couplingId: 'w1', coupling: 'writer', action: 'release', reason: 'turn done' },
    idempotencyKey: 'i425:release:c',
  }, principal);
  assert.deepEqual(writerStateOf(f.scopes, 'w-peer'), {
    workspaceId: WORKSPACE_A, couplingId: '', writer: '',
  }, 'the release clears the projected writer for the checkout');

  assert.equal(seatCommit(f.repo, peerScope, 'peer', 'after.txt').status, 0);
  const view = await f.runtime.command('swarm.view', { swarmId: 's1' }, principal);
  assert.equal(rowsOfKind(f.store, 'swarm.coupling_writer_bypassed').length, 0,
    'a commit after the release is not a bypass');
  assert.deepEqual(commitsView(f, 'peer').map((row) => row.paths), [['plain.txt'], ['after.txt']],
    'both commits stay attributed to the seat');
});
const commitsView = (f, participantId) => {
  const rows = rowsOfKind(f.store, 'worktree.commit_recorded')
    .filter((event) => event.payload?.participantId === participantId);
  return rows.map((event) => ({ sha: event.payload.sha, paths: event.payload.paths }));
};

test('425d: the workspace projection lists commits per seat', needsGit, async (t) => {
  const f = await fixture(t);
  const writerScope = await seat(t, f, 'writer', WORKSPACE_A, 'w-writer');
  const peerScope = await seat(t, f, 'peer', WORKSPACE_A, 'w-peer');
  await declareWriter(f, 'w1', 'writer', 'i425:declare:d');

  assert.equal(seatCommit(f.repo, writerScope, 'writer', 'w.txt').status, 0);
  assert.equal(seatCommit(f.repo, peerScope, 'peer', 'p1.txt', 'p2.txt').status, 0);

  const view = await f.runtime.command('swarm.view', { swarmId: 's1', projection: 'workspace' }, principal);
  const byId = Object.fromEntries((view.participants ?? []).map((row) => [row.participantId, row]));
  const peerCommits = byId.peer?.workspace?.commits ?? [];
  const writerCommits = byId.writer?.workspace?.commits ?? [];
  assert.deepEqual(peerCommits.map((row) => row.paths), [['p1.txt', 'p2.txt']],
    'the seat\'s commit row names every path of the commit');
  assert.match(peerCommits[0]?.sha ?? '', /^[0-9a-f]{40,64}$/u);
  assert.deepEqual(writerCommits.map((row) => row.paths), [['w.txt']],
    'commits are listed per seat, not per checkout alone');
});

test('425e: the brief sentence is the one constant the wrapper embeds', needsGit, async (t) => {
  const f = await fixture(t);
  const scope = await seat(t, f, 'peer', WORKSPACE_A, 'w-peer');

  assert.equal(typeof WORKTREE_WRITER_BRIEF_SENTENCE, 'string', 'the brief constant is exported');
  assert.ok(WORKTREE_WRITER_BRIEF_SENTENCE.includes('swarm.coupling_writer_bypassed'),
    'the sentence names the bypass row');
  assert.ok(WORKTREE_WRITER_BRIEF_SENTENCE.includes('worktree.commit_recorded'),
    'the sentence names the attribution row');

  const guidance = SWARM_NATIVE_GUIDANCE;
  assert.ok(guidance.includes(WORKTREE_WRITER_BRIEF_SENTENCE),
    'the native guidance composes the exported constant verbatim');
  assert.ok(guidance.includes(WORKTREE_STASH_BRIEF_SENTENCE),
    'the guidance keeps the #357 stash sentence beside it');

  // The wrapper's own header embeds the same constant: the rule enforced and the sentence
  // taught are one text, never a retyped copy.
  const wrapper = readFileSync(join(scope.paths.bin, 'git'), 'utf8');
  assert.ok(wrapper.includes(WORKTREE_WRITER_BRIEF_SENTENCE),
    'the wrapper embeds the brief sentence');
});

