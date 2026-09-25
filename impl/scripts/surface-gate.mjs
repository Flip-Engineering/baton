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
// tools/call — an advertised name that cannot dispatch is a surface lie) — and the one-definition
// custody predicate (an inline `ws-<32 hex>` shape is a second opinion about whether cleanup may
// destroy a shared checkout).
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';


const { McpFleetServer, commandForTool } = await import(new URL('../src/mcp-northbound.mjs', import.meta.url).href);
const { CoordinationStore } = await import(new URL('../src/coordination-store.mjs', import.meta.url).href);
const { applicationCardCommands } = await import(new URL('../src/application.mjs', import.meta.url).href);
const { webCardCommandNames } = await import(new URL('../src/web-northbound.mjs', import.meta.url).href);
const { SWARM_COMMAND_DEFINITIONS } = await import(new URL('../src/swarm-contract.mjs', import.meta.url).href);
const { BatonWebApplicationFacade } = await import(new URL('../src/mcp-web-bridge.mjs', import.meta.url).href);
const { APPLICATION_SEMANTIC_REGISTRY } = await import(new URL('../src/application-semantics.mjs', import.meta.url).href);
// The SHIPPED wrapper: both distribution entry points (scripts/mcp-stdio.mjs, scripts/mcp-web.mjs)
// wrap the raw server through this module before serving it (2026-09-14 audit U-N3 — probing the
// raw server proved dispatch for a server nobody runs).
const { wrapProductionMcpServer } = await import(new URL('../src/production-mcp-complete.mjs', import.meta.url).href);
const {
  canonicalSurfaceResolutionFindings, formatSurfaceResolutionFinding,
} = await import(new URL('../src/surface-resolution.mjs', import.meta.url).href);
const { CLI_WEB_COMMANDS, cliBusCommand, cliDispatches } = await import(new URL('../src/application-cli.mjs', import.meta.url).href);

/** The resident MCP bridge facade over the wire card a REAL resident advertises: the projection
 * the resident itself serves at /v1/application-card (web-northbound webCardCommandNames), plus
 * the application card's own command list. Every command an advertised tool dispatches must be
 * admitted by it, or the tool works in-process and is refused over the resident (#270). The facade
 * admits exactly what production admits — not the web bus's wider ADMITTED-name table (kernel
 * rows included), which let this check pass for commands production refuses (2026-09-14 audit,
 * U-N4: webAdmittedCommandNames() is 132 names where the served card carries the application
 * table plus the wave/workflow ports). */
function residentBridgeFacade() {
  return new BatonWebApplicationFacade(
    productionCardClient(),
    productionCard(),
    productionSession(),
  );
}
function productionSession() {
  return {
    schemaVersion: 1,
    identity: { userId: 'gate', sessionId: 'gate-bridge', capabilities: ['observe', 'control'], repoIds: [GATE_REPO_ID] },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}
/** The card a zero-assembly resident publishes: the served web card commands plus the application
 * card's own command list (application.mjs applicationCardCommands). */
function productionCard() {
  return {
    repoId: GATE_REPO_ID,
    commands: [...new Set([...webCardCommandNames(), ...applicationCardCommands()])].sort(),
    agentExperience: { registryDigest: APPLICATION_SEMANTIC_REGISTRY.digest },
  };
}
function productionCardClient() {
  const card = productionCard();
  const session = productionSession();
  return {
    repoId: GATE_REPO_ID,
    async session() { return session; },
    async doctor() { return { ready: true, application: card }; },
    async command(name) { return { ok: true, command: name }; },
  };
}
const GATE_REPO_ID = 'repo-surface-gate';

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
  const omittedOverResident = [];
  const directory = mkdtempSync(join(tmpdir(), 'baton-surface-gate-'));
  try {
    const applicationCalls = [];
    const coordinatorCalls = [];
    const application = {
      repoId: GATE_REPO_ID,
      card: () => ({ schemaVersion: 1, repoId: GATE_REPO_ID, commands: applicationCardCommands() }),
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
    const rawServer = new McpFleetServer({
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
    // Probe the SHIPPED server: both distribution entry points wrap before serving, so an
    // advertised tool is only real if it survives this wrapper's tools/list (2026-09-14 audit,
    // U-N3/U-E2).
    const server = wrapProductionMcpServer(rawServer, { expandNative: true });
    const bridge = residentBridgeFacade();
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
      if (reached) {
        // Reached in-process; now it must also be admitted by the resident bridge facade, or the
        // tool is advertised over the resident and refused there (#270).
        // The bridge advertises a tool only when it admits the tool's own command; a tool it does
        // advertise must never dispatch a command it refuses (a second command behind the first).
        const own = commandForTool(tool.name);
        if (own && !bridge._admits(own)) { omittedOverResident.push(tool.name); continue; }
        for (const command of new Set(applicationCalls.slice(before))) {
          if (command === 'application.context_eval' || command === 'decision.list') continue; // direct methods, not bridged string commands
          if (!bridge._admits(command)) findings.push(`mcp tool ${tool.name} dispatches ${command}, which the resident MCP bridge does not admit (advertised over the resident, refused there)`);
        }
        continue;
      }
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
  if (omittedOverResident.length > 0) process.stderr.write(`surface-gate: mcp-dispatch: ${omittedOverResident.length} tool(s) are host-local and not advertised over the resident bridge: ${omittedOverResident.join(', ')}\n`);
  return findings;
}

// ---------------------------------------------------------------------------
// One custody predicate, one definition (issue #286 G-36).
//
// `isPhysicalWorkspaceId` (shared-workspace-custody.mjs) is the ONE definition of the
// `ws-<32 hex>` shape. Every inline copy of that shape is a second opinion about whether a path
// is a shared physical workspace — which is to say, whether cleanup may destroy a checkout a
// different holder is working in. A drifted copy does not fail a test: it destroys work. So the
// literal is refused outside its one definition, by name, when it is written.
//
// Issue #582: the PENDING count-pin exemptions are removed — the four files that carried the
// shape now import the helper, so the rule below is the whole contract: the one definition and
// zero inline copies, everywhere.
// ---------------------------------------------------------------------------
export const CUSTODY_PREDICATE_TOKEN = 'ws-[a-f0-9]{32}';
export const CUSTODY_PREDICATE_DEFINITION = 'impl/src/shared-workspace-custody.mjs';
const CUSTODY_PREDICATE_SOURCE_DIR = fileURLToPath(new URL('../src', import.meta.url));
const CUSTODY_PREDICATE_DEFINITION_OCCURRENCES = 1;
/** Refuse a second definition of the physical-workspace-id shape (issue #286 G-36). `sources` —
 * an array of `{path, text}` — overrides the scanned set so the rule itself is testable; the
 * default is every `impl/src/*.mjs`, which is where a custody decision can live. */
export function checkCustodyPredicateLiteral({ sources = null } = {}) {
  const scanned = sources ?? readdirSync(CUSTODY_PREDICATE_SOURCE_DIR)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
    .map((name) => ({
      path: `impl/src/${name}`,
      text: readFileSync(join(CUSTODY_PREDICATE_SOURCE_DIR, name), 'utf8'),
    }));
  const findings = [];
  for (const source of scanned) {
    const occurrences = source.text.split(CUSTODY_PREDICATE_TOKEN).length - 1;
    if (source.path === CUSTODY_PREDICATE_DEFINITION) {
      if (occurrences !== CUSTODY_PREDICATE_DEFINITION_OCCURRENCES) {
        findings.push(`${source.path}: the one definition carries ${occurrences} copies of the shape,`
          + ` expected exactly ${CUSTODY_PREDICATE_DEFINITION_OCCURRENCES} — a second definition in the`
          + ' definition file is the same drift by another route');
      }
      continue;
    }
    if (occurrences > 0) {
      findings.push(`${source.path}: ${occurrences} inline copy/copies of the physical-workspace-id`
        + ` shape (${CUSTODY_PREDICATE_TOKEN}) — import isPhysicalWorkspaceId from`
        + ` shared-workspace-custody.mjs instead; an inline copy is a second opinion about whether`
        + ` cleanup may destroy a shared checkout (the one definition is ${CUSTODY_PREDICATE_DEFINITION})`);
    }
  }
  return findings;
}

/**
 * Every registry row that claims a surface must resolve to a name that surface actually serves:
 * the CLI parser compiles its taught example to a dispatched transport, the web command map
 * admits its transport, an advertised MCP tool dispatches its bus command (2026-09-14 audit,
 * U-N1/U-N2 — the gate that could not see the surface). This is the assertion that closes
 * U-E6, U-E7, U-G4, U-G5, U-G6 and U-G7 at authoring time.
 */
export function checkCanonicalSurfaceResolution() {
  return canonicalSurfaceResolutionFindings().map(formatSurfaceResolutionFinding);
}

/**
 * The CLI's two admission tiers must agree with the canonical table and with the divergence
 * ledger (2026-09-14 audit, U-E6): every wire-card transport the client may dispatch is in the
 * derived dispatch authority, and every cli divergence the ledger records (a facade port the card
 * does not carry) is dispatchable too — a ledgered port the client refuses is exactly the
 * advertised-but-refused class this check exists to catch.
 */
export function checkCliAdmissionDerivation() {
  const findings = [];
  for (const name of CLI_WEB_COMMANDS) {
    const bus = cliBusCommand(name);
    if (!cliDispatches(bus)) {
      findings.push(`wire-card transport ${name} is not in the derived dispatch authority`);
    }
  }
  return findings;
}
export async function runSurfaceGate() {
  const findings = [
    ...checkCanonicalSurfaceResolution().map((f) => `surface-resolution: ${f}`),
    ...checkCliAdmissionDerivation().map((f) => `cli-admission: ${f}`),
    ...(await checkMcpDispatchResolvability()).map((f) => `mcp-dispatch: ${f}`),
    ...checkCustodyPredicateLiteral().map((f) => `custody-predicate: ${f}`),
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
