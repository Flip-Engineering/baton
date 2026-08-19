#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { CLI_WEB_COMMANDS, parseBatonCli } from '../src/application-cli.mjs';
import { mcpCombinedToolNames, mcpDispatchToolNames } from '../src/mcp-northbound.mjs';
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
const native = JSON.parse(readFileSync(resolve(here, 'native-surface-capabilities.json'), 'utf8'));

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

if (native.schemaVersion !== 3 || !Array.isArray(native.mcpNative) || !Array.isArray(native.cliNative)
  || !Array.isArray(native.registryCliExceptions) || !Array.isArray(native.mcpDispatchOnlyAliases)) {
  throw new Error('control-surface-audit: native surface capability manifest is invalid');
}
for (const row of [...native.mcpNative, ...native.cliNative]) {
  if (!row || typeof row.name !== 'string' || !row.name || typeof row.owner !== 'string' || !row.owner
    || typeof row.reason !== 'string' || !row.reason) {
    throw new Error('control-surface-audit: native capability rows require name, owner, and reason');
  }
}
for (const row of native.registryCliExceptions) {
  if (!row || typeof row.key !== 'string' || !row.key || typeof row.classification !== 'string' || !row.classification
    || typeof row.reason !== 'string' || !row.reason) {
    throw new Error('control-surface-audit: registry CLI exception rows require key, classification, and reason');
  }
}
for (const row of native.mcpDispatchOnlyAliases) {
  if (!row || typeof row.name !== 'string' || !row.name || typeof row.canonicalKey !== 'string' || !row.canonicalKey
    || typeof row.reason !== 'string' || !row.reason) {
    throw new Error('control-surface-audit: MCP dispatch-only aliases require name, canonicalKey, and reason');
  }
}

const canonicalKeys = new Set(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.map((row) => row.key));
const registryCli = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
  .filter((operation) => operation.surfaces.includes('cli'))
  .map((operation) => operation.key)
  .sort();
const servedCliSet = new Set(servedCliOrdinaryKeys());
for (const command of APPLICATION_SEMANTIC_REGISTRY.cli.commands) {
  if (canonicalKeys.has(command.id)) servedCliSet.add(command.id);
}
for (const row of native.cliNative) {
  if (row.canonicalKey) servedCliSet.add(row.canonicalKey);
}
const exceptionKeys = new Set(native.registryCliExceptions.map((row) => row.key));
for (const key of exceptionKeys) {
  if (!registryCli.includes(key)) throw new Error(`control-surface-audit: stale registry CLI exception is not declared on CLI: ${key}`);
  if (servedCliSet.has(key)) throw new Error(`control-surface-audit: registry CLI exception became served and must be removed: ${key}`);
}
const missingCli = registryCli.filter((key) => !servedCliSet.has(key) && !exceptionKeys.has(key));
if (missingCli.length > 0) {
  throw new Error(`control-surface-audit: registry declares unclassified CLI operations with no served implementation: ${missingCli.join(', ')}`);
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
const missingMcp = registryMcp
  .filter((operation) => !directMcpOperationPresent(operation) && !actionDispatchedOnMcp(operation))
  .map((operation) => operation.key);
if (missingMcp.length > 0) {
  throw new Error(`control-surface-audit: registry declares MCP operations with no direct tool or run.do action path: ${missingMcp.sort().join(', ')}`);
}

// APPLICATION_TOOL contains compatibility/internal dispatcher spellings in addition to advertised
// tools. Require every such dispatch-only spelling to be explicitly classified and bound to an
// existing canonical operation. This retains the #233 stale-dispatch guard without falsely
// requiring internal aliases to appear in tools/list.
const dispatchOnly = [...liveMcpDispatch].filter((name) => !liveMcpTools.has(name)).sort();
const dispatchAliasRows = new Map(native.mcpDispatchOnlyAliases.map((row) => [row.name, row]));
for (const name of dispatchOnly) {
  const row = dispatchAliasRows.get(name);
  if (!row) throw new Error(`control-surface-audit: unclassified MCP dispatch-only alias: ${name}`);
  if (!canonicalKeys.has(row.canonicalKey)) throw new Error(`control-surface-audit: MCP dispatch-only alias ${name} targets unknown canonical operation ${row.canonicalKey}`);
}
for (const [name] of dispatchAliasRows) {
  if (!liveMcpDispatch.has(name)) throw new Error(`control-surface-audit: stale MCP dispatch-only alias classification: ${name}`);
  if (liveMcpTools.has(name)) throw new Error(`control-surface-audit: MCP dispatch-only alias became advertised and classification must be removed: ${name}`);
}

for (const row of native.mcpNative) {
  if (!liveMcpTools.has(row.name)) throw new Error(`control-surface-audit: native MCP capability disappeared from assembled tools: ${row.name}`);
}
for (const row of native.cliNative) {
  const first = row.name.split(' ')[0];
  if (!cliSource.includes(`args[0] === '${first}'`) && !cliSource.includes(`args[0] === "${first}"`)) {
    throw new Error(`control-surface-audit: native CLI capability disappeared from parser: ${row.name}`);
  }
}

for (const sentinel of ["name: 'run.message.send'", "name: 'run.message.receipt'", "name: 'run.attention.watch'", "name: 'run.answer'"]) {
  if (!cliSource.includes(sentinel)) throw new Error(`control-surface-audit: CLI implementation is missing ${sentinel}`);
}
for (const sentinel of ['baton_run_message_send', 'baton_run_message_receipt', 'baton_run_attention_watch', 'baton_decision_answer']) {
  if (!liveMcpTools.has(sentinel)) throw new Error(`control-surface-audit: MCP assembled tools are missing ${sentinel}`);
}
if (!mcpSource.includes('CANONICAL_DOT_TOOL_DEFINITIONS') || !mcpSource.includes('APPLICATION_SEMANTIC_REGISTRY')) {
  throw new Error('control-surface-audit: MCP canonical tool generation is detached from the application semantic registry');
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: 7,
  registryDigest: APPLICATION_UNIFIED_REGISTRY_DIGEST,
  parity,
  registry: {
    cliDeclared: registryCli.length,
    cliServed: servedCliSet.size,
    cliSurfaceExceptions: native.registryCliExceptions,
    mcpDeclared: registryMcp.length,
    mcpAssembledTools: liveMcpTools.size,
    mcpApplicationDispatchEntries: liveMcpDispatch.size,
    mcpDirectDeclared: registryMcp.length - indirectMcp.length,
    mcpActionDispatched: indirectMcp,
    mcpDispatchOnlyAliases: native.mcpDispatchOnlyAliases,
  },
  native: { cli: native.cliNative, mcp: native.mcpNative },
  notifications: cliNotifications,
  liveCliCases: cliCases.length,
  ambiguousLegacyAliases: ambiguousLegacyAliases(),
}, null, 2)}\n`);
