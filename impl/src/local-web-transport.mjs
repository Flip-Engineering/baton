import { request as httpRequest } from 'node:http';
import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';

function localError(message, code = 'local_transport_invalid') {
  return Object.assign(new Error(message), { code });
}

function validateSocket(path, ownerUid) {
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
 * 2026-09-17, #356): the resident's answer is whatever the deployment is. */
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
  // Issue #356: the socket itself is validated per REQUEST (below) — the file may not exist yet at
  // construction, and may be unbound by a stopping resident later; both are the request's typed
  // refusal, never a construction throw the caller cannot attach to a command.
  return async function localSocketFetch(input, options = {}) {
    const target = new URL(String(input));
    if (target.origin !== base.origin || target.username || target.password || target.hash) {
      throw localError('local Baton request authority changed');
    }
    validateSocket(socketPath, ownerUid);
    const method = options.method ?? 'GET';
    const body = options.body == null ? null : Buffer.from(options.body);
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
      const onAbort = () => request.destroy(localError('local Baton request was aborted',
        'local_transport_aborted'));
      request.on('error', (error) => finish(reject, error));
      if (options.signal?.aborted) onAbort();
      else options.signal?.addEventListener?.('abort', onAbort, { once: true });
      if (body) request.write(body);
      request.end();
    });
  };
}
