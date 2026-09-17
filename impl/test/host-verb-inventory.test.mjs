// U-G7 host half (issue #313, the #289 registry-truth leftover): CLI.md's taught host verbs —
// doctor, serve, setup, route, credentials, top — lived only in prose because the generated
// inventory is pinned to the wire-card application commands. They now have their own generated
// inventory: one executable table the parser itself resolves (this test resolves every row
// through parseBatonCli), rendered into CLI.md by render-surface-docs.mjs and checked for drift
// by the surface gate — the same treatment the #289 CLI half gave the application verbs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CLI_TOP_LEVEL_VERBS, HOST_CLI_VERBS, batonCliHelp, parseBatonCli } from '../src/application-cli.mjs';
import { parseUnifiedSurfaceCli } from '../src/surface-cli.mjs';
import {
  CLI_HOST_VERBS_MARKER, CLI_TOP_LEVEL_VERBS_MARKER, TARGETS,
  renderCliHostVerbInventory, renderCliTopLevelVerbs,
} from '../scripts/render-surface-docs.mjs';

const CLI_DOC = fileURLToPath(new URL('../CLI.md', import.meta.url));

test('every host verb row is resolved live by the parser it documents', () => {
  assert.ok(HOST_CLI_VERBS.length >= 5, 'the host inventory covers the prose-taught verbs');
  for (const row of HOST_CLI_VERBS) {
    const parsed = parseBatonCli(row.argv);
    assert.equal(parsed.kind, row.kind, `${row.verb} resolves to its declared parser kind`);
  }
});

test('the renderer renders the host inventory and the gate regenerates it', () => {
  const block = renderCliHostVerbInventory();
  for (const row of HOST_CLI_VERBS) assert.ok(block.includes(row.verb), `${row.verb} appears in the rendered block`);
  const target = TARGETS.find((entry) => entry.marker === CLI_HOST_VERBS_MARKER);
  assert.ok(target, 'the surface gate regenerates the host block (TARGETS entry)');
});

test('the committed CLI.md host block is byte-current with the renderer', () => {
  const text = readFileSync(CLI_DOC, 'utf8');
  const begin = `<!-- BEGIN GENERATED: ${CLI_HOST_VERBS_MARKER} (impl/scripts/render-surface-docs.mjs) -->`;
  const end = `<!-- END GENERATED: ${CLI_HOST_VERBS_MARKER} -->`;
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  assert.ok(start >= 0 && stop > start, 'CLI.md carries the generated host-verb block');
  const committed = text.slice(text.indexOf('\n', start) + 1, stop).trim();
  assert.equal(committed, renderCliHostVerbInventory().trim(), 'the committed block is the renderer output');
});

// ── issue #340: ONE closed top-level verb set ───────────────────────────────────────────────────
//
// `baton bogus` taught 'credentials, setup, doctor, route, explore, review, context, waves, or run'
// while `baton --help` taught a different, smaller set and the docs rendered a third — three hand
// lists that had drifted from the dispatch table. The rows below pin the ONE derivation:
// CLI_TOP_LEVEL_VERBS, resolved live by the parser that serves each row, rendered identically by the
// help topic, the unknown-verb refusal and CLI.md.

function generatedBlock(text, marker) {
  const begin = `<!-- BEGIN GENERATED: ${marker} (impl/scripts/render-surface-docs.mjs) -->`;
  const end = `<!-- END GENERATED: ${marker} -->`;
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  assert.ok(start >= 0 && stop > start, `CLI.md carries the generated ${marker} block`);
  return text.slice(text.indexOf('\n', start) + 1, stop).trim();
}

test('every top-level verb row resolves through the parser that serves it (#340)', () => {
  assert.ok(CLI_TOP_LEVEL_VERBS.length >= HOST_CLI_VERBS.length, 'the host half is a subset of the closed set');
  for (const row of CLI_TOP_LEVEL_VERBS) {
    const parsed = row.parser === 'unified-surface'
      ? parseUnifiedSurfaceCli(row.argv)
      : parseBatonCli(row.argv);
    assert.equal(parsed?.kind, row.kind, `${row.token} resolves to its declared parser result`);
  }
  assert.deepEqual(HOST_CLI_VERBS.map((row) => row.token),
    ['doctor', 'serve', 'setup', 'route', 'credentials', 'top'], 'the host half is the U-G7 table');
});

test('the taught verb set is ONE derivation: --help, the unknown-verb refusal and CLI.md agree (#340)', () => {
  const verbs = CLI_TOP_LEVEL_VERBS.map((row) => row.token);

  // 1. `baton --help` (the application help topic) teaches every verb of the closed set.
  const help = batonCliHelp('application');
  for (const row of CLI_TOP_LEVEL_VERBS) assert.ok(help.includes(row.verb), `--help teaches ${row.verb}`);

  // 2. the unknown-verb refusal names EXACTLY that set, in table order — never a stale hand list.
  const refusal = (() => { try { parseBatonCli(['bogus']); return null; } catch (error) { return error; } })();
  assert.equal(refusal?.code, 'cli_invalid', 'an unknown verb refuses typed');
  assert.deepEqual(refusal.message.replace(/^expected /u, '').split(/,\s*(?:or\s+)?/u), verbs,
    'the refusal names exactly the closed top-level verb set');
  assert.equal(verbs.includes('context'), false,
    'a token the parser only corrects (host-local context eval) is never advertised as a verb');

  // 3. the generated CLI.md block renders the same rows.
  const block = generatedBlock(readFileSync(CLI_DOC, 'utf8'), CLI_TOP_LEVEL_VERBS_MARKER);
  assert.equal(block, renderCliTopLevelVerbs(), 'the committed block is the renderer output');
  for (const row of CLI_TOP_LEVEL_VERBS) assert.ok(block.includes(`\`${row.verb}\``), `CLI.md teaches ${row.verb}`);
  assert.equal(block.split('\n').length - 2, CLI_TOP_LEVEL_VERBS.length,
    'the docs table has one row per verb — no extra, no missing');
});
