// Issue #314 lane 2 (docs/49 §5, §8; issues #302, #294, #479): receipts and wakes — a core
// mutation answers a receipt and never a whole view, a long verb hands back the wake subscription
// its follow-up rides (the call returns as soon as the receipt exists), and the doctor projection
// carries the stopping section the client's own doctor() already answers.
//
//   314-D2-a  a core mutation's receipt IS the receipt the operation answered — the runtime's own
//             #302 object, byte for byte, never a bridge-only second shape — and the projection it
//             replaced does not ride the answer. A core verb and its flat counterpart answer
//             byte-identically (the wrapper's own projection, docs/36 §1.3).
//   314-D2-b  every long verb (run.start, swarm.recruit, swarm.check, waves.start — the core
//             table's own `long` rows) answers inside its bound with a wake subscription whose
//             classes are the table's, filtered to the operation's subject, and the settle frame
//             then arrives as `notifications/baton/wake` carrying the row. The answer never waits
//             for the settle: the settle frame does not exist yet when the answer returns.
//   314-D2-c  #479: `baton_deployment {verb: doctor}` projects the client's doctor() result
//             including its `stopping` section while the resident drains, and `null` (never
//             absent) for a resident that is not stopping.
//
// The fixture is the production composition, not a hand-built one: a scripted resident on an
// owner-only socket, the real BatonWebClient, the real BatonWebApplicationFacade, the real
// McpFleetServer and the production wrapper both entry scripts apply. The swarm receipt the
// resident answers with is minted by a REAL SwarmRuntime, so "the receipt the CLI receives" is the
// operation's own object rather than a fixture's idea of it. Every await is bounded (docs/42 §8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { createBatonWebMcpServer } from '../src/mcp-web-bridge.mjs';
import { SWARM_COMMAND_DEFINITIONS } from '../src/swarm-contract.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';
import { webAdmittedCommandNames } from '../src/web-northbound.mjs';
import { fixtureSocketRoot } from './fixture-root.mjs';

const REPO_ID = 'repo-314-lane2';
const TOKEN = 'lane2-resident-token';
const BASE_URL = 'https://baton.314.invalid';
const SESSION = Object.freeze({
  schemaVersion: 1,
  identity: Object.freeze({
    userId: 'bridge-operator', sessionId: 'bridge-session-314',
    capabilities: Object.freeze(['observe', 'control']), repoIds: Object.freeze([REPO_ID]),
  }),
  expiresAt: '2099-01-01T00:00:00.000Z',
});
/** The wire card a real resident publishes: the union the bridge's own floor is admitted by. */
const CARD = Object.freeze({
  schemaVersion: 1,
  repoId: REPO_ID,
  commands: Object.freeze([...new Set([
    ...webAdmittedCommandNames(), ...Object.keys(SWARM_COMMAND_DEFINITIONS),
  ])]),
  agentExperience: Object.freeze({ registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest }),
});

const RUN_VIEW = Object.freeze({
  schemaVersion: 1, runId: 'run-314-lane2', phase: 'awaiting_plan_approval', cursor: 41,
  plan: { id: 'plan-1', version: 1, digest: 'b'.repeat(64), approval: null },
  lastAction: null, stop: null,
});

/** The receipt a REAL swarm runtime answers for `swarm.create` — the object a CLI caller receives
 * from the same operation (`client.command('swarm.create', …)`), never a fixture's imitation. */
function realSwarmCreateReceipt(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-314-lane2-swarm-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const runtime = new SwarmRuntime({
    store: new CoordinationStore(directory),
    coordinator: {
      list: () => [], pausedTurns: () => [], liveWorkspaceHolders: () => [],
      guideParticipant: async () => ({ ok: true }),
      captureContribution: async () => ({ contributionId: 'c', workerId: 'w', sha: 'a'.repeat(40), ref: 'refs/x' }),
      checkContribution: async () => ({ passed: true, sha: 'a'.repeat(40), attempt: { cleanup: { state: 'closed' } } }),
    },
    authorize: async () => {},
    prepareRun: async () => {},
    startRun: async () => {},
    stopRun: async () => ({ state: 'closed' }),
  });
  return runtime.command('swarm.create', { purpose: 'Issue #314 lane 2 receipt parity', idempotencyKey: 'lane2-create' },
    { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });
}

function waitFor(read, predicate, { timeoutMs = 5_000, label = 'condition' } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const value = read();
      if (predicate(value)) return resolve(value);
      if (Date.now() > deadline) {
        return reject(new Error(`timed out waiting for ${label}; saw ${JSON.stringify(value).slice(0, 400)}`));
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

/**
 * One scripted resident on an owner-only Unix socket. It speaks the published contract the bridge
 * reads — `/readyz`, `/v1/application-card`, `/v1/session`, `POST /v1/commands`, and the deployment
 * wake stream (SSE plus its `Accept: application/json` pull) — and replays whatever the test hands
 * it. It derives nothing: the answers and the frames are the test's, so a green row is about the
 * BRIDGE and never about a second implementation of the resident.
 */
async function startScriptedResident({ answers, card = CARD }) {
  const directory = fixtureSocketRoot('bt-314-lane2-');
  const socketPath = join(directory, 'resident.sock');
  const commands = [];
  const attachments = new Set();
  const ledger = [];
  let stopping = null;
  let ready = true;
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const json = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    // #467's truth: a stopping incarnation answers the readiness read 503 while the card keeps
    // serving the state, which is what the client's doctor() reads the section from.
    if (url.pathname === '/readyz') {
      return ready
        ? json(200, { ok: true, ready: true, schemaVersion: 1 })
        : json(503, { ok: false, ready: false, schemaVersion: 1 });
    }
    if (url.pathname === '/v1/application-card') {
      return json(200, { ok: true, application: { ...card, ...(stopping === null ? {} : { stopping }) } });
    }
    if (url.pathname === '/v1/session') {
      return json(200, { ok: true, identity: SESSION.identity, expiresAt: SESSION.expiresAt });
    }
    if (url.pathname === '/v1/commands' && request.method === 'POST') {
      let body = '';
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        const envelope = JSON.parse(body);
        commands.push(Object.freeze({ command: envelope.command, args: envelope.args, key: envelope.idempotencyKey }));
        let result;
        try {
          result = answers(envelope.command, envelope.args);
        } catch (error) {
          return json(500, { ok: false, error: { code: error?.code ?? 'resident_fault', message: error.message } });
        }
        return json(200, { ok: true, commandId: envelope.commandId, result });
      });
      return undefined;
    }
    // The wake stream: the same cursor rule the resident applies (no cursor means from now).
    const head = ledger.reduce((high, frame) => Math.max(high, frame.seq), 0);
    const declared = request.headers['last-event-id'] ?? url.searchParams.get('since') ?? null;
    const parsed = declared === null ? Number.NaN : Number(declared);
    const from = Number.isSafeInteger(parsed) ? parsed : head;
    const kinds = url.searchParams.get('kinds')?.split(',').filter((value) => value.length > 0) ?? null;
    const swarms = url.searchParams.get('swarms')?.split(',').filter((value) => value.length > 0) ?? null;
    const participants = url.searchParams.get('participants')?.split(',').filter((value) => value.length > 0) ?? null;
    const matching = () => ledger.filter((frame) => frame.seq > from
      && (kinds === null || kinds.includes(frame.wakeClass))
      && (swarms === null || swarms.includes(frame.swarmId ?? ''))
      && (participants === null || participants.includes(frame.participantId ?? '')));
    if (`${request.headers.accept ?? ''}`.includes('application/json')) {
      return json(200, {
        ok: true,
        wakes: {
          schemaVersion: 1, kind: 'baton.wake_page', cursor: Math.max(head, from),
          swarms: [], frames: matching(), lagged: null,
        },
      });
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
    response.write(': wake attachment open\n\n');
    const attachment = { response, closed: false };
    attachments.add(attachment);
    const write = (frame) => {
      if (attachment.closed) return;
      try { response.write(`id: ${frame.seq}\nevent: wake\ndata: ${JSON.stringify(frame)}\n\n`); }
      catch { /* the consumer went away */ }
    };
    for (const frame of matching()) write(frame);
    const close = () => { attachment.closed = true; attachments.delete(attachment); };
    response.on('close', close);
    response.on('error', close);
    return undefined;
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(socketPath, () => resolveListen());
  });
  chmodSync(socketPath, 0o700);
  return Object.freeze({
    socketPath,
    commands,
    setStopping: (section) => { stopping = section; ready = section === null; },
    push: (frame) => {
      ledger.push(frame);
      for (const attachment of [...attachments]) {
        if (attachment.closed) continue;
        try { attachment.response.write(`id: ${frame.seq}\nevent: wake\ndata: ${JSON.stringify(frame)}\n\n`); }
        catch { /* the consumer went away */ }
      }
    },
    close: async () => {
      for (const attachment of [...attachments]) {
        attachment.closed = true;
        attachment.response.destroy();
      }
      attachments.clear();
      // A consumer that is still reconnecting must not hold the close: the sockets are cut and the
      // listener stops; a straggler connection is ended by closeAllConnections, never awaited.
      const closed = new Promise((resolveClose) => { server.close(() => resolveClose()); });
      server.closeAllConnections?.();
      await closed;
      rmSync(directory, { recursive: true, force: true });
    },
  });
}

/** The served agent surface as a client meets it: the production bridge (BatonWebClient → facade →
 * McpFleetServer) under the production wrapper both entry scripts apply. */
async function servedSurface(t, answers) {
  const resident = await startScriptedResident({ answers });
  const directory = mkdtempSync(join(tmpdir(), 'baton-314-lane2-mcp-'));
  // ONE teardown, in the order the session ends: the plane first (a live subscription reconnects on
  // its cadence, so a resident closed under it would be re-dialled), then the resident, then the
  // directory. Every await is bounded (docs/42 §8).
  let raw = null;
  t.after(async () => {
    try { await raw?.close(); } catch { /* the session is over either way */ }
    await resident.close();
    rmSync(directory, { recursive: true, force: true });
  });
  raw = await createBatonWebMcpServer({
    connection: {
      baseUrl: BASE_URL, origin: BASE_URL, repoId: REPO_ID, token: TOKEN,
      socketPath: resident.socketPath, transport: 'local',
    },
    coordination: new CoordinationStore(join(directory, 'coordination')),
    pollMs: 5,
    commandTimeoutMs: 20_000,
  });
  const server = wrapProductionMcpServer(raw, { expandNative: true });
  const notifications = [];
  server.attachNotificationSink((frame) => { notifications.push(frame); });
  await server.handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'lane2', version: '1' } },
  });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  let nextId = 2;
  const call = (name, args = {}) => server.handle({
    jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args },
  });
  // The raw bridge server keeps the flat table (docs/49 §2): an embedder that holds it reaches the
  // SAME facade, so a core verb's answer can be compared with its flat counterpart's byte for byte.
  const callRaw = (name, args = {}) => raw.handle({
    jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args },
  });
  return { resident, server, raw, notifications, call, callRaw };
}

const answerOf = async (surface, name, args, { flat = false } = {}) => {
  const response = await (flat ? surface.callRaw(name, args) : surface.call(name, args));
  const frame = response?.result?.structuredContent;
  assert.equal(response?.result?.isError === true, false,
    `${name} answers: ${JSON.stringify(response?.result?.content ?? response)}`);
  assert.equal(typeof frame, 'object', `${name} answers structured content`);
  return frame;
};

const wakeFrame = ({ seq, wakeClass, swarmId = null, participantId = null, runId = null }) => Object.freeze({
  schemaVersion: 1, kind: 'baton.wake', seq, ts: `2026-09-18T00:00:${`${seq % 60}`.padStart(2, '0')}.000Z`,
  wakeClass, swarmId, participantId, runId, workerId: null, actor: 'orchestrator',
  subject: participantId === null ? null : Object.freeze({ kind: 'participant', id: participantId }),
  next: null, observation: false, row: null,
});

// ── 314-D2-a: the receipt is the operation's own, and the view never rides ──────────────────────

test('314-D2-a: a core mutation answers the receipt its operation answered, never the whole view', async (t) => {
  const created = await realSwarmCreateReceipt(t);
  assert.equal(typeof created.receipt?.event?.seq, 'number', 'the fixture minted a real #302 receipt');
  const surface = await servedSurface(t, (command) => {
    if (command === 'swarm_create') return created;
    if (command === 'run_start') return RUN_VIEW;
    throw Object.assign(new Error(`${command} is not scripted`), { code: 'unscripted_command' });
  });
  // The bound bridge surface derives repoId AND idempotencyKey server-side (docs/49 §4), so a call
  // supplies neither: the facade mints the keyed verb's key from the operation's own axes (#344).
  const core = await answerOf(surface, 'baton_swarm', { verb: 'create', purpose: 'Issue #314 lane 2 receipt parity' });
  assert.equal(core.schemaVersion, 1, 'the answer carries the envelope\'s own schema version (docs/49 §5)');
  assert.equal(core.command, 'swarm.create', 'and names the operation it answers');
  assert.deepEqual(core.receipt, created.receipt,
    'the core answer carries the receipt the operation itself answered — the runtime\'s #302 object '
    + 'the CLI receives, never a bridge-only second shape');
  assert.deepEqual(core.next, created.next, 'the step that follows rides the same derivation');
  assert.equal(core.view, undefined, 'the whole view never rides a mutation answer by default');
  assert.equal(core.phase, undefined, 'and no projection field smuggles it in');

  const flat = await answerOf(surface, 'baton_swarm_create', {
    purpose: 'Issue #314 lane 2 receipt parity',
  }, { flat: true });
  assert.deepEqual(flat, core,
    'a core verb and its flat counterpart reach ONE operation and answer byte-identically (docs/36 §1.3)');
});

test('314-D2-a2: a run mutation answers a receipt and its own outcome — the outline answer is retired', async (t) => {
  const surface = await servedSurface(t, (command) => {
    if (command === 'run_start') return RUN_VIEW;
    throw Object.assign(new Error(`${command} is not scripted`), { code: 'unscripted_command' });
  });
  const started = await answerOf(surface, 'baton_run', { verb: 'start', intent: { objective: 'lane 2 probe' } });
  assert.equal(started.schemaVersion, 1, 'the answer carries the envelope\'s own schema version');
  assert.equal(started.command, 'run.start', 'the answer names the operation it answers');
  assert.equal(typeof started.receipt, 'object', 'a mutation answers the #302 receipt');
  assert.equal(started.receipt.command, 'run.start');
  assert.equal(started.receipt.event, null,
    'the run projection carries no recorded event, and the receipt says so instead of inventing one');
  assert.deepEqual(started.receipt.changed, [{ collection: 'runs', id: 'run-314-lane2' }],
    'the row the answer\'s own identity names');
  assert.deepEqual(started.next, { command: 'run.view', args: { runId: 'run-314-lane2' } },
    'the step that follows the receipt');
  assert.equal(started.outline, undefined, 'the whole outline never rides the answer');
  assert.equal(started.view, undefined, 'and neither does the view, unless the caller asks for it');
  assert.equal(surface.resident.commands.some((call) => call.command === 'run_inspect'), false,
    'the retired outline follow-up is not sent: the answer no longer blocks on the run view');
});

// ── 314-D2-b: a long verb answers a receipt plus the wake subscription its follow-up rides ──────

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** One #302 receipt, the shape the swarm runtime answers with (its `changed` rows carry the seq/ts
 * the write recorded). The bridge never re-derives it — it is the operation's own object. */
const swarmReceipt = (command, kind, id) => ({
  schemaVersion: undefined,
  receipt: {
    command,
    event: { kind, seq: 21, ts: '2026-09-18T00:00:21.000Z', actor: 'orchestrator' },
    changed: [{ collection: 'participants', id, seq: 21, ts: '2026-09-18T00:00:21.000Z' }],
  },
  next: { command: 'swarm.guide', args: { swarmId: 'swarm-314', participantId: id } },
});

const LONG_VERBS = Object.freeze([
  Object.freeze({
    label: 'baton_run {verb: start} (run.start)',
    tool: 'baton_run', verb: 'start',
    args: { intent: { objective: 'lane 2 long verb' } },
    answers: { run_start: RUN_VIEW },
    kinds: ['attention', 'paused', 'integrated'],
    settleOn: ['attention', 'paused', 'integrated'],
    swarms: null, participants: null,
    settle: wakeFrame({ seq: 11, wakeClass: 'paused', runId: 'run-314-lane2' }),
    foreign: wakeFrame({ seq: 12, wakeClass: 'queued', runId: 'run-314-lane2' }),
  }),
  Object.freeze({
    label: 'baton_swarm {verb: recruit} (swarm.recruit)',
    tool: 'baton_swarm', verb: 'recruit',
    args: { swarmId: 'swarm-314', participantId: 'seat-314', objective: 'lane 2 seat' },
    answers: { swarm_recruit: swarmReceipt('swarm.recruit', 'swarm.participant_joined', 'seat-314') },
    kinds: ['queued', 'refused', 'dead', 'reroute_proposed', 'contribution_recorded'],
    settleOn: ['refused', 'dead', 'reroute_proposed', 'contribution_recorded'],
    swarms: ['swarm-314'], participants: ['seat-314'],
    settle: wakeFrame({ seq: 13, wakeClass: 'dead', swarmId: 'swarm-314', participantId: 'seat-314' }),
    // Another swarm's death is not this operation's: the handoff is scoped to its own subject.
    foreign: wakeFrame({ seq: 14, wakeClass: 'dead', swarmId: 'swarm-other', participantId: 'seat-314' }),
  }),
  Object.freeze({
    label: 'baton_waves {verb: start} (waves.start)',
    tool: 'baton_waves', verb: 'start',
    args: { members: [{ role: 'builder', objective: 'lane 2 member', exact: { harness: 'mock', model: 'model-a', effort: 'low' } }] },
    answers: { waves_start: { schemaVersion: 1, waveId: `wave:${'a'.repeat(32)}`, members: [{ role: 'builder', runId: 'run-wave-314' }] } },
    kinds: ['attention', 'paused', 'integrated'],
    settleOn: ['attention', 'paused', 'integrated'],
    swarms: null, participants: null,
    settle: wakeFrame({ seq: 16, wakeClass: 'integrated', runId: 'run-wave-314' }),
  }),
]);

for (const row of LONG_VERBS) {
  test(`314-D2-b: ${row.label} answers a receipt plus the wake subscription its follow-up rides`, async (t) => {
    const surface = await servedSurface(t, (command) => {
      if (Object.hasOwn(row.answers, command)) return row.answers[command];
      throw Object.assign(new Error(`${command} is not scripted`), { code: 'unscripted_command' });
    });
    const started = Date.now();
    const answer = await answerOf(surface, row.tool, { verb: row.verb, ...row.args });
    const elapsedMs = Date.now() - started;
    assert.equal(typeof answer.receipt, 'object', 'a long verb is a mutation: it answers a receipt');
    assert.equal(typeof answer.wake?.subscriptionId, 'string', 'the answer hands back the wake subscription its follow-up rides (#294)');
    // The subscription receipt echoes the filter in the wake stream's own order (its vocabulary
    // sorts the closed set); the CLASSES are the core row's declaration, which is what is compared.
    assert.deepEqual(answer.wake.kinds, [...row.kinds].sort(),
      'the handoff carries the core row\'s own classes');
    assert.deepEqual(answer.wake.settleOn, row.settleOn,
      'settleOn names the subset whose frame settles THIS operation\'s follow-up');
    assert.deepEqual(answer.wake.swarms, row.swarms,
      'the handoff is scoped to the operation\'s subject, never to another swarm\'s frames');
    assert.deepEqual(answer.wake.participants, row.participants);
    assert.equal(answer.wake.attachments, 1, 'one subscription rides the session\'s ONE attachment');
    assert.equal(surface.notifications.length, 0,
      'the answer is the receipt: nothing had settled yet when it returned, so the call never waited');
    assert.ok(elapsedMs < 5_000, `the call answers inside the receipt bound (${elapsedMs} ms)`);

    if (row.foreign !== undefined) {
      surface.resident.push(row.foreign);
      await sleep(75);
      assert.equal(surface.notifications.some((frame) => frame.params?.seq === row.foreign.seq), false,
        'a frame outside the handoff\'s own filter does not reach this subscription');
    }
    surface.resident.push(row.settle);
    const delivered = await waitFor(() => surface.notifications,
      (frames) => frames.some((frame) => frame.params?.seq === row.settle.seq),
      { label: `${row.label} settle frame` });
    const frame = delivered.find((entry) => entry.params?.seq === row.settle.seq);
    assert.equal(frame.method, 'notifications/baton/wake', 'the settle arrives on the landed wake plane');
    assert.equal(frame.params.kind, 'baton.wake', 'the notification params ARE the stream frame');
    assert.equal(frame.params.wakeClass, row.settle.wakeClass, 'the row that settled the follow-up');
    assert.ok(row.settleOn.includes(frame.params.wakeClass),
      'the frame that settles is one of the classes the handoff named');
  });
}

// ── 314-D2-c: #479 — the doctor projection carries the stopping section while draining ──────────

const STOPPING = Object.freeze({
  state: 'stopping', since: '2026-09-18T00:00:30.000Z',
  waits: Object.freeze([{ on: 'worker', ids: Object.freeze(['w-1']), at: '2026-09-18T00:00:30.000Z' }]),
  abandoned: Object.freeze([]),
});

test('314-D2-c: #479 baton_deployment {verb: doctor} carries the stopping section the client answers', async (t) => {
  const surface = await servedSurface(t, () => {
    throw Object.assign(new Error('the drain truth is a read, not a command'), { code: 'unscripted_command' });
  });
  const idle = await answerOf(surface, 'baton_deployment', { verb: 'doctor' });
  assert.equal(Object.hasOwn(idle, 'stopping'), true,
    'the projection names the section in every state — null, never absent (the CLI doctor\'s own rule)');
  assert.equal(idle.stopping, null, 'a resident that is not stopping has no stopping section');

  surface.resident.setStopping(STOPPING);
  const draining = await answerOf(surface, 'baton_deployment', { verb: 'doctor' });
  assert.deepEqual(draining.stopping, STOPPING,
    'a stopping resident says so on the card every client reads (#467/#476), and the MCP projection '
    + 'carries that section verbatim — the state and the waits the stop holds');
  assert.equal(draining.ready, false, 'the readiness read during the drain is answered as it is');
  const flat = await answerOf(surface, 'baton_deployment_doctor', {}, { flat: true });
  assert.deepEqual(flat, draining, 'the flat counterpart answers byte-identically');
});
