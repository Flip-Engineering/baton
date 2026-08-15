// MCP attention-push red-first acceptance suite (#208 items 2-3, contract:
// docs/reference/evidence/attention-spine-2026-08-14/wave-a/row-mcp-push-brief.md). The MCP
// server→client notification transport: a host holding an active run.attention.watch on a
// notification-capable connection receives server→client MCP notifications carrying the
// aggregate (coalesced at most one per runId+attention-shape per delivery window — the drain
// cadence, never a fixed clock; coalescing merges, never drops the terminal shape). Member
// spawn/stall/death transitions and drive verdicts ride the SAME lane with an attention-kind
// discriminator; a connection that cannot receive notifications degrades to the watch's
// pull-on-open, honestly reported at subscribe time — never silent loss.
//
// Red-first: every capability row fails for a NAMED stage at HEAD and goes green on the #208
// items 2-3 implementation ONLY. RED at pre-change head: the transport is absent — the watch
// tool result carries no `push` report, the server exposes no `takeNotifications()`, and the
// fake notification-capable client receives nothing on member input_required.
//
// Suite law (brief): namespace imports for invented surfaces; hermetic (real CoordinationStore
// with an injected fixture clock, mkdtemp, test.after, no network); no localeCompare; no
// wall-clock workflow controls — the injected clock is the only time source; the fold cursor is
// the store event seq, never the in-memory attention cursor.
//
// ROW INVENTORY (§A-§E):
//   §A  RED-CORE      — a fake client advertising the notification capability receives the
//                       aggregate on member input_required (stage[push-transport-missing] at HEAD).
//   §B  FALLBACK      — a connection that did not advertise the capability is honestly served by
//                       pull-on-open: push.enabled false + fallback 'pull-on-open' at subscribe
//                       time, and takeNotifications() stays empty (never silent loss).
//   §C  COALESCE      — two members reaching input_required in ONE delivery window coalesce into
//                       one notification (aggregate.count 2), never one per member.
//   §D  TERMINAL      — a member death in the same window rides its own kind (member_terminal);
//                       merging never drops the terminal shape.
//   §E  STDIO         — serveMcpStdio writes the notifications on the SAME connection after a
//                       response (the response cadence is the delivery window).
//
// NAMED RED STAGE:
//   stage[push-transport-missing] — the pre-change head has no server→client attention push:
//       the watch tool result has no `push` report, and McpFleetServer has no takeNotifications
//       surface, so the aggregate never reaches the client.
//
// VERIFIED SPLIT (recorded at the head this suite first ran red): §A stage[push-transport-missing]
// fails; §B push-report field absent; §C-§E no drain surface. Green on the #208 items 2-3
// implementation.

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { CoordinationStore, McpFleetServer, serveMcpStdio } from '../src/index.mjs';

const NOW = Date.parse('2026-08-14T21:00:00.000Z');
const root = () => mkdtempSync(join(tmpdir(), 'baton-mcp-push-'));
const principal = (overrides = {}) => ({
  userId: 'wave-owner', sessionId: 'stdio-owner', capabilities: ['control', 'observe', 'approve'],
  repoIds: ['repo-a'], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false, ...overrides,
});
const runApplicationCard = () => ({
  schemaVersion: 1,
  repoId: 'repo-a',
  commands: ['application.help', 'runs.list', 'run.start', 'run.inspect', 'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop', 'run.act', 'run.status', 'run.follow', 'run.recover', 'run.approve', 'run.wait', 'run.answer', 'run.feedback', 'run.steer', 'run.stop', 'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate', 'run.export', 'waves.attach', 'application.shutdown'],
});
function setup(overrides = {}) {
  const directory = overrides.directory ?? root();
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const application = overrides.application ?? {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args) {
      if (name === 'run.attention.watch') {
        return Object.freeze({
          schemaVersion: 1, runId: args.runId,
          afterCursor: args.cursor ?? 0, throughCursor: 0, reasons: [],
        });
      }
      return {};
    },
  };
  const server = new McpFleetServer({
    coordinator: { list() { return []; } },
    coordination,
    application,
    applicationOwned: false,
    surface: 'application',
    bindApplicationContext: false,
    principal: overrides.principal ?? principal(),
    repoIds: ['repo-a'],
    now: () => NOW,
    maxWaitMs: 25_000,
    maxMessageBytes: 64 * 1024,
    takeToolQuota: overrides.takeToolQuota ?? (async () => ({ ok: true })),
  });
  return { coordination, directory, server };
}
const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server, capabilities = { notifications: {} }) {
  const response = await request(server, 1, 'initialize', {
    protocolVersion: '2025-11-25', capabilities, clientInfo: { name: 'push-test', version: '1' },
  });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  assert.deepEqual(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  return response;
}
// A watch subscribe returns the structuredContent tool result; at HEAD the `push` report is
// absent, on the transport it is present.
async function subscribe(server, runId, kind) {
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_run_attention_watch',
    arguments: { repoId: 'repo-a', runId, ...(kind === undefined ? {} : { kind }) },
  });
  assert.equal(response.result?.isError, false, 'the watch tool succeeds');
  return response.result.structuredContent;
}
// Drive one member into input_required on the resident's coordination store — the truth source
// the push folds. Distinct idempotency keys per mutation (createTask's key is per-create).
function mintInputRequired(coordination, runId, taskId, seed) {
  coordination.createTask({ id: taskId, runId, relation: 'implementer' }, { actor: 'driver:push', key: `${taskId}:create:${seed}` });
  coordination.transitionTask(taskId, 'working', 1, { actor: 'driver:push', key: `${taskId}:work:${seed}` });
  return coordination.transitionTask(taskId, 'input_required', 2, { actor: 'driver:push', key: `${taskId}:input:${seed}` }).event.seq;
}

test('§A RED-CORE: a fake client advertising the notification capability receives the aggregate on member input_required', async () => {
  const { coordination, server } = setup();
  await initialized(server, { notifications: {} });
  const page = await subscribe(server, 'run:push-a');
  // The subscribe-time push report is the transport-honest handshake: enabled on a
  // notification-capable connection, naming the single lane and its coalescing contract.
  assert.deepEqual(page.push, { enabled: true, method: 'notifications/attention', coalesced: true });

  const throughSeq = mintInputRequired(coordination, 'run:push-a', 'task:push-a', 'a');

  // Drain on the caller's cadence — the delivery window derived from the observed notification
  // cadence, never a fixed clock.
  const notifications = server.takeNotifications();
  assert.ok(Array.isArray(notifications), 'takeNotifications returns an array');
  assert.ok(notifications.length >= 1, 'the aggregate notification rides the lane');
  const inputRequired = notifications.find((notification) => notification.params?.kind === 'input_required');
  assert.ok(inputRequired, `an input_required notification is present: ${JSON.stringify(notifications.map((n) => n.params?.kind))}`);
  assert.equal(inputRequired.jsonrpc, '2.0');
  assert.equal(inputRequired.method, 'notifications/attention');
  assert.equal(inputRequired.params.schemaVersion, 1);
  assert.equal(inputRequired.params.runId, 'run:push-a');
  assert.equal(inputRequired.params.kind, 'input_required');
  assert.deepEqual(inputRequired.params.aggregate, { count: 1 });
  assert.equal(inputRequired.params.events.length, 1);
  assert.equal(inputRequired.params.events[0].seq, throughSeq);
  assert.equal(inputRequired.params.events[0].taskId, 'task:push-a');
  assert.equal(inputRequired.params.events[0].status, 'input_required');
  assert.equal(inputRequired.params.throughSeq, throughSeq);
  // A second drain with no new events emits nothing (no fabricated re-delivery).
  assert.deepEqual(server.takeNotifications(), []);
});

test('§B FALLBACK: a connection that did not advertise the capability degrades to pull-on-open, honestly reported at subscribe time', async () => {
  const { coordination, server } = setup();
  await initialized(server, {});
  const page = await subscribe(server, 'run:push-b');
  assert.deepEqual(page.push, { enabled: false, fallback: 'pull-on-open' });
  // The watch's pull-on-open page still rides the tool result (never silent loss of the page).
  assert.equal(page.runId, 'run:push-b');
  mintInputRequired(coordination, 'run:push-b', 'task:push-b', 'b');
  // A non-capable connection never fabricates a push: the lane stays empty.
  assert.deepEqual(server.takeNotifications(), []);
});

test('§C COALESCE: two members reaching input_required in one delivery window coalesce into one notification', async () => {
  const { coordination, server } = setup();
  await initialized(server, { notifications: {} });
  await subscribe(server, 'run:push-c');
  mintInputRequired(coordination, 'run:push-c', 'task:push-c-1', 'c1');
  mintInputRequired(coordination, 'run:push-c', 'task:push-c-2', 'c2');
  const notifications = server.takeNotifications();
  const inputRequired = notifications.filter((notification) => notification.params?.kind === 'input_required');
  assert.equal(inputRequired.length, 1, 'at most one aggregate per runId+attention-shape per delivery window');
  assert.deepEqual(inputRequired[0].params.aggregate, { count: 2 });
  assert.deepEqual(inputRequired[0].params.events.map((event) => event.taskId), ['task:push-c-1', 'task:push-c-2']);
});

test('§D TERMINAL: a member death in the same window rides its own kind — merging never drops the terminal shape', async () => {
  const { coordination, server } = setup();
  await initialized(server, { notifications: {} });
  await subscribe(server, 'run:push-d');
  coordination.createTask({ id: 'task:push-d', runId: 'run:push-d', relation: 'implementer' }, { actor: 'driver:push', key: 'task:push-d:create:d' });
  coordination.transitionTask('task:push-d', 'working', 1, { actor: 'driver:push', key: 'task:push-d:work:d' });
  coordination.transitionTask('task:push-d', 'input_required', 2, { actor: 'driver:push', key: 'task:push-d:input:d' });
  const terminalSeq = coordination.transitionTask('task:push-d', 'failed', 3, { actor: 'driver:push', key: 'task:push-d:failed:d' }).event.seq;
  const notifications = server.takeNotifications();
  const terminal = notifications.find((notification) => notification.params?.kind === 'member_terminal');
  assert.ok(terminal, `the terminal shape survives merging: ${JSON.stringify(notifications.map((n) => n.params?.kind))}`);
  assert.deepEqual(terminal.params.aggregate, { count: 1 });
  assert.equal(terminal.params.events[0].seq, terminalSeq);
  assert.equal(terminal.params.events[0].status, 'failed');
});

test('§E STDIO: serveMcpStdio writes the notifications on the SAME connection after a response', async () => {
  const { coordination, server } = setup();
  const input = new PassThrough();
  const output = new PassThrough();
  let outText = '';
  output.on('data', (chunk) => { outText += chunk.toString(); });
  const serving = serveMcpStdio(server, { input, output, maxLineBytes: 256 * 1024 });
  const line = (object) => input.write(`${JSON.stringify(object)}\n`);
  line({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: { notifications: {} }, clientInfo: { name: 'push-test', version: '1' } } });
  line({ jsonrpc: '2.0', method: 'notifications/initialized' });
  line({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'baton_run_attention_watch', arguments: { repoId: 'repo-a', runId: 'run:push-e' } } });
  // Deterministic ordering (no wall-clock workflow control): wait until the SUBSCRIBE RESPONSE
  // lands on the wire — that is the moment the push subscription's fold cursor was set — then
  // mint the input_required transition. The response to the next request is the delivery window.
  for (let attempt = 0; attempt < 200 && !outText.includes('"id":2'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(outText.includes('"id":2'), 'the watch subscribe response lands before the transition is minted');
  mintInputRequired(coordination, 'run:push-e', 'task:push-e', 'e');
  line({ jsonrpc: '2.0', id: 3, method: 'ping' });
  input.end();
  await serving;
  const frames = outText.trim().split('\n').map((text) => JSON.parse(text));
  const ping = frames.find((frame) => frame.id === 3);
  assert.ok(ping, 'the ping response rides the wire');
  const pushed = frames.filter((frame) => frame.method === 'notifications/attention');
  assert.ok(pushed.length >= 1, `the notification rides the SAME connection: ${outText}`);
  assert.ok(pushed.some((frame) => frame.params?.kind === 'input_required' && frame.params?.runId === 'run:push-e'),
    'the input_required aggregate reaches the client on the same stdio connection');
});
