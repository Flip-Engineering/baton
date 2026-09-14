// The native bridge tells the truth about its own refusals (issue #283, deliverables 4 and 7): every
// refusal the bridge raises — an over-cap frame, a request the closed argument vocabulary refuses —
// lands on the runtime's durable `swarm.operation_refused` lane, wakes a parked watch, and shows on
// the participant's own row as `lastRefusal` until a later operation of the same command succeeds.
// The refusal text says on its FIRST LINE that nothing was recorded and what to change. An answer
// too large for the negotiated ceiling is refused typed with the narrower projection that
// MEASURABLY fits — never truncated, and never a second hardcoded bound: the client buffers under
// the bound the bridge published to its environment. Fixture pattern from swarm-runtime.test.mjs
// (a real CoordinationStore under a controllable coordinator) so the bridge talks to a REAL runtime.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { SWARM_VIEW_PROJECTION_NAMES, SWARM_BRIDGE_REFUSAL_COMMAND } from '../src/swarm-contract.mjs';
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
async function linked(t, { maxFrameBytes = 512 * 1024 } = {}) {
  const f = fixture(t);
  await f.call('create', { purpose: 'Bridge refusals are the swarm\'s own record' });
  await f.call('recruit', { participantId: 'alpha', objective: 'Build, and be refused by the bridge', permissions: SWARM_PERMISSIONS });
  const runId = f.store.swarm('baton').participants.alpha.runId;
  const bridge = createSwarmNativeBridge({
    dispatch: ({ command, args, principal, context }) => f.runtime.command(command, args, principal, context),
    maxFrameBytes,
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
});

test('a refusal the runtime already recorded is never recorded twice, and an unattributable one is not recorded at all', async (t) => {
  const f = await linked(t);
  // The runtime's own refusal (a mutation naming a seat the swarm does not have) travels through
  // the bridge verbatim and stays the runtime's single row — never recorded twice.
  const runtimeRefusal = await f.send('swarm.update', { swarmId: 'baton', event: 'swarm.group_updated', payload: { groupId: 'g', members: ['ghost'] }, idempotencyKey: 'op-1' })
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

test('an answer too large for the negotiated ceiling is refused typed with the projection that measurably fits', async (t) => {
  const f = await linked(t, { maxFrameBytes: 4096 });
  await f.call('update', {
    event: 'swarm.contribution_recorded',
    payload: { contributionId: 'c-big', participantId: 'alpha', body: 'x'.repeat(24 * 1024) },
  });

  const overBound = await f.send('swarm.view', { swarmId: 'baton' }).then(() => null, (error) => error);
  assert.equal(overBound.code, 'swarm_bridge_frame_exceeded');
  assert.equal(overBound.status, 413);
  assert.equal(overBound.detail.direction, 'response');
  assert.equal(overBound.detail.rule, 'bridge-frame');
  assert.equal(overBound.detail.value, 4096, 'the ceiling is the bridge\'s own negotiated bound');
  assert.ok(SWARM_VIEW_PROJECTION_NAMES.includes(overBound.detail.fits), 'a real projection is named');
  assert.ok(overBound.detail.measured.every((name) => SWARM_VIEW_PROJECTION_NAMES.includes(name)),
    'the advice is measured over the declared vocabulary, not a second list');
  assert.match(firstLine(overBound.message),
    new RegExp(`^Nothing was recorded: ask again with projection: ${overBound.detail.fits} \\(\\d+ bytes fits `, 'u'),
    'the first line says nothing was recorded and names the projection to ask for');
  assert.ok(overBound.detail.fitsBytes <= overBound.detail.value,
    'the named projection MEASURABLY fits the negotiated ceiling');

  // The advice is not a promise the bridge cannot keep: asking with it WORKS.
  const narrower = await f.send('swarm.view', { swarmId: 'baton', projection: overBound.detail.fits });
  assert.equal(narrower.projection, overBound.detail.fits);

  // The over-bound answer was refused, never truncated, and the refusal is on the durable lane.
  const row = refusalRows(f.store).at(-1);
  assert.deepEqual({ ...row.payload, seq: undefined },
    { kind: 'swarm.operation_refused', swarmId: 'baton', command: 'swarm.view', event: null,
      code: 'swarm_bridge_frame_exceeded', field: null, rule: 'bridge-frame', participantId: 'alpha', seq: undefined });
  assert.equal(f.store.swarm('baton').contributions['c-big'].body.length, 24 * 1024,
    'the answer was refused; the record it answered about is untouched');
});

test('the client buffers under the bound the bridge published, so a raised ceiling is not a second number', async (t) => {
  const f = await linked(t, { maxFrameBytes: 4096 });
  assert.equal(f.issued.env[SWARM_BRIDGE_ENV_KEYS.frameBytes], '4096', 'issue() publishes the negotiated bound');
  assert.equal(f.issued.receipt.frameBytes, 4096);
  assert.equal(f.bridge.inspect().frameBytes, 4096);
  await f.call('update', { event: 'swarm.contribution_recorded', payload: { contributionId: 'c-fit', participantId: 'alpha', body: 'y'.repeat(2000) } });
  // Between the published bound and the registry row: a client that used the registry default
  // would reject this answer, and the bridge's own client must not.
  const view = await f.send('swarm.view', { swarmId: 'baton', projection: 'contributions' });
  assert.deepEqual(view.contributions.map((row) => row.contributionId), ['c-fit']);
  assert.equal(SWARM_BRIDGE_REFUSAL_COMMAND, 'swarm.bridge_refusal', 'the report verb is not a swarm command');
});

// A participant's principal, for the in-process reads a test needs beside the bridge.
function principalFor(f, participantId) {
  const worker = f.workers.find((row) => row.runId === f.store.swarm('baton').participants[participantId].runId);
  return { actor: `worker:${worker.id}`, principalId: `worker:${worker.id}`, sessionId: worker.id };
}
