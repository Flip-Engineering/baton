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
//   • Refusals: unknown/revoked tokens, cross-swarm args, and schema-invalid
//     requests are refused at the bridge; every runtime refusal passes through verbatim (message,
//     code, detail). Every refusal the BRIDGE raises states in its FIRST LINE that nothing was
//     recorded and what to change, and is reported to the runtime's durable refusal lane
//     (swarm.operation_refused) through the one channel the bridge has — `dispatch`. A refusal a
//     participant could only learn by retrying would be invisible to its orchestrator; instead the
//     participant's row carries it as `lastRefusal` until a later operation of the same command
//     succeeds, and a watcher wakes on the row.
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
// Frames: one JSON frame per direction is buffered in process memory and answered WHOLE — a request
// body is read to its end before it is parsed, and the answer a dispatched command produced is
// written as it is: never cut, never thinned, never refused for its size. The client below buffers
// the whole answer for the same reason, so the frame a caller reads is the frame the bridge wrote.
//
// This module is executable as a client: `node swarm-native-bridge.mjs <swarm.command> [jsonArgs]`
// reads BATON_SWARM_BRIDGE_URL / BATON_SWARM_BRIDGE_TOKEN from the environment so a native
// participant can call `swarm.view` (availableActions) without worker/fence/pause ids.
// `--help` (family) and `<swarm.command> --help` (one command) render LOCALLY from the shared
// contract definitions — no credential is read, so help works before any token is issued.

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { pathToFileURL } from 'node:url';

import { SWARM_COMMAND_NAMES as SWARM_COMMANDS, SWARM_COMMAND_DEFINITIONS,
  SWARM_COMMAND_ROWS, SWARM_COMMAND_SCHEMAS, SWARM_VIEW_PROJECTION_NAMES,
  SWARM_EVENT_KINDS, SWARM_BRIDGE_TRANSPORT,
  SWARM_BRIDGE_REFUSAL_COMMAND, SWARM_KNOWLEDGE_COMMANDS, SWARM_KNOWLEDGE_COMMAND_NAMES,
  swarmCommandFieldSummary, swarmIdentityKeyedCommand,
  swarmKnowledgeCommand,
  validateSwarmCommand as validateSwarmCommandArgs } from './swarm-contract.mjs';
import { EVIDENCE_SEARCH_FILTERS, EVIDENCE_SEARCH_INPUT_SCHEMA } from './evidence-search.mjs';
import { WAKE_CLASSES } from './wake-stream.mjs';
// The knowledge verbs' and the seat read verbs' shape validators run at the runtime's command
// entry; the bridge reads the verb tables for its swarmId fill, its help and its routing.
import { SWARM_PERMISSIONS,
  swarmSeatReadCommand, SWARM_SEAT_READ_COMMAND_NAMES, SWARM_SEAT_READ_COMMANDS } from './swarm-runtime.mjs';
import { canonicalOperationForCommand, knowledgeSeedPayloadLines } from './application-semantics.mjs';
// Issue #496: the shared ID validator (Decision 8 — the 256-byte bound and character class are
// declared once in application-observation.mjs and read here, never re-declared).
import { validId } from './application-observation.mjs';
import { swarmUpdatePayloadDetails } from './swarm-event-schemas.mjs';
export { SWARM_COMMANDS, validateSwarmCommandArgs, SWARM_KNOWLEDGE_COMMAND_NAMES, SWARM_SEAT_READ_COMMAND_NAMES };

// ── the bridge ───────────────────────────────────────────────────────────────────────────────────

export const SWARM_BRIDGE_ENV_KEYS = Object.freeze({
  url: 'BATON_SWARM_BRIDGE_URL',
  token: 'BATON_SWARM_BRIDGE_TOKEN',
  swarmId: 'BATON_SWARM_BRIDGE_SWARM_ID',
  participantId: 'BATON_SWARM_BRIDGE_PARTICIPANT_ID',
  runId: 'BATON_SWARM_BRIDGE_RUN_ID',
  // Issue #529 (docs/54 §4.1): the wake narrowing this seat's session auto-subscribes with,
  // published beside its swarm coordinates. Absent means the session carries its swarm's whole
  // stream — the same default a session with no coordinates has deployment-wide.
  autoWake: 'BATON_SWARM_BRIDGE_AUTOWAKE',
});
const BRIDGE_ERROR_STATUS = Object.freeze({
  swarm_bridge_request_invalid: 400,
  swarm_bridge_scope_invalid: 400,
  swarm_command_invalid: 400,
  swarm_command_unavailable: 404,
  swarm_bridge_token_invalid: 401,
  swarm_bridge_swarm_mismatch: 403,
  swarm_bridge_closed: 503,
  swarm_bridge_listen_failed: 500,
  swarm_bridge_unreachable: 502,
});

const bridgeError = (message, code, detail = {}) => Object.assign(new Error(message), { code, detail });
const digestToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

function scopeIdentity(field, value) {
  if (!validId(value)) {
    throw bridgeError(`Swarm bridge scope requires a usable ${field}`, 'swarm_bridge_scope_invalid', { field });
  }
  return value;
}

// ── the bridge's own refusals ────────────────────────────────────────────────────────────────────
// A refusal the BRIDGE raises says in its FIRST LINE that nothing was recorded and what to change;
// the runtime's own refusal follows on the next line, unchanged. Every bridge refusal is also
// reported to the runtime's durable refusal lane (`swarm.operation_refused`), so a participant's
// orchestrator learns about it from the swarm itself and the participant's row carries it as
// `lastRefusal` until a later operation of the same command succeeds — a refusal a caller could
// only learn by retrying would otherwise be invisible to everyone who needs it.
export const SWARM_BRIDGE_NOTHING_RECORDED = 'Nothing was recorded:';

/** The bridge's own guidance for the participant-facing Swarm section (issue #309): where the
 * bridge lives (variable NAMES, never their values), the request shape, what a success answers,
 * and what a refusal looks like. Derived from the same constants the bridge enforces, so the
 * text a brief renders cannot drift from the bridge's behaviour; swarm-native-access.mjs joins
 * it beside SWARM_NATIVE_GUIDANCE as the one derivation of the section. */
export const SWARM_BRIDGE_GUIDANCE = [
  `The bridge is located by environment variable NAMES only — ${SWARM_BRIDGE_ENV_KEYS.url}, ${SWARM_BRIDGE_ENV_KEYS.token}, ${SWARM_BRIDGE_ENV_KEYS.swarmId}, ${SWARM_BRIDGE_ENV_KEYS.participantId}, ${SWARM_BRIDGE_ENV_KEYS.runId} (and ${SWARM_BRIDGE_ENV_KEYS.autoWake} carries the wake narrowing this seat's session opened its subscription with). Read them; never print their values: the token variable carries your private credential.`,
  `A request is one JSON document, {"command":"swarm.update","args":{...}}, POSTed to the bridge URL with the bearer token from the token variable; the client wrapper does this for you — node "$BATON_SWARM_CLIENT" swarm.update '{"event":"...","payload":{...}}'. Arguments are checked against closed schemas, so an unknown field refuses.`,
  'A success answers {"ok":true,"result":...}. swarm.update answers the refreshed view: the contribution it recorded is in it, carrying the seq of the event that recorded it — read the answer and confirm the recorded seq before you call the work published.',
  `A refusal answers {"ok":false,"error":{"message","code","detail"}} on the same stream, and its message begins "${SWARM_BRIDGE_NOTHING_RECORDED}" followed by what to change. node "$BATON_SWARM_CLIENT" --help renders the full command help locally, before any credential is read.`,
  // Issue #347: the fact a seat needs before it reaches for a tracker command — its own runtime
  // carries no tracker credential, and the issue text its brief cites is resolved for it.
  'Your runtime carries no tracker credential. The issue text a brief cites rides that brief: the deployment resolves the issues a recruit names through the host\'s own credential before the brief composes.',
].join('\n\n');

/** What the caller must change, from the refusal's own rule: the closed argument vocabulary
 * already names the field and its expectation, and the runtime's dispatch decisions ship their own
 * `correction`. Never re-spelled per call site, so a new rule cannot land an unactionable refusal. */
function refusalChange(detail) {
  const field = typeof detail?.field === 'string' ? detail.field : null;
  switch (detail?.rule) {
    case 'unknown-field': return `remove ${field}`;
    case 'required-field': return `add ${(Array.isArray(detail.required) && detail.required.length > 1
      ? detail.required : [field]).join(', ')} (${detail.expectation ?? 'a value'})`;
    case 'field-predicate': return `${field} must be ${detail.expectation ?? 'a valid value'}`;
    case 'closed-set': return `${field} must be ${detail.expectation ?? 'one of the values this command accepts'}`;
    case 'payload-required': return `send a payload object naming ${(detail.required ?? []).join(', ')}`;
    case 'payload-unknown-field': return `remove ${field}`;
    case 'payload-field-required': return `add ${field} (${detail.expectation ?? 'a value'})`;
    case 'identity-keyed': return 'drop idempotencyKey — this command takes its identity from its coordinates';
    case 'arguments-shape': return 'send one JSON object as the request arguments';
    case 'request-shape': return 'send one JSON object naming a command and its arguments';
    case 'bridge-token': return 'use an active bridge token for this participant';
    case 'bridge-method': return 'send the request as POST';
    case 'bridge-closed': return 'the bridge is closed; no request can be admitted';
    case 'bridge-scope': return 'use the swarm this bridge token is bound to';
    default: return typeof detail?.correction === 'string' && detail.correction.length > 0
      ? detail.correction : 'no swarm state changed';
  }
}

/** A refusal the bridge itself raises: first line = nothing was recorded + the change to make. */
function bridgeRefusal(message, code, detail = {}) {
  return bridgeError(`${SWARM_BRIDGE_NOTHING_RECORDED} ${refusalChange(detail)}\n${message}`, code, detail);
}

/** A handler that threw (carried into #457 from #458): the bridge answers
 * `swarm_bridge_dispatch_failed` naming the error CLASS and the cause's own text — never a bare
 * catch-all that hides what broke — and the refusal lane records the crash as
 * `bridge.handler_threw`, so a seat and its root can tell a typed runtime refusal from a defect in
 * the bridge's own dispatch. The text crosses whole: a crash is the one diagnostic a caller gets,
 * and the cause it names is exactly what a thinned text would hide. */
function handlerThrew(cause) {
  const errorClass = cause instanceof Error && typeof cause.name === 'string' && cause.name.length > 0
    ? cause.name : typeof cause;
  const crashMessage = (errorMessage) => `Swarm bridge dispatch failed (${errorClass}): ${errorMessage}`;
  const errorMessage = typeof cause?.message === 'string' && cause.message.length > 0
    ? cause.message : String(cause);
  return bridgeError(crashMessage(errorMessage), 'swarm_bridge_dispatch_failed',
    { rule: 'bridge.handler_threw', errorClass, errorMessage });
}

function bearerToken(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/u.exec(header);
  return match ? match[1] : null;
}

/** Read one request body WHOLE: the caller's frame is buffered as it arrives and handed back as one
 * document once the stream ends. Nothing refuses it for its size, and nothing is discarded. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => { chunks.push(chunk); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (cause) => reject(cause));
  });
}

/** Write one JSON envelope. `onFlushed` runs once the response has been handed to the socket —
 * the one place a request the bridge refused may be destroyed, never before its refusal is out. */
function sendJson(res, status, payload, onFlushed = null) {
  if (res.writableEnded || res.destroyed) return;
  let body;
  try { body = Buffer.from(JSON.stringify(payload), 'utf8'); }
  catch { body = Buffer.from('{"ok":false,"error":{"message":"Swarm bridge response was not representable","code":"swarm_bridge_request_invalid","detail":{}}}', 'utf8'); }
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length });
  if (onFlushed) res.end(body, onFlushed); else res.end(body);
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
} = {}) {
  if (typeof dispatch !== 'function') throw new TypeError('createSwarmNativeBridge requires a dispatch function');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new TypeError('swarm bridge transport is loopback-only');
  }

  /** Report one refusal the BRIDGE raised to the runtime's own durable refusal lane, through the
   * one channel the bridge has (dispatch). The report is not a swarm command: `swarm-contract`
   * asserts that verb never becomes one, so no caller can submit it, and the runtime validates the
   * report before recording anything. A refusal the RUNTIME raised is never reported twice — it is
   * already recorded, and the bridge only relays it. */
  async function reportRefusal(attempt, error) {
    if (!attempt.entry || attempt.runtimeOwned) return true;
    const report = {
      transport: SWARM_BRIDGE_TRANSPORT,
      swarmId: attempt.entry.swarmId, participantId: attempt.entry.participantId, runId: attempt.entry.runId,
      command: attempt.command, event: typeof attempt.args?.event === 'string' ? attempt.args.event : null,
      code: typeof error?.code === 'string' && error.code.length > 0 ? error.code : null,
      field: typeof error?.detail?.field === 'string' ? error.detail.field : null,
      rule: typeof error?.detail?.rule === 'string' ? error.detail.rule : null,
    };
    if (report.code === null) return false;
    try {
      await dispatch({
        command: SWARM_BRIDGE_REFUSAL_COMMAND, args: report,
        principal: Object.freeze({ actor: attempt.entry.actor, principalId: attempt.entry.principalId, sessionId: attempt.entry.sessionId }),
        context: Object.freeze({ runId: attempt.entry.runId, swarmId: attempt.entry.swarmId, participantId: attempt.entry.participantId }),
      });
      return true;
    } catch { return false; }
  }

  // Server-side capability entries hold the token DIGEST only; the raw token exists solely in
  // the issue() return value handed to the deployment for env injection.
  const tokens = new Map(); // digest -> {swarmId, participantId, runId, principalId, actor, sessionId, digest, issuedAt}
  let closed = false;
  let closePromise = null;

  const server = createServer((req, res) => {
    // A handler that throws OUTSIDE handle()'s own catch is answered the same way a crashing
    // dispatch is — the class and its own text cross, never a bare catch-all. Nothing here is
    // attributable to a seat (no token resolved), so nothing is recorded about it.
    handle(req, res).catch((error) => sendJson(res, 500,
      { ok: false, error: errorPayload(handlerThrew(error)) }));
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
  const tokenRefusal = () => bridgeRefusal('This swarm bridge token is not active', 'swarm_bridge_token_invalid',
    { rule: 'bridge-token' });
  async function handle(req, res) {
    // What the refusal report needs about this attempt: the identity the token resolved to (null
    // until then — a request the bridge cannot attribute is not a refusal about a participant),
    // the command it named, and whether the RUNTIME owned the refusal.
    const attempt = { entry: null, command: null, args: null, runtimeOwned: false };
    try {
      if (closed) throw bridgeRefusal('This swarm bridge is closed', 'swarm_bridge_closed', { rule: 'bridge-closed' });
      if (req.method !== 'POST') {
        throw bridgeRefusal('Swarm bridge accepts POST command requests only', 'swarm_bridge_request_invalid',
          { method: req.method, rule: 'bridge-method' });
      }
      const token = bearerToken(req.headers.authorization);
      const digest = token ? digestToken(token) : null;
      const entry = digest ? tokens.get(digest) : null;
      if (!entry) {
        throw tokenRefusal();
      }
      attempt.entry = entry;
      const raw = await readBody(req);
      if (!tokens.has(digest)) throw tokenRefusal();
      let request;
      try { request = JSON.parse(raw.toString('utf8')); } catch {
        throw bridgeRefusal('Swarm bridge request body must be one JSON object', 'swarm_bridge_request_invalid',
          { rule: 'request-shape' });
      }
      if (!request || typeof request !== 'object' || Array.isArray(request)) {
        throw bridgeRefusal('Swarm bridge request body must be one JSON object', 'swarm_bridge_request_invalid',
          { rule: 'request-shape' });
      }
      const { command } = request;
      let args = request.args;
      if (typeof command !== 'string' || command.length === 0) {
        throw bridgeRefusal('Swarm bridge request must name a command', 'swarm_bridge_request_invalid',
          { rule: 'request-shape', field: 'command' });
      }
      attempt.command = command;
      attempt.args = args;
      // Contract admission BEFORE any runtime effect. The knowledge verbs (#318) and the seat read
      // verbs (#441 lane B) run the SAME validators the runtime's dispatch runs — closed keys,
      // canonical schemas, and the refusal of identity-shaped fields (runId/taskId are the
      // participant's own, minted from its token scope server-side, never caller-chosen). The
      // refusal is the CONTRACT's (one validator, one vocabulary); the bridge gives it the first
      // line every bridge refusal carries and reports it to the durable refusal lane below.
      try {
        if (swarmKnowledgeCommand(command) || swarmSeatReadCommand(command)) {
          // The token scope IS the swarm identity: an omitted swarmId is filled from the token
          // (the same rule the CLI client applies from the environment), a foreign one refuses.
          // Their shape validators run ONCE, at the runtime's command entry — the boundary that
          // accepts the request for every transport.
          if (args && typeof args === 'object' && !Array.isArray(args) && args.swarmId === undefined) {
            args = { ...args, swarmId: entry.swarmId };
          }
        } else {
          // Ordinary commands have no runtime-side shape validator: THIS is the accepting
          // boundary for every bridge-carried request, so the closed contract runs here.
          validateSwarmCommandArgs(command, args);
        }
      } catch (error) {
        throw bridgeRefusal(error.message, error.code ?? 'swarm_command_invalid', error.detail ?? {});
      }
      // The token's single-swarm scope: every command whose schema names swarmId must name THIS one.
      const needsSwarmScope = SWARM_COMMAND_SCHEMAS[command]
        ? SWARM_COMMAND_SCHEMAS[command].required.includes('swarmId')
        : swarmKnowledgeCommand(command) !== null || swarmSeatReadCommand(command) !== null;
      if (needsSwarmScope && args.swarmId !== entry.swarmId) {
        throw bridgeRefusal('This swarm bridge token is bound to another swarm', 'swarm_bridge_swarm_mismatch',
          { requested: typeof args.swarmId === 'string' ? args.swarmId : null, authorized: entry.swarmId, rule: 'bridge-scope' });
      }
      // Identity is minted HERE only. Nothing in the request can choose principal or context.
      const principal = Object.freeze({ actor: entry.actor, principalId: entry.principalId, sessionId: entry.sessionId });
      const context = Object.freeze({ runId: entry.runId, swarmId: entry.swarmId, participantId: entry.participantId });
      let result;
      try {
        result = await dispatch({ command, args, principal, context });
      } catch (error) {
        // A TYPED error is a refusal the RUNTIME raised: it is already on the durable refusal lane,
        // so the bridge relays it verbatim and never records a second row about it. Anything else
        // is this bridge's own handler crashing — a TypeError out of the runtime, a thrown string —
        // and it crosses typed, naming its class and its own text (never a bare catch-all), and
        // is recorded as `bridge.handler_threw`.
        if (typeof error?.code !== 'string' || error.code.length === 0) throw handlerThrew(error);
        attempt.runtimeOwned = true;
        throw error;
      }
      sendJson(res, 200, { ok: true, result: result ?? null });
    } catch (error) {
      const refusalRecorded = await reportRefusal(attempt, error);
      const payload = { ...errorPayload(error), ...(attempt.entry ? { refusalRecorded } : {}) };
      const status = BRIDGE_ERROR_STATUS[payload.code]
        ?? (payload.code === 'swarm_bridge_dispatch_failed' ? 500 : 422); // runtime-owned refusals pass through as 422
      const envelope = { ok: false, error: payload };
      sendJson(res, status, envelope);
    }
  }

  return Object.freeze({
    ready: () => ready,
    get endpoint() { return endpoint(); },
    async issue({ swarmId, participantId, runId, autoWake = null } = {}) {
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
      // Issue #529 (docs/54 §4.1): the declared wake narrowing, normalized to the axes it names —
      // the recruit already validated them against the wake stream's closed class set, so this is
      // a shape pass, never a second vocabulary. An empty declaration publishes no key.
      const wakeAxes = autoWake === null || typeof autoWake !== 'object' ? null
        : Object.freeze({
          ...(Array.isArray(autoWake.kinds) && autoWake.kinds.length > 0
            ? { kinds: Object.freeze([...autoWake.kinds]) } : {}),
          ...(Array.isArray(autoWake.participants) && autoWake.participants.length > 0
            ? { participants: Object.freeze([...autoWake.participants]) } : {}),
        });
      // RuntimeIsolation strips secret-named vars from inherited baseEnv, so the deployment merges
      // this env AFTER isolation.create() — see docs/audits/2026-09-13-runtime-policy/native-swarm-access.md.
      const env = Object.freeze({
        [SWARM_BRIDGE_ENV_KEYS.url]: url,
        [SWARM_BRIDGE_ENV_KEYS.token]: token,
        [SWARM_BRIDGE_ENV_KEYS.swarmId]: swarmId,
        [SWARM_BRIDGE_ENV_KEYS.participantId]: participantId,
        [SWARM_BRIDGE_ENV_KEYS.runId]: runId,
        // Issue #529 (docs/54 §4.1): the narrowing rides the environment the same way the seat's
        // own coordinates do, so the session's entry configures its subscription from what the
        // deployment published.
        ...(wakeAxes === null || Object.keys(wakeAxes).length === 0
          ? {} : { [SWARM_BRIDGE_ENV_KEYS.autoWake]: JSON.stringify(wakeAxes) }),
      });
      // The receipt is the non-secret correlation view for guidance and audit surfaces.
      const receipt = Object.freeze({
        swarmId, participantId, runId, principalId, sessionId, tokenDigest: digest, issuedAt,
        endpoint: url, transport: 'http-loopback',
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
        transport: 'http-loopback', closed,
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
    const chunks = [];
    response.on('data', (chunk) => { chunks.push(chunk); });
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
      'Usage: node swarm-native-bridge.mjs <swarm.command> [json-args | - reads the JSON payload from stdin]',
      '',
      'Commands:',
      ...SWARM_COMMANDS.map((name) => `  ${name.padEnd(14)} ${SWARM_COMMAND_ROWS.find((row) => row.command === name)?.description ?? ''}`),
      '',
      'Knowledge verbs (issue #318) — each names the ONE situation it is for; the permission that',
      'admits each is named on swarm.view `updates`:',
      ...SWARM_KNOWLEDGE_COMMAND_NAMES.map((name) => {
        const knowledge = SWARM_KNOWLEDGE_COMMANDS[name];
        return `  ${name.padEnd(24)} [${knowledge.permission}] ${knowledge.situation}`;
      }),
      '',
      'Seat read verbs (issue #441) — the reads a seated participant makes of the world it works',
      'in, each naming the ONE situation it is for; read-only, so only a refusal can come back:',
      ...SWARM_SEAT_READ_COMMAND_NAMES.map((name) => {
        const verb = SWARM_SEAT_READ_COMMANDS[name];
        return `  ${name.padEnd(24)} [${verb.permission}] ${verb.situation}`;
      }),
      '',
      'Per-command help: node swarm-native-bridge.mjs <swarm.command> --help',
      '',
      'Closed sets (every refusal that names one of these carries the admitted values in',
      'detail.admitted; a closed-set refusal reads "<field> must be one of: ..."):',
      `  swarm.view projection — one of: ${[...SWARM_VIEW_PROJECTION_NAMES].join(', ')}`,
      `  swarm.update event — one of: ${[...SWARM_EVENT_KINDS].join(', ')}`,
      `  wake classes — one of: ${[...WAKE_CLASSES].join(', ')}`,
      `  permissions — one of: ${[...SWARM_PERMISSIONS].join(', ')}`,
      `  evidence.search fields — one of: ${[...EVIDENCE_SEARCH_FILTERS].join(', ')}`,
      '',
      'Per-verb arguments (every closed set above is named again where the verb takes it):',
      ...SWARM_COMMANDS.map((name) => `  ${name} — ${[...SWARM_COMMAND_DEFINITIONS[name].args].join(', ') || 'no arguments'}`),
      ...SWARM_KNOWLEDGE_COMMAND_NAMES.map((name) => `  ${name} — ${(name === 'evidence.search' ? [...EVIDENCE_SEARCH_FILTERS] : Object.keys(canonicalOperationForCommand(name)?.inputSchema?.properties ?? {})).join(', ')}`),
      '',
      `Identity comes from the environment: ${SWARM_BRIDGE_ENV_KEYS.url} and ${SWARM_BRIDGE_ENV_KEYS.token}`,
      `are required for real calls; ${SWARM_BRIDGE_ENV_KEYS.swarmId} auto-fills the swarmId argument.`,
      'Help itself needs none of them — it renders locally from the shared command contract.',
      'Effectful commands mint an idempotencyKey when you omit one and print it back as',
      'commandReceipt.idempotencyKey. That key REPLAYS an operation that already completed;',
      're-attempting under it is admitted only for swarm.recruit and swarm.holder_released — every',
      'other command refuses /swarm_operation_unconfirmed/ until the attempt is reconciled, so a',
      'NEW attempt needs a NEW key. swarm.capture takes no key at all: its',
      '(participantId, contributionId) coordinates are the identity.',
      'A refusal is the command\'s answer: one JSON document ({ok:false,error:{message,code,detail}})',
      'on STDOUT with a non-zero exit — the same stream a success envelope uses.',
    ].join('\n');
  }
  const knowledge = swarmKnowledgeCommand(command);
  const seatRead = swarmSeatReadCommand(command);
  const row = SWARM_COMMAND_ROWS.find((entry) => entry.command === command);
  const lines = [
    `${command} — ${knowledge ? knowledge.situation : seatRead ? seatRead.situation : row?.description ?? ''}`,
    knowledge || seatRead ? `Permission: ${(knowledge ?? seatRead).permission} (named on swarm.view \`updates\`).` : '',
    '',
    'Arguments (one JSON object):',
  ].filter((line) => line !== '');
  if (seatRead) {
    // The verb's OWN closed field vocabulary is the argument authority here (the runtime's
    // dispatch runs the SAME validator); swarmId is filled from the bridge environment like every
    // other verb's, and the seat's run identity is never caller-supplied.
    for (const [field, fieldSchema] of Object.entries(seatRead.fields)) {
      lines.push(`  ${field}${seatRead.required.includes(field) ? '' : ' (optional)'} — ${fieldSchema.description ?? 'a value'}`);
    }
    lines.push(`  swarmId (optional) — auto-filled from ${SWARM_BRIDGE_ENV_KEYS.swarmId}; another swarm refuses`);
  } else if (knowledge) {
    // The canonical schema is the ONE argument authority (application-semantics for the run.*
    // verbs, the deployment evidence search module for `evidence.search` — every surface serves
    // that operation, so its help renders that operation's own fields); the identity
    const schema = command === 'evidence.search'
      ? EVIDENCE_SEARCH_INPUT_SCHEMA
      : canonicalOperationForCommand(command)?.inputSchema ?? { properties: {}, required: [] };
    for (const [field, fieldSchema] of Object.entries(schema.properties)) {
      const required = schema.required?.includes(field) && !knowledge.identityFields.includes(field);
      const derived = knowledge.identityFields.includes(field);
      lines.push(`  ${field}${required ? '' : ' (optional)'} — ${fieldSchema.description ?? 'a value'}${derived ? `; derived from your swarm token — never send it` : ''}`);
    }
    // Issue #370: the seed's payload shape is taught where a seat asks for it — the same
    // canonical-schema derivation the brief's Swarm section renders, so help cannot teach a value
    // the validator would refuse.
    if (command === 'run.knowledge.seed') {
      lines.push('', 'Payload shape:', ...knowledgeSeedPayloadLines().map((line) => `  ${line}`));
    }
  } else {
    for (const { field, required, expectation } of swarmCommandFieldSummary(command)) {
      if (field === 'payload') {
        lines.push(`  payload${required ? '' : ' (optional)'} — per-event shapes:`);
        lines.push(...swarmUpdatePayloadDetails().split('\n').map((line) => `    ${line}`));
        continue;
      }
      const notes = [];
      if (field === 'swarmId') notes.push(`auto-filled from ${SWARM_BRIDGE_ENV_KEYS.swarmId}`);
      if (field === 'idempotencyKey') notes.push('minted per call when omitted; pass it back explicitly to replay that call, and use a NEW key for a new attempt');
      lines.push(`  ${field}${required ? '' : ' (optional)'} — ${expectation}${notes.length > 0 ? `; ${notes.join('; ')}` : ''}`);
    }
  }
  if (swarmIdentityKeyedCommand(command)) {
    lines.push('', 'Identity: one record per coordinate; the args above ARE the idempotency key, so an idempotencyKey is refused here.');
  }
  lines.push('', `Usage: node swarm-native-bridge.mjs ${command} '<json-args>'`);
  lines.push(`   Large payload: cat payload.json | node swarm-native-bridge.mjs ${command} -   ('-' or --stdin reads the JSON payload from stdin)`);
  return lines.join('\n');
}

const STDIN_ARGS_MARKERS = new Set(['-', '--stdin']);

/** The CLI intake contract (#493): the JSON payload rides argv OR stdin (`-` / `--stdin` as the
 * args argument), and naming both channels is refused. A payload that does not parse is refused
 * with the channel it arrived on, the byte count received, and the parse error's own message
 * (with its position when the engine reports one), so a worker can self-diagnose; the payload
 * itself is never echoed back into the refusal. */
function parseCliArgsObject(text, source, command) {
  const bytes = Buffer.byteLength(text, 'utf8');
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (cause) {
    const parse = cause?.message ?? String(cause);
    const at = /position (\d+)/u.exec(parse);
    const remedy = source === 'argv' ? '; send a large payload on stdin: node swarm-native-bridge.mjs <command> -' : '';
    throw bridgeError(`Swarm bridge CLI args are not one JSON object: ${parse} (received ${bytes} bytes from ${source})${remedy}`,
      'swarm_bridge_request_invalid', { source, bytes, parse, ...(at ? { position: Number(at[1]) } : {}) });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const received = Array.isArray(parsed) ? 'array' : typeof parsed;
    throw bridgeError(`Swarm bridge CLI args must be one JSON object (received ${received}, ${bytes} bytes from ${source})`,
      'swarm_bridge_request_invalid', { command, source, bytes, received });
  }
  return parsed;
}

/** Read the whole stdin payload to EOF. The caller chose the stdin channel explicitly, so waiting
 * on the stream's end is the documented invocation: pipe a file, a heredoc, or a closed pipe. */
function readStdinPayload(stdin) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stdin.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stdin.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stdin.once('error', (cause) => reject(bridgeError('Swarm bridge CLI args could not be read from stdin',
      'swarm_bridge_request_invalid', { cause: String(cause?.message ?? cause) })));
  });
}

/** CLI entry so a native agent can invoke a bridge command directly from its own shell:
 * `node swarm-native-bridge.mjs swarm.view '{"swarmId":"..."}'` with the bridge env set.
 * A large payload — an audit contribution's findings, whose free text a single-quoted shell
 * argument mangles — rides stdin instead: `cat report.json | node swarm-native-bridge.mjs swarm.update -`. */
export async function swarmBridgeMain(argv = process.argv.slice(2), env = process.env,
  io = { out: process.stdout, err: process.stderr, stdin: process.stdin }) {
  const [command, argsText] = argv;
  let mintedKey = null;
  try {
    const helpRequested = argv.some((argument) => HELP_FLAGS.has(argument));
    if (helpRequested) {
      // Local rendering only: no endpoint lookup, no token read, no network. This is the path a
      // freshly recruited agent takes BEFORE it understands its own environment.
      const target = argv.find((argument) => !HELP_FLAGS.has(argument) && argument !== undefined);
      if (target !== undefined && !SWARM_COMMANDS.includes(target) && !swarmKnowledgeCommand(target)
        && !swarmSeatReadCommand(target)) {
        throw bridgeError(`Unknown swarm command ${target}; run node swarm-native-bridge.mjs --help for the command list`,
          'swarm_command_unavailable', { command: target });
      }
      io.out.write(`${bridgeHelpText(target ?? null)}\n`);
      return 0;
    }
    if (command === undefined) {
      throw bridgeError(`Usage: node swarm-native-bridge.mjs <swarm.command> [json-args | - reads the payload from stdin]; env ${SWARM_BRIDGE_ENV_KEYS.url} and ${SWARM_BRIDGE_ENV_KEYS.token} are required (try --help)`, 'swarm_bridge_request_invalid');
    }
    const stdinRequested = argv.slice(1).some((argument) => STDIN_ARGS_MARKERS.has(argument));
    if (stdinRequested && argsText !== undefined && !STDIN_ARGS_MARKERS.has(argsText)) {
      throw bridgeError('Swarm bridge CLI takes the JSON payload from argv or from stdin (-), not both',
        'swarm_bridge_request_invalid', { command });
    }
    let args = {};
    if (stdinRequested) {
      if (io.stdin == null) {
        throw bridgeError('Swarm bridge CLI stdin payload requested (-) but no stdin stream is wired',
          'swarm_bridge_request_invalid', { command });
      }
      args = parseCliArgsObject(await readStdinPayload(io.stdin), 'stdin', command);
    } else if (argsText !== undefined) {
      args = parseCliArgsObject(argsText, 'argv', command);
    }
    const definition = SWARM_COMMAND_DEFINITIONS[command];
    // The swarm identity is the environment's for every verb that takes one: the contract commands
    // whose schema names it, and the bridge's own participant verbs (knowledge #318, seat reads
    // #441), whose swarmId the token scope supplies server-side.
    // #458: `knowledge` is resolved HERE — the auto-fill read a name only the help renderer bound,
    // so every run.* verb and evidence.search died on a ReferenceError before leaving the process.
    const knowledge = swarmKnowledgeCommand(command);
    const seatRead = swarmSeatReadCommand(command);
    if ((definition?.args.includes('swarmId') || knowledge !== null || seatRead !== null) && args.swarmId === undefined) {
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
    // A refusal is the command's answer, not a diagnostic: it leaves on the SAME stream as a
    // success envelope — one JSON document per invocation, `ok:false` inside it — while the
    // non-zero exit code carries the failure to a shell. No receipt is minted on this path: the
    // key was spent by the attempt, and a fresh attempt needs a fresh key.
    io.out.write(`${JSON.stringify({ ok: false, error: payload }, null, 2)}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) swarmBridgeMain().then((code) => { process.exitCode = code; });
