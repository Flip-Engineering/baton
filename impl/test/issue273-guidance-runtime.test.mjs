import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime, SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { SWARM_GUIDANCE_PRIORITIES } from '../src/swarm-contract.mjs';
import { batonCliHelp, parseBatonCli, swarmGuideRendering } from '../src/application-cli.mjs';
import { swarmCliCommand } from '../src/swarm-surface.mjs';

// Issue #273, runtime side — guidance delivery semantics.
//
// A guide is a durable, addressable act with a delivery contract, not a best-effort
// interjection. These rows state the four rules the lane delivers, on the swarm runtime fixture
// every other swarm row uses (a real coordination ledger, a scripted seat):
//   (a) the receipt carries the guide's OWN durable row — never `guide: null`;
//   (b) priority is the closed set next_boundary|now, next_boundary by default, and an unknown
//       value refuses with the #431 shape {field, rule: 'closed-set', admitted};
//   (c) `now` asks the coordinator's immediate lane, `next_boundary` the ordinary one (the #337
//       park for a harness that takes no mid-turn delivery stays green);
//   (d) `inReplyTo` threads guidance to the row it answers, and an unknown target refuses typed;
//   (e) `from` names the sender's relationship — root, lead, or peer;
//   (f) the CLI renders the receipt: seat, priority, where it landed, what to watch.
//
// Every await is bounded (docs/42 §8): the fixture's coordinator answers immediately and the
// store is local, so no row waits on a provider.

const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
const rootSession = { actor: 'web:local-owner:31a271a5', principalId: 'web:local-owner', sessionId: 'web-session' };
const seat = (participantId) => ({ actor: `swarm-native:baton:${participantId}`,
  principalId: `swarm-native:${participantId}`, sessionId: `${participantId}-session` });
const workerOf = (workerId) => ({ actor: `worker:${workerId}`, principalId: `worker:${workerId}`, sessionId: workerId });

function fixture(t, { deliver = 'ok', park = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue273-guidance-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new CoordinationStore(directory);
  const workers = [];
  const guides = [];
  let laneSeq = 0;
  const cards = new Map([
    ['mock-session', { prompt: 'native', steer: 'native' }],
    ['mock-oneshot', { prompt: 'unsupported', steer: 'unsupported' }],
  ]);
  const coordinator = {
    list: () => workers,
    pausedTurns: ({ workerId }) => workers.find((row) => row.id === workerId)?.paused ? [{ pauseId: workerId }] : [],
    routeCards: () => [...cards.entries()].map(([name, verbs]) => ({ name, card: { verbs } })),
    // The seat's lane, scripted: it records the call it received (the priority the runtime asked
    // for) and mints the lane receipt a real delivery writes, or refuses like a one-shot harness.
    guideParticipant: async (workerId, message, options = {}) => {
      guides.push({ workerId, message, priority: options.priority ?? null, actor: options.actor ?? null });
      workers.find((row) => row.id === workerId).paused = false;
      if (park || deliver !== 'ok') {
        return deliver === 'ok' ? { ok: false, reason: 'nudge unsupported on one-shot muse' }
          : { ok: false, result: deliver };
      }
      laneSeq += 1;
      const messageId = `message:${String(laneSeq).padStart(64, '0')}`;
      store.recordMessage('message.sent', {
        messageId, kind: options.priority === 'now' ? 'steer' : 'nudge', from: options.actor,
        to: { workerId }, body: message, targetCount: 1, alias: true,
      }, { actor: 'orchestrator', key: `message.sent:${workerId}:${laneSeq}` });
      return { ok: true, result: 'ok' };
    },
  };
  const ports = {
    store, coordinator, authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workers.push({ id: `w-${workers.length + 1}`, taskId: `t-${workers.length + 1}`, runId: request.runId,
        status: 'working', paused: true, vendor: 'mock-session' });
    },
    stopRun: async (runId) => { workers.find((row) => row.runId === runId).status = 'dead'; return { state: 'closed' }; },
  };
  const runtime = new SwarmRuntime(ports);
  let key = 0;
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { ...(['list'].includes(command) ? {} : { swarmId: 'baton' }),
      ...(['list', 'view', 'watch'].includes(command) ? {} : { idempotencyKey: `request-${++key}` }), ...args }, caller);
  const recruit = (participantId, caller = owner) => call('recruit', {
    participantId, objective: `Continue working as ${participantId}`,
  }, caller);
  const guidanceFor = async (participantId) => {
    const view = await call('view');
    return view.participants.find((row) => row.participantId === participantId).guidance;
  };
  return { store, runtime, ports, workers, guides, cards, call, recruit, guidanceFor };
}

async function seated(t, options) {
  const f = fixture(t, options);
  await f.call('create', { purpose: 'Guidance delivery semantics' });
  await f.recruit('builder');
  return f;
}

// ── (a) the receipt carries the row, never null ────────────────────────────────────────────────

test('273-a: a delivered guide answers with its own row, naming the lane receipt it rode', async (t) => {
  const f = await seated(t);
  const guided = await f.call('guide', { participantId: 'builder', message: 'Keep the API shape.' });

  assert.equal(guided.receipt.event.kind, 'swarm.guidance_sent', 'the receipt event IS the guide\'s own row');
  assert.deepEqual(guided.receipt.changed.map((row) => row.collection), ['participants']);
  assert.deepEqual(guided.guide, {
    seq: guided.receipt.event.seq, kind: 'swarm.guidance_sent', participantId: 'builder',
    from: { kind: 'root', participantId: null }, sentAt: guided.receipt.event.ts,
    priority: 'next_boundary', inReplyTo: null, messageId: guided.guide.messageId,
    delivery: { state: 'delivered', lane: { seq: guided.guide.delivery.lane.seq, kind: 'nudge',
      ts: guided.guide.delivery.lane.ts, messageId: guided.guide.messageId } },
  }, 'the guide\'s own row, with the provenance and the lane it rode — never null');
  assert.equal(guided.guide.sentAt, guided.receipt.event.ts, 'the row is the send: its instant IS sentAt');
  assert.deepEqual(guided.next.observation, { wakeClass: 'paused', participantId: 'builder' },
    'next names the seat\'s next turn boundary');

  const lane = f.store.eventsView().find((event) => event.seq === guided.guide.delivery.lane.seq);
  assert.equal(lane.kind, 'message.sent', 'the lane receipt is named, not copied');
  assert.equal(lane.payload.messageId, guided.guide.messageId);
});

test('273-a: a guide to a paused seat answers with its own row, and says the lane wrote none', async (t) => {
  const f = await seated(t);
  // The paused lane (nudgeTurn) writes no message.sent receipt — the case that used to answer
  // `guide: null` for the most common delivery there is.
  f.ports.coordinator.guideParticipant = async (workerId, message, options = {}) => {
    f.guides.push({ workerId, message, priority: options.priority ?? null, actor: options.actor ?? null });
    return { ok: true, result: 'nudged', pauseId: workerId };
  };
  const guided = await f.call('guide', { participantId: 'builder', message: 'Resume on the interface.' });
  assert.equal(guided.result.result, 'nudged');
  assert.equal(guided.guide.kind, 'swarm.guidance_sent');
  assert.deepEqual(guided.guide.delivery, { state: 'delivered', lane: null },
    'the turn itself carried the guidance: delivered, with no lane receipt to name');
  assert.deepEqual(await f.guidanceFor('builder'), [{
    seq: guided.guide.seq, ts: guided.guide.sentAt, kind: 'swarm.guidance_sent',
    messageId: guided.guide.messageId, from: { kind: 'root', participantId: null },
    priority: 'next_boundary', thread: { root: guided.guide.seq, parent: null },
    delivery: { state: 'delivered', lane: null, reason: null, deliveredTo: null, at: null },
  }], 'the guide shows on the seat\'s own guidance field');
});

test('273-a: a lane that refuses on a deliverable harness answers a refused row, never null', async (t) => {
  const f = await seated(t, { deliver: 'worker_stopping' });
  const guided = await f.call('guide', { participantId: 'builder', message: 'Keep going.' });
  assert.equal(guided.guide.kind, 'swarm.guidance_sent');
  assert.equal(guided.guide.delivery.state, 'refused');
  assert.equal(guided.guide.delivery.reason, 'worker_stopping');
  assert.equal(f.store.eventsView().some((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.guidance_parked'), false, 'a deliverable harness never parks on an ordinary lane refusal');
});

test('273-a2: a worker_not_active lane refusal parks the guidance under the lane\'s own reason (#534)', async (t) => {
  const f = await seated(t, { deliver: 'worker_not_active' });
  const guided = await f.call('guide', { participantId: 'builder', message: 'Keep going.' });
  assert.deepEqual(guided.result, { ok: true, result: 'parked', reason: 'worker_not_active',
    messageId: guided.guide.messageId });
  assert.equal(guided.guide.kind, 'swarm.guidance_parked');
  assert.deepEqual(guided.guide.delivery,
    { state: 'parked', lane: null, reason: 'worker_not_active' });
  const parked = f.store.eventsView().filter((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.guidance_parked');
  assert.equal(parked.length, 1, 'exactly one durable park — the seat\'s next exec or successor brief composes it');
});

// ── (b) priority: closed set, default, refusal shape ───────────────────────────────────────────

test('273-b: priority defaults to next_boundary and the closed set admits exactly next_boundary|now', async (t) => {
  const f = await seated(t);
  assert.deepEqual([...SWARM_GUIDANCE_PRIORITIES], ['next_boundary', 'now']);
  const guided = await f.call('guide', { participantId: 'builder', message: 'Keep going.' });
  assert.equal(guided.guide.priority, 'next_boundary', 'the default is durable on the row');
  assert.equal(f.guides.at(-1).priority, 'next_boundary', 'and it is what the lane was asked for');
  const explicit = await f.call('guide', { participantId: 'builder', message: 'And again.', priority: 'now' });
  assert.equal(explicit.guide.priority, 'now');
  assert.equal(f.guides.at(-1).priority, 'now');
});

test('273-b: an unknown priority refuses typed with the #431 shape, and sends nothing', async (t) => {
  const f = await seated(t);
  await assert.rejects(
    f.call('guide', { participantId: 'builder', message: 'Hurry.', priority: 'urgent' }),
    (error) => {
      assert.equal(error.code, 'swarm_command_invalid');
      assert.deepEqual(error.detail.admitted, ['next_boundary', 'now']);
      assert.equal(error.detail.field, 'priority');
      assert.equal(error.detail.rule, 'closed-set');
      assert.match(error.message, /priority must be one of: next_boundary, now/u);
      return true;
    });
  assert.equal(f.guides.length, 0, 'the refusal is made before any delivery');
  assert.equal(f.store.eventsView().some((event) => event.kind === 'driver.recorded'
    && event.payload?.kind === 'swarm.guidance_sent'), false);
});

// ── (c) how the priority reaches the lane ──────────────────────────────────────────────────────

test('273-c: next_boundary asks the ordinary lane and now asks the immediate one, both durably', async (t) => {
  const f = await seated(t);
  const boundary = await f.call('guide', { participantId: 'builder', message: 'At the boundary.' });
  assert.equal(f.guides.at(-1).priority, 'next_boundary');
  assert.equal(boundary.guide.delivery.lane.kind, 'nudge');

  const immediate = await f.call('guide', { participantId: 'builder', message: 'Right now.', priority: 'now' }, rootSession);
  assert.equal(f.guides.at(-1).priority, 'now', 'the coordinator is asked for the immediate lane');
  assert.equal(immediate.guide.priority, 'now');
  assert.equal(immediate.guide.delivery.lane.kind, 'steer', 'the lane receipt names the mode that rode');

  const rows = await f.guidanceFor('builder');
  assert.deepEqual(rows.map((row) => [row.priority, row.delivery.state]),
    [['next_boundary', 'delivered'], ['now', 'delivered']], 'both are durable and visible on the seat');
});

test('273-c: a one-shot seat parks at either priority, and the park stays durable', async (t) => {
  const f = await seated(t, { park: true });
  f.workers[0].vendor = 'mock-oneshot';
  const parked = await f.call('guide', { participantId: 'builder', message: 'Hold the shape.', priority: 'now' });
  assert.equal(parked.receipt.event.kind, 'swarm.guidance_parked');
  assert.equal(parked.guide.priority, 'now');
  assert.deepEqual(parked.guide.delivery, { state: 'parked', lane: null, reason: 'harness_one_shot' });
  assert.deepEqual(parked.next.observation, { wakeClass: 'guidance_delivered', participantId: 'builder' });
  const rows = await f.guidanceFor('builder');
  assert.deepEqual(rows.map((row) => row.delivery.state), ['parked']);
});

// ── (d) inReplyTo threads ─────────────────────────────────────────────────────────────────────

test('273-d: a guide may answer a prior guidance row, and the fold threads them in order', async (t) => {
  const f = await seated(t);
  const first = await f.call('guide', { participantId: 'builder', message: 'First.' });
  const second = await f.call('guide', { participantId: 'builder', message: 'Second.',
    inReplyTo: first.guide.seq });
  assert.equal(second.guide.inReplyTo, first.guide.seq);

  const rows = await f.guidanceFor('builder');
  assert.deepEqual(rows.map((row) => row.thread),
    [{ root: first.guide.seq, parent: null }, { root: first.guide.seq, parent: first.guide.seq }],
    'both rows belong to the thread the first guide started');
  assert.deepEqual(rows.map((row) => row.seq), [first.guide.seq, second.guide.seq]);
});

test('273-d: a guide may answer a contribution, and its thread roots at that row', async (t) => {
  const f = await seated(t);
  const recorded = await f.call('update', { event: 'swarm.contribution_recorded', payload: {
    contributionId: 'finding-1', participantId: 'builder', body: 'The interface needs one more operation.',
  } });
  const guided = await f.call('guide', { participantId: 'builder', message: 'Agreed — take it.',
    inReplyTo: recorded.receipt.event.seq });
  assert.equal(guided.guide.inReplyTo, recorded.receipt.event.seq);
  const rows = await f.guidanceFor('builder');
  assert.deepEqual(rows.map((row) => row.thread),
    [{ root: recorded.receipt.event.seq, parent: recorded.receipt.event.seq }],
    'a non-guidance target is the thread\'s root, and the guide is its reply');
});

test('273-d: an inReplyTo the swarm does not hold refuses typed, and sends nothing', async (t) => {
  const f = await seated(t);
  const missing = 9_999_999;
  await assert.rejects(
    f.call('guide', { participantId: 'builder', message: 'Answering nothing.', inReplyTo: missing }),
    (error) => {
      assert.equal(error.code, 'swarm_guidance_reply_target_not_found');
      assert.equal(error.detail.field, 'inReplyTo');
      assert.equal(error.detail.seq, missing);
      assert.equal(error.detail.rule, 'unknown-target');
      assert.ok(error.detail.admitted.includes('message.sent'), 'the admitted kinds are named');
      return true;
    });
  assert.equal(f.guides.length, 0);
  // A row that exists but is not something a guide may answer (a swarm row) refuses the same way.
  const created = f.store.eventsView().find((event) => event.kind === 'swarm.created');
  await assert.rejects(
    f.call('guide', { participantId: 'builder', message: 'Answering a swarm row.', inReplyTo: created.seq }),
    { code: 'swarm_guidance_reply_target_not_found' });
  assert.equal(f.guides.length, 0);
});

// ── (e) from: the sender's relationship ───────────────────────────────────────────────────────

test('273-e: from names the root orchestrator, a lead, and a peer seat', async (t) => {
  const f = fixture(t);
  await f.call('create', { purpose: 'Relationship naming' });
  await f.call('recruit', { participantId: 'lead', permissions: SWARM_PERMISSIONS,
    objective: 'Lead the delegation' });
  const lead = workerOf('w-1');
  await f.recruit('builder', lead);
  assert.equal(f.store.swarm('baton').participants.builder.parentId, 'lead', 'the lead leads its recruit');

  const fromRoot = await f.call('guide', { participantId: 'builder', message: 'Root here.' }, rootSession);
  assert.deepEqual(fromRoot.guide.from, { kind: 'root', participantId: null });
  const fromBareOrchestrator = await f.call('guide', { participantId: 'builder', message: 'Also root.' });
  assert.deepEqual(fromBareOrchestrator.guide.from, { kind: 'root', participantId: null });

  const fromLead = await f.call('guide', { participantId: 'builder', message: 'From your lead.' }, seat('lead'));
  assert.deepEqual(fromLead.guide.from, { kind: 'lead', participantId: 'lead' },
    'the seat that leads a delegation is named a lead');

  const fromPeer = await f.call('guide', { participantId: 'lead', message: 'From a peer.' }, seat('builder'));
  assert.deepEqual(fromPeer.guide.from, { kind: 'peer', participantId: 'builder' },
    'a seat that leads nobody is a peer');
  assert.equal(fromRoot.guide.from.participantId, null, 'the root has no seat identity');
});

test('273-e: the row keeps the raw actor beside the relationship, so the brief label stays one derivation', async (t) => {
  const f = await seated(t);
  const guided = await f.call('guide', { participantId: 'builder', message: 'Attributed.' }, rootSession);
  const row = f.store.eventsView().find((event) => event.seq === guided.receipt.event.seq);
  assert.equal(row.payload.actor, 'web:local-owner:31a271a5');
  assert.deepEqual(row.payload.from, { kind: 'root', participantId: null });
});

// ── (f) the CLI renders the receipt ───────────────────────────────────────────────────────────

test('273-f: the CLI rendering names the seat, the priority, where it landed and what to watch', async (t) => {
  const f = await seated(t);
  const guided = await f.call('guide', { participantId: 'builder', message: 'Read the shape.', priority: 'now' });
  const rendered = swarmGuideRendering(guided);
  assert.equal(rendered.guide.rendering,
    'guidance for builder: priority now, delivered to the seat; watch for the paused row');
  assert.equal(rendered.guide.seq, guided.guide.seq, 'the row itself prints untouched');

  const parked = swarmGuideRendering({
    guide: { seq: 7, participantId: 'builder', priority: 'next_boundary',
      delivery: { state: 'parked', lane: null, reason: 'harness_one_shot' } },
    next: { command: 'swarm.watch', args: { swarmId: 'baton' },
      observation: { wakeClass: 'guidance_delivered', participantId: 'builder' } },
  });
  assert.equal(parked.guide.rendering,
    'guidance for builder: priority next_boundary, parked until the seat\'s next exec / resume-from successor brief composes it; watch for the guidance_delivered row');

  const refused = swarmGuideRendering({
    guide: { seq: 8, participantId: 'builder', priority: 'next_boundary',
      delivery: { state: 'refused', lane: null, reason: 'worker_stopping' }, },
    next: { command: 'swarm.watch', args: { swarmId: 'baton' }, observation: { wakeClass: 'paused', participantId: 'builder' } },
  });
  assert.match(refused.guide.rendering, /refused — the seat received nothing/u);

  assert.deepEqual(swarmGuideRendering({ result: { ok: false } }), { result: { ok: false } },
    'an answer carrying no guide row renders untouched');
});

test('273-f: the CLI usage teaches --priority and --in-reply-to, and the parse hands them on typed', async () => {
  const row = swarmCliCommand('guide');
  assert.deepEqual(row.flags.map((entry) => entry.flag), ['--priority', '--in-reply-to', '--view']);
  assert.match(row.usage, /\[--priority VALUE\] \[--in-reply-to VALUE\]/u);
  const help = batonCliHelp('swarm.guide');
  assert.match(help, /baton swarm guide <SWARM-ID> <PARTICIPANT-ID> <MESSAGE> \[--priority VALUE\] \[--in-reply-to VALUE\]/u);

  const parsed = parseBatonCli(['swarm', 'guide', 'baton', 'builder', 'Hold the shape.',
    '--priority', 'now', '--in-reply-to', '12']);
  assert.equal(parsed.name, 'swarm.guide');
  assert.equal(parsed.args.priority, 'now');
  assert.equal(parsed.args.inReplyTo, 12, 'the flag parses to the ledger seq the wire schema declares');
  await assert.rejects(async () => parseBatonCli(['swarm', 'guide', 'baton', 'builder', 'Hold.',
    '--in-reply-to', 'not-a-seq']), (error) => {
    assert.equal(error.detail.field, '--in-reply-to');
    assert.equal(error.detail.rule, 'positive-integer');
    return true;
  });
});
