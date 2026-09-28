// S-3 surfacing matrix v1 — red-first contract battery.
// Authority: docs/reference/evidence/control-surface-2026-07-31/s3-surfacing-matrix.md.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { memberSource } from './seam-member-source.mjs';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  SURFACING_MATRIX_KEYS,
  deriveSurfaceNames,
} from '../src/application-semantics.mjs';
import { projectScratchpadView } from '../src/application.mjs';
import { mcpCombinedToolNames } from '../src/mcp-northbound.mjs';

const MATRIX = Object.freeze([
  // 2026-09-14 audit (#289): the `cli` claims on run.scratchpad and decision.list were ghosts —
  // no CLI verb reaches either projection (run.scratchpad.read is the CLI read; decision.list is
  // the MCP reflex tool over application.decisionList). The registry now claims exactly the
  // surfaces that serve each row, and surface-resolution.mjs proves it at the gate.
  ['run.scratchpad', 'ordinary', ['embedded'], 'observe', 'projectScratchpadView'],
  ['decision.list', 'ordinary', ['embedded', 'mcp'], 'observe', 'application.decisionList'],
  // MCP-W2 fold (mcp-packaging-decisions v1.0): scratchpad.settle /
  // knowledge.promote LEAVE the reflex matrix — they are the ordinary-surface settlement tools.
  ['knowledge.recall', 'ordinary', ['embedded', 'mcp'], 'observe', 'recallKnowledge'],
  ['knowledge.horizon', 'ordinary', ['embedded', 'mcp'], 'observe', 'taskHorizon + workflowHorizon + projectHorizon'],
]);

const rows = new Map(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
  .filter((row) => SURFACING_MATRIX_KEYS.includes(row.key)).map((row) => [row.key, row]));

test('SM-1 schema truth: all ten rows are closed, exact live-method mappings', () => {
  assert.deepEqual([...SURFACING_MATRIX_KEYS], MATRIX.map(([key]) => key));
  assert.equal(rows.size, SURFACING_MATRIX_KEYS.length);
  for (const [key, profile, surfaces, effect, liveMethod] of MATRIX) {
    const row = rows.get(key);
    assert.ok(row, `${key} is registered`);
    assert.equal(row.profile, profile, `${key} profile`);
    assert.deepEqual([...row.surfaces], surfaces, `${key} surfaces`);
    assert.equal(row.effect, effect, `${key} effect`);
    assert.equal(row.liveMethod, liveMethod, `${key} live method`);
    assert.equal(typeof row.authority, 'string', `${key} authority note`);
    assert.equal(row.inputSchema.type, 'object');
    assert.equal(row.inputSchema.additionalProperties, false, `${key} schema is closed`);
    assert.deepEqual(row.names, deriveSurfaceNames(key));
    assert.ok(Array.isArray(row.authorityFields));
    assert.ok(Array.isArray(row.serverDerived));
  }
});

test('SM-2 surface honesty: negative inventory is closed per row and profile', () => {
  for (const [key, profile, enabled] of MATRIX) {
    const row = rows.get(key);
    assert.equal(row.surfaces.includes('web'), false, `${key} refuses web; use ${enabled.join(', ')}`);
    if (profile === 'kernel') {
      assert.deepEqual([...row.surfaces], ['embedded'], `${key} is absent from ordinary MCP`);
    }
  }
});

test('SM-4 read rows: scratchpad projection, decision deadline, and horizon viewer scope stay live', () => {
  const projected = projectScratchpadView({
    runId: 'run-a', fenceTuple: [['worker:w1', 1], ['worker:w2', 1], ['shared', 1]],
    slices: [
      { scope: 'worker:w1', entries: [] }, { scope: 'worker:w2', entries: [] },
      { scope: 'shared', entries: [] },
    ],
  }, { role: 'worker', workerId: 'w1' });
  assert.deepEqual(projected.scopes, ['worker:w1', 'shared']);
  // issue #259 slice 15: projectDecisionAttention moved to application-observation.mjs — read
  // the member, wherever the split left it, through the seam-map resolver.
  assert.match(memberSource('projectDecisionAttention'),
    /deadlineAt:\s*interaction\.deadlineAt\s*\?\?\s*null/u);
  // issue #259 slice 10: workflowHorizon moved to runtime-observation.mjs — read the member,
  // wherever the split left it, through the seam-map resolver.
  const coordinator = memberSource('workflowHorizon');
  assert.match(coordinator, /viewer !== 'orchestrator' && !ownedWorkerIds\.includes\(viewer\)/u);
});

test('SM-5 conformance: C1 rows cover the matrix and MCP reflex tools derive from it', () => {
  for (const [key] of MATRIX) assert.deepEqual(rows.get(key).names, deriveSurfaceNames(key));
  const mcpKeys = MATRIX.filter(([, , surfaces]) => surfaces.includes('mcp')).map(([key]) => key);
  const combined = new Set(mcpCombinedToolNames());
  for (const key of mcpKeys) assert.ok(combined.has(deriveSurfaceNames(key).mcp), `${key} MCP tool`);
  const source = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  assert.match(source, /SURFACING_MATRIX_MCP_ROWS/u);
  assert.doesNotMatch(source, /const REFLEX_TOOL_DEFINITIONS = Object\.freeze\(\[\s*\{/u,
    'reflex definitions are generated, not a hand-maintained literal array');
});
