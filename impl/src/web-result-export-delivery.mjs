import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

const digest = (value) => createHash('sha256').update(value).digest();
const clone = (value) => JSON.parse(JSON.stringify(value));
const error = (status, code) => Object.freeze({
  status, body: Object.freeze({ ok: false, error: Object.freeze({ code }) }),
});
const validText = (value) => typeof value === 'string' && value.length > 0;

function exactCoordinates(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === ['exportId', 'repoId', 'runId'].join(',')
    && [value.repoId, value.runId].every(validText) && /^[a-f0-9]{64}$/u.test(value.exportId);
}

function samePrincipal(principal, ticket) {
  return principal?.userId === ticket.userId && principal?.sessionId === ticket.sessionId
    && principal?.credentialId === ticket.credentialId;
}

export class WebResultExportDelivery {
  constructor(options) {
    if (!options?.coordination || typeof options.coordination.recordWebAudit !== 'function'
      || typeof options.authorizeExport !== 'function'
      || typeof options.resolveCompletedExport !== 'function'
      || typeof options.openArchive !== 'function'
      || typeof options.registerDelivery !== 'function') {
      throw new TypeError('web result export delivery requires lifecycle authorities');
    }
    this.coordination = options.coordination;
    this.allowedOrigins = new Set(options.allowedOrigins ?? []);
    this.repoIds = new Set(options.repoIds ?? []);
    if (this.repoIds.size !== 1) throw new TypeError('web result export delivery serves exactly one repository');
    this.now = options.now ?? Date.now;
    this.ticketTtlMs = options.ticketTtlMs ?? 15_000;
    this.maxTickets = options.maxTickets ?? 1_000;
    if (!Number.isSafeInteger(this.ticketTtlMs) || this.ticketTtlMs <= 0
      || !Number.isSafeInteger(this.maxTickets) || this.maxTickets <= 0) {
      throw new TypeError('web result export delivery limits are invalid');
    }
    this.isPrincipalActive = options.isPrincipalActive ?? (() => true);
    this.authorizeExport = options.authorizeExport;
    this.resolveCompletedExport = options.resolveCompletedExport;
    this.openArchive = options.openArchive;
    this.registerDelivery = options.registerDelivery;
    this.tickets = new Map();
    this.controllers = new Set();
    this.accepting = true;
  }

  _audit(kind, principal, origin, details = {}) {
    return this.coordination.recordWebAudit({
      kind, userId: principal?.userId ?? null, sessionId: principal?.sessionId ?? null,
      credentialDigest: principal?.credentialId ? createHash('sha256').update(principal.credentialId).digest('hex') : null,
      originClass: origin == null ? 'missing' : this.allowedOrigins.has(origin) ? 'allowed' : 'disallowed',
      ...clone(details),
    }, { actor: principal ? `web:${principal.userId}:${principal.sessionId}` : 'web:anonymous', key: `web.audit:${randomUUID()}` });
  }

  _principalAllowed(principal, origin, repoId) {
    const expiresAt = Date.parse(principal?.expiresAt);
    if (!this.accepting || !validText(principal?.userId) || !validText(principal?.sessionId)
      || !validText(principal?.credentialId) || principal.revoked === true
      || !Number.isFinite(expiresAt) || expiresAt <= this.now()
      || !this.allowedOrigins.has(origin) || !this.repoIds.has(repoId)
      || !Array.isArray(principal.repoIds) || !principal.repoIds.includes(repoId)
      || !Array.isArray(principal.capabilities)
      || !['observe', 'export_result'].every((capability) => principal.capabilities.includes(capability))) return false;
    try { return this.isPrincipalActive(principal, { origin, repoId }) === true; }
    catch { return false; }
  }

  async _authorized(principal, origin, coordinates) {
    if (!exactCoordinates(coordinates) || !this._principalAllowed(principal, origin, coordinates.repoId)) return false;
    try {
      return await this.authorizeExport(principal, coordinates) === true
        && (await this.resolveCompletedExport(coordinates))?.state === 'completed';
    } catch { return false; }
  }

  authorizeIssue(principal, origin, coordinates) {
    return this._authorized(principal, origin, coordinates);
  }

  _prune() {
    const now = this.now();
    for (const [id, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(id);
  }

  async issue(principal, origin, coordinates) {
    this._prune();
    if (!await this._authorized(principal, origin, coordinates)) {
      try { this._audit('export_ticket_refused', principal, origin, { reason: 'forbidden' }); }
      catch { return error(503, 'temporarily_unavailable'); }
      return error(principal ? 403 : 401, principal ? 'forbidden' : 'unauthenticated');
    }
    if (this.tickets.size >= this.maxTickets) return error(429, 'rate_limited');
    let archive;
    try { archive = await this.openArchive(coordinates); }
    catch { return error(503, 'temporarily_unavailable'); }
    const descriptor = archive?.descriptor;
    if (!descriptor || descriptor.exportId !== coordinates.exportId
      || !Number.isSafeInteger(descriptor.archiveBytes) || descriptor.archiveBytes < 0
      || !/^[a-f0-9]{64}$/u.test(descriptor.archiveDigest ?? '')) return error(503, 'temporarily_unavailable');
    const id = randomUUID();
    const secret = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + this.ticketTtlMs;
    const state = {
      secretDigest: digest(secret), expiresAt, origin,
      userId: principal.userId, sessionId: principal.sessionId, credentialId: principal.credentialId,
      coordinates: clone(coordinates), descriptor: clone(descriptor),
    };
    try { this._audit('export_ticket_issued', principal, origin, { ticketId: id, ...clone(coordinates) }); }
    catch { return error(503, 'temporarily_unavailable'); }
    this.tickets.set(id, state);
    return Object.freeze({
      status: 201,
      body: Object.freeze({
        ok: true, ticket: `${id}.${secret}`, expiresAt: new Date(expiresAt).toISOString(),
        delivery: Object.freeze(clone(descriptor)),
      }),
    });
  }

  _consume(value, principal, origin) {
    this._prune();
    const separator = typeof value === 'string' ? value.indexOf('.') : -1;
    const id = separator > 0 ? value.slice(0, separator) : '';
    const secret = separator > 0 ? value.slice(separator + 1) : '';
    const found = this.tickets.get(id);
    if (!found) return null;
    const matches = secret.length > 0 && timingSafeEqual(digest(secret), found.secretDigest)
      && found.origin === origin && samePrincipal(principal, found);
    if (!matches) return null;
    this.tickets.delete(id);
    return { id, ...found };
  }

  async open({ ticket, principal, origin, requestHeaders, exportId = null }, response) {
    if (!this.accepting) return error(503, 'temporarily_unavailable');
    const grant = this._consume(ticket, principal, origin);
    if (!grant) return error(principal ? 403 : 401, principal ? 'forbidden' : 'unauthenticated');
    if (exportId !== null && exportId !== grant.coordinates.exportId) return error(403, 'forbidden');
    if (requestHeaders?.range != null || requestHeaders?.['x-baton-filename'] != null) return error(400, 'invalid_request');
    if (!await this._authorized(principal, origin, grant.coordinates)) return error(403, 'forbidden');
    let archive;
    try { archive = await this.openArchive(grant.coordinates); }
    catch { return error(503, 'temporarily_unavailable'); }
    if (JSON.stringify(archive?.descriptor) !== JSON.stringify(grant.descriptor)) return error(409, 'export_changed');
    const controller = new AbortController();
    let registration;
    try {
      registration = this.registerDelivery({
        runId: grant.coordinates.runId, exportId: grant.coordinates.exportId, signal: controller.signal,
        abort: () => controller.abort(),
      });
    } catch { return error(503, 'temporarily_unavailable'); }
    this.controllers.add(controller);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.controllers.delete(controller);
      try { registration?.release?.(); } catch { /* lifecycle release is best effort after stream close */ }
    };
    const disconnected = () => { controller.abort(); release(); };
    response.once?.('close', disconnected);
    try {
      if (!await this._authorized(principal, origin, grant.coordinates)) return error(403, 'forbidden');
      const descriptor = grant.descriptor;
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': descriptor.mediaType,
        'content-length': String(descriptor.archiveBytes),
        'content-disposition': `attachment; filename="baton-export-${descriptor.exportId}.tar"`,
        'content-digest': `sha-256=:${Buffer.from(descriptor.archiveDigest, 'hex').toString('base64')}:`,
        'x-content-type-options': 'nosniff',
      });
      for await (const chunk of archive.chunks) {
        if (controller.signal.aborted || !await this._authorized(principal, origin, grant.coordinates)) {
          controller.abort();
          try { response.end(); } catch { response.destroy?.(); }
          return null;
        }
        response.write(chunk);
      }
      if (!controller.signal.aborted) response.end();
      return null;
    } finally {
      response.off?.('close', disconnected);
      release();
    }
  }

  shutdown() {
    this.accepting = false;
    this.tickets.clear();
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}
