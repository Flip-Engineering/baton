// Issue #150: coaching-payload passthrough on MCP northbound. When a frame-economics
// size refusal fires during argument validation (the validateApplicationCommandArgs
// path), the corrective coaching payload {cap, actual, unit, gracefulPath} must survive
// the MCP toolError envelope byte-semantically so orchestrators can self-correct.
//
// Before the fix, validateArguments returned only {code, message} for coaching refusals,
// and the dispatch site called toolError(code, message, null, field) — the detail was
// null, so the coaching triple was lost.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { McpFleetServer } from '../src/mcp-northbound.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { FRAME_LIMITS, frameLimitRefusalPath } from '../src/limits.mjs';

const REPO = 'repo-issue150';
const NOW = Date.parse('2026-09-20T00:00:00.000Z');
const LEGACY_SEND_ROW = FRAME_LIMITS['run.legacy_send.body'];

function principalOf(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a',
    capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: [REPO],
    expiresAt: new Date(NOW + 60_000).toISOString(),
    revoked: false,
    ...overrides,
  };
}

function fixture(t, { command } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue150-'));
  const coordination = new CoordinationStore(
    join(directory, 'coordination'),
    { clock: () => new Date(NOW).toISOString() },
  );
  const application = {
    repoId: REPO,
    card: () => ({
      schemaVersion: 1, repoId: REPO,
      commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS),
    }),
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal, context) {
      if (command) return command(name, args, appPrincipal, context);
      return { schemaVersion: 1, ok: true };
    },
  };
  const server = new McpFleetServer({
    coordinator: {}, coordination, application, surface: 'application',
    shutdownPrincipal: {
      actor: 'mcp-host:test', principalId: 'mcp-host',
      sessionId: 'mcp-host-session',
    },
    principal: principalOf(),
    repoIds: [REPO], now: () => NOW, maxWaitMs: 25000,
    maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { server };
}

const wireRequest = (server, id, method, params) =>
  server.handle({
    jsonrpc: '2.0', id, method,
    ...(params === undefined ? {} : { params }),
  });

async function initialized(server) {
  const response = await wireRequest(server, 1, 'initialize', {
    protocolVersion: '2025-11-25', capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

const resultText = (response) => response?.result?.content?.[0]?.text ?? '';

const mcpError = (response) => {
  assert.equal(response?.result?.isError, true, 'expected an MCP tool error');
  return JSON.parse(resultText(response)).error;
};

// The validation path coaching refusal: baton_workstream_notify with an oversized
// message (>16384 bytes for the run.legacy_send.body lane). The coaching error is
// thrown by validateApplicationCommandArgs, caught in validateArguments, and must
// survive to the MCP wire with its {cap, actual, unit, gracefulPath} detail.
test('150-CP1: validation-path coaching refusal carries cap, actual, unit, gracefulPath on the MCP wire', async (t) => {
  const { server } = fixture(t);
  await initialized(server);

  const oversizedMessage = 'x'.repeat(LEGACY_SEND_ROW.value + 1);
  const actual = Buffer.byteLength(oversizedMessage);
  assert.ok(actual > LEGACY_SEND_ROW.value, 'precondition: message exceeds the lane cap');

  const response = await wireRequest(server, 2, 'tools/call', {
    name: 'baton_workstream_notify',
    arguments: {
      repoId: REPO,
      idempotencyKey: 'idem-150-cp1',
      runId: 'run:150',
      role: 'worker-a',
      message: oversizedMessage,
    },
  });

  const error = mcpError(response);
  assert.equal(error.code, 'run_legacy_send_exceeded',
    'the coaching refusalCode rides typed');
  assert.ok(error.detail != null, 'the coaching detail must be present');
  assert.equal(error.detail.cap, LEGACY_SEND_ROW.value,
    'detail.cap names the lane cap');
  assert.equal(error.detail.actual, actual,
    'detail.actual names the measured byte size');
  assert.equal(error.detail.unit, 'bytes',
    'detail.unit is bytes');
  assert.equal(error.detail.gracefulPath,
    frameLimitRefusalPath(LEGACY_SEND_ROW, LEGACY_SEND_ROW.value),
    'detail.gracefulPath names the retry remedy');
});

// The at-cap body must still be admitted (the refusal is strictly above cap).
test('150-CP2: at-cap message is admitted, cap+1 refuses with the coaching triple', async (t) => {
  const { server } = fixture(t);
  await initialized(server);

  // At-cap: exactly LEGACY_SEND_ROW.value bytes.
  const atCapResponse = await wireRequest(server, 2, 'tools/call', {
    name: 'baton_workstream_notify',
    arguments: {
      repoId: REPO,
      idempotencyKey: 'idem-150-cp2a',
      runId: 'run:150',
      role: 'worker-a',
      message: 'x'.repeat(LEGACY_SEND_ROW.value),
    },
  });
  // At-cap should NOT be a coaching refusal — it may fail for other reasons
  // (no real run), but it should not be run_legacy_send_exceeded.
  const atCapText = resultText(atCapResponse);
  if (atCapResponse.result?.isError === true) {
    const atCapError = JSON.parse(atCapText).error;
    assert.notEqual(atCapError.code, 'run_legacy_send_exceeded',
      'at-cap body must not draw the coaching refusal');
  }

  // Cap+1: one byte over.
  const overCapResponse = await wireRequest(server, 3, 'tools/call', {
    name: 'baton_workstream_notify',
    arguments: {
      repoId: REPO,
      idempotencyKey: 'idem-150-cp2b',
      runId: 'run:150',
      role: 'worker-a',
      message: 'x'.repeat(LEGACY_SEND_ROW.value + 1),
    },
  });

  const error = mcpError(overCapResponse);
  assert.equal(error.code, 'run_legacy_send_exceeded');
  assert.deepEqual(error.detail, {
    cap: LEGACY_SEND_ROW.value,
    actual: LEGACY_SEND_ROW.value + 1,
    unit: 'bytes',
    gracefulPath: frameLimitRefusalPath(LEGACY_SEND_ROW, LEGACY_SEND_ROW.value),
  }, 'the full coaching triple rides the wire at cap+1');
});
