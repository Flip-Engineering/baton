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

import { HOST_CLI_VERBS, parseBatonCli } from '../src/application-cli.mjs';
import { CLI_HOST_VERBS_MARKER, TARGETS, renderCliHostVerbInventory } from '../scripts/render-surface-docs.mjs';

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
