// Issue #358, items 2 and 3 (item 1 landed as 9a10f983): a body that did not fit its lane spills to
// a durable artifact, the delivered marker cites it, and — this file — the seat can READ it.
//
// Rows, each red before the change:
//   (a) the seat verb `run.spill.read` is admitted by the ONE seat-read table with the `read`
//       permission and the marker's own closed argument (`spillId`);
//   (b) a spill the deployment minted is readable through the real runtime dispatch a seated
//       participant calls, answering the body, its digest, its byte count and its lane;
//   (c) an id the deployment never minted refuses typed (`swarm_spill_not_found`) and the refusal
//       names the marker the caller was following;
//   (d) the round trip the issue asks for: a peer message over the notify cap is delivered (and
//       receipted) with a `[SPILLED …]` marker that NAMES the verb, and following that name with
//       the marker's own `spill` id returns the message body the seat did not receive.
//
// The harness is the light SwarmRuntime fixture the seat-read suite uses (a real CoordinationStore,
// a coordinator double, no adapter processes), so nothing here spawns or waits on a provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { SwarmRuntime, SWARM_SEAT_READ_COMMANDS } from '../src/swarm-runtime.mjs';
const SWARM_ID = 'swarm-358';
const owner = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });
// The seat identity is the run layer's own (`worker:<workerId>`), exactly as the seat-read suite
// resolves it: the runtime's membership resolution reads the principal's worker id.
const workerPrincipal = (workerId) => Object.freeze({
  actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: `${workerId}-session`,
});

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-358-'));
  const store = new CoordinationStore(join(directory, 'coordination'), {
    clock: () => '2026-09-22T00:00:00.000Z',
  });
  const workers = [];
  // The frames the peer-message lane delivered, in order: the seat's own copy of a notify is the
  // text the coordinator was handed, so a test can read the marker it carries.
  const frames = [];
  const runtime = new SwarmRuntime({
    store,
    coordinator: {
      list: () => workers,
      pausedTurns: () => [],
      routeCards: () => [],
      // The peer-message lane delivers through the coordinator's own guidance verb; the double
      // records the frame and reports it delivered, so the spill is minted and receipted without
      // any adapter process.
      guideParticipant: async (workerId, text) => { frames.push({ workerId, text }); return { ok: true }; },
    },
    authorize: async () => {},
    prepareRun: async (request) => ({ ...request,
      route: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] }),
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`,
        runId: request.runId, status: 'working', paused: true, sessionContext: {} });
    },
    stopRun: async (runId) => {
      const worker = workers.find((row) => row.runId === runId);
      if (worker) worker.status = 'dead';
      return { state: 'closed' };
    },
  });
  const command = (name, args, caller = owner) => runtime.command(name, args, caller);
  await command('swarm.create', { swarmId: SWARM_ID, purpose: 'Spill and read it back', idempotencyKey: 'create' });
  for (const [participantId, idempotencyKey] of [['alpha', 'recruit-alpha'], ['beta', 'recruit-beta']]) {
    await command('swarm.recruit', { swarmId: SWARM_ID, participantId,
      objective: `Read the spills ${participantId} receives`,
      permissions: ['read', 'communicate', 'contribute'], idempotencyKey });
  }
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const seatOf = (participantId) => {
    const runId = store.swarm(SWARM_ID).participants[participantId].runId;
    const worker = workers.find((row) => row.runId === runId);
    assert.ok(worker, `the recruited seat ${participantId} holds a worker`);
    return workerPrincipal(worker.id);
  };
  return { store, runtime, command, seatOf, frames };
}

const markerOf = (text) => {
  const start = text.lastIndexOf('[SPILLED ');
  if (start === -1) return null;
  const end = text.indexOf(']', start);
  return JSON.parse(text.slice(start + '[SPILLED '.length, end));
};

test('a: the seat verb table admits run.spill.read with the read permission and a closed spillId', () => {
  const row = SWARM_SEAT_READ_COMMANDS['run.spill.read'];
  assert.ok(row, 'run.spill.read is a seat read verb');
  assert.equal(row.permission, 'read', 'the spill read rides the read permission');
  assert.deepEqual(row.required, ['spillId'], 'the marker\u2019s own id is the one required field');
  assert.equal(row.fields.spillId.pattern, '^spill:sha256:[a-f0-9]{64}$',
    'the admitted argument is the durable spill identity, never a path');
});

test('b/c: a minted spill reads back through the runtime; an unknown id refuses typed', async (t) => {
  const { store, command, seatOf } = await fixture(t);
  const body = 'the long objective the seat never received in full '.repeat(40);
  const minted = store.mintSpill({ body, lane: 'run.objective' },
    { actor: owner.actor, key: 'issue358:spill' });
  assert.equal(minted.result, 'minted');

  const read = await command('run.spill.read', { swarmId: SWARM_ID, spillId: minted.spill.spillId }, seatOf('alpha'));
  assert.equal(read.body, body, 'the verb answers the body the marker cited');
  assert.equal(read.digest, minted.spill.digest, 'the digest is the marker\u2019s');
  assert.equal(read.bytes, Buffer.byteLength(body), 'the byte count is the artifact\u2019s own');
  assert.equal(read.lane, 'run.objective', 'the lane the spill was minted for is carried');

  const unknown = `spill:sha256:${'f'.repeat(64)}`;
  await assert.rejects(
    command('run.spill.read', { swarmId: SWARM_ID, spillId: unknown }, seatOf('alpha')),
    (error) => {
      assert.equal(error.code, 'swarm_spill_not_found', 'an unminted id refuses typed');
      assert.equal(error.detail.spillId, unknown, 'the refusal names the id that was read');
      assert.match(error.detail.correction, /\[SPILLED/u, 'and the marker the caller was following');
      return true;
    },
  );
});

test('d: an over-cap peer message delivers a marker that names the verb, and the verb returns the body', async (t) => {
  const { command, seatOf, frames } = await fixture(t);
  const cap = FRAME_LIMITS['swarm.notify.body'].value;
  const message = 's'.repeat(cap + 512);
  const sent = await command('swarm.notify', { swarmId: SWARM_ID, participantId: 'beta', message,
    idempotencyKey: 'issue358:notify' }, seatOf('alpha'));

  assert.equal(sent.notify.spilled !== undefined || sent.notify.spill !== undefined, true,
    'the notify receipt marks the spill');
  assert.equal(sent.notify.read, 'run.spill.read', 'the receipt names the verb that reads it');
  assert.equal(frames.length, 1, 'the peer message was delivered to the recipient seat');
  const marker = markerOf(frames[0].text);
  assert.ok(marker, 'the delivered text carries a [SPILLED …] marker');
  assert.equal(marker.read, 'run.spill.read', 'the marker names the read verb');
  assert.equal(marker.spill, sent.notify.spill, 'the marker and the receipt name the same artifact');
  assert.equal(marker.bytes, Buffer.byteLength(message), 'the marker names the true byte count');

  const read = await command('run.spill.read', { swarmId: SWARM_ID, spillId: marker.spill }, seatOf('beta'));
  assert.equal(read.body, message, 'following the marker returns the message body whole');
  assert.equal(Buffer.byteLength(read.body), Buffer.byteLength(message), 'no truncation on the read');
});
