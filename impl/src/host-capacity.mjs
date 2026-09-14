// Issue #297: THE HOST IS THE THROTTLE, never a numeric constant and never an operator watching
// `uptime`. One machine runs several Baton residents (deployments, the suite runner, root
// verdicts); each of them used to derive its own verification lane (#269) and nothing tied those
// lanes together — seven residents on one 10-core host each ran a full suite (every core but one
// each) and drove the load average to 24–46. This module is the ONE host-wide authority every
// resident shares:
//
//   measurement   os.availableParallelism(), os.totalmem()/os.freemem(), os.loadavg()[0]
//   derivation    every admission threshold is computed from that observation (deriveHostCapacity)
//                 — the module mints no admission constant of its own
//   sharing       a host-scoped lease directory (defaultHostCapacityRoot(): one directory per
//                 (host, user) under the OS temp root, the host-wide sibling of the per-repo
//                 FIFO queue files for the rest
//   admission     `verify` (a full-suite verdict) and `worker` (a recruited participant's
//                 dispatch) ask `acquire()`; the request is admitted when the derived budget has
//                 room, and otherwise QUEUED in order with a visible {position, ahead} until
//                 capacity returns — admission is never refused for being busy; only the caller's
//                 own bounded wait ends in a typed refusal that names the queue
//
// The lease directory is a concurrency substrate, so it uses the ONE published-owner protocol the
// per-repo worktree capacity ledger proved (worktree-capacity.mjs): an owner record published by
// atomic link, counted only after re-observation, a dead holder reclaimed only under an exclusive
// reaper gate, every wait turn bounded by a monotonic deadline. There the protocol guards one
// repository's reservation ledger; here it guards the host's lease namespace.

import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync,
  readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { arch, availableParallelism, freemem, hostname, loadavg, platform, tmpdir, totalmem } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

export class HostCapacityError extends Error {
  constructor(message, code = 'host_capacity_unavailable', cause) {
    super(message);
    this.name = 'HostCapacityError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function typed(message, code, extra, cause) {
  return Object.assign(new HostCapacityError(message, code, cause), extra ?? {});
}

export const HOST_CAPACITY_LEASE_KINDS = Object.freeze(['verify', 'worker']);
const OWNER_FIELDS = ['generation', 'ownerId', 'pid', 'schemaVersion'];
const LEASE_FIELDS = ['acquiredAt', 'holder', 'kind', 'nonce', 'pid', 'residentId', 'schemaVersion'];
const QUEUE_FIELDS = ['enqueuedAt', 'holder', 'kind', 'nonce', 'pid', 'residentId', 'schemaVersion'];
const RECORD_BYTE_CEILING = 4096;
const LOCK_POLL_MS = 5;
const LOCK_WAIT_MS = 5_000;
const LOCK_LABEL = 'host capacity lease lock';
const REAPER_LABEL = 'host capacity lease reaper gate';
// The bounded wait ONE acquire may hold before it refuses pre-effect naming the queue. It is
// protocol timing (the caller's patience), not an admission threshold: admission itself never
// refuses for capacity, and this deadline only stops a caller that cannot wait any longer. It
// rides the resident command deadline's order of magnitude, so a queued recruit refuses as a
// typed row before its transport times out as an error.
const DEFAULT_ADMISSION_WAIT_MS = 120_000;
const DEFAULT_POLL_MS = 250;

function fsyncDirectory(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    fsyncSync(fd);
  } catch { /* best-effort directory durability */ } finally {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* no-op */ } }
  }
}

function atomicWrite(path, value) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* no-op */ } }
    rmSync(temp, { force: true });
    throw error;
  }
}

function publishExclusive(root, path, value, generation) {
  const temp = join(root, `.publish-${generation}.tmp`);
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, `${JSON.stringify(value)}\n`, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    linkSync(temp, path);
    unlinkSync(temp);
    fsyncDirectory(root);
    return true;
  } catch (error) {
    if (fd !== undefined) { try { closeSync(fd); } catch { /* no-op */ } }
    rmSync(temp, { force: true });
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}
export function livePid(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

function validOwner(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...OWNER_FIELDS].sort().join(',')
    && value.schemaVersion === 1 && Number.isSafeInteger(value.pid) && value.pid > 0
    && typeof value.ownerId === 'string' && /^[a-f0-9]{32}$/u.test(value.ownerId)
    && typeof value.generation === 'string' && /^[a-f0-9]{32}$/u.test(value.generation);
}

// ── measurement and derivation ───────────────────────────────────────────────────────────────────

/** The host observation every threshold derives from. Dependencies are injectable so a test can
 * stage a loaded host; production reads the machine. */
export function hostCapacityObservation({
  cores = availableParallelism(), totalBytes = totalmem(), freeBytes = freemem(),
  load1m = loadavg()[0] ?? 0,
} = {}) {
  if (!Number.isSafeInteger(cores) || cores <= 0) throw new TypeError('host capacity cores must be a positive safe integer');
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) throw new TypeError('host capacity total memory must be a positive safe integer');
  if (!Number.isSafeInteger(freeBytes) || freeBytes < 0 || freeBytes > totalBytes) throw new TypeError('host capacity free memory must be a safe integer within total memory');
  if (!Number.isFinite(load1m) || load1m < 0) throw new TypeError('host capacity load average must be a non-negative finite number');
  return Object.freeze({ cores, totalBytes, freeBytes, load1m });
}

/** The ONE derivation from the host observation to every admission threshold (#297: no numeric
 * constant may stand where a measurement derives the number):
 *
 *   hubCores      1 — structural, not chosen: the process is one event loop, and every stop,
 *                   drain and watchdog deadline is a timer on that loop (the #269 rationale).
 *   usableCores   cores − hubCores — what heavy work may divide.
 *   suiteCores    cores − hubCores — a full suite uses every core but the hub's (the #269
 *                 measurement of what ONE verification run costs).
 *   verdictLanes  floor(usableCores / suiteCores) — how many full-suite verdicts fit at once
 *                 (the #269 defaultVerificationConcurrency formula, generalized host-wide).
 *   coreShare     floor(totalBytes / cores) — one core's equal share of memory; a worker is
 *                 entitled to one share, a suite to suiteCores shares.
 *   usableBytes   totalBytes − coreShare — memory after the hub's share.
 *   workerSlots   usableCores — concurrent recruited participants, one core share each.
 *   saturated     load1m ≥ cores — the operator's `uptime` read, derived: at or above a
 *                 one-minute load equal to the core count the host is already oversubscribed,
 *                 and new heavy work queues regardless of free slots.
 *   memoryTight   freeBytes < suiteBytes — free memory cannot fund one more verdict.
 */
export function deriveHostCapacity(observation) {
  const { cores, totalBytes, freeBytes, load1m } = hostCapacityObservation(observation);
  const hubCores = 1;
  const usableCores = Math.max(1, cores - hubCores);
  const suiteCores = Math.max(1, cores - hubCores);
  const verdictLanes = Math.max(1, Math.floor(usableCores / suiteCores));
  const coreShareBytes = Math.floor(totalBytes / cores);
  const suiteBytes = coreShareBytes * suiteCores;
  const usableBytes = totalBytes - coreShareBytes;
  const workerSlots = usableCores;
  return Object.freeze({
    cores, totalBytes, freeBytes, load1m,
    hubCores, usableCores, suiteCores, verdictLanes, coreShareBytes, suiteBytes, usableBytes,
    workerSlots,
    saturated: load1m >= cores,
    memoryTight: freeBytes < suiteBytes,
  });
}

/** The weight ONE admitted lease charges the derived budget. */
function leaseWeight(kind, capacity) {
  return kind === 'verify'
    ? Object.freeze({ cores: capacity.suiteCores, bytes: capacity.suiteBytes })
    : Object.freeze({ cores: 1, bytes: capacity.coreShareBytes });
}

/** The suite runner's default file parallelism — the same derivation every resident reads
 * (#297 item 3): one core for the runner's own loop, and no more lanes than the memory the host
 * can fund at one share per lane. BATON_SUITE_PARALLELISM remains the operator override. */
export function defaultSuiteParallelism(observation = undefined) {
  const capacity = deriveHostCapacity(observation ?? hostCapacityObservation());
  const memoryLanes = Math.max(1, Math.floor(capacity.usableBytes / capacity.coreShareBytes));
  return Math.max(1, Math.min(capacity.usableCores, memoryLanes));
}


// ── record names and the FIFO order ──────────────────────────────────────────────────────────────

function queueName(entry) {
  // The ISO timestamp sorts bytewise: the directory listing IS the queue order, and the random
  // nonce only breaks same-instant ties (stable once published).
  return `queue-${entry.enqueuedAt}-${entry.nonce}.json`;
}

function leaseName(record) {
  return `lease-${record.kind}-${record.nonce}.json`;
}

function validateRecord(record, fields) {
  return Boolean(record) && typeof record === 'object' && !Array.isArray(record)
    && Object.keys(record).sort().join(',') === [...fields].sort().join(',')
    && HOST_CAPACITY_LEASE_KINDS.includes(record.kind)
    && typeof record.residentId === 'string' && record.residentId.length > 0 && Buffer.byteLength(record.residentId) <= 128
    && typeof record.holder === 'string' && Buffer.byteLength(record.holder) <= 256
    && typeof record.nonce === 'string' && /^[a-f0-9]{32}$/u.test(record.nonce)
    && Number.isSafeInteger(record.pid) && record.pid > 0
    && (fields === LEASE_FIELDS
      ? typeof record.acquiredAt === 'string' && Number.isFinite(Date.parse(record.acquiredAt))
      : typeof record.enqueuedAt === 'string' && Number.isFinite(Date.parse(record.enqueuedAt)));
}

function readRecord(path, label, fields) {
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (error?.code === 'ENOENT') return null; // released between stat and read: the ordinary race
    throw typed(`${label} could not be observed`, 'host_capacity_unavailable', undefined, error);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > RECORD_BYTE_CEILING) {
    throw typed(`${label} is not a bounded private regular file`);
  }
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw typed(`${label} record is unreadable`, 'host_capacity_unavailable', undefined, error);
  }
  let record;
  try { record = JSON.parse(raw); } catch (cause) {
    throw typed(`${label} record is unreadable`, 'host_capacity_unavailable', undefined, cause);
  }
  if (!validateRecord(record, fields)) throw typed(`${label} record is not an exact host capacity record`);
  return record;
}

/** The host-scoped lease directory: one directory per (host, user) beside the system temp root —
 * the host-wide sibling of the per-repo `.baton/capacity` files. The name pins the platform
 * identity and the invoking user's uid, so two residents of one host and one user resolve the
 * SAME directory while another user's resident (which could neither read nor honour this user's
 * mode 0600 records) gets its own. The per-worker TMPDIR isolation a runtime projects onto its
 * members is deliberately NOT honoured: an authority that resolves through a per-process temp
 * root would fragment per resident and share nothing, so the POSIX `/tmp` baseline is the
 * default and `BATON_HOST_CAPACITY_ROOT` pins an operator-chosen location when even that is not
 * one shared filesystem. */
export function defaultHostCapacityRoot() {
  const uid = process.getuid?.() ?? 'none';
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([hostname(), platform(), arch(), uid]))
    .digest('hex').slice(0, 16);
  let base = null;
  if (process.env.BATON_HOST_CAPACITY_ROOT) {
    base = process.env.BATON_HOST_CAPACITY_ROOT;
  } else if (platform() !== 'win32') {
    try { base = realpathSync('/tmp'); } catch { base = null; }
  }
  if (!base || !isAbsolute(base)) base = tmpdir();
  return join(base, `baton-host-capacity-${fingerprint}`);
}

function listRecords(dir, label, fields) {
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw typed(`${label} directory is unreadable`, 'host_capacity_unavailable', undefined, error);
  }
  const records = [];
  for (const name of names) {
    const record = readRecord(join(dir, name), label, fields);
    if (record) records.push(Object.freeze({ name, ...record }));
  }
  return records;
}

// ── the authority ────────────────────────────────────────────────────────────────────────────────

export class HostCapacityAuthority {
  constructor({
    root = defaultHostCapacityRoot(), residentId = `resident-${process.pid}`,
    observation = hostCapacityObservation, liveness = livePid,
    now = Date.now, pollMs = DEFAULT_POLL_MS, waitMs = DEFAULT_ADMISSION_WAIT_MS,
  } = {}) {
    if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) throw new TypeError('host capacity lease root must be one absolute path');
    if (typeof residentId !== 'string' || residentId.length === 0 || Buffer.byteLength(residentId) > 128) throw new TypeError('host capacity resident id must be one bounded non-empty string');
    if (typeof observation !== 'function' || typeof liveness !== 'function' || typeof now !== 'function') throw new TypeError('host capacity dependencies must be functions');
    if (!Number.isSafeInteger(pollMs) || pollMs <= 0) throw new TypeError('host capacity poll interval must be a positive safe integer');
    if (!Number.isSafeInteger(waitMs) || waitMs <= 0) throw new TypeError('host capacity admission wait must be a positive safe integer');
    this.root = root;
    this.residentId = residentId;
    this.observation = observation;
    this.liveness = liveness;
    this.now = now;
    this.pollMs = pollMs;
    this.waitMs = waitMs;
    this.ownerId = randomBytes(16).toString('hex');
    this.leasesDir = join(root, 'leases');
    this.queueDir = join(root, 'queue');
    this.lockPath = join(root, 'lock');
    this.reaperPath = `${this.lockPath}.reaper`;
  }

  #token(kind, holder, nonce) {
    return Object.freeze({ kind, holder, nonce, residentId: this.residentId, pid: process.pid });
  }

  #ensureRoot() {
    for (const path of [this.root, this.leasesDir, this.queueDir]) {
      // Simultaneous first startup of two residents races here; losing that race is normal. Only
      // EEXIST is adopted, and the confinement checks below still refuse a file, symlink, or
      // escaping directory, so authority is unchanged.
      try { mkdirSync(path, { recursive: true, mode: 0o700 }); } catch (error) {
        if (error?.code !== 'EEXIST') throw typed('host capacity lease root could not be created', 'host_capacity_unavailable', undefined, error);
      }
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw typed('host capacity lease root is not a confined directory');
      chmodSync(path, 0o700);
      const within = relative(realpathSync(this.root), realpathSync(path));
      if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) throw typed('host capacity lease root escapes its directory');
    }
  }

  // ── the published-owner mutex (the worktree-capacity protocol, guarding the host namespace) ────

  _observeOwner(path, label) {
    let stat;
    try { stat = lstatSync(path); } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw typed(`${label} could not be observed`, 'host_capacity_unavailable', undefined, error);
    }
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.size > RECORD_BYTE_CEILING) {
      throw typed(`${label} is not a bounded private regular file`);
    }
    let raw;
    try { raw = readFileSync(path, 'utf8'); } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw typed(`${label} owner record is unreadable`, 'host_capacity_unavailable', undefined, error);
    }
    let owner;
    try { owner = JSON.parse(raw); } catch (cause) {
      throw typed(`${label} owner record is unreadable`, 'host_capacity_unavailable', undefined, cause);
    }
    if (!validOwner(owner)) throw typed(`${label} owner record is not an exact host capacity generation`);
    return owner;
  }

  _publish(path, generation) {
    try {
      return publishExclusive(this.root, path, { schemaVersion: 1, pid: process.pid, ownerId: this.ownerId, generation }, generation);
    } catch (error) {
      throw typed('host capacity lock publication failed', 'host_capacity_unavailable', undefined, error);
    }
  }

  _confirmLock(generation) {
    try {
      const held = this._observeOwner(this.lockPath, LOCK_LABEL);
      const gate = this._observeOwner(this.reaperPath, REAPER_LABEL);
      return held !== null && held.generation === generation && held.ownerId === this.ownerId
        && (gate === null || !this.liveness(gate.pid));
    } catch (error) {
      // A lock we cannot verify is not a lock we hold: never leave it published.
      this._removeOwner(this.lockPath, LOCK_LABEL, generation);
      throw error;
    }
  }

  _removeOwner(path, label, generation) {
    try {
      const observed = this._observeOwner(path, label);
      if (observed !== null && observed.generation === generation && observed.ownerId === this.ownerId) {
        unlinkSync(path);
        fsyncDirectory(this.root);
      }
    } catch { /* a replaced or unreadable artifact is never recursively removed */ }
  }

  _reap(observed) {
    const gateGeneration = randomBytes(16).toString('hex');
    if (!this._publish(this.reaperPath, gateGeneration)) return false;
    try {
      const current = this._observeOwner(this.lockPath, LOCK_LABEL);
      if (current === null || current.generation !== observed.generation
        || current.ownerId !== observed.ownerId || this.liveness(current.pid)) return false;
      const tombstone = `${this.lockPath}.stale-${gateGeneration}`;
      try { renameSync(this.lockPath, tombstone); } catch (error) {
        if (error?.code !== 'ENOENT') throw typed('host capacity lock recovery failed', 'host_capacity_unavailable', undefined, error);
        return false;
      }
      fsyncDirectory(this.root);
      rmSync(tombstone, { force: true });
      fsyncDirectory(this.root);
      return true;
    } finally { this._removeOwner(this.reaperPath, REAPER_LABEL, gateGeneration); }
  }

  /** Run `fn` holding the host lease directory's mutex. Waiting YIELDS the event loop (the
   * callers are async command handlers; the resident's other deadlines must keep firing), and
   * every non-progress turn ends in `_waitSlice`, so no observed state can loop unbounded. */
  async _mutex(fn, waitMs = LOCK_WAIT_MS) {
    this.#ensureRoot();
    const deadline = performance.now() + waitMs;
    for (;;) {
      const gate = this._observeOwner(this.reaperPath, REAPER_LABEL);
      if (!(gate !== null && this.liveness(gate.pid))) {
        const generation = randomBytes(16).toString('hex');
        if (this._publish(this.lockPath, generation) && this._confirmLock(generation)) {
          try { return await fn(); } finally { this._removeOwner(this.lockPath, LOCK_LABEL, generation); }
        }
        this._removeOwner(this.lockPath, LOCK_LABEL, generation); // no-op unless we published it
        const observed = this._observeOwner(this.lockPath, LOCK_LABEL);
        if (observed !== null && !this.liveness(observed.pid) && gate === null && !this._reap(observed)) {
          // A dead holder this turn could not reclaim; fall through to the bounded wait.
        }
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw typed(`host capacity lease lock is busy at the ${LOCK_WAIT_MS}ms wait deadline`, 'host_capacity_unavailable');
      }
      await new Promise((resolve) => { setTimeout(resolve, Math.min(LOCK_POLL_MS, remaining)); });
    }
  }

  // ── observation ─────────────────────────────────────────────────────────────────────────────────

  /** Sweep proved-dead holders (crashed residents) so their leases and queue entries return to
   * the budget. Runs inside the mutex; exact-name removals tolerate a raced release. */
  #sweep() {
    for (const [dir, fields] of [[this.leasesDir, LEASE_FIELDS], [this.queueDir, QUEUE_FIELDS]]) {
      for (const record of listRecords(dir, 'host capacity record', fields)) {
        if (!this.liveness(record.pid)) rmSync(join(dir, record.name), { force: true });
      }
    }
  }

  #usedBudget(capacity) {
    let cores = 0;
    let bytes = 0;
    const leases = { verify: 0, worker: 0 };
    for (const record of listRecords(this.leasesDir, 'host capacity lease', LEASE_FIELDS)) {
      const weight = leaseWeight(record.kind, capacity);
      cores += weight.cores;
      bytes += weight.bytes;
      leases[record.kind] += 1;
    }
    return Object.freeze({ cores, bytes, leases: Object.freeze(leases) });
  }

  #queueRows(entries) {
    return Object.freeze(entries.map((record, index) => Object.freeze({
      position: index + 1,
      ahead: index,
      kind: record.kind,
      residentId: record.residentId,
      holder: record.holder,
      enqueuedAt: record.enqueuedAt,
    })));
  }

  /** The host capacity observation for the doctor and the view: the derived budget, the live
   * leases, and the visible queue — dead holders swept first, so a crashed resident's slot is
   * already back when the doctor reads. */
  observe() {
    return this._mutex(() => {
      this.#sweep();
      const capacity = deriveHostCapacity(hostCapacityObservation(this.observation()));
      const used = this.#usedBudget(capacity);
      const queue = this.#queueRows(listRecords(this.queueDir, 'host capacity queue', QUEUE_FIELDS));
      return Object.freeze({
        capacity, used, queue,
        roomForVerify: !capacity.saturated && !capacity.memoryTight
          && used.cores + capacity.suiteCores <= capacity.usableCores
          && used.bytes + capacity.suiteBytes <= capacity.usableBytes,
        roomForWorker: !capacity.saturated && !capacity.memoryTight
          && used.cores + 1 <= capacity.usableCores
          && used.bytes + capacity.coreShareBytes <= capacity.usableBytes,
      });
    });
  }

  /** The same observation as `observe()`, read WITHOUT the mutex: counts only live-pid leases
   * (a crashed resident's lease does not alarm a reader) and never mutates. Races between two
   * residents can split one read by a lease; admission correctness never depends on this read —
   * it is what the doctor and the deployment summary show. */
  observeNow() {
    const capacity = deriveHostCapacity(hostCapacityObservation(this.observation()));
    let cores = 0;
    let bytes = 0;
    const leases = { verify: 0, worker: 0 };
    for (const record of listRecords(this.leasesDir, 'host capacity lease', LEASE_FIELDS)) {
      if (!this.liveness(record.pid)) continue;
      const weight = leaseWeight(record.kind, capacity);
      cores += weight.cores;
      bytes += weight.bytes;
      leases[record.kind] += 1;
    }
    const queue = this.#queueRows(listRecords(this.queueDir, 'host capacity queue', QUEUE_FIELDS));
    return Object.freeze({
      capacity, used: Object.freeze({ cores, bytes, leases: Object.freeze(leases) }), queue,
      roomForVerify: !capacity.saturated && !capacity.memoryTight
        && cores + capacity.suiteCores <= capacity.usableCores
        && bytes + capacity.suiteBytes <= capacity.usableBytes,
      roomForWorker: !capacity.saturated && !capacity.memoryTight
        && cores + 1 <= capacity.usableCores
        && bytes + capacity.coreShareBytes <= capacity.usableBytes,
    });
  }

  // ── admission ───────────────────────────────────────────────────────────────────────────────────

  /** Admit one unit of heavy work. Resolves with `{token}` once the derived budget admits the
   * request; while it does not, the request waits IN ORDER as a visible queue entry and
   * `onQueued` is called once with {position, ahead}. The wait is bounded by `waitMs`; exceeding
   * it refuses BEFORE ANY EFFECT with the queue facts attached, so the caller's retry (or its
   * operator) sees exactly what it waits behind. */
  async acquire(kind, { holder = '', onQueued = null } = {}) {
    if (!HOST_CAPACITY_LEASE_KINDS.includes(kind)) throw new TypeError(`host capacity lease kind must be one of ${HOST_CAPACITY_LEASE_KINDS.join(', ')}`);
    if (typeof holder !== 'string' || Buffer.byteLength(holder) > 256) throw new TypeError('host capacity lease holder must be one bounded string');
    if (onQueued !== null && typeof onQueued !== 'function') throw new TypeError('host capacity onQueued must be a function');
    this.#ensureRoot();
    const deadline = performance.now() + this.waitMs;
    const nonce = randomBytes(16).toString('hex');
    let queuedAt = null;
    let reportedQueue = false;
    for (;;) {
      const outcome = await this._mutex(() => {
        this.#sweep();
        const capacity = deriveHostCapacity(hostCapacityObservation(this.observation()));
        const used = this.#usedBudget(capacity);
        const entries = listRecords(this.queueDir, 'host capacity queue', QUEUE_FIELDS);
        const mine = entries.find((record) => record.nonce === nonce) ?? null;
        const ahead = mine ? entries.indexOf(mine) : entries.length;
        const weight = leaseWeight(kind, capacity);
        const head = mine === null || ahead === 0;
        const fits = used.cores + weight.cores <= capacity.usableCores
          && used.bytes + weight.bytes <= capacity.usableBytes;
        if (head && !capacity.saturated && !capacity.memoryTight && fits) {
          const lease = {
            schemaVersion: 1, kind, holder, nonce, pid: process.pid,
            residentId: this.residentId, acquiredAt: new Date(this.now()).toISOString(),
          };
          atomicWrite(join(this.leasesDir, leaseName(lease)), lease);
          if (mine) rmSync(join(this.queueDir, queueName(mine)), { force: true });
          return Object.freeze({ admitted: this.#token(kind, holder, nonce) });
        }
        if (mine === null) {
          queuedAt = this.now();
          const entry = {
            schemaVersion: 1, kind, holder, nonce, pid: process.pid,
            residentId: this.residentId, enqueuedAt: new Date(queuedAt).toISOString(),
          };
          atomicWrite(join(this.queueDir, queueName(entry)), entry);
        }
        return Object.freeze({
          queued: { position: ahead + 1, ahead, running: used.leases.verify, workerLeases: used.leases.worker },
        });
      });
      if (outcome.admitted) {
        return Object.freeze({
          token: outcome.admitted,
          ...(reportedQueue ? { queuedAt: new Date(queuedAt).toISOString() } : {}),
        });
      }
      if (!reportedQueue) {
        reportedQueue = true;
        if (onQueued) onQueued(Object.freeze(outcome.queued));
      }
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw typed(
          `host capacity queued this ${kind} request at position ${outcome.queued.position} (${outcome.queued.ahead} ahead) and the ${this.waitMs}ms admission wait is spent; no capacity effect was applied`,
          'host_capacity_queue_timeout',
          { queuePosition: outcome.queued.position, queueAhead: outcome.queued.ahead },
        );
      }
      await new Promise((resolve) => { setTimeout(resolve, Math.min(this.pollMs, remaining)); });
    }
  }

  /** Release one admitted lease. A release naming a lease this resident does not own is a no-op
   * that answers false — identity is (nonce, residentId), never a guessed path. */
  async release(token) {
    if (!token || typeof token !== 'object' || !HOST_CAPACITY_LEASE_KINDS.includes(token.kind)
      || typeof token.nonce !== 'string' || !/^[a-f0-9]{32}$/u.test(token.nonce)) {
      throw new TypeError('host capacity release requires an exact lease token');
    }
    return this._mutex(() => {
      const path = join(this.leasesDir, leaseName(token));
      const record = readRecord(path, 'host capacity lease', LEASE_FIELDS);
      if (record === null || record.nonce !== token.nonce || record.residentId !== token.residentId) return false;
      rmSync(path, { force: true });
      fsyncDirectory(this.leasesDir);
      return true;
    });
  }

  /** Release this resident's admitted worker leases EXCEPT the holders named — the runtime's own
   * roster is the truth for its own worker leases, so a stop or leave that removed a seat also
   * returns its lease, and no caller has to remember to. */
  async releaseWorkersExcept(holders) {
    if (!Array.isArray(holders)) throw new TypeError('host capacity worker retention requires a holder list');
    const keep = new Set(holders);
    return this._mutex(() => {
      let released = 0;
      for (const record of listRecords(this.leasesDir, 'host capacity lease', LEASE_FIELDS)) {
        if (record.kind !== 'worker' || record.residentId !== this.residentId) continue;
        if (keep.has(record.holder)) continue;
        rmSync(join(this.leasesDir, record.name), { force: true });
        released += 1;
      }
      if (released > 0) fsyncDirectory(this.leasesDir);
      return released;
    });
  }
}
