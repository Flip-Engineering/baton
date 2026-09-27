// Issue #607 — a stopped or unbound seat's harness process survives swarm stop and a resident
// restart, keeps working, and launches suites.
//
// Observed 2026-09-26 13:51Z: three Claude Code workers (w-131 bend2-native1r, stopped by the root
// at about 04:52Z; w-134 bend2-architect4, stopped at about 09:14Z; w-132 backlog-wd17r, unbound
// since the 04:49Z resume) kept running in their worktrees after their seats were ended, survived
// the resident restart at 13:17Z, and each started a whole-suite run at about 13:42Z. The root
// ended them by hand.
//
// Needed: swarm stop, and startup reconciliation of a seat that no longer binds, end the seat's
// harness process group. A worker whose seat is gone must not keep running.
//
// The repair, pinned here:
// (a) a replayed generation's process group is ended from the worker's own durable rows, and only
//     while `/bin/ps` still binds the group leader's kernel start to the recorded authority — a
//     reused process-group id and an unprovable identity are never signalled;
// (b) `swarm.stop` of a seat with no live runtime ends it (and still takes #353's fast path);
// (c) the restart reconciliation ends it for a worker no live seat binds;
// (d) a generation a live seat still holds is left alone — the run stop owns it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { endReplayedWorkerProcessGroup } from '../src/runtime-recovery.mjs';
import {
  processAuthorityPayload, processGroupAlive, validRecoveryProcessReapedPayload,
} from '../src/process-lifecycle.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };

/** A detached group leader whose pid IS its process group — the same detached-spawn invariant every
 * baton harness binds (cli-adapters, omp-rpc, claude-session all spawn with `detached: true`). */
function sleeper(t) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true, stdio: 'ignore',
  });
  const pid = child.pid;
  t.after(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } });
  return { child, pid };
}

/** The handle the startup reconstruction builds for a replayed generation: the process rows a
 * worker writes for itself, folded into a ref this incarnation did not spawn. */
function replayedHandle(pid, overrides = {}) {
  const processRef = {
    generation: 1, pid, processGroupId: pid, state: 'unconfirmed_after_restart', ready: true,
  };
  return {
    id: 'w-607', vendor: 'omp', taskId: 't-607', status: 'orphaned',
    processRef, processAuthority: processAuthorityPayload(processRef),
    recoveredProcessAuthority: true, currentIncarnation: false,
    ...overrides,
  };
}

/** A replayed fixture whose durable authority the host actually observed. The `/bin/ps` kernel-start
 * read inside `processAuthorityPayload` is the one host read these rows need, and a contended host
 * may time out on it — retried on a fresh group, which is the same refusal the reap reports rather
 * than signalling on a guess. */
function provenReplay(t) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { pid } = sleeper(t);
    const handle = replayedHandle(pid);
    if (handle.processAuthority !== null) return { pid, handle };
  }
  assert.fail('the host never observed a fixture group’s kernel start');
}

function recorder() {
  const rows = [];
  return {
    rows,
    log: { append: (row) => { const full = { ...row, seq: rows.length + 1 }; rows.push(full); return full; } },
    mapEvent: () => {},
  };
}

function reaperCoordinator(handle) {
  return {
    _workers: new Map([[handle.id, handle]]),
    _harnessOf: (vendor) => vendor,
    _safeTurnEpoch: () => 1,
  };
}

/** The host's own refusals to CONFIRM a group this call may not prove is ours, each of which the
 * reap reports rather than destroying on a guess (#351/#428): `permission_denied` is the kernel
 * answering EPERM to a group whose only member is the zombie of the process this same call just
 * killed — measured 4 runs in 20 against a fixture child the killing process had not yet reaped,
 * with the group's one member listed as `<defunct>`; `unknown` and `unproven` are the `/bin/ps`
 * identity probe answering nothing or timing out on a contended host, where an identity that is
 * merely mismatched stays a result the caller asserts on. Every OTHER reason is this row's own
 * subject — a call that never signals a live group answers `absent` or a mismatched identity,
 * never one of these — so it fails on the spot, and a reap that never confirms fails here. */
const HOST_REFUSALS = new Set(['permission_denied', 'unknown', 'unproven']);

/** The reap this row is about, taken over fresh fixture processes; see HOST_REFUSALS for the
 * observations that are the host’s and not the code’s. */
async function reapUntilEnded(t) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { pid, handle } = provenReplay(t);
    const log = recorder();
    const result = await endReplayedWorkerProcessGroup(reaperCoordinator(handle), log, handle.id);
    if (result.ended === true) return { pid, handle, log, result };
    assert.equal(HOST_REFUSALS.has(result.reason), true,
      `the reap refused a live fixture group with ${result.reason}`);
  }
  assert.fail('the reap never confirmed the end of a live fixture process group');
}

test('607a: a replayed generation proven alive is ended, and the end is recorded where every other process fact lands', async (t) => {
  const { pid, handle, log, result } = await reapUntilEnded(t);

  assert.deepEqual({ ...result }, { workerId: handle.id, ended: true, reason: null });
  assert.equal(processGroupAlive(pid), false, 'the harness process group is gone');
  assert.equal(handle.processRef.state, 'closed', 'the generation reads closed');
  assert.equal(handle.recoveredProcessAuthority, false, 'the recovered authority is spent');
  const reaped = log.rows.filter((row) => row.kind === 'control.recovery_process_reaped');
  assert.equal(reaped.length, 1, 'one reap writes one row on the worker’s own ledger');
  assert.equal(validRecoveryProcessReapedPayload(reaped[0].payload), true);
  assert.equal(reaped[0].payload.pid, pid);
  assert.equal(reaped[0].payload.pidStart, handle.processAuthority.pidStart);
});

test('607b: a generation this incarnation spawned, or one whose identity cannot be proven, is never signalled', async (t) => {
  const first = provenReplay(t);
  const log = recorder();

  const owned = replayedHandle(first.pid, { currentIncarnation: true });
  const ownedResult = await endReplayedWorkerProcessGroup(reaperCoordinator(owned), log, owned.id);
  assert.equal(ownedResult.reason, 'owned');
  assert.equal(ownedResult.ended, false);
  assert.equal(processGroupAlive(first.pid), true,
    'the run stop owns a generation this incarnation spawned');

  const second = provenReplay(t);
  const reused = replayedHandle(second.pid);
  reused.processAuthority = { ...reused.processAuthority, pidStart: 'Thu Jan  1 00:00:00 1970' };
  const reusedResult = await endReplayedWorkerProcessGroup(reaperCoordinator(reused), log, reused.id);
  assert.equal(reusedResult.reason, 'mismatch');
  assert.equal(processGroupAlive(second.pid), true,
    'a group whose kernel start does not match is not ours');
  assert.deepEqual(log.rows, [], 'a refused signal writes nothing');
});

test('607c: a group that is already gone is one probe and no row', async (t) => {
  const { pid, handle } = provenReplay(t);
  // The authority row is the one the worker wrote for itself while it ran; the process ending
  // afterwards is what leaves the group absent.
  process.kill(pid, 'SIGKILL');
  for (let wait = 0; wait < 200 && processGroupAlive(pid); wait += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(processGroupAlive(pid), false);

  const log = recorder();
  const result = await endReplayedWorkerProcessGroup(reaperCoordinator(handle), log, handle.id);
  assert.equal(result.reason, 'absent');
  assert.equal(result.ended, false);
  assert.deepEqual(log.rows, [], 'an ended seat that left nothing behind writes nothing');
});

test('607d: a stop of a seat with no live runtime ends its surviving process group, and still drains nothing', async (t) => {
  const f = runtimeFixture(t);
  await f.call('create', { purpose: 'Stop a seat whose process outlived it' });
  await f.recruit('survivor');
  const worker = f.workers[0];
  worker.status = 'orphaned';
  const before = f.ended.length;

  const result = await f.call('stop', { participantId: 'survivor', reason: 'Session no longer needed' });

  assert.deepEqual(f.ended.slice(before), [worker.id], 'the seat’s own binding names the group ended');
  assert.deepEqual(f.drainCalls, [], 'no live runtime means no drain call (#353)');
  assert.equal(result.receipt.event.kind, 'swarm.participant_left');
});

test('607e: a stop of a seat that never bound a worker ends nothing', async (t) => {
  const f = runtimeFixture(t);
  await f.call('create', { purpose: 'Stop an unbound seat' });
  f.store.recordSwarm('swarm.participant_joined', {
    swarmId: 'settle', participantId: 'ghost', role: 'Never bound', runId: 'run-ghost',
  }, { actor: owner.actor, key: 'issue607-join-ghost' });
  const before = f.ended.length;

  await f.call('stop', { participantId: 'ghost', reason: 'Session no longer needed' });

  assert.deepEqual(f.ended.slice(before), [], 'no binding names no group');
});

test('607f: the restart reconciliation ends the group of a worker no live seat binds, and keeps one a live seat holds', async (t) => {
  const f = runtimeFixture(t);
  await f.call('create', { purpose: 'Reconcile the seats a restart left behind' });
  // A seat that left before the restart, still naming the worker its harness ran under.
  f.store.recordSwarm('swarm.participant_joined', {
    swarmId: 'settle', participantId: 'left-behind', role: 'Ended before the restart', runId: 'run-left',
  }, { actor: owner.actor, key: 'issue607-join-left' });
  f.store.recordSwarm('swarm.participant_bound', {
    swarmId: 'settle', participantId: 'left-behind', workerId: 'w-131', taskId: 't-131',
  }, { actor: owner.actor, key: 'issue607-bound-left' });
  f.store.recordSwarm('swarm.participant_left', {
    swarmId: 'settle', participantId: 'left-behind', reason: 'stopped',
  }, { actor: owner.actor, key: 'issue607-left' });
  // A seat that is still here, bound to the generation the replay recovered for it.
  f.store.recordSwarm('swarm.participant_joined', {
    swarmId: 'settle', participantId: 'still-running', role: 'Bound across the restart', runId: 'run-here',
  }, { actor: owner.actor, key: 'issue607-join-here' });
  f.store.recordSwarm('swarm.participant_bound', {
    swarmId: 'settle', participantId: 'still-running', workerId: 'w-132', taskId: 't-132',
  }, { actor: owner.actor, key: 'issue607-bound-here' });
  f.fleet.recovered.push('w-131', 'w-132');

  await f.call('list');

  assert.deepEqual(f.ended, ['w-131'],
    'the seat that no longer binds loses its process; the seat still holding its generation keeps it');
});

// ── the runtime fixture: the #353 stop fixture's shape, plus the two #607 seams ────────────────

function runtimeFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue607-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const drainCalls = [];
  const ended = [];
  const fleet = { owned: [], recovered: [], lost: [] };
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    startupWorkerFleet: () => fleet,
    endReplayedWorkerProcessGroup: async (workerId) => {
      ended.push(workerId);
      return { workerId, ended: false, reason: 'fixture' };
    },
  };
  const runtime = new SwarmRuntime({
    store,
    coordinator,
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      const worker = { id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: false };
      workers.push(worker);
      // This incarnation spawned it: it belongs to the live fleet, so only the run stop ends it.
      fleet.owned.push(worker.id);
    },
    stopRun: async (runId) => {
      drainCalls.push(runId);
      workers.find((row) => row.runId === runId).status = 'dead';
      return { state: 'closed' };
    },
    lastCrash: () => null,
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'settle' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `issue607-${++key}` }),
      ...args }, caller);
  return {
    store, workers, drainCalls, ended, fleet, call,
    recruit: (participantId) => call('recruit', { participantId, objective: `Work as ${participantId}` }),
  };
}
