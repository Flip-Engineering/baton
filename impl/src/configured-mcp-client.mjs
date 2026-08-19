import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { McpFleetServer } from './index.mjs';
import { BatonControlError } from './holistic-runtime.mjs';
import { createMcpServerFromDescriptorPath } from './mcp-descriptor.mjs';
import { wrapProductionMcpServer } from './production-mcp-complete.mjs';

export async function createConfiguredMcpServer(configPath, { defaultSurface = 'combined' } = {}) {
  if (typeof configPath !== 'string' || configPath.length === 0) {
    throw new BatonControlError('cli_config_invalid', 'MCP config path is required', { field: 'mcpConfig' });
  }
  if (configPath.endsWith('.json')) return createMcpServerFromDescriptorPath(configPath);
  const module = await import(pathToFileURL(resolve(configPath)).href);
  const factory = module.createMcpServer ?? module.default;
  if (typeof factory !== 'function') {
    throw new BatonControlError('cli_config_invalid', 'MCP config module must export default or createMcpServer()');
  }
  const configured = await factory();
  if (configured instanceof McpFleetServer) return configured;
  if (!configured || typeof configured !== 'object') {
    throw new BatonControlError('cli_config_invalid', 'MCP config factory must return McpFleetServer options or a server');
  }
  return new McpFleetServer({ ...configured, surface: configured.surface ?? defaultSurface });
}

export async function callConfiguredMcpTool(configPath, name, args = {}) {
  const raw = await createConfiguredMcpServer(configPath);
  const server = wrapProductionMcpServer(raw, { expandNative: true });
  await server.handle({
    jsonrpc: '2.0', id: 'surface-initialize', method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'baton-cli-surface', version: '0.1.0' },
    },
  });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  const response = await server.handle({
    jsonrpc: '2.0', id: 'surface-call', method: 'tools/call',
    params: { name, arguments: args },
  });
  if (response?.error) {
    throw new BatonControlError(
      response.error.code ?? 'mcp_protocol_error',
      response.error.message ?? 'MCP request failed',
      { detail: response.error.data ?? null },
    );
  }
  if (response?.result?.isError === true) {
    const error = response.result.structuredContent?.error ?? response.result.structuredContent ?? {};
    throw new BatonControlError(
      error.code ?? 'mcp_tool_error',
      error.message ?? 'MCP tool refused the request',
      {
        detail: error.detail ?? null,
        field: error.field ?? null,
        retryable: error.retryable === true,
        action: error.action ?? null,
      },
    );
  }
  return response?.result?.structuredContent
    ?? response?.result?.content?.find?.((entry) => entry.type === 'text')?.text
    ?? response?.result
    ?? null;
}
