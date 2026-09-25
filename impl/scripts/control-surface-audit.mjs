#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APPLICATION_SEMANTIC_REGISTRY, canonicalOperationForCommand } from '../src/application-semantics.mjs';
import {
  CLI_WEB_COMMANDS, HOST_CLI_VERBS, cliDispatchCommandNames, parseBatonCli,
} from '../src/application-cli.mjs';
import {
  HOST_CLI_CAPABILITIES, registryOperationsNamedByHostVerb, unifiedCapabilityCatalog,
} from '../src/surface-capability-catalog.mjs';
import { resolveOperationSurfaces } from '../src/surface-resolution.mjs';
import { commandForTool, mcpCombinedToolNames, mcpDispatchToolNames } from '../src/mcp-northbound.mjs';
import { ORDINARY_COMMANDS } from '../src/mcp-web-bridge.mjs';
import { servedCliOrdinaryKeys } from './render-surface-docs.mjs';
import {
  APPLICATION_UNIFIED_REGISTRY_DIGEST,
  ambiguousLegacyAliases,
  assertCliMcpControlParity,
  unifiedNotificationInventory,
} from '../src/control-surface-unification.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', 'src');
const mcpSource = readFileSync(resolve(src, 'mcp-northbound.mjs'), 'utf8');
const cliSource = readFileSync(resolve(src, 'application-cli.mjs'), 'utf8');

function same(left, right) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

const parity = assertCliMcpControlParity();
const cliNotifications = unifiedNotificationInventory('cli').map((row) => row.key).sort();
const mcpNotifications = unifiedNotificationInventory('mcp').map((row) => row.key).sort();
if (!same(cliNotifications, mcpNotifications)) {
  throw new Error(`control-surface-audit: notification inventory diverged: cli=${JSON.stringify(cliNotifications)} mcp=${JSON.stringify(mcpNotifications)}`);
}

const cliCases = [
  [['run', 'message', 'send', 'run:a', '--kind', 'inform', '--body', 'hello'], 'run.message.send'],
  [['run', 'message', 'receipt', `message:${'a'.repeat(64)}`], 'run.message.receipt'],
  [['run', 'attention', 'watch', 'run:a', '--cursor', '0'], 'run.attention.watch'],
  [['run', 'answer', 'run:a', 'request:a', '--text', 'yes'], 'run.answer'],
];
for (const [argv, expected] of cliCases) {
  const parsed = parseBatonCli(argv);
  if (parsed.name !== expected) throw new Error(`control-surface-audit: CLI ${argv.join(' ')} resolved ${parsed.name}, expected ${expected}`);
}

// ── Issue #582: the native-surface census is DERIVED ───────────────────────────────────────────
// The deleted ledger classified five residues by hand. Every classification below is computed from
// the authority that owns the fact, so no row can drift from what the surfaces really serve: the
// CLI's own host-verb table and the registry CLI spellings naming its verbs (the catalog's
// HOST_CLI_CAPABILITIES), the parser witness surface-resolution.mjs probes for every declared
// spelling, the assembled MCP composition and its dispatch table, and the seat bridge.
const cliNative = HOST_CLI_CAPABILITIES;
const cliWitnesses = new Map(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
  .filter((operation) => operation.surfaces.includes('cli'))
  .map((operation) => [operation.key, resolveOperationSurfaces(operation).witnesses.cli ?? null]));
const mcpNative = unifiedCapabilityCatalog()
  .filter((row) => row.kind === 'mcp_native')
  .map((row) => Object.freeze({ name: row.id, owner: row.owner, reason: row.description }));

const canonicalKeys = new Set(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.map((row) => row.key));
const registryCli = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
  .filter((operation) => operation.surfaces.includes('cli'))
  .map((operation) => operation.key)
  .sort();
const servedCliSet = new Set(servedCliOrdinaryKeys());
for (const command of APPLICATION_SEMANTIC_REGISTRY.cli.commands) {
  if (canonicalKeys.has(command.id)) servedCliSet.add(command.id);
}
for (const row of cliNative) {
  if (row.canonicalKey) servedCliSet.add(row.canonicalKey);
}
// Issue #519: "served" is the CLI's own DISPATCH authority — the transports `command()` gates on
// (application-cli.mjs `cliDispatchCommandNames`, the CLI_DISPATCH_TRANSPORTS derivation) — unioned
// with the WIRE CARD projection above. Keyed on the card alone, a registry CLI row the CLI really
// dispatches but the card deliberately omits (`deployment.reincarnate`, admitted by #306 lane W)
// read as "no served implementation", and the third check below fired on a row that was served.
for (const name of cliDispatchCommandNames()) servedCliSet.add(name);
// What the three projections above still do not carry is served by the CLI spelling
// surface-resolution.mjs resolves for the operation — a semantic-action verb (`baton run interrupt`
// compiles to the run.do action) or a host verb the CLI runs in process.
const cliSurfaceExceptions = registryCli
  .filter((key) => !servedCliSet.has(key) && cliWitnesses.get(key) === null)
  .map((key) => Object.freeze({ key, classification: 'unserved' }));
if (cliSurfaceExceptions.length > 0) {
  throw new Error(`control-surface-audit: registry declares CLI operations with no served spelling: ${cliSurfaceExceptions.map((row) => row.key).join(', ')}`);
}
// Each host verb must still resolve through the parser that serves it, the registry spelling that
// names it must be single-valued, and the row that spelling names must really declare a served CLI
// spelling — the two authorities the derivation joins are checked against each other, so a moved
// verb or a moved registry spelling is a red row here rather than a silently dropped capability.
for (const row of cliNative) {
  const verb = HOST_CLI_VERBS.find((candidate) => candidate.token === row.name);
  const parsed = parseBatonCli(verb.argv);
  if (!parsed || typeof parsed.kind !== 'string') {
    throw new Error(`control-surface-audit: native CLI capability disappeared from the parser: ${row.name}`);
  }
  const named = registryOperationsNamedByHostVerb(row.name);
  if (named.length > 1) {
    throw new Error(`control-surface-audit: the host verb ${row.name} is named by several registry operations (${named.sort().join(', ')}) — the capability link is ambiguous`);
  }
  if (row.canonicalKey !== null && cliWitnesses.get(row.canonicalKey) === null) {
    throw new Error(`control-surface-audit: native CLI capability ${row.name} names registry operation ${row.canonicalKey}, which declares no served CLI spelling`);
  }
}
const appAliases = new Map(APPLICATION_SEMANTIC_REGISTRY.surfaceAliases
  .filter((row) => row.surface === 'application.commands')
  .map((row) => [row.name, row.canonical]));
const unownedCliWeb = [...CLI_WEB_COMMANDS].filter((name) => !canonicalKeys.has(name) && !appAliases.has(name));
if (unownedCliWeb.length > 0) {
  throw new Error(`control-surface-audit: live CLI web commands lack canonical registry ownership: ${unownedCliWeb.sort().join(', ')}`);
}

const liveMcpTools = new Set(mcpCombinedToolNames());
const liveMcpDispatch = new Set(mcpDispatchToolNames());
const registryMcp = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
  .filter((operation) => operation.surfaces.includes('mcp'));
const actionKinds = new Set(Object.keys(APPLICATION_SEMANTIC_REGISTRY.actions));
const runDo = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.find((operation) => operation.key === 'run.do');
const runDoNames = runDo ? [runDo.names.mcp, runDo.key,
  ...(runDo.aliases ?? []).filter((alias) => alias.surface.startsWith('mcp.')).map((alias) => alias.name)] : [];
const runDoLive = runDoNames.some((name) => liveMcpTools.has(name));
function directMcpOperationPresent(operation) {
  const names = [operation.names.mcp, operation.key,
    ...(operation.aliases ?? []).filter((alias) => alias.surface.startsWith('mcp.')).map((alias) => alias.name)];
  return names.some((name) => liveMcpTools.has(name));
}
function actionDispatchedOnMcp(operation) {
  return !directMcpOperationPresent(operation) && runDoLive && actionKinds.has(operation.liveMethod);
}
const indirectMcp = registryMcp.filter(actionDispatchedOnMcp).map((operation) => Object.freeze({
  key: operation.key, action: operation.liveMethod, via: 'run.do',
}));
// An MCP-declaring registry operation absent from the operator composition is served by the SEAT
// bridge the resident admits (mcp-web-bridge ORDINARY_COMMANDS) — the seat-side class the census
// recorded by hand. An operation that neither the composition, nor the run.do action path, nor the
// bridge admits is a real divergence and refuses here.
const seatBridgeCommands = new Set(ORDINARY_COMMANDS);
const mcpSurfaceExceptions = registryMcp
  .filter((operation) => !directMcpOperationPresent(operation) && !actionDispatchedOnMcp(operation))
  .map((operation) => Object.freeze({
    key: operation.key,
    classification: seatBridgeCommands.has(operation.key) ? 'seat_side' : null,
  }));
const unclassifiedMcp = mcpSurfaceExceptions.filter((row) => row.classification === null);
if (unclassifiedMcp.length > 0) {
  throw new Error(`control-surface-audit: registry declares MCP operations with no direct tool, no run.do action path and no seat-bridge admission: ${unclassifiedMcp.map((row) => row.key).sort().join(', ')}`);
}

// APPLICATION_TOOL contains compatibility/internal dispatcher spellings in addition to advertised
// tools. Every such dispatch-only spelling is bound to the canonical operation its dispatch table
// routes it to — the classification is the table's own value, so the #233 stale-dispatch guard
// holds without a ledger of names.
const dispatchOnly = [...liveMcpDispatch].filter((name) => !liveMcpTools.has(name)).sort();
const dispatchAliasRows = dispatchOnly.map((name) => Object.freeze({
  name,
  canonicalKey: canonicalOperationForCommand(commandForTool(name))?.key ?? null,
  reason: `internal application dispatch spelling routed to ${commandForTool(name)}`,
}));
for (const row of dispatchAliasRows) {
  if (row.canonicalKey === null || !canonicalKeys.has(row.canonicalKey)) {
    throw new Error(`control-surface-audit: MCP dispatch-only alias ${row.name} targets unknown canonical operation ${row.canonicalKey}`);
  }
  if (liveMcpTools.has(row.name)) {
    throw new Error(`control-surface-audit: MCP dispatch-only alias became advertised and classification must be removed: ${row.name}`);
  }
}

for (const row of mcpNative) {
  if (!liveMcpTools.has(row.name)) throw new Error(`control-surface-audit: native MCP capability disappeared from assembled tools: ${row.name}`);
}

for (const sentinel of ["name: 'run.message.send'", "name: 'run.message.receipt'", "name: 'run.attention.watch'", "name: 'run.answer'"]) {
  if (!cliSource.includes(sentinel)) throw new Error(`control-surface-audit: CLI implementation is missing ${sentinel}`);
}
// baton_run_attention_watch left the operator composition with the #156 D4 cut; the attention
// watch stays pinned on the CLI implementation above and admitted seat-side by the bridge.
for (const sentinel of ['baton_run_message_send', 'baton_run_message_receipt', 'baton_decision_answer']) {
  if (!liveMcpTools.has(sentinel)) throw new Error(`control-surface-audit: MCP assembled tools are missing ${sentinel}`);
}
if (!mcpSource.includes('CANONICAL_DOT_TOOL_DEFINITIONS') || !mcpSource.includes('APPLICATION_SEMANTIC_REGISTRY')) {
  throw new Error('control-surface-audit: MCP canonical tool generation is detached from the application semantic registry');
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 8,
  registryDigest: APPLICATION_UNIFIED_REGISTRY_DIGEST,
  parity,
  registry: {
    cliDeclared: registryCli.length,
    cliServed: servedCliSet.size,
    cliSurfaceExceptions,
    mcpDeclared: registryMcp.length,
    mcpAssembledTools: liveMcpTools.size,
    mcpApplicationDispatchEntries: liveMcpDispatch.size,
    mcpDirectDeclared: registryMcp.length - indirectMcp.length,
    mcpActionDispatched: indirectMcp,
    mcpSurfaceExceptions,
    mcpDispatchOnlyAliases: dispatchAliasRows,
  },
  native: { cli: cliNative, mcp: mcpNative },
  notifications: cliNotifications,
  liveCliCases: cliCases.length,
  ambiguousLegacyAliases: ambiguousLegacyAliases(),
}, null, 2)}\n`);
