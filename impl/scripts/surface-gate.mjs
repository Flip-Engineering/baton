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

import { runSurfaceConformanceMain } from './surface-conformance.mjs';
import { checkSurfaceParityMatrix, writeSurfaceParityMatrix } from './surface-parity.mjs';
import { renderSurfaceDoc } from './render-surface-docs.mjs';
import { collectSeamInventory } from './seam-inventory.mjs';

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
// `PENDING` names the files that still carry the shape and are not swept by this change (they lie
// outside the writing lane's authority). Each entry pins the occurrence count that remains, so a
// NEW copy inside a listed file is refused too, and an entry whose count drops is refused as
// stale — the exemption list can only shrink, and it cannot rot.
// ---------------------------------------------------------------------------
export const CUSTODY_PREDICATE_TOKEN = 'ws-[a-f0-9]{32}';
export const CUSTODY_PREDICATE_DEFINITION = 'impl/src/shared-workspace-custody.mjs';
const CUSTODY_PREDICATE_SOURCE_DIR = fileURLToPath(new URL('../src', import.meta.url));
const CUSTODY_PREDICATE_DEFINITION_OCCURRENCES = 1;
/** The files that still carry the shape, each pinned to the count that remains (see the block
 * comment above). Exported so the rule's own test can build a tree that mirrors it and perturb
 * exactly one file. */
export const CUSTODY_PREDICATE_PENDING = Object.freeze({
  'impl/src/application.mjs': Object.freeze({ occurrences: 1, reason: 'workspace admission; outside this change\'s write authority' }),
  'impl/src/index.mjs': Object.freeze({ occurrences: 4, reason: 'controller wiring; outside this change\'s write authority' }),
  'impl/src/swarm-state.mjs': Object.freeze({ occurrences: 1, reason: 'the swarm workspace shape; outside this change\'s write authority' }),
  'impl/src/worktree.mjs': Object.freeze({ occurrences: 9, reason: 'the destruction authority itself; outside this change\'s write authority' }),
});

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
  const listed = new Set();
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
    const pending = CUSTODY_PREDICATE_PENDING[source.path];
    if (!pending) {
      if (occurrences > 0) {
        findings.push(`${source.path}: ${occurrences} inline copy/copies of the physical-workspace-id`
          + ` shape (${CUSTODY_PREDICATE_TOKEN}) — import isPhysicalWorkspaceId from`
          + ` shared-workspace-custody.mjs instead; an inline copy is a second opinion about whether`
          + ` cleanup may destroy a shared checkout (the one definition is ${CUSTODY_PREDICATE_DEFINITION})`);
      }
      continue;
    }
    listed.add(source.path);
    if (occurrences === pending.occurrences) continue;
    findings.push(occurrences > pending.occurrences
      ? `${source.path}: ${occurrences} inline copies, PENDING pins ${pending.occurrences} (${pending.reason})`
        + ' — an inline copy was added where the pinned count said none would; import the helper instead'
      : `${source.path}: ${occurrences} inline copies, PENDING pins ${pending.occurrences} (${pending.reason})`
        + ' — the exemption is stale; lower the pinned count to the observed one, and drop the entry'
        + ' once it reaches zero');
  }
  for (const path of Object.keys(CUSTODY_PREDICATE_PENDING)) {
    if (!listed.has(path)) {
      findings.push(`${path}: PENDING exemption names a file that no longer carries the shape —`
        + ' remove the entry');
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
  const ledger = JSON.parse(readFileSync(new URL('./surface-divergence-ledger.json', import.meta.url), 'utf8'));
  for (const entry of ledger.entries ?? []) {
    if (entry.surface !== 'cli') continue;
    const bus = cliBusCommand(entry.name);
    if (!cliDispatches(bus)) {
      findings.push(`ledgered cli port ${entry.name} is not dispatchable by the CLI client`);
    }
  }
  return findings;
}
// ---------------------------------------------------------------------------
// The fold refuses recorded history only by construction error (issue #304).
//
// The #292 regression: a new admissibility rule landed INSIDE foldSwarmEvent — which also
// replays the ledger at startup — and bricked every resident whose history predated it
// (c6253838 reclassified that one rule with the `admission` flag). This row makes the class
// impossible to land: every `integrity(...)` site in foldSwarmEvent must be
//   shape      — the same code is raised by validateSwarmEvent, the lane both admission and
//                replay run, so a ledger row always passed it where it was written (the replay
//                corpus pins the shipped shape rules against real history), or
//   admission  — lexically guarded by the `admission` flag, so it fires only on the
//                prospective fold before an append, never on rows read back, or
//   pinned     — one of the replay-invariant codes below: stateful referential/CAS invariants
//                that the admission fold re-derives from the SAME projection replay
//                reconstructs, so they can only fire on a ledger no same-vintage store wrote
//                (corruption — the #290 quarantine is that repair) and the corpus proves the
//                vintage. The pins are closed and named: a NEW rule must land its own code and
//                face this decision; reusing a pinned code for a new rule is exactly the
//                incident, and a pin whose code the fold no longer raises is refused as stale.
// A site in none of the three fails the gate with the code and the line named.
// ---------------------------------------------------------------------------
const SWARM_FOLD_ADMISSION_PINS = Object.freeze({
  // Existence and CAS invariants: admission re-derives each of these against the current
  // projection before an append, and replay reconstructs that projection row for row — a
  // refusal at replay names corruption, not a rule change.
  swarm_duplicate: 'a created row re-naming a live swarm is a corrupt ledger, not admissible history',
  swarm_not_found: 'every non-create row names a swarm the replayed projection holds at that seq',
  participant_duplicate: 'a join re-naming a live participant is a corrupt ledger, not history',
  participant_not_found: 'bindings, leaves, claims and reviews name participants the projection holds',
  participant_not_active: 'groups and writer claims name active seats the projection holds at that seq',
  version_conflict: 'the CAS version re-derives identically from the replayed projection',
  work_not_found: 'assignments, contributions and dependency targets name works the projection holds',
  group_not_found: 'coupling declares and group-scoped context name groups the projection holds',
  coupling_not_found: 'arrive/release rows name a coupling the projection holds at that seq',
  swarm_coupling_released: 'a release re-naming a released record is a corrupt ledger, not history',
  swarm_already_arrived: 'a re-arrival of one seat is a corrupt ledger, not history',
  swarm_not_a_member: 'an arriver names a member of the group the projection holds',
  swarm_already_closed: 'a close re-naming a closed swarm is a corrupt ledger, not history',
  contribution_duplicate: 'a recorded re-naming a live contribution is a corrupt ledger, not history',
  contribution_not_found: 'revisions and reviews name contributions the projection holds at that seq',
  // Conflict invariants: the same re-derivation, plus the replay corpus proves the vintage —
  // the real ledgers carry the rows these rules were tightened for.
  swarm_coupling_conflict: 'one unreleased failure policy per group re-derives identically at replay',
  swarm_writer_conflict: 'one exclusive writer per checkout re-derives identically at replay',
  work_dependency_cycle: 'dependency rings re-derive identically; the corpus carries declared dependsOn rows',
  contribution_author_mismatch: 'a revision names its own contribution author, re-derived at replay',
  contribution_revision_conflict: 'one revision per contribution re-derives identically at replay',
  // The joint couplings, claims and work proposals (issues #422/#423, docs/45): every one of
  // these re-derives from the SAME projection the admission fold read, so a refusal at replay
  // names a ledger no same-vintage store wrote.
  swarm_writer_lease_held: 'a take/yield of a lease re-derives the live hold from the replayed record, seat for seat',
  swarm_writer_lease_unheld: 'a yield of an unheld lease re-derives identically; the admission fold refuses it before any row lands',
  swarm_claim_not_found: 'a claim handoff or release names a claim the replayed projection holds at that seq',
  swarm_permission_required: 'a claim move names the seat the replayed claim holds; the runtime admitted the row for its holder or an organizer, and an organizer names the holder',
  swarm_proposal_not_found: 'a consent or withdrawal names a proposal the replayed projection holds at that seq',
  swarm_proposal_released: 'a consent to a withdrawn proposal re-derives identically; the withdrawal is recorded before it',
  // Issue #443 hand-back: the re-route family (docs/39's provider section). The performed resume
  // answers the proposal its own seat carries, and the answer re-derives from the SAME projection
  // the ledger reconstructed — the proposal row is written first, in the SAME observation that
  // folds the fault — so a `swarm.rerouted` row whose proposal the replayed seat does not carry is
  // a ledger no same-vintage store wrote, never admissible history. Named here so the decision is
  // explicit in the closed table rather than living only in the site's `admission &&` guard: a
  // later lane that makes the check unconditional keeps reading it as this pin.
  reroute_proposal_mismatch: 'the performed re-route answers the proposal the replayed seat carries; both rows are written in ONE observation, so a mismatch at replay names corruption',
  // The fold tail: fires only when a kind joins SWARM_EVENT_KINDS without a fold branch —
  // the new kind never reached history, so nothing recorded can refuse here.
  unsupported_event_kind: 'a kind added to SWARM_EVENT_KINDS without a fold branch never reached history',
});

/** A string- and comment-aware scanner: for every character index it reports the enclosing
 * block headers, so the admission guard is recognized structurally (`if (admission ...) {`)
 * no matter how the condition wraps — never by a brace count that `${...}` would corrupt. */
function swarmFoldBlockHeaders(text) {
  const stack = [];
  const sites = [];
  let state = 'code';
  let templateHoles = [];
  let pending = '';
  let paren = 0;
  let line = 1;
  const pushHeader = () => { stack.push(pending.trim()); pending = ''; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '\n') { line += 1; if (state === 'line-comment') state = 'code'; if (state === 'template' || state === 'code') pending += char; continue; }
    switch (state) {
      case 'line-comment': break;
      case 'block-comment': if (char === '*' && next === '/') { state = 'code'; index += 1; } break;
      case "'": if (char === '\\') index += 1; else if (char === "'") state = 'code'; break;
      case '"': if (char === '\\') index += 1; else if (char === '"') state = 'code'; break;
      case 'template':
        if (char === '\\') index += 1;
        else if (char === '`') state = 'code';
        else if (char === '$' && next === '{') { state = 'code'; templateHoles.push(paren); paren = 0; }
        break;
      default:
        if (char === '/' && next === '/') { state = 'line-comment'; index += 1; break; }
        if (char === '/' && next === '*') { state = 'block-comment'; index += 1; break; }
        if (char === "'") { state = "'"; break; }
        if (char === '"') { state = '"'; break; }
        if (char === '`') { state = 'template'; break; }
        if (char === '(') paren += 1;
        if (char === ')') {
          if (templateHoles.length > 0 && paren === 0) { paren = templateHoles.pop(); state = 'template'; break; }
          paren -= 1;
        }
        if (char === '{') { pushHeader(); break; }
        if (char === '}') {
          if (templateHoles.length > 0 && paren === 0 && stack.length > 0) { stack.pop(); paren = templateHoles.pop(); state = 'template'; break; }
          stack.pop(); pending = ''; break;
        }
        if (char === ';' && paren === 0) pending = '';
        pending += /[A-Za-z0-9_$.]/.test(char) ? char : ' ';
        if (text.startsWith('integrity(', index) || text.startsWith('refuse(', index)) {
          sites.push({
            index, line,
            kind: text.startsWith('integrity(', index) ? 'integrity' : 'refuse',
            headers: [...stack], statement: pending.trim(),
          });
        }
        break;
    }
  }
  return sites;
}

/** The code a `refuse(...)`/`integrity(...)` call raises: the LAST top-level string-literal
 * argument inside the call's parens (the code may be followed by a trailing comma). String
 * and template literals are skipped whole, so a `,` inside a message never splits arguments. */
function swarmFoldCallCode(text, callStart) {
  const skipLiteral = (start) => {
    const quote = text[start];
    let index = start + 1;
    while (index < text.length) {
      if (text[index] === '\\') index += 2;
      else if (text[index] === quote) return index;
      else if (quote === '`' && text[index] === '$' && text[index + 1] === '{') {
        let holeDepth = 1;
        index += 2;
        while (index < text.length && holeDepth > 0) {
          if (text[index] === '{') holeDepth += 1;
          else if (text[index] === '}') holeDepth -= 1;
          else if (text[index] === "'" || text[index] === '"' || text[index] === '`') index = skipLiteral(index);
          index += 1;
        }
      } else index += 1;
    }
    return index;
  };
  let depth = 0;
  let literal = null;
  let index = text.indexOf('(', callStart);
  while (index < text.length) {
    const char = text[index];
    if (char === "'" || char === '"') {
      if (depth === 1) literal = { start: index + 1 };
      index = skipLiteral(index);
      if (literal !== null && literal.end === undefined) literal.end = index;
    } else if (char === '`') index = skipLiteral(index);
    else if (char === '(') depth += 1;
    else if (char === ')') { depth -= 1; if (depth === 0) break; }
    index += 1;
  }
  if (literal === null || literal.end === undefined) return null;
  return /^[a-z0-9_]+$/u.test(text.slice(literal.start, literal.end))
    ? text.slice(literal.start, literal.end) : null;
}

function swarmFoldFunctionBody(text, name) {
  const start = text.indexOf(`export function ${name}(`);
  if (start < 0) return null;
  // The parameter list may itself hold braces (foldSwarmEvent destructures `{ admission }`),
  // so the body's opening brace is the first one AFTER the parameter list's matching close
  // paren — never the first `{` after the name.
  let state = 'code';
  let paren = 0;
  let open = -1;
  for (let index = text.indexOf('(', start); index < text.length && open < 0; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (state === 'line-comment') { if (char === '\n') state = 'code'; continue; }
    if (state === 'block-comment') { if (char === '*' && next === '/') { state = 'code'; index += 1; } continue; }
    if (state === "'") { if (char === '\\') index += 1; else if (char === "'") state = 'code'; continue; }
    if (state === '"') { if (char === '\\') index += 1; else if (char === '"') state = 'code'; continue; }
    if (char === '/' && next === '/') { state = 'line-comment'; index += 1; continue; }
    if (char === '/' && next === '*') { state = 'block-comment'; index += 1; continue; }
    if (char === "'" || char === '"') { state = char; continue; }
    if (char === '(') paren += 1;
    if (char === ')') { paren -= 1; if (paren === 0) open = text.indexOf('{', index + 1); }
  }
  if (open < 0) return null;
  const bodyStart = open;
  let depth = 0;
  for (let index = bodyStart; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (state === 'line-comment') { if (char === '\n') state = 'code'; continue; }
    if (state === 'block-comment') { if (char === '*' && next === '/') { state = 'code'; index += 1; } continue; }
    if (state === "'") { if (char === '\\') index += 1; else if (char === "'") state = 'code'; continue; }
    if (state === '"') { if (char === '\\') index += 1; else if (char === '"') state = 'code'; continue; }
    if (state === 'template') { if (char === '\\') index += 1; else if (char === '`') state = 'code'; continue; }
    if (char === '/' && next === '/') { state = 'line-comment'; index += 1; continue; }
    if (char === '/' && next === '*') { state = 'block-comment'; index += 1; continue; }
    if (char === "'" || char === '"' || char === '`') { state = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}') { depth -= 1; if (depth === 0) return text.slice(start, index + 1); }
  }
  return null;
}
/** A block header's parentheses are space-normalized by the scanner, so an admission guard
 * is a conditional header: it starts with `if`/`else if` and names the admission flag. */
const isAdmissionGuard = (header) => {
  const normalized = header.trim().replace(/\s+/gu, ' ');
  return /^(?:else )?if /.test(normalized) && /\badmission\b/.test(normalized);
};

/**
 * Every integrity site inside foldSwarmEvent is a shape refusal, an admission-guarded
 * refusal, or a pinned replay-invariant (see the block comment above). `source` overrides the
 * scanned file so the rule itself is testable.
 */
export function checkSwarmFoldAdmission({ source = null } = {}) {
  const path = 'impl/src/swarm-state.mjs';
  const text = source ?? readFileSync(new URL(`../src/swarm-state.mjs`, import.meta.url), 'utf8');
  const findings = [];
  const validateBody = swarmFoldFunctionBody(text, 'validateSwarmEvent');
  const foldBody = swarmFoldFunctionBody(text, 'foldSwarmEvent');
  if (validateBody === null || foldBody === null) {
    return [`${path}: validateSwarmEvent/foldSwarmEvent not found — the fold admission audit cannot run`];
  }
  const shapeCodes = new Set();
  for (const site of swarmFoldBlockHeaders(validateBody)) {
    if (site.kind !== 'refuse') continue;
    const code = swarmFoldCallCode(validateBody, site.index);
    if (code !== null) shapeCodes.add(code);
  }
  const foldOffset = text.indexOf(foldBody);
  const prefixLines = text.slice(0, foldOffset).split('\n').length - 1;
  const raisedCodes = new Set();
  for (const site of swarmFoldBlockHeaders(foldBody)) {
    if (site.kind !== 'integrity') continue;
    const code = swarmFoldCallCode(foldBody, site.index);
    if (code === null) {
      findings.push(`${path}:${prefixLines + site.line}: an integrity(...) call names no literal code — the fold admission audit cannot classify it`);
      continue;
    }
    raisedCodes.add(code);
    if (shapeCodes.has(code)) continue;
    if (site.headers.some(isAdmissionGuard) || isAdmissionGuard(site.statement)) continue;
    if (Object.hasOwn(SWARM_FOLD_ADMISSION_PINS, code)) continue;
    findings.push(
      `${path}:${prefixLines + site.line}: fold refusal '${code}' can fire on recorded history — guard it with the admission flag, raise it from validateSwarmEvent as a shape refusal, or pin it as a justified replay invariant`,
    );
  }
  for (const code of Object.keys(SWARM_FOLD_ADMISSION_PINS)) {
    if (!raisedCodes.has(code)) {
      findings.push(`${path}: stale fold-admission pin '${code}' — the fold no longer raises it; shrink the pins`);
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Goal/plan fold admission (issue #325). The SAME #304 class in the goal/plan fold:
// `_applyGoalPlanEvent` re-normalised every recorded goal/plan under the LIVE policy
// and compared the row's policyDigest to the live one, so one policy edit bricked
// replay of every earlier row. The contract, mirrored from the swarm gate above:
//   recorded-anchored — replay verifies a row against the digest IT carries (shape,
//                digest self-consistency, referential linkage re-derived from the
//                replayed projection), never against the live policy, or
//   pinned     — one of the live-policy reads below: the deployment identity and the
//                structural/prospective bounds the replay fold knowingly keeps, each
//                justified. The pins are closed and named: a NEW live-policy read must
//                face this decision; a pin whose field the fold no longer reads is
//                refused as stale.
// A live-policy digest comparison, or a live re-normalisation of recorded content in
// the replay fold, fails the gate with the pattern and the line named.
// ---------------------------------------------------------------------------
const GOAL_PLAN_FOLD_PATH = 'impl/src/coordination-store.mjs';
const GOAL_PLAN_FOLD_METHODS = Object.freeze([
  '_applyGoalPlanEvent',
  '_goalSuccessorWeakeningReplay',
  '_validateGoalPlanDispatchPair',
  '_validateGoalPlanRecoveryTriple',
  '_workflowRevisionAuthority',
  '_derivePlanBudgetSettlement',
]);
const GOAL_PLAN_FOLD_LIVE_POLICY_PINS = Object.freeze({
  // A recorded goal names the deployment it belongs to; a foreign repoId row is a
  // corrupt ledger, not admissible history (the constructor already binds the live
  // repoId to the live policy).
  repoId: 'deployment identity — a recorded row naming another deployment refuses',
  // The approval TTL window fires prospective-only (the !integrity branch): replay
  // re-derives the recorded dispatch-after-approval order but never re-judges the
  // window by the live policy.
  approvalTtlMs: 'prospective-only approval window — never a replay judgment',
  // Structural ceilings the fold re-derives from the replayed projection (revision
  // lineage length, operational evidence prefix): a refusal at replay names a ledger
  // no same-vintage store wrote.
  limits: 'structural ceilings re-derived identically from the replayed projection',
});
const GOAL_PLAN_FOLD_FORBIDDEN_CALLS = Object.freeze([
  'normalizeGoalRequest',
  'normalizePlanRequest',
  'assertGoalSuccessor',
]);

/** Class-method bodies for the goal/plan fold: `  name(` at class depth, never a
 * `this.name(` call site. Returns { name, body, lineOffset } with 0-based lineOffset
 * of the body's first line, or null when the definition is absent. */
function goalPlanFoldMethodBody(text, name) {
  const marker = `\n  ${name}(`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  let index = text.indexOf('(', start);
  let paren = 0;
  let open = -1;
  for (; index < text.length && open < 0; index += 1) {
    if (text[index] === '(') paren += 1;
    else if (text[index] === ')') {
      paren -= 1;
      if (paren === 0) open = text.indexOf('{', index + 1);
    }
  }
  if (open < 0) return null;
  let depth = 0;
  let end = -1;
  for (index = open; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    else if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) { end = index + 1; break; }
    }
  }
  if (end < 0) return null;
  return { name, body: text.slice(start + 1, end), lineOffset: text.slice(0, start + 1).split('\n').length - 1 };
}

/** Blank every non-code span (comments, quoted strings, template text) while keeping
 * newlines and `${...}` hole code, so a commented-out rule or a message naming the
 * pattern never counts as a site. */
function blankGoalPlanNonCode(body) {
  let out = '';
  let state = 'code';
  let holeDepths = [];
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    const next = body[index + 1];
    if (char === '\n') { out += '\n'; if (state === 'line-comment') state = 'code'; continue; }
    switch (state) {
      case 'line-comment': out += ' '; break;
      case 'block-comment':
        out += ' ';
        if (char === '*' && next === '/') { state = 'code'; out += ' '; index += 1; }
        break;
      case "'":
        out += ' ';
        if (char === '\\') { out += ' '; index += 1; } else if (char === "'") state = 'code';
        break;
      case '"':
        out += ' ';
        if (char === '\\') { out += ' '; index += 1; } else if (char === '"') state = 'code';
        break;
      case 'template':
        if (char === '\\') { out += '  '; index += 1; }
        else if (char === '`') { out += ' '; state = 'code'; }
        else if (char === '$' && next === '{') { out += '  '; holeDepths.push(0); state = 'code'; index += 1; }
        else out += ' ';
        break;
      default:
        if (char === '/' && next === '/') { state = 'line-comment'; out += '  '; index += 1; }
        else if (char === '/' && next === '*') { state = 'block-comment'; out += '  '; index += 1; }
        else if (char === "'") { state = "'"; out += ' '; }
        else if (char === '"') { state = '"'; out += ' '; }
        else if (char === '`') { state = 'template'; out += ' '; }
        else if (char === '{' && holeDepths.length > 0) {
          holeDepths[holeDepths.length - 1] += 1;
          out += char;
        } else if (char === '}' && holeDepths.length > 0) {
          const top = holeDepths[holeDepths.length - 1];
          if (top === 0) { holeDepths.pop(); state = 'template'; out += ' '; }
          else { holeDepths[holeDepths.length - 1] -= 1; out += char; }
        } else out += char;
        break;
    }
  }
  return out;
}

/** The bodies of the goal/plan fold's methods, located by NAME through the live seam map — the map
 * is the anchor, never a line, so the audit follows a member into whichever file now holds it (issue
 * #259 slice 2 moved the two pair validators into coordination-replay.mjs, where a store-file search
 * would have reported them missing). A member the class now delegates — a three-line
 * `return <module>.<name>(…)` — is skipped in favour of the body it forwards to. */
function goalPlanFoldBodies() {
  const bodies = [];
  for (const file of collectSeamInventory().files) {
    const text = readFileSync(fileURLToPath(new URL(`../${file.file.replace(/^impl\//u, '')}`, import.meta.url)), 'utf8');
    const lines = text.split('\n');
    for (const member of file.members) {
      if (!GOAL_PLAN_FOLD_METHODS.includes(member.name)) continue;
      const window = lines.slice(member.line - 1, member.line - 1 + member.size).join('\n');
      if (/\breturn coordination(?:Internals|Replay)\.[A-Za-z_$]+\(/u.test(window)) continue;
      bodies.push({ name: member.name, file: file.file, lineOffset: member.line - 1, body: `\n${window}` });
    }
  }
  return bodies;
}

/** An explicit `source` stays what it always was — a synthetic class body the rule's own test hands
 * in — and is read with the class-depth marker, unchanged. */
function goalPlanFoldBodiesFromSource(source) {
  return GOAL_PLAN_FOLD_METHODS.map((name) => {
    const method = goalPlanFoldMethodBody(source, name);
    return { name, file: GOAL_PLAN_FOLD_PATH, lineOffset: method?.lineOffset ?? 0, body: method?.body ?? null };
  });
}
export function checkGoalPlanFoldAdmission({ source = null } = {}) {
  const bodies = source === null ? goalPlanFoldBodies() : goalPlanFoldBodiesFromSource(source);
  const findings = [];
  const readFields = new Set();
  for (const entry of bodies) {
    if (entry.body === null) {
      findings.push(`${entry.file}: goal/plan fold method '${entry.name}' not found — the fold admission audit cannot run`);
      continue;
    }
    const method = entry;
    const name = method.name;
    const code = blankGoalPlanNonCode(method.body);
    const lineOf = (index) => method.lineOffset + code.slice(0, index).split('\n').length;
    // The live policy is read through the receiver the member's own file gives it: `this` on the
    // class, `store` in an extracted module, where the store is the explicit first parameter (issue
    // #259 slice 2). One spelling would have made a moved fold member look like it had stopped
    // reading the policy — the exact blindness the name-anchored lookup above exists to remove.
    for (const match of code.matchAll(/\b(?:this|store)\._goalPlanPolicy\??\.([A-Za-z0-9_]+)/gu)) {
      const field = match[1];
      const line = lineOf(match.index);
      if (field === 'policyDigest') {
        findings.push(
          `${entry.file}:${line}: goal-plan fold compares a recorded digest to the live policy`
          + ` ('${name}' reads this._goalPlanPolicy.policyDigest) — anchor replay on the digest the row carries (#325)`,
        );
        continue;
      }
      if (Object.hasOwn(GOAL_PLAN_FOLD_LIVE_POLICY_PINS, field)) {
        readFields.add(field);
        continue;
      }
      findings.push(
        `${entry.file}:${line}: goal-plan fold reads an unpinned live-policy field`
        + ` ('${name}' reads this._goalPlanPolicy.${field}) — pin it as a justified replay invariant or reclassify the rule admission-only (#325)`,
      );
    }
    if (name === '_applyGoalPlanEvent') {
      for (const call of GOAL_PLAN_FOLD_FORBIDDEN_CALLS) {
        for (const match of code.matchAll(new RegExp(`\\b${call}\\s*\\(`, 'gu'))) {
          findings.push(
            `${entry.file}:${lineOf(match.index)}: goal-plan fold re-normalises recorded content`
            + ` under the live policy ('_applyGoalPlanEvent' calls ${call}) — verify the row against its recorded digest instead (#325)`,
          );
        }
      }
    }
  }
  for (const field of Object.keys(GOAL_PLAN_FOLD_LIVE_POLICY_PINS)) {
    if (!readFields.has(field)) {
      findings.push(`${GOAL_PLAN_FOLD_PATH}: stale goal-plan fold pin '${field}' — the fold no longer reads it; shrink the pins`);
    }
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
    ...checkCanonicalSurfaceResolution().map((f) => `surface-resolution: ${f}`),
    ...checkCliAdmissionDerivation().map((f) => `cli-admission: ${f}`),
    ...checkSwarmFoldAdmission().map((f) => `swarm-fold-admission: ${f}`),
    ...checkGoalPlanFoldAdmission().map((f) => `goal-plan-fold-admission: ${f}`),
    ...runSurfaceConformanceMain({ writeInventory: write }).map((f) => `surface-conformance: ${f}`),
    ...checkSurfaceParityMatrix().map((f) => `surface-parity: ${f}`),
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
