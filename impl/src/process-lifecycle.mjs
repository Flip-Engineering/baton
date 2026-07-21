import { execFileSync } from 'node:child_process';

const START_KEYS = ['generation', 'phase', 'pid', 'processGroupId', 'schemaVersion'];
const CLOSE_KEYS = ['code', 'generation', 'pid', 'processGroupId', 'ready', 'schemaVersion', 'signal'];
const READY_KEYS = ['generation', 'pid', 'processGroupId', 'schemaVersion'];
const REAP_UNCONFIRMED_KEYS = ['generation', 'pid', 'processGroupId', 'reason', 'schemaVersion'];
const AUTHORITY_KEYS = ['generation', 'pid', 'pidStart', 'processGroupId', 'schemaVersion'];
const RECOVERY_REAPED_KEYS = ['generation', 'pid', 'pidStart', 'processGroupId', 'reason', 'schemaVersion'];

const exactKeys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
const positiveSafe = (value) => Number.isSafeInteger(value) && value > 0;

export function processGroupAlive(processGroupId) {
  if (!positiveSafe(processGroupId)) return false;
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

/**
 * Bind a detached group leader to the kernel-observed start of that exact PID. PID/PGID
 * liveness alone is not restart-safe because the numeric coordinate can be reused. `ps lstart`
 * is also the writer-lease incarnation primitive used by coordination-store; keeping this
 * observation here lets every new process generation carry the same cross-controller fence
 * without exposing it on public worker projections.
 */
export function observeProcessGroupIdentity(processGroupId, opts = {}) {
  if (!positiveSafe(processGroupId)) return null;
  const execute = opts.execFileSync ?? execFileSync;
  let value;
  try {
    value = execute('/bin/ps', ['-o', 'pid=,pgid=,lstart=', '-p', String(processGroupId)], {
      encoding: 'utf8', maxBuffer: 4_096, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1_000,
    }).trim();
  } catch { return null; }
  const match = /^(\d+)\s+(\d+)\s+(.+)$/u.exec(value);
  if (!match || Number(match[1]) !== processGroupId || Number(match[2]) !== processGroupId) return null;
  const pidStart = match[3].trim();
  if (!pidStart || Buffer.byteLength(pidStart) > 256 || pidStart.includes('\0')) return null;
  return Object.freeze({ pid: processGroupId, processGroupId, pidStart });
}

export function processAuthorityPayload(processRef, opts = {}) {
  if (!processRef || !positiveSafe(processRef.generation) || !positiveSafe(processRef.pid)
    || processRef.processGroupId !== processRef.pid) return null;
  const identity = observeProcessGroupIdentity(processRef.processGroupId, opts);
  if (!identity) return null;
  return {
    schemaVersion: 1,
    generation: processRef.generation,
    pid: processRef.pid,
    processGroupId: processRef.processGroupId,
    pidStart: identity.pidStart,
  };
}

export function validProcessAuthorityPayload(payload) {
  return exactKeys(payload, AUTHORITY_KEYS)
    && payload.schemaVersion === 1
    && positiveSafe(payload.generation)
    && positiveSafe(payload.pid)
    && payload.processGroupId === payload.pid
    && typeof payload.pidStart === 'string'
    && payload.pidStart.length > 0
    && Buffer.byteLength(payload.pidStart) <= 256
    && !payload.pidStart.includes('\0');
}

export function processAuthorityState(processRef, authority, opts = {}) {
  if (!processRef || !validProcessAuthorityPayload(authority)
    || authority.generation !== processRef.generation
    || authority.pid !== processRef.pid
    || authority.processGroupId !== processRef.processGroupId) return 'unavailable';
  const identity = observeProcessGroupIdentity(processRef.processGroupId, opts);
  if (!identity) return processGroupAlive(processRef.processGroupId) ? 'unknown' : 'absent';
  return identity.pidStart === authority.pidStart ? 'active' : 'mismatch';
}

function probeProcessGroup(processGroupId, probe) {
  try {
    probe(-processGroupId, 0);
    return { alive: true, reason: 'alive' };
  } catch (error) {
    if (error?.code === 'ESRCH') return { alive: false, reason: null };
    if (error?.code === 'EPERM') return { alive: true, reason: 'permission_denied' };
    return { alive: true, reason: 'probe_error' };
  }
}

/**
 * A detached group leader's `close` event proves only that leader was reaped. Any descendants
 * still carrying the group ID remain Baton's responsibility. Escalate the orphaned group and do
 * not release exact-close evidence until a real group probe reports ESRCH.
 */
export async function reapOwnedProcessGroup(processGroupId, opts = {}) {
  if (!positiveSafe(processGroupId)) return Object.freeze({ confirmed: false, reason: 'invalid_group' });
  const probe = opts.probe ?? process.kill.bind(process);
  const signal = opts.signal ?? process.kill.bind(process);
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = Number.isSafeInteger(opts.timeoutMs) && opts.timeoutMs >= 0 ? opts.timeoutMs : 2000;
  const pollMs = Number.isSafeInteger(opts.pollMs) && opts.pollMs > 0 ? opts.pollMs : 5;
  const maxAttempts = Number.isSafeInteger(opts.maxAttempts) && opts.maxAttempts > 0 ? opts.maxAttempts : 500;
  let observed = probeProcessGroup(processGroupId, probe);
  if (!observed.alive) return Object.freeze({ confirmed: true, reason: null });
  try { signal(-processGroupId, 'SIGKILL'); } catch (error) {
    if (error?.code === 'ESRCH') return Object.freeze({ confirmed: true, reason: null });
    if (error?.code === 'EPERM') return Object.freeze({ confirmed: false, reason: 'permission_denied' });
  }
  const deadline = now() + timeoutMs;
  for (let attempts = 0; attempts < maxAttempts && now() <= deadline; attempts += 1) {
    observed = probeProcessGroup(processGroupId, probe);
    if (!observed.alive) return Object.freeze({ confirmed: true, reason: null });
    if (observed.reason === 'permission_denied') return Object.freeze({ confirmed: false, reason: observed.reason });
    await sleep(pollMs);
  }
  return Object.freeze({ confirmed: false, reason: observed.reason === 'probe_error' ? 'probe_error' : 'deadline' });
}

/**
 * Keep the immutable OS-close observation separate from transport terminal state and from exact
 * process-group ownership. The exact leader-close fact and its close-derived terminal remain
 * retained by this generation/PID/group latch until descendant absence is proven. An inconclusive
 * bounded reap clears the singleflight slot before publishing its refusal, so that observation can
 * explicitly drive one new bounded kill; concurrent callers still join the same physical attempt.
 * Confirmation publishes process_closed, flushes the retained terminal, then publishes stop
 * confirmation and seals the latch permanently.
 */
export class ProcessCloseReapLatch {
  constructor(options = {}) {
    this.generation = normalizeProcessGeneration(options.generation);
    if (!positiveSafe(options.pid)) throw new TypeError('ProcessCloseReapLatch pid must be a positive safe integer');
    this.pid = options.pid;
    this.timeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs : 2000;
    this.reap = options.reap ?? reapOwnedProcessGroup;
    if (typeof this.reap !== 'function') throw new TypeError('ProcessCloseReapLatch reap must be a function');
    this.onProcessClosed = options.onProcessClosed;
    this.onReapUnconfirmed = options.onReapUnconfirmed;
    this.onStopConfirmed = options.onStopConfirmed;
    this._closeFact = null;
    this._stop = null;
    this._attempt = null;
    this._confirmed = false;
    this._processClosedEmitted = false;
    this._closeDerived = null;
    this._closeDerivedFlushed = false;
    this._stopConfirmedEmitted = false;
    this._stopConfirmationHeld = false;
  }

  get closeFact() { return this._closeFact; }
  get confirmed() { return this._confirmed; }
  get pending() { return this._closeFact !== null && !this._confirmed; }

  /** Capture the exact close tuple once, then join or start its bounded reap. */
  close(code, signal, ready, closeDerived = undefined) {
    if (closeDerived !== undefined && typeof closeDerived !== 'function') {
      throw new TypeError('ProcessCloseReapLatch close-derived fact must be a function');
    }
    if (!this._closeFact) {
      const payload = processClosedPayload(this.generation, this.pid, code, signal, ready);
      if (!payload) throw new TypeError('ProcessCloseReapLatch could not construct the exact close fact');
      this._closeFact = Object.freeze(payload);
      this._closeDerived = closeDerived ?? null;
    } else if (closeDerived !== undefined && closeDerived !== this._closeDerived) {
      throw new TypeError('ProcessCloseReapLatch close-derived fact is already bound');
    }
    return this.#attemptReap();
  }

  /**
   * Record confirmed-stop authority without inventing a close. Kill supersedes a prior one-shot
   * interrupt while ownership is still open; neither can replace a confirmation already emitted.
   */
  authorizeStop(kind = 'kill.confirmed', payload = {}) {
    if (!['kill.confirmed', 'control.interrupt_confirmed'].includes(kind)) {
      throw new TypeError('ProcessCloseReapLatch stop kind is invalid');
    }
    if (!this._stopConfirmedEmitted
      && (!this._stop || kind === 'kill.confirmed' || this._stop.kind !== 'kill.confirmed')) {
      this._stop = Object.freeze({ kind, payload: Object.freeze({ ...payload }) });
    }
    if (this._confirmed) this.#emitStopConfirmed();
    return this._closeFact ? this.#attemptReap() : Promise.resolve(Object.freeze({ confirmed: false, reason: 'close_pending' }));
  }

  /** Retry cleanup without labeling automatic setup-failure teardown as a user kill. */
  retry() {
    return this._closeFact ? this.#attemptReap() : Promise.resolve(Object.freeze({ confirmed: false, reason: 'close_pending' }));
  }

  /** Let the close handler publish its pre-existing transport terminal cause before stop Ack. */
  holdStopConfirmation() { this._stopConfirmationHeld = true; }

  releaseStopConfirmation() {
    this._stopConfirmationHeld = false;
    this.#emitStopConfirmed();
  }

  #emitStopConfirmed() {
    if (!this._confirmed || !this._stop || this._stopConfirmedEmitted || this._stopConfirmationHeld) return;
    this._stopConfirmedEmitted = true;
    this.onStopConfirmed?.(this._stop.kind, this._stop.payload, this._closeFact);
  }

  #attemptReap() {
    if (this._confirmed) return Promise.resolve(Object.freeze({ confirmed: true, reason: null }));
    if (this._attempt) return this._attempt;
    const attempt = (async () => {
      const result = await this.reap(this.pid, { timeoutMs: this.timeoutMs });
      const normalized = Object.freeze({
        confirmed: result?.confirmed === true,
        reason: result?.confirmed === true ? null : processReapUnconfirmedPayload(
          this.generation, this.pid, result?.reason,
        ).reason,
      });
      if (!normalized.confirmed) {
        // A retry requested by the observation callback must start a new physical reap rather
        // than accidentally joining the just-completed refusal. Re-entrant and concurrent
        // callers after this point still share the newly installed singleflight attempt.
        if (this._attempt === attempt) this._attempt = null;
        this.onReapUnconfirmed?.(Object.freeze(processReapUnconfirmedPayload(
          this.generation, this.pid, normalized.reason,
        )));
        return normalized;
      }
      if (!this._processClosedEmitted) {
        this._processClosedEmitted = true;
        this.onProcessClosed?.(this._closeFact);
      }
      if (!this._closeDerivedFlushed) {
        this._closeDerivedFlushed = true;
        this._closeDerived?.(this._closeFact);
      }
      // Do not expose a reusable generation until its retained close-derived callback has fully
      // finished. This prevents generation N callbacks from mutating a newly admitted N+1.
      this._confirmed = true;
      this.#emitStopConfirmed();
      return normalized;
    })();
    this._attempt = attempt;
    void attempt.finally(() => {
      if (this._attempt === attempt) this._attempt = null;
    }).catch(() => {});
    return attempt;
  }
}

/** Signal only a replayed group whose kernel start identity still matches durable authority. */
export async function reapRecoveredProcessGroup(processRef, authority, opts = {}) {
  const state = processAuthorityState(processRef, authority, opts);
  if (state === 'absent') {
    return Object.freeze({ confirmed: true, signaled: false, reason: 'absent' });
  }
  if (state !== 'active') {
    return Object.freeze({ confirmed: false, signaled: false, reason: state });
  }
  const reaped = await reapOwnedProcessGroup(processRef.processGroupId, opts);
  return Object.freeze({ ...reaped, signaled: true });
}

export function normalizeProcessGeneration(value) {
  const generation = value ?? 1;
  if (!positiveSafe(generation)) throw new TypeError('processGeneration must be a positive safe integer');
  return generation;
}

export function processStartedPayload(generation, pid) {
  if (!positiveSafe(pid)) return null;
  return { schemaVersion: 1, generation: normalizeProcessGeneration(generation), pid, processGroupId: pid, phase: 'initializing' };
}

export function processClosedPayload(generation, pid, code, signal, ready) {
  if (!positiveSafe(pid)) return null;
  return {
    schemaVersion: 1,
    generation: normalizeProcessGeneration(generation),
    pid,
    processGroupId: pid,
    code: Number.isSafeInteger(code) ? code : null,
    signal: typeof signal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(signal) ? signal : null,
    ready: ready === true,
  };
}

export function processReapUnconfirmedPayload(generation, pid, reason) {
  if (!positiveSafe(pid)) return null;
  return {
    schemaVersion: 1,
    generation: normalizeProcessGeneration(generation),
    pid,
    processGroupId: pid,
    reason: ['deadline', 'permission_denied', 'probe_error'].includes(reason) ? reason : 'probe_error',
  };
}

export function processReadyPayload(generation, pid) {
  if (!positiveSafe(pid)) return null;
  return { schemaVersion: 1, generation: normalizeProcessGeneration(generation), pid, processGroupId: pid };
}

export function recoveryProcessAbsentPayload(processRef) {
  return {
    schemaVersion: 1,
    generation: processRef?.generation,
    pid: processRef?.pid,
    processGroupId: processRef?.processGroupId,
    reason: 'process_group_absent',
  };
}

export function recoveryProcessReapedPayload(processRef, authority) {
  return {
    schemaVersion: 1,
    generation: processRef?.generation,
    pid: processRef?.pid,
    processGroupId: processRef?.processGroupId,
    pidStart: authority?.pidStart,
    reason: 'process_group_reaped',
  };
}

export function validRecoveryProcessAbsentPayload(payload) {
  return exactKeys(payload, ['generation', 'pid', 'processGroupId', 'reason', 'schemaVersion'])
    && payload.schemaVersion === 1
    && positiveSafe(payload.generation)
    && positiveSafe(payload.pid)
    && payload.processGroupId === payload.pid
    && payload.reason === 'process_group_absent';
}

export function validRecoveryProcessReapedPayload(payload) {
  return exactKeys(payload, RECOVERY_REAPED_KEYS)
    && payload.schemaVersion === 1
    && positiveSafe(payload.generation)
    && positiveSafe(payload.pid)
    && payload.processGroupId === payload.pid
    && typeof payload.pidStart === 'string'
    && payload.pidStart.length > 0
    && Buffer.byteLength(payload.pidStart) <= 256
    && !payload.pidStart.includes('\0')
    && payload.reason === 'process_group_reaped';
}

export function validProcessStartedPayload(payload) {
  return exactKeys(payload, START_KEYS)
    && payload.schemaVersion === 1
    && positiveSafe(payload.generation)
    && positiveSafe(payload.pid)
    && payload.processGroupId === payload.pid
    && payload.phase === 'initializing';
}

export function validProcessClosedPayload(payload) {
  return exactKeys(payload, CLOSE_KEYS)
    && payload.schemaVersion === 1
    && positiveSafe(payload.generation)
    && positiveSafe(payload.pid)
    && payload.processGroupId === payload.pid
    && (payload.code === null || Number.isSafeInteger(payload.code))
    && (payload.signal === null || (typeof payload.signal === 'string' && /^SIG[A-Z0-9]{1,16}$/.test(payload.signal)))
    && typeof payload.ready === 'boolean';
}

export function validProcessReapUnconfirmedPayload(payload) {
  return exactKeys(payload, REAP_UNCONFIRMED_KEYS)
    && payload.schemaVersion === 1
    && positiveSafe(payload.generation)
    && positiveSafe(payload.pid)
    && payload.processGroupId === payload.pid
    && ['deadline', 'permission_denied', 'probe_error'].includes(payload.reason);
}

export function validProcessReadyPayload(payload) {
  return exactKeys(payload, READY_KEYS)
    && payload.schemaVersion === 1
    && positiveSafe(payload.generation)
    && positiveSafe(payload.pid)
    && payload.processGroupId === payload.pid;
}
