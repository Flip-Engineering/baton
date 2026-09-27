// Issue #352: `swarm recruit --follow` reported a stale verdict for a seat that was admitted.
// After an earlier admission row for the same participantId, the follow leg read the STALE row
// and never the new participant row. The follow leg must observe only rows at or after the
// recruit's own receipt seq, and a row that cannot be dated still decides.
import assert from 'node:assert/strict';
import test from 'node:test';

import { followSwarmRecruit, parseBatonCli, swarmRecruitSeat } from '../src/application-cli.mjs';

const recruitArgs = ['swarm', 'recruit', 'swarm-352', 'seat-S', 'Carry the lane'];
const TS_OLD = '2026-09-17T21:15:52.000Z';
const TS_NEW = '2026-09-17T21:53:00.000Z';

// A successful recruit receipt mirrors the runtime envelope: the receipt event carries the
// seq of the join this attempt wrote (9196/9296 in the incident; 200 below).
function recruitReceipt(seq) {
  return {
    participantId: 'seat-S', runId: 'run-352', swarmId: 'swarm-352', scopeOverlap: [],
    admission: { state: 'admitted', authority: 'host' }, baseBehind: null,
    receipt: {
      command: 'swarm.recruit',
      event: { kind: 'swarm.participant_joined', seq, ts: TS_NEW, actor: 'root' },
      changed: [],
    },
  };
}

function liveParticipant() {
  return {
    participantId: 'seat-S', status: 'active',
    workspace: { physicalOwnerId: 'task-352', shared: false, holderCount: 1 },
    runtime: { workerId: 'w-38', state: 'working', turn: 'running', live: true },
    base: null,
  };
}

function staleAdmissionView() {
  return {
    swarmId: 'swarm-352', status: 'open', cursor: 150,
    participants: [liveParticipant()],
    admission: [{
      participantId: 'seat-S', seq: 100, ts: TS_OLD,
      state: 'queued', authority: 'host', leaseKind: 'worker',
      position: 2, ahead: 1,
      shortfall: { dimension: 'load', observed: 29.39, required: 10 },
    }],
  };
}

test('#352(a): a stale admission row never settles a recruit this attempt admitted', async () => {
  const client = {
    async command(name) {
      if (name === 'swarm.recruit') return recruitReceipt(200);
      return staleAdmissionView();
    },
  };
  const result = await followSwarmRecruit(parseBatonCli([...recruitArgs, '--follow']), client, {});
  assert.equal(result.outcome, 'admitted', 'the live seat wins over the previous attempt row');
  assert.equal(result.seat.participantId, 'seat-S');
  assert.equal(result.seat.runtime.state, 'working');
  const admission = result.seat.admission;
  assert.ok(admission === null || admission.seq >= 200, 'never a previous attempt row');
});

test('#352(a-unit): swarmRecruitSeat filters admission rows older than since', () => {
  const found = swarmRecruitSeat(staleAdmissionView(), 'seat-S', 200);
  assert.equal(found?.outcome, 'admitted');
  assert.ok(found?.admission === null || found.admission.seq >= 200);
});

test('#352(a-unit): an undated admission row still decides (no seq to filter on)', () => {
  const view = staleAdmissionView();
  const undated = { ...view.admission[0] };
  delete undated.seq;
  const found = swarmRecruitSeat({ ...view, admission: [undated] }, 'seat-S', 200);
  // The row cannot be dated against this attempt, so it decides.
  assert.equal(found?.outcome, 'queued');
  assert.equal(found?.admission?.state, 'queued');
});

test('#352(b): a host refusal beside a durable queued row reports that row with the caught code', async () => {
  const refusal = Object.assign(new Error('host capacity unavailable'), {
    code: 'host_capacity_unavailable',
  });
  const view = {
    swarmId: 'swarm-352', status: 'open', cursor: 300,
    participants: [],
    admission: [{
      participantId: 'seat-S', seq: 300, ts: TS_NEW,
      state: 'queued', authority: 'host', leaseKind: 'worker',
      position: 1, ahead: 0, shortfall: { dimension: 'load', observed: 29.39, required: 10 },
    }],
  };
  const client = {
    async command(name) {
      if (name === 'swarm.recruit') throw refusal;
      return view;
    },
  };
  const result = await followSwarmRecruit(parseBatonCli([...recruitArgs, '--follow']), client, {});
  assert.equal(result.outcome, 'queued', 'the seat row is this attempt verdict');
  assert.equal(result.seat.admission?.seq, 300, 'the verdict is this attempt row');
  assert.equal(result.refusal.code, 'host_capacity_unavailable');
});

test('#352(c): a recruit refused pre-effect with no rows refuses with the caught code', async () => {
  const refusal = Object.assign(new Error('route refused this recruitment'), {
    code: 'application_route_not_allowed',
  });
  const client = {
    async command(name) {
      if (name === 'swarm.recruit') throw refusal;
      return { swarmId: 'swarm-352', status: 'open', cursor: 50, participants: [], admission: [] };
    },
  };
  const result = await followSwarmRecruit(parseBatonCli([...recruitArgs, '--follow']), client, {});
  assert.equal(result.outcome, 'refused');
  assert.equal(result.seat, null);
  assert.equal(result.refusal.code, 'application_route_not_allowed');
});

test('#352(d): a pending recruit whose seat later appears admits (unchanged)', async () => {
  const pending = Object.assign(new Error('Baton Web command remains admitted'), {
    code: 'cli_command_pending',
  });
  const empty = { swarmId: 'swarm-352', status: 'open', cursor: 50, participants: [], admission: [] };
  const seated = {
    swarmId: 'swarm-352', status: 'open', cursor: 210,
    participants: [liveParticipant()],
    admission: [{
      participantId: 'seat-S', seq: 205, ts: TS_NEW,
      state: 'admitted', authority: 'host', leaseKind: 'worker',
      position: null, ahead: null, shortfall: null,
    }],
  };
  const calls = [];
  const client = {
    async command(name) {
      calls.push(name);
      if (name === 'swarm.recruit') throw pending;
      if (name === 'swarm.view') return empty;
      return seated;
    },
  };
  const result = await followSwarmRecruit(parseBatonCli([...recruitArgs, '--follow']), client, {});
  assert.deepEqual(calls, ['swarm.recruit', 'swarm.view', 'swarm.watch']);
  assert.equal(result.outcome, 'admitted');
  assert.equal(result.seat.participantId, 'seat-S');
  assert.equal(result.seat.admission?.state, 'admitted');
});
