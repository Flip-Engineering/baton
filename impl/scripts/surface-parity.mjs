#!/usr/bin/env node
// #191 — the CLI↔MCP parity matrix generator (pm's clean ADOPT).
// Generates docs/reference/inventory/surface-parity-matrix.json from the LIVE surface
// catalog (the executable inventory — never a hand-kept list): one row per capability,
// carrying each surface's admitted name. Divergences appear only as explicit ledgered
// rows (scripts/surface-divergence-ledger.json); the suite (surface-parity-191-red)
// asserts every row's CLI/MCP admission agrees and the artifact regenerates clean.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
export const PARITY_MATRIX_PATH = resolve(ROOT, '../docs/reference/inventory/surface-parity-matrix.json');

const { unifiedCapabilityCatalog } = await import(
  new URL('../src/surface-capability-catalog.mjs', import.meta.url).href
);

/** The parity matrix, generated from the LIVE catalog — never a hand-kept list. */
export function buildSurfaceParityMatrix() {
  const ledgerPath = resolve(ROOT, 'scripts/surface-divergence-ledger.json');
  const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : [];
  const ledgerNames = new Set((Array.isArray(ledger) ? ledger : ledger.entries ?? [])
    .map((e) => e.name ?? e.capability).filter(Boolean));
  const rows = [];
  for (const row of unifiedCapabilityCatalog()) {
    const names = row.names ?? {};
    const cli = typeof names.cli === 'string' ? names.cli : null;
    const mcp = typeof names.mcp === 'string' ? names.mcp : null;
    const web = typeof names.web === 'string' ? names.web : null;
    const name = row.id ?? row.key;
    // The matrix carries its own explicit divergence reason — self-contained (the conformance
    // divergence ledger serves a different vocabulary: observed inventory divergences, which
    // refuse tooling-code and operator-command rows).
    let divergence = null;
    if (cli && !mcp) divergence = 'cli-only operator/local command — no MCP form';
    else if (mcp && !cli) divergence = 'mcp-only driver verb — CLI reaches it through the canonical run.*/waves.* names';
    rows.push({
      name, category: Array.isArray(row.categories) ? row.categories[0] : null,
      cli, mcp, web,
      divergence,
      ledgered: ledgerNames.has(name),
    });
  }
  rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    schemaVersion: 1,
    generatedFrom: 'surface-capability-catalog (the executable inventory)',
    parityLaw: 'every row: cli === null iff mcp === null — divergences only as ledgered rows',
    rows,
  };
}

export function renderSurfaceParityMatrix() {
  return `${JSON.stringify(buildSurfaceParityMatrix(), null, 2)}\n`;
}

/** Findings when the committed matrix differs from the live derivation. */
export function checkSurfaceParityMatrix(path = PARITY_MATRIX_PATH) {
  let committed = null;
  try { committed = readFileSync(path, 'utf8'); } catch { /* absent counts as stale */ }
  return committed === renderSurfaceParityMatrix() ? []
    : [`parity matrix is stale; regenerate via node impl/scripts/surface-gate.mjs --write`];
}

export function writeSurfaceParityMatrix(path = PARITY_MATRIX_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderSurfaceParityMatrix());
  return path;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--check')) {
    const findings = checkSurfaceParityMatrix();
    for (const finding of findings) process.stderr.write(`surface-parity: ${finding}\n`);
    process.exit(findings.length > 0 ? 1 : 0);
  }
  const out = process.argv.includes('--out')
    ? resolve(process.argv[process.argv.indexOf('--out') + 1]) : PARITY_MATRIX_PATH;
  const written = writeSurfaceParityMatrix(out);
  console.log(`parity matrix: ${buildSurfaceParityMatrix().rows.length} rows → ${written}`);
}
