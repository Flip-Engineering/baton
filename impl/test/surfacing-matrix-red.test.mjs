// S-3 surfacing matrix v1 — red-first contract battery.
// Authority: docs/reference/evidence/control-surface-2026-07-31/s3-surfacing-matrix.md.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  APPLICATION_SEMANTIC_REGISTRY,
  SURFACING_MATRIX_KEYS,
  deriveSurfaceNames,
} from '../src/application-semantics.mjs';
import { projectScratchpadView } from '../src/application.mjs';
import { mcpCombinedToolNames } from '../src/mcp-northbound.mjs';

const MATRIX = Object.freeze([
  ['run.scratchpad', 'ordinary', ['embedded', 'cli'], 'observe', 'projectScratchpadView'],
  ['decision.list', 'ordinary', ['embedded', 'mcp', 'cli'], 'observe', 'application.decisionList'],
  ['board.read', 'ordinary', ['embedded', 'mcp'], 'observe', 'boardSnapshot + projectBoardView'],
  ['board.post', 'ordinary', ['embedded', 'mcp'], 'control', 'admitBoardCommand → postBoardItem'],
  ['board.retitle', 'ordinary', ['embedded', 'mcp'], 'control', 'admitBoardCommand → retitleBoardItem'],
  ['board.reorder', 'ordinary', ['embedded', 'mcp'], 'control', 'admitBoardCommand → reorderBoardItem'],
  ['board.close', 'ordinary', ['embedded', 'mcp'], 'control', 'admitBoardCommand → closeBoardItem'],
  ['board.drop', 'ordinary', ['embedded', 'mcp'], 'control', 'admitBoardCommand → dropBoardItem'],
  ['scratchpad.elevate', 'kernel', ['embedded'], 'control', 'elevateTaskScratchpad'],
  ['scratchpad.settle', 'kernel', ['embedded'], 'control', 'settleWorkflowScratchpad'],
  ['package.admit', 'ordinary', ['embedded', 'mcp'], 'control', 'admitContextPackage'],
  ['package.attach', 'ordinary', ['embedded', 'mcp'], 'control', 'attachContextPackage'],
  ['package.read', 'ordinary', ['embedded', 'mcp'], 'observe', 'contextPackageBranch + projectContextPackageBranch'],
  ['repl.manifest', 'kernel', ['embedded'], 'control', 'admitReplManifest'],
  ['repl.binding', 'kernel', ['embedded'], 'control', 'admitReplBinding + dropReplBinding'],
  ['repl.cite', 'ordinary', ['embedded', 'mcp'], 'observe', 'resolveReplCitation'],
  ['knowledge.promote', 'kernel', ['embedded'], 'control', 'admitWorkflowFinding'],
  ['knowledge.recall', 'ordinary', ['embedded', 'mcp'], 'observe', 'recallKnowledge'],
  ['knowledge.horizon', 'ordinary', ['embedded', 'mcp'], 'observe', 'taskHorizon + workflowHorizon + projectHorizon'],
]);

const rows = new Map(APPLICATION_SEMANTIC_REGISTRY.canonicalOperations
  .filter((row) => SURFACING_MATRIX_KEYS.includes(row.key)).map((row) => [row.key, row]));

test('SM-1 schema truth: all nineteen rows are closed, exact live-method mappings', () => {
  assert.deepEqual([...SURFACING_MATRIX_KEYS], MATRIX.map(([key]) => key));
  assert.equal(rows.size, 19);
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
  const post = rows.get('board.post').inputSchema;
  assert.ok(post.required.includes('sessionAuthority'));
  assert.ok(post.required.includes('expectedBoardFence'));
  assert.equal(Object.hasOwn(post.properties, 'entryId'), false, 'ghost board shape retired');
  assert.deepEqual(rows.get('board.drop').inputSchema.required,
    ['sessionAuthority', 'runId', 'board', 'itemId', 'itemVersion', 'expectedBoardFence']);
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

test('SM-3 S-2 riding: every board mutation maps only to the admission primitive', () => {
  const mcp = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  for (const key of ['post', 'retitle', 'reorder', 'close', 'drop']) {
    assert.match(rows.get(`board.${key}`).liveMethod, /^admitBoardCommand/u);
  }
  assert.doesNotMatch(mcp, /coordination\.(?:post|retitle|reorder|close|drop)BoardItem\s*\(/u,
    'MCP has no adapter-side board mutation path around S-2');
  assert.match(mcp, /admitBoardCommand\s*\(/u);
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
  const application = readFileSync(new URL('../src/application.mjs', import.meta.url), 'utf8');
  assert.match(application, /deadlineAt:\s*interaction\.deadlineAt\s*\?\?\s*null/u);
  const coordinator = readFileSync(new URL('../src/coordinator.mjs', import.meta.url), 'utf8');
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
