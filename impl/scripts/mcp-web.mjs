#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CoordinationStore, createBatonWebMcpServer, serveMcpStdio,
} from '../src/index.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';
import { createMcpServerFromDescriptorPath } from '../src/mcp-descriptor.mjs';
import { assertCliMcpControlParity, normalizeControlSurfaceError } from '../src/control-surface-unification.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';
import { assertUnifiedCapabilityCoverage } from '../src/surface-capability-catalog.mjs';
import { assertSurfaceCapabilityNameClosure } from '../src/surface-capability-resolution.mjs';

const descriptorPath = process.argv[2];
const stateRoot = mkdtempSync(join(tmpdir(), 'baton-kimi-orchestrator-mcp-'));
try {
  assertCliMcpControlParity();
  assertUnifiedCapabilityCoverage();
  assertSurfaceCapabilityNameClosure();
  const rawServer = descriptorPath
    ? await createMcpServerFromDescriptorPath(descriptorPath)
    : await (async () => {
      const coordination = new CoordinationStore(join(stateRoot, 'coordination'));
      // Issue #343: the bridge frame IS the declared wire.frame substrate row — the same ceiling
      // the resident narrows swarm.view answers against (web-northbound.mjs), so a narrowed
      // answer fits instead of tripping the oversize refusal. No number is re-declared here.
      return createBatonWebMcpServer({
        coordination, cwd: process.cwd(), maxMessageBytes: FRAME_LIMITS['wire.frame'].value,
      });
    })();
  const server = wrapProductionMcpServer(rawServer, { expandNative: true });
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
  const envelope = normalizeControlSurfaceError(error);
  process.stderr.write(`baton-mcp-web startup failed: ${envelope.error.code}: ${envelope.error.message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(stateRoot, { recursive: true, force: true });
}
