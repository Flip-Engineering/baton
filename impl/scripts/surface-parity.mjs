#!/usr/bin/env node
// #191 — the CLI↔MCP parity matrix generator (pm's clean ADOPT).
// Generates docs/reference/inventory/surface-parity-matrix.json from the LIVE surface
// catalog (the executable inventory — never a hand-kept list): one row per capability,
// carrying each surface's admitted name. Divergences appear only as explicit ledgered
// rows (scripts/surface-divergence-ledger.json); the suite (surface-parity-191-red)
// asserts every row's CLI/MCP admission agrees and the artifact regenerates clean.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = process.argv.includes('--out')
  ? resolve(process.argv[process.argv.indexOf('--out') + 1])
  : resolve(ROOT, '../docs/reference/inventory/surface-parity-matrix.json');

const { unifiedCapabilityCatalog, resolveUnifiedCapability } = await import(
  new URL('../src/surface-capability-catalog.mjs', import.meta.url).href
);

const ledgerPath = resolve(ROOT, 'scripts/surface-divergence-ledger.json');
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : [];
const ledgerNames = new Set((Array.isArray(ledger) ? ledger : ledger.entries ?? [])
  .map((e) => e.name ?? e.capability).filter(Boolean));

const catalog = unifiedCapabilityCatalog();
const rows = [];
for (const row of catalog) {
  const names = row.names ?? {};
  const cli = typeof names.cli === 'string' ? names.cli : null;
  const mcp = typeof names.mcp === 'string' ? names.mcp : null;
  const web = typeof names.web === 'string' ? names.web : null;
  rows.push({
    name: row.id ?? row.key,
    category: Array.isArray(row.categories) ? row.categories[0] : null,
    cli, mcp, web,
    ledgered: ledgerNames.has(row.id ?? row.key),
  });
}
rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const matrix = {
  schemaVersion: 1,
  generatedFrom: 'surface-capability-catalog (the executable inventory)',
  parityLaw: 'every row: cli === null iff mcp === null — divergences only as ledgered rows',
  rows,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(matrix, null, 2)}\n`);
console.log(`parity matrix: ${rows.length} rows → ${OUT}`);
