// Issue #381: advertised and admitted inventories drift on four seams.
// RED-BEFORE tests for the three seam mismatches.
import test from 'node:test';
import assert from 'node:assert/strict';

import { kimiBatonMcpEntry } from '../src/mcp-web-bridge.mjs';
import { CORE_TOOL_NAMES } from '../src/mcp-core-tools.mjs';
import { webCardCommandNames } from '../src/web-northbound.mjs';
import { WORKER_MESSAGE_GUIDANCE, MESSAGE_KINDS } from '../src/messages.mjs';

// Seam 1: kimiBatonMcpEntry enabledTools must list the core tool names the production
// MCP server advertises — not the flat legacy tool names the pre-core surface served.
test('#381 seam 1: kimiBatonMcpEntry enabledTools matches CORE_TOOL_NAMES', () => {
  const entry = kimiBatonMcpEntry({
    projectRoot: '/repo', nodePath: '/node', bridgePath: '/repo/impl/scripts/mcp-web.mjs',
  });
  assert.deepEqual(
    entry.enabledTools,
    [...CORE_TOOL_NAMES],
    'enabledTools must list the 8 core tool names the production MCP server serves',
  );
});

// Seam 2: the served wire card must include the deployment and context-package direct-port
// commands the web server admits.
test('#381 seam 2: wire card includes deployment and context-package commands', () => {
  const card = webCardCommandNames();
  assert.ok(card.includes('deployment.doctor'),
    'wire card must include deployment.doctor');
  assert.ok(card.includes('deployment.reincarnate'),
    'wire card must include deployment.reincarnate');
  assert.ok(card.includes('package.admit'),
    'wire card must include package.admit');
  assert.ok(card.includes('package.attach'),
    'wire card must include package.attach');
});

// Seam 3: the MESSAGE_SEND guidance's kind example must be a kind that createMessage accepts.
test('#381 seam 3: WORKER_MESSAGE_GUIDANCE kind is in MESSAGE_KINDS', () => {
  const kindMatch = WORKER_MESSAGE_GUIDANCE.match(/"kind"\s*:\s*"([^"]+)"/);
  assert.ok(kindMatch, 'guidance must contain a "kind":"..." example');
  const taughtKind = kindMatch[1];
  assert.ok(
    MESSAGE_KINDS.includes(taughtKind),
    `guidance teaches kind "${taughtKind}" but createMessage accepts only ${JSON.stringify(MESSAGE_KINDS)}`,
  );
});
