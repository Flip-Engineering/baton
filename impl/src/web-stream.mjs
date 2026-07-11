import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value) => createHash('sha256').update(value).digest();
const string = (value) => typeof value === 'string' && value.length > 0;
const actor = (principal) => `web:${principal.userId}:${principal.sessionId}`;
const response = (status, code, extra = {}) => ({ status, body: { ok: false, error: { code }, ...extra } });

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
    this.now = opts.now ?? Date.now;
    this.ticketTtlMs = opts.ticketTtlMs ?? 15_000;
    this.replayLimit = opts.replayLimit ?? 1_000;
    this.maxBufferedBytes = opts.maxBufferedBytes ?? 256 * 1024;
    this.pollMs = opts.pollMs ?? 100;
    this.tickets = new Map();
  }

  _audit(kind, principal, origin, details = {}) {
    return this.coordination.recordWebAudit({
      kind, userId: principal?.userId ?? null, sessionId: principal?.sessionId ?? null,
      credentialId: principal?.credentialId ?? null, origin, ...clone(details),
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

  issue(principal, origin, repoId) {
    if (!this._authorized(principal, origin, repoId)) {
      return response(principal ? 403 : 401, principal ? 'forbidden' : 'unauthenticated');
    }
    const secret = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const expiresAt = this.now() + this.ticketTtlMs;
    this.tickets.set(id, {
      hash: digest(secret), expiresAt, sessionId: principal.sessionId,
      credentialId: principal.credentialId, repoId, origin,
    });
    this._audit('stream_ticket_issued', principal, origin, { repoId, ticketId: id });
    return { status: 201, body: { ok: true, ticket: `${id}.${secret}`, expiresAt: new Date(expiresAt).toISOString() } };
  }

  consume(value, principal, origin) {
    const split = typeof value === 'string' ? value.indexOf('.') : -1;
    const id = split > 0 ? value.slice(0, split) : '';
    const secret = split > 0 ? value.slice(split + 1) : '';
    const found = this.tickets.get(id);
    const presented = digest(secret);
    const valid = found && found.expiresAt > this.now()
      && timingSafeEqual(presented, found.hash)
      && found.sessionId === principal?.sessionId && found.credentialId === principal?.credentialId
      && found.origin === origin && this._authorized(principal, origin, found.repoId);
    if (!valid) return null;
    this.tickets.delete(id);
    return { id, repoId: found.repoId };
  }

  open({ ticket, principal, origin, cursor }, res) {
    const grant = this.consume(ticket, principal, origin);
    if (!grant) return response(principal ? 403 : 401, principal ? 'forbidden' : 'unauthenticated');

    const snapshot = this.coordination.snapshot();
    const boundary = snapshot.lastSeq;
    const requested = cursor == null || cursor === '' ? null : Number(cursor);
    if (requested !== null && (!Number.isSafeInteger(requested)
      || requested < Math.max(0, boundary - this.replayLimit) || requested > boundary)) {
      this._audit('stream_snapshot_required', principal, origin, {
        repoId: grant.repoId, requestedCursor: Number.isSafeInteger(requested) ? requested : null, boundary,
      });
      return response(409, 'snapshot_required', { snapshotCursor: boundary });
    }

    const streamId = randomUUID();
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
      connection: 'keep-alive', 'x-accel-buffering': 'no',
      'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true',
      vary: 'Origin', 'x-content-type-options': 'nosniff',
    });
    let next = requested === null ? boundary + 1 : requested + 1;
    let closed = false;
    let timer;
    const frame = (type, cursorValue, eventId, payload) => ({
      schemaVersion: 1, streamId, cursor: cursorValue, eventId,
      provenance: 'coordination-authority', trust: 'authoritative',
      resource: { repoId: grant.repoId }, type, payload,
    });
    const encode = (type, id, value) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
    const disconnect = (kind = 'stream_disconnected') => {
      if (closed) return;
      closed = true;
      if (timer) clearInterval(timer);
      try { this._audit(kind, principal, origin, { repoId: grant.repoId, streamId, cursor: next - 1 }); } catch { /* never turn stream loss into fleet control */ }
    };
    const send = (event) => {
      const value = frame('coordination', event.seq, `coordination:${event.seq}`, event);
      const encoded = encode('coordination', event.seq, value);
      if ((res.writableLength ?? 0) + Buffer.byteLength(encoded) > this.maxBufferedBytes) {
        const lag = frame('lag', next - 1, `lag:${streamId}`, { code: 'backpressure', reconnect: true });
        res.write(encode('lag', next - 1, lag));
        disconnect('stream_backpressure_disconnect');
        res.end();
        return false;
      }
      res.write(encoded);
      next = event.seq + 1;
      return true;
    };

    if (requested === null) {
      const value = frame('snapshot', boundary, `snapshot:${boundary}`, { seq: boundary, snapshot: clone(snapshot) });
      res.write(encode('snapshot', boundary, value));
    }
    this._audit('stream_connected', principal, origin, { repoId: grant.repoId, streamId, cursor: requested ?? boundary });
    const pump = () => {
      if (closed) return;
      for (const event of this.coordination.events(next)) if (!send(event)) break;
    };
    pump();
    if (!closed) {
      timer = setInterval(pump, this.pollMs);
      timer.unref?.();
    }
    res.on?.('close', () => disconnect());
    res.on?.('error', () => disconnect());
    return null;
  }
}
