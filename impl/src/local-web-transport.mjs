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
 * socket. It validates the synthetic HTTPS authority and socket identity on every request, never
 * follows redirects, and bounds response buffering before BatonWebClient parses it. */
export function createLocalSocketFetch({
  socketPath,
  baseUrl = 'https://baton.local',
  ownerUid = typeof process.getuid === 'function' ? process.getuid() : null,
  maxResponseBytes = 2 * 1024 * 1024,
} = {}) {
  let base;
  try { base = new URL(baseUrl); }
  catch { throw localError('local Baton base URL is invalid'); }
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/'
    || base.search || base.hash || !Number.isSafeInteger(maxResponseBytes)
    || maxResponseBytes <= 0) {
    throw localError('local Baton transport configuration is invalid');
  }
  validateSocket(socketPath, ownerUid);
  return async function localSocketFetch(input, options = {}) {
    const target = new URL(String(input));
    if (target.origin !== base.origin || target.username || target.password || target.hash) {
      throw localError('local Baton request authority changed');
    }
    validateSocket(socketPath, ownerUid);
    const method = options.method ?? 'GET';
    const body = options.body == null ? null : Buffer.from(options.body);
    if (body && body.length > 2 * 1024 * 1024) throw localError('local Baton request is too large');
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
        let size = 0;
        const chunks = [];
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxResponseBytes) {
            request.destroy(localError('local Baton response exceeds its safe boundary',
              'local_transport_response_too_large'));
            return;
          }
          chunks.push(chunk);
        });
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
