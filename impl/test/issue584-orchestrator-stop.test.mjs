import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });
const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const WS_LANE = `ws-${'b'.repeat(32)}`;

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue584-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : []),
    routeCards: () => [],
    guideParticipant: async () => ({ ok: true }),
    workspaceAttachment: () => ({ workspaceId: WS_LANE, worktree: directory }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: false, vendor: 'mock-session' });
    },
    stopRun: async (runId) => { const row = workers.find((candidate) => candidate.runId === runId); if (row) row.status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  // The lead's flat grant is the ROOT's grant to the seat: every management permission the law
  // expects a lead to exercise through its own grant, and deliberately NO `stop` — the flat list
  // is never a cap on the management relation (#584).
  const LEAD_PERMISSIONS = ['read', 'communicate', 'contribute', 'review', 'organize', 'recruit'];
  const team = async () => {
    await call('create', { purpose: 'Issue #584: a lead stops the seats it leads' });
    await call('recruit', { participantId: 'lead', objective: 'Lead the lane', permissions: LEAD_PERMISSIONS });
    const lead = principal('w-1');
    await call('recruit', { participantId: 'worker', objective: 'Work the lane' }, lead);
    const worker = principal('w-2');
    return { lead, worker };
  };
  return { runtime, call, team };
}

test('#584 (a): a lead stops a seat it leads without holding stop in its own flat grant', async (t) => {
  const f = fixture(t);
  const { lead, worker } = await f.team();
  const stopped = await f.call('stop', { participantId: 'worker', reason: 'Work complete' }, lead);
  assert.ok(stopped, 'the stop lands: the lead holds stop over the seat it leads (issue #584)');
});

test('#584 (b): a lead stops itself', async (t) => {
  const f = fixture(t);
  const { lead } = await f.team();
  const stopped = await f.call('stop', { participantId: 'lead', reason: 'Lane closed' }, lead);
  assert.ok(stopped, 'self-stop is admitted: stop over itself rides the relation (issue #584)');
});

test('#584 (c): a seat that leads nothing cannot stop its own lead — the relation runs one way', async (t) => {
  const f = fixture(t);
  const { lead } = await f.team();
  const worker = principal('w-2');
  await assert.rejects(
    async () => f.call('stop', { participantId: 'lead', reason: 'Trying upward' }, worker),
    (error) => error.code === 'swarm_permission_required',
    'a recruited seat does not lead its recruiter: the flat refusal stands',
  );
});
