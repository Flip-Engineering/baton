#!/usr/bin/env node

// docs/36 §9 M4 (M4b) + control-surface contract v2 CS-1 — generated documentation surface.
// CLI.md / MCP.md inventory blocks render from *executable* reference-profile inventories
// (never grammar intent alone, never hand lists).
//
//   node impl/scripts/render-surface-docs.mjs           # rewrite generated blocks in place
//   node impl/scripts/render-surface-docs.mjs --check   # fail (exit 1) if a committed block drifted

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { APPLICATION_SEMANTIC_REGISTRY, deriveSurfaceNames } from '../src/application-semantics.mjs';
import { CLI_WEB_COMMANDS } from '../src/application-cli.mjs';
import { mcpApplicationToolNames } from '../src/mcp-northbound.mjs';
// #293: the fleet-routes table renders from the SERVED route registry — the same module that
// owns the one readiness derivation, so the table cannot disagree with what the deployment
// serves or gates.
import {
  DEFAULT_BATON_DEPLOYMENT_ROUTES,
  KIMI_THROUGH_CLAUDE_ROUTE,
  routeReadinessContract,
} from '../src/application-deployment.mjs';

const CLI_DOC = new URL('../CLI.md', import.meta.url);
const MCP_DOC = new URL('../MCP.md', import.meta.url);
export const CLI_INVENTORY_MARKER = 'cli-verb-inventory';
export const CLI_FLEET_ROUTES_MARKER = 'cli-fleet-routes';
export const MCP_INVENTORY_MARKER = 'mcp-tool-inventory';

function beginMarker(marker) { return `<!-- BEGIN GENERATED: ${marker} (impl/scripts/render-surface-docs.mjs) -->`; }
function endMarker(marker) { return `<!-- END GENERATED: ${marker} -->`; }

// Host-local CLI operations (parse + in-process dispatch; no web-client whitelist entry).
const HOST_LOCAL_CLI_KEYS = new Set(['run.debug']);

/**
 * Ordinary CLI principal inventory: canonical operation keys that are actually served —
 * either via the CLI web-client whitelist (dispatch name) or as host-local (run.debug).
 * Ghost grammar rows that default to ALL_SURFACES but have no CLI wire stay out (S-2).
 */
export function servedCliOrdinaryKeys() {
  const keys = new Set();
  const byDispatch = new Map();
  for (const alias of APPLICATION_SEMANTIC_REGISTRY.surfaceAliases) {
    if (alias.surface === 'application.commands') {
      byDispatch.set(alias.name, alias.canonical);
    }
  }
  for (const name of CLI_WEB_COMMANDS) {
    const canonical = byDispatch.get(name)
      ?? APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
        .find((operation) => operation.key === name)?.key
      ?? null;
    // Prefer a canonical key when the whitelist name is itself canonical or aliased.
    if (canonical) keys.add(canonical);
    else if (APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.some((op) => op.key === name)) {
      keys.add(name);
    }
  }
  // Lifecycle legacy ids on the registry that dispatch to a whitelist command.
  for (const command of APPLICATION_SEMANTIC_REGISTRY.cli.commands) {
    if (!command.operation || !CLI_WEB_COMMANDS.has(command.operation)) continue;
    const canonical = byDispatch.get(command.operation)
      ?? (APPLICATION_SEMANTIC_REGISTRY.canonicalOperations.some((op) => op.key === command.id)
        ? command.id
        : null);
    if (canonical) keys.add(canonical);
  }
  // docs/36 §9 M5 — `run.send` is a semantic-action CLI verb (its registry row carries
  // `action: 'send'` and no legacy application-command spelling), so the deleted `run.steer`
  // alias was its only prior path into this inventory. The alias is gone at M5, but the CLI verb
  // stays served, so the canonical operation stays listed.
  if (APPLICATION_SEMANTIC_REGISTRY.cli.commands.some((row) => row.id === 'run.send')) {
    keys.add('run.send');
  }
  for (const key of HOST_LOCAL_CLI_KEYS) keys.add(key);
  // Only keep keys that the registry enables on the cli surface.
  return APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .filter((operation) => operation.surfaces.includes('cli') && keys.has(operation.key))
    .map((operation) => operation.key)
    .sort();
}

export function renderCliVerbInventory() {
  const rows = servedCliOrdinaryKeys().map((key) => {
    const operation = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
      .find((entry) => entry.key === key);
    const names = deriveSurfaceNames(operation.key);
    return `| \`${operation.key}\` | \`${operation.profile}\` | \`${names.cli}\` | \`${operation.example}\` |`;
  });
  return [
    '| Operation | Profile | CLI verb | Example |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/**
 * MCP application-profile inventory: the real tool table from McpFleetServer surface
 * construction (ORDINARY_APPLICATION_TOOL_DEFINITIONS), never deriveSurfaceNames alone.
 */
export function renderMcpToolInventory() {
  const tools = mcpApplicationToolNames();
  const rows = tools.map((tool) => {
    // Resolve a registry operation when the tool is a known alias or derived name.
    const alias = APPLICATION_SEMANTIC_REGISTRY.surfaceAliases
      .find((row) => row.surface === 'mcp.baton' && row.name === tool);
    const byDerived = APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
      .find((operation) => operation.names.mcp === tool);
    const operation = alias
      ? APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
        .find((entry) => entry.key === alias.canonical)
      : byDerived;
    const key = operation?.key ?? tool;
    const profile = operation?.profile ?? 'ordinary';
    const effect = operation
      ? (operation.destructive ? 'destructive' : operation.idempotent ? 'idempotent' : 'effectful')
      : 'idempotent';
    return `| \`${key}\` | \`${profile}\` | \`${tool}\` | ${effect} |`;
  });
  return [
    '| Operation | Profile | MCP tool | Annotation |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/**
 * The fleet-routes table (issue #293) — rendered from the SERVED route registry (DEFAULT_ROUTES
 * plus the one conditional route), never hand-edited. One row per registered
 * harness/provider/model family with efforts in registry order; the Ready-when column is the
 * deployment's own routeReadinessContract — the same contract the readiness gates enforce — so
 * the first surface an operator reads cannot disagree with what the deployment serves.
 */
export function renderCliFleetRoutes() {
  const families = new Map();
  for (const route of DEFAULT_BATON_DEPLOYMENT_ROUTES) {
    const key = `${route.harness}|${route.provider ?? ''}|${route.model}`;
    const family = families.get(key) ?? { route, efforts: [] };
    if (!family.efforts.includes(route.effort)) family.efforts.push(route.effort);
    families.set(key, family);
  }
  const rows = [...families.values()].map(({ route, efforts }) => {
    const providerLabel = route.provider && route.provider !== 'claude'
      ? ` (provider ${route.provider})` : '';
    return `| \`${route.harness}\`${providerLabel} | \`${route.model}\` | ${efforts.join('/')} | ${routeReadinessContract(route)} |`;
  });
  // The one conditional route: declared beside the registry because it registers only when its
  // private credential is present. Rendered from that same declaration, and only when the
  // default registry does not already carry it — the table never shows it twice.
  const conditionalServed = DEFAULT_BATON_DEPLOYMENT_ROUTES.some((route) => (
    route.harness === KIMI_THROUGH_CLAUDE_ROUTE.harness
    && route.provider === KIMI_THROUGH_CLAUDE_ROUTE.provider
    && route.model === KIMI_THROUGH_CLAUDE_ROUTE.model));
  if (!conditionalServed) {
    rows.push(`| \`${KIMI_THROUGH_CLAUDE_ROUTE.harness}\` (provider ${KIMI_THROUGH_CLAUDE_ROUTE.provider}, conditional) | \`${KIMI_THROUGH_CLAUDE_ROUTE.model}\` | ${KIMI_THROUGH_CLAUDE_ROUTE.effort} | ${routeReadinessContract(KIMI_THROUGH_CLAUDE_ROUTE)} |`);
  }
  return [
    '| Harness | Model(s) | Efforts | Ready when |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

/**
 * The #170 wavefile directive table (D4/P8) — rendered mechanically from the compiler's
 * WAVEFILE_DIRECTIVES registry (the ONE source), never hand-edited. The conformance main proves the
 * documented ⇄ parsed ⇄ admitted invariant against this table.
 */
export function renderWavefileGrammar() {
  const rows = Object.entries(WAVEFILE_DIRECTIVES).map(([directive, definition]) => (
    `| \`${directive}\` | \`${definition.arity}\` | \`${definition.tokens.join(' ')}\` | \`${definition.field}\` |`
  ));
  return [
    '| Directive | Arity | Tokens | IR field |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

export function injectGeneratedBlock(text, marker, block) {
  const begin = beginMarker(marker);
  const end = endMarker(marker);
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  if (start < 0 || stop < 0 || stop < start) {
    throw new Error(`missing or malformed generated markers for "${marker}"`);
  }
  const before = text.slice(0, start + begin.length);
  const after = text.slice(stop);
  return `${before}\n\n${block}\n\n${after}`;
}

// #293: exported so the surface gate's --write path (renderDocs.TARGETS) regenerates every
// block — an unexported list silently wrote nothing there.
export const TARGETS = [
  { doc: CLI_DOC, marker: CLI_INVENTORY_MARKER, render: renderCliVerbInventory },
  { doc: CLI_DOC, marker: CLI_FLEET_ROUTES_MARKER, render: renderCliFleetRoutes },
  { doc: MCP_DOC, marker: MCP_INVENTORY_MARKER, render: renderMcpToolInventory },
];

export function renderSurfaceDoc({ doc, marker, render }) {
  return injectGeneratedBlock(readFileSync(doc, 'utf8'), marker, render());
}

// The conformance check: for each target, the committed file must byte-equal the freshly rendered
// file. A drifted committed block (or a stale renderer) is reported, never silently accepted.
export function checkSurfaceDocs() {
  const findings = [];
  for (const target of TARGETS) {
    const committed = readFileSync(target.doc, 'utf8');
    if (renderSurfaceDoc(target) !== committed) {
      findings.push(`generated block "${target.marker}" is stale in ${target.doc.pathname.split('/').pop()}`);
    }
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const check = process.argv.includes('--check');
  if (check) {
    const findings = checkSurfaceDocs();
    for (const finding of findings) process.stderr.write(`render-surface-docs: ${finding}\n`);
    process.exit(findings.length > 0 ? 1 : 0);
  }
  for (const target of TARGETS) writeFileSync(target.doc, renderSurfaceDoc(target));
  process.stdout.write('render-surface-docs: regenerated CLI.md inventory and fleet-routes blocks, MCP.md inventory block\n');
}
