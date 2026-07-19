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
