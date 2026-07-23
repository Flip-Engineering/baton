#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CoordinationStore, createBatonWebMcpServer, serveMcpStdio,
} from '../src/index.mjs';

const stateRoot = mkdtempSync(join(tmpdir(), 'baton-kimi-orchestrator-mcp-'));
try {
  const coordination = new CoordinationStore(join(stateRoot, 'coordination'));
  const server = await createBatonWebMcpServer({ coordination, cwd: process.cwd() });
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
