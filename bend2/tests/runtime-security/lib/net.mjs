// Loopback HTTP helper for inspector endpoint fixtures.
import { request } from 'node:http';

export function loopbackGet(port, path, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', (error) => resolve({ error: error.code ?? String(error) }));
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

export function parseBanner(text) {
  const match = /Debugger listening on (ws:\/\/[^\s]+)/.exec(text ?? '');
  if (match === null) return null;
  let url;
  try {
    url = new URL(match[1]);
  } catch {
    return null;
  }
  return {
    line: match[0],
    url: match[1],
    host: url.hostname,
    port: Number(url.port),
    uuid: url.pathname.replace(/^\//, ''),
  };
}

export async function waitFor(predicate, timeoutMs, pollMs = 20) {
  const started = Date.now();
  for (;;) {
    const value = predicate();
    if (value) return { value, elapsedMs: Date.now() - started };
    if (Date.now() - started > timeoutMs) return { value: null, elapsedMs: Date.now() - started, timedOut: true };
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
