const DECORATED_BY_ORIGINAL = new WeakMap();
const ORIGINAL_APPLICATION = new WeakMap();

function actorFor(principal, transport) {
  return principal?.actor
    ?? `${transport}:${principal?.principalId ?? 'unknown'}:${principal?.sessionId ?? 'unknown'}`;
}

function internalAttentionViewer(principal, transport) {
  return Object.freeze({
    actor: actorFor(principal, transport),
    // `wave-owner` is the coordinator's existing deployment-orchestrator viewer identity. It is
    // minted only after authorizeReplay proves the connected principal may inspect this Run; no
    // caller field can select or forge it.
    principalId: 'wave-owner',
    sessionId: principal?.sessionId,
  });
}

function runReadCoordinates(request) {
  return { runId: request.runId, depth: 'outline' };
}

async function authorizedAttentionWatch(application, request, principal, context, transport) {
  await application.authorizeReplay(
    'run.inspect',
    runReadCoordinates(request),
    principal,
    context,
  );
  return application.attentionWatch(
    request,
    internalAttentionViewer(principal, transport),
    context,
  );
}

function originalApplication(application) {
  return ORIGINAL_APPLICATION.get(application) ?? application;
}

/**
 * Decorate an existing Baton application without replacing any command implementation. Only the
 * attention read/replay authority changes: the real connected principal first passes existing Run
 * replay authorization, after which the server derives the coordinator's existing deployment
 * viewer. Observation replay maps the same way, so a cached attention page cannot be readable on
 * first request but forbidden on replay.
 */
export function decorateAttentionApplication(application, { transport = 'surface' } = {}) {
  if (!application || typeof application !== 'object') return application;
  const original = originalApplication(application);
  if (typeof original.command !== 'function'
    || typeof original.attentionWatch !== 'function'
    || typeof original.authorizeReplay !== 'function') return application;

  let byTransport = DECORATED_BY_ORIGINAL.get(original);
  if (!byTransport) {
    byTransport = new Map();
    DECORATED_BY_ORIGINAL.set(original, byTransport);
  }
  const existing = byTransport.get(transport);
  if (existing) return existing;

  const decorated = new Proxy(original, {
    get(target, key, receiver) {
      if (key === 'command') {
        return async (name, args, principal, context = null, options = null) => {
          if (name === 'run.attention.watch') {
            return authorizedAttentionWatch(target, args, principal, context, transport);
          }
          return target.command(name, args, principal, context, options);
        };
      }
      if (key === 'authorizeReplay') {
        return (name, args, principal, context = null) => (
          name === 'run.attention.watch'
            ? target.authorizeReplay('run.inspect', runReadCoordinates(args), principal, context)
            : target.authorizeReplay(name, args, principal, context)
        );
      }
      if (key === 'attentionWatch') {
        return (request, principal, context = null) => (
          authorizedAttentionWatch(target, request, principal, context, transport)
        );
      }
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  ORIGINAL_APPLICATION.set(decorated, original);
  byTransport.set(transport, decorated);
  return decorated;
}
