// Run the TypeScript language service for a selected native sourceAnalysis invocation.
import { realpathSync } from 'node:fs';
import { runQuery } from './lib/query.mjs';
import { resolveTypeScript } from './lib/resolve.mjs';
import { databaseAccesses } from './lib/sql-join.mjs';
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
    const request = analysisRequest(invocation.request);
    const result = runQuery({ resolved, request,
      queryId: invocation.query, supplied: supplied.status === 'none' ? null : supplied.entries });
    const payload = { status: 'completed', ...result };
    // The catalog half of the databaseAccesses projection: the producer reports what each resolved
    // call site is, and this joint reports which catalog object its parsed statement names. The
    // selected database is opened read-only for one transaction and closed here.
    if (Array.isArray(request.select) && request.select.includes('databaseAccesses')) {
      // The catalog half is reported beside the source result: a failure here names its reason and
      // never replaces the analysis the query already produced.
      try {
        payload.databaseAccesses = await databaseAccesses(result, {
          cwd: request.cwd, database: request.options.database,
        });
      } catch (error) {
        payload.databaseAccesses = { status: 'unavailable', reason: error.code ?? error.name,
          detail: error.message ?? null, relations: [], refs: [], unresolved: [] };
      }
    }
    return eventFrame(invocation, payload);
  } catch (error) {
    return eventFrame(invocation, { status: 'unavailable', engine: 'typescript',
      reason: error.condition ?? error.code ?? error.name,
      detail: error.detail ?? error.stack ?? error.message,
      limits: error.limits ?? [] });
  }
}
