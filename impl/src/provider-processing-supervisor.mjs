function typed(message, code) { return Object.assign(new Error(message), { code }); }
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const SUPERVISOR_ERROR_CODES = new Set(['cancelled', 'coordination_writer_lost', 'coordination_write_unavailable', 'operational_log_unavailable', 'coordinator_closed', 'provider_processing_scan_active']);

/** Drive deployment-owned official provider processing without creating a second authority.
 * Durable per-root backoff lives in CoordinationStore; this supervisor owns only scan timing,
 * single-flight execution, cancellation, and drain-before-close lifecycle. */
export class ProviderProcessingSupervisor {
  constructor(opts = {}) {
    if (!opts.coordinator || typeof opts.coordinator.reconcileDueProviderProcessing !== 'function') throw new TypeError('provider processing supervisor requires Coordinator scan authority');
    if (!positive(opts.intervalMs) || opts.intervalMs > 24 * 60 * 60 * 1_000) throw new TypeError('provider processing interval is invalid');
    if (opts.setTimeout !== undefined && typeof opts.setTimeout !== 'function') throw new TypeError('provider processing timer is invalid');
    if (opts.clearTimeout !== undefined && typeof opts.clearTimeout !== 'function') throw new TypeError('provider processing timer is invalid');
    if (opts.onEvent !== undefined && typeof opts.onEvent !== 'function') throw new TypeError('provider processing event sink is invalid');
    this._coordinator = opts.coordinator;
    this._intervalMs = opts.intervalMs;
    this._setTimeout = opts.setTimeout ?? globalThis.setTimeout;
    this._clearTimeout = opts.clearTimeout ?? globalThis.clearTimeout;
    this._onEvent = opts.onEvent ?? null;
    this._started = false;
    this._closed = false;
    this._timer = null;
    this._controller = null;
    this._promise = null;
    this._scans = 0;
    this._lastResult = null;
    this._lastErrorCode = null;
  }

  _emit(kind, fields = {}) { this._onEvent?.(Object.freeze({ kind, scan: this._scans, ...fields })); }

  _schedule(delayMs) {
    if (this._closed || this._timer || this._promise) return false;
    const handle = this._setTimeout(() => { if (this._timer !== handle) return; this._timer = null; void this._run(); }, delayMs);
    handle?.unref?.(); this._timer = handle; return true;
  }

  async _run() {
    if (this._closed || this._promise) return;
    const controller = new AbortController(); this._controller = controller; this._scans += 1;
    const promise = (async () => {
      try {
        this._emit('provider.processing_scan_started');
        const result = await this._coordinator.reconcileDueProviderProcessing({ signal: controller.signal });
        if (this._closed || controller.signal.aborted) throw typed('provider processing scan cancelled', 'cancelled');
        const counts = { completed: 0, deferred: 0, stale: 0 };
        for (const row of result.results ?? []) {
          if (row.result === 'deferred' || row.result === 'idempotent') counts.deferred += 1;
          else if (row.result === 'stale') counts.stale += 1;
          else counts.completed += 1;
        }
        this._lastResult = 'completed'; this._lastErrorCode = null;
        this._emit('provider.processing_scan_completed', { dueCount: result.dueCount ?? 0, ...counts });
      } catch (error) {
        this._lastResult = null; this._lastErrorCode = SUPERVISOR_ERROR_CODES.has(error?.code) ? error.code : 'provider_processing_failed';
        this._emit(this._closed || this._lastErrorCode === 'cancelled' ? 'provider.processing_scan_cancelled' : 'provider.processing_scan_failed', { code: this._lastErrorCode });
      }
    })();
    this._promise = promise;
    try { await promise; }
    finally {
      if (this._promise === promise) { this._promise = null; this._controller = null; }
      if (!this._closed) this._schedule(this._intervalMs);
    }
  }

  start() {
    if (this._closed) throw typed('provider processing supervisor is closed', 'provider_processor_closed');
    if (this._started) return false;
    this._started = true; this._schedule(0); return true;
  }

  status() {
    return Object.freeze({ active: this._promise !== null, scheduled: this._timer !== null, scans: this._scans, lastResult: this._lastResult, lastErrorCode: this._lastErrorCode });
  }

  async close() {
    if (this._closed) return false;
    this._closed = true;
    if (this._timer) { this._clearTimeout(this._timer); this._timer = null; }
    if (this._controller && !this._controller.signal.aborted) this._controller.abort('driver_close');
    if (this._promise) await Promise.allSettled([this._promise]);
    return true;
  }
}
