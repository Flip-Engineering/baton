#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CoordinationStore, createBatonWebMcpServer, serveMcpStdio,
} from '../src/index.mjs';
import { createMcpServerFromDescriptorPath } from '../src/mcp-descriptor.mjs';

// PKG-1: `baton-mcp-web <descriptor.json>` accepts the declarative descriptor like the stdio
// entry; without an argument it keeps the legacy web-bridge factory (back-compat).
const descriptorPath = process.argv[2];
const stateRoot = mkdtempSync(join(tmpdir(), 'baton-kimi-orchestrator-mcp-'));
try {
  const server = descriptorPath
    ? await createMcpServerFromDescriptorPath(descriptorPath)
    : await (async () => {
      const coordination = new CoordinationStore(join(stateRoot, 'coordination'));
      return createBatonWebMcpServer({ coordination, cwd: process.cwd() });
    })();
  const stopInput = () => { if (!process.stdin.destroyed) process.stdin.destroy(); };
  process.on('SIGINT', stopInput);
  process.on('SIGTERM', stopInput);
  try {
    await serveMcpStdio(server);
  } finally {
    process.off('SIGINT', stopInput);
    process.off('SIGTERM', stopInput);
  }
} catch (error) {
  // Issue #41: the code alone left the operator source-diving; keep the human cause beside it.
  const code = error?.code ?? 'unknown';
  const detail = error?.message && error.message !== code ? `: ${error.message}` : '';
  process.stderr.write(`baton-mcp-web startup failed: ${code}${detail}\n`);
  process.exitCode = 1;
} finally {
  rmSync(stateRoot, { recursive: true, force: true });
}
