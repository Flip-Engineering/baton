// #89 / Decision 12 refusal-coaching suite (facade-projection epic #87+#48): the MCP northbound
// boundary must surface the message-send size refusal with its SAFE actionable detail — cap AND
// actual — while keeping the MN1/MN8 sanitization law. Before the fix the ordinary wire mapping
// stripped `application_message_send_invalid` to a bare code (the facade's composed text never
// reached the wire); the fix marks ONLY the facade's oversize throw at the dispatch seam with the
// catalog triple, so an arbitrary/internal exception message is never forwarded wholesale and a
// closed-shape violation of the SAME code stays code-only.
//
// Fixture: a descriptor-driven McpFleetServer over a stub facade (the mcp-packaging-red idiom) so
// each row controls the exact throw. The wire text is parsed back with JSON.parse — the assertion
// reads the caller-visible payload, never internals.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { McpFleetServer } from '../src/mcp-northbound.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { FRAME_LIMITS, composeFrameLimitRefusal, frameLimitRefusalPath } from '../src/limits.mjs';

const REPO = 'repo-mcp-refusal-coaching';
const NOW = Date.parse('2026-09-12T00:00:00.000Z');
const MESSAGE_ROW = FRAME_LIMITS['message.send.body'];

function principalOf(overrides = {}) {
  return {
    userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
    repoIds: [REPO], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false, ...overrides,
  };
}

// The stub facade: every command resolves unless `command` throws for it. The served card is the
// full registry key set (the mcp-packaging-red card idiom) so the constructor's required-command
// contract is satisfied without a hand-kept list.
function fixture(t, { command } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-mcp-refusal-'));
  const coordination = new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() });
  const application = {
    repoId: REPO,
    card: () => ({ schemaVersion: 1, repoId: REPO, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async command(name, args, appPrincipal, context) {
      if (command) return command(name, args, appPrincipal, context);
      return { schemaVersion: 1, ok: true };
    },
  };
  const server = new McpFleetServer({
    coordinator: {}, coordination, application, surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: principalOf(),
    repoIds: [REPO], now: () => NOW, maxWaitMs: 25000, maxMessageBytes: 256 * 1024,
    takeToolQuota: async () => ({ ok: true }),
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { server };
}

const wireRequest = (server, id, method, params) => server.handle({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
async function initialized(server) {
  const response = await wireRequest(server, 1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}
const send = (server, id, args) => wireRequest(server, id, 'tools/call', { name: 'baton_run_message_send', arguments: args });
const resultText = (response) => response?.result?.content?.[0]?.text ?? '';
const mcpError = (response) => {
  assert.equal(response?.result?.isError, true, 'expected an MCP tool error');
  return JSON.parse(resultText(response)).error;
};
// The facade's own composed text for the oversize branch (application.mjs _normalizeMessageSend) —
// exactly what the projection must NOT forward wholesale, only re-render from the catalog.
const facadeOversize = (actual) => Object.assign(
  new Error(`Run message body exceeds the ${MESSAGE_ROW.value}-byte message cap (actual ${actual} bytes)`),
  { code: 'application_message_send_invalid' },
);

test('RC-01: the oversize send refusal names cap AND actual from the catalog (never the exception text)', async (t) => {
  const body = '€'.repeat(1025); // 1,025 chars (schema-legal) / 3,075 bytes (over the 2,048-byte lane cap)
  assert.equal(Buffer.byteLength(body), 3075);
  const { server } = fixture(t, {
    command: async (name) => { if (name === 'run.message.send') throw facadeOversize(3075); return { schemaVersion: 1, ok: true }; },
  });
  await initialized(server);
  const response = await send(server, 2, { repoId: REPO, runId: 'run:rc1', kind: 'inform', body });
  const error = mcpError(response);
  assert.equal(error.code, 'application_message_send_invalid', 'the lane code rides typed, never command_outcome_unknown');
  assert.deepEqual(error.detail, {
    cap: 2048, actual: 3075, unit: 'bytes', gracefulPath: frameLimitRefusalPath(MESSAGE_ROW, 2048),
  }, 'the SAFE {cap, actual, unit, gracefulPath} triple is exposed');
  assert.equal(error.message, composeFrameLimitRefusal(MESSAGE_ROW, 3075, 2048),
    'the message is RE-COMPOSED from the catalog row, not forwarded from the throw');
  assert.match(error.message, /2048/u);
  assert.match(error.message, /3075/u, 'the ACTUAL byte size is named, not the char length');
});

test('RC-02: at-cap is admitted; cap+1 refuses naming both numbers', async (t) => {
  const { server } = fixture(t, {
    command: async (name, args) => {
      if (name !== 'run.message.send') return { schemaVersion: 1, ok: true };
      const bytes = Buffer.byteLength(args.body);
      if (bytes > MESSAGE_ROW.value) throw facadeOversize(bytes);
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  const atCap = await send(server, 2, { repoId: REPO, runId: 'run:rc2', kind: 'inform', body: 'x'.repeat(2048) });
  assert.equal(atCap.result?.isError, false, `at-cap is admitted: ${resultText(atCap)}`);
  const overCap = await send(server, 3, { repoId: REPO, runId: 'run:rc2', kind: 'inform', body: 'x'.repeat(2049) });
  const error = mcpError(overCap);
  assert.equal(error.code, 'application_message_send_invalid');
  assert.deepEqual(error.detail, {
    cap: 2048, actual: 2049, unit: 'bytes', gracefulPath: frameLimitRefusalPath(MESSAGE_ROW, 2048),
  });
  assert.match(error.message, /2048/u);
  assert.match(error.message, /2049/u);
});

test('RC-03: a closed-shape violation of the SAME code stays code-only (no fabricated size detail)', async (t) => {
  const { server } = fixture(t, {
    command: async (name) => {
      if (name === 'run.message.send') {
        throw Object.assign(new Error('run message send request is invalid'), { code: 'application_message_send_invalid' });
      }
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  // Shape-legal at the wire (kind/body present) and BELOW the byte cap: the facade refuses for a
  // closed-shape reason, and the projection must not invent a cap/actual triple for it.
  const response = await send(server, 2, { repoId: REPO, runId: 'run:rc3', kind: 'inform', body: 'small' });
  const error = mcpError(response);
  assert.equal(error.code, 'application_message_send_invalid');
  assert.equal(Object.hasOwn(error, 'detail'), false, 'no size detail is fabricated for a shape refusal');
  assert.equal(Object.hasOwn(error, 'message'), false, 'the facade text is not forwarded for an unmarked refusal');
});

test('RC-04: an internal exception message is never forwarded wholesale (redaction)', async (t) => {
  const secret = 'internal provider exploded at /etc/baton/secret-token-abc123';
  const { server } = fixture(t, {
    command: async (name) => {
      if (name === 'run.message.send') throw Object.assign(new Error(secret), { code: 'provider_internal_boom' });
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  const response = await send(server, 2, { repoId: REPO, runId: 'run:rc4', kind: 'inform', body: 'small' });
  const error = mcpError(response);
  assert.equal(error.code, 'command_outcome_unknown', 'an unmapped internal throw degrades to the sanitized fallthrough');
  assert.equal(Object.hasOwn(error, 'message'), false, 'MN1/MN8: no private provider detail rides the wire');
  assert.equal(Object.hasOwn(error, 'detail'), false);
  assert.doesNotMatch(resultText(response), /secret-token-abc123/u, 'the internal message never leaks');
});

test('RC-05: cap/actual on a NON-size code never ride the wire (the marker is code-specific)', async (t) => {
  const { server } = fixture(t, {
    command: async (name) => {
      if (name === 'run.message.send') {
        throw Object.assign(new Error('board internals exploded'), {
          code: 'application_board_internal', cap: 2048, actual: 3075, unit: 'bytes', gracefulPath: 'x',
        });
      }
      return { schemaVersion: 1, ok: true };
    },
  });
  await initialized(server);
  const response = await send(server, 2, { repoId: REPO, runId: 'run:rc5', kind: 'inform', body: 'small' });
  const error = mcpError(response);
  assert.equal(error.code, 'application_board_internal', 'the typed code still rides (application_* passes through)');
  assert.equal(Object.hasOwn(error, 'detail'), false, 'a forged triple on another code is not exposed');
  assert.equal(Object.hasOwn(error, 'message'), false);
});

test('RC-06: the size refusal never quotes the caller body (secret-safe actionability)', async (t) => {
  const secret = 'token-abc123';
  const body = `${secret} ${'x'.repeat(2048)}`; // 2,061 bytes — over cap, and body-carried secret
  assert.equal(Buffer.byteLength(body), 2061);
  const { server } = fixture(t, {
    command: async (name) => { if (name === 'run.message.send') throw facadeOversize(2061); return { schemaVersion: 1, ok: true }; },
  });
  await initialized(server);
  const response = await send(server, 2, { repoId: REPO, runId: 'run:rc6', kind: 'inform', body });
  const error = mcpError(response);
  assert.equal(error.detail.actual, 2061);
  assert.equal(error.detail.cap, 2048);
  assert.doesNotMatch(resultText(response), new RegExp(secret, 'u'), 'AS-4: the refusal never quotes body content');
  assert.doesNotMatch(error.message ?? '', new RegExp(secret.slice(0, 12), 'u'));
});
