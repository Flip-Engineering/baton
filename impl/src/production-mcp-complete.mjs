import { decorateAttentionApplication } from './production-attention-authorization.mjs';
import { wrapProductionMcpServer as wrapBaseProductionMcpServer } from './production-mcp-convergence.mjs';

/**
 * Complete production MCP wrapper. The base convergence wrapper remains responsible for complete
 * tool preservation, admission/fate, meta catalogue/invoke/snapshot/watch, quotas and audits. This
 * decorator changes only the previously broken attention authorization seam: the connected
 * principal first passes the application's existing Run replay authorization, then the server
 * derives the coordinator's existing deployment-orchestrator viewer identity.
 */
export function wrapProductionMcpServer(server, options = {}) {
  if (!server || typeof server.handle !== 'function') {
    throw new TypeError('MCP server with handle() is required');
  }
  if (server.application) {
    server.application = decorateAttentionApplication(server.application, { transport: 'mcp' });
  }
  return wrapBaseProductionMcpServer(server, options);
}

export { decorateAttentionApplication as decorateMcpAttentionApplication };
