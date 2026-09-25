import { compareCanonicalStrings } from './canonical-order.mjs';

function typed(message, code) { return Object.assign(new Error(message), { code }); }
const positive = (value) => Number.isSafeInteger(value) && value > 0;

export class ProviderPollSupervisor {
  constructor(opts = {}) {
    if (!opts.coordinator || typeof opts.coordinator.reconcileProviderSource !== 'function') throw new TypeError('provider poll supervisor requires Coordinator reconciliation authority');
    if (!Array.isArray(opts.cards) || opts.cards.length === 0) throw new TypeError('provider poll supervisor requires poll cards');
    if (!positive(opts.intervalMs) || !positive(opts.initialBackoffMs)) throw new TypeError('provider poll timing is invalid');
    if (opts.setTimeout !== undefined && typeof opts.setTimeout !== 'function') throw new TypeError('provider poll timer is invalid');
    if (opts.clearTimeout !== undefined && typeof opts.clearTimeout !== 'function') throw new TypeError('provider poll timer is invalid');
    if (opts.onEvent !== undefined && typeof opts.onEvent !== 'function') throw new TypeError('provider poll event sink is invalid');
    this._coordinator = opts.coordinator;
    this._intervalMs = opts.intervalMs;
    this._initialBackoffMs = opts.initialBackoffMs;
    this._setTimeout = opts.setTimeout ?? globalThis.setTimeout;
    this._clearTimeout = opts.clearTimeout ?? globalThis.clearTimeout;
    this._onEvent = opts.onEvent ?? null;
    this._started = false;
    this._closed = false;
    this._rows = new Map();
    for (const card of opts.cards) {
      if (!card || typeof card.providerId !== 'string' || !Array.isArray(card.modes) || !card.modes.includes('poll') || !/^[a-f0-9]{64}$/.test(card.cardDigest ?? '') || !positive(card.poll?.maxBackoffMs)) throw new TypeError('provider poll card is invalid');
      if (opts.intervalMs > card.poll.maxBackoffMs || opts.initialBackoffMs > card.poll.maxBackoffMs) throw new TypeError('provider poll timing exceeds card ceiling');
      if (this._rows.has(card.providerId)) throw new TypeError('provider poll card is duplicated');
      this._rows.set(card.providerId, { providerId: card.providerId, maxBackoffMs: card.poll.maxBackoffMs, timer: null, controller: null, promise: null, attempts: 0, backoffMs: opts.initialBackoffMs, lastResult: null, lastErrorCode: null });
    }
  }

  _emit(kind, row, fields = {}) {
    this._onEvent?.(Object.freeze({ kind, providerId: row.providerId, attempt: row.attempts, ...fields }));
  }

  _schedule(row, delayMs) {
    if (this._closed || row.timer || row.promise) return false;
    const handle = this._setTimeout(() => { if (row.timer !== handle) return; row.timer = null; void this._run(row); }, delayMs);
    handle?.unref?.(); row.timer = handle; return true;
  }

  async _run(row) {
    if (this._closed || row.promise) return;
    const controller = new AbortController(); row.controller = controller; row.attempts += 1;
    let delay = this._intervalMs;
    const promise = (async () => {
      try {
        this._emit('provider.poll_started', row);
        const result = await this._coordinator.reconcileProviderSource(row.providerId, { signal: controller.signal });
        if (this._closed || controller.signal.aborted) throw typed('provider poll cancelled', 'cancelled');
        row.lastResult = result?.result ?? 'completed'; row.lastErrorCode = null; row.backoffMs = this._initialBackoffMs;
        this._emit('provider.poll_completed', row, { result: row.lastResult });
      } catch (error) {
        row.lastResult = null; row.lastErrorCode = typeof error?.code === 'string' ? error.code : 'provider_poll_failed';
        if (!this._closed) { delay = row.backoffMs; row.backoffMs = Math.min(row.maxBackoffMs, row.backoffMs * 2); }
        this._emit(this._closed || row.lastErrorCode === 'cancelled' ? 'provider.poll_cancelled' : 'provider.poll_failed', row, { code: row.lastErrorCode, retryInMs: this._closed ? null : delay });
      }
    })();
    row.promise = promise;
    try { await promise; }
    finally {
      if (row.promise === promise) { row.promise = null; row.controller = null; }
      if (!this._closed) this._schedule(row, delay);
    }
  }

  start() {
    if (this._closed) throw typed('provider poll supervisor is closed', 'provider_poller_closed');
    if (this._started) return false;
    this._started = true;
    for (const row of this._rows.values()) this._schedule(row, 0);
    return true;
  }

  status() {
    return [...this._rows.values()].sort((a, b) => compareCanonicalStrings(a.providerId, b.providerId)).map((row) => Object.freeze({
      providerId: row.providerId, active: row.promise !== null, scheduled: row.timer !== null, attempts: row.attempts,
      backoffMs: row.backoffMs, lastResult: row.lastResult, lastErrorCode: row.lastErrorCode,
    }));
  }

  async close() {
    if (this._closed) return false;
    this._closed = true;
    const pending = [];
    for (const row of this._rows.values()) {
      if (row.timer) { this._clearTimeout(row.timer); row.timer = null; }
      if (row.controller && !row.controller.signal.aborted) row.controller.abort('driver_close');
      if (row.promise) pending.push(row.promise);
    }
    await Promise.allSettled(pending);
    return true;
  }
}
