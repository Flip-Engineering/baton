import { after as afterFixtureCleanup } from 'node:test';
import { rmSync as removeFixtureDirectory } from 'node:fs';
// Issue #343: per-row swarm.view projections over the MCP bridge, with the narrowing named.
//
// When a swarm.view answer exceeds the bridge frame, the MCP bridge must serve the rows
// through the per-row projection that fits — never an oversize failure, never an unusable
// truncated blob. Every narrowed answer names the narrowing it applied (which projection
// was substituted and what was left out) so the caller can re-request precisely.
//
// The resident (web-northbound) narrows against the one declared substrate row both sides
// share (wire.frame); the bridge script aligns its frame to the same row. Red-first: the
// narrowSwarmViewForBridge import fails until the resident lands it, and the script pin
// fails until the script wires the frame through.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_COMMAND_DEFINITIONS, CoordinationStore, WebNorthbound } from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { SWARM_VIEW_PROJECTION_NAMES, projectSwarmView } from '../src/swarm-contract.mjs';
import { narrowSwarmViewForBridge, swarmViewBridgeFrameBytes } from '../src/web-northbound.mjs';

const mintedFixtureDirectories = [];

function mintFixtureDirectory(...args) {
  const directory = mkdtempSync(...args);
  mintedFixtureDirectories.push(directory);
  return directory;
}

afterFixtureCleanup(() => {
  for (const directory of mintedFixtureDirectories) {
    removeFixtureDirectory(directory, { recursive: true, force: true });
  }
});

const CEILING = FRAME_LIMITS['wire.frame'].value;

const root = () => mintFixtureDirectory(join(tmpdir(), 'baton-343-'));
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

function participantRow(index, extra = {}) {
  return {
    seq: index + 1,
    ts: '2026-09-17T00:00:00.000Z',
    participantId: `seat-${index}`,
    guidance: [{ seq: 100 + index, ts: '2026-09-17T00:00:00.000Z', from: 'root', messageId: `message:${'a'.repeat(64)}` }],
    workspace: { physicalOwnerId: `ws-${index}`, shared: false, holderCount: 1 },
    route: { harness: 'mock', model: 'model-a', effort: 'low' },
    scope: ['impl/**'],
    runtime: { state: 'active', turn: 1, live: true },
    ...extra,
  };
}

// A full-shape view: every sliced family present, so the narrowing ladder has something
// to substitute and the omitted set has something to name.
function fullView({ participants = 3, knowledgeBytes = 0, workEntries = 2 } = {}) {
  const work = {};
  for (let index = 0; index < workEntries; index += 1) {
    work[`W-${index}`] = { seq: index + 1, ts: '2026-09-17T00:00:00.000Z', objective: `part ${index}`, status: 'open' };
  }
  return {
    swarmId: 'swarm-1',
    purpose: 'narrowing fixture',
    status: 'open',
    projection: 'full',
    participants: Array.from({ length: participants }, (_, index) => participantRow(index)),
    work,
    assignments: {},
    contributions: {},
    reviews: {},
    groups: [],
    couplings: [],
    context: {},
    knowledge: knowledgeBytes > 0
      ? [{ seq: 7, ts: '2026-09-17T00:00:00.000Z', kind: 'fact', body: 'k'.repeat(knowledgeBytes) }]
      : [],
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

const fitsFrame = (candidate, ceiling) => swarmViewBridgeFrameBytes(candidate) <= ceiling;

test('343-1: a fitting swarm.view answer passes through untouched — no narrowing named', () => {
  const view = fullView();
  assert.ok(fitsFrame(view, CEILING), 'the fixture really fits the bridge frame');
  const served = narrowSwarmViewForBridge(view, 'full', CEILING);
  assert.equal(served.projection, 'full');
  assert.equal(Object.hasOwn(served, 'narrowing'), false, 'a fitting answer names no narrowing');
  assert.deepEqual(served.participants, view.participants);
});

test('343-2: an oversize full view serves the rows through the widest fitting per-row projection', () => {
  // Participants dominate: knowledge bulks the full answer past the ceiling while the
  // participants slice still fits — so the widest fit is the participants projection.
  const view = fullView({ participants: 40, knowledgeBytes: 30_000 });
  const ceiling = 48_000;
  assert.ok(swarmViewBridgeFrameBytes(view) > ceiling, 'the full answer really exceeds the ceiling');
  const served = narrowSwarmViewForBridge(view, 'full', ceiling);
  assert.equal(served.projection, 'participants');
  assert.deepEqual(served.participants, view.participants, 'every row pages through the fitting projection');
  assert.ok(swarmViewBridgeFrameBytes(served) <= ceiling, 'the served answer fits the ceiling it names');
  assert.equal(served.narrowing.requested, 'full');
  assert.equal(served.narrowing.served, 'participants');
  assert.ok(served.narrowing.omitted.includes('knowledge'), 'the narrowing names the families left out');
  assert.ok(served.narrowing.omitted.includes('work'), 'the narrowing names the families left out');
  assert.deepEqual(served.narrowing.omittedParticipantFields, [], 'whole rows keep their per-row fields');
  assert.equal(served.narrowing.reason, 'frame_ceiling');
  assert.equal(served.narrowing.ceiling.lane, 'wire.frame');
});

test('343-3: an explicitly requested participants projection narrows per-row and names the fields left out', () => {
  const view = fullView({ participants: 40 });
  const requested = 'participants';
  const received = { ...view, projection: requested };
  const candidateBytes = (name) => swarmViewBridgeFrameBytes(projectSwarmView(received, name));
  // The fixture's workspace slice is strictly smaller than its guidance slice, so a ceiling
  // with room for the narrowing record above the workspace slice — but still below the
  // guidance slice — deterministically substitutes the workspace per-row projection.
  const workspaceBytes = candidateBytes('workspace');
  const guidanceBytes = candidateBytes('guidance');
  assert.ok(workspaceBytes + 2048 < guidanceBytes, 'the fixture orders the per-row slices');
  const served = narrowSwarmViewForBridge(received, requested, workspaceBytes + 2048);
  assert.equal(served.projection, 'workspace');
  assert.equal(served.participants.length, view.participants.length, 'no row is dropped by the narrowing');
  assert.ok(fitsFrame(served, workspaceBytes + 2048), 'the served answer fits the ceiling it names');
  assert.equal(served.narrowing.requested, 'participants');
  assert.equal(served.narrowing.served, 'workspace');
  assert.ok(served.narrowing.omittedParticipantFields.includes('guidance'), 'the narrowing names the per-row fields left out');
  assert.ok(served.narrowing.omittedParticipantFields.includes('route'), 'the narrowing names the per-row fields left out');

  // A ceiling admitting only the rowless outline (with room for the record) falls through to it.
  const outlineBytes = candidateBytes('outline');
  assert.ok(outlineBytes + 2048 < workspaceBytes, 'the outline stands alone below the per-row slices');
  const outlineOnly = narrowSwarmViewForBridge(received, requested, outlineBytes + 2048);
  assert.equal(outlineOnly.projection, 'outline');
  assert.equal(outlineOnly.narrowing.requested, 'participants');
  assert.equal(outlineOnly.narrowing.served, 'outline');
  assert.ok(outlineOnly.narrowing.omitted.includes('participants'), 'the outline names the rows left out');
});

test('343-4: every projection name the contract declares stays a candidate the bridge can serve', () => {
  for (const name of ['full', 'outline', 'participants', 'contributions', 'attention', 'guidance', 'workspace', 'knowledge']) {
    assert.ok(SWARM_VIEW_PROJECTION_NAMES.includes(name), `${name} is a declared projection`);
  }
});

test('343-5: the resident serves an oversize swarm.view over the web lane narrowed and named', async (t) => {
  // A genuinely oversize answer against the real wire.frame ceiling: the value alone must
  // exceed half the frame because the bridge measures the tool-result envelope (~2x).
  const view = fullView({ participants: 120, knowledgeBytes: 560_000 });
  assert.ok(swarmViewBridgeFrameBytes(view) > CEILING, 'the fixture really exceeds the bridge frame');
  const web = residentFixture(t, view);
  const response = await web.execute(context(), viewEnvelope({ frame: { lane: 'wire.frame' } }));
  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  const served = response.body.result;
  assert.ok(served.narrowing, 'the narrowed answer names its narrowing');
  assert.equal(served.narrowing.requested, 'full');
  assert.equal(served.narrowing.served, served.projection);
  assert.notEqual(served.projection, 'full', 'the oversize projection is substituted, not served');
  assert.ok(served.narrowing.omitted.length > 0, 'the narrowing names what was left out');
  assert.ok(swarmViewBridgeFrameBytes(served) <= CEILING,
    'the served answer fits the frame the bridge enforces');
});

test('343-6: the resident serves a fitting swarm.view unnamed — no narrowing on a fitting answer', async (t) => {
  const view = fullView();
  assert.ok(swarmViewBridgeFrameBytes(view) <= CEILING, 'the fixture really fits the bridge frame');
  const web = residentFixture(t, view);
  const response = await web.execute(context(), viewEnvelope());
  assert.equal(response.status, 200);
  assert.equal(response.body.result.projection, 'full');
  assert.equal(Object.hasOwn(response.body.result, 'narrowing'), false);
});

test('343-7: narrowing applies to swarm.view only — other oversize answers cross untouched', async (t) => {
  const big = { runId: 'run-1', depth: 'outline', bulk: 'b'.repeat(10_000) };
  const application = stubApplication(async () => structuredClone(big));
  const web = new WebNorthbound({
    coordinator: {}, coordination: new CoordinationStore(root()),
    repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'],
    now: () => Date.parse('2026-09-17T00:00:00.000Z'), application,
  });
  const response = await web.execute(context(), viewEnvelope({
    commandId: 'cmd-inspect-1', idempotencyKey: 'inspect-1',
    command: 'run_inspect', args: { runId: 'run-1', depth: 'outline' },
    // Issue #349: even a DECLARED frame narrows swarm.view only — never another command's answer.
    frame: { lane: 'wire.frame' },
  }));
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(response.body.result, 'narrowing'), false);
});

test('343-8: the MCP bridge frame is the declared wire.frame row the resident narrows against', () => {
  const script = readFileSync(new URL('../scripts/mcp-web.mjs', import.meta.url), 'utf8');
  assert.match(script, /maxMessageBytes/, 'the bridge script sets its frame explicitly');
  assert.match(script, /FRAME_LIMITS\['wire\.frame'\]/, 'the bridge frame is the declared substrate row, never a fresh constant');
});
