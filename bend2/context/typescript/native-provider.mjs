// Run the TypeScript language service for a selected native sourceAnalysis invocation.
import { realpathSync } from 'node:fs';
import { runQuery } from './lib/query.mjs';
import { resolveTypeScript } from './lib/resolve.mjs';

const RESULT_SCHEMA = 'baton2.context.typescript.source-analysis.result.v1';

function eventFrame(invocation, payload) {
  return {
    version: 2,
    query: invocation.query,
    owner: invocation.owner,
    moduleBinding: invocation.moduleBinding,
    runtime: `${realpathSync(process.execPath)};node=${process.versions.node}`,
    role: invocation.role,
    incarnation: invocation.incarnation,
    sequence: '1',
    type: 'event',
    payload: { schema: RESULT_SCHEMA, ...payload },
  };
}

function analysisRequest(request) {
  const options = request.options ?? {};
  return {
    ...request,
    options: {
      ...options,
      project: options.project ?? '',
      readRoots: options.readRoots ?? [],
      database: options.database ?? null,
      client: options.client ?? null,
    },
  };
}

export async function executeInvocation(invocation) {
  try {
    const resolved = resolveTypeScript();
    if (!resolved.ok) {
      return eventFrame(invocation, { status: 'unavailable', engine: 'typescript',
        reason: resolved.reason, detail: resolved.detail });
    }
    const result = runQuery({ resolved, request: analysisRequest(invocation.request),
      queryId: invocation.query });
    return eventFrame(invocation, { status: 'completed', ...result });
  } catch (error) {
    return eventFrame(invocation, { status: 'unavailable', engine: 'typescript',
      reason: error.condition ?? error.code ?? error.name,
      detail: error.detail ?? error.stack ?? error.message,
      limits: error.limits ?? [] });
  }
}
