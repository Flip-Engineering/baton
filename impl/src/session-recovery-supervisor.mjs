const HARD_MAX_SESSIONS = 1_000;
const HARD_MAX_STATE_ROWS = 100_000;
const HARD_MAX_TIMEOUT_MS = 5 * 60_000;

function codeOf(error) {
  const code = typeof error?.code === 'string' ? error.code : 'session_recovery_failed';
  return /^[a-z0-9_]{1,64}$/.test(code) ? code : 'session_recovery_failed';
}

/** One deployment-owned startup scan. It has no adapter handle and uses only Coordinator authority. */
export class SessionRecoverySupervisor {
  constructor({ coordinator, authority, policy, onEvent = () => {} }) {
    const fields = ['maxAttempts', 'maxSessions', 'maxStateRows', 'timeoutMs'];
    if (!coordinator || !authority || !policy || Object.keys(policy).sort().join(',') !== fields.sort().join(',')
      || !Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts <= 0 || policy.maxAttempts > 1_000_000
      || !Number.isSafeInteger(policy.maxSessions) || policy.maxSessions <= 0 || policy.maxSessions > HARD_MAX_SESSIONS
      || !Number.isSafeInteger(policy.maxStateRows) || policy.maxStateRows < policy.maxSessions || policy.maxStateRows > HARD_MAX_STATE_ROWS
      || !Number.isSafeInteger(policy.timeoutMs) || policy.timeoutMs <= 0 || policy.timeoutMs > HARD_MAX_TIMEOUT_MS
      || typeof onEvent !== 'function') throw new TypeError('session recovery requires exact bounded deployment policy');
    this.coordinator = coordinator; this.authority = authority; this.policy = Object.freeze({ ...policy }); this.onEvent = onEvent;
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
      candidates = this.coordinator.startupRecoveryCandidates(this.authority, this.policy.maxStateRows);
      if (candidates.length > this.policy.maxSessions) throw Object.assign(new Error('startup session recovery exceeds deployment capacity'), { code: 'session_recovery_capacity' });
      let attached = 0; let failed = 0; let skipped = 0; const failures = [];
      for (const workerId of candidates) {
        if (this._closing) { skipped += 1; continue; }
        let result;
        try {
          result = await this.coordinator.recover(workerId, { timeoutMs: this.policy.timeoutMs, actor: 'policy:startup-recovery', startupAuthority: this.authority });
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
