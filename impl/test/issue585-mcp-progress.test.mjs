// Issue #585 stage 3 (docs/56 §D2): progress notifications on the session's bounded blocking
// reads. A client asks for progress with `_meta.progressToken` on the `tools/call` params; the
// server slices the wait, offers ONE `notifications/progress` frame between slices, and returns
// the leg's own result. A call with no token makes exactly the one call it made before.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CoordinationStore, McpFleetServer } from '../src/index.mjs';
import { ProductionConvergenceRuntime } from '../src/production-convergence.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-convergence.mjs';
import { mockApplicationCard } from '../scripts/surface-truth.mjs';

const NOW = Date.parse('2026-09-24T00:00:00.000Z');
const root = () => mkdtempSync(join(tmpdir(), 'baton-mcp-progress-'));
const principal = (overrides = {}) => ({
  userId: 'operator-a', sessionId: 'progress-a',
  capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
  repoIds: ['repo-a'], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
  ...overrides,
});
const runApplicationCard = () => mockApplicationCard('repo-a');
const emptyDigest = Object.freeze({ attention: [], facts: [], prose: [], cursor: null, more: false });
const eventDigest = Object.freeze({
  attention: [],
  facts: [Object.freeze({ kind: 'contribution_recorded', worker: 'worker-1', seq: 33_712 })],
  prose: [],
  cursor: null,
  more: false,
});

/** The phase16 in-memory idiom: a recording coordinator double, a real CoordinationStore, and a
 * recording notification sink the transport can deliver frames through. */
function setup(overrides = {}) {
  const waits = [];
  const frames = [];
  const coordinator = {
    async wait(timeoutMs) {
      waits.push(timeoutMs);
      return typeof overrides.wait === 'function'
        ? overrides.wait(timeoutMs, waits.length)
        : emptyDigest;
    },
  };
  const directory = overrides.directory ?? root();
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const server = new McpFleetServer({
    coordinator, coordination,
    application: overrides.application,
    surface: overrides.surface ?? (overrides.application ? 'combined' : undefined),
    shutdownPrincipal: overrides.application
      ? { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' }
      : undefined,
    notificationSink: overrides.remote === true ? null : (frame) => frames.push(frame),
    principal: overrides.principal ?? principal(), repoIds: ['repo-a'], now: () => NOW,
    maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  return { coordinator, coordination, frames, server, waits };
}

const request = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

async function initialized(server) {
  await request(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}

/** One `tools/call` carrying `_meta` exactly as the caller wrote it: `undefined` for no `_meta`,
 * `{}` for `_meta` without a token, or the token itself. */
function progressCall(server, id, name, args, meta) {
  return request(server, id, 'tools/call', {
    name,
    arguments: args,
    ...(meta === undefined ? {} : { _meta: meta === null ? {} : { progressToken: meta } }),
  });
}

function progressFrames(frames) {
  return frames.filter((frame) => frame.method === 'notifications/progress');
}

test('#585: a tokenless blocking wait makes one call at its own bound and offers no frame', async () => {
  const s = setup(); await initialized(s.server);
  const args = { repoId: 'repo-a', timeoutMs: 25_000 };
  for (const [index, meta] of [undefined, null, { progressToken: null }].entries()) {
    const response = await progressCall(s.server, 10 + index, 'fleet_wait', args, meta);
    assert.equal(response.result.isError, false);
    assert.deepEqual(response.result.structuredContent, emptyDigest);
  }
  // One call per request, each at the full bound: no slicing, no timing change.
  assert.deepEqual(s.waits, [25_000, 25_000, 25_000]);
  assert.deepEqual(s.frames, []);
});

test('#585: a token slices the wait and between slices offers the call its own observation', async () => {
  const s = setup({
    wait: (timeoutMs, ordinal) => (ordinal === 1 ? emptyDigest : eventDigest),
  });
  await initialized(s.server);
  const response = await progressCall(s.server, 2, 'fleet_wait', { repoId: 'repo-a', timeoutMs: 25_000 }, 'tok-585');
  // The wire result is the slice that observed anything, exactly the digest the leg answered.
  assert.equal(response.result.isError, false);
  assert.deepEqual(response.result.structuredContent, eventDigest);
  // Two slices of the cadence max(1000, bound / 8) = 3125ms, the second ending the call.
  assert.deepEqual(s.waits, [3_125, 3_125]);
  const frames = progressFrames(s.frames);
  assert.equal(frames.length, 1);
  const [frame] = frames;
  assert.equal(frame.jsonrpc, '2.0');
  assert.deepEqual(frame.params.progressToken, 'tok-585');
  assert.equal(Object.hasOwn(frame.params, 'total'), false);
  // Nothing had been observed when the frame was offered, and the frame says so beside the
  // elapsed and bound seconds of this call's own deadline.
  assert.equal(frame.params.progress, 0);
  assert.match(frame.params.message, /^waiting on fleet events · no events yet · \d+s of 25s$/);
});

test('#585: a run wait names the observation its last slice made', async () => {
  const dispatched = [];
  const views = [
    { schemaVersion: 1, runId: 'run-a', phase: 'running', cursor: 10 },
    { schemaVersion: 1, runId: 'run-a', phase: 'running', cursor: 12 },
    { schemaVersion: 1, runId: 'run-a', phase: 'completed', cursor: 13 },
  ];
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args) {
      dispatched.push({ name, args });
      return views[Math.min(dispatched.length - 1, views.length - 1)];
    },
  };
  const s = setup({ application }); await initialized(s.server);
  const response = await progressCall(s.server, 2, 'baton_run_wait', { repoId: 'repo-a', runId: 'run-a', timeoutMs: 8_000 }, 'tok-wait');
  // The application's own end condition ends the call: the settled view is the result.
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.phase, 'completed');
  assert.deepEqual(dispatched.map((call) => [call.name, call.args.timeoutMs]), [
    ['run.wait', 1_000], ['run.wait', 1_000], ['run.wait', 1_000],
  ]);
  assert.deepEqual(dispatched.map((call) => call.args.runId), ['run-a', 'run-a', 'run-a']);
  const frames = progressFrames(s.frames);
  assert.equal(frames.length, 2);
  // The first slice set the baseline: nothing had moved yet.
  assert.equal(frames[0].params.progress, 0);
  assert.match(frames[0].params.message, /^waiting on run events · no events yet · \d+s of 8s$/);
  // The second slice moved the view, and that observation is what the frame names.
  assert.equal(frames[1].params.progress, 1);
  assert.match(frames[1].params.message, /^waiting on run events · last #12 running · \d+s of 8s$/);
  for (const frame of frames) {
    assert.equal(frame.params.progressToken, 'tok-wait');
    assert.equal(Object.hasOwn(frame.params, 'total'), false);
  }
});

test('#585: a run follow page that observed nothing keeps waiting; the page that carries the change answers', async () => {
  const dispatched = [];
  const pages = [
    {
      schemaVersion: 1, runId: 'run-a', cursor: 30,
      follow: { schemaVersion: 1, runId: 'run-a', afterCursor: 3, throughCursor: 3, hasMore: false, timedOut: true, terminal: false, changes: [] },
    },
    {
      schemaVersion: 1, runId: 'run-a', cursor: 31,
      follow: {
        schemaVersion: 1, runId: 'run-a', afterCursor: 3, throughCursor: 30, hasMore: false, timedOut: false, terminal: false,
        changes: [{ seq: 30, category: 'plan', kind: 'plan.node_dispatched', summary: 'Run Plan authority changed.' }],
      },
    },
  ];
  const application = {
    repoId: 'repo-a', card: runApplicationCard,
    async authorizeReplay() { return true; },
    async command(name, args) {
      dispatched.push({ name, args });
      return pages[Math.min(dispatched.length - 1, pages.length - 1)];
    },
  };
  const s = setup({ application }); await initialized(s.server);
  const response = await progressCall(s.server, 2, 'fleet_run_follow', {
    repoId: 'repo-a', runId: 'run-a', afterCursor: 3, timeoutMs: 8_000,
  }, 'tok-follow');
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.follow.changes.length, 1);
  assert.deepEqual(dispatched.map((call) => [call.name, call.args.timeoutMs]), [['run.follow', 1_000], ['run.follow', 1_000]]);
  const frames = progressFrames(s.frames);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].params.progressToken, 'tok-follow');
  assert.equal(Object.hasOwn(frames[0].params, 'total'), false);
  assert.match(frames[0].params.message, /^waiting on run events · no events yet · \d+s of 8s$/);
});

test('#585: a transport that cannot deliver notifications answers the same result without throwing', async () => {
  const s = setup({ remote: true, wait: (timeoutMs, ordinal) => (ordinal === 1 ? emptyDigest : eventDigest) });
  assert.equal(s.server.notificationSink, null);
  await initialized(s.server);
  const response = await progressCall(s.server, 2, 'fleet_wait', { repoId: 'repo-a', timeoutMs: 25_000 }, 'tok-remote');
  assert.equal(response.result.isError, false);
  assert.deepEqual(response.result.structuredContent, eventDigest);
  // The slicing happened; only the frame was skipped, silently.
  assert.deepEqual(s.waits, [3_125, 3_125]);
  assert.deepEqual(s.frames, []);
});

// ── the composed surface watch leg: production-mcp-convergence.mjs's own blocking read ──────────

function watchTarget({ pages, frames, dispatched }) {
  return {
    surface: 'combined',
    lifecycle: 'ready',
    maxWaitMs: 25_000,
    repoIds: new Set(['repo-a']),
    principal: principal(),
    toolNames: new Set(['fleet_list']),
    toolDefinitions: [],
    coordinator: {},
    coordination: {},
    _authority: () => null,
    _audit: () => ({ ok: true }),
    async takeToolQuota() { return { ok: true }; },
    notify: (method, params) => frames.push({ jsonrpc: '2.0', method, params }),
    application: {
      card: () => ({ repoId: 'repo-a', commands: [] }),
      async command(name, args) {
        dispatched.push({ name, args });
        if (name === 'run.follow') return pages[Math.min(dispatched.filter((call) => call.name === 'run.follow').length - 1, pages.length - 1)];
        if (name === 'run.attention.watch') return { runId: args.runId, afterCursor: 0, throughCursor: 7, reasons: [] };
        return { name, args };
      },
      async decisionList() { return { decisions: [] }; },
    },
    async handle(message) { return { jsonrpc: '2.0', id: message.id, result: { structuredContent: { ok: true } } }; },
  };
}

test('#585: the composed surface watch reports progress through the same seam', async () => {
  const frames = [];
  const dispatched = [];
  const pages = [
    {
      schemaVersion: 1, runId: 'run:a', cursor: 20,
      follow: { schemaVersion: 1, runId: 'run:a', afterCursor: 4, throughCursor: 4, hasMore: false, timedOut: true, terminal: false, changes: [] },
    },
    {
      schemaVersion: 1, runId: 'run:a', cursor: 21,
      follow: {
        schemaVersion: 1, runId: 'run:a', afterCursor: 4, throughCursor: 20, hasMore: false, timedOut: false, terminal: false,
        changes: [{ seq: 20, category: 'execution', kind: 'task.transitioned', summary: 'Run execution state changed.' }],
      },
    },
  ];
  const server = wrapProductionMcpServer(watchTarget({ pages, frames, dispatched }), {
    runtime: new ProductionConvergenceRuntime(),
  });
  const response = await request(server, 2, 'tools/call', {
    name: 'baton_surface_watch',
    arguments: { runId: 'run:a', afterCursor: 4, timeoutMs: 8_000 },
    _meta: { progressToken: 'tok-watch' },
  });
  const page = response.result.structuredContent;
  assert.equal(page.kind, 'baton.surface_watch');
  assert.equal(page.nextAfterCursor, 21);
  assert.equal(page.follow.follow.changes.length, 1);
  assert.deepEqual(dispatched.filter((call) => call.name === 'run.follow').map((call) => call.args.timeoutMs), [1_000, 1_000]);
  const progress = progressFrames(frames);
  assert.equal(progress.length, 1);
  assert.equal(progress[0].params.progressToken, 'tok-watch');
  assert.equal(Object.hasOwn(progress[0].params, 'total'), false);
  assert.match(progress[0].params.message, /^waiting on run events · no events yet · \d+s of 8s$/);
});
