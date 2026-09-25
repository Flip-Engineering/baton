// Issue #447 — a commit observation naming a swarm this deployment does not hold is skipped.
//
// OBSERVED (2026-09-18 08:58–09:08Z, clone resident at f1a4eb9d): the ledger held 58
// `worktree.commit_recorded` rows with `swarmId: s1` / `view-no-spawn` and participant
// `peer`/`writer` — test-fixture rows the wave-14 seats' own `node --test` runs (issue425 /
// issue438 fixtures) wrote inside their lane worktrees, which the #425 projected wrapper spooled
// into the LIVE resident's commit-observation spool. #438's `_drainCommitObservations()` (run by
// every inspect and every bounded watch that names a projection) recorded the row and then
// resolved the fixture's swarm, so `swarm.view … --projection outline` and the root's bounded
// watch refused `swarm_not_found: swarm s1 not found` whenever a fresh fixture row sat in the
// spool. The root's wake primitive and its view were dead on the clone until the spool drained.
//
// The contract this file pins (issue #447):
//   F1 an observation whose swarmId names no swarm this deployment holds is skipped BEFORE any
//      write — no `worktree.commit_recorded` row is recorded for it, and the read that drained
//      it answers normally;
//   F2 an observation for a swarm this deployment holds still records its row (the #425 truth is
//      untouched by the skip).
//
// Hermetic: a real CoordinationStore, the real SwarmRuntime, a coordinator stub whose
// `_runtimeScopes.takeCommitObservations` answers what a spool would.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const principal = { actor: 'direct:issue447-root', principalId: 'issue447-root', sessionId: 'issue447-root' };
const SWARM = 'held-swarm';

function fixture(t, observations) {
  const world = mkdtempSync(join(tmpdir(), 'baton-issue447-'));
  t.after(() => rmSync(world, { recursive: true, force: true }));
  const store = new CoordinationStore(world);
  const workers = [];
  const spool = [...observations];
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers,
      pausedTurns: () => [],
      liveWorkspaceHolders: () => [],
      workspaceAttachment: () => null,
      _runtimeScopes: { leases: new Map(), takeCommitObservations: () => spool.splice(0, spool.length) },
    },
    authorize: async () => {},
    prepareRun: async (request) => request,
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length}`, taskId: `t-${workers.length}`, runId: request.runId, status: 'working' });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  t.after(() => {
    runtime.close();
    try { store.releaseWriterLease({ requireOwned: true }); } catch { /* swept with the world */ }
  });
  const call = (command, args = {}) => runtime.command(`swarm.${command}`, { swarmId: SWARM, ...args }, principal);
  const commitRows = () => store.eventsView()
    .filter((row) => (row.kind === 'driver.recorded' ? row.payload?.kind : row.kind) === 'worktree.commit_recorded');
  return { store, runtime, call, commitRows };
}

const foreign = (overrides = {}) => Object.freeze({
  kind: 'commit', swarmId: 's1', participantId: 'peer', workspaceId: 'ws-' + 'f'.repeat(32),
  couplingId: '', writer: '', sha: 'a'.repeat(40), at: '2026-09-18T09:00:00Z', paths: ['p1.txt'],
  workerId: 'w-fixture', ...overrides,
});

test('F1: a spooled observation naming a swarm this deployment does not hold is skipped, and the view still answers', async (t) => {
  const f = fixture(t, [foreign()]);
  await f.call('create', { purpose: 'issue 447', idempotencyKey: 'i447:create' });
  await f.call('recruit', { participantId: 'alpha', objective: 'work', idempotencyKey: 'i447:recruit' });
  const view = await f.call('view', { projection: 'outline' });
  assert.equal(view.swarmId, SWARM, 'the read that drained the foreign observation answers for the swarm it named');
  assert.deepEqual(f.commitRows().map((row) => row.payload.swarmId), [],
    'no worktree.commit_recorded row is written for a swarm this deployment does not hold');
});

test('F2: a spooled observation for a held swarm still records its commit row', async (t) => {
  const f = fixture(t, []);
  await f.call('create', { purpose: 'issue 447', idempotencyKey: 'i447:create' });
  await f.call('recruit', { participantId: 'alpha', objective: 'work', idempotencyKey: 'i447:recruit' });
  f.runtime.coordinator._runtimeScopes.takeCommitObservations = (() => {
    let served = false;
    return () => {
      if (served) return [];
      served = true;
      return [foreign({ swarmId: SWARM, participantId: 'alpha', workerId: 'w-0' })];
    };
  })();
  await f.call('view', { projection: 'outline' });
  assert.deepEqual(f.commitRows().map((row) => [row.payload.swarmId, row.payload.participantId]), [[SWARM, 'alpha']],
    'the held swarm\'s observation records exactly one row');
});
