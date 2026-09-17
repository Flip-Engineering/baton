import { createHash, randomUUID } from 'node:crypto';

import { BatonWebClient, discoverBatonConnection } from './application-cli.mjs';
import { createLocalSocketFetch } from './local-web-transport.mjs';
import { McpFleetServer } from './mcp-northbound.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from './application-semantics.mjs';
import { SWARM_COMMAND_DEFINITIONS } from './swarm-contract.mjs';
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
  constructor({ open, cadenceMs, now = Date.now }) {
    if (typeof open !== 'function') throw new TypeError('wake subscriptions require an attachment opener');
    // The reconnect cadence is the caller's own deployment cadence (the resident command poll),
    // never a second invented timer constant.
    if (!Number.isSafeInteger(cadenceMs) || cadenceMs <= 0) {
      throw new TypeError('wake subscription cadence must be a positive safe integer');
    }
    if (typeof now !== 'function') throw new TypeError('wake subscription clock must be a function');
    this.open = open;
    this.cadenceMs = cadenceMs;
    this.now = now;
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
    if (this.deliver === null) {
      throw bridgeError('this session cannot receive wake notifications', 'wake_notifications_unavailable');
    }
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
      this._scheduleReconnect();
      return;
    }
    if (attachment === null || typeof attachment !== 'object' || typeof attachment.close !== 'function') {
      try { controller.abort(); } catch { /* nothing to release */ }
      this._announceRefusal(bridgeError('the wake attachment could not be opened', 'wake_stream_unavailable'));
      this._scheduleReconnect();
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

/** Remote application facade: MCP transport lifetime never owns the resident Baton application. */
export class BatonWebApplicationFacade {
  constructor(client, applicationCard, session) {
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
      || !Number.isFinite(Date.parse(session.expiresAt))) {
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
    const live = await this.client.doctor();
    if (!live || typeof live !== 'object' || Array.isArray(live)) {
      throw bridgeError('Remote Baton doctor is unavailable');
    }
    const readiness = live.deployment && typeof live.deployment === 'object' && !Array.isArray(live.deployment)
      ? clone(live.deployment) : {};
    return Object.freeze({
      ...readiness,
      schemaVersion: 1,
      repoId: this.repoId,
      ready: live.ready === true,
    });
  }

  /** U-E17 (#287): re-attest against the CURRENT session, never a construction-time digest. What
   * refuses is a genuine authority change: a different identity, a bound capability the session
   * no longer carries, the served repository leaving the session scope, a revoked flag, or an
   * unparsable expiry. A moved `expiresAt` is a renewal — the session is re-attested, not
   * invalidated. */
  async _reattestSession() {
    const current = await this.client.session();
    const identity = current?.identity;
    const renewed = identity && typeof identity === 'object'
      && identity.userId === this._principal.userId
      && identity.sessionId === this._principal.sessionId
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

  async actionAuthority(args, principal, context = null) {
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

  async _inspectOutline(runId, mutationKey, context) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const outlineKey = `mcp-web-${digest({
        repoId: this.repoId, mutationKey, requestId: contextRequestId(context),
        stage: 'result-outline', attempt,
      })}`;
      try {
        const outline = await this.client.command('run.inspect', { runId, depth: 'outline' }, outlineKey);
        if (!validOutline(outline, runId)) {
          throw bridgeError('Remote Baton returned an invalid Run outline');
        }
        return outline;
      } catch (cause) { lastError = cause; }
    }
    throw lastError;
  }

  async command(name, args, principal, context) {
    if (!this._admits(name)) throw this._notAdmitted(name);
    if (!validContext(context)) {
      throw bridgeError('Remote Baton MCP command authority is invalid: the call context is malformed', 'application_unauthorized');
    }
    await this._attestSession(principal, context);
    // Issue #344: the keyed set is the registry's, never a second hand-kept list — every
    // mcpStateful command (the swarm family's keyed verbs included) derives its forwarded key
    // over every argument axis (_mutationKey), so a changed axis mints a fresh key and an
    // identical request replays the admitted one. Reads keep the transport-derived key.
    const keyed = MUTATIONS.has(name) || SWARM_COMMAND_DEFINITIONS[name]?.mcpStateful === true;
    const idempotencyKey = keyed
      ? this._mutationKey(name, args, principal)
      : `mcp-web-${digest({ repoId: this.repoId, key: context.idempotencyKey })}`;
    const result = await this.client.command(name, args, idempotencyKey);
    if (!['run.start', 'run.stop'].includes(name)) return result;

    const requestedRunId = name === 'run.start' ? args.intent.runId ?? null : args.runId;
    const runId = result?.runId ?? requestedRunId;
    if (!SAFE_RUN_ID.test(runId ?? '') || (requestedRunId !== null && runId !== requestedRunId)) {
      throw bridgeError(`Remote Baton ${name} returned a mismatched Run identity`);
    }
    return this._inspectOutline(runId, idempotencyKey, context);
  }

  /** Issue #294: the session's one wake plane, created on first use. */
  _wakePlane() {
    if (this._wakes === null) {
      this._wakes = new WakeSubscriptions({
        open: (options) => this.client.wakes(options),
        // The reconnect cadence IS the connection's own command cadence: no second timer constant
        // is invented here, and a deployment that polls faster reconnects faster.
        cadenceMs: this.client.pollMs,
      });
    }
    return this._wakes;
  }

  /** Open one wake subscription. `deliver(subscription, frame)` is how a frame reaches THIS
   * session's client; the server supplies its own notification emitter. */
  wakeSubscribe(params, deliver) {
    if (typeof this.client.wakes !== 'function') {
      throw bridgeError('this Baton connection cannot attach the deployment wake stream', 'wake_stream_unavailable');
    }
    return this._wakePlane().subscribe(params, deliver);
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
    const page = await this.client.wakesSince(wakeFilterParams(params));
    return boundWakePage(page, maxFrameBytes);
  }

  /** The session is over: the resident connection this plane held is released. */
  closeWakes() {
    const plane = this._wakes;
    this._wakes = null;
    if (plane !== null) plane.close();
  }
}

export async function connectBatonWebApplication(options = {}) {
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
    fetchImpl,
    clock: options.clock ?? options.now ?? Date.now,
    sleep: options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  });
  const doctor = await client.doctor();
  if (doctor?.ready !== true || doctor.application?.repoId !== connection.repoId) {
    throw bridgeError('Remote Baton application is not ready');
  }
  const session = await client.session();
  return new BatonWebApplicationFacade(client, doctor.application, session);
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
    enabledTools: ['baton_help', 'baton_runs', 'baton_run_start', 'baton_run_inspect', 'baton_run_episode',
      'baton_run_workstreams', 'baton_workstream_notify', 'baton_workstream_stop',
      'baton_run_act', 'baton_run_stop', 'baton_waves_attach',
      'baton_run_do', 'baton_run_view', 'baton_run_member_view', 'baton_run_member_send',
      'baton_run_member_stop', 'baton_application_help'],
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
