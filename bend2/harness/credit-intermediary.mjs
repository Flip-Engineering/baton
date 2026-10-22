#!/usr/bin/env node
// Per-request credit intermediary for the Anthropic API-key route.
//
// The harness is launched with ANTHROPIC_BASE_URL pointing at this listener.
// Every provider request is admitted by the Bend2 policy entry before it is
// forwarded: the entry reserves a conservative bound against the verified
// organization promotional balance and the account's monthly ceiling, or
// refuses. Only an admitted request reaches the upstream. The response is
// settled from the provider's own cost when present; otherwise the reservation
// is retained as unreconciled until a later reconciliation supplies the amount.
//
// Transport only. All product policy lives in credit-intermediary.bend. The
// credential is forwarded as received and is never logged or stored here.
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const database = process.env.BATON_DATABASE || '';
const attempt = process.env.BATON_CREDIT_ATTEMPT || '';
const account = process.env.BATON_CREDIT_ACCOUNT || '';
const session = process.env.BATON_CREDIT_SESSION || '';
const entry = process.env.BATON_CREDIT_ENTRY || '';
const upstream = process.env.BATON_CREDIT_UPSTREAM || 'https://api.anthropic.com';
const listen = Number(process.env.BATON_CREDIT_LISTEN || 0);

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
                     'te', 'trailer', 'transfer-encoding', 'upgrade']);

function fail(message) {
  process.stderr.write(JSON.stringify({ schema: 'baton2-credit-intermediary-v1', state: 'unavailable',
                                        condition: 'configuration', detail: String(message).slice(0, 500) }) + '\n');
  process.exit(2);
}

if (!database) fail('BATON_DATABASE is required');
if (!entry) fail('BATON_CREDIT_ENTRY is required');
if (!Number.isInteger(listen) || listen < 0 || listen > 65535) fail('BATON_CREDIT_LISTEN is invalid');

let target;
try {
  target = new URL(upstream);
} catch (error) {
  fail('BATON_CREDIT_UPSTREAM is not a URL');
}
if (target.protocol !== 'https:' && target.protocol !== 'http:') fail('BATON_CREDIT_UPSTREAM must be http or https');

function decide(operation, args) {
  return execFileSync(entry, [database, operation, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000,
  }).trim();
}

function admit(requestId, token) {
  return token ? decide('admit-token', [requestId, token])
               : decide('admit', [requestId, attempt, account, session]);
}

// The launch binding appends a per-attempt token to the base URL. The SDK
// appends its own path after that, so the token is the first path segment and
// the remainder is forwarded upstream unchanged.
const TOKEN = /^[0-9a-f]{32}$/;
function splitPath(raw) {
  const parts = raw.split('/');
  const candidate = parts.length > 1 ? parts[1] : '';
  if (TOKEN.test(candidate)) return { token: candidate, path: '/' + parts.slice(2).join('/') };
  return { token: '', path: raw };
}

function settle(requestId, amount, source, condition) {
  try {
    decide('settle', [requestId, amount, source, condition]);
  } catch (error) {
    // The reservation stays reserved: fail closed and report the host cause.
    process.stderr.write(JSON.stringify({ schema: 'baton2-credit-intermediary-v1', state: 'unavailable',
                                          condition: 'settlementFailed', request: requestId,
                                          detail: String(error.message || error).slice(0, 500) }) + '\n');
  }
}

function settleResponse(requestId, status, body) {
  let parsed = null;
  try {
    parsed = JSON.parse(body.toString('utf8'));
  } catch (error) {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object') {
    const raw = parsed.total_cost_usd ?? parsed.cost_usd;
    const cost = typeof raw === 'number' ? String(raw) : (typeof raw === 'string' ? raw : '');
    if (cost && /^[0-9]+(?:\.[0-9]+)?$/.test(cost)) {
      settle(requestId, cost, 'provider-response', '');
      return;
    }
    if (parsed.usage && typeof parsed.usage === 'object') {
      settle(requestId, '', '', 'usageWithoutCost');
      return;
    }
  }
  settle(requestId, '', '', status >= 400 ? 'providerErrorWithoutCost' : 'responseWithoutCost');
}

function respond(res, status, headers, body) {
  const output = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (!HOP.has(key.toLowerCase())) output[key] = value;
  }
  output['content-type'] = output['content-type'] || 'application/json';
  res.writeHead(status, output);
  res.end(body);
}

function refuse(res, requestId, reason) {
  const body = Buffer.from(JSON.stringify({
    type: 'error',
    error: { type: 'credit_admission_refused', message: reason },
    request_id: requestId,
  }));
  respond(res, 402, { 'content-type': 'application/json' }, body);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('error', () => {
    if (!res.headersSent) respond(res, 400, { 'content-type': 'application/json' },
                                  Buffer.from(JSON.stringify({ error: 'request stream failed' })));
  });
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    // The launch token binds the request to its attempt, account and session.
    // A client that retries a logical request supplies x-baton-request-id so a
    // repeated id is recognised; the harness does not send it, so its requests
    // take a fresh id and replay detection does not apply to them.
    const header = req.headers['x-baton-request-id'];
    const requestId = typeof header === 'string' && header.length > 0 && header.length <= 200
      ? header : randomUUID();
    const targetPath = splitPath(req.url || '/');
    let verdict;
    try {
      verdict = admit(requestId, targetPath.token);
    } catch (error) {
      respond(res, 502, { 'content-type': 'application/json' },
              Buffer.from(JSON.stringify({ error: { type: 'credit_admission_host_failure',
                                                    message: String(error.message || error).slice(0, 500) } })));
      return;
    }
    if (!verdict.startsWith('admitted ')) {
      refuse(res, requestId, verdict.replace(/^refused\s*/, '') || 'creditAdmissionUnavailable');
      return;
    }
    const transport = target.protocol === 'https:' ? https : http;
    const path = targetPath.path;
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!HOP.has(key.toLowerCase())) headers[key] = value;
    }
    headers.host = target.host;
    const forwarded = transport.request({
      protocol: target.protocol, hostname: target.hostname, port: target.port,
      method: req.method, path, headers,
    }, (upstreamResponse) => {
      const out = [];
      upstreamResponse.on('data', (chunk) => out.push(chunk));
      upstreamResponse.on('error', () => {
        settle(requestId, '', '', 'upstreamResponseFailure');
        if (!res.headersSent) respond(res, 502, { 'content-type': 'application/json' },
                                      Buffer.from(JSON.stringify({ error: 'upstream response failed' })));
      });
      upstreamResponse.on('end', () => {
        const responseBody = Buffer.concat(out);
        settleResponse(requestId, upstreamResponse.statusCode || 0, responseBody);
        if (!res.headersSent) respond(res, upstreamResponse.statusCode || 502, upstreamResponse.headers, responseBody);
      });
    });
    forwarded.on('error', (error) => {
      settle(requestId, '', '', 'upstreamFailure: ' + String(error.code || error.message || error).slice(0, 200));
      if (!res.headersSent) respond(res, 502, { 'content-type': 'application/json' },
                                    Buffer.from(JSON.stringify({ error: { type: 'upstream_failure',
                                                                          message: String(error.code || 'connect failed') } })));
    });
    forwarded.end(body);
  });
});

server.on('clientError', (error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(listen, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write('LISTEN http://127.0.0.1:' + address.port + '\n');
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
