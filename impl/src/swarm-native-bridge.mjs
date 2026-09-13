// swarm-native-bridge.mjs — one deployment-owned loopback bridge that lets a native harness
// participant call ITS orchestrator's live SwarmRuntime instance under its OWN bounded identity.
//
// Authority model (never violated by a request):
//   • Each issued token is bound to exactly one {swarmId, participantId, runId} scope.
//   • The principal ({actor, principalId, sessionId}) and the context ({runId}) are minted HERE
//     from the token table on every call. A request body can never choose them — the closed arg
//     schemas below refuse identity-shaped fields (runId/principal/session) before any effect.
//   • Actual authority is DERIVED on every dispatch: the bridge forwards the command to the
//     deployment-provided `dispatch` (the live SwarmRuntime.command), which validates current
//     membership, the per-event/per-command grants, and the author rules. The bridge owns NO
//     permission model, keeps NO event allowlist of its own, and never acquires owner credentials.
//   • Refusals: unknown/revoked tokens, cross-swarm args, and schema-invalid requests are refused
//     at the bridge; every runtime refusal passes through verbatim (message, code, detail).
//
// Command admission uses swarm-contract.mjs. Runtime membership and grants govern effects.
//
// Transport: loopback HTTP (127.0.0.1, ephemeral port) rather than a Unix socket. Rationale:
// portable on every supported platform (Windows has no portable UDS-over-HTTP story), directly
// usable by native agents through curl or the module's own node CLI entry, and the authority
// boundary is the bearer token in the Authorization header — never the URL, never a log line.
// Tokens are 256-bit, returned exactly once by issue(), and never retained server-side (entries
// keep the sha256 digest only) nor returned by inspect().
//
// Frame bound: one JSON frame per direction is buffered in process memory; the byte ceiling is the
// existing `wire.frame` substrate row from limits.mjs (the one declared registry — no re-declared
// numbers), overridable per bridge instance with `maxFrameBytes` for smaller deployments. The
// resource reason: this is a substrate memory guard for the bridge process, not a worker cap.
//
// This module is executable as a client: `node swarm-native-bridge.mjs <swarm.command> [jsonArgs]`
// reads BATON_SWARM_BRIDGE_URL / BATON_SWARM_BRIDGE_TOKEN from the environment so a native
// participant can call `swarm.view` (availableActions) without worker/fence/pause ids.
// `--help` (family) and `<swarm.command> --help` (one command) render LOCALLY from the shared
// contract definitions — no credential is read, so help works before any token is issued.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { pathToFileURL } from 'node:url';
import { FRAME_LIMITS, composeFrameLimitRefusal } from './limits.mjs';

import { SWARM_COMMAND_NAMES as SWARM_COMMANDS, SWARM_COMMAND_DEFINITIONS,
  SWARM_COMMAND_ROWS, SWARM_COMMAND_SCHEMAS, swarmCommandFieldSummary,
  validateSwarmCommand as validateSwarmCommandArgs } from './swarm-contract.mjs';
import { swarmUpdatePayloadDetails } from './swarm-event-schemas.mjs';
export { SWARM_COMMANDS, validateSwarmCommandArgs };
const isId = (value) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,256}$/u.test(value);

// ── the bridge ───────────────────────────────────────────────────────────────────────────────────

export const SWARM_BRIDGE_ENV_KEYS = Object.freeze({
  url: 'BATON_SWARM_BRIDGE_URL',
  token: 'BATON_SWARM_BRIDGE_TOKEN',
  swarmId: 'BATON_SWARM_BRIDGE_SWARM_ID',
  participantId: 'BATON_SWARM_BRIDGE_PARTICIPANT_ID',
  runId: 'BATON_SWARM_BRIDGE_RUN_ID',
});
const DEFAULT_FRAME_ROW = FRAME_LIMITS['wire.frame'];
const BRIDGE_ERROR_STATUS = Object.freeze({
  swarm_bridge_request_invalid: 400,
  swarm_bridge_scope_invalid: 400,
  swarm_command_invalid: 400,
  swarm_command_unavailable: 404,
  swarm_bridge_token_invalid: 401,
  swarm_bridge_swarm_mismatch: 403,
  swarm_bridge_frame_exceeded: 413,
  swarm_bridge_closed: 503,
  swarm_bridge_listen_failed: 500,
  swarm_bridge_unreachable: 502,
});

const bridgeError = (message, code, detail = {}) => Object.assign(new Error(message), { code, detail });
const digestToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

function scopeIdentity(field, value) {
  if (!isId(value)) {
    throw bridgeError(`Swarm bridge scope requires a usable ${field}`, 'swarm_bridge_scope_invalid', { field });
  }
  return value;
}

function frameRow(maxFrameBytes) {
  // The override keeps the registry row's lane/class identity; only the deployment's smaller
  // ceiling changes. There is no invented lane and no invented number outside the registry.
  return Object.freeze(maxFrameBytes === DEFAULT_FRAME_ROW.value
    ? DEFAULT_FRAME_ROW : { ...DEFAULT_FRAME_ROW, value: maxFrameBytes });
}

function bearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/u.exec(header);
  return match ? match[1] : null;
}

async function readBody(req, limitBytes, refusal) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limitBytes) {
      req.destroy();
      throw refusal(total, 'request');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, status, payload) {
  if (res.writableEnded || res.destroyed) return;
  let body;
  try { body = Buffer.from(JSON.stringify(payload), 'utf8'); }
  catch { body = Buffer.from('{"ok":false,"error":{"message":"Swarm bridge response was not representable","code":"swarm_bridge_request_invalid","detail":{}}}', 'utf8'); }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length });
  res.end(body);
}

function errorPayload(error) {
  const message = typeof error?.message === 'string' ? error.message : String(error);
  const code = typeof error?.code === 'string' ? error.code : 'swarm_bridge_dispatch_failed';
  let detail = error?.detail ?? {};
  try { JSON.stringify(detail); } catch { detail = {}; }
  return { message, code, detail };
}

/** Create the deployment-owned bridge host. `dispatch` is the live SwarmRuntime entry:
 * `dispatch({command, args, principal, context})` -> result (throws typed refusals). */
export function createSwarmNativeBridge({
  dispatch,
  host = '127.0.0.1',
  port = 0,
  maxFrameBytes = DEFAULT_FRAME_ROW.value,
} = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('createSwarmNativeBridge requires a dispatch function');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new TypeError('swarm bridge transport is loopback-only');
  }
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
    throw new TypeError('swarm bridge maxFrameBytes must be a positive safe integer');
  }
  const row = frameRow(maxFrameBytes);
  const frameRefusal = (actual, direction) => bridgeError(
    composeFrameLimitRefusal(row, actual),
    'swarm_bridge_frame_exceeded',
    {
      lane: row.lane, class: row.class, value: row.value, unit: row.unit, actual, direction,
      resourceReason: 'the bridge buffers exactly one JSON frame per direction in process memory; the shared wire.frame substrate row bounds that buffer, it is not a worker cap',
    },
  );

  // Server-side capability entries hold the token DIGEST only; the raw token exists solely in
  // the issue() return value handed to the deployment for env injection.
  const tokens = new Map(); // digest -> {swarmId, participantId, runId, principalId, actor, sessionId, digest, issuedAt}
  let closed = false;
  let closePromise = null;

  const server = createServer((req, res) => {
    handle(req, res).catch(() => sendJson(res, 500, { ok: false, error: errorPayload({ message: 'Swarm bridge request failed', code: 'swarm_bridge_dispatch_failed', detail: {} }) }));
  });
  let readyResolve; let readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  server.once('error', (error) => readyReject(Object.assign(error, { code: 'swarm_bridge_listen_failed' })));
  server.listen(port, host, () => {
    server.on('error', () => { /* post-listen socket noise on a private loopback listener is non-fatal */ });
    readyResolve();
  });

  const endpoint = () => {
    if (!server.listening) return null;
    const address = server.address();
    const shown = host === '::1' ? `[${address.address}]` : address.address;
    return `http://${shown}:${address.port}/`;
  };
  const tokenRefusal = () => bridgeError('This swarm bridge token is not active', 'swarm_bridge_token_invalid');

  async function handle(req, res) {
    let digest = null;
    try {
      if (closed) throw bridgeError('This swarm bridge is closed', 'swarm_bridge_closed');
      if (req.method !== 'POST') {
        throw bridgeError('Swarm bridge accepts POST command requests only', 'swarm_bridge_request_invalid', { method: req.method });
      }
      const token = bearerToken(req.headers.authorization);
      digest = token ? digestToken(token) : null;
      const entry = digest ? tokens.get(digest) : null;
      if (!entry) {
        throw tokenRefusal();
      }
      const declared = Number(req.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxFrameBytes) throw frameRefusal(declared, 'request');
      const raw = await readBody(req, maxFrameBytes, frameRefusal);
      if (!tokens.has(digest)) throw tokenRefusal();
      let request;
      try { request = JSON.parse(raw.toString('utf8')); } catch {
        throw bridgeError('Swarm bridge request body must be one JSON object', 'swarm_bridge_request_invalid');
      }
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw bridgeError('Swarm bridge request body must be one JSON object', 'swarm_bridge_request_invalid');
      }
      const { command, args } = request;
      if (typeof command !== 'string' || command.length === 0) {
        throw bridgeError('Swarm bridge request must name a command', 'swarm_bridge_request_invalid');
      }
      // Contract admission BEFORE any runtime effect: closed key set + field predicates. This also
      // refuses identity-shaped fields — only the token table mints principal and context below.
      validateSwarmCommandArgs(command, args);
      // The token's single-swarm scope: every command whose schema names swarmId must name THIS one.
      if (SWARM_COMMAND_SCHEMAS[command].required.includes('swarmId') && args.swarmId !== entry.swarmId) {
        throw bridgeError('This swarm bridge token is bound to another swarm', 'swarm_bridge_swarm_mismatch',
          { requested: typeof args.swarmId === 'string' ? args.swarmId : null, authorized: entry.swarmId });
      }
      // Identity is minted HERE only. Nothing in the request can choose principal or context.
      const principal = Object.freeze({ actor: entry.actor, principalId: entry.principalId, sessionId: entry.sessionId });
      const context = Object.freeze({ runId: entry.runId, swarmId: entry.swarmId, participantId: entry.participantId });
      const result = await dispatch({ command, args, principal, context });
      const payload = Buffer.from(JSON.stringify({ ok: true, result: result ?? null }), 'utf8');
      if (payload.length > maxFrameBytes) throw frameRefusal(payload.length, 'response');
      sendJson(res, 200, JSON.parse(payload.toString('utf8')));
    } catch (error) {
      const payload = errorPayload(error);
      const status = BRIDGE_ERROR_STATUS[payload.code]
        ?? (payload.code === 'swarm_bridge_dispatch_failed' ? 500 : 422); // runtime-owned refusals pass through as 422
      sendJson(res, status, { ok: false, error: payload });
    }
  }

  return Object.freeze({
    ready: () => ready,
    get endpoint() { return endpoint(); },
    async issue({ swarmId, participantId, runId } = {}) {
      if (closed) throw bridgeError('This swarm bridge is closed', 'swarm_bridge_closed');
      scopeIdentity('swarmId', swarmId);
      scopeIdentity('participantId', participantId);
      scopeIdentity('runId', runId);
      try { await ready; }
      catch (cause) {
        throw bridgeError('Swarm bridge listener is unavailable', 'swarm_bridge_listen_failed', { cause: String(cause?.message ?? cause) });
      }
      // close() may land while issue() awaited the listener; recheck before minting anything.
      if (closed) throw bridgeError('This swarm bridge is closed', 'swarm_bridge_closed');
      const url = endpoint();
      const token = randomBytes(32).toString('base64url');
      const digest = digestToken(token);
      const principalId = `swarm-native:${participantId}`; // distinct from `worker:<id>` seat principals
      const actor = `swarm-native:${swarmId}:${participantId}`;
      const sessionId = `swarm-bridge:${digest.slice(0, 16)}`;
      const issuedAt = new Date().toISOString();
      tokens.set(digest, { swarmId, participantId, runId, principalId, actor, sessionId, digest, issuedAt });
      // RuntimeIsolation strips secret-named vars from inherited baseEnv, so the deployment merges
      // this env AFTER isolation.create() — see docs/audits/2026-09-13-runtime-policy/native-swarm-access.md.
      const env = Object.freeze({
        [SWARM_BRIDGE_ENV_KEYS.url]: url,
        [SWARM_BRIDGE_ENV_KEYS.token]: token,
        [SWARM_BRIDGE_ENV_KEYS.swarmId]: swarmId,
        [SWARM_BRIDGE_ENV_KEYS.participantId]: participantId,
        [SWARM_BRIDGE_ENV_KEYS.runId]: runId,
      });
      // The receipt is the non-secret correlation view for guidance and audit surfaces.
      const receipt = Object.freeze({
        swarmId, participantId, runId, principalId, sessionId, tokenDigest: digest, issuedAt,
        endpoint: url, frameBytes: maxFrameBytes, transport: 'http-loopback',
      });
      return Object.freeze({ token, env, receipt });
    },
    revoke(scope) {
      const before = tokens.size;
      const drop = (digest) => { tokens.delete(digest); };
      if (typeof scope === 'string') {
        drop(digestToken(scope));
      } else if (scope && typeof scope === 'object') {
        for (const entry of [...tokens.values()]) {
          if (Object.entries(scope).every(([field, value]) => entry[field] === value)) drop(entry.digest);
        }
      } else if (scope !== undefined) {
        throw bridgeError('Swarm bridge revoke expects a token string or a scope object', 'swarm_bridge_scope_invalid');
      }
      return { revoked: before - tokens.size, activeRemaining: tokens.size };
    },
    inspect() {
      // Deployment-facing capability view. Entries hold digests only — there is NO token here.
      return Object.freeze({
        endpoint: closed ? null : endpoint(),
        frameBytes: maxFrameBytes, transport: 'http-loopback', closed,
        commands: SWARM_COMMANDS,
        capabilities: Object.freeze([...tokens.values()].map((entry) => Object.freeze({
          swarmId: entry.swarmId, participantId: entry.participantId, runId: entry.runId,
          principalId: entry.principalId, sessionId: entry.sessionId, actor: entry.actor,
          tokenDigest: entry.digest, issuedAt: entry.issuedAt, state: 'active',
        }))),
      });
    },
    async close() {
      if (closePromise) return closePromise;
      closePromise = (async () => {
      closed = true;
      const revokedTotal = tokens.size;
      tokens.clear();
      await ready.catch(() => { /* a failed listener still closes cleanly */ });
      server.closeIdleConnections?.();
      await new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
        // Remaining sockets belong to THIS listener only; dropping them bounds shutdown without
        // touching any worker, coordinator, or unrelated process.
        server.closeAllConnections?.();
      });
      return { closed: true, revokedTotal, activeRemaining: 0 };
      })();
      return closePromise;
    },
  });
}

/** Minimal client for native scripts: one command against the bridge, identity carried by the
 * environment. Returns the runtime result; throws Error with {code, detail, status} on refusal. */
export async function swarmBridgeCommand({ command, args = {}, endpoint, token } = {}, { env = process.env } = {}) {
  if (typeof command !== 'string' || command.length === 0) {
    throw bridgeError('A swarm command is required', 'swarm_bridge_request_invalid');
  }
  const url = endpoint ?? env[SWARM_BRIDGE_ENV_KEYS.url];
  const secret = token ?? env[SWARM_BRIDGE_ENV_KEYS.token];
  if (typeof url !== 'string' || url.length === 0) {
    throw bridgeError(`Swarm bridge endpoint is missing; set ${SWARM_BRIDGE_ENV_KEYS.url}`, 'swarm_bridge_request_invalid');
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw bridgeError(`Swarm bridge token is missing; set ${SWARM_BRIDGE_ENV_KEYS.token}`, 'swarm_bridge_request_invalid');
  }
  let target;
  try { target = new URL(url); }
  catch { throw bridgeError('Swarm bridge endpoint URL is invalid', 'swarm_bridge_request_invalid', { endpoint: url }); }
  const body = Buffer.from(JSON.stringify({ command, args }), 'utf8');
  const response = await new Promise((resolve, reject) => {
    const req = httpRequest({
      protocol: target.protocol, hostname: target.hostname, port: target.port,
      path: `${target.pathname}${target.search}`, method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': body.length,
        authorization: `Bearer ${secret}`,
      },
    }, resolve);
    req.on('error', (cause) => reject(bridgeError('Swarm bridge endpoint is unreachable', 'swarm_bridge_unreachable', { cause: String(cause?.message ?? cause) })));
    req.end(body);
  });
  const raw = await new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    response.on('data', (chunk) => {
      total += chunk.length;
      if (total > DEFAULT_FRAME_ROW.value) {
        response.destroy();
        reject(bridgeError(composeFrameLimitRefusal(DEFAULT_FRAME_ROW, total), 'swarm_bridge_frame_exceeded', { direction: 'response' }));
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => resolve(Buffer.concat(chunks)));
    response.on('error', (cause) => reject(bridgeError('Swarm bridge response failed', 'swarm_bridge_unreachable', { cause: String(cause?.message ?? cause) })));
  });
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch {
    throw bridgeError('Swarm bridge response was not JSON', 'swarm_bridge_request_invalid', { status: response.statusCode });
  }
  if (payload?.ok === true) return payload.result;
  const error = errorPayload(payload?.error ?? {});
  throw Object.assign(new Error(error.message), { code: error.code, detail: error.detail, status: response.statusCode });
}

const HELP_FLAGS = new Set(['--help', '-h', 'help']);

/** Local help text, rendered from the ONE shared contract (rows, schemas, event descriptions) —
 * the CLI keeps no command registry of its own. `command === null` renders the family view. */
function bridgeHelpText(command = null) {
  if (!command) {
    return [
      'Usage: node swarm-native-bridge.mjs <swarm.command> [json-args]',
      '',
      'Commands:',
      ...SWARM_COMMANDS.map((name) => `  ${name.padEnd(14)} ${SWARM_COMMAND_ROWS.find((row) => row.command === name)?.description ?? ''}`),
      '',
      'Per-command help: node swarm-native-bridge.mjs <swarm.command> --help',
      '',
      `Identity comes from the environment: ${SWARM_BRIDGE_ENV_KEYS.url} and ${SWARM_BRIDGE_ENV_KEYS.token}`,
      `are required for real calls; ${SWARM_BRIDGE_ENV_KEYS.swarmId} auto-fills the swarmId argument.`,
      'Help itself needs none of them — it renders locally from the shared command contract.',
      'Effectful commands mint an idempotencyKey when you omit one; the minted key is printed back as',
      'commandReceipt.idempotencyKey so a retry can pass that key explicitly; result fields stay at the top level.',
    ].join('\n');
  }
  const row = SWARM_COMMAND_ROWS.find((entry) => entry.command === command);
  const lines = [
    `${command} — ${row?.description ?? ''}`,
    '',
    "Arguments (one JSON object):",
  ];
  for (const { field, required, expectation } of swarmCommandFieldSummary(command)) {
    if (field === 'payload') {
      lines.push(`  payload${required ? '' : ' (optional)'} — per-event shapes:`);
      lines.push(...swarmUpdatePayloadDetails().split('\n').map((line) => `    ${line}`));
      continue;
    }
    const notes = [];
    if (field === 'swarmId') notes.push(`auto-filled from ${SWARM_BRIDGE_ENV_KEYS.swarmId}`);
    if (field === 'idempotencyKey') notes.push('minted per call when omitted; pass it back explicitly to make a retry idempotent');
    lines.push(`  ${field}${required ? '' : ' (optional)'} — ${expectation}${notes.length > 0 ? `; ${notes.join('; ')}` : ''}`);
  }
  lines.push('', `Usage: node swarm-native-bridge.mjs ${command} '<json-args>'`);
  return lines.join('\n');
}

/** CLI entry so a native agent can invoke a bridge command directly from its own shell:
 * `node swarm-native-bridge.mjs swarm.view '{"swarmId":"..."}'` with the bridge env set. */
export async function swarmBridgeMain(argv = process.argv.slice(2), env = process.env, io = { out: process.stdout, err: process.stderr }) {
  const [command, argsText] = argv;
  let mintedKey = null;
  try {
    const helpRequested = argv.some((argument) => HELP_FLAGS.has(argument));
    if (helpRequested) {
      // Local rendering only: no endpoint lookup, no token read, no network. This is the path a
      // freshly recruited agent takes BEFORE it understands its own environment.
      const target = argv.find((argument) => !HELP_FLAGS.has(argument) && argument !== undefined);
      if (target !== undefined && !SWARM_COMMANDS.includes(target)) {
        throw bridgeError(`Unknown swarm command ${target}; run node swarm-native-bridge.mjs --help for the command list`,
          'swarm_command_unavailable', { command: target });
      }
      io.out.write(`${bridgeHelpText(target ?? null)}\n`);
      return 0;
    }
    if (command === undefined) {
      throw bridgeError(`Usage: node swarm-native-bridge.mjs <swarm.command> [json-args]; env ${SWARM_BRIDGE_ENV_KEYS.url} and ${SWARM_BRIDGE_ENV_KEYS.token} are required (try --help)`, 'swarm_bridge_request_invalid');
    }
    let args = {};
    if (argsText !== undefined) {
      try { args = JSON.parse(argsText); }
      catch { throw bridgeError('Swarm bridge CLI args must be one JSON object', 'swarm_bridge_request_invalid', { args: argsText }); }
    }
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      throw bridgeError('Swarm bridge CLI args must be one JSON object', 'swarm_bridge_request_invalid', { command });
    }
    const definition = SWARM_COMMAND_DEFINITIONS[command];
    if (definition?.args.includes('swarmId') && args.swarmId === undefined) {
      args.swarmId = env[SWARM_BRIDGE_ENV_KEYS.swarmId];
    }
    if (definition?.mcpStateful && args.idempotencyKey === undefined) {
      mintedKey = randomUUID();
      args.idempotencyKey = mintedKey;
    }
    const result = await swarmBridgeCommand({ command, args }, { env });
    // A caller-supplied key keeps the exact historical output; a minted key is printed back as
    // additive receipt metadata so a retry can name it (replay dedupe itself stays the runtime's).
    io.out.write(mintedKey !== null
      ? `${JSON.stringify({ ...result, commandReceipt: { idempotencyKey: mintedKey } }, null, 2)}\n`
      : `${JSON.stringify(result, null, 2)}\n`);
    return 0;
  } catch (error) {
    const payload = errorPayload(error);
    io.err.write(`${JSON.stringify({ ok: false, error: payload,
      ...(mintedKey === null ? {} : { commandReceipt: { idempotencyKey: mintedKey } }),
    }, null, 2)}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) swarmBridgeMain().then((code) => { process.exitCode = code; });
