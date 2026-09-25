// Issue #528 — `swarm.update {event: swarm.contribution_recorded}` admitted a genuinely empty
// payload.
//
// Observed on swarm-backlog2-20260919 (2026-09-20): a seat issued `swarm.update {event:
// swarm.contribution_recorded, payload: {}}` twice while probing the command's argument shape.
// The bare-string note diversion (#310) only catches a STRING body with no contributionId, so an
// entirely empty object matches neither that path nor any refusal — `SwarmRuntime.command` mints
// a fresh contributionId from the caller's own idempotency key (the same derivation an ordinary
// contribution gets when it omits one) and writes a full `swarm.contribution_recorded` row whose
// body is `null`: a durable, contributionId-bearing record with nothing a reviewer or the landing
// loop can read.
//
// The fix is narrower than "a contribution needs a body": `swarm-state.test.mjs` already pins two
// DELIBERATE shapes the fold admits — a caller-named contributionId with nothing else (a marker
// contribution), and refs with no body (an evidence-pointer contribution) — and both stay legal
// here. What's refused is specifically the case with NONE of the three: no caller-named
// contributionId, no body, no refs. That combination gives the runtime nothing to record and
// nothing to mint an identity from besides the caller's own plumbing, so it refuses
// swarm_payload_invalid before minting anything, rather than writing an empty row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const principal = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue528-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const ports = {
    store, coordinator: { list: () => workers, pausedTurns: () => [], routeCards: () => [] },
    authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => { workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true, vendor: 'mock-session' }); },
    stopRun: async () => ({ state: 'closed' }),
  };
  const runtime = new SwarmRuntime(ports);
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(['list'].includes(command) ? {} : { swarmId: 'baton' }), ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  return { store, runtime, call };
}

test('528-a: a literally empty payload refuses instead of minting a bodiless contribution', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Issue #528' });
  await f.call('recruit', { participantId: 'builder', objective: 'Build the thing' });
  const builder = principal('w-1');
  await assert.rejects(
    f.call('update', { event: 'swarm.contribution_recorded', payload: {} }, builder),
    (error) => {
      assert.equal(error.code, 'swarm_payload_invalid');
      assert.match(error.message, /contributionId|body|refs/i);
      return true;
    },
    'an empty payload must refuse, not mint an empty contribution',
  );
  const swarm = f.store.swarm('baton');
  assert.equal(Object.keys(swarm.contributions ?? {}).length, 0, 'no contribution row was recorded');
});

test('528-b: a payload naming only body: null refuses the same way as a fully absent body', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Issue #528' });
  await f.call('recruit', { participantId: 'builder', objective: 'Build the thing' });
  const builder = principal('w-1');
  await assert.rejects(
    f.call('update', { event: 'swarm.contribution_recorded', payload: { body: null } }, builder),
    { code: 'swarm_payload_invalid' },
  );
});

test('528-c: a caller-named contributionId with nothing else still admits — the fold\'s own marker-contribution contract', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Issue #528' });
  await f.call('recruit', { participantId: 'builder', objective: 'Build the thing' });
  const builder = principal('w-1');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: { contributionId: 'marker' } }, builder);
  const swarm = f.store.swarm('baton');
  assert.equal(swarm.contributions.marker.body, null);
});

test('528-d: refs with no body still admits — the fold\'s own evidence-pointer contract', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Issue #528' });
  await f.call('recruit', { participantId: 'builder', objective: 'Build the thing' });
  const builder = principal('w-1');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: { refs: ['evidence:a'] } }, builder);
  const swarm = f.store.swarm('baton');
  const [contributionId] = Object.keys(swarm.contributions);
  assert.deepEqual(swarm.contributions[contributionId].refs, ['evidence:a']);
});

test('528-e: an object body still admits, unaffected by the new guard', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Issue #528' });
  await f.call('recruit', { participantId: 'builder', objective: 'Build the thing' });
  const builder = principal('w-1');
  await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'finding', body: 'The current interface needs another operation.',
  } }, builder);
  const swarm = f.store.swarm('baton');
  assert.equal(swarm.contributions.finding.body, 'The current interface needs another operation.');
});
