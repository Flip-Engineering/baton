import { request as httpRequest, Agent as HttpAgent } from 'node:http';
import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { FRAME_LIMITS, WEB_WAIT_CEILING_ROW } from './limits.mjs';

/** Issue #445: the ONE bound this transport applies to an owner-socket request: the web wait ceiling
 * plus the registry's own idle margin row — derived, never a literal, and never shorter than the
 * ceiling it must outlast. Node's process-global agent (which this transport does not use) carries
 * an idle timer of its own (5000 ms since v19) and re-arms a reused socket from the server's
 * advertised keep-alive window (~4000 ms): both are shorter than a wait the resident may still be
 * legitimately serving. */
export const LOCAL_TRANSPORT_IDLE_TIMEOUT_MS =
  WEB_WAIT_CEILING_ROW.value + FRAME_LIMITS['transport.idle_margin_ms'].value;

function localError(message, code = 'local_transport_invalid') {
  return Object.assign(new Error(message), { code });
}

/** Issue #445 (item 2): the refusal this transport hands its caller — the socket's own cause, plus
 * how long the request had been waiting. The CLI's ONE transport-cause composition carries exactly
 * this pair into `cli_transport_failed`'s detail (socketCause reads the error's code and message),
 * so an operator can tell a stall from a dead resident without `NODE_DEBUG`. The transport's own
 * refusals (unavailable, aborted, invalid) are already composed and ride through untouched. */
function ownerSocketFailure(error, elapsedMs) {
  if (error !== null && typeof error === 'object' && typeof error.code === 'string'
    && error.code.startsWith('local_transport_')) return error;
  const code = typeof error?.code === 'string' && error.code.length > 0
    ? error.code : 'local_transport_failed';
  const message = error instanceof Error && error.message.length > 0
    ? error.message : 'the owner-socket request failed';
  return Object.assign(
    new Error(`${message} (after ${elapsedMs} ms waiting on the owner socket)`),
    { code, cause: error },
  );
}

function validateSocket(path, ownerUid) {
  // sockaddr_un.sun_path is 104 bytes including the NUL terminator on Darwin (108 on Linux),
  // so 103 bytes is the portable ceiling for a Unix socket path.
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')
    || Buffer.byteLength(path) > 103) {
    throw localError('local Baton socket path is invalid');
  }
  let stat;
  try { stat = lstatSync(path); }
  catch { throw localError('local Baton socket is unavailable', 'local_transport_unavailable'); }
  if (!stat.isSocket() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0
    || (ownerUid !== null && Number.isInteger(stat.uid) && stat.uid !== ownerUid)) {
    throw localError('local Baton socket authority is unsafe');
  }
  return stat;
}

class LocalHeaders {
  constructor(headers) { this.headers = headers; }
  get(name) {
    const value = this.headers[String(name).toLowerCase()];
    return Array.isArray(value) ? value.join(', ') : value == null ? null : String(value);
  }
}

/** A narrowly-scoped fetch-compatible transport for authenticated HTTP over one owner-only Unix
 * socket. It validates the synthetic HTTPS authority at construction and the socket's identity,
 * existence and authority on EVERY request (issue #356: a socket that is not up YET — or that the
 * resident unbound — is a typed per-request refusal, `local_transport_unavailable`, not a
 * construction failure; the refusal's code rides the caller's composed transport cause). It never
 * follows redirects. It carries no size ceiling in either direction (operator ruling,
 * 2026-09-17, #356): the resident's answer is whatever the deployment is. Issue #445: it rides its
 * OWN HTTP agent, and every socket it opens or rides carries this transport's registry-derived idle
 * bound (`LOCAL_TRANSPORT_IDLE_TIMEOUT_MS`, exposed as the returned transport's `idleTimeoutMs`) —
 * never Node's process-global agent timer, so a resident stall inside the web wait ceiling can
 * never be judged by the transport. */
export function createLocalSocketFetch({
  socketPath,
  baseUrl = 'https://baton.local',
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
} = {}) {
  let base;
  try { base = new URL(baseUrl); }
  catch { throw localError('local Baton base URL is invalid'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
    || base.search || base.hash) {
    throw localError('local Baton transport configuration is invalid');
  }
  // Issue #445: ONE agent of this transport's own — never the process-global one, whose idle timer
  // (5000 ms since v19) and whose pooled-reuse re-arm (~4000 ms, from the server's advertised
  // keep-alive window) are both shorter than the web wait ceiling a resident may still be serving.
  // The bound declared here is the registry derivation; the request leg below enforces the same
  // bound on every socket this transport rides, fresh or reused.
  const agent = new HttpAgent({ keepAlive: true, timeout: LOCAL_TRANSPORT_IDLE_TIMEOUT_MS });
  // Issue #356: the socket itself is validated per REQUEST (below) — the file may not exist yet at
  // construction, and may be unbound by a stopping resident later; both are the request's typed
  // refusal, never a construction throw the caller cannot attach to a command.
  const localSocketFetch = async function localSocketFetch(input, options = {}) {
    const target = new URL(String(input));
    if (target.origin !== base.origin || target.username || target.password || target.hash) {
      throw localError('local Baton request authority changed');
    }
    validateSocket(socketPath, ownerUid);
    const method = options.method ?? 'GET';
    const body = options.body == null ? null : Buffer.from(options.body);
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener?.('abort', onAbort);
        callback(value);
      };
      const request = httpRequest({
        socketPath,
        method,
        path: `${target.pathname}${target.search}`,
        headers: { ...(options.headers ?? {}), host: base.host },
        agent,
      }, (response) => {
        // Operator ruling (2026-09-17, #356): NO response ceiling on the local transport. A
        // caller cannot anticipate the size of a resident's answer — a busy swarm's view is
        // whatever the swarm is — and a ceiling here tore the socket down mid-body and surfaced
        // as a dead transport, which killed every watch and recruit --follow on a 35-seat
        // swarm. The answer is read whole; memory is the natural throttle (#258).
        const chunks = [];
        response.on('data', (chunk) => { chunks.push(chunk); });
        response.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const headers = new LocalHeaders(response.headers);
          const status = response.statusCode ?? 0;
          finish(resolve, Object.freeze({
            ok: status >= 200 && status < 300,
            status,
            headers,
            text: async () => bytes.toString('utf8'),
            json: async () => JSON.parse(bytes.toString('utf8')),
            arrayBuffer: async () => bytes.buffer.slice(
              bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
            ),
          }));
        });
      });
      // Issue #445: the bound is enforced per REQUEST, not merely declared on the agent: a socket
      // the agent reuses arrives carrying the timer Node re-armed from the server's advertised
      // keep-alive window, and an idle timer shorter than the ceiling must never govern a request
      // the resident is still allowed to answer.
      request.on('socket', (socket) => { socket.setTimeout(LOCAL_TRANSPORT_IDLE_TIMEOUT_MS); });
      const onAbort = () => request.destroy(localError('local Baton request was aborted',
        'local_transport_aborted'));
      request.on('error', (error) => finish(reject, ownerSocketFailure(error, Date.now() - startedAt)));
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener?.('abort', onAbort, { once: true });
      if (body) request.write(body);
      request.end();
    });
  };
  // The bound this transport applies to every socket it opens or rides (#445).
  localSocketFetch.idleTimeoutMs = LOCAL_TRANSPORT_IDLE_TIMEOUT_MS;
  return localSocketFetch;
}
