import { createHash, randomUUID } from 'node:crypto';

import { FRAME_LIMITS } from './limits.mjs';
import { BatonWebClient, discoverBatonConnection } from './application-cli.mjs';
import { createLocalSocketFetch } from './local-web-transport.mjs';
import { McpFleetServer, coreMutationAnswer, coreWakeHandoff, coreWakeHandoffFilter } from './mcp-northbound.mjs';
import { coreCommandFacts, CORE_TOOL_NAMES } from './mcp-core-tools.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from './application-semantics.mjs';
import { SWARM_COMMAND_DEFINITIONS } from './swarm-contract.mjs';
import { SWARM_BRIDGE_ENV_KEYS } from './swarm-native-bridge.mjs';
import { hasNorthboundCapabilityAuthority } from './northbound-capability-authority.mjs';
import { WAKE_CLASSES, parseWakeFilter, wakeMatches } from './wake-stream.mjs';

// REFLEX-4 slice A (docs/32 §3.4, issue #19): application.context_eval is absent from
// ORDINARY_COMMANDS because it is not an APPLICATION_COMMAND_DEFINITIONS entry at all (see the
// note above that table in application.mjs) — there is no `application.command(...)` string
// dispatch for this Web bridge to forward. It is reachable only as a direct method call,
// `application.contextEval(...)`, today.
// docs/36 §8.3 L8 / D8 (R-OP-15b), M4b — the remote_bridge profile projection of the registry: the
// same five operations. The bridge forwards the legacy application-command spelling it dispatches
// (the canonical `baton_*` tools route to these same commands), so there is NO reachability change
// this phase; the retained legacy names resolve to their canonical operation as registry aliases
// (`run.act`→`run.do`, `run.inspect`→`run.view`), which is what retires their M0 ledger rows.
// canonical operation ← legacy application command (both reach one remote operation): run.view ←
// run.inspect, run.do ← run.act; the others are already one spelling. The registry owns these as
// aliases (retiring the mcp.web-bridge ledger rows); the bridge forwards the legacy spelling.
// #227 (operator-ordered direct landing, 2026-08-15): the facade carries the WIRE's registry —
// the resident admits every verb below (WAVE_WEB_ENTRIES + the application table); the old
// five-verb allowlist forced every harness to hand-roll a BatonWebClient proxy. The wire card
// (doctor.application.commands) is the authority: every listed command EXCEPT shutdown
// (never proxied — host-side lifecycle only).
const ORDINARY_COMMANDS = Object.freeze([
  'application.help',
  'run.start', 'run.inspect', 'run.act', 'run.stop', 'run.status',
  'run.follow', 'run.wait', 'run.approve', 'run.answer', 'run.feedback',
  'run.evidence', 'run.adopt', 'run.retry_verification', 'run.resume_work',
  'run.review', 'run.integrate', 'run.export', 'run.recover',
  'run.episode', 'run.workstreams', 'run.workstream.notify', 'run.workstream.stop',
  'run.message.send', 'run.message.receipt', 'run.attention.watch',
  'run.scratchpad.read', 'run.scratchpad.append', 'run.scratchpad.elevate',
  'run.board.post', 'run.board.read', 'run.knowledge.seed',
  'runs.list',
  'waves.attach', 'waves.start', 'waves.list', 'waves.progress', 'waves.send',
  'waves.stop', 'waves.run', 'waves.compile',
]);
const MUTATIONS = new Set([
  'run.start', 'run.act', 'run.stop', 'run.answer', 'run.approve', 'run.feedback',
  'run.adopt', 'run.retry_verification', 'run.resume_work', 'run.review', 'run.integrate',
  'run.export', 'run.recover', 'run.workstream.notify', 'run.workstream.stop',
  'run.message.send', 'run.scratchpad.append', 'run.scratchpad.elevate',
  'run.board.post', 'run.knowledge.seed',
  'waves.start', 'waves.send', 'waves.stop', 'waves.run',
]);
const SAFE_RUN_ID = /^[A-Za-z0-9._:-]{1,256}$/u;

// Issue #314 lane 3 (docs/49 §6.2): the landed failure spellings that mean "the connection this
// session holds is not the live one" — the stale-incarnation refusal (#306) and the web
// transport's own refusal. The session rebinds once when a dispatch meets one of them.
const REBIND_FAILURE_CODES = new Set([
  'resident_incarnation_mismatch', 'cli_connection_incompatible',
  'cli_transport_failed', 'web_transport_failed',
]);
// docs/49 §6.5: the session-lifecycle notification's OWN kind (the method it rides is the
// server's, beside WAKE_NOTIFICATION_METHOD in mcp-northbound.mjs).
const REINCARNATED_FRAME_KIND = 'baton.resident_reincarnated';

// Bridge refusals are composed here, never copied from a provider or an exception, so they are
// safe to forward on the MCP wire verbatim (`wireSafe`); the northbound keeps unmarked text off it.
function bridgeError(message, code = 'application_unavailable', detail = null) {
  return Object.assign(new Error(message), { code, wireSafe: true, ...(detail == null ? {} : { detail }) });
}

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
function digest(value) { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function contextRequestId(value) {
  if (!value || typeof value !== 'object') return null;
  const hasRequestId = Object.hasOwn(value, 'requestId');
  const hasLegacyCallId = Object.hasOwn(value, 'callId');
  if (hasRequestId === hasLegacyCallId) return null;
  return hasRequestId ? value.requestId : value.callId;
}
function validContext(value) {
  const requestId = contextRequestId(value);
  return value && value.transport === 'mcp' && typeof requestId === 'string'
    && requestId.length > 0 && typeof value.idempotencyKey === 'string'
    && value.idempotencyKey === `mcp.call:${requestId}`;
}
function validPrincipal(value, bound) {
  return value && SAFE_RUN_ID.test(value.principalId ?? '') && SAFE_RUN_ID.test(value.sessionId ?? '')
    && value.principalId === bound.userId && value.sessionId === bound.sessionId;
}
function validOutline(value, runId) {
  return value && value.schemaVersion === 1 && value.runId === runId && value.depth === 'outline'
    && value.outline && typeof value.outline === 'object' && !Array.isArray(value.outline)
    && typeof value.outline.phase === 'string' && Array.isArray(value.outline.actions);
}

// ── the wake subscription plane (issue #294) ────────────────────────────────────────────────────
//
// The resident publishes ONE deployment-scope wake stream (`GET /v1/wakes`), and this is the MCP
// session's half of it: at most ONE upstream attachment for the whole session, however many
// subscriptions a client opens. A subscription is a FILTER over the frames that attachment already
// delivers — never a second connection to the resident.
//
// Two laws make that one attachment safe to share:
//
//   * the attachment resumes from the last seq it DELIVERED (`_cursor`), so a dropped socket or a
//     restarted resident is a gap of nothing for every open subscription; and
//   * each subscription drops frames at or below its OWN cursor, so no frame is delivered twice —
//     not even the frames a reopen replays.
//
// A frame that outruns the stream's replay bound arrives as its own typed `baton.wake_stream_lagged`
// marker (the resident composes it), and a refused attachment is announced once per distinct refusal
// as `baton.wake_stream_refused` rather than leaving a subscribed client waiting on a dead feed.
// The notification method name itself belongs to the server that writes it (mcp-northbound.mjs).

/** The filter vocabulary is the stream's own: an unknown class refuses with the closed set, so a
 * caller learns it from the refusal instead of silently watching nothing. */
function wakeFilter(params) {
  try {
    return parseWakeFilter(params ?? {});
  } catch (cause) {
    const detail = cause?.detail !== null && typeof cause?.detail === 'object' && !Array.isArray(cause.detail)
      ? cause.detail : {};
    const unknown = Array.isArray(detail.unknown) ? [...detail.unknown].sort() : null;
    const message = unknown !== null && unknown.length > 0
      ? `unknown wake class(es): ${unknown.join(', ')}; the closed set is ${WAKE_CLASSES.join(', ')}`
      : Object.hasOwn(detail, 'since')
        ? `wake cursor \`since\` must be a non-negative safe integer (received ${JSON.stringify(detail.since)})`
        : 'the wake filter is invalid';
    throw bridgeError(message, 'invalid_wake_filter', { unknown, classes: [...WAKE_CLASSES] });
  }
}

function wakeFilterEcho(filter) {
  return Object.freeze({
    kinds: filter.kinds === null ? null : Object.freeze([...filter.kinds].sort()),
    swarms: filter.swarms === null ? null : Object.freeze([...filter.swarms].sort()),
    participants: filter.participants === null ? null : Object.freeze([...filter.participants].sort()),
  });
}
/** The same filter as plain WIRE params: the vocabulary is still checked by the stream's own parser
 * (an unknown class refuses with the closed set), but what travels on is the query vocabulary the
 * resident reads — never an in-process Set. */
function wakeFilterParams(params) {
  const filter = wakeFilter(params);
  return Object.freeze({
    kinds: filter.kinds === null ? null : [...filter.kinds],
    swarms: filter.swarms === null ? null : [...filter.swarms],
    participants: filter.participants === null ? null : [...filter.participants],
    since: filter.since,
  });
}

/** One bounded page in the ONE filter vocabulary. The bound is the transport's own frame ceiling,
 * never a constant page size: rows are returned whole until the next one would exceed it, and the
 * typed continuation names the cursor that resumes exactly after the last row returned. */
export function boundWakePage(page, maxFrameBytes) {
  if (page === null || typeof page !== 'object' || Array.isArray(page) || !Array.isArray(page.frames)) {
    throw bridgeError('Remote Baton returned an invalid wake page', 'wake_page_invalid');
  }
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes <= 0) {
    throw bridgeError('Remote Baton wake page ceiling is unavailable', 'wake_stream_unavailable');
  }
  const frames = page.frames.filter((frame) => frame !== null && typeof frame === 'object' && !Array.isArray(frame));
  const lagged = page.lagged !== null && typeof page.lagged === 'object' && !Array.isArray(page.lagged) ? page.lagged : null;
  const head = Number.isSafeInteger(page.cursor) ? page.cursor : null;
  const skeleton = {
    schemaVersion: 1, kind: 'baton.wake_page', cursor: head,
    swarms: Array.isArray(page.swarms) ? [...page.swarms] : [], frames: [], lagged, continuation: null,
  };
  let used = Buffer.byteLength(JSON.stringify(skeleton));
  const kept = [];
  for (const frame of frames) {
    // The comma separating it from the previous row is part of what the frame costs.
    const cost = Buffer.byteLength(JSON.stringify(frame)) + 1;
    if (used + cost > maxFrameBytes) break;
    used += cost;
    kept.push(frame);
  }
  const remaining = frames.length - kept.length;
  const last = kept.length === 0 ? null : kept[kept.length - 1].seq;
  const continuation = remaining === 0 ? null : Object.freeze({
    kind: 'baton.wakes_continuation', reason: 'frame_ceiling',
    nextSince: Number.isSafeInteger(last) ? last : head, remaining,
  });
  return Object.freeze({
    ...skeleton,
    cursor: continuation === null ? head : continuation.nextSince,
    frames: Object.freeze(kept),
    continuation,
  });
}

export class WakeSubscriptions {
  /**
   * `onEnd(outcome)` is the session's own mortality seam (#314 lane 3, docs/49 §6): the attachment
   * this plane held ended, or could not be opened, and the session may want to re-bind the whole
   * session (a resident reincarnation) before the plane re-dials. Answering `true` means the
   * session TOOK the re-attach over — it calls `reopen()` once it has re-bound, or `resume()` to
   * hand the reconnect back to this plane's own cadence — so the plane never races it.
   * `onFrame(frame)` observes every frame the attachment delivered, BEFORE any subscription
   * filter judges it (a session-level fact, never a subscriber's).
   */
  constructor({ open, cadenceMs, now = Date.now, onEnd = null, onFrame = null }) {
    if (typeof open !== 'function') throw new TypeError('wake subscriptions require an attachment opener');
    // The reconnect cadence is the caller's own deployment cadence (the resident command poll),
    // never a second invented timer constant.
    if (!Number.isSafeInteger(cadenceMs) || cadenceMs <= 0) {
      throw new TypeError('wake subscription cadence must be a positive safe integer');
    }
    if (typeof now !== 'function') throw new TypeError('wake subscription clock must be a function');
    if (onEnd !== null && typeof onEnd !== 'function') {
      throw new TypeError('wake subscription end handler must be a function');
    }
    if (onFrame !== null && typeof onFrame !== 'function') {
      throw new TypeError('wake subscription frame handler must be a function');
    }
    this.open = open;
    this.cadenceMs = cadenceMs;
    this.now = now;
    this.onEnd = onEnd;
    this.onFrame = onFrame;
    this.deliver = null;
    this._subscriptions = new Map();
    this._attachment = null;
    this._cursor = null;
    this._floor = null;
    this._timer = null;
    this._refusal = null;
    this._closed = false;
  }

  get attached() { return this._attachment !== null; }

  get subscriptionCount() { return this._subscriptions.size; }

  cursor() { return this._cursor; }

  /** Open one subscription and return its receipt. `since` names the cursor the receipt starts
   * after: the caller's own when it supplied one, else the attachment's position — null when this
   * is the first subscription and nothing has been delivered yet, which is the stream's own "from
   * now". The receipt is not returned before the resident has answered the attachment request, so
   * "now" is a moment the caller can trust and `attachments` counts what is actually open. */
  async subscribe(params = {}, deliver = null) {
    if (this._closed) throw bridgeError('the wake stream for this session is closed', 'wake_stream_closed');
    if (deliver !== null) {
      if (typeof deliver !== 'function') throw bridgeError('wake delivery must be a function', 'wake_notifications_unavailable');
      this.deliver = deliver;
    }
    // Issue #314: a subscription is opened without a delivery sink when the session has none yet
    // (a long verb's handoff is opened by the FACADE, which reaches its sink through the facade's
    // own `_deliverToSession`): the frames then reach the sink that is not there, which is exactly
    // what the landed transport already does when its `notify` refuses — the subscription itself
    // never depended on a sink.
    const filter = wakeFilter(params);
    const requested = filter.since;
    // An explicit cursor lowers the attachment's floor. A subscription that asks for history this
    // attachment already passed re-attaches at that cursor — still ONE attachment, and the
    // subscriptions above the floor filter the replay out.
    const belowFloor = requested !== null && (this._floor === null || requested < this._floor);
    if (belowFloor) this._floor = requested;
    const subscription = {
      subscriptionId: `wake-sub:${randomUUID()}`,
      filter,
      since: requested ?? this._cursor ?? this._floor ?? null,
    };
    this._subscriptions.set(subscription.subscriptionId, subscription);
    if (this._attachment === null) this._attach();
    else if (belowFloor && this._cursor !== null && requested < this._cursor) this._reopen();
    const attach = this._attachment;
    if (attach !== null) await attach.opened;
    return Object.freeze({
      subscriptionId: subscription.subscriptionId,
      since: subscription.since,
      ...wakeFilterEcho(filter),
      cursor: this._cursor,
      attachments: this._attachment === null ? 0 : 1,
    });
  }

  unsubscribe(subscriptionId) {
    const id = typeof subscriptionId === 'string' ? subscriptionId : null;
    if (id === null || !this._subscriptions.has(id)) {
      throw bridgeError(`no open wake subscription ${id === null ? '(non-string id)' : id}`, 'wake_subscription_not_found');
    }
    this._subscriptions.delete(id);
    // The last subscription released the attachment: a resident connection is never held open for
    // a session that watches nothing.
    if (this._subscriptions.size === 0) this._detach();
    return Object.freeze({ subscriptionId: id, open: false, subscriptions: this._subscriptions.size, attachments: 0 });
  }

  close() {
    this._closed = true;
    this._subscriptions.clear();
    this._detach();
  }

  /** Hand one SESSION-lifecycle frame to this session's client (docs/49 §6.5, #314 lane 3): it is
   * not a wake row, so no subscription's filter judges it and it is delivered once however many
   * subscriptions are open. The channel is the one the session's own subscription opened — a
   * session that never subscribed has none to notify. */
  announce(frame) {
    if (this._closed) return;
    const deliver = this.deliver;
    if (deliver === null) return;
    try {
      const outcome = deliver(frame, null);
      if (outcome !== null && typeof outcome?.then === 'function') outcome.then(() => {}, () => {});
    } catch { /* the session is gone; there is nobody left to tell */ }
  }

  /** Re-open the attachment NOW through the opener this session currently holds. The session calls
   * this after it has re-bound (the facade swaps the client under the plane), so the plane never
   * re-dials the incarnation it just left; `_attach` keeps it ONE attachment. */
  reopen() {
    if (this._closed || this._subscriptions.size === 0) return;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._stopAttachment();
    this._attach();
  }

  /** The session could not re-bind after all (#314 lane 3): hand the reconnect back to this plane's
   * own bounded cadence instead of attaching again in the same breath — a resident that is down is
   * never met with a tight loop. */
  resume() {
    if (this._closed || this._subscriptions.size === 0) return;
    this._scheduleReconnect();
  }

  /** The session's mortality seam: `true` means the session took the re-attach over. A handler
   * that throws is a session fault, never a reason to drop the plane's own reconnect. */
  _ended(outcome) {
    if (this.onEnd === null) return false;
    try { return this.onEnd(outcome) === true; } catch { return false; }
  }

  _attach() {
    if (this._closed || this._attachment !== null || this._subscriptions.size === 0) return;
    const controller = new AbortController();
    const attach = {};
    let attachment;
    try {
      attachment = this.open({
        // Resuming after a drop wins: it is the newest cursor this session acted on. Only a first
        // attach (nothing delivered yet) opens at a subscription's requested cursor.
        ...(this._cursor === null ? { filter: { since: this._floor } } : { filter: {}, resume: this._cursor }),
        signal: controller.signal,
        onFrame: (frame) => this._onFrame(frame),
        onLagged: (lagged) => this._onLagged(lagged),
      });
    } catch (cause) {
      this._announceRefusal(cause);
      if (!this._ended({ status: 'error', error: cause })) this._scheduleReconnect();
      return;
    }
    if (attachment === null || typeof attachment !== 'object' || typeof attachment.close !== 'function') {
      try { controller.abort(); } catch { /* nothing to release */ }
      const unavailable = bridgeError('the wake attachment could not be opened', 'wake_stream_unavailable');
      this._announceRefusal(unavailable);
      if (!this._ended({ status: 'error', error: unavailable })) this._scheduleReconnect();
      return;
    }
    attach.attachment = attachment;
    // A refused or failed open settles through `done` (below) into _onEnd; `opened` only has to
    // settle, never to throw, so a subscribe that awaits it always gets its receipt.
    attach.opened = Promise.resolve(attachment.opened ?? { status: 'open' })
      .catch((error) => ({ status: 'error', error }));
    this._attachment = attach;
    Promise.resolve(attachment.done).then(
      (outcome) => this._onEnd(attach, outcome ?? { status: 'ended' }),
      (cause) => this._onEnd(attach, { status: 'error', error: cause }),
    );
  }

  _reopen() {
    this._stopAttachment();
    this._attach();
  }

  _onEnd(attach, outcome) {
    if (this._attachment !== attach) return;   // a reopen already superseded this attachment
    this._attachment = null;
    if (this._closed || this._subscriptions.size === 0) return;
    if (outcome?.status === 'stopped') return; // this session's own detach
    if (outcome?.status === 'refused') this._announceRefusal(outcome.error);
    if (this._ended(outcome)) return;
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this._timer !== null || this._closed || this._subscriptions.size === 0) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      this._attach();
    }, this.cadenceMs);
    this._timer.unref?.();
  }

  _stopAttachment() {
    const attach = this._attachment;
    this._attachment = null;
    if (attach === null) return;
    try { attach.attachment.close(); } catch { /* the attachment is already gone */ }
  }

  _detach() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._stopAttachment();
    this._cursor = null;
    this._floor = null;
    this._refusal = null;
  }

  _onFrame(frame) {
    if (this._closed) return;
    const ordered = Number.isSafeInteger(frame?.seq);
    // The cursor the NEXT attach resumes from: every frame the attachment delivered, whether or not
    // any subscription's filter admitted it — a filter is never a gap for a late subscriber.
    if (ordered && (this._cursor === null || frame.seq > this._cursor)) this._cursor = frame.seq;
    // The session observes every frame the attachment delivered — before any filter judges it —
    // so a handoff row reaches the session even when the client subscribed to nothing else.
    this._observed(frame);
    for (const subscription of this._subscriptions.values()) {
      if (ordered && subscription.since !== null && frame.seq <= subscription.since) continue;
      if (!wakeMatches(frame, subscription.filter)) continue;
      if (ordered) subscription.since = frame.seq;
      this._emit(subscription, frame);
    }
  }

  /** A lag marker is not a wake row: it has no class to filter on and every open subscription lost
   * the same rows, so every one of them is told. */
  _onLagged(lagged) {
    if (this._closed) return;
    if (Number.isSafeInteger(lagged?.cursor) && (this._cursor === null || lagged.cursor > this._cursor)) {
      this._cursor = lagged.cursor;
    }
    for (const subscription of this._subscriptions.values()) this._emit(subscription, lagged);
  }

  /** The session's frame observer, kept out of the delivery path's own failure modes: a session
   * handler that throws never costs a subscriber its frame. */
  _observed(frame) {
    if (this.onFrame === null) return;
    try { this.onFrame(frame); } catch { /* the session's own bookkeeping */ }
  }

  _announceRefusal(cause) {
    const code = typeof cause?.code === 'string' && cause.code.length > 0 ? cause.code : 'wake_stream_refused';
    const signature = `${code}\0${cause?.message ?? ''}`;
    if (this._refusal === signature || this._subscriptions.size === 0) return;
    this._refusal = signature;
    // The refusal that names the state is the transport's answer, and it is already composed by
    // Baton's own transport; only `code`/`message` ride, never an exception object.
    const frame = Object.freeze({
      schemaVersion: 1, kind: 'baton.wake_stream_refused', code,
      message: typeof cause?.message === 'string' ? cause.message : null,
      detail: cause?.detail ?? null, cursor: this._cursor,
    });
    for (const subscription of this._subscriptions.values()) this._emit(subscription, frame);
  }

  /** Hand one frame to the session's client. `deliver(frame, subscription)` — the frame is the
   * payload the client acts on (the MCP notification's params ARE the frame); the subscription is
   * the context, never the payload. */
  _emit(subscription, frame) {
    const deliver = this.deliver;
    if (deliver === null) return;
    try {
      const outcome = deliver(frame, subscription);
      if (outcome !== null && typeof outcome?.then === 'function') outcome.then(() => {}, () => {});
    } catch { /* the session is gone; the cursor is kept for the next attachment */ }
  }
}

/** Remote application facade: MCP transport lifetime never owns the resident Baton application.
 *
 * Issue #314 lane 3 (docs/49 §6): a session bound to an incarnation survives that incarnation's
 * reincarnation (#306) through the optional `rediscover` construction option — the SAME discovery
 * and session establishment as the open path, answering `{client, card, session, incarnation}`.
 * A facade constructed without one (a test, an embedder, the descriptor) keeps today's behavior
 * exactly: the incarnation it opened against is the incarnation it talks to for its whole life. */
export class BatonWebApplicationFacade {
  constructor(client, applicationCard, session, options = {}) {
    if (!client || typeof client.command !== 'function' || typeof client.doctor !== 'function'
      || typeof client.session !== 'function'
      || !applicationCard || typeof applicationCard !== 'object' || Array.isArray(applicationCard)
      || typeof applicationCard.repoId !== 'string' || applicationCard.repoId !== client.repoId
      || !Array.isArray(applicationCard.commands)
      || ORDINARY_COMMANDS.some((command) => !applicationCard.commands.includes(command))
      || !session?.identity || !SAFE_RUN_ID.test(session.identity.userId ?? '')
      || !SAFE_RUN_ID.test(session.identity.sessionId ?? '')
      || !Array.isArray(session.identity.capabilities) || !session.identity.capabilities.includes('observe')
      || !Array.isArray(session.identity.repoIds) || !session.identity.repoIds.includes(client.repoId)
      || !Number.isFinite(Date.parse(session.expiresAt))
      || options === null || typeof options !== 'object' || Array.isArray(options)
      || (options.rediscover !== undefined && typeof options.rediscover !== 'function')
      || (options.incarnation !== undefined && options.incarnation !== null
        && !SAFE_RUN_ID.test(options.incarnation))) {
      throw new TypeError('Baton Web application facade is invalid');
    }
    this.client = client;
    this.repoId = client.repoId;
    this._card = Object.freeze(clone(applicationCard));
    this._registryDigest = applicationCard.agentExperience?.registryDigest ?? null;
    // U-E17 (#287, 2026-09-14 audit): no construction-time session digest is pinned. The session
    // is re-attested against the CURRENT one per dispatch (_reattestSession), so a resident
    // refresh that renews expiresAt (or grants a capability) is a renewal instead of a permanent
    // refusal. The bound identity below is the only frozen authority; `_attestation` holds the
    // one attestation a single transport dispatch shares.
    this._attestation = null;
    this._principal = Object.freeze({
      userId: session.identity.userId,
      sessionId: session.identity.sessionId,
      capabilities: Object.freeze([...session.identity.capabilities]),
      repoIds: Object.freeze([client.repoId]),
      expiresAt: session.expiresAt,
      revoked: false,
    });
    // Issue #294: the session's wake plane is created on the first subscription, so a facade whose
    // connection cannot attach the stream (a mock, or a resident older than the wake feed) refuses
    // the subscription instead of holding an attachment it never opened.
    this._wakes = null;
    // Issue #314 lane 3: the rebind authority and the coordinates this session is bound to. The
    // resident's session id is re-minted per incarnation, so it is tracked beside the frozen
    // client-facing principal (which never changes) rather than inside it.
    this._rediscover = options.rediscover ?? null;
    this._residentSessionId = session.identity.sessionId;
    this._connection = Object.freeze({
      incarnation: options.incarnation ?? null,
      sessionId: session.identity.sessionId,
    });
    this._rebinding = null;      // the single-flight rebind promise of the handoff in flight
    this._rebindBound = false;   // a successor is bound; no further handoff until contact
    this._rebindDenied = false;  // the successor narrowed the grant: this session ends typed
    // Issue #314 (docs/49 §5): the sink every wake frame reaches — the MCP server installs it at
    // construction (`attachWakeDelivery`), so the explicit `baton_wakes subscribe` verb and a long
    // verb's handoff deliver through ONE session sink, whatever order they arrive in.
    this._wakeDelivery = null;
  }

  card() { return this._card; }

  principal() { return Object.freeze(clone(this._principal)); }

  /** #227's authority, applied: the resident's wire card admits a command, not a hand-kept list.
   * ORDINARY_COMMANDS stays the floor the constructor requires of every card; anything else the
   * card advertises (the swarm family, and whatever the registry grows next) is forwarded the
   * same way. shutdown is host-side lifecycle and is never proxied. */
  _admits(name) {
    return typeof name === 'string' && name !== 'application.shutdown'
      && (ORDINARY_COMMANDS.includes(name) || this._card.commands.includes(name));
  }

  _notAdmitted(name) {
    return bridgeError(`Remote Baton MCP command authority is invalid: ${typeof name === 'string' ? name : '(non-string command)'} is not admitted by the resident wire card`,
      'application_unauthorized', { command: typeof name === 'string' ? name : null, admitted: false });
  }

  /** U-E18 (#287, 2026-09-14 audit): baton_deployment_doctor over the bridge answers from the
   * resident's REAL readiness. The northbound consults application.doctor() first, and without
   * this the hardcoded always-ready stub (zero routes, workspace ready) answered for every
   * bridged deployment. The projection is the resident's own deployment readiness — routes,
   * workspace and limits exactly as the resident reports them — carrying the LIVE ready flag.
   * The bridge's own verified coordinates (repoId) are pinned after it; secret material never
   * rides here, and the northbound redacts credential-shaped values at the surface anyway. */
  async doctor() {
    return this._onceAfterRebind(async () => {
      const live = await this.client.doctor();
      if (!live || typeof live !== 'object' || Array.isArray(live)) {
        throw bridgeError('Remote Baton doctor is unavailable');
      }
      const readiness = live.deployment && typeof live.deployment === 'object' && !Array.isArray(live.deployment)
        ? clone(live.deployment) : {};
      // Issue #479: a resident that is stopping says so on the card every client reads (#467/#476) —
      // the client's own doctor() carries that section beside the readiness it projects, so the MCP
      // projection carries it too, verbatim. Null (never absent) for a resident that is not stopping,
      // the same rule the CLI's doctor answers under.
      const stopping = live.stopping !== null && typeof live.stopping === 'object'
        && !Array.isArray(live.stopping) ? clone(live.stopping) : null;
      return Object.freeze({
        ...readiness,
        schemaVersion: 1,
        repoId: this.repoId,
        ready: live.ready === true,
        stopping,
      });
    });
  }

  /** U-E17 (#287): re-attest against the CURRENT session, never a construction-time digest. What
   * refuses is a genuine authority change: a different identity, a bound capability the session
   * no longer carries, the served repository leaving the session scope, a revoked flag, or an
   * unparsable expiry. A moved `expiresAt` is a renewal — the session is re-attested, not
   * invalidated.
   *
   * Issue #314 lane 3 (docs/49 §6.3): the ONE relaxation is `rebind` — the resident mints its
   * session id per incarnation, so the successor's session id is admitted where the successor is
   * being bound and NOWHERE else. Every other axis (userId, the capability superset, the repoId
   * scope, the revocation and the expiry) is judged exactly as a dispatch judges it. */
  _sessionAuthority(current, { rebind = false } = {}) {
    const identity = current?.identity;
    const renewed = identity && typeof identity === 'object'
      && identity.userId === this._principal.userId
      && (rebind === true || identity.sessionId === this._residentSessionId)
      && Array.isArray(identity.capabilities)
      && this._principal.capabilities.every((capability) => identity.capabilities.includes(capability))
      && Array.isArray(identity.repoIds) && identity.repoIds.includes(this.repoId)
      && current.revoked !== true
      && Number.isFinite(Date.parse(current.expiresAt));
    if (!renewed) {
      throw bridgeError('Remote Baton authenticated session authority changed', 'application_unauthorized');
    }
    return current;
  }

  async _reattestSession() {
    return this._sessionAuthority(await this.client.session());
  }

  /** U-E17 (#287): one session round trip per tool call at most. Every facade entry of ONE
   * transport dispatch (actionAuthority → authorizeReplay → command) carries the same
   * server-minted dispatch identity as its context requestId, so the dispatch shares a single
   * attestation; a context with a different identity attests afresh, and the entry is replaced
   * (never a timer, never a TTL — the dispatch is the freshness epoch). The attestation is a
   * fast local check, not the access boundary: the resident re-authenticates the bearer session
   * on every forwarded command. */
  async _attestSession(principal, context = null) {
    if (!validPrincipal(principal, this._principal)) {
      throw bridgeError('Remote Baton MCP principal is invalid', 'application_unauthorized');
    }
    const dispatchKey = contextRequestId(context);
    if (dispatchKey !== null && this._attestation?.key === dispatchKey) {
      return this._attestation.pending;
    }
    const pending = this._reattestSession();
    this._attestation = dispatchKey === null ? null : { key: dispatchKey, pending };
    return pending;
  }

  _mutationKey(name, args, principal) {
    return `mcp-web-${digest({
      repoId: this.repoId,
      principalId: principal.principalId,
      sessionId: principal.sessionId,
      command: name,
      args,
    })}`;
  }

  // ── the reincarnation rebind (issue #314 lane 3, docs/49 §6) ──────────────────────────────────
  //
  // A bridge session is bound to ONE incarnation: the connection (socket path + token, docs/48 §1)
  // is discovered once and the old incarnation withdraws the socket when its handoff ends. The
  // rebind is driven by FACTS — never a timer: a dispatch whose transport is gone or whose resident
  // answers `resident_incarnation_mismatch`; the wake attachment ending with `resident_stopping`
  // (or its socket refusing the reconnect); the `incarnation_changed` wake class naming a
  // successor. The old incarnation's re-publish arm is respected: a `host.reincarnation_failed`
  // row means the predecessor re-took its authority and the publication still names it — there is
  // no successor to bind to, and the class says so with its own row.

  /** The failure facts that mean "the connection this session holds is not the live one". Not a
   * new refusal code — the landed spellings: the stale-incarnation refusal (#306, retryable) and
   * the web transport's own refusal. A command that outlived THIS caller's request bound is not
   * one of them: the deployment still answers and the durable receipt is the truth (R-5, #288). */
  _rebindableFailure(cause) {
    if (this._rediscover === null || this._rebindDenied) return false;
    if (cause?.requestBoundElapsed === true) return false;
    const code = cause?.code ?? null;
    const declared = typeof cause?.cause === 'string' ? cause.cause : null;
    return REBIND_FAILURE_CODES.has(code) || REBIND_FAILURE_CODES.has(declared);
  }

  /** The attachment ends that say the incarnation behind them is gone: a failed transport, or the
   * resident naming its own stop (#316 b). A clean end is not one — an archive-behind end and a
   * caller's own detach read the same — and a socket that is genuinely dead turns the plane's next
   * attach into the `error` this accepts. */
  _incarnationGone(outcome) {
    if (outcome?.status === 'error') return true;
    return outcome?.status === 'ended' && outcome.reason === 'resident_stopping';
  }

  /** The plane's mortality seam: `true` means this session owns the re-attach (the rebind re-opens
   * the plane, or hands it back its own cadence). One handoff is never bound twice: a successor
   * that is already bound is re-bound only after the session has been back in contact with it. */
  _wakeEndTrigger(outcome) {
    if (this._rebindBound || !this._incarnationGone(outcome)) return false;
    return this._rebindAttempt() !== null;
  }

  /** Every frame the attachment delivered, before any subscription filter judges it. The handoff
   * class is this seam's own INPUT, never "contact": a replayed `host.reincarnated` after the
   * rebind must not mint a second handoff. Any other frame is proof the session reached the
   * incarnation it is bound to. */
  _wakeFrame(frame) {
    if (frame?.wakeClass === 'incarnation_changed') {
      if (frame?.row?.payloadKind !== 'host.reincarnated' || this._rebindBound) return;
      this._rebindAttempt();
      return;
    }
    this._noteContact();
  }

  /** The session is talking to the incarnation it is bound to: the next handoff is a new fact. */
  _noteContact() {
    this._rebindBound = false;
  }

  /** Start (or join) the ONE rebind of the handoff in flight. Null when there is no authority to
   * rebind with, the session is already bound, or the successor's grant was refused. */
  _rebindAttempt() {
    if (this._rediscover === null || this._rebindDenied) return null;
    if (this._rebinding === null) {
      this._rebinding = this._performRebind().finally(() => { this._rebinding = null; });
    }
    return this._rebinding;
  }

  /** The rediscovery must answer THIS deployment's resident: a client and a card that still
   * carries the ordinary floor the open path required of the card it bound. */
  _bindsDeployment(opened) {
    const client = opened?.client ?? null;
    const card = opened?.card ?? null;
    return client !== null && typeof client.command === 'function'
      && typeof client.doctor === 'function' && typeof client.session === 'function'
      && card !== null && typeof card === 'object' && !Array.isArray(card)
      && card.repoId === this.repoId && Array.isArray(card.commands)
      && ORDINARY_COMMANDS.every((command) => card.commands.includes(command));
  }

  /**
   * ONE rediscovery, one re-attestation, one swap. The successor's client replaces the client only
   * AFTER its session has been attested (a narrowed grant ends the session instead of binding it);
   * the swap clears the dispatch attestation, since that attestation belonged to the old client.
   * The answer is `{adopted, successor, error}` — never a rejection, so the plane's seam and a
   * dispatch's retry read the same verdict.
   */
  async _performRebind() {
    const previous = this._connection;
    let opened;
    try {
      opened = await this._rediscover();
    } catch (error) {
      // A resident that is DOWN changes nothing (docs/49 §6.7): the session keeps the client and
      // the coordinates it holds, calls keep their typed refusals, and the plane keeps its own
      // bounded reconnect cadence — which is also what re-attempts this discovery, never a timer.
      this._resumeWakes();
      return { adopted: false, successor: false, error };
    }
    if (!this._bindsDeployment(opened)) {
      this._resumeWakes();
      return { adopted: false, successor: false, error: null };
    }
    try {
      this._sessionAuthority(opened.session, { rebind: true });
    } catch (error) {
      // docs/49 §6.3: a successor whose session narrows the grant is not a reincarnation for this
      // session — the rebind refuses `application_unauthorized` and the session ends typed.
      if (error?.code === 'application_unauthorized') this._rebindDenied = true;
      this._resumeWakes();
      return { adopted: false, successor: false, error };
    }
    const session = opened.session;
    const to = Object.freeze({
      incarnation: opened.incarnation ?? null,
      sessionId: session.identity.sessionId,
    });
    const successor = to.incarnation !== previous.incarnation || to.sessionId !== previous.sessionId;
    this.client = opened.client;
    this._card = Object.freeze(clone(opened.card));
    this._registryDigest = opened.card.agentExperience?.registryDigest ?? null;
    this._residentSessionId = to.sessionId;
    this._connection = to;
    this._attestation = null;
    this._rebindBound = true;
    if (successor) this._announceReincarnation(previous, to);
    this._reopenWakes();
    return { adopted: true, successor };
  }

  /** docs/49 §6.5: exactly ONE session-lifecycle notification per handoff — `{from, to, cursor}`
   * beside `notifications/baton/wake`, delivered whatever any subscription's filter admits. It is
   * NOT a wake class: the wake table is the deployment's vocabulary, this is the session's own
   * authority event, and its method belongs to the server that writes it (mcp-northbound). */
  _announceReincarnation(from, to) {
    const plane = this._wakes;
    if (plane === null) return;   // no session notification channel was ever opened
    plane.announce(Object.freeze({
      schemaVersion: 1,
      kind: REINCARNATED_FRAME_KIND,
      from: Object.freeze({ incarnation: from.incarnation, sessionId: from.sessionId }),
      to: Object.freeze({ incarnation: to.incarnation, sessionId: to.sessionId }),
      cursor: plane.cursor(),
      at: new Date().toISOString(),
    }));
  }

  _reopenWakes() {
    if (this._wakes !== null) this._wakes.reopen();
  }

  _resumeWakes() {
    if (this._wakes !== null) this._wakes.resume();
  }

  /**
   * ONE replay after a rebind for the reads and dispatches a dead transport can meet (docs/49
   * §6.6). The operation is re-run exactly as the caller composed it — a mutation's idempotency key
   * included, since `command` derives it BEFORE it calls this — so the shared coordination ledger
   * replays the first attempt's receipt instead of applying it twice. A second failure propagates
   * as the refusal it is: never `command_outcome_unknown`.
   */
  async _onceAfterRebind(operation) {
    try {
      const value = await operation();
      this._noteContact();
      return value;
    } catch (cause) {
      if (!this._rebindableFailure(cause)) throw cause;
      const attempt = this._rebindAttempt();
      if (attempt === null) throw cause;
      const outcome = await attempt;
      if (outcome.adopted !== true) throw (outcome.error ?? cause);
      const value = await operation();
      this._noteContact();
      return value;
    }
  }

  async actionAuthority(args, principal, context = null) {
    return this._onceAfterRebind(() => this._actionAuthorityOnce(args, principal, context));
  }

  async _actionAuthorityOnce(args, principal, context) {
    await this._attestSession(principal, context);
    const idempotencyKey = this._mutationKey('run.act', args, principal);
    if (typeof this.client.actionAuthority === 'function') {
      return this.client.actionAuthority(args, idempotencyKey);
    }
    const outline = await this.client.command(
      'run.inspect', { runId: args.runId, depth: 'outline' },
      `mcp-web-${digest({ repoId: this.repoId, idempotencyKey, stage: 'authority-outline' })}`,
    );
    if (!validOutline(outline, args.runId)) {
      throw bridgeError('Remote Baton returned an invalid Run outline');
    }
    const action = outline.outline.actions.find((candidate) => candidate.actionId === args.actionId);
    if (!action || typeof action.kind !== 'string' || typeof action.effect !== 'string'
      || !Array.isArray(action.requiredCapabilities)) {
      throw bridgeError('Remote Baton action authority is unavailable',
        'application_action_scope_mismatch');
    }
    const payload = {
      schemaVersion: 1, actionId: action.actionId, kind: action.kind,
      effect: action.effect, requiredCapabilities: [...action.requiredCapabilities].sort(),
    };
    return Object.freeze({ ...payload, authorityDigest: digest(payload) });
  }

  async authorizeReplay(name, args, principal, context) {
    return this._onceAfterRebind(() => this._authorizeReplayOnce(name, args, principal, context));
  }

  async _authorizeReplayOnce(name, args, principal, context) {
    if (!this._admits(name)) throw this._notAdmitted(name);
    if (!validContext(context)) {
      throw bridgeError('Remote Baton MCP replay authority is invalid', 'application_unauthorized');
    }
    await this._attestSession(principal, context);
    if (name === 'run.act') {
      const semantic = context.semanticAuthority;
      const definition = APPLICATION_SEMANTIC_REGISTRY.actions[semantic?.kind];
      const payload = semantic && {
        schemaVersion: semantic.schemaVersion,
        actionId: semantic.actionId,
        kind: semantic.kind,
        effect: semantic.effect,
        requiredCapabilities: semantic.requiredCapabilities,
      };
      if (!hasNorthboundCapabilityAuthority('mcp', context.capabilityAuthority)
        || semantic?.schemaVersion !== 1 || semantic.actionId !== args?.actionId
        || !definition || semantic.effect !== definition.effect
        || !Array.isArray(semantic.requiredCapabilities)
        || semantic.requiredCapabilities.join('\0') !== definition.requiredCapabilities.join('\0')
        || semantic.authorityDigest !== digest(payload)
        || !Array.isArray(context.capabilities)
        || new Set(context.capabilities).size !== context.capabilities.length
        || [...context.capabilities].sort().join('\0')
          !== [...this._principal.capabilities].sort().join('\0')
        || !semantic.requiredCapabilities.every(
          (capability) => context.capabilities.includes(capability),
        )) {
        throw bridgeError('Remote Baton MCP replay authority is invalid',
          'application_unauthorized');
      }
    }
    const doctor = await this.client.doctor();
    const card = doctor?.application;
    if (doctor?.ready !== true || card?.repoId !== this.repoId
      || !Array.isArray(card.commands) || !card.commands.includes(name)
      || (this._registryDigest !== null
        && card.agentExperience?.registryDigest !== this._registryDigest)) {
      throw bridgeError('Remote Baton application authority changed');
    }
    return true;
  }

  async command(name, args, principal, context) {
    if (!this._admits(name)) throw this._notAdmitted(name);
    if (!validContext(context)) {
      throw bridgeError('Remote Baton MCP command authority is invalid: the call context is malformed', 'application_unauthorized');
    }
    // Issue #344: the keyed set is the registry's, never a second hand-kept list — every
    // mcpStateful command (the swarm family's keyed verbs included) derives its forwarded key
    // over every argument axis (_mutationKey), so a changed axis mints a fresh key and an
    // identical request replays the admitted one. Reads keep the transport-derived key.
    const keyed = MUTATIONS.has(name) || SWARM_COMMAND_DEFINITIONS[name]?.mcpStateful === true;
    const idempotencyKey = keyed
      ? this._mutationKey(name, args, principal)
      : `mcp-web-${digest({ repoId: this.repoId, key: context.idempotencyKey })}`;
    // Issue #314 lane 3 (docs/49 §6.6): the key is derived ONCE and the replay after a rebind
    // carries it unchanged — the shared ledger replays the first attempt instead of doubling it.
    return this._onceAfterRebind(() => this._commandOnce(name, args, idempotencyKey, principal, context));
  }

  async _commandOnce(name, args, idempotencyKey, principal, context) {
    await this._attestSession(principal, context);
    const result = await this.client.command(name, args, idempotencyKey);
    // Issue #314 law (d), docs/49 §5: a core MUTATION answers the #302 receipt, and a long verb's
    // answer adds the wake handoff its follow-up rides — the call returns as soon as the receipt
    // exists, never holding the turn on the operation's settle (the retired `_inspectOutline`
    // answer held it on the whole Run outline). The facts are the core table's own
    // (`coreCommandFacts`, derived from the rows the agent surface advertises), and the answer
    // composer is the ONE shape both entries' dispatch can read; a command the core does not fold
    // in keeps the answer its own lane sends, untouched.
    const facts = coreCommandFacts(name);
    if (facts === null || !facts.mutation) return result;
    const wake = facts.long ? await this._openHandoff(facts, args) : null;
    return coreMutationAnswer({ command: name, args, result, wake });
  }

  /** The wake handoff a long verb's answer hands back (#294): ONE subscription on the session's
   * own plane — never a second connection — filtered to the operation's subject per the core
   * row's classes. The settleOn subset the answer carries is the client's cue to re-read. */
  async _openHandoff(facts, args) {
    const subscription = await this._wakePlane().subscribe(
      coreWakeHandoffFilter(facts, args),
      (frame, subscriptionRow) => this._deliverToSession(frame, subscriptionRow),
    );
    return coreWakeHandoff(subscription, facts);
  }

  /** One frame for this session's client: the sink the MCP server installed. A facade without one
   * has no transport to deliver to, so the frame is dropped — the state the plane is in before its
   * first subscription too (WakeSubscriptions._emit). */
  _deliverToSession(frame, subscription) {
    const sink = this._wakeDelivery;
    if (sink !== null) sink(frame, subscription);
  }

  /** The session's notification sink: the MCP server hands its own `notify` over here at
   * construction, so an explicit subscription and a long verb's handoff deliver through it. */
  attachWakeDelivery(deliver) {
    if (deliver !== null && typeof deliver !== 'function') {
      throw new TypeError('wake delivery must be a function');
    }
    this._wakeDelivery = deliver;
  }

  /** Issue #294: the session's one wake plane, created on first use. When this session holds a
   * rebind authority (#314 lane 3) the plane reports its own ends and the frames it delivered, so
   * the session can re-bind to a successor incarnation and resume the SAME subscription records
   * from the same cursor. */
  _wakePlane() {
    if (this._wakes === null) {
      this._wakes = new WakeSubscriptions({
        open: (options) => this.client.wakes(options),
        // The reconnect cadence IS the connection's own command cadence: no second timer constant
        // is invented here, and a deployment that polls faster reconnects faster.
        cadenceMs: this.client.pollMs,
        ...(this._rediscover === null ? {} : {
          onEnd: (outcome) => this._wakeEndTrigger(outcome),
          onFrame: (frame) => this._wakeFrame(frame),
        }),
      });
    }
    return this._wakes;
  }

  /** Open one wake subscription. `deliver(frame, subscription)` is how a frame reaches THIS
   * session's client; the MCP server installs that sink at construction, so an explicit verb and a
   * long verb's handoff deliver through ONE sink. */
  wakeSubscribe(params, deliver = null) {
    if (typeof this.client.wakes !== 'function') {
      throw bridgeError('this Baton connection cannot attach the deployment wake stream', 'wake_stream_unavailable');
    }
    if (deliver !== null) this.attachWakeDelivery(deliver);
    return this._wakePlane().subscribe(params, (frame, subscription) => this._deliverToSession(frame, subscription));
  }

  wakeUnsubscribe(params) {
    if (this._wakes === null) {
      throw bridgeError(`no open wake subscription ${typeof params?.subscriptionId === 'string' ? params.subscriptionId : '(non-string id)'}`, 'wake_subscription_not_found');
    }
    return this._wakes.unsubscribe(params?.subscriptionId);
  }

  /** The pull form: ONE bounded page after `since`, with the typed continuation that names the
   * cursor to resume at when the page was cut by the transport's frame ceiling. */
  async wakeSince(params, { maxFrameBytes }) {
    if (typeof this.client.wakesSince !== 'function') {
      throw bridgeError('this Baton connection cannot read the deployment wake stream', 'wake_stream_unavailable');
    }
    const page = await this._onceAfterRebind(() => this.client.wakesSince(wakeFilterParams(params)));
    return boundWakePage(page, maxFrameBytes);
  }

  /** The session is over: the resident connection this plane held is released. */
  closeWakes() {
    const plane = this._wakes;
    this._wakes = null;
    if (plane !== null) plane.close();
  }
}

/**
 * The bridge's open path, answering the facts a session binds to. It is exported because the
 * rebind authority (docs/49 §6.1) IS this derivation: `createBatonWebMcpServer` supplies it as the
 * session's `rediscover`, so a successor incarnation is reached by exactly the discovery, doctor
 * and session establishment the first incarnation was reached by.
 */
export async function openBatonWebConnection(options = {}) {
  const connection = options.connection ?? discoverBatonConnection({
    cwd: options.cwd, env: options.env, home: options.home, ownerUid: options.ownerUid,
  });
  // The ordinary `baton serve` resident publishes `transport: 'local'` over an owner-only Unix
  // socket; reach it exactly the way the CLI does instead of assuming a TCP-reachable URL.
  const fetchImpl = options.fetchImpl ?? (connection.transport === 'local'
    ? createLocalSocketFetch({
      socketPath: connection.socketPath,
      baseUrl: connection.baseUrl,
      ownerUid: options.ownerUid
        ?? (typeof process.getuid === 'function' ? process.getuid() : null),
    })
    : globalThis.fetch);
  if (typeof fetchImpl !== 'function') throw new TypeError('Baton Web MCP requires fetch');
  const client = new BatonWebClient({
    baseUrl: connection.baseUrl,
    origin: connection.origin,
    repoId: connection.repoId,
    token: connection.token,
    // Issue #294: the wake attachment rides the transport the commands ride. A local resident's
    // owner-only Unix socket is where its wake feed lives too, so the client carries it.
    ...(connection.socketPath === undefined ? {} : { socketPath: connection.socketPath }),
    commandTimeoutMs: options.commandTimeoutMs ?? 120_000,
    pollMs: options.pollMs ?? 250,
    // Issue #349: the bridge is the caller that answers under the MCP wire frame, so it DECLARES
    // that frame on the swarm.view envelopes it forwards — the one declaration that lets the
    // resident narrow the answer to fit. The CLI's own client declares none and receives the
    // whole answer; the row is the registry's declared substrate row, never a second constant.
    frameFor: (command) => (command === 'swarm.view' ? { lane: FRAME_LIMITS['wire.frame'].lane } : null),
    fetchImpl,
    clock: options.clock ?? options.now ?? Date.now,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  });
  const doctor = await client.doctor();
  if (doctor?.ready !== true || doctor.application?.repoId !== connection.repoId) {
    throw bridgeError('Remote Baton application is not ready');
  }
  const session = await client.session();
  return Object.freeze({
    client,
    card: doctor.application,
    session,
    incarnation: connection.incarnation ?? null,
  });
}

export async function connectBatonWebApplication(options = {}) {
  const opened = await openBatonWebConnection(options);
  return new BatonWebApplicationFacade(opened.client, opened.card, opened.session, {
    incarnation: opened.incarnation,
    // docs/49 §6.1: the rebind authority re-reads the PUBLICATION — the same open path, the same
    // discovery. A caller that handed an explicit connection (a network deployment, a test double)
    // has no publication to re-read, so its session keeps today's behavior exactly.
    ...(options.connection === undefined
      ? { rediscover: () => openBatonWebConnection({ ...options }) }
      : {}),
  });
}

/** Issue #529 (docs/54 §4): the wake subscription a session takes from its own bridge
 * configuration, read from the environment the deployment publishes a seat's bridge under (the ONE
 * key table, swarm-native-bridge.mjs). A session carrying a seat's swarm coordinates receives that
 * swarm's events; a session without them — an operator's IDE session, a root orchestrator's MCP
 * connection — carries every event the deployment produces. §4.1's narrowing rides the same
 * environment (`autoWake`, the axes the recruit validated), and the returned filter is the
 * design's own shape: a null axis admits everything on it. */
export function wakeAutoSubscription(env = {}) {
  const declared = env?.[SWARM_BRIDGE_ENV_KEYS.swarmId];
  const swarmId = typeof declared === 'string' ? declared.trim() : '';
  const narrowing = wakeNarrowingAxes(env?.[SWARM_BRIDGE_ENV_KEYS.autoWake]);
  return Object.freeze({
    kinds: narrowing.kinds,
    swarms: swarmId.length === 0 ? null : Object.freeze([swarmId]),
    participants: narrowing.participants,
  });
}

/** Issue #529 (docs/54 §4.1): the two axes a published narrowing declares, each null when the
 * seat declared none. A value that is absent, unreadable, or names a class outside the wake
 * stream's closed set leaves the axes whole: the declaration was judged where it was written (the
 * recruit refuses an unknown class before any membership lands), so a corrupted environment
 * variable must never narrow a session's stream to nothing on its own. */
function wakeNarrowingAxes(raw) {
  const whole = Object.freeze({ kinds: null, participants: null });
  if (typeof raw !== 'string' || raw.trim().length === 0) return whole;
  let declared;
  try { declared = JSON.parse(raw); } catch { return whole; }
  if (declared === null || typeof declared !== 'object' || Array.isArray(declared)) return whole;
  try {
    const parsed = parseWakeFilter({
      kinds: declared.kinds ?? null, participants: declared.participants ?? null,
    });
    return Object.freeze({
      kinds: parsed.kinds === null ? null : Object.freeze([...parsed.kinds].sort()),
      participants: parsed.participants === null ? null : Object.freeze([...parsed.participants].sort()),
    });
  } catch { return whole; }
}
export async function createBatonWebMcpServer(options) {
  if (!options?.coordination) throw new TypeError('Baton Web MCP requires local call coordination');
  if (['principalId', 'sessionId', 'sessionTtlMs'].some((field) => Object.hasOwn(options, field))) {
    throw new TypeError('Baton Web MCP identity is remote-authenticated and cannot be overridden');
  }
  const application = await connectBatonWebApplication(options);
  const now = options.now ?? Date.now;
  const principal = application.principal();
  const windowMs = options.quotaWindowMs ?? 60_000;
  const maxCalls = options.maxCallsPerWindow ?? 512;
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0
    || !Number.isSafeInteger(maxCalls) || maxCalls <= 0) {
    throw new TypeError('Baton Web MCP quota is invalid');
  }
  let windowStartedAt = now();
  let calls = 0;
  const takeToolQuota = async () => {
    const current = now();
    if (current - windowStartedAt >= windowMs) {
      windowStartedAt = current;
      calls = 0;
    }
    calls += 1;
    return { ok: calls <= maxCalls };
  };
  const server = new McpFleetServer({
    coordinator: { list() { return []; } },
    coordination: options.coordination,
    application,
    applicationOwned: false,
    surface: 'application',
    bindApplicationContext: true,
    principal,
    repoIds: [application.repoId],
    now,
    admitsCommand: (command) => application._admits(command),
    maxWaitMs: options.maxWaitMs ?? 30_000,
    maxMessageBytes: options.maxMessageBytes ?? 256 * 1024,
    takeToolQuota,
    // Issue #529 (docs/54 §4): the auto-subscription the entry derived for THIS session from its
    // environment (`wakeAutoSubscription`). A caller that keeps no wake stream, or that wants a
    // different filter, passes its own; absent means the session takes none.
    autoWake: options.autoWake ?? null,
  });
  return server;
}

export function kimiBatonMcpEntry({ projectRoot, nodePath, bridgePath }) {
  if (![projectRoot, nodePath, bridgePath].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new TypeError('Kimi Baton MCP entry paths are invalid');
  }
  return Object.freeze({
    command: nodePath,
    args: [bridgePath],
    cwd: projectRoot,
    enabled: true,
    startupTimeoutMs: 30_000,
    toolTimeoutMs: 180_000,
    enabledTools: [...CORE_TOOL_NAMES],
  });
}

/**
 * ACP session/new uses the protocol's stdio descriptor, which is intentionally distinct from
 * Kimi Code's project mcp.json shape above. The bridge discovers its private Baton connection
 * after launch; no bearer token or connection environment is serialized into the ACP request.
 */
export function kimiBatonAcpMcpServer({ projectRoot, nodePath, bridgePath }) {
  if (![projectRoot, nodePath, bridgePath].every((value) => typeof value === 'string' && value.length > 0)) {
    throw new TypeError('Kimi Baton ACP MCP server paths are invalid');
  }
  return Object.freeze({
    name: 'baton',
    command: nodePath,
    args: Object.freeze([bridgePath]),
    env: Object.freeze([]),
  });
}
