import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(value).digest();
const jsonDigest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const string = (value) => typeof value === 'string' && value.length > 0;
const actor = (principal) => `web:${principal.userId}:${principal.sessionId}`;
const response = (status, code, extra = {}) => ({ status, body: { ok: false, error: { code }, ...extra } });
const positiveInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive safe integer`);
  return value;
};
const nonNegativeInteger = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return value;
};
const GOAL_PLAN_EVENT_KINDS = new Set(['goal.version_defined', 'plan.version_proposed', 'plan.approval_decided', 'plan.node_dispatched', 'plan.node_budget_settled']);
const GOAL_PLAN_WEB_COMMANDS = new Set(['goal_define', 'plan_propose', 'plan_approve', 'goal_plan_status']);
const GOAL_PLAN_MCP_TOOLS = new Set(['fleet_goal_define', 'fleet_plan_propose', 'fleet_plan_approve', 'fleet_goal_plan_status']);
const AUTHORITY_FIELDS = new Set([
  'admissionDigest', 'authorityDigest', 'leaseDigest', 'requestDigest', 'revocationDigest',
  'credentialId', 'credentialDigest', 'principalId', 'principalDigest', 'proposerPrincipalId',
  'sessionAuthorityDigest', 'sessionId', 'sessionDigest', 'userId', 'tokenDigest', 'csrfTokenDigest',
]);
const RUN_CHANNELS = new Set(['progress', 'events', 'output']);
const OPAQUE_CURSOR = /^[A-Za-z0-9_-]{1,4096}$/u;
const HEX_DIGEST = /^[a-f0-9]{64}$/u;
const RUN_FACT_FIELDS = new Set([
  'accept', 'accepted', 'alreadyTerminal', 'attempt', 'byteCount', 'decision',
  'dispatchClosed', 'fileCount', 'from', 'interactionsResolved', 'killConfirmed',
  'limit', 'outcome', 'pendingCancelled', 'phase', 'processesClosed',
  'processesObserved', 'ratio', 'remainingCallCount', 'remainingCellCount',
  'remainingCount', 'remainingSessionCount', 'result', 'resultOutcome',
  'resultState', 'resultStatus', 'runAuthorityReleased', 'state', 'status',
  'targetCallCount', 'targetCellCount', 'targetCount', 'targetSessionCount',
  'terminal', 'to', 'tokenCount', 'used',
]);
const TERMINAL_CAUSE_FIELDS = new Set([
  'kind', 'code', 'category', 'summary', 'remediation', 'retryable',
  'dimension', 'used', 'limit', 'ratio',
]);
const TIMING_FIELDS = new Set([
  'startedAt', 'observedAt', 'elapsedMs', 'lastProgress', 'silenceMs', 'completedAt',
]);

function optionalScalar(value) {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || Number.isSafeInteger(value) || (typeof value === 'number' && Number.isFinite(value));
}

function closedScalars(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = {};
  for (const key of allowed) if (Object.hasOwn(value, key) && optionalScalar(value[key])) {
    result[key] = value[key];
  }
  return result;
}

function projectTerminalCause(value) {
  if (value === null || value === undefined) return null;
  return closedScalars(value, TERMINAL_CAUSE_FIELDS);
}

function projectRunOutline(value) {
  const outline = value?.outline;
  if (!outline || typeof outline !== 'object' || Array.isArray(outline)) {
    throw new TypeError('Run outline projection is invalid');
  }
  const projectedOutline = {};
  for (const key of ['objective', 'phase', 'narrative', 'risk', 'stage']) {
    if (Object.hasOwn(outline, key) && optionalScalar(outline[key])) projectedOutline[key] = outline[key];
  }
  const timing = closedScalars(outline, TIMING_FIELDS);
  Object.assign(projectedOutline, timing ?? {});
  if (outline.progress && typeof outline.progress === 'object' && !Array.isArray(outline.progress)) {
    projectedOutline.progress = closedScalars(outline.progress,
      new Set(['current', 'summary', 'completed', 'total', 'state'])) ?? {};
  }
  if (outline.attention && typeof outline.attention === 'object' && !Array.isArray(outline.attention)) {
    projectedOutline.attention = closedScalars(outline.attention,
      new Set(['state', 'count', 'summary'])) ?? {};
  }
  projectedOutline.terminalCause = projectTerminalCause(outline.terminalCause);
  if (outline.resources && typeof outline.resources === 'object' && !Array.isArray(outline.resources)) {
    projectedOutline.resources = {
      ...(closedScalars(outline.resources, new Set(['state', 'ownedCount', 'cleanupState'])) ?? {}),
      terminalCause: projectTerminalCause(outline.resources.terminalCause),
    };
  }
  if (outline.preservation && typeof outline.preservation === 'object'
    && !Array.isArray(outline.preservation)) {
    projectedOutline.preservation = closedScalars(outline.preservation,
      new Set(['state', 'resumeAvailable', 'summary'])) ?? {};
  }
  return {
    schemaVersion: 1, runId: value.runId, depth: 'outline', cursor: value.cursor,
    terminal: value.terminal === true, outline: projectedOutline,
  };
}

function projectRunProgress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.schemaVersion !== 1 || value.kind !== 'baton.run_progress'
    || !string(value.runId) || typeof value.terminal !== 'boolean') {
    throw new TypeError('Run progress projection is invalid');
  }
  const projected = {
    schemaVersion: 1, kind: 'baton.run_progress', runId: value.runId,
  };
  for (const key of ['phase', 'stage', 'summary']) {
    if (Object.hasOwn(value, key) && optionalScalar(value[key])) projected[key] = value[key];
  }
  if (value.attention && typeof value.attention === 'object' && !Array.isArray(value.attention)) {
    projected.attention = closedScalars(value.attention, new Set(['state', 'count'])) ?? {};
  }
  projected.terminal = value.terminal;
  projected.terminalCause = projectTerminalCause(value.terminalCause);
  if (value.resources && typeof value.resources === 'object' && !Array.isArray(value.resources)) {
    projected.resources = closedScalars(value.resources, new Set(['state', 'ownedCount'])) ?? {};
  }
  if (value.timing && typeof value.timing === 'object' && !Array.isArray(value.timing)) {
    projected.timing = closedScalars(value.timing, TIMING_FIELDS) ?? {};
  }
  return projected;
}

function projectRunTimelineItem(value, runId, channel, recipient) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || value.runId !== runId || !Number.isSafeInteger(value.position) || value.position <= 0
    || !string(value.kind) || !string(value.category)
    || !string(value.summary) && channel === 'events'
    || value.occurrenceTrust !== 'authoritative'
    || !HEX_DIGEST.test(value.occurrenceDigest ?? '')) {
    throw new TypeError('Run timeline item projection is invalid');
  }
  const base = {
    runId, position: value.position, category: value.category, kind: value.kind,
    ...(string(value.at) ? { at: value.at } : {}),
    ...(string(value.summary) ? { summary: value.summary } : {}),
    occurrenceTrust: 'authoritative', occurrenceDigest: value.occurrenceDigest,
  };
  if (channel === 'events') {
    if (string(value.recipient)) base.recipient = value.recipient;
    base.facts = closedScalars(value.facts, RUN_FACT_FIELDS) ?? {};
    return base;
  }
  const output = value.output;
  if (value.category !== 'output' || value.kind !== 'untrusted_output'
    || value.contentTrust !== 'untrusted_provider' || !string(value.recipient)
    || (recipient !== null && value.recipient !== recipient)
    || !output || typeof output !== 'object' || Array.isArray(output)
    || typeof output.text !== 'string' || !Number.isSafeInteger(output.fragment)
    || output.fragment < 0 || !Number.isSafeInteger(output.fragmentCount)
    || output.fragmentCount <= 0 || output.fragment >= output.fragmentCount
    || !HEX_DIGEST.test(output.digest ?? '')) {
    throw new TypeError('Run provider output projection is invalid');
  }
  return {
    ...base, recipient: value.recipient, contentTrust: 'untrusted_provider',
    output: {
      text: output.text, fragment: output.fragment,
      fragmentCount: output.fragmentCount, digest: output.digest,
    },
  };
}

function projectRunTimelinePage(value, runId, channel, recipient, terminal, viewCursor) {
  return {
    schemaVersion: 1, kind: 'baton.run_timeline.page', runId, channel,
    ...(recipient === null ? {} : { recipient }), cursor: value.cursor,
    hasMore: value.hasMore, itemCount: value.items.length,
    items: value.items.map((item) => projectRunTimelineItem(item, runId, channel, recipient)),
    terminal, viewCursor,
  };
}

function runCoordinates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !Object.keys(value).every((key) => ['repoId', 'runId', 'channel', 'recipient', 'cursor', 'snapshot'].includes(key))
    || !string(value.repoId) || !string(value.runId) || !RUN_CHANNELS.has(value.channel)
    || (value.recipient !== undefined && (!string(value.recipient) || value.recipient.length > 256))
    || (value.channel !== 'output' && value.recipient !== undefined)
    || (value.cursor !== undefined && (value.channel === 'progress'
      ? !Number.isSafeInteger(value.cursor) || value.cursor < 0
      : typeof value.cursor !== 'string' || !OPAQUE_CURSOR.test(value.cursor)))) return null;
  return {
    repoId: value.repoId, runId: value.runId, channel: value.channel,
    recipient: value.recipient ?? null, startingCursor: value.cursor ?? null,
    snapshot: value.snapshot == null ? null : clone(value.snapshot),
  };
}

export class WebEventStream {
  constructor(opts) {
    if (!opts?.coordination || typeof opts.coordination.snapshot !== 'function'
      || typeof opts.coordination.events !== 'function'
      || typeof opts.coordination.recordWebAudit !== 'function') {
      throw new TypeError('web stream requires coordination authority');
    }
    this.coordination = opts.coordination;
    this.application = opts.application ?? null;
    if (this.application !== null && typeof this.application.command !== 'function') {
      throw new TypeError('web Run stream application facade is invalid');
    }
    this.allowedOrigins = new Set(opts.allowedOrigins ?? []);
    this.repoIds = new Set(opts.repoIds ?? []);
    if (this.repoIds.size > 1) throw new TypeError('one coordination authority may serve exactly one repository');
    this.now = opts.now ?? Date.now;
    this.ticketTtlMs = positiveInteger(opts.ticketTtlMs ?? 15_000, 'ticketTtlMs');
    this.replayLimit = nonNegativeInteger(opts.replayLimit ?? 1_000, 'replayLimit');
    this.maxBufferedBytes = positiveInteger(opts.maxBufferedBytes ?? 256 * 1024, 'maxBufferedBytes');
    this.maxFrameBytes = positiveInteger(opts.maxFrameBytes ?? this.maxBufferedBytes, 'maxFrameBytes');
    this.maxControlFrameBytes = positiveInteger(opts.maxControlFrameBytes ?? 2 * 1024, 'maxControlFrameBytes');
    this.maxTickets = positiveInteger(opts.maxTickets ?? 1_000, 'maxTickets');
    this.maxConnections = positiveInteger(opts.maxConnections ?? 100, 'maxConnections');
    this.maxEventsPerPump = positiveInteger(opts.maxEventsPerPump ?? 100, 'maxEventsPerPump');
    this.pollMs = positiveInteger(opts.pollMs ?? 100, 'pollMs');
    this.incarnation = opts.incarnation ?? this.application?.card?.()?.resident?.incarnation
      ?? `web-${randomUUID()}`;
    if (!string(this.incarnation)) throw new TypeError('web stream incarnation is invalid');
    if (opts.isPrincipalActive != null && typeof opts.isPrincipalActive !== 'function') throw new TypeError('isPrincipalActive must be a function');
    this.isPrincipalActive = opts.isPrincipalActive ?? null;
    if (opts.acquireConnection != null && typeof opts.acquireConnection !== 'function') throw new TypeError('acquireConnection must be a function');
    if (opts.releaseConnection != null && typeof opts.releaseConnection !== 'function') throw new TypeError('releaseConnection must be a function');
    this.acquireConnection = opts.acquireConnection ?? null;
    this.releaseConnection = opts.releaseConnection ?? null;
    if (opts.credentialDigest != null && typeof opts.credentialDigest !== 'function') throw new TypeError('credentialDigest must be a function');
    this.credentialDigest = opts.credentialDigest ?? null;
    this.tickets = new Map();
    this.activeConnections = 0;
    this.connections = new Set();
    this.accepting = true;
  }

  _audit(kind, principal, origin, details = {}) {
    return this.coordination.recordWebAudit({
      kind, userId: principal?.userId ?? null, sessionId: principal?.sessionId ?? null,
      credentialDigest: principal?.credentialId && this.credentialDigest ? this.credentialDigest(principal.credentialId) : null,
      originClass: origin == null ? 'missing' : this.allowedOrigins.has(origin) ? 'allowed' : 'disallowed', ...clone(details),
    }, { actor: principal ? actor(principal) : 'web:anonymous', key: `web.audit:${randomUUID()}` });
  }

  _authorized(principal, origin, repoId) {
    const expiry = Date.parse(principal?.expiresAt);
    return string(principal?.userId) && string(principal?.sessionId) && string(principal?.credentialId)
      && principal.revoked !== true && Number.isFinite(expiry) && expiry > this.now()
      && this.allowedOrigins.has(origin) && this.repoIds.has(repoId)
      && Array.isArray(principal.repoIds) && principal.repoIds.includes(repoId)
      && Array.isArray(principal.capabilities) && principal.capabilities.includes('observe');
  }

  _liveAuthorized(principal, origin, repoId) {
    if (!this._authorized(principal, origin, repoId)) return false;
    if (!this.isPrincipalActive) return true;
    try { return this.isPrincipalActive(principal, { origin, repoId }) === true; }
    catch { return false; }
  }

  issue(principal, origin, scope) {
    const coordinates = typeof scope === 'string' ? null : runCoordinates(scope);
    if (typeof scope !== 'string' && coordinates === null) {
      return response(403, 'forbidden');
    }
    if (coordinates && (coordinates.snapshot?.runId !== coordinates.runId
      || coordinates.snapshot?.depth !== 'outline'
      || !Number.isSafeInteger(coordinates.snapshot?.cursor))) {
      return response(503, 'temporarily_unavailable');
    }
    return this._issue(principal, origin, scope, coordinates);
  }

  _issue(principal, origin, scope, coordinates) {
    if (!this.accepting) return response(503, 'temporarily_unavailable');
    this._pruneTickets();
    const repoId = typeof scope === 'string' ? scope : coordinates.repoId;
    if (!this.authorizeIssue(principal, origin, scope)) {
      try { this._audit('stream_ticket_refused', principal, origin, { repoId, reason: 'forbidden' }); }
      catch { return response(503, 'temporarily_unavailable'); }
      return response(principal ? 403 : 401, principal ? 'forbidden' : 'unauthenticated');
    }
    if (this.tickets.size >= this.maxTickets) {
      try { this._audit('stream_ticket_refused', principal, origin, { repoId, reason: 'ticket_limit' }); }
      catch { return response(503, 'temporarily_unavailable'); }
      return response(429, 'rate_limited');
    }
    const secret = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const expiresAt = this.now() + this.ticketTtlMs;
    const state = {
      hash: digest(secret), expiresAt, userId: principal.userId,
      sessionId: principal.sessionId, credentialId: principal.credentialId, repoId, origin,
      ...(coordinates ? {
        runId: coordinates.runId, channel: coordinates.channel,
        recipient: coordinates.recipient, startingCursor: coordinates.startingCursor,
        snapshot: coordinates.snapshot, incarnation: this.incarnation,
      } : {}),
    };
    try { this._audit('stream_ticket_issued', principal, origin, {
      repoId, ticketId: id,
      ...(coordinates ? {
        runId: coordinates.runId, channel: coordinates.channel,
        ...(coordinates.recipient ? { recipient: coordinates.recipient } : {}),
      } : {}),
    }); }
    catch { return response(503, 'temporarily_unavailable'); }
    this.tickets.set(id, state);
    return { status: 201, body: { ok: true, ticket: `${id}.${secret}`, expiresAt: new Date(expiresAt).toISOString() } };
  }

  beginIssue(principal, origin, scope) {
    const issued = this.issue(principal, origin, scope);
    if (issued.status !== 201) return { response: issued, commit: () => false, rollback: () => false };
    const id = issued.body.ticket.slice(0, issued.body.ticket.indexOf('.'));
    const state = this.tickets.get(id);
    let active = true;
    return {
      response: issued,
      commit: () => { if (!active) return false; active = false; return true; },
      rollback: () => {
        if (!active) return false;
        active = false;
        if (this.tickets.get(id) !== state) return false;
        this.tickets.delete(id);
        try { this._audit('stream_ticket_delivery_failed', principal, origin, { repoId: state.repoId, ticketId: id }); } catch { /* compensating cleanup cannot be undone */ }
        return true;
      },
    };
  }

  authorizeIssue(principal, origin, scope) {
    try {
      const coordinates = typeof scope === 'string' ? null : runCoordinates(scope);
      const repoId = typeof scope === 'string' ? scope : coordinates?.repoId;
      return this.accepting && string(repoId) && this._liveAuthorized(principal, origin, repoId)
        && (typeof scope === 'string' || (coordinates !== null && this.application !== null));
    }
    catch { return false; }
  }

  _pruneTickets() {
    const now = this.now();
    for (const [id, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(id);
  }

  consume(value, principal, origin) {
    this._pruneTickets();
    const split = typeof value === 'string' ? value.indexOf('.') : -1;
    const id = split > 0 ? value.slice(0, split) : '';
    const secret = split > 0 ? value.slice(split + 1) : '';
    const found = this.tickets.get(id);
    const presented = digest(secret);
    const valid = found && found.expiresAt > this.now()
      && timingSafeEqual(presented, found.hash)
      && found.userId === principal?.userId && found.sessionId === principal?.sessionId
      && found.credentialId === principal?.credentialId
      && found.origin === origin && this._liveAuthorized(principal, origin, found.repoId);
    if (!valid) return null;
    this.tickets.delete(id);
    return { id, ...found, hash: undefined };
  }

  open({ ticket, principal, origin, cursor }, res) {
    if (!this.accepting) return response(503, 'temporarily_unavailable');
    let lease = null;
    if (this.acquireConnection) {
      lease = this.acquireConnection(principal);
      if (!lease?.ok) {
        try { this._audit('stream_refused', principal, origin, { reason: 'principal_connection_limit' }); }
        catch { return response(503, 'temporarily_unavailable'); }
        return { ...response(429, 'rate_limited'), headers: { 'retry-after': String(lease?.retryAfter ?? 1) } };
      }
    }
    if (this.activeConnections >= this.maxConnections) {
      if (lease && this.releaseConnection) this.releaseConnection(principal);
      try { this._audit('stream_refused', principal, origin, { reason: 'connection_limit' }); }
      catch { return response(503, 'temporarily_unavailable'); }
      return { ...response(429, 'rate_limited'), headers: { 'retry-after': '1' } };
    }
    const grant = this.consume(ticket, principal, origin);
    if (!grant) {
      if (lease && this.releaseConnection) this.releaseConnection(principal);
      try { this._audit('stream_refused', principal, origin, { reason: 'invalid_ticket' }); }
      catch { return response(503, 'temporarily_unavailable'); }
      return response(principal ? 403 : 401, principal ? 'forbidden' : 'unauthenticated');
    }
    if (grant.channel) return this._openRun({ grant, principal, origin, cursor, lease }, res);

    let snapshot;
    try { snapshot = this.coordination.snapshot(); }
    catch {
      try { this._audit('stream_refused', principal, origin, { repoId: grant.repoId, reason: 'snapshot_unavailable' }); }
      catch { if (lease && this.releaseConnection) this.releaseConnection(principal); return response(503, 'temporarily_unavailable'); }
      if (lease && this.releaseConnection) this.releaseConnection(principal);
      return response(503, 'temporarily_unavailable');
    }
    const boundary = snapshot.lastSeq;
    snapshot = this._projectSnapshot(snapshot, principal);
    const requested = cursor == null || cursor === '' ? null : Number(cursor);
    if (requested !== null && (!Number.isSafeInteger(requested)
      || requested < Math.max(0, boundary - this.replayLimit) || requested > boundary)) {
      try { this._audit('stream_snapshot_required', principal, origin, {
        repoId: grant.repoId, requestedCursor: Number.isSafeInteger(requested) ? requested : null, boundary,
      }); } catch { if (lease && this.releaseConnection) this.releaseConnection(principal); return response(503, 'temporarily_unavailable'); }
      if (lease && this.releaseConnection) this.releaseConnection(principal);
      return response(409, 'snapshot_required', { snapshotCursor: boundary });
    }

    const streamId = randomUUID();
    let next = requested === null ? boundary + 1 : requested + 1;
    let closed = false;
    let timer;
    let endRequested = false;
    const frame = (type, cursorValue, eventId, payload) => ({
      schemaVersion: 1, streamId, cursor: cursorValue, eventId,
      provenance: 'coordination-authority', occurrenceTrust: 'authoritative',
      contentTrust: type === 'snapshot' ? 'mixed' : this._contentTrust(payload),
      resource: { repoId: grant.repoId }, type, payload,
    });
    const encode = (type, id, value) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
    const writeControl = (control) => {
      const bytes = Buffer.byteLength(control);
      if (bytes > this.maxControlFrameBytes
        || (res.writableLength ?? 0) + bytes > this.maxBufferedBytes) return false;
      try { return res.write(control) !== false; } catch { return false; }
    };
    const endSocket = () => {
      if (endRequested) return;
      endRequested = true;
      try { res.end(); } catch { /* the socket is already terminal */ }
    };
    const disconnect = (kind = 'stream_disconnected') => {
      if (closed) return;
      closed = true;
      this.activeConnections -= 1;
      if (timer) clearInterval(timer);
      this.connections.delete(closeForShutdown);
      if (lease && this.releaseConnection) { this.releaseConnection(principal); lease = null; }
      try { this._audit(kind, principal, origin, { repoId: grant.repoId, streamId, cursor: next - 1 }); } catch { /* never turn stream loss into fleet control */ }
    };
    const closeForShutdown = () => {
      if (closed) return;
      const control = 'event: shutdown\ndata: {"reconnect":true}\n\n';
      writeControl(control);
      disconnect('stream_shutdown');
      endSocket();
    };
    const send = (event) => {
      const value = frame('coordination', event.seq, `coordination:${event.seq}`, event);
      const encoded = encode('coordination', event.seq, value);
      if (Buffer.byteLength(encoded) > this.maxFrameBytes
        || (res.writableLength ?? 0) + Buffer.byteLength(encoded) > this.maxBufferedBytes) {
        const lag = frame('lag', next - 1, `lag:${streamId}`, { code: 'backpressure', reconnect: true });
        const control = encode('lag', next - 1, lag);
        writeControl(control);
        disconnect('stream_backpressure_disconnect');
        endSocket();
        return false;
      }
      const accepted = res.write(encoded);
      next = event.seq + 1;
      if (accepted === false) {
        disconnect('stream_backpressure_disconnect');
        endSocket();
        return false;
      }
      return true;
    };

    let initial = null;
    if (requested === null) {
      const value = frame('snapshot', boundary, `snapshot:${boundary}`, { seq: boundary, snapshot: clone(snapshot) });
      initial = encode('snapshot', boundary, value);
      const initialBytes = Buffer.byteLength(initial);
      if (initialBytes > this.maxFrameBytes
        || (res.writableLength ?? 0) + initialBytes > this.maxBufferedBytes) {
        try { this._audit('stream_refused', principal, origin, { repoId: grant.repoId, reason: 'snapshot_too_large', boundary }); }
        catch { if (lease && this.releaseConnection) this.releaseConnection(principal); return response(503, 'temporarily_unavailable'); }
        if (lease && this.releaseConnection) this.releaseConnection(principal);
        return response(503, 'temporarily_unavailable', { snapshotCursor: boundary });
      }
    }
    try { this._audit('stream_connected', principal, origin, { repoId: grant.repoId, streamId, cursor: requested ?? boundary }); }
    catch { if (lease && this.releaseConnection) this.releaseConnection(principal); return response(503, 'temporarily_unavailable'); }
    this.activeConnections += 1;
    this.connections.add(closeForShutdown);
    const pump = () => {
      if (closed) return;
      try {
        if (!this._liveAuthorized(principal, origin, grant.repoId)) {
          disconnect('stream_authorization_lost');
          endSocket();
          return;
        }
        for (const event of this.coordination.events(next, this.maxEventsPerPump)) {
          if (!this._liveAuthorized(principal, origin, grant.repoId)) {
            disconnect('stream_authorization_lost');
            endSocket();
            return;
          }
          const projected = this._projectEvent(event, principal);
          if (projected === null) { next = event.seq + 1; continue; }
          if (!send(projected)) break;
        }
      } catch {
        disconnect('stream_read_failed');
        endSocket();
      }
    };
    let headersStarted = false;
    try {
      res.on?.('close', () => disconnect());
      res.on?.('error', () => disconnect());
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
        connection: 'keep-alive', 'x-accel-buffering': 'no',
        'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        vary: 'Origin', 'x-content-type-options': 'nosniff',
      });
      headersStarted = true;
      if (initial && res.write(initial) === false) {
        disconnect('stream_backpressure_disconnect');
        endSocket();
        return null;
      }
      pump();
      if (!closed) {
        timer = setInterval(pump, this.pollMs);
        timer.unref?.();
      }
    } catch {
      disconnect('stream_setup_failed');
      if (headersStarted) {
        endSocket();
        return null;
      }
      return response(503, 'temporarily_unavailable');
    }
    return null;
  }

  _runFrame(grant, streamId, type, cursor, payload, sourceState) {
    const source = {
      operation: 'run.inspect', repoId: grant.repoId, runId: grant.runId,
      channel: grant.channel, viewCursor: sourceState.viewCursor,
      channelCursor: sourceState.channelCursor,
      ...(grant.recipient ? { recipient: grant.recipient } : {}),
    };
    return {
      schemaVersion: 1, streamId, cursor,
      eventId: type === 'snapshot' ? `snapshot:${grant.runId}:${sourceState.viewCursor}`
        : ['lag', 'shutdown'].includes(type) ? `${type}:${streamId}` : String(cursor),
      provenance: {
        authority: 'run-application', source, digest: jsonDigest(payload),
      },
      occurrenceTrust: 'authoritative',
      contentTrust: type === 'output' ? 'untrusted_provider'
        : type === 'events' ? 'excluded' : 'safe_projection',
      resource: {
        repoId: grant.repoId, runId: grant.runId, channel: grant.channel,
        ...(grant.recipient ? { recipient: grant.recipient } : {}),
      },
      type, payload,
    };
  }

  async _runOutline(grant, principal) {
    const inspected = await this.application.command('run.inspect', {
      runId: grant.runId, depth: 'outline',
    }, {
      actor: actor(principal), principalId: principal.userId, sessionId: principal.sessionId,
    }, { transport: 'web-stream', requestId: randomUUID() });
    if (inspected?.runId !== grant.runId || inspected?.depth !== 'outline'
      || !Number.isSafeInteger(inspected.cursor) || typeof inspected.terminal !== 'boolean'
      || !inspected.outline || typeof inspected.outline !== 'object'
      || Array.isArray(inspected.outline)) {
      throw new TypeError('Run outline projection is invalid');
    }
    return projectRunOutline(inspected);
  }

  async _runRead(grant, principal, state) {
    const observer = {
      actor: actor(principal), principalId: principal.userId, sessionId: principal.sessionId,
    };
    const context = { transport: 'web-stream', requestId: randomUUID() };
    if (grant.channel === 'progress') {
      const inspected = await this.application.command('run.inspect', {
        runId: grant.runId, depth: 'content', section: 'execution', item: 'execution:progress',
      }, observer, context);
      if (inspected?.runId !== grant.runId || inspected?.depth !== 'content'
        || inspected?.content?.kind !== 'baton.run_progress'
        || inspected.content.runId !== grant.runId || !Number.isSafeInteger(inspected.cursor)
        || typeof inspected.terminal !== 'boolean'
        || inspected.cursor < 0 || inspected.content.terminal !== inspected.terminal) {
        throw new TypeError('Run progress projection is invalid');
      }
      if (state.viewCursor > inspected.cursor) {
        throw Object.assign(new Error('Run progress cursor is ahead of durable authority'), {
          code: 'run_progress_cursor_mismatch',
        });
      }
      const content = projectRunProgress(inspected.content);
      const progressDigest = jsonDigest(content);
      const changed = state.viewCursor < inspected.cursor
        || (state.progressDigest !== undefined && state.progressDigest !== progressDigest);
      return {
        state: { viewCursor: inspected.cursor, progressDigest }, terminal: inspected.terminal === true,
        hasMore: false,
        payload: changed || inspected.terminal === true ? content : null,
        cursor: inspected.cursor,
      };
    }
    const inspected = await this.application.command('run.inspect', {
      runId: grant.runId, depth: 'content', section: 'execution',
      item: grant.channel === 'events' ? 'execution:events' : 'execution:output',
      ...(state.timelineCursor === null ? {} : { pageCursor: state.timelineCursor }),
      ...(grant.recipient ? { recipient: grant.recipient } : {}),
    }, observer, context);
    const content = inspected?.content;
    if (inspected?.runId !== grant.runId || inspected?.depth !== 'content'
      || !Number.isSafeInteger(inspected.cursor) || content?.kind !== 'baton.run_timeline.page'
      || content.runId !== grant.runId || content.channel !== grant.channel
      || !OPAQUE_CURSOR.test(content.cursor ?? '') || !Array.isArray(content.items)
      || typeof inspected.terminal !== 'boolean' || typeof content.hasMore !== 'boolean'
      || (content.hasMore && content.items.length === 0)
      || content.itemCount !== content.items.length
      || (grant.recipient === null ? Object.hasOwn(content, 'recipient')
        : content.recipient !== grant.recipient)
      || content.items.some((entry) => entry?.runId !== grant.runId
        || entry?.occurrenceTrust !== 'authoritative'
        || (grant.channel === 'output' && (entry.contentTrust !== 'untrusted_provider'
          || entry.recipient !== (grant.recipient ?? entry.recipient))))) {
      throw new TypeError('Run timeline projection is invalid');
    }
    const terminal = inspected.terminal === true && content.hasMore !== true;
    return {
      state: { timelineCursor: content.cursor, viewCursor: inspected.cursor },
      terminal, hasMore: content.hasMore === true, cursor: content.cursor,
      payload: content.items.length > 0 || terminal
        ? projectRunTimelinePage(content, grant.runId, grant.channel, grant.recipient,
          terminal, inspected.cursor)
        : null,
    };
  }

  async _openRun({ grant, principal, origin, cursor, lease }, res) {
    const release = () => {
      if (lease && this.releaseConnection) {
        this.releaseConnection(principal);
        lease = null;
      }
    };
    const requested = cursor == null || cursor === '' ? null : String(cursor);
    const boundCursor = grant.startingCursor == null ? null : String(grant.startingCursor);
    if (grant.incarnation !== this.incarnation || requested !== boundCursor) {
      release();
      try { this._audit('stream_snapshot_required', principal, origin, {
        repoId: grant.repoId, runId: grant.runId, channel: grant.channel,
        reason: grant.incarnation !== this.incarnation ? 'incarnation_mismatch' : 'cursor_mismatch',
      }); } catch { return response(503, 'temporarily_unavailable'); }
      return response(409, 'snapshot_required');
    }
    if (!grant.snapshot || grant.snapshot.runId !== grant.runId
      || grant.snapshot.depth !== 'outline' || !Number.isSafeInteger(grant.snapshot.cursor)) {
      release();
      return response(503, 'temporarily_unavailable');
    }
    const streamId = randomUUID();
    let state;
    let first;
    let initialSnapshot;
    try {
      if (!this._liveAuthorized(principal, origin, grant.repoId)) throw Object.assign(new Error('authorization lost'), { code: 'application_unauthorized' });
      initialSnapshot = await this._runOutline(grant, principal);
      if (!this._liveAuthorized(principal, origin, grant.repoId)) {
        throw Object.assign(new Error('authorization lost'), { code: 'application_unauthorized' });
      }
      if (grant.incarnation !== this.incarnation) {
        throw Object.assign(new Error('resident incarnation changed'), { code: 'run_stream_boundary_drift' });
      }
      state = grant.channel === 'progress'
        ? { viewCursor: grant.startingCursor ?? initialSnapshot.cursor }
        : { timelineCursor: grant.startingCursor, viewCursor: initialSnapshot.cursor };
      first = await this._runRead(grant, principal, state);
      if (!this._liveAuthorized(principal, origin, grant.repoId)) {
        throw Object.assign(new Error('authorization lost'), { code: 'application_unauthorized' });
      }
      if (grant.incarnation !== this.incarnation) {
        throw Object.assign(new Error('resident incarnation changed'), { code: 'run_stream_boundary_drift' });
      }
      const closingSnapshot = await this._runOutline(grant, principal);
      if (!this._liveAuthorized(principal, origin, grant.repoId)) {
        throw Object.assign(new Error('authorization lost'), { code: 'application_unauthorized' });
      }
      if (grant.incarnation !== this.incarnation
        || closingSnapshot.cursor !== initialSnapshot.cursor
        || first.state.viewCursor !== initialSnapshot.cursor) {
        throw Object.assign(new Error('Run stream initial boundary drifted'), {
          code: 'run_stream_boundary_drift',
        });
      }
      initialSnapshot = closingSnapshot;
      if (!this.accepting) {
        release();
        return response(503, 'temporarily_unavailable');
      }
    } catch (cause) {
      release();
      const cursorFailure = ['run_progress_cursor_mismatch', 'run_stream_boundary_drift', 'run_timeline_cursor_invalid', 'run_timeline_cursor_mismatch'].includes(cause?.code);
      try { this._audit(cursorFailure ? 'stream_snapshot_required' : 'stream_refused', principal, origin, {
        repoId: grant.repoId, runId: grant.runId, channel: grant.channel,
        reason: cursorFailure ? 'cursor_mismatch' : cause?.code === 'application_unauthorized' ? 'forbidden' : 'read_failed',
      }); } catch { return response(503, 'temporarily_unavailable'); }
      return cursorFailure ? response(409, 'snapshot_required')
        : cause?.code === 'application_unauthorized' ? response(403, 'forbidden')
          : response(503, 'temporarily_unavailable');
    }
    const encode = (type, id, value) => `${id === null ? '' : `id: ${id}\n`}event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
    const snapshotFrame = this._runFrame(grant, streamId, 'snapshot', initialSnapshot.cursor, {
      view: initialSnapshot,
    }, {
      viewCursor: initialSnapshot.cursor, channelCursor: grant.startingCursor,
    });
    const initial = encode('snapshot', null, snapshotFrame);
    if (Buffer.byteLength(initial) > this.maxFrameBytes
      || (res.writableLength ?? 0) + Buffer.byteLength(initial) > this.maxBufferedBytes) {
      release();
      try { this._audit('stream_refused', principal, origin, {
        repoId: grant.repoId, runId: grant.runId, channel: grant.channel,
        reason: 'snapshot_too_large',
      }); } catch { return response(503, 'temporarily_unavailable'); }
      return response(503, 'temporarily_unavailable');
    }
    let closed = false;
    let timer = null;
    let pumping = false;
    let endRequested = false;
    const endSocket = () => {
      if (endRequested) return;
      endRequested = true;
      try { res.end(); } catch { /* the socket is already terminal */ }
    };
    const disconnect = (kind = 'stream_disconnected') => {
      if (closed) return;
      closed = true;
      this.activeConnections -= 1;
      if (timer) clearInterval(timer);
      this.connections.delete(closeForShutdown);
      release();
      try { this._audit(kind, principal, origin, {
        repoId: grant.repoId, runId: grant.runId, channel: grant.channel, streamId,
        ...(grant.recipient ? { recipient: grant.recipient } : {}),
      }); } catch { /* stream loss never controls Run work */ }
    };
    const writeControl = (encoded) => {
      if (Buffer.byteLength(encoded) > this.maxControlFrameBytes
        || (res.writableLength ?? 0) + Buffer.byteLength(encoded) > this.maxBufferedBytes) return false;
      try { return res.write(encoded) !== false; } catch { return false; }
    };
    const sourceState = (candidate = state) => ({
      viewCursor: candidate.viewCursor,
      channelCursor: grant.channel === 'progress'
        ? candidate.viewCursor : candidate.timelineCursor,
    });
    const write = (type, id, value) => {
      if (grant.incarnation !== this.incarnation
        || !this._liveAuthorized(principal, origin, grant.repoId)) {
        disconnect(grant.incarnation !== this.incarnation
          ? 'stream_incarnation_lost' : 'stream_authorization_lost');
        endSocket();
        return false;
      }
      const body = `event: ${type}\ndata: ${JSON.stringify(value)}\n`;
      const commit = `${id === null ? '' : `id: ${id}\n`}\n`;
      const bytes = Buffer.byteLength(body) + Buffer.byteLength(commit);
      if (bytes > this.maxFrameBytes || (res.writableLength ?? 0) + bytes > this.maxBufferedBytes) {
        const committed = sourceState();
        const lagCursor = committed.channelCursor;
        const lagPayload = { code: 'backpressure', reconnect: true };
        const lag = this._runFrame(grant, streamId, 'lag', lagCursor, lagPayload, committed);
        writeControl(encode('lag', lagCursor, lag));
        disconnect('stream_backpressure_disconnect');
        endSocket();
        return false;
      }
      try {
        // Commit the SSE id only after the page body was accepted. If the body applies
        // backpressure, EventSource sees neither a completed event nor a resumable cursor.
        if (res.write(body) === false) {
          disconnect('stream_backpressure_disconnect');
          endSocket();
          return false;
        }
        if (res.write(commit) === false) {
          disconnect('stream_backpressure_disconnect');
          endSocket();
          return false;
        }
      } catch {
        disconnect('stream_backpressure_disconnect');
        endSocket();
        return false;
      }
      return true;
    };
    const closeForShutdown = () => {
      if (closed) return;
      const committed = sourceState();
      const payload = { reconnect: true };
      const frame = this._runFrame(grant, streamId, 'shutdown', committed.channelCursor,
        payload, committed);
      writeControl(encode('shutdown', null, frame));
      disconnect('stream_shutdown');
      endSocket();
    };
    const deliver = (page) => {
      if (!page || closed) return false;
      if (page.payload !== null) {
        const frame = this._runFrame(grant, streamId, grant.channel, page.cursor, page.payload, {
          viewCursor: page.state.viewCursor, channelCursor: page.cursor,
        });
        if (!write(grant.channel, page.cursor, frame)) return false;
      }
      state = page.state;
      if (page.terminal) {
        disconnect('stream_terminal');
        endSocket();
        return false;
      }
      return true;
    };
    const pump = async () => {
      if (closed || pumping) return;
      pumping = true;
      try {
        for (let pages = 0; pages < this.maxEventsPerPump && !closed; pages += 1) {
          if (grant.incarnation !== this.incarnation
            || !this._liveAuthorized(principal, origin, grant.repoId)) {
            disconnect(grant.incarnation !== this.incarnation
              ? 'stream_incarnation_lost' : 'stream_authorization_lost');
            endSocket();
            break;
          }
          const page = await this._runRead(grant, principal, state);
          if (grant.incarnation !== this.incarnation
            || !this._liveAuthorized(principal, origin, grant.repoId)) {
            disconnect(grant.incarnation !== this.incarnation
              ? 'stream_incarnation_lost' : 'stream_authorization_lost');
            endSocket();
            break;
          }
          if (closed || !deliver(page) || !page.hasMore) break;
        }
      } catch (cause) {
        const authorizationLost = cause?.code === 'application_unauthorized';
        const cursorLost = ['run_progress_cursor_mismatch', 'run_timeline_cursor_invalid', 'run_timeline_cursor_mismatch'].includes(cause?.code);
        disconnect(authorizationLost ? 'stream_authorization_lost'
          : cursorLost ? 'stream_cursor_lost' : 'stream_read_failed');
        endSocket();
      } finally { pumping = false; }
    };
    try { this._audit('stream_connected', principal, origin, {
      repoId: grant.repoId, runId: grant.runId, channel: grant.channel, streamId,
      ...(grant.recipient ? { recipient: grant.recipient } : {}),
    }); } catch { release(); return response(503, 'temporarily_unavailable'); }
    this.activeConnections += 1;
    this.connections.add(closeForShutdown);
    let headersStarted = false;
    try {
      res.on?.('close', () => disconnect());
      res.on?.('error', () => disconnect());
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
        connection: 'keep-alive', 'x-accel-buffering': 'no',
        'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
        vary: 'Origin', 'x-content-type-options': 'nosniff',
      });
      headersStarted = true;
      if (grant.incarnation !== this.incarnation
        || !this._liveAuthorized(principal, origin, grant.repoId)) {
        disconnect(grant.incarnation !== this.incarnation
          ? 'stream_incarnation_lost' : 'stream_authorization_lost');
        endSocket();
        return null;
      }
      if (res.write(initial) === false) {
        disconnect('stream_backpressure_disconnect');
        endSocket();
        return null;
      }
      if (deliver(first) && !closed) {
        timer = setInterval(() => { void pump(); }, this.pollMs);
        timer.unref?.();
      }
    } catch {
      disconnect('stream_setup_failed');
      if (headersStarted) {
        endSocket();
        return null;
      }
      return response(503, 'temporarily_unavailable');
    }
    return null;
  }

  shutdown() { this.accepting = false; for (const close of [...this.connections]) close(); }

  _canObserveGoalPlan(principal) {
    return Array.isArray(principal?.capabilities) && principal.capabilities.includes('goal:observe');
  }

  _redactAuthority(value, parentKey = null) {
    if (Array.isArray(value)) return value.map((item) => this._redactAuthority(item, parentKey));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !AUTHORITY_FIELDS.has(key) && !(parentKey === 'lease' && key === 'digest'))
      .map(([key, item]) => [key, this._redactAuthority(item, key)]));
  }

  _stripGoalPlan(value) {
    if (Array.isArray(value)) return value.map((item) => this._stripGoalPlan(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => key !== 'goalPlan')
      .map(([key, item]) => [key, this._stripGoalPlan(item)]));
  }

  _redactGoalPlanInternals(value) {
    if (Array.isArray(value)) return value.map((item) => this._redactGoalPlanInternals(item));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !AUTHORITY_FIELDS.has(key) && !['requestDigest', 'scopeKey'].includes(key))
      .map(([key, item]) => [key, this._redactGoalPlanInternals(item)]));
  }

  _isGoalPlanEvent(event) {
    const payload = event?.payload ?? {};
    if (GOAL_PLAN_EVENT_KINDS.has(event?.kind) || payload?.brief?.goalPlan) return true;
    if (event?.kind === 'web.command_admitted') return GOAL_PLAN_WEB_COMMANDS.has(payload.command);
    if (event?.kind === 'mcp.call_admitted') return GOAL_PLAN_MCP_TOOLS.has(payload.tool);
    if (event?.kind === 'web.audit') return GOAL_PLAN_WEB_COMMANDS.has(payload.command);
    if (event?.kind === 'mcp.audit') return GOAL_PLAN_MCP_TOOLS.has(payload.tool);
    if (['web.command_completed', 'web.command_failed'].includes(event?.kind)) {
      const command = typeof this.coordination.webCommand === 'function' ? this.coordination.webCommand(payload.commandId) : null;
      return GOAL_PLAN_WEB_COMMANDS.has(command?.command) || this._containsGoalPlan(payload.outcome);
    }
    if (['mcp.call_completed', 'mcp.call_failed'].includes(event?.kind)) {
      const call = typeof this.coordination.mcpCall === 'function' ? this.coordination.mcpCall(payload.callId) : null;
      return GOAL_PLAN_MCP_TOOLS.has(call?.tool) || this._containsGoalPlan(payload.outcome);
    }
    return this._containsGoalPlan(payload);
  }

  _containsGoalPlan(value) {
    if (Array.isArray(value)) return value.some((item) => this._containsGoalPlan(item));
    if (!value || typeof value !== 'object') return false;
    if (Object.hasOwn(value, 'goalPlan') || Object.hasOwn(value, 'goalId') || Object.hasOwn(value, 'planId')) return true;
    return Object.values(value).some((item) => this._containsGoalPlan(item));
  }

  _projectSnapshot(snapshot, principal) {
    const projected = this._redactAuthority(clone(snapshot));
    if (!this._canObserveGoalPlan(principal)) return this._stripGoalPlan(projected);
    if (projected.goalPlan) projected.goalPlan = this._redactGoalPlanInternals(projected.goalPlan);
    for (const task of projected.tasks ?? []) if (task?.brief?.goalPlan) task.brief.goalPlan = this._redactGoalPlanInternals(task.brief.goalPlan);
    return projected;
  }

  _projectEvent(event, principal) {
    const goalPlanEvent = this._isGoalPlanEvent(event);
    if (!this._canObserveGoalPlan(principal) && goalPlanEvent) return null;
    let projected = this._redactAuthority(clone(event));
    if (goalPlanEvent) {
      projected = this._redactGoalPlanInternals(projected);
      delete projected.idempotencyKey;
      projected.actor = 'goal-plan:authorized';
    } else if (typeof projected.actor === 'string' && (projected.actor.startsWith('web:') || projected.actor.startsWith('mcp:'))) projected.actor = 'northbound:authenticated';
    return projected;
  }

  _contentTrust(event) {
    const kind = event?.kind ?? '';
    if (kind === 'scratch.claimed') return 'claimed';
    if (kind === 'scratch.fact_posted') return event?.payload?.grounding ?? 'observed';
    if (kind.startsWith('knowledge.')) return event?.payload?.grounding ?? 'derived';
    if (kind === 'web.audit') return 'observed';
    return 'authoritative';
  }
}
