#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpFleetServer, serveMcpStdio } from '../src/index.mjs';

const configPath = process.argv[2] ?? process.env.BATON_MCP_CONFIG;
if (!configPath) {
  process.stderr.write('usage: baton-mcp <config-module.mjs>\n');
  process.exitCode = 2;
} else {
  try {
    const module = await import(pathToFileURL(resolve(configPath)).href);
    const factory = module.createMcpServer ?? module.default;
    if (typeof factory !== 'function') throw new TypeError('MCP config module must export default or createMcpServer()');
    const configured = await factory();
    const server = configured instanceof McpFleetServer ? configured : new McpFleetServer(configured);
    await serveMcpStdio(server);
  } catch (error) {
    process.stderr.write(`baton-mcp startup failed: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}
