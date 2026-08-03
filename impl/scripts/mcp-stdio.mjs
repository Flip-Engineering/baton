#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpFleetServer, serveMcpStdio } from '../src/index.mjs';
import { createMcpServerFromDescriptorPath } from '../src/mcp-descriptor.mjs';

const configPath = process.argv[2] ?? process.env.BATON_MCP_CONFIG;
if (!configPath) {
  process.stderr.write('usage: baton-mcp <descriptor.json | config-module.mjs>\n');
  process.exitCode = 2;
} else {
  try {
    // PKG-1: a `.json` path is the declarative deployment descriptor (pinned at open, immutable
    // for the server's life); any other path is the legacy config FACTORY MODULE (back-compat).
    const server = configPath.endsWith('.json')
      ? await createMcpServerFromDescriptorPath(configPath)
      : await (async () => {
        const module = await import(pathToFileURL(resolve(configPath)).href);
        const factory = module.createMcpServer ?? module.default;
        if (typeof factory !== 'function') throw new TypeError('MCP config module must export default or createMcpServer()');
        const configured = await factory();
        return configured instanceof McpFleetServer ? configured : new McpFleetServer(configured);
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
    process.stderr.write(`baton-mcp startup failed: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}
