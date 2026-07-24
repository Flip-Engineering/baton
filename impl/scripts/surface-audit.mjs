#!/usr/bin/env node

// Issue #43: mechanical control-surface inventory. Emits (as markdown) the current truth of
// every agent-facing control surface so the unified-grammar work (docs/35) audits against
// facts, not memory, and drift after future changes is one command away:
//
//   node impl/scripts/surface-audit.mjs
//
// Sources: the semantic registry and application command table are imported (exact); MCP tool
// names, CLI verb rows, embedded class methods, and phase literals are extracted textually.

import { readFileSync } from 'node:fs';

import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';

const src = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'latin1');

function extractAll(text, pattern) {
  const found = new Set();
  for (const match of text.matchAll(pattern)) found.add(match[1] ?? match[0]);
  return [...found].sort();
}

function extractDelimited(text, start, end) {
  const offset = text.indexOf(start);
  if (offset < 0) return '';
  const limit = text.indexOf(end, offset + start.length);
  return limit < 0 ? '' : text.slice(offset, limit + end.length);
}

function extractRunPhases() {
  const application = src('application.mjs');
  const phases = new Set();
  for (const pattern of [
    /\bphase\s*=(?!=)\s*'([a-z_]+)'/gu,
    /\b(?:view\.)?phase\s*===\s*'([a-z_]+)'/gu,
  ]) {
    for (const phase of extractAll(application, pattern)) phases.add(phase);
  }
  for (const marker of ['PROVIDER_EXECUTION_SETTLED_PHASES', 'APPLICATION_RUN_TERMINAL_PHASES']) {
    for (const phase of extractAll(extractDelimited(application, marker, ']);'), /'([a-z_]+)'/gu)) {
      phases.add(phase);
    }
  }
  for (const line of application.split('\n')) {
    if (!/^\s*(?:(?:const|let)\s+)?phase\s*=(?!=)/u.test(line)) continue;
    for (const phase of extractAll(line, /'([a-z_]+)'/gu)) phases.add(phase);
  }
  const wave = src('wave.mjs');
  for (const phase of extractAll(wave, /(?:phase\s*===|phase:)\s*'([a-z_]+)'/gu)) phases.add(phase);
  for (const phase of extractAll(
    src('application-cli.mjs'),
    /TERMINAL_RUN_PHASES = new Set\(\[([^\]]+)\]/gu,
  ).flatMap((body) => extractAll(body, /'([a-z_]+)'/gu))) phases.add(phase);
  phases.delete('pre_delivery');
  phases.delete('post_delivery');
  phases.delete('outcome_error');
  return [...phases].sort();
}

export function collectSurfaceInventory() {
  const registry = APPLICATION_SEMANTIC_REGISTRY;
  const applicationText = src('application.mjs');
  const mcpText = src('mcp-northbound.mjs');
  const definitions = Object.keys(APPLICATION_COMMAND_DEFINITIONS);
  const applicationWebCommands = definitions
    .filter((name) => APPLICATION_COMMAND_DEFINITIONS[name].web)
    .map((name) => name.replaceAll('.', '_'));
  const webLiterals = extractAll(
    extractDelimited(src('web-northbound.mjs'), 'const COMMAND_CAPABILITY', '});'),
    /(?:[,{])\s*([a-z][a-z0-9_]+):/gu,
  );
  const webCommands = [...new Set([...applicationWebCommands, ...webLiterals])].sort();
  const mcpNames = extractAll(mcpText, /'((?:fleet|baton)_[a-z0-9_]+)'/gu);
  const mcpWebBridgeCommands = extractAll(
    extractDelimited(src('mcp-web-bridge.mjs'), 'const ORDINARY_COMMANDS', ']);'),
    /'([a-z][a-z0-9_.]+)'/gu,
  );
  const clientText = src('application-client.mjs');
  const embedded = [];
  {
    let currentClass = null;
    for (const line of clientText.split('\n')) {
      const classMatch = /^(?:export )?class (\w+)/u.exec(line);
      if (classMatch) { currentClass = classMatch[1]; continue; }
      const methodMatch = /^ {2}(?:async |static )?\*?([a-zA-Z][a-zA-Z0-9_]*)\(/u.exec(line);
      if (currentClass && methodMatch && methodMatch[1] !== 'constructor') {
        embedded.push(`${currentClass}.${methodMatch[1]}`);
      }
    }
  }
  const synonymDensity = {};
  const applicationLayer = ['application.mjs', 'application-client.mjs', 'application-cli.mjs',
    'application-semantics.mjs', 'application-deployment.mjs'].map(src).join('\n');
  for (const word of ['worker', 'member', 'workstream', 'seat', 'assignee']) {
    synonymDensity[word] = (applicationLayer.match(new RegExp(word, 'giu')) ?? []).length;
  }
  const behaviorDivergences = [];
  if (/context\?\.capabilityAuthority\s*\?\s*candidates\.filter/gu.test(applicationText)) {
    behaviorDivergences.push(Object.freeze({
      surface: 'application',
      name: 'conditional capability filtering (application.mjs:8869-8875)',
    }));
  }
  if (/copy\.inputSchema\.properties\.timeoutMs\.maximum\s*=\s*this\.maxWaitMs/gu.test(mcpText)) {
    behaviorDivergences.push(Object.freeze({
      surface: 'mcp',
      name: 'per-deployment MCP schema mutation (mcp-northbound.mjs:826)',
    }));
  }
  return Object.freeze({
    registryOperations: Object.keys(registry.operations),
    registryActions: Object.keys(registry.actions),
    commandDefinitions: definitions,
    webCommands,
    cliCommands: registry.cli.commands.map((command) => ({
      id: command.id, subcommand: command.subcommand ?? null,
      action: command.action ?? null, usage: command.usage ?? null,
    })),
    mcpFleetTools: mcpNames.filter((name) => name.startsWith('fleet_')),
    mcpBatonTools: mcpNames.filter((name) => name.startsWith('baton_')),
    mcpWebBridgeCommands,
    embeddedMethods: [...new Set(embedded)].sort(),
    phaseLiterals: extractRunPhases(),
    behaviorDivergences: Object.freeze(behaviorDivergences),
    synonymDensity,
  });
}

export function renderSurfaceAudit(inventory = collectSurfaceInventory()) {
  const section = (title, rows) => `### ${title} (${rows.length})\n\n${rows.map((row) => `- \`${row}\``).join('\n')}\n`;
  const lines = [
    '## Surface inventory (generated by impl/scripts/surface-audit.mjs)', '',
    section('Semantic registry operations', inventory.registryOperations),
    section('Semantic registry actions (run.do targets)', inventory.registryActions),
    section('Application command definitions (older authoritative table)', inventory.commandDefinitions),
    section('Web bus admitted command names', inventory.webCommands),
    `### CLI verb rows (${inventory.cliCommands.length})\n\n${inventory.cliCommands
      .map((row) => `- \`${row.usage ?? row.id}\`${row.action ? ` → action \`${row.action}\`` : ''}`).join('\n')}\n`,
    section('MCP fleet_* dialect (textual extraction)', inventory.mcpFleetTools),
    section('MCP baton_* dialect (textual extraction)', inventory.mcpBatonTools),
    section('MCP-over-Web bridge subset', inventory.mcpWebBridgeCommands),
    section('Embedded client methods (textual extraction)', inventory.embeddedMethods),
    section('Run phase string literals across surfaces', inventory.phaseLiterals),
    `### Synonym density for the delegated-seat concept (application layer)\n\n${Object.entries(inventory.synonymDensity)
      .map(([word, count]) => `- ${word}: ${count}`).join('\n')}\n`,
  ];
  return lines.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(`${renderSurfaceAudit()}\n`);
}
