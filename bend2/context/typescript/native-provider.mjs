// Run the TypeScript language service for a selected native sourceAnalysis invocation.
import { realpathSync } from 'node:fs';
import { runQuery } from './lib/query.mjs';
import { resolveTypeScript } from './lib/resolve.mjs';
import { suppliedCaptures } from './lib/supplied.mjs';
// The producer side is exported beside the consumer: a context caller invokes captureInputs before the
// plan freezes, and executeInvocation consumes what the plan carries.
export { captureInputs } from './lib/produce.mjs';

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

export async function executeInvocation(invocation, options = {}) {
  try {
    // The plan may already carry this step's captured inputs. When it does, those accepted bytes are
    // what the analysis consumes; when it does not, the ordinary filesystem path runs unchanged.
    const supplied = suppliedCaptures(invocation);
    if (supplied.status === 'refused') {
      return eventFrame(invocation, { status: 'unavailable', engine: 'typescript',
        reason: supplied.reason, detail: supplied.detail ?? null });
    }
    const resolved = resolveTypeScript({ compilerPath: options.compilerPath ?? null });
    if (!resolved.ok) {
      return eventFrame(invocation, { status: 'unavailable', engine: 'typescript',
        reason: resolved.reason, detail: resolved.detail });
    }
    const result = runQuery({ resolved, request: analysisRequest(invocation.request),
      queryId: invocation.query, supplied: supplied.status === 'none' ? null : supplied.entries });
    return eventFrame(invocation, { status: 'completed', ...result });
  } catch (error) {
    return eventFrame(invocation, { status: 'unavailable', engine: 'typescript',
      reason: error.condition ?? error.code ?? error.name,
      detail: error.detail ?? error.stack ?? error.message,
      limits: error.limits ?? [] });
  }
}
