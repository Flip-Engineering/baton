#!/usr/bin/env node

// docs/36 §9 M4 (M4b) — the generated documentation surface. The CLI.md verb-inventory block and
// the MCP.md tool-inventory block are RENDERED from registry v2, never hand-maintained, so a §6
// operation, a name derivation, or an annotation lands in exactly one place. The committed blocks
// live between BEGIN/END GENERATED markers; a conformance check (`--check`, and the exported
// `checkSurfaceDocs`) fails if the committed blocks drift from this renderer.
//
//   node impl/scripts/render-surface-docs.mjs           # rewrite the generated blocks in place
//   node impl/scripts/render-surface-docs.mjs --check   # fail (exit 1) if a committed block drifted

import { readFileSync, writeFileSync } from 'node:fs';

import { APPLICATION_SEMANTIC_REGISTRY, deriveSurfaceNames } from '../src/application-semantics.mjs';

const CLI_DOC = new URL('../CLI.md', import.meta.url);
const MCP_DOC = new URL('../MCP.md', import.meta.url);

export const CLI_INVENTORY_MARKER = 'cli-verb-inventory';
export const MCP_INVENTORY_MARKER = 'mcp-tool-inventory';

function beginMarker(marker) { return `<!-- BEGIN GENERATED: ${marker} (impl/scripts/render-surface-docs.mjs) -->`; }
function endMarker(marker) { return `<!-- END GENERATED: ${marker} -->`; }

// The registry is the single generator: the same `deriveSurfaceNames` every renderer and the
// conformance harness use produces the CLI and MCP spellings here too.
function surfaceOperations(surface) {
  return APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
    .filter((operation) => operation.surfaces.includes(surface));
}

export function renderCliVerbInventory() {
  const rows = surfaceOperations('cli').map((operation) => (
    `| \`${operation.key}\` | \`${operation.profile}\` | \`${deriveSurfaceNames(operation.key).cli}\` | \`${operation.example}\` |`
  ));
  return [
    '| Operation | Profile | CLI verb | Example |',
    '|---|---|---|---|',
    ...rows,
  ].join('\n');
}

export function renderMcpToolInventory() {
  const rows = surfaceOperations('mcp').map((operation) => {
    const effect = operation.destructive ? 'destructive' : operation.idempotent ? 'idempotent' : 'effectful';
    return `| \`${operation.key}\` | \`${operation.profile}\` | \`${deriveSurfaceNames(operation.key).mcp}\` | ${effect} |`;
  });
  return [
    '| Operation | Profile | MCP tool | Annotation |',
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

const TARGETS = [
  { doc: CLI_DOC, marker: CLI_INVENTORY_MARKER, render: renderCliVerbInventory },
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  if (check) {
    const findings = checkSurfaceDocs();
    for (const finding of findings) process.stderr.write(`render-surface-docs: ${finding}\n`);
    process.exit(findings.length > 0 ? 1 : 0);
  }
  for (const target of TARGETS) writeFileSync(target.doc, renderSurfaceDoc(target));
  process.stdout.write('render-surface-docs: regenerated CLI.md and MCP.md inventory blocks\n');
}
