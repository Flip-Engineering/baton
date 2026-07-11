import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(value).digest();
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

export class WebEventStream {
  constructor(opts) {
    if (!opts?.coordination || typeof opts.coordination.snapshot !== 'function'
      || typeof opts.coordination.events !== 'function'
      || typeof opts.coordination.recordWebAudit !== 'function') {
      throw new TypeError('web stream requires coordination authority');
    }
    this.coordination = opts.coordination;
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
      credentialDigest: principal?.credentialId && this.credentialDigest ? this.credentialDigest(principal.credentialId) : null, origin, ...clone(details),
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

  issue(principal, origin, repoId) {
    if (!this.accepting) return response(503, 'temporarily_unavailable');
    this._pruneTickets();
    if (!this._authorized(principal, origin, repoId)) {
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
      hash: digest(secret), expiresAt, sessionId: principal.sessionId,
      credentialId: principal.credentialId, repoId, origin,
    };
    try { this._audit('stream_ticket_issued', principal, origin, { repoId, ticketId: id }); }
    catch { return response(503, 'temporarily_unavailable'); }
    this.tickets.set(id, state);
    return { status: 201, body: { ok: true, ticket: `${id}.${secret}`, expiresAt: new Date(expiresAt).toISOString() } };
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
      && found.sessionId === principal?.sessionId && found.credentialId === principal?.credentialId
      && found.origin === origin && this._liveAuthorized(principal, origin, found.repoId);
    if (!valid) return null;
    this.tickets.delete(id);
    return { id, repoId: found.repoId };
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

    let snapshot;
    try { snapshot = this.coordination.snapshot(); }
    catch {
      try { this._audit('stream_refused', principal, origin, { repoId: grant.repoId, reason: 'snapshot_unavailable' }); }
      catch { if (lease && this.releaseConnection) this.releaseConnection(principal); return response(503, 'temporarily_unavailable'); }
      if (lease && this.releaseConnection) this.releaseConnection(principal);
      return response(503, 'temporarily_unavailable');
    }
    const boundary = snapshot.lastSeq;
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
    const frame = (type, cursorValue, eventId, payload) => ({
      schemaVersion: 1, streamId, cursor: cursorValue, eventId,
      provenance: 'coordination-authority', occurrenceTrust: 'authoritative',
      contentTrust: type === 'snapshot' ? 'mixed' : this._contentTrust(payload),
      resource: { repoId: grant.repoId }, type, payload,
    });
    const encode = (type, id, value) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
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
      const bytes = Buffer.byteLength(control);
      try {
        if (bytes <= this.maxControlFrameBytes
          && (res.writableLength ?? 0) + bytes <= this.maxBufferedBytes) res.write(control);
      } catch { /* broken sockets still close and release authority below */ }
      disconnect('stream_shutdown');
      try { res.end(); } catch { /* broken sockets are already terminal */ }
    };
    const send = (event) => {
      const value = frame('coordination', event.seq, `coordination:${event.seq}`, event);
      const encoded = encode('coordination', event.seq, value);
      if (Buffer.byteLength(encoded) > this.maxFrameBytes
        || (res.writableLength ?? 0) + Buffer.byteLength(encoded) > this.maxBufferedBytes) {
        const lag = frame('lag', next - 1, `lag:${streamId}`, { code: 'backpressure', reconnect: true });
        const control = encode('lag', next - 1, lag);
        if (Buffer.byteLength(control) <= this.maxControlFrameBytes) res.write(control);
        disconnect('stream_backpressure_disconnect');
        res.end();
        return false;
      }
      const accepted = res.write(encoded);
      next = event.seq + 1;
      if (accepted === false) {
        const lag = frame('lag', next - 1, `lag:${streamId}`, { code: 'backpressure', reconnect: true });
        const control = encode('lag', next - 1, lag);
        if (Buffer.byteLength(control) <= this.maxControlFrameBytes) res.write(control);
        disconnect('stream_backpressure_disconnect');
        res.end();
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
          try { res.end(); } catch { /* connection is already unusable */ }
          return;
        }
        for (const event of this.coordination.events(next, this.maxEventsPerPump)) {
          if (!this._liveAuthorized(principal, origin, grant.repoId)) {
            disconnect('stream_authorization_lost');
            try { res.end(); } catch { /* connection is already unusable */ }
            return;
          }
          if (!send(event)) break;
        }
      } catch {
        disconnect('stream_read_failed');
        try { res.end(); } catch { /* connection is already unusable */ }
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
        const lag = frame('lag', next - 1, `lag:${streamId}`, { code: 'backpressure', reconnect: true });
        const control = encode('lag', next - 1, lag);
        if (Buffer.byteLength(control) <= this.maxControlFrameBytes) res.write(control);
        disconnect('stream_backpressure_disconnect');
        res.end();
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
        try { res.end(); } catch { /* connection is already unusable */ }
        return null;
      }
      return response(503, 'temporarily_unavailable');
    }
    return null;
  }

  shutdown() { this.accepting = false; for (const close of [...this.connections]) close(); }

  _contentTrust(event) {
    const kind = event?.kind ?? '';
    if (kind === 'scratch.claimed') return 'claimed';
    if (kind === 'scratch.fact_posted') return event?.payload?.grounding ?? 'observed';
    if (kind.startsWith('knowledge.')) return event?.payload?.grounding ?? 'derived';
    if (kind === 'web.audit') return 'observed';
    return 'authoritative';
  }
}
