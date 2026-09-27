// Issue #268 (remainder) / #364 (view half) red-first skeleton: activity and usage on the
// participant row, the ONE liveness derivation's closed state set, the root as a participant row,
// attention coverage, and the view's no-process-spawn cost rule — as specified by
// docs/46-swarm-visibility.md §1, §5, §6 and §7.
//
// LANDED (lane ds-268b, 2026-09-18): the activity/usage row — a participant row carries
// `activity {lastEventKind, lastEventAt, turnsCompleted, contributions}` and
// `usage {tokens|'unavailable', providerCalls|'unavailable'}` from the ONE derivation
// (swarm-runtime.mjs `_seatActivity`, the same rows `run.peers.read` projects), and its manifest
// row is retired. The no-spawn cost rule (gap d, #438) landed before it. The rows below still pin
// stages that have NOT landed; each row's name says which:
//   • #364 view half — `SWARM_PARTICIPANT_RUNTIME_STATES` is not exported, the ONE liveness
//     derivation has no runtime-lost input, and the brief's Peers block still lists a seat whose
//     worker is dead (the stored row carries no runtime reading, so `_canAct` passes it);
//   • root standing gap b — no synthesized `root` participant row, so the root's reviews land with
//     `reviewerId: null` and no actor row renders them;
//   • root standing gap c — `attention` is a bare array with no `{rows, coverage}` envelope.
// Each row's message names what the implementer must land. When a row goes green the row
// leaves with the landing (docs/44).
//
// Fixture: the light SwarmRuntime harness (swarm-runtime.test.mjs) — no adapter. The no-spawn row
// shims `git` on PATH: any spawn lands in the spy log, and exit 1 reads as absence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import * as swarmRuntime from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue268-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const starts = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : []),
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      starts.push(request);
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId, permissions) => call('recruit', {
    participantId, objective: `Continue working as ${participantId}`, ...(permissions ? { permissions } : {}),
  });
  const participantRow = async (participantId) => {
    const view = await call('view', { projection: 'participants' });
    return (view.participants ?? []).find((row) => row.participantId === participantId) ?? null;
  };
  return { store, runtime, workers, starts, call, recruit, participantRow, directory };
}

test('#268: the participant row carries activity and usage from folded rows', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Activity and usage visibility (#268)' });
  await f.recruit('builder');
  const builder = principal('w-1');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'c1', participantId: 'builder', body: 'Visible work.',
  } }, builder);
  const row = await f.participantRow('builder');
  assert.ok(row.activity,
    'land activity {lastEventKind, lastEventAt, turnsCompleted, contributions} on the participant row — derived from rows the store already folds, never a worker-log scan (docs/46 §1.2)');
  assert.equal(row.activity.contributions, 1,
    'activity.contributions counts the fold\'s swarm.contributions rows for the seat (docs/46 §1.2 rule 1)');
  assert.equal(row.activity.turnsCompleted, 0,
    'activity.turnsCompleted counts the seat\'s attributed lifecycle.turn_completed rows — zero recorded here (docs/46 §1.2 rule 1)');
  assert.equal(typeof row.activity.lastEventKind, 'string',
    'activity.lastEventKind names the latest ledger row attributed to the seat (docs/46 §1.2 rule 1)');
  assert.deepEqual(row.usage, { tokens: 'unavailable', providerCalls: 'unavailable' },
    'land usage {tokens|unavailable, providerCalls|unavailable}: absence is labelled per field, never zero-filled (docs/46 §1.2 rule 2)');
});




test('#268: swarm.view --projection participants spawns no process (#438)', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'A read never spawns (#438, docs/46 §7)' });
  await f.recruit('builder');
  // Give the seat a recorded checkout so TODAY's inspect() would shell out: the live branch/HEAD/
  // status reads, participantBase, and worktreeChangedPaths all key on checkoutOf(worker).
  f.workers[0].sessionContext = { worktree: f.directory, repoRoot: f.directory };
  // The spy: a `git` shim on PATH that logs every invocation and exits 1 (reads as absence).
  // Any process spawn during the view lands in the log — the design's cost rule admits none.
  const shim = join(f.directory, 'shim');
  const spyLog = join(f.directory, 'git-spy.log');
  mkdirSync(shim);
  writeFileSync(join(shim, 'git'), `#!/bin/sh\necho "$@" >> "${spyLog}"\nexit 1\n`);
  chmodSync(join(shim, 'git'), 0o755);
  const priorPath = process.env.PATH;
  process.env.PATH = `${shim}:${priorPath}`;
  t.after(() => { process.env.PATH = priorPath; });
  await f.call('view', { projection: 'participants' });
  let spawns = '';
  try { spawns = readFileSync(spyLog, 'utf8'); } catch { /* no log: no spawn */ }
  assert.equal(spawns, '',
    'land the cost rule: a view read derives from folded rows and change-maintained caches — NO per-seat git spawn on a read (docs/46 §7; today inspect() shells out per seat: branch/HEAD/status, participantBase, worktreeChangedPaths)'
    + (spawns ? ` — spawned: ${spawns.trim().split('\n').join(' | ')}` : ''));
});
