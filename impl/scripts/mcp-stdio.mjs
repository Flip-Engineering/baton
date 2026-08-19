#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpFleetServer, serveMcpStdio } from '../src/index.mjs';
import { createMcpServerFromDescriptorPath } from '../src/mcp-descriptor.mjs';
import { assertCliMcpControlParity, normalizeControlSurfaceError } from '../src/control-surface-unification.mjs';
import { wrapProductionMcpServer } from '../src/production-mcp-complete.mjs';
import { assertUnifiedCapabilityCoverage } from '../src/surface-capability-catalog.mjs';
import { assertSurfaceCapabilityNameClosure } from '../src/surface-capability-resolution.mjs';

const configPath = process.argv[2] ?? process.env.BATON_MCP_CONFIG;
if (!configPath) {
  process.stderr.write('usage: baton-mcp <descriptor.json | config-module.mjs>\n');
  process.exitCode = 2;
} else {
  try {
    assertCliMcpControlParity();
    assertUnifiedCapabilityCoverage();
    assertSurfaceCapabilityNameClosure();
    const rawServer = configPath.endsWith('.json')
      ? await createMcpServerFromDescriptorPath(configPath)
      : await (async () => {
        const module = await import(pathToFileURL(resolve(configPath)).href);
        const factory = module.createMcpServer ?? module.default;
        if (typeof factory !== 'function') throw new TypeError('MCP config module must export default or createMcpServer()');
        const configured = await factory();
        if (configured instanceof McpFleetServer) return configured;
        if (!configured || typeof configured !== 'object') throw new TypeError('MCP config factory must return McpFleetServer options or a server');
        return new McpFleetServer({ ...configured, surface: configured.surface ?? 'combined' });
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
    process.stderr.write(`baton-mcp startup failed: ${envelope.error.code}: ${envelope.error.message}\n`);
    process.exitCode = 1;
  }
}
