// Issue #108 — a refused attention scope crosses as its own typed refusal, at ANY cursor.
//
// The witnessed failure (AX review, 2026-08-06): `baton_run_attention_watch` under the documented
// MCP principal threw `attention_scope_forbidden` at the lane, and the northbound converted it
// into a SILENT empty page — `{afterCursor: 0, throughCursor: 0, reasons: []}` — rewinding the
// requested cursor to 0 regardless. An agent watching a completed member forever saw "no news" and
// never learned why.
//
// The transport's later fix substituted that page only for a control-capable principal, which left
// the same silent conversion in place for the caller the deployment actually uses. The ruling on
// this issue: a cursor-0 caller gets the SAME refusal as one at cursor > 0. The fabricated page is
// removed, so the lane's typed refusal crosses as itself; the surface-watch leg already refuses a
// rewinding page by name ('refusing silent empty fallback', production-mcp-convergence.mjs).
//
// Rows:
//   108a  a control-capable principal with NO cursor gets the typed refusal, never an empty page;
//   108b  the same principal at cursor 7 gets the identical refusal (never a rewind to 0);
//   108c  an authorized scope still pages through the lane untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { CoordinationStore, McpFleetServer } from '../src/index.mjs';

const REPO_ID = 'repo-issue108';
const NOW = Date.parse('2026-09-26T00:00:00.000Z');

const application = {
  repoId: REPO_ID,
  card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
  async authorizeReplay() { return true; },
  async command(name, args) {
    if (name === 'run.attention.watch') {
      if (args.runId === 'run:authorized') {
        return {
          schemaVersion: 1, runId: args.runId, afterCursor: args.cursor ?? 0,
          throughCursor: args.cursor ?? 0, reasons: [],
        };
      }
      throw Object.assign(new Error('attention scope is forbidden'), { code: 'attention_scope_forbidden' });
    }
    return { schemaVersion: 1, command: name };
  },
  async decisionList() { return { decisions: [] }; },
};

function server(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-issue108-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return new McpFleetServer({
    coordinator: {}, coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application, shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator', sessionId: 'stdio-108', capabilities: ['control', 'observe'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
}
const request = (mcp, id, method, params) => mcp.handle({ jsonrpc: '2.0', id, method, params });
async function ready(mcp) {
  await request(mcp, 'init', 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
}
const watch = (mcp, id, args) => request(mcp, id, 'tools/call', {
  name: 'baton_run_attention_watch', arguments: { repoId: REPO_ID, ...args },
});

test('108a: a control-capable principal at cursor 0 gets the typed refusal, never an empty page', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const response = await watch(mcp, 1, { runId: 'run:foreign' });
  assert.equal(response.result?.isError, true, 'a refused scope is an error, never a silent success');
  assert.equal(response.result?.structuredContent?.error?.code, 'attention_scope_forbidden',
    'the lane\'s own typed code crosses as itself');
  const page = response.result?.structuredContent;
  assert.equal(page?.reasons, undefined,
    'no fabricated page: a caller whose scope was refused is never told "no news"');
});

test('108b: the same principal at cursor 7 gets the identical refusal, never a rewind to 0', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const first = await watch(mcp, 1, { runId: 'run:foreign' });
  const later = await watch(mcp, 2, { runId: 'run:foreign', cursor: 7 });
  assert.equal(later.result?.isError, true);
  assert.equal(later.result?.structuredContent?.error?.code, first.result?.structuredContent?.error?.code,
    'cursor 0 and cursor 7 are answered identically — the refusal does not depend on the cursor');
  assert.equal(JSON.stringify(later.result).includes('"afterCursor":0'), false,
    'and nothing rewinds the caller to 0');
});

test('108c: an authorized scope still pages through the lane untouched', async (t) => {
  const mcp = server(t);
  await ready(mcp);
  const response = await watch(mcp, 1, { runId: 'run:authorized', cursor: 3 });
  assert.equal(response.result?.isError, false, 'the removal touches only the conversion, never the page');
  assert.equal(response.result?.structuredContent?.throughCursor, 3, 'the lane\'s own page rides the wire');
  assert.deepEqual(response.result?.structuredContent?.reasons, []);
});
