function codeOf(error) {
  const code = typeof error?.code === 'string' ? error.code : 'session_recovery_failed';
  return /^[a-z0-9_]{1,64}$/.test(code) ? code : 'session_recovery_failed';
}

/** One deployment-owned startup scan. It has no adapter handle and uses only Coordinator authority.
 * #598 F12: no count ceiling and no deadline govern the scan — every admissible candidate is
 * recovered, each recovery finishing on its observed result, an explicit stop, or the worker's
 * own process facts. */
export class SessionRecoverySupervisor {
  constructor({ coordinator, authority, onEvent = () => {} }) {
    if (!coordinator || !authority || typeof onEvent !== 'function') {
      throw new TypeError('session recovery requires a coordinator, the startup authority, and an event sink');
    }
    this.coordinator = coordinator; this.authority = authority; this.onEvent = onEvent;
    this._promise = null; this._closing = false; this._closed = false; this._attached = new Set(); this._summary = null;
  }

  start() {
    if (this._promise) return this._promise;
    this.coordinator.beginStartupRecovery(this.authority);
    this.onEvent({ kind: 'session.recovery_started' });
    this._promise = this._run();
    return this._promise;
  }

  async _run() {
    let candidates;
    try {
      candidates = this.coordinator.startupRecoveryCandidates(this.authority);
      let attached = 0; let failed = 0; let skipped = 0; const failures = [];
      for (const workerId of candidates) {
        if (this._closing) { skipped += 1; continue; }
        let result;
        try {
          result = await this.coordinator.recover(workerId, { actor: 'policy:startup-recovery', startupAuthority: this.authority });
        } catch (error) {
          if (error?.code === 'coordination_write_unavailable') throw error;
          result = { ok: false, result: codeOf(error) };
        }
        if (result?.ok === true) { attached += 1; this._attached.add(workerId); }
        else { failed += 1; failures.push({ workerId, code: /^[a-z0-9_]{1,64}$/.test(result?.result ?? '') ? result.result : 'session_recovery_failed' }); }
      }
      const status = failed > 0 ? 'degraded' : 'ready';
      this._summary = Object.freeze({ status, eligible: candidates.length, attached, failed, skipped, failures: Object.freeze(failures) });
      this.coordinator.completeStartupRecovery(this.authority);
      this.onEvent({ kind: 'session.recovery_completed', status, eligible: candidates.length, attached, failed, skipped });
      return this._summary;
    } catch (error) {
      const code = codeOf(error); this.coordinator.completeStartupRecovery(this.authority, code);
      this._summary = Object.freeze({ status: 'failed', eligible: candidates?.length ?? null, attached: this._attached.size, failed: null, skipped: null, failures: Object.freeze([{ workerId: null, code }]) });
      this.onEvent({ kind: 'session.recovery_failed', code });
      return this._summary;
    }
  }

  status() { return this._summary ? { ...this._summary, failures: this._summary.failures.map((row) => ({ ...row })) } : { status: this._promise ? 'recovering' : 'idle' }; }

  async close() {
    if (this._closed) return false;
    this._closing = true; await (this._promise ?? this.start());
    const fleetDrainOwnsShutdown = typeof this.coordinator._fleetDrainOwnsShutdown === 'function' && this.coordinator._fleetDrainOwnsShutdown();
    if (!fleetDrainOwnsShutdown) {
      for (const workerId of [...this._attached]) await this.coordinator.kill(workerId, 'startup_recovery_shutdown', { startupAuthority: this.authority, emergency: true });
    }
    this._attached.clear(); this._closed = true; this.onEvent({ kind: 'session.recovery_closed' }); return true;
  }
}
