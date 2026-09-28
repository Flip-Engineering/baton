// The native bridge tells the truth about its own refusals (issue #283, deliverables 4 and 7): every
// refusal the bridge raises — a request the closed argument vocabulary refuses, one naming another
// swarm, one arriving without an active token — lands on the runtime's durable
// `swarm.operation_refused` lane, wakes a parked watch, and shows on the participant's own row as
// `lastRefusal` until a later operation of the same command succeeds. The refusal text says on its
// FIRST LINE that nothing was recorded and what to change. An answer is bounded by nothing (issue
// #627): the bridge reads a request and writes its answer whole, whatever the size of either.
// Fixture pattern from swarm-runtime.test.mjs (a real CoordinationStore under a controllable
// coordinator) so the bridge talks to a REAL runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { SWARM_BRIDGE_REFUSAL_COMMAND } from '../src/swarm-contract.mjs';
import { createSwarmNativeBridge, swarmBridgeCommand, SWARM_BRIDGE_ENV_KEYS } from '../src/swarm-native-bridge.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const SHA = 'c'.repeat(40);

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-bridge-truth-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async () => ({ sha: SHA, ref: `refs/baton/checkpoints/${SHA}` }),
    checkContribution: async () => ({ passed: true, sha: SHA, attempt: {} }),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId, status: 'working', paused: true });
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(command === 'list' ? {} : { swarmId: 'baton' }),
      ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }),
      ...args }, caller);
  return { store, runtime, workers, call };
}

const refusalRows = (store) => store.eventsView()
  .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'swarm.operation_refused');
const firstLine = (message) => message.split('\n')[0];

// A swarm with one participant and a bridge token issued for it, over the REAL runtime.
async function linked(t) {
  const f = fixture(t);
  await f.call('create', { purpose: 'Bridge refusals are the swarm\'s own record' });
  await f.call('recruit', { participantId: 'alpha', objective: 'Build, and be refused by the bridge', permissions: SWARM_PERMISSIONS });
  const runId = f.store.swarm('baton').participants.alpha.runId;
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal, context }) => f.runtime.command(command, args, principal, context),
  });
  t.after(async () => { await bridge.close(); });
  const issued = await bridge.issue({ swarmId: 'baton', participantId: 'alpha', runId });
  const send = (command, args) => swarmBridgeCommand({ command, args }, { env: issued.env });
  return { ...f, bridge, issued, send, runId };
}

test('every bridge refusal lands on the durable refusal lane, reaches the wake feed, and clears on the same command succeeding', async (t) => {
  const f = await linked(t);
  const parked = await f.call('view');
  const watching = f.call('watch', { afterSeq: parked.cursor, timeoutMs: 5000 });
  // The validator's refusal (the one the bridge raises itself, before any effect) is reported.
  const refusal = await f.send('swarm.view', { swarmId: 'baton', runId: 'run-someone-else' }).then(() => null, (error) => error);
  assert.equal(refusal.code, 'swarm_command_invalid');
  assert.equal(refusal.status, 400);
  assert.equal(refusal.detail.field, 'runId');
  assert.equal(firstLine(refusal.message), 'Nothing was recorded: remove runId',
    'the first line says nothing was recorded and what to change');

  const woke = await watching;
  const row = refusalRows(f.store).at(-1);
  assert.deepEqual({ ...row.payload, seq: undefined }, {
    kind: 'swarm.operation_refused', swarmId: 'baton', command: 'swarm.view', event: null,
    code: 'swarm_command_invalid', field: 'runId', rule: 'unknown-field', participantId: 'alpha', seq: undefined,
  }, 'the row names the participant, the command, the field and the rule');
  assert.ok(Number.isSafeInteger(row.seq));
  assert.equal(woke.watch.reason, 'event');
  assert.equal(woke.watch.event.payloadKind, 'swarm.operation_refused', 'the wake feed carries the refusal');
  assert.equal(woke.watch.matchedSeq, row.seq, 'and it names the refusal row itself');

  // The participant's own row shows it — and so does the caller frame, whatever slice is read.
  const refused = await f.call('view');
  assert.deepEqual(refused.participants.find((entry) => entry.participantId === 'alpha').lastRefusal,
    { seq: row.seq, command: 'swarm.view', code: 'swarm_command_invalid', field: 'runId' });
  const outline = await f.call('view', { projection: 'outline' }, principalFor(f, 'alpha'));
  assert.equal(outline.caller.lastRefusal.seq, row.seq, 'the frame answers the caller its own standing refusal');
  assert.equal(outline.caller.lastRefusal.command, 'swarm.view');

  // The SAME command succeeding retires it: a read leaves no other trace, so its success is the
  // evidence — and the refusal is not repeated.
  const cleared = await f.send('swarm.view', { swarmId: 'baton' });
  assert.equal(cleared.swarmId, 'baton');
  assert.equal((await f.call('view')).participants.find((entry) => entry.participantId === 'alpha').lastRefusal, null,
    'a later operation of the same command that succeeds clears the standing refusal');
  assert.equal(refusalRows(f.store).length, 1, 'nothing else was recorded: one refusal, one row');
  assert.equal((await f.call('view', {}, principalFor(f, 'alpha'))).caller.lastRefusal, null);
  assert.equal(SWARM_BRIDGE_REFUSAL_COMMAND, 'swarm.bridge_refusal', 'the report verb is not a swarm command');
});

test('a refusal the runtime already recorded is never recorded twice, and an unattributable one is not recorded at all', async (t) => {
  const f = await linked(t);
  // The runtime's own refusal (a mutation naming a seat the swarm does not have) travels through
  // the bridge verbatim and stays the runtime's single row — never recorded twice.
  const runtimeRefusal = await f.send('swarm.update', { swarmId: 'baton', event: 'swarm.participant_left', payload: { participantId: 'ghost' }, idempotencyKey: 'op-1' })
    .then(() => null, (error) => error);
  assert.equal(runtimeRefusal.code, 'participant_not_found', 'the runtime refusal passes through');
  assert.equal(firstLine(runtimeRefusal.message).startsWith('Nothing was recorded:'), false,
    'a runtime refusal is the runtime\'s own text, not the bridge\'s first line');
  const rows = refusalRows(f.store);
  assert.equal(rows.length, 1, 'exactly one row: the runtime recorded it, the bridge did not repeat it');
  assert.equal(rows[0].payload.participantId, 'alpha');

  // A request with no usable token resolves no participant: there is nothing to attribute, and the
  // bridge records nothing (it reports refusals about PARTICIPANTS, and this one names none).
  const anonymous = await swarmBridgeCommand({ command: 'swarm.view', args: { swarmId: 'baton' } },
    { env: { ...f.issued.env, [SWARM_BRIDGE_ENV_KEYS.token]: 'not-a-real-token' } }).then(() => null, (error) => error);
  assert.equal(anonymous.code, 'swarm_bridge_token_invalid');
  assert.equal(firstLine(anonymous.message), 'Nothing was recorded: use an active bridge token for this participant');
  assert.equal(refusalRows(f.store).length, 1, 'no row was minted for an unattributable refusal');
});

// A participant's principal, for the in-process reads a test needs beside the bridge.
function principalFor(f, participantId) {
  const worker = f.workers.find((row) => row.runId === f.store.swarm('baton').participants[participantId].runId);
  return { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: worker.id };
}
