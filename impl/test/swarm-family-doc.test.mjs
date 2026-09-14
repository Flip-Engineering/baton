// 2026-09-14 audit S-G1: the unified control grammar (docs/36) carries the swarm family — every
// verb, update kind, permission and attention kind the contract defines — as a section GENERATED
// from the contract (render-surface-docs.mjs §7.4) and checked by the surface gate. A kind added
// to the contract and not to the document is refused, never silently accepted; the attention
// vocabulary (which has no exported constant) is read from the runtime's own row-minting sites,
// and a source whose shape no longer matches refuses to render rather than rendering empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SWARM_FAMILY_MARKER, checkSurfaceDocs, injectGeneratedBlock, renderSwarmFamily, swarmAttentionKinds,
  TARGETS,
} from '../scripts/render-surface-docs.mjs';
import { runSurfaceGate } from '../scripts/surface-gate.mjs';
import {
  SWARM_COMMAND_DEFINITIONS, SWARM_DRIVER_EVENT_KINDS, SWARM_EVENT_KINDS,
} from '../src/swarm-contract.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';

const GRAMMAR_DOC = new URL('../../docs/36-unified-control-grammar.md', import.meta.url);

test('S-G1: the rendered swarm family carries every verb, kind, permission and attention kind', () => {
  const block = renderSwarmFamily();
  for (const name of Object.keys(SWARM_COMMAND_DEFINITIONS)) {
    assert.ok(block.includes(`\`${name}\``), `verb ${name} is rendered`);
  }
  for (const kind of SWARM_EVENT_KINDS) assert.ok(block.includes(`\`${kind}\``), `update kind ${kind} is rendered`);
  for (const kind of SWARM_DRIVER_EVENT_KINDS) assert.ok(block.includes(`\`${kind}\``), `driver kind ${kind} is rendered`);
  for (const permission of SWARM_PERMISSIONS) assert.ok(block.includes(`\`${permission}\``), `permission ${permission} is rendered`);
  for (const kind of swarmAttentionKinds()) assert.ok(block.includes(`\`${kind}\``), `attention kind ${kind} is rendered`);
  // The counts are stated in the block, so a kind that silently stops being rendered is visible
  // even to a reader who does not count rows.
  assert.match(block, new RegExp(`closed set, ${SWARM_EVENT_KINDS.length}\\)`, 'u'));
  assert.match(block, new RegExp(`closed set, ${SWARM_PERMISSIONS.length}\\)`, 'u'));
  assert.match(block, new RegExp(`closed set, ${swarmAttentionKinds().length}\\)`, 'u'));
});

test('S-G1: the committed §7.4 block is in sync with the contract (and the whole gate is green)', async () => {
  const committed = readFileSync(GRAMMAR_DOC, 'utf8');
  assert.ok(committed.includes(`<!-- BEGIN GENERATED: ${SWARM_FAMILY_MARKER}`), 'docs/36 carries the generated swarm markers');
  assert.ok(committed.includes('### 7.4 The swarm family (generated)'), 'docs/36 carries the §7.4 section');
  assert.deepEqual(checkSurfaceDocs(), [], 'every generated block, including §7.4, matches a fresh render');
  // The suite's own pre-test gate is the check that refuses a stale section.
  assert.deepEqual(await runSurfaceGate(), []);
});

test('S-G1: a document missing a kind is refused by the gate, naming the block', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-doc-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const doc = new URL(`file://${join(directory, 'fixture.md')}`);
  const fixture = `# fixture\n\n${injectGeneratedBlock(
    `<!-- BEGIN GENERATED: ${SWARM_FAMILY_MARKER} (impl/scripts/render-surface-docs.mjs) -->\n<!-- END GENERATED: ${SWARM_FAMILY_MARKER} -->`,
    SWARM_FAMILY_MARKER,
    renderSwarmFamily(),
  )}\n`;
  const target = { doc, marker: SWARM_FAMILY_MARKER, render: renderSwarmFamily };
  writeFileSync(doc, fixture);
  assert.deepEqual(checkSurfaceDocs({ targets: [target] }), [], 'the untampered fixture is in sync');
  // A kind deleted from the document (the drift this gate exists to catch) refuses.
  writeFileSync(doc, fixture.replace('- `operation_unconfirmed`\n', ''));
  assert.deepEqual(checkSurfaceDocs({ targets: [target] }), ['generated block "swarm-family" is stale in fixture.md']);
  // A hand-added line is drift too: the block is rendered, never edited.
  writeFileSync(doc, fixture.replace('**Verbs.**', '**Verbs.** (hand-edited)'));
  assert.equal(checkSurfaceDocs({ targets: [target] }).length, 1);
});

test('S-G1: the attention vocabulary is read from the runtime mint sites, in source order', () => {
  const kinds = swarmAttentionKinds();
  assert.equal(kinds.length, 8, 'the runtime mints eight attention kinds');
  assert.deepEqual(kinds, [
    'participant_runtime_dead', 'member_left_session_live', 'delegation_orphaned',
    'assignment_holder_gone', 'group_member_gone', 'coupling_writer_gone',
    'closed_with_live_participants', 'operation_unconfirmed',
  ]);
  // Fail closed: a source whose mint sites changed shape must refuse, never render an empty list.
  assert.throws(() => swarmAttentionKinds('const organization = [];'), /could not be read/u);
  assert.throws(() => swarmAttentionKinds("organization.push({ kind: 'swarm.not_attention'"), /read event kinds as attention rows/u);
  // The extractor reads exactly the mint sites, not any `kind:` literal in the file.
  assert.deepEqual(swarmAttentionKinds("organization.push({ kind: 'x_row' });\n{ kind: 'operation_x', command: c }"), ['x_row', 'operation_x']);
});

test('S-G1: the surface gate regenerates the docs/36 block on --write', () => {
  const target = TARGETS.find((entry) => entry.marker === SWARM_FAMILY_MARKER);
  assert.ok(target, 'the swarm family is a generated-docs target');
  assert.equal(target.doc.href, GRAMMAR_DOC.href, 'the swarm block renders into docs/36');
  assert.equal(typeof target.render, 'function');
});
