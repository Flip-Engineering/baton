// Issue #311, item 2: a participant-to-participant message with provenance and a receipt.
//
// The issue's own words: "the run-level `message.send` exists; the swarm layer has no advertised
// peer channel — a sibling's published contract should be one `swarm.notify` away, not a root
// copy-paste." Siblings live in OTHER swarms of the deployment, so the channel has to resolve a
// recipient the way `_situation` already resolves a sibling seat (#311 item 1), and the sender has
// to be able to read back what it sent: a receipt id, and the delivery/read state behind it.
//
//   311-n2-a  `swarm.notify` and `swarm.notifications` are declared family members: the registry
//             row, the closed argument set, the CLI row and the MCP/bridge schema
//   311-n2-b  the validator admits the canonical notify request and refuses the closed mistakes
//             (unknown field, missing required, unshaped toSwarmId, an unclosed priority)
//   311-n2-c  a seat of one swarm notifies a seat of ANOTHER swarm of the deployment, resolved
//             through the situation's own sibling derivation; the delivered frame names the
//             sender's participant id, its swarm id and the instant
//   311-n2-d  the answer carries the notification's own durable row as its receipt
//   311-n2-e  `swarm.notifications` reads that receipt back by id: the run layer's receipt shape
//             (delivered / read / actedOn / reply / replies) plus the swarm provenance
//   311-n2-f  `read` is the recipient's first turn boundary after the row — null until one lands
//   311-n2-g  the recipient resolution refuses typed: an unknown seat (404), a seat that left,
//             and an id held by can-act seats of two swarms when no toSwarmId disambiguates
//   311-n2-h  the body admission mirrors `message.send.body`: an over-cap body rides as a
//             digest-cited spill, and a body past the spill ceiling draws the coaching refusal
//   311-n2-i  a recipient whose harness takes no mid-turn delivery gets a durable park in ITS OWN
//             swarm, so its next exec / successor brief composes the message
//   311-n2-j  a seat reads its own correspondence: a notify of another swarm's pair is not in it
//
// Fixture pattern from issue311-situation-projection.test.mjs (a real CoordinationStore under a
// controllable coordinator), extended with a delivery ledger and a one-shot harness card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import {
  SWARM_COMMAND_DEFINITIONS, SWARM_COMMAND_ROWS, SWARM_MCP_TOOL_DEFINITIONS,
  SWARM_CLI_COMMANDS, swarmCliCommand, validateSwarmCommand,
} from '../src/swarm-surface.mjs';
import { SWARM_REFUSAL_CODES } from '../src/swarm-refusals.mjs';

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
// A seat's TWO identities, exactly as the native bridge mints them (#273): the actor carries the
// `swarm-native:<swarm>:<participant>` spelling the provenance derivation reads, and the
// principalId carries the worker the membership resolves through.
const seatPrincipal = (workerId, swarmId, participantId) => ({ actor: `swarm-native:${swarmId}:${participantId}`,
  principalId: `worker:${workerId}`, sessionId: workerId });
// A two-argument surface: the recipient's own deliverable is what the 311-n2-i park is about.
const NOTIFY_BODY_CAP = FRAME_LIMITS['swarm.notify.body'].value;
const SPILL_CEILING = FRAME_LIMITS['spill.body'].value;

function fixture(t, { midTurn = 'supported' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue311-n2-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const vendor = midTurn === 'unsupported' ? 'one-shot' : 'mock';
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => (workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : []),
    guideParticipant: async (workerId, message) => {
      const worker = workers.find((row) => row.id === workerId);
      if (midTurn === 'unsupported') return { ok: false, result: 'unsupported' };
      worker.delivered.push(message);
      worker.paused = false;
      return { ok: true };
    },
    routeCards: () => (midTurn === 'unsupported'
      ? [{ name: vendor, card: { verbs: { prompt: 'unsupported', steer: 'unsupported' } } }]
      : []),
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {}, prepareRun: async () => {},
    startRun: async (request) => {
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId,
        status: 'working', paused: true, vendor, delivered: [] });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  });
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...args, ...(['list', 'view', 'watch', 'capture', 'check', 'notifications'].includes(command)
      ? {} : { idempotencyKey: `request-${++key}` }) }, caller);
  const workerOf = (swarmId, participantId) => workers
    .find((row) => row.runId === store.swarm(swarmId).participants[participantId].runId);
  const asParticipant = (swarmId, participantId) => seatPrincipal(workerOf(swarmId, participantId).id,
    swarmId, participantId);
  return { store, runtime, workers, call, workerOf, asParticipant };
}

/** Two swarms in ONE deployment: s-one (lead + builder) and s-two (sibling), so a notify crosses
 * the swarm boundary the issue's own example names. */
async function built(t, options = {}) {
  const f = fixture(t, options);
  await f.call('create', { swarmId: 's-one', purpose: 'First swarm' });
  await f.call('recruit', { swarmId: 's-one', participantId: 'lead', objective: 'Coordinate', options: { scope: ['impl/src'] } });
  await f.call('create', { swarmId: 's-two', purpose: 'Second swarm' });
  await f.call('recruit', { swarmId: 's-two', participantId: 'sibling', objective: 'Sibling lane', options: { scope: ['impl/test'] } });
  return f;
}

// ── 311-n2-a/b: the declared family member and its closed arguments ───────────────────────────

test('311-n2-a: notify and notifications are declared, carried and advertised like every other verb', () => {
  for (const name of ['swarm.notify', 'swarm.notifications']) {
    const definition = SWARM_COMMAND_DEFINITIONS[name];
    assert.ok(definition, `${name} is a declared swarm command`);
    assert.equal(definition.web, true, `${name} advertises the web lane`);
    assert.equal(definition.mcp, true, `${name} advertises the MCP lane`);
    const row = SWARM_COMMAND_ROWS.find((entry) => entry.command === name);
    assert.ok(row, `${name} carries a registry row`);
    assert.ok(row.description.length > 0, `${name} describes itself`);
    assert.ok(SWARM_MCP_TOOL_DEFINITIONS.some((tool) => tool.command === name), `${name} reaches MCP`);
    const verb = name.slice('swarm.'.length);
    const cli = swarmCliCommand(verb);
    assert.ok(cli, `${verb} has a CLI row`);
    assert.ok(cli.usage.startsWith(`baton swarm ${verb}`), `${verb} usage names its verb`);
    assert.ok(cli.summary.length > 0, `${verb} documents what it does`);
  }
  assert.deepEqual([...SWARM_COMMAND_DEFINITIONS['swarm.notify'].args].sort(),
    ['idempotencyKey', 'inReplyTo', 'message', 'participantId', 'priority', 'swarmId', 'toSwarmId', 'view'].sort());
  assert.deepEqual([...SWARM_COMMAND_DEFINITIONS['swarm.notifications'].args].sort(),
    ['afterSeq', 'participantId', 'receipt', 'swarmId'].sort());
  assert.ok(SWARM_CLI_COMMANDS.some((entry) => entry.verb === 'notify'));
  const row = SWARM_COMMAND_ROWS.find((entry) => entry.command === 'swarm.notify');
  assert.equal(row.readOnlyHint, false, 'a notify writes');
  assert.deepEqual([...row.required].sort(), ['message', 'participantId', 'swarmId'].sort());
  const read = SWARM_COMMAND_ROWS.find((entry) => entry.command === 'swarm.notifications');
  assert.equal(read.readOnlyHint, true, 'the receipt read changes nothing');
  assert.deepEqual([...read.required].sort(), ['swarmId']);
});

test('311-n2-b: the validator admits the canonical notify and refuses the closed mistakes', () => {
  assert.equal(validateSwarmCommand('swarm.notify', {
    swarmId: 's-one', participantId: 'sibling', toSwarmId: 's-two', message: 'Here is my contract.',
    priority: 'next_boundary', idempotencyKey: 'ik-notify',
  }), true);
  assert.equal(validateSwarmCommand('swarm.notifications', { swarmId: 's-one' }), true);
  assert.equal(validateSwarmCommand('swarm.notifications',
    { swarmId: 's-one', receipt: `notify:${'a'.repeat(64)}`, participantId: 'sibling', afterSeq: 3 }), true);
  const refusals = [
    ['unknown field', 'swarm.notify',
      { swarmId: 's', participantId: 'p', message: 'm', fence: 1, idempotencyKey: 'ik-1' }],
    ['missing message', 'swarm.notify', { swarmId: 's', participantId: 'p', idempotencyKey: 'ik-1' }],
    ['unshaped toSwarmId', 'swarm.notify',
      { swarmId: 's', participantId: 'p', toSwarmId: 'has space', message: 'm', idempotencyKey: 'ik-1' }],
    ['unclosed priority', 'swarm.notify',
      { swarmId: 's', participantId: 'p', message: 'm', priority: 'whenever', idempotencyKey: 'ik-1' }],
  ];
  for (const [label, name, args] of refusals) {
    assert.throws(() => validateSwarmCommand(name, args), (error) => {
      assert.equal(error.code, 'swarm_command_invalid', `${label} refuses typed`);
      return true;
    }, label);
  }
});

// ── 311-n2-c/d/e: the cross-swarm message, its provenance and its receipt ──────────────────────

test('311-n2-c: a seat notifies a sibling in ANOTHER swarm, and the frame names who and when', async (t) => {
  const f = await built(t);
  const sender = f.asParticipant('s-one', 'lead');
  await f.call('recruit', { swarmId: 's-one', participantId: 'builder', objective: 'Build', options: { scope: ['impl/src/x.mjs'] } });
  // The sender's own record of the peer it is about to reach: the situation's sibling rows name
  // the swarm a sibling lives in, and the notify takes exactly those coordinates.
  const situation = (await f.call('view', { swarmId: 's-one', projection: 'situation' }, sender)).situation;
  const sibling = situation.siblings.find((row) => row.participantId === 'sibling');
  assert.ok(sibling, 'the situation publishes the sibling seat');
  assert.equal(sibling.swarmId, 's-two', 'and the swarm it lives in');

  const answer = await f.call('notify', {
    swarmId: 's-one', participantId: 'sibling', toSwarmId: sibling.swarmId,
    message: 'My published contract is contribution-abc; reuse it.',
  }, sender);
  const frame = f.workerOf('s-two', 'sibling').delivered.at(-1);
  assert.equal(typeof frame, 'string', 'the sibling session took the frame');
  assert.ok(frame.includes('lead'), 'the delivered frame names the sender participant');
  assert.ok(frame.includes('s-one'), 'the delivered frame names the sender swarm');
  assert.ok(frame.includes(answer.notify.receiptId), 'the frame names the receipt');
  assert.ok(/\d{4}-\d{2}-\d{2}T/u.test(frame), 'the delivered frame names the instant');
  const [changed] = answer.receipt.changed;
  assert.deepEqual([changed.collection, changed.id, changed.seq], ['participants', 'sibling', answer.notify.seq],
    'the receipt names the row the event changed, the way a guide does');
});

test('311-n2-d: the answer carries the notification own durable row as its receipt', async (t) => {
  const f = await built(t);
  const sender = f.asParticipant('s-one', 'lead');
  const answer = await f.call('notify', {
    swarmId: 's-one', participantId: 'sibling', toSwarmId: 's-two', message: 'Take my contract.',
  }, sender);
  const receipt = answer.notify;
  assert.match(receipt.receiptId, /^notify:[a-f0-9]{64}$/u, 'the receipt id is a minted identity');
  assert.equal(receipt.kind, 'swarm.notification_sent');
  assert.ok(Number.isSafeInteger(receipt.seq) && receipt.seq > 0, 'the receipt names the row it is');
  assert.equal(receipt.from.participantId, 'lead');
  assert.equal(receipt.from.swarmId, 's-one');
  assert.equal(receipt.to.participantId, 'sibling');
  assert.equal(receipt.to.swarmId, 's-two');
  assert.equal(receipt.state, 'delivered');
  assert.equal(typeof receipt.sentAt, 'string');
  const [changed] = answer.receipt.changed;
  assert.deepEqual([changed.collection, changed.id, changed.seq], ['participants', 'sibling', receipt.seq],
    'the receipt names the row the event changed, the way a guide does');
  assert.match(changed.ts, /^\d{4}-\d{2}-\d{2}T/u,
    'the changed row carries the ledger instant the row was written at');
  const row = f.store.eventsView().find((event) => event.seq === receipt.seq);
  assert.equal(row.payload.kind, 'swarm.notification_sent', 'the row is durable');
  assert.equal(row.payload.from.swarmId, 's-one', 'the durable row carries the swarm provenance');
  assert.equal(row.payload.to.swarmId, 's-two');
  assert.equal(row.payload.message, 'Take my contract.', 'and the body');
});

test('311-n2-e: swarm.notifications reads the receipt back in the run layer receipt shape', async (t) => {
  const f = await built(t);
  const sender = f.asParticipant('s-one', 'lead');
  const answer = await f.call('notify', {
    swarmId: 's-one', participantId: 'sibling', toSwarmId: 's-two', message: 'Read me back.',
  }, sender);

  const one = await f.call('notifications', { swarmId: 's-one', receipt: answer.notify.receiptId }, sender);
  assert.equal(one.notifications.length, 1, '--receipt names exactly one notification');
  const receipt = one.notifications[0];
  for (const field of ['receiptId', 'messageId', 'kind', 'from', 'to', 'sentAt', 'priority', 'inReplyTo',
    'state', 'lane', 'delivered', 'read', 'actedOn', 'reply', 'replies', 'body']) {
    assert.ok(Object.hasOwn(receipt, field), `the receipt carries ${field}`);
  }
  assert.equal(receipt.receiptId, answer.notify.receiptId);
  assert.equal(receipt.delivered, true);
  assert.equal(receipt.actedOn, null);
  assert.equal(receipt.reply, null);
  assert.deepEqual(receipt.replies, []);
  assert.equal(receipt.body, 'Read me back.');
  assert.equal(receipt.from.participantId, 'lead');
  assert.equal(receipt.to.participantId, 'sibling');

  const all = await f.call('notifications', { swarmId: 's-one' }, sender);
  assert.equal(all.notifications.length, 1, 'the collection read serves the same row');
  assert.deepEqual(all.notifications[0], receipt);

  const empty = await f.call('notifications', { swarmId: 's-one', receipt: `notify:${'f'.repeat(64)}` }, sender);
  assert.deepEqual(empty.notifications, [], 'an id the swarm does not hold reads empty, never an invented row');
});

test('311-n2-f: read is the recipient turn boundary AFTER the row, and null until one lands', async (t) => {
  const f = await built(t);
  const sender = f.asParticipant('s-one', 'lead');
  const recipientRun = f.store.swarm('s-two').participants.sibling.runId;
  // A turn the recipient took BEFORE the message is not a read of it: the derivation answers
  // whether a boundary FOLLOWS the row, never whether the seat has ever turned.
  f.store.recordDriver('lifecycle.turn_started', { swarmId: 's-two', runId: recipientRun, worker: 'w-2' },
    { actor: 'worker', key: 'n2-f:earlier-turn' });
  const answer = await f.call('notify', {
    swarmId: 's-one', participantId: 'sibling', toSwarmId: 's-two', message: 'Did you see this?',
  }, sender);
  const readOf = async () => (await f.call('notifications',
    { swarmId: 's-one', receipt: answer.notify.receiptId }, sender)).notifications[0].read;
  assert.equal(await readOf(), null, 'the earlier turn boundary does not mark this row read');
  f.store.recordDriver('lifecycle.turn_started', { swarmId: 's-two', runId: recipientRun, worker: 'w-2' },
    { actor: 'worker', key: 'n2-f:later-turn' });
  assert.equal(await readOf(), true, 'the seat turned after the notification, so it is read');
});

// ── 311-n2-g: the recipient resolution refuses typed ───────────────────────────────────────────

test('311-n2-g: the recipient resolution refuses typed for an unknown, gone or ambiguous seat', async (t) => {
  const f = await built(t);
  const sender = f.asParticipant('s-one', 'lead');
  await assert.rejects(
    f.call('notify', { swarmId: 's-one', participantId: 'ghost', toSwarmId: 's-two', message: 'hi' }, sender),
    (error) => {
      assert.equal(error.code, 'swarm_notify_target_not_found');
      assert.equal(SWARM_REFUSAL_CODES.swarm_notify_target_not_found.status, 404);
      assert.equal(error.detail.participantId, 'ghost');
      return true;
    });
  // An id held by a can-act seat of two swarms, named with no toSwarmId, is a request the caller
  // must disambiguate — never a coin flip between two seats.
  await f.call('create', { swarmId: 's-three', purpose: 'Third swarm' });
  await f.call('recruit', { swarmId: 's-three', participantId: 'sibling', objective: 'Same id elsewhere' });
  await assert.rejects(
    f.call('notify', { swarmId: 's-one', participantId: 'sibling', message: 'hi' }, sender),
    (error) => {
      assert.equal(error.code, 'swarm_command_invalid');
      assert.equal(error.detail.rule, 'ambiguous-target');
      assert.deepEqual([...error.detail.swarmIds].sort(), ['s-three', 's-two']);
      return true;
    });
  await f.call('stop', { swarmId: 's-two', participantId: 'sibling', reason: 'done' });
  await assert.rejects(
    f.call('notify', { swarmId: 's-one', participantId: 'sibling', toSwarmId: 's-two', message: 'hi' }, sender),
    (error) => {
      assert.equal(error.code, 'swarm_notify_target_not_found', 'a seat that settled cannot take a peer message');
      return true;
    });
});

// ── 311-n2-h: the body admission mirrors message.send.body ─────────────────────────────────────

test('311-n2-h: an over-cap body rides as a digest-cited spill, and past the ceiling it is a coaching refusal', async (t) => {
  const f = await built(t);
  const sender = f.asParticipant('s-one', 'lead');
  assert.equal(NOTIFY_BODY_CAP, FRAME_LIMITS['message.send.body'].value,
    'the peer message body is the same admission the run layer carries');
  const long = 'x'.repeat(NOTIFY_BODY_CAP + 64);
  const answer = await f.call('notify', {
    swarmId: 's-one', participantId: 'sibling', toSwarmId: 's-two', message: long,
  }, sender);
  const receipt = answer.notify;
  // The run layer's receipt identifies a spill the way `run.message.receipt` does: by the citation
  // it carries — the artifact, the digest and the whole length — never a separate flag.
  assert.equal(receipt.bytes, Buffer.byteLength(long));
  assert.match(receipt.digest, /^[a-f0-9]{64}$/u);
  assert.match(receipt.spill, /^spill:sha256:[a-f0-9]{64}$/u, 'the spill artifact is named');
  assert.equal(Buffer.byteLength(receipt.body), NOTIFY_BODY_CAP, 'the row carries the head');
  const frame = f.workerOf('s-two', 'sibling').delivered.at(-1);
  assert.ok(frame.includes('SPILLED'), 'the delivered frame carries the citation');
  assert.ok(frame.includes(receipt.spill), 'and names the artifact');

  await assert.rejects(
    f.call('notify', {
      swarmId: 's-one', participantId: 'sibling', toSwarmId: 's-two', message: 'y'.repeat(SPILL_CEILING + 1),
    }, sender),
    (error) => {
      assert.equal(error.code, 'spill_body_exceeded', 'the lane past the spill ceiling refuses coaching');
      assert.equal(error.cap, SPILL_CEILING);
      assert.equal(error.gracefulPath, 'over-cap bodies spill to a durable artifact — resend with a digest-citable head');
      return true;
    });
});

// ── 311-n2-i/j: a one-shot recipient parks in its own swarm, and the read is scoped ───────────



test('311-n2-j: the receipt read is scoped to the swarm and to the caller\'s own correspondence', async (t) => {
  const f = await built(t);
  const lead = f.asParticipant('s-one', 'lead');
  const sibling = f.asParticipant('s-two', 'sibling');
  await f.call('notify', { swarmId: 's-one', participantId: 'sibling', toSwarmId: 's-two', message: 'One.' }, lead);
  const mine = await f.call('notifications', { swarmId: 's-one' }, lead);
  assert.equal(mine.notifications.length, 1);
  assert.equal(mine.caller.participantId, 'lead');
  assert.ok(Number.isSafeInteger(mine.at.seq), 'the read names the ledger head it observed');
  const other = await f.call('notifications', { swarmId: 's-two' }, sibling);
  assert.deepEqual(other.notifications, [], 'another swarm\'s correspondence is not this swarm\'s');
  // And the row that answers one names the thread, so a peer read threads.
  const answer = await f.call('notify', {
    swarmId: 's-one', participantId: 'sibling', toSwarmId: 's-two', message: 'Two.', inReplyTo: mine.notifications[0].seq,
  }, lead);
  const threaded = await f.call('notifications', { swarmId: 's-one' }, lead);
  const first = threaded.notifications.find((row) => row.receiptId === mine.notifications[0].receiptId);
  assert.deepEqual(first.replies, [answer.notify.receiptId], 'the row it answers names the reply');
  const second = threaded.notifications.find((row) => row.receiptId === answer.notify.receiptId);
  assert.equal(second.inReplyTo, mine.notifications[0].seq, 'and the reply names the row it answers');
});
