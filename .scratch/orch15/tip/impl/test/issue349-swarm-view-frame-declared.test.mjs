// Issue #349: regression from #343 — the resident narrowed EVERY swarm.view envelope against
// the MCP bridge's `wire.frame` ceiling, so a CLI web client (which declares no frame and prints
// far larger answers) silently received rows with status/runtime/guidance stripped.
//
// The contract now: narrowing is the answer shape of a caller that DECLARES the frame it
// answers under. One optional top-level envelope field `frame` — closed shape {lane} naming a
// declared FRAME_LIMITS row — is admitted and validated; the MCP bridge declares
// {lane:'wire.frame'} on swarm.view; the resident narrows ONLY when the envelope carries a
// frame, against the row it names, on the scoped and the unscoped read alike. A caller without
// a frame receives the whole answer as before #343. And when a narrowed answer does cross to
// the CLI, the renderer prints the narrowing record BEFORE the rows — never bare rows shaped
// like the requested projection.
//
// Red-first: at HEAD the frame field refuses as an unknown top-level field, the frameless read
// is narrowed anyway, and the CLI renderer does not exist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { parseBatonCli, projectBatonCliResult } from '../src/application-cli.mjs';
import { projectSwarmView } from '../src/swarm-contract.mjs';
import { swarmViewBridgeFrameBytes, validateWebCommandEnvelope } from '../src/web-northbound.mjs';

const CEILING = FRAME_LIMITS['wire.frame'].value;

const root = () => mkdtempSync(join(tmpdir(), 'baton-349-'));
const principal = (overrides = {}) => ({
  userId: 'user-1', sessionId: 'session-1', credentialId: 'cred-1', authMethod: 'cookie',
  csrfToken: 'csrf-1', expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
  capabilities: ['observe', 'control', 'approve', 'emergency_stop'], repoIds: ['repo-a'],
  ...overrides,
});
const context = (overrides = {}) => ({
  principal: principal(), origin: 'https://control.example.test', csrfToken: 'csrf-1',
  remoteAddress: '127.0.0.1', transport: 'https', ...overrides,
});
const viewEnvelope = (overrides = {}) => ({
  schemaVersion: 1,
  commandId: 'cmd-view-1',
  idempotencyKey: 'view-1',
  command: 'swarm_view',
  args: { swarmId: 'swarm-1' },
  repoId: 'repo-a',
  origin: 'https://control.example.test',
  ...overrides,
});

// A participants projection whose whole rows alone exceed the real wire.frame ceiling: the
// answer a 31-seat swarm returns is exactly the shape #343 stripped for every caller.
function participantRow(index) {
  return {
    seq: index + 1,
    ts: '2026-09-17T00:00:00.000Z',
    participantId: `seat-${index}`,
    guidance: [{
      seq: 100 + index, ts: '2026-09-17T00:00:00.000Z', from: 'root',
      messageId: `message:${'a'.repeat(64)}`, body: 'g'.repeat(24_000),
    }],
    workspace: { physicalOwnerId: `ws-${index}`, shared: false, holderCount: 1 },
    route: { harness: 'mock', model: 'model-a', effort: 'low' },
    scope: ['impl/**'],
    runtime: { state: 'active', turn: 1, live: true },
  };
}

function oversizeView({ participants = 48 } = {}) {
  return {
    swarmId: 'swarm-1',
    purpose: 'frame-declared fixture',
    status: 'open',
    projection: 'participants',
    participants: Array.from({ length: participants }, (_, index) => participantRow(index)),
    work: {},
    assignments: {},
    contributions: {},
    reviews: {},
    groups: [],
    couplings: [],
    context: {},
    knowledge: [],
    attention: [],
    caller: { participantId: null, permissions: ['read'], lastRefusal: null },
    availableActions: ['swarm.view'],
    updates: [],
    updatePayloads: {},
    deployment: null,
    cursor: 42,
  };
}

function stubApplication(commandImpl) {
  return {
    repoId: 'repo-a',
    card: () => ({ schemaVersion: 1, repoId: 'repo-a', commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args, ...rest) { return commandImpl(name, args, ...rest); },
  };
}

function residentFixture(t, view) {
  const application = stubApplication(async (name) => {
    assert.equal(name, 'swarm.view');
    return structuredClone(view);
  });
  const web = new WebNorthbound({
    coordinator: {}, coordination: new CoordinationStore(root()),
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'],
    now: () => Date.parse('2026-09-17T00:00:00.000Z'), application,
  });
  t.after(() => rmSync(web.coordination.root ?? root(), { recursive: true, force: true }));
  return web;
}

test('349-a: a web client reading a participants projection past wire.frame receives it untouched when the envelope declares no frame', async (t) => {
  const view = oversizeView();
  assert.ok(swarmViewBridgeFrameBytes(projectSwarmView(view, 'participants')) > CEILING,
    'the fixture really exceeds the bridge frame, so #343 would have narrowed it');
  const web = residentFixture(t, view);
  const response = await web.execute(context(), viewEnvelope({
    commandId: 'cmd-view-frameless', idempotencyKey: 'view-frameless',
    args: { swarmId: 'swarm-1', projection: 'participants' },
  }));
  assert.equal(response.status, 200);
  const served = response.body.result;
  assert.equal(Object.hasOwn(served, 'narrowing'), false,
    'a caller that declares no frame is never narrowed');
  assert.equal(served.projection, 'participants');
  assert.deepEqual(served.participants, view.participants,
    'whole rows cross: status, runtime, guidance and scope ride every row');
  assert.ok(swarmViewBridgeFrameBytes(served) > CEILING,
    'the answer is the whole projection, not a slice that fits a frame nobody declared');
});

test('349-b: the same view with frame {lane:"wire.frame"} on the envelope narrows and names the narrowing', async (t) => {
  const view = oversizeView();
  const web = residentFixture(t, view);
  const response = await web.execute(context(), viewEnvelope({
    commandId: 'cmd-view-framed', idempotencyKey: 'view-framed',
    args: { swarmId: 'swarm-1', projection: 'participants' },
    frame: { lane: 'wire.frame' },
  }));
  assert.equal(response.status, 200);
  const served = response.body.result;
  assert.ok(served.narrowing, 'the declared-frame answer names its narrowing (#343 behaviour preserved)');
  assert.equal(served.narrowing.requested, 'participants');
  assert.equal(served.narrowing.served, served.projection);
  assert.notEqual(served.projection, 'participants', 'the oversize projection is substituted');
  assert.equal(served.narrowing.ceiling.lane, 'wire.frame');
  assert.equal(served.narrowing.ceiling.value, CEILING);
  assert.ok(swarmViewBridgeFrameBytes(served) <= CEILING,
    'the served answer fits the frame the caller declared');
});

test('349-c: a scoped (participantId) read with a declared frame narrows like an unscoped one', async (t) => {
  const view = oversizeView();
  const web = residentFixture(t, view);
  const response = await web.execute(context(), viewEnvelope({
    commandId: 'cmd-view-scoped', idempotencyKey: 'view-scoped',
    args: { swarmId: 'swarm-1', participantId: 'seat-0', projection: 'participants' },
    frame: { lane: 'wire.frame' },
  }));
  assert.equal(response.status, 200);
  const served = response.body.result;
  assert.ok(served.narrowing, 'the scoped read follows the ONE rule: declared frame, narrowed answer');
  assert.equal(served.narrowing.requested, 'participants');
  assert.notEqual(served.projection, 'participants');
  assert.ok(swarmViewBridgeFrameBytes(served) <= CEILING,
    'the scoped answer fits the declared frame too');
  // And the same scoped read WITHOUT the frame crosses whole — the pair proves scope and frame
  // are independent axes, both governed by the same rule.
  const frameless = await web.execute(context(), viewEnvelope({
    commandId: 'cmd-view-scoped-frameless', idempotencyKey: 'view-scoped-frameless',
    args: { swarmId: 'swarm-1', participantId: 'seat-0', projection: 'participants' },
  }));
  assert.equal(frameless.status, 200);
  assert.equal(Object.hasOwn(frameless.body.result, 'narrowing'), false,
    'the scoped read without a declared frame is never narrowed');
  assert.deepEqual(frameless.body.result.participants, view.participants);
});

test('349-d: validateEnvelope refuses frame {lane:"not-a-row"} typed, admits a declared lane, and keeps the shape closed', () => {
  const refused = validateWebCommandEnvelope(viewEnvelope({ frame: { lane: 'not-a-row' } }));
  assert.equal(typeof refused, 'object', 'the refusal is typed, never a route-shape string');
  assert.equal(refused.code, 'unknown_frame_lane');
  assert.equal(refused.field, 'frame.lane');
  // A declared lane is admitted on the envelope.
  assert.equal(validateWebCommandEnvelope(viewEnvelope({ frame: { lane: 'wire.frame' } })), null);
  // The shape is closed: exactly {lane}, naming a row.
  for (const broken of [
    'wire.frame',
    1_048_576,
    {},
    { lane: 'wire.frame', value: 64 },
    { lane: 42 },
  ]) {
    const shape = validateWebCommandEnvelope(viewEnvelope({ frame: broken, commandId: 'cmd-shape', idempotencyKey: 'shape' }));
    assert.equal(typeof shape, 'object', `frame ${JSON.stringify(broken)} is refused`);
    assert.equal(shape.code, 'invalid_frame');
  }
});

test('349-e: the CLI renderer prints the narrowing record before the rows when one is present', () => {
  const view = oversizeView({ participants: 3 });
  const narrowing = Object.freeze({
    requested: 'participants',
    served: 'workspace',
    omitted: ['work', 'assignments'],
    omittedParticipantFields: ['guidance', 'runtime', 'route', 'scope', 'status'],
    reason: 'frame_ceiling',
    ceiling: Object.freeze({ lane: 'wire.frame', class: 'substrate', value: CEILING, unit: 'bytes' }),
    actualBytes: 2_000_000,
  });
  const narrowedAnswer = Object.freeze({ ...projectSwarmView({ ...view, projection: 'participants' }, 'workspace'), narrowing });
  const parsed = parseBatonCli(['swarm', 'view', 'swarm-1', '--projection', 'participants']);
  const rendered = projectBatonCliResult(parsed, narrowedAnswer);
  assert.equal(rendered.narrowed, true, 'the answer announces itself as narrowed');
  assert.deepEqual(rendered.narrowing, narrowing, 'the narrowing record is rendered verbatim');
  assert.equal(rendered.expand.command, 'baton swarm view swarm-1 --projection participants',
    'the re-request that gets the rest is named');
  assert.deepEqual(rendered.participants, narrowedAnswer.participants,
    'the served rows still print, after the record');
  const text = JSON.stringify(rendered);
  assert.ok(text.indexOf('"narrowing"') < text.indexOf('"participants"'),
    'the narrowing record prints at the top, never bare rows shaped like the requested projection');
});
