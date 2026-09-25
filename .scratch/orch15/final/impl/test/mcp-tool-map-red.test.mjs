import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// #233 regression pin (2026-08-15, caught live by the fleet-drive): the canonical-naming fold
// removed the TOOL_BY_NAME const while its consumer (validateArguments — mcp-northbound's
// tools/call argument validation) survived. Every tools/call with arguments threw
// 'TOOL_BY_NAME is not defined'; the fleet could not fire a single wave.
//
// RED   = a dangling TOOL_BY_NAME reference (uses without a declaration).
// GREEN = either fully removed or declared — never dangling.

test('TOOL-MAP: TOOL_BY_NAME is never a dangling reference (every tools/call validates)', async () => {
  const src = readFileSync(new URL('../src/mcp-northbound.mjs', import.meta.url), 'utf8');
  const uses = [...src.matchAll(/TOOL_BY_NAME/g)].length;
  const declares = /const TOOL_BY_NAME\s*=/.test(src);
  assert.ok(uses === 0 || declares,
    `TOOL_BY_NAME is either fully removed or declared (uses=${uses}, declared=${declares}) — a dangling reference breaks every tools/call argument validation`);
});

test('TOOL-MAP: the restored map resolves BOTH spellings of an application tool (legacy + dot twin)', async () => {
  const northbound = await import('../src/mcp-northbound.mjs');
  const ordinary = northbound.mcpApplicationToolNames();
  assert.ok(ordinary.includes('baton_runs'), 'the legacy spelling is served');
  // The dot twin of baton_runs is 'runs.list' (APPLICATION_TOOL routes it); the dispatch
  // surface is the union — a caller may address either spelling.
  const dispatch = northbound.mcpDispatchToolNames();
  assert.ok(dispatch.includes('baton_runs') && dispatch.includes('runs.list'),
    'both spellings resolve on the dispatch surface');
  const dupes = dispatch.filter((n, i) => dispatch.indexOf(n) !== i);
  assert.deepEqual(dupes, [], `the dispatch surface is duplicate-free (dupes: ${JSON.stringify(dupes)})`);
});
