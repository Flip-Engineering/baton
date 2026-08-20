import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// #191 red pin — pm's clean ADOPT: the CLI↔MCP parity MATRIX as a test.
//
// The shape (from pm-comparison-2026-08-13): one generated table, command × surface ×
// admitted, maintained against the real dispatch — with a suite row asserting every
// documented command resolves IDENTICALLY across CLI/MCP (and every divergence refusing
// identically). It adds no runtime surface: a suite over the registry we already have.
// Kills the #157 ghost class (advertised-but-refusing) and pm's own --all bug class.
//
// RED   = no parity matrix artifact exists.
// GREEN = the matrix is generated from the surface catalog (the executable inventory),
//         every row's CLI/MCP/web admission agrees with the catalog's names closure, and
//         divergences appear ONLY as explicit ledgered rows.

const ROOT = resolve(import.meta.dirname, '..');
const REPO = resolve(ROOT, '..');
const MATRIX = resolve(REPO, 'docs/reference/inventory/surface-parity-matrix.json');
const GENERATOR = resolve(ROOT, 'scripts/surface-parity.mjs');

test('PARITY-MATRIX (#191): the matrix exists, is generated from the live catalog, and is coherent', async () => {
  assert.ok(existsSync(MATRIX), 'the parity matrix artifact exists (docs/reference/inventory/surface-parity-matrix.json)');

  // Regenerate deterministically into a temp copy and compare — the committed artifact
  // must match what the live registry produces.
  const tmp = `${MATRIX}.tmp`;
  execFileSync(process.execPath, [GENERATOR, '--out', tmp], { cwd: ROOT, encoding: 'utf8' });
  const committed = JSON.parse(readFileSync(MATRIX, 'utf8'));
  const regenerated = JSON.parse(readFileSync(tmp, 'utf8'));
  assert.deepEqual(regenerated, committed, 'the committed matrix regenerates deterministically from the live catalog');

  // Structure: rows keyed by canonical name carrying per-surface admission.
  assert.ok(Array.isArray(committed.rows) && committed.rows.length > 100,
    `the matrix carries the full command roster (${committed.rows?.length ?? 0} rows)`);

  // THE PARITY LAW: every row's CLI/MCP admission agrees — or the divergence is
  // EXPLICITLY ledgered (never silent).
  const violations = committed.rows.filter((row) => (row.cli === null) !== (row.mcp === null) && row.ledgered !== true);
  assert.equal(violations.length, 0,
    `silent parity violations: ${violations.slice(0, 5).map((r) => r.name).join(', ')}${violations.length > 5 ? ` +${violations.length - 5}` : ''} — divergences must be explicit ledger rows`);
});
