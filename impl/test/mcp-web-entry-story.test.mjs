// Issue #314 lane 4 (docs/49 §4, §7): the ONE entry story, pinned.
//
//   ES-A  the resident bridge takes no descriptor: `mcp-web.mjs <anything>` refuses typed
//         (`cli_invalid`, exit 2, the usage line) and names the headless entry, while the bare
//         invocation still discovers its own connection — the two entries have one story each.
//   ES-B  MCP.md's rendered inventory is the table the server advertises, both directions: the
//         committed block is byte-fresh against the renderer, every tool it lists is advertised
//         by the SHIPPED surface (the composition both entries serve), and every advertised name
//         is documented in MCP.md — a stale guide is a red row, never a doc drift.
//   ES-C  the migration section is rendered from the design that owns it (docs/49 §7): the
//         committed block byte-equals the renderer's output, and the renderer refuses a design
//         table whose shape it cannot read rather than rendering an empty one.
//   ES-D  both entries run the same entry-parity gate over the same operation table — the claim
//         MCP.md's "One tool table, two entries" makes.
//
// A new tool that lands on the wire without MCP.md learning it (or a block that names one the
// server does not serve) fails ES-B; a guide section that drifts from the design table fails
// ES-C. The suite-wide `render-surface-docs.mjs --check` covers the byte half for every target;
// these rows are the doc-versus-wire half, which no other row reads.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import test from 'node:test';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { McpFleetServer } from '../src/mcp-northbound.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import {
  MCP_INVENTORY_MARKER, MCP_MIGRATION_MARKER, checkSurfaceDocs, renderMcpMigrationTable,
  renderMcpToolInventory,
} from '../scripts/render-surface-docs.mjs';

const execFileAsync = promisify(execFile);
const MCP_DOC = new URL('../MCP.md', import.meta.url);
const BRIDGE_ENTRY = new URL('../scripts/mcp-web.mjs', import.meta.url);
const STDIO_ENTRY = new URL('../scripts/mcp-stdio.mjs', import.meta.url);
const REPO_ID = 'repo-314-entry';
const NOW = Date.parse('2026-09-18T00:00:00.000Z');

/** The served agent surface exactly as a client meets it: the real McpFleetServer ordinary surface
 * under the production wrapper both entries apply, over a stub application card (the
 * issue314-mcp-core-surface-red fixture idiom). */
function shippedToolNames(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-314-entry-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const raw = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination'), { clock: () => new Date(NOW).toISOString() }),
    application: {
      repoId: REPO_ID,
      card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
      async authorizeReplay() { return true; },
      async command(name) { return { schemaVersion: 1, command: name }; },
    },
    surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'entry-a', capabilities: ['control', 'observe'],
      repoIds: [REPO_ID], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => NOW, maxWaitMs: 25_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  const server = wrapProductionMcpServer(raw, { expandNative: true });
  const request = (id, method, params) => server.handle({ jsonrpc: '2.0', id, method, params });
  return (async () => {
    await request('init', 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'entry', version: '1' } });
    await request(undefined, 'notifications/initialized', {});
    const listed = await request('list', 'tools/list', {});
    return listed.result.tools.map((tool) => tool.name);
  })();
}

/** The tool names a rendered block documents: the third column of the inventory table, and the
 * first cell of every migration row. */
function inventoryToolNames(block) {
  return block.split('\n')
    .map((line) => /^\| `([^`]+)` \| `[^`]+` \| `([^`]+)` \|/u.exec(line.trim()))
    .filter(Boolean)
    .map((match) => match[2]);
}

function migrationToolCellText(block) {
  return block.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|')
      && !/^\|\s*today's tool/u.test(line)
      && !/^\|[-|: ]+\|$/u.test(line));
}

test('ES-A (#314 lane 4): the bridge refuses an argument typed and names the headless entry', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-314-args-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  // The argument is refused as an argument, never read as a descriptor: the path does not exist,
  // and the refusal must not be a config/read failure about it.
  const absent = join(directory, 'baton-mcp.json');
  const refused = await execFileAsync(process.execPath, [BRIDGE_ENTRY.pathname, absent], { cwd: directory })
    .then(() => ({ code: 0, stderr: '' }), (error) => ({ code: error.code, stderr: error.stderr ?? '' }));
  assert.equal(refused.code, 2, 'a bridge argument is a usage refusal (exit 2), like the descriptor entry without one');
  assert.match(refused.stderr, /^usage: baton-mcp-web$/mu, 'the refusal carries the bridge usage line');
  assert.match(refused.stderr, /cli_invalid/u, 'the typed code is the invocation family the bridge already serves');
  assert.match(refused.stderr, /mcp-stdio\.mjs/u, 'the refusal names the headless entry that takes a descriptor');
  assert.doesNotMatch(refused.stderr, /cli_config_invalid|cli_transport_failed/u,
    'the argument is refused before discovery — never as a failed descriptor read');

  // The bare invocation is unchanged: it proceeds to discover its own connection (and, outside a
  // checkout, refuses there — the CT7 posture), never with the usage line of a bad invocation.
  const bare = await execFileAsync(process.execPath, [BRIDGE_ENTRY.pathname], {
    cwd: directory,
    // The startup-retry window is the resident-restart bridge; this row pins the discovery
    // refusal shape itself, so it runs the one-shot open.
    env: { ...process.env, BATON_MCP_WEB_STARTUP_WINDOW_MS: '0' },
  })
    .then(() => ({ code: 0, stderr: '' }), (error) => ({ code: error.code, stderr: error.stderr ?? '' }));
  assert.equal(bare.code, 1, 'a bare bridge start outside a checkout fails in discovery');
  assert.doesNotMatch(bare.stderr, /takes no arguments/u, 'no argument was supplied, so none is refused');
  assert.match(bare.stderr, /baton-mcp-web startup failed: cli_/u, 'the discovery failure keeps the bridge startup shape');
});

test('ES-B (#314 lane 4): MCP.md\'s inventory is the tool table the server advertises', async (t) => {
  const doc = readFileSync(MCP_DOC, 'utf8');
  const committed = doc.slice(
    doc.indexOf(`<!-- BEGIN GENERATED: ${MCP_INVENTORY_MARKER}`),
    doc.indexOf(`<!-- END GENERATED: ${MCP_INVENTORY_MARKER}`),
  );
  assert.ok(committed.length > 0, 'MCP.md carries the generated tool inventory');
  // The rendered half: the committed block is what the renderer produces right now.
  assert.deepEqual(checkSurfaceDocs({
    targets: [{ doc: MCP_DOC, marker: MCP_INVENTORY_MARKER, render: renderMcpToolInventory }],
  }), [], 'the inventory block is fresh, not a hand list');
  const listed = inventoryToolNames(committed);
  assert.ok(listed.length > 0, 'the inventory block lists tools');
  const served = new Set(await shippedToolNames(t));
  // Direction one: everything the guide lists as served IS served (a removed tool left in the
  // block is red, never a doc drift). A block that lists the RAW ordinary table while the shipped
  // composition serves the core verb-tools fails here: the fix is the renderer's own source
  // (impl/scripts/render-surface-docs.mjs `renderMcpToolInventory` reads the same table the
  // entries serve) plus `render-surface-docs.mjs` regeneration — never a doc edit.
  const phantom = listed.filter((name) => !served.has(name));
  assert.deepEqual(phantom, [], 'the inventory lists no tool the shipped surface does not advertise '
    + '(regenerate MCP.md from the shipped core table, never hand-edit the block)');
  // Direction two: everything the shipped surface advertises is documented somewhere in the guide
  // (a tool added to the wire without MCP.md learning it is red).
  const documented = new Set([...doc.matchAll(/`(baton_[a-z0-9_]+)`/gu)].map((match) => match[1]));
  const undocumented = [...served].filter((name) => !documented.has(name));
  assert.deepEqual(undocumented, [], 'every advertised tool is documented in MCP.md');
});

test('ES-C (#314 lane 4): the migration section is rendered from the design that owns it (docs/49 §7)', () => {
  const doc = readFileSync(MCP_DOC, 'utf8');
  const committed = doc.slice(
    doc.indexOf(`<!-- BEGIN GENERATED: ${MCP_MIGRATION_MARKER}`),
    doc.indexOf(`<!-- END GENERATED: ${MCP_MIGRATION_MARKER}`),
  );
  assert.ok(committed.length > 0, 'MCP.md carries the generated migration table');
  assert.deepEqual(checkSurfaceDocs({
    targets: [{ doc: MCP_DOC, marker: MCP_MIGRATION_MARKER, render: renderMcpMigrationTable }],
  }), [], 'the migration table is what docs/49 §7 renders to, byte for byte');
  const rows = migrationToolCellText(committed);
  assert.ok(rows.length > 0, 'the migration table carries rows');
  assert.ok(rows.every((row) => /`baton_[a-z0-9_]+`/u.test(row)), 'every migration row names a flat spelling');
});

test('ES-D (#314 lane 4): both entries run the same parity gate over the same operation table', () => {
  for (const entry of [BRIDGE_ENTRY, STDIO_ENTRY]) {
    const source = readFileSync(entry, 'utf8');
    assert.match(source, /assertCliMcpControlParity\(\)/u, `${entry.pathname} runs the CLI/MCP contract parity`);
    assert.match(source, /assertUnifiedCapabilityCoverage\(\)/u, `${entry.pathname} runs the capability coverage gate`);
    assert.match(source, /assertSurfaceCapabilityNameClosure\(\)/u, `${entry.pathname} runs the surface name closure gate`);
    assert.match(source, /wrapProductionMcpServer\(/u, `${entry.pathname} serves the shipped composition`);
  }
  // The descriptor entry alone reads a descriptor; the bridge entry refuses one (ES-A).
  assert.match(readFileSync(STDIO_ENTRY, 'utf8'), /createMcpServerFromDescriptorPath\(/u,
    'the headless entry is the one that opens a descriptor');
  assert.doesNotMatch(readFileSync(BRIDGE_ENTRY, 'utf8'), /createMcpServerFromDescriptorPath/u,
    'the bridge entry no longer builds a descriptor server');
});
