# Baton MCP stdio

Run Baton as a standard MCP subprocess with a deployment-owned configuration factory:

```sh
node impl/scripts/mcp-stdio.mjs /absolute/path/to/baton-mcp.config.mjs
```

The module exports `default` or `createMcpServer()`. It may return an existing
`McpFleetServer`, or its constructor options:

```js
import { createDriver } from '/absolute/path/to/baton/impl/src/index.mjs';

export default async function createMcpServer() {
  const { coordinator, coordination } = createDriver({
    // repository, log, adapters, runtime isolation, and trust policy
  });
  return {
    coordinator,
    coordination,
    principal: {
      userId: 'operator',
      sessionId: 'local-mcp-host',
      capabilities: ['control', 'observe', 'approve', 'emergency_stop'],
      repoIds: ['repo-id'],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      revoked: false,
    },
    repoIds: ['repo-id'],
    // Derive this decision from the deployment's account/seat/request budget.
    takeToolQuota: ({ userId, tool, repoId }) => ({ ok: true }),
  };
}
```

Do not place bearer tokens or provider credentials in MCP tool arguments or the command
line. The host factory owns credential projection, fixed principal identity, quota policy,
and adapter construction. Tool calls can independently choose `harness`, `model`, and
`effort`; the coordinator remains the only fleet authority.
