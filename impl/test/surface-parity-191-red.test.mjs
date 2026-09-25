import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { CLI_WEB_COMMANDS } from '../src/application-cli.mjs';
import { commandForTool, mcpApplicationToolNames } from '../src/mcp-northbound.mjs';
import { webCardCommandNames } from '../src/web-northbound.mjs';

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

test('PARITY-MATRIX (#191): the matrix exists, is generated from the live catalog, and is coherent', async (t) => {
  assert.ok(existsSync(MATRIX), 'the parity matrix artifact exists (docs/reference/inventory/surface-parity-matrix.json)');

  // Regenerate deterministically into a temp copy and compare — the committed artifact
  // must match what the live registry produces.
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'baton-parity-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const tmp = resolve(temporaryRoot, 'matrix.json');
  execFileSync(process.execPath, [GENERATOR, '--out', tmp], { cwd: ROOT, encoding: 'utf8' });
  const committed = JSON.parse(readFileSync(MATRIX, 'utf8'));
  const regenerated = JSON.parse(readFileSync(tmp, 'utf8'));
  assert.deepEqual(regenerated, committed, 'the committed matrix regenerates deterministically from the live catalog');

  // Structure: rows keyed by canonical name carrying per-surface admission.
  assert.ok(Array.isArray(committed.rows) && committed.rows.length > 100,
    `the matrix carries the full command roster (${committed.rows?.length ?? 0} rows)`);
  // THE PARITY LAW: every row's CLI/MCP admission agrees — or carries an EXPLICIT
  // divergence reason inline (never silent).
  const violations = committed.rows.filter((row) => (row.cli === null) !== (row.mcp === null) && typeof row.divergence !== 'string');
  assert.equal(violations.length, 0,
    `silent parity violations: ${violations.slice(0, 5).map((r) => r.name).join(', ')}${violations.length > 5 ? ` +${violations.length - 5}` : ''} — divergences must carry an explicit reason`);
});

// #153 follow-on: the wave family's verb set, pinned ACROSS the three surfaces that admit it. Each
// surface declares its own wave membership — the web tables (WAVE_WEB_ENTRIES and the sibling rows
// webCardCommandNames projects beside it), the MCP ordinary tool table, and the CLI whitelist
// (CLI_WEB_COMMANDS, the wire-card projection of the same set) — and nothing compared them, so a
// wave verb could land on one surface alone. That is the #153 class exactly: waves.run reached MCP
// at #114 while the web bus and the CLI refused it. This row derives all three from their live
// sources and asserts ONE canonical set, so a wave verb must land on all three or none.
test('PARITY-WAVE (#153): the web wave entries, the MCP wave tools and the CLI wave members are one set', () => {
  const sortedSet = (names) => [...new Set(names)].sort();
  const isWave = (name) => typeof name === 'string' && name.startsWith('waves.');
  // EXPECTED — the web surface's wave entries: the served wire card's wave projection.
  const webWave = sortedSet(webCardCommandNames().filter(isWave));
  // ACTUAL — the MCP application surface's wave tools, mapped back to the command each dispatches
  // through the same lookup the dispatch itself uses.
  const mcpWave = sortedSet(mcpApplicationToolNames().map((tool) => commandForTool(tool)).filter(isWave));
  // ACTUAL — the CLI whitelist's wave members.
  const cliWave = sortedSet([...CLI_WEB_COMMANDS].filter(isWave));

  assert.ok(webWave.length > 0, 'the wave family is admitted on the web surface');
  assert.ok(webWave.includes('waves.run'), '#153: waves.run is a wave entry on the web surface');
  assert.deepEqual(mcpWave, webWave,
    'every web wave entry is an MCP wave tool and vice versa — a wave verb lands on all three surfaces or none');
  assert.deepEqual(cliWave, webWave,
    'every web wave entry is a CLI wave member and vice versa — a wave verb lands on all three surfaces or none');
});
