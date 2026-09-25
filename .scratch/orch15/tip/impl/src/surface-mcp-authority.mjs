import { BatonControlError } from './holistic-runtime.mjs';

function deriveRepoId(server) {
  if (typeof server.boundRepoId === 'string' && server.boundRepoId.length > 0) return server.boundRepoId;
  const repoIds = [...(server.repoIds ?? [])];
  if (repoIds.length !== 1) {
    throw new BatonControlError(
      'surface_repository_ambiguous',
      'unified MCP surface requires one server-derived repository authority',
      { action: 'bind_mcp_repository' },
    );
  }
  return repoIds[0];
}

function requireAuthoritySeams(server) {
  for (const method of ['_authority', '_audit', 'takeToolQuota']) {
    if (typeof server?.[method] !== 'function') {
      throw new BatonControlError(
        'surface_authority_unavailable',
        `configured MCP authority does not expose its existing ${method} seam`,
      );
    }
  }
}

function audit(server, kind, tool, repoId, detail = null) {
  try {
    server._audit(kind, tool, { repoId }, detail);
  } catch {
    throw new BatonControlError('temporarily_unavailable', 'MCP surface audit authority is unavailable', {
      retryable: true,
    });
  }
}

export async function takeMcpMetaQuota(server, tool, repoId) {
  let quota;
  try {
    quota = await server.takeToolQuota({
      userId: server.principal.userId,
      sessionId: server.principal.sessionId,
      tool,
      repoId,
    });
  } catch {
    throw new BatonControlError('temporarily_unavailable', 'MCP surface quota authority is unavailable', {
      retryable: true,
    });
  }
  if (quota?.ok !== true) {
    audit(server, 'tool_rate_limited', tool, repoId);
    throw new BatonControlError('rate_limited', 'MCP surface quota refused the request', {
      retryable: true,
    });
  }
  return Object.freeze({ repoId });
}

export async function authorizeMcpMetaRead(server, tool, { takeQuota = true } = {}) {
  requireAuthoritySeams(server);
  const repoId = deriveRepoId(server);
  const refused = server._authority('fleet_list', { repoId });
  if (refused) {
    audit(server, 'tool_refused', tool, repoId, refused);
    throw new BatonControlError(refused, refused === 'unauthenticated'
      ? 'MCP principal is not authenticated' : 'MCP principal is not authorized');
  }
  if (takeQuota) await takeMcpMetaQuota(server, tool, repoId);
  return Object.freeze({ repoId });
}

export function auditMcpMetaCompletion(server, tool, repoId, detail = null) {
  audit(server, 'tool_completed', tool, repoId, detail);
}

export function auditMcpMetaFailure(server, tool, repoId, error) {
  audit(server, 'tool_failed', tool, repoId, error?.code ?? 'command_failed');
}
