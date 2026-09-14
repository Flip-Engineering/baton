#!/usr/bin/env node
// The one surface gate (issue #262). Every check here already existed somewhere; what was
// missing was one entrypoint that authoring, the canonical suite, the pre-commit hook and CI all
// run, so a naming decision is refused when it is made instead of a session later.
//
//   node impl/scripts/surface-gate.mjs           # check; findings on stderr, exit 1 on any
//   node impl/scripts/surface-gate.mjs --write   # regenerate every artifact this gate checks
//
// Checks: the docs/36 grammar lint (banned legacy verbs), ledger validity, the surface inventory
// artifact, the generated CLI.md/MCP.md blocks, the CLI↔MCP parity matrix, and MCP dispatch
// resolvability (every advertised tool on the ordinary and combined surfaces resolves at
// tools/call — an advertised name that cannot dispatch is a surface lie).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { runSurfaceConformanceMain } from './surface-conformance.mjs';
import { checkSurfaceParityMatrix, writeSurfaceParityMatrix } from './surface-parity.mjs';
import { renderSurfaceDoc } from './render-surface-docs.mjs';

const { McpFleetServer } = await import(new URL('../src/mcp-northbound.mjs', import.meta.url).href);
const { CoordinationStore } = await import(new URL('../src/coordination-store.mjs', import.meta.url).href);
const { APPLICATION_COMMAND_DEFINITIONS } = await import(new URL('../src/application.mjs', import.meta.url).href);
const GATE_REPO_ID = 'repo-surface-gate';
const renderDocs = await import(new URL('./render-surface-docs.mjs', import.meta.url).href);

// MCP dispatch resolvability, proven by calling: a real McpFleetServer over a recording mock
// application and a recording mock coordinator receives one schema-shaped call per advertised
// tool (ordinary and combined surfaces). A tool whose call reaches neither authority and is not
// refused for its arguments resolved to nothing — the silent fallthrough that an advertised-but-
// unwired name produces. Argument refusals are reported separately: they mean the probe could not
// prove the path, never that the path is missing.
function sampleArgument(name, schema) {
  if (name === 'repoId') return GATE_REPO_ID;
  if (name === 'idempotencyKey') return 'gate-key-1';
  if (Array.isArray(schema?.enum) && schema.enum.length > 0) return schema.enum[0];
  const type = Array.isArray(schema?.type) ? schema.type[0] : schema?.type;
  if (type === 'object') {
    const nested = {};
    for (const key of schema.required ?? []) nested[key] = sampleArgument(key, schema.properties?.[key]);
    return nested;
  }
  if (type === 'array') return [];
  if (type === 'boolean') return true;
  if (type === 'integer' || type === 'number') return Number.isFinite(schema?.minimum) ? schema.minimum : 1;
  if (/digest|sha/iu.test(name)) return 'a'.repeat(64);
  if (/^message$|^text$|objective|purpose|reason|summary|feedback|note$/iu.test(name)) return 'gate probe';
  return 'gate-id-1';
}

export async function checkMcpDispatchResolvability() {
  const findings = [];
  const directory = mkdtempSync(join(tmpdir(), 'baton-surface-gate-'));
  try {
    const applicationCalls = [];
    const coordinatorCalls = [];
    const application = {
      repoId: GATE_REPO_ID,
      card: () => ({ schemaVersion: 1, repoId: GATE_REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
      async authorizeReplay() { return true; },
      async command(name) { applicationCalls.push(name); return { schemaVersion: 1, command: name }; },
      async contextEval() { applicationCalls.push('application.context_eval'); return { item: { id: `cell:${'a'.repeat(64)}`, value: {} } }; },
      async decisionList() { applicationCalls.push('decision.list'); return { decisions: [] }; },
    };
    const coordinator = new Proxy({}, {
      get: (_target, property) => (typeof property === 'string'
        ? (...args) => { coordinatorCalls.push(property); return { ok: true, result: 'ok', args }; }
        : undefined),
      has: () => true,
    });
    const server = new McpFleetServer({
      coordinator, application, surface: 'combined',
      coordination: new CoordinationStore(join(directory, 'coordination')),
      shutdownPrincipal: { actor: 'mcp-host:gate', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
      principal: {
        userId: 'gate', sessionId: 'gate-session',
        // Every capability any advertised tool can require (application table + kernel rows).
        capabilities: [
          'control', 'observe', 'approve', 'emergency_stop', 'adopt_result', 'export_result',
          'integrate_result', 'resume_work', 'retry_verification', 'review', 'settlement', 'host',
          'goal:define', 'plan:propose', 'plan:approve', 'goal:observe',
        ],
        repoIds: [GATE_REPO_ID], expiresAt: new Date(Date.now() + 60_000).toISOString(), revoked: false,
      },
      repoIds: [GATE_REPO_ID], maxWaitMs: 1_000, maxMessageBytes: 256 * 1024, takeToolQuota: () => ({ ok: true }),
    });
    await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'surface-gate', version: '1' } } });
    await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    let id = 3;
    for (const tool of listed.result.tools) {
      if (tool.name === 'fleet_drain') continue; // drains the host; its wiring is the drain path itself
      const args = {};
      for (const key of tool.inputSchema.required ?? []) args[key] = sampleArgument(key, tool.inputSchema.properties?.[key]);
      const before = applicationCalls.length + coordinatorCalls.length;
      let response;
      try {
        response = await server.handle({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name: tool.name, arguments: args } });
      } catch (error) {
        findings.push(`mcp tool ${tool.name} threw outside the protocol: ${error?.message ?? error}`);
        continue;
      }
      const reached = applicationCalls.length + coordinatorCalls.length > before;
      if (reached) continue;
      if (response?.error) {
        findings.push(`mcp tool ${tool.name}: the probe's schema-shaped call was refused before dispatch (${response.error.message}) — path unproven`);
        continue;
      }
      if (response?.result?.isError === true) {
        // The probe principal holds every capability a tool can require, so `forbidden` here
        // means the tool has no capability classification — the unwired-name signature.
        const code = response.result.structuredContent?.error?.code ?? null;
        if (code === 'forbidden') findings.push(`mcp tool ${tool.name} is advertised but carries no capability classification (tools/call: forbidden for a fully-capable principal)`);
        continue; // any other typed refusal is a resolved path
      }
      // Some tools are answered by the server itself (doctor, help): a substantive result is a
      // resolved path. The unwired fallthrough returns the empty projection of `undefined`.
      const text = (response?.result?.content ?? []).map((part) => part?.text ?? '').join('').trim();
      const empty = text === '' || text === 'null' || text === '{}' || text === '[]' || text === '""';
      if (!empty || response?.result?.structuredContent) continue;
      findings.push(`mcp tool ${tool.name} is advertised but resolved to nothing at tools/call`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  return findings;
}

/** Run every surface check; with `write`, regenerate the artifacts first. */
export async function runSurfaceGate({ write = false } = {}) {
  if (write) {
    for (const target of renderDocs.TARGETS ?? []) writeFileSync(target.doc, renderSurfaceDoc(target));
    writeSurfaceParityMatrix();
  }
  const findings = [
    ...runSurfaceConformanceMain({ writeInventory: write }).map((f) => `surface-conformance: ${f}`),
    ...checkSurfaceParityMatrix().map((f) => `surface-parity: ${f}`),
    ...(await checkMcpDispatchResolvability()).map((f) => `mcp-dispatch: ${f}`),
  ];
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const write = process.argv.includes('--write');
  const findings = await runSurfaceGate({ write });
  for (const finding of findings) process.stderr.write(`surface-gate: ${finding}\n`);
  if (findings.length > 0) process.exit(1);
  process.stdout.write(`surface-gate: ok${write ? ' (artifacts regenerated)' : ''}\n`);
}
