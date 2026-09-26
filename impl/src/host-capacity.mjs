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
//                 capacity returns — admission is never refused, for being busy or for having
//                 waited (#541). A worker's weight is MEASURED (#561): the mean bytes its
//                 fleet's leases record their seats holding, so a host cannot stack seats past
//                 the memory they actually consume; an unmeasured fleet admits its first worker
//                 weight-free. A standing-tight host (paging headroom or backing disk below one
//                 verdict's share) answers a plain verify degraded at once — no lease, the
//                 shortfall named — while a DURABLE verify request (#561: a suite a worker seat
//                 started, which must take the same lease a landing gate takes) queues like any
//                 other request, with no deadline.
//
// The lease directory is a concurrency substrate, so it uses the ONE published-owner protocol the
// per-repo worktree capacity ledger proved (worktree-capacity.mjs): an owner record published by
// atomic link, counted only after re-observation, a dead holder reclaimed only under an exclusive
// reaper gate, every wait turn bounded by a monotonic deadline. There the protocol guards one
// repository's reservation ledger; here it guards the host's lease namespace.

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
// F1 (frame economics): no hand-typed byte literals outside the registry — the bounded-record
// ceiling reuses a substrate registry value.
import { FRAME_LIMITS } from './limits.mjs';
import {
  chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync,
  readFileSync, realpathSync, renameSync, rmSync, statfsSync, unlinkSync, writeFileSync,
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
const RECORD_BYTE_CEILING = FRAME_LIMITS['stream.omp.flush'].value;
const LEASE_FIELDS = ['acquiredAt', 'holder', 'kind', 'nonce', 'pid', 'residentId', 'schemaVersion'];
const QUEUE_FIELDS = ['enqueuedAt', 'holder', 'kind', 'nonce', 'pid', 'residentId', 'schemaVersion'];
const LOCK_POLL_MS = 5;
const LOCK_WAIT_MS = 5_000;
const LOCK_LABEL = 'host capacity lease lock';
const REAPER_LABEL = 'host capacity lease reaper gate';
const DEFAULT_POLL_MS = 250;
// #495: how often a resident's post-admission watch asks whether the host still funds the verify
// leases it admitted. This number is a check cadence: the derivation alone decides whether the host
// is exhausted. It is slower than the admission poll on purpose — each check pays for one platform
// memory report, and available memory moves on the scale of the allocations a suite makes — so a
// check per few seconds observes the condition while costing a fraction of the work it guards.
const DEFAULT_SHED_POLL_MS = 5_000;

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

/** #329: the memory the OS will actually hand out, which is NOT `os.freemem()`. On darwin
 * `freemem()` reports free pages only — inactive, speculative and purgeable pages are
 * reclaimable but not "free", so a Mac with a browser open reports a few hundred MB of 16 GB and
 * every worker lease queued forever. Parse the same `vm_stat` the operator reads. Returns
 * `{ pageSize, freeBytes, inactiveBytes, speculativeBytes, purgeableBytes, availableBytes }`, or
 * null when the text is not a vm_stat report (the caller falls back honestly). */
export function parseVmStat(text) {
  if (typeof text !== 'string') return null;
  const pageSize = Number(/page size of (\d+) bytes/u.exec(text)?.[1]);
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) return null;
  const pages = (label) => {
    const match = new RegExp(`^${label}:\\s+(\\d+)\\.?$`, 'mu').exec(text);
    return match ? Number(match[1]) : null;
  };
  const free = pages('Pages free');
  if (free === null) return null;
  const inactive = pages('Pages inactive') ?? 0;
  const speculative = pages('Pages speculative') ?? 0;
  const purgeable = pages('Pages purgeable') ?? 0;
  const bytes = (count) => count * pageSize;
  return Object.freeze({
    pageSize, freeBytes: bytes(free), inactiveBytes: bytes(inactive),
    speculativeBytes: bytes(speculative), purgeableBytes: bytes(purgeable),
    availableBytes: bytes(free + inactive + speculative + purgeable),
  });
}

/** /proc/meminfo's MemAvailable (kB) as bytes, or null when the text does not carry it. */
export function parseMemInfoAvailable(text) {
  const match = typeof text === 'string' ? /^MemAvailable:\s+(\d+) kB$/mu.exec(text) : null;
  return match ? Number(match[1]) * 1024 : null;
}

/** #561: darwin's `vm_swapusage` line — `total = 10240.00M used = 9216.00M free = 1024.00M` —
 * as `{ totalBytes, usedBytes, freeBytes }`, or null when the text is not a swap report (the
 * caller falls back honestly). */
export function parseSwapUsage(text) {
  if (typeof text !== 'string') return null;
  const size = (label) => {
    const match = new RegExp(`${label} = ([\\d.]+)([KMG])`, 'u').exec(text);
    if (!match) return null;
    const scale = match[2] === 'K' ? 1024 : match[2] === 'G' ? 1024 ** 3 : 1024 ** 2;
    return Math.round(Number(match[1]) * scale);
  };
  const totalBytes = size('total');
  const usedBytes = size('used');
  const freeBytes = size('free');
  if (totalBytes === null || usedBytes === null || freeBytes === null) return null;
  return Object.freeze({ totalBytes, usedBytes, freeBytes });
}

/** #561: /proc/meminfo's SwapTotal and SwapFree (kB) as bytes, or null when the text does not
 * carry them. */
export function parseMemInfoSwap(text) {
  if (typeof text !== 'string') return null;
  const total = /^SwapTotal:\s+(\d+) kB$/mu.exec(text);
  const free = /^SwapFree:\s+(\d+) kB$/mu.exec(text);
  if (!total || !free) return null;
  const totalBytes = Number(total[1]) * 1024;
  const freeBytes = Number(free[1]) * 1024;
  return Object.freeze({ totalBytes, freeBytes, usedBytes: Math.max(0, totalBytes - freeBytes) });
}

/** #561: measure the host's swap the platform's own way; both terms read null where no platform
 * report exists or the report cannot be read. Never throws. */
export function hostSwapObservation({
  platform: hostPlatform = platform(),
  swapUsage = () => execFileSync('/usr/sbin/sysctl', ['vm.swapusage'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
  memInfo = () => readFileSync('/proc/meminfo', 'utf8'),
} = {}) {
  let measured = null;
  try {
    if (hostPlatform === 'darwin') measured = parseSwapUsage(swapUsage());
    else if (hostPlatform === 'linux') measured = parseMemInfoSwap(memInfo());
  } catch { measured = null; }
  return measured ?? Object.freeze({ totalBytes: null, freeBytes: null, usedBytes: null });
}

/** #561: the free disk of the filesystem behind `path` — the volume every lease record, queue
 * entry and paging file this authority governs lives on — or null terms when the observation
 * cannot be made. Never throws. */
export function hostDiskObservation({ path = tmpdir(), statfs = statfsSync } = {}) {
  try {
    const stats = statfs(path);
    const diskTotalBytes = Number(stats.blocks) * Number(stats.bsize);
    const diskFreeBytes = Number(stats.bavail) * Number(stats.bsize);
    if (!Number.isSafeInteger(diskTotalBytes) || diskTotalBytes <= 0
      || !Number.isSafeInteger(diskFreeBytes) || diskFreeBytes < 0) {
      return Object.freeze({ diskTotalBytes: null, diskFreeBytes: null });
    }
    return Object.freeze({ diskTotalBytes, diskFreeBytes });
  } catch {
    return Object.freeze({ diskTotalBytes: null, diskFreeBytes: null });
  }
}
/** Measure available memory the platform's own way; `os.freemem()` is the fallback where no
 * platform report exists or the report cannot be read. Never throws. */
export function hostAvailableMemoryBytes({
  platform: hostPlatform = platform(), freeBytes = freemem(), totalBytes = totalmem(),
  vmStat = () => execFileSync('/usr/bin/vm_stat', [], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }),
  memInfo = () => readFileSync('/proc/meminfo', 'utf8'),
} = {}) {
  let measured = null;
  try {
    if (hostPlatform === 'darwin') measured = parseVmStat(vmStat())?.availableBytes ?? null;
    else if (hostPlatform === 'linux') measured = parseMemInfoAvailable(memInfo());
  } catch { measured = null; }
  const available = measured ?? freeBytes;
  return Math.min(totalBytes, Math.max(freeBytes, available));
}

/** The host observation every threshold derives from. Dependencies are injectable so a test can
 * stage a loaded host; production reads the machine. A STAGED observation (one that names its
 * `freeBytes`) reads `availableBytes` as that same number unless it names it too, so a staged
 * host never reaches for the real machine's vm_stat — and #561's swap and disk terms follow the
 * same law: a staged observation reads them only when it names them, and reads null otherwise.
 * Production (no staged memory) measures swap the platform's way and the free disk of `path`'s
 * filesystem — by default the system temp root, the volume the default lease root lives on. */
export function hostCapacityObservation({
  cores = availableParallelism(), totalBytes = totalmem(), freeBytes, availableBytes,
  load1m = loadavg()[0] ?? 0,
  swapTotalBytes, swapFreeBytes, diskTotalBytes, diskFreeBytes,
  path = tmpdir(), swapUsage, memInfo, statfs,
} = {}) {
  const staged = freeBytes !== undefined;
  const free = staged ? freeBytes : freemem();
  const available = availableBytes !== undefined
    ? availableBytes
    : (staged ? free : hostAvailableMemoryBytes({ freeBytes: free, totalBytes }));
  const swap = staged
    ? { totalBytes: swapTotalBytes ?? null, freeBytes: swapFreeBytes ?? null }
    : hostSwapObservation({ ...(swapUsage ? { swapUsage } : {}), ...(memInfo ? { memInfo } : {}) });
  const disk = staged
    ? { diskTotalBytes: diskTotalBytes ?? null, diskFreeBytes: diskFreeBytes ?? null }
    : hostDiskObservation({ path, ...(statfs ? { statfs } : {}) });
  if (!Number.isSafeInteger(cores) || cores <= 0) throw new TypeError('host capacity cores must be a positive safe integer');
  if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) throw new TypeError('host capacity total memory must be a positive safe integer');
  if (!Number.isSafeInteger(free) || free < 0 || free > totalBytes) throw new TypeError('host capacity free memory must be a safe integer within total memory');
  if (!Number.isSafeInteger(available) || available < 0 || available > totalBytes) throw new TypeError('host capacity available memory must be a safe integer within total memory');
  if (!Number.isFinite(load1m) || load1m < 0) throw new TypeError('host capacity load average must be a non-negative finite number');
  return Object.freeze({
    cores, totalBytes, freeBytes: free, availableBytes: available, load1m,
    swapTotalBytes: swap.totalBytes, swapFreeBytes: swap.freeBytes,
    diskTotalBytes: disk.diskTotalBytes, diskFreeBytes: disk.diskFreeBytes,
  });
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
 *   coreShare     floor(totalBytes / cores) — one core's equal share of memory; ONE verdict is
 *                 entitled to ONE share (#561: the every-core-shares number was the same
 *                 hardware analogy the 2026-09-18 ruling retired for workers — a suite runs
 *                 file lanes side by side, not one memory share per core, and a weight no real
 *                 host could fund made the verify lease decorate every admission it judged).
 *   usableBytes   totalBytes − coreShare — memory after the hub's share.
 *   swapGrowth    min(swapFreeBytes, diskFreeBytes) — the swap the OS could actually page into:
 *                 swap grows only into free disk, so headroom the disk cannot back is not
 *                 headroom (the 2026-09-22 incident: 9.1 of 9.7 GiB swap used, 559 MiB free
 *                 disk, so swap could not grow and the kernel killed for low-swap). Unmeasured
 *                 swap or disk claims no headroom.
 *   pagingBytes   availableBytes + swapGrowth — the memory the OS can actually hand out.
 *   diskTight     diskFreeBytes < suiteBytes — the disk cannot back the paging one verdict may
 *                 need; a standing property like memoryTight, judged with it.
 *   memoryTight   pagingBytes < suiteBytes — paging headroom cannot fund one more verdict.
 *   saturated     load1m ≥ cores — the operator's `uptime` read, derived: at or above a
 *                 one-minute load equal to the core count the host is already oversubscribed,
 *                 and new heavy work queues.
 *   suiteLanes    saturated ? 1 : min(usableCores, floor(usableBytes / coreShare)) — the suite
 *                 runner's default file parallelism (#297/#424), stated here beside the other
 *                 derivations because the observation's LOAD is one of its terms: a host already
 *                 at its core count takes ONE lane, never a full-width burst into a host that is
 *                 already oversubscribed (the 2026-09-18 load-58 incident, #424).
 *
 * A worker (a recruited participant) holds no derived CORE slot (operator ruling, 2026-09-18):
 * its admission weight is measured, not assumed — the mean bytes the measured worker leases
 * actually hold, summed into the budget by the authority (#561). An unmeasured fleet admits its
 * first worker weight-free: the host learns the footprint from the workers it runs.
 */
export function deriveHostCapacity(observation) {
  const { cores, totalBytes, freeBytes, availableBytes, load1m,
    swapTotalBytes, swapFreeBytes, diskTotalBytes, diskFreeBytes } = hostCapacityObservation(observation);
  const hubCores = 1;
  const usableCores = Math.max(1, cores - hubCores);
  const suiteCores = Math.max(1, cores - hubCores);
  const verdictLanes = Math.max(1, Math.floor(usableCores / suiteCores));
  const coreShareBytes = Math.floor(totalBytes / cores);
  const suiteBytes = coreShareBytes;
  const usableBytes = totalBytes - coreShareBytes;
  const swapGrowthBytes = swapFreeBytes !== null && diskFreeBytes !== null
    ? Math.min(swapFreeBytes, diskFreeBytes)
    : 0;
  const pagingBytes = availableBytes + swapGrowthBytes;
  return Object.freeze({
    cores, totalBytes, freeBytes, availableBytes, load1m,
    swapTotalBytes, swapFreeBytes, diskTotalBytes, diskFreeBytes,
    hubCores, usableCores, suiteCores, verdictLanes, coreShareBytes, suiteBytes, usableBytes,
    swapGrowthBytes, pagingBytes,
    saturated: load1m >= cores,
    memoryTight: pagingBytes < suiteBytes,
    diskTight: diskFreeBytes !== null && diskFreeBytes < suiteBytes,
  });
}

/** The weight ONE admitted lease charges the derived budget: a verify charges the derived
 * verdict cost (every core but the hub's, one memory share); a worker charges its MEASURED
 * bytes, which the caller supplies on the used budget (`used.workerBytes`) rather than here —
 * a lease record's measurement is state the authority counts, not a derivation. */
function leaseWeight(kind, capacity) {
  return kind === 'verify'
    ? Object.freeze({ cores: capacity.suiteCores, bytes: capacity.suiteBytes })
    : Object.freeze({ cores: 0, bytes: 0 });
}

/** The mean bytes one measured worker lease holds — the weight ONE more worker is judged
 * against (#561: the memory each running worker actually holds, not an assumption). Zero while
 * no measurement exists, so an unmeasured fleet admits its first worker weight-free. */
export function measuredWorkerWeightBytes(used) {
  const measured = used?.workerMeasured ?? 0;
  const bytes = used?.workerBytes ?? 0;
  if (!Number.isSafeInteger(measured) || measured <= 0 || !Number.isSafeInteger(bytes) || bytes <= 0) return 0;
  return Math.max(1, Math.ceil(bytes / measured));
}

/** Whether the host's own measurement is too tight for ONE lease of this kind (the budget of
 * already-admitted leases is judged separately by `budgetFits`). A verify judges BOTH standing
 * dimensions — paging headroom and the disk that must back the paging; a worker judges neither:
 * its gate is the measured byte budget alone, so a standing-tight host still runs its seats. */
function memoryTightFor(kind, capacity) {
  return kind === 'verify' && (capacity.memoryTight || capacity.diskTight);
}

/** Whether the derived budget has room for ONE more lease of this kind beside `used`. A
 * worker's own held bytes and its measured per-worker weight are part of the byte budget. */
function budgetFits(kind, capacity, used) {
  const weight = leaseWeight(kind, capacity);
  const workerBytes = kind === 'worker' ? (used.workerBytes ?? 0) + measuredWorkerWeightBytes(used) : 0;
  return used.cores + weight.cores <= capacity.usableCores
    && used.bytes + workerBytes + weight.bytes <= capacity.usableBytes;
}

/** Whether ONE more lease of this kind is admissible right now. A verify is admissible when
 * the host's standing measurements fund one more (paging headroom, disk to back the paging) and
 * the budget the admitted leases leave has room for it. A worker is admissible when the byte
 * budget funds its measured weight (#561); standing tightness never gates a seat, and no
 * load-average threshold exists (#541: a cutoff on agent control flow, removed). */
function roomFor(kind, capacity, used) {
  return !memoryTightFor(kind, capacity) && budgetFits(kind, capacity, used);
}

/** #329: WHY a request of this kind does not fit right now — the ONE dimension an operator can
 * act on, with the observed and required numbers, so a queued request names what it waits on.
 * `memory` (paging headroom below the verdict share, a verify standing property), `disk` (the
 * disk that must back the paging is below the share — #561), or `budget` (admitted leases hold
 * the cores or bytes this kind needs). Null when the request fits. */
export function hostCapacityShortfall(kind, capacity, used) {
  const weight = leaseWeight(kind, capacity);
  if (memoryTightFor(kind, capacity)) {
    if (capacity.memoryTight) {
      return Object.freeze({ dimension: 'memory', observed: capacity.pagingBytes, required: weight.bytes, unit: 'bytes' });
    }
    return Object.freeze({ dimension: 'disk', observed: capacity.diskFreeBytes, required: weight.bytes, unit: 'bytes' });
  }
  if (weight.cores > 0 && used.cores + weight.cores > capacity.usableCores) {
    return Object.freeze({ dimension: 'budget', observed: capacity.usableCores - used.cores, required: weight.cores, unit: 'cores' });
  }
  const heldBytes = used.bytes + (kind === 'worker' ? (used.workerBytes ?? 0) : 0);
  const requiredBytes = kind === 'worker' ? measuredWorkerWeightBytes(used) : weight.bytes;
  if (requiredBytes > 0 && heldBytes + requiredBytes > capacity.usableBytes) {
    return Object.freeze({ dimension: 'budget', observed: capacity.usableBytes - heldBytes, required: requiredBytes, unit: 'bytes' });
  }
  return null;
}

/** The operator's documented bypass, named by every capacity refusal (#329). */
export const HOST_CAPACITY_BYPASS = 'BATON_HOST_CAPACITY_DISABLED=1';

/** #495: the ONE row kind the post-admission shed records — what was shed (the lease kind, holder,
 * residentId and acquiredAt) and why (the memory shortfall's observed and required numbers). The
 * resident that watches the authority writes it on its own ledger. */
export const HOST_CAPACITY_SHED_ROW = 'host.capacity_shed';

/** #333: the verify state of ONE swarm participant, derived from the authority's visible
 * queue and the holders of live verify leases — the projection the swarm view's participant
 * row carries as `verify {state, position, ahead, holderAlive}` (the holder liveness is #506's).
 * The holder name is the lease holder the
 * runtime mints per seat (`participant:<swarmId>:<participantId>`): a queue entry under that
 * name reads `{state: 'queued', position, ahead}` (the entry's own place when it carries one,
 * else its FIFO index), a live verify lease under it reads `{state: 'admitted'}` (position
 * and ahead are null — an admitted seat waits on nothing), and anything else reads null:
 * absence is absence, never a guessed row. Only exact verify records for this holder match —
 * one seat's lease never projects onto another seat's row, and worker leases never read as a
 * verdict. Returns a frozen row or null; never throws on unstructured input, so the view can
 * call it per row. */
export function projectParticipantVerify(queue, verifyHolders, holder) {
  if (typeof holder !== 'string' || holder.length === 0) return null;
  const entries = Array.isArray(queue) ? queue : [];
  const index = entries.findIndex((row) => row?.kind === 'verify' && row?.holder === holder);
  if (index !== -1) {
    const found = entries[index];
    return Object.freeze({
      state: 'queued',
      position: Number.isSafeInteger(found?.position) ? found.position : index + 1,
      ahead: Number.isSafeInteger(found?.ahead) ? found.ahead : index,
      holderAlive: found?.holderAlive === true,
    });
  }
  const holders = Array.isArray(verifyHolders) ? verifyHolders
    : (verifyHolders instanceof Set ? [...verifyHolders] : []);
  if (holders.includes(holder)) return Object.freeze({ state: 'admitted', position: null, ahead: null });
  return null;
}

/** The suite runner's default file parallelism — the same derivation every resident reads
 * (#297 item 3), plus the observation's load (#424): one core for the runner's own loop, no more
 * lanes than the memory the host can fund at one share per lane, and ONE lane when the host is
 * already saturated at its own core count. The lane width is the guard that outlives admission:
 * a run the authority cannot admit proceeds degraded without mutual exclusion, and then the only
 * thing between it and the host is this count. BATON_SUITE_PARALLELISM remains the operator
 * override, and only the derivation's own terms decide the number. */
export function defaultSuiteParallelism(observation = undefined) {
  const capacity = deriveHostCapacity(observation ?? hostCapacityObservation());
  if (capacity.saturated) return 1;
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

/** #561: a worker lease may carry its holder's MEASURED footprint (`bytes`, optional — only a
 * worker record may name it), so the byte budget counts what the running seats actually hold
 * instead of assuming a weight no one measured. The lease record stays EXACT: a worker record's
 * keys are LEASE_FIELDS plus at most `bytes`; every other record's keys are exactly its set. */
function validateRecord(record, fields) {
  const keys = Boolean(record) && typeof record === 'object' && !Array.isArray(record)
    ? Object.keys(record) : [];
  const keysMatch = fields === LEASE_FIELDS && record?.kind === 'worker'
    ? keys.filter((name) => name !== 'bytes').sort().join(',') === [...LEASE_FIELDS].sort().join(',')
    : keys.sort().join(',') === [...fields].sort().join(',');
  return keysMatch
    && HOST_CAPACITY_LEASE_KINDS.includes(record?.kind)
    && typeof record.residentId === 'string' && record.residentId.length > 0 && Buffer.byteLength(record.residentId) <= 128
    && typeof record.holder === 'string' && Buffer.byteLength(record.holder) <= 256
    && typeof record.nonce === 'string' && /^[a-f0-9]{32}$/u.test(record.nonce)
    && Number.isSafeInteger(record.pid) && record.pid > 0
    && (record.bytes === undefined
      || (Number.isSafeInteger(record.bytes) && record.bytes > 0))
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
  // #495: the exhaustion episode's own state. `#exhaustionSeen` is what the PREVIOUS observation
  // read (the condition must persist across one observation before it sheds — a single platform
  // reading is a sighting, never a shed); `#exhaustionActed` is whether this episode already spent
  // its ONE shed; a check that finds room again closes the episode. `#exhaustionWatch` is the
  // resident's watch timer and `#exhaustionWatchInFlight` keeps one check in flight at a time.
  #exhaustionSeen = false;
  #exhaustionActed = false;
  #exhaustionWatch = null;
  #exhaustionWatchInFlight = false;

  constructor({
    root = defaultHostCapacityRoot(), residentId = `resident-${process.pid}`,
    observation = hostCapacityObservation, liveness = livePid,
    now = Date.now, pollMs = DEFAULT_POLL_MS,
    shedPollMs = DEFAULT_SHED_POLL_MS,
  } = {}) {
    if (typeof root !== 'string' || root.length === 0 || !isAbsolute(root)) throw new TypeError('host capacity lease root must be one absolute path');
    if (typeof residentId !== 'string' || residentId.length === 0 || Buffer.byteLength(residentId) > 128) throw new TypeError('host capacity resident id must be one bounded non-empty string');
    if (typeof observation !== 'function' || typeof liveness !== 'function' || typeof now !== 'function') throw new TypeError('host capacity dependencies must be functions');
    if (!Number.isSafeInteger(pollMs) || pollMs <= 0) throw new TypeError('host capacity poll interval must be a positive safe integer');
    if (!Number.isSafeInteger(shedPollMs) || shedPollMs <= 0) throw new TypeError('host capacity shed poll interval must be a positive safe integer');
    this.root = root;
    this.residentId = residentId;
    this.observation = observation;
    this.liveness = liveness;
    this.now = now;
    this.pollMs = pollMs;
    this.shedPollMs = shedPollMs;
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
    let workerBytes = 0;
    let workerMeasured = 0;
    const leases = { verify: 0, worker: 0 };
    for (const record of listRecords(this.leasesDir, 'host capacity lease', LEASE_FIELDS)) {
      const weight = leaseWeight(record.kind, capacity);
      cores += weight.cores;
      bytes += weight.bytes;
      leases[record.kind] += 1;
      // #561: a worker lease's measured footprint rides the budget it names — the bytes its
      // seat actually holds, not an assumption about seats in general.
      if (record.kind === 'worker' && Number.isSafeInteger(record.bytes) && record.bytes > 0) {
        workerBytes += record.bytes;
        bytes += record.bytes;
        workerMeasured += 1;
      }
    }
    return Object.freeze({
      cores, bytes, workerBytes, workerMeasured,
      leases: Object.freeze(leases),
    });
  }

  #queueRows(entries) {
    return Object.freeze(entries.map((record, index) => Object.freeze({
      position: index + 1,
      ahead: index,
      kind: record.kind,
      residentId: record.residentId,
      holder: record.holder,
      enqueuedAt: record.enqueuedAt,
      // Issue #506: the holder's own liveness on every visible row, so a dead front-of-queue
      // holder never reads like a live queued request on the view or the doctor. The mutating
      // read swept proved-dead entries before this point; this per-row fact is what makes the
      // non-mutating read truthful in between sweeps.
      holderAlive: this.liveness(record.pid),
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
        roomForVerify: roomFor('verify', capacity, used),
        roomForWorker: roomFor('worker', capacity, used),
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
    let workerBytes = 0;
    let workerMeasured = 0;
    const leases = { verify: 0, worker: 0 };
    for (const record of listRecords(this.leasesDir, 'host capacity lease', LEASE_FIELDS)) {
      if (!this.liveness(record.pid)) continue;
      const weight = leaseWeight(record.kind, capacity);
      cores += weight.cores;
      bytes += weight.bytes;
      leases[record.kind] += 1;
      if (record.kind === 'worker' && Number.isSafeInteger(record.bytes) && record.bytes > 0) {
        workerBytes += record.bytes;
        bytes += record.bytes;
        workerMeasured += 1;
      }
    }
    const queue = this.#queueRows(listRecords(this.queueDir, 'host capacity queue', QUEUE_FIELDS));
    const used = Object.freeze({
      cores, bytes, workerBytes, workerMeasured,
      leases: Object.freeze(leases),
    });
    return Object.freeze({
      capacity, used, queue,
      roomForVerify: roomFor('verify', capacity, used),
      roomForWorker: roomFor('worker', capacity, used),
    });
  }

  /** #333: one participant's verify state for the swarm view row — the same non-mutating read
   * `observeNow()` performs (live-pid verify leases only, so a crashed resident's lease never
   * pins a row), folded through `projectParticipantVerify` for the holder
   * `participant:<swarmId>:<participantId>`. Admission correctness never depends on this read;
   * it is what the participant row shows. */
  observeParticipantVerify(holder) {
    const queue = this.#queueRows(listRecords(this.queueDir, 'host capacity queue', QUEUE_FIELDS));
    const holders = [];
    for (const record of listRecords(this.leasesDir, 'host capacity lease', LEASE_FIELDS)) {
      if (record.kind !== 'verify' || !this.liveness(record.pid)) continue;
      holders.push(record.holder);
    }
    return projectParticipantVerify(queue, holders, holder);
  }

  // ── admission ───────────────────────────────────────────────────────────────────────────────────

  /** Admit one unit of heavy work. Resolves with `{token}` once the derived budget admits the
   * request; while it does not, the request waits IN ORDER as a visible queue entry and
   * `onQueued` is called once with {position, ahead}. The wait is not bounded: a request that
   * cannot be admitted now is admitted when the requests ahead of it release, and is never
   * refused for having waited (#541).
   *
   * `durable` (a verify option, #561) changes what a STANDING-tight host answers: a suite a
   * worker seat started takes the same verify lease as a landing gate, so its request queues
   * with no deadline instead of taking the degraded answer. Without `durable`, the #541 law
   * stands: a host whose memory cannot fund one full suite is a standing property, not a queue
   * — the request answers at once, no lease, the shortfall named, and the caller proceeds
   * without the exclusion a lease would buy.
   *
   * `bytes` (a worker option, #561) records the MEASURED footprint the admitted seat's process
   * holds, when the caller knows one at admission; `observeWorkerBytes` lands later
   * measurements on the same record.
   *
   * `signal` (optional, #576) ends the wait when it aborts: the request's own queue entry is
   * removed — an abandoned wait never pins the queue behind a dead request — and the acquire
   * throws `host_capacity_acquire_aborted`. A caller that passes no signal keeps the unbounded
   * #541 wait. */
  async acquire(kind, { holder = '', onQueued = null, durable = false, bytes = null, signal = null } = {}) {
    if (!HOST_CAPACITY_LEASE_KINDS.includes(kind)) throw new TypeError(`host capacity lease kind must be one of ${HOST_CAPACITY_LEASE_KINDS.join(', ')}`);
    if (typeof holder !== 'string') throw new TypeError('host capacity lease holder must be a string');
    if (onQueued !== null && typeof onQueued !== 'function') throw new TypeError('host capacity onQueued must be a function');
    if (typeof durable !== 'boolean') throw new TypeError('host capacity durable must be a boolean');
    if (bytes !== null && (!Number.isSafeInteger(bytes) || bytes <= 0)) throw new TypeError('host capacity measured bytes must be a positive safe integer');
    if (signal !== null && typeof signal !== 'object') throw new TypeError('host capacity acquire signal must be an AbortSignal');
    const abandoned = () => Object.assign(new Error('host capacity acquire was abandoned before admission'), { code: 'host_capacity_acquire_aborted' });
    if (signal?.aborted === true) throw abandoned();
    this.#ensureRoot();
    const nonce = randomBytes(16).toString('hex');
    let queuedAt = null;
    let reportedQueue = false;
    for (;;) {
      if (signal?.aborted) {
        try {
          for (const name of readdirSync(this.queueDir)) {
            if (name.includes(nonce)) { rmSync(join(this.queueDir, name), { force: true }); break; }
          }
        } catch { /* queue entry may not exist */ }
        const reason = signal.reason;
        throw Object.assign(
          new Error(typeof reason?.message === 'string' ? reason.message : 'lease acquisition aborted'),
          { code: typeof reason?.code === 'string' ? reason.code : 'integrate_withdrawn' },
        );
      }
      const outcome = await this._mutex(() => {
        this.#sweep();
        const capacity = deriveHostCapacity(hostCapacityObservation(this.observation()));
        const used = this.#usedBudget(capacity);
        const entries = listRecords(this.queueDir, 'host capacity queue', QUEUE_FIELDS);
        const mine = entries.find((record) => record.nonce === nonce) ?? null;
        // #576: an aborted wait withdraws its own queue row before the caller leaves — the
        // resident that fenced it is exiting, so pid liveness cannot be what frees the slot.
        if (signal?.aborted === true) {
          if (mine) {
            rmSync(join(this.queueDir, queueName(mine)), { force: true });
            fsyncDirectory(this.queueDir);
          }
          return Object.freeze({ aborted: true });
        }
        const ahead = mine ? entries.indexOf(mine) : entries.length;
        const head = mine === null || ahead === 0;
        if (kind === 'verify' && mine === null && !durable && memoryTightFor(kind, capacity)) {
          return Object.freeze({ degraded: hostCapacityShortfall(kind, capacity, used) });
        }
        // A verify is judged against the verdict's derived cost and the budget the admitted
        // leases leave; a worker is judged against the bytes its measured fleet holds.
        if (head && roomFor(kind, capacity, used)) {
          const lease = {
            schemaVersion: 1, kind, holder, nonce, pid: process.pid,
            residentId: this.residentId, acquiredAt: new Date(this.now()).toISOString(),
            ...(kind === 'worker' && bytes !== null ? { bytes } : {}),
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
          queued: {
            position: ahead + 1, ahead, running: used.leases.verify, workerLeases: used.leases.worker,
            // #329: the dimension this request waits on, with the numbers, so the queued row
            // and the refusal name what an operator can act on.
            shortfall: hostCapacityShortfall(kind, capacity, used),
          },
        });
      });
      if (outcome.aborted) throw abandoned();
      if (outcome.degraded) return Object.freeze({ token: null, degraded: outcome.degraded });
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
      // The poll waits on the signal too, so an abort ends the wait within its own instant
      // rather than a poll later; the loop's next pass withdraws the queue row.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, this.pollMs);
        if (signal !== null) {
          if (signal.aborted === true) { clearTimeout(timer); resolve(); return; }
          signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        }
      });
    }
  }

  /** #561: land a fresh MEASURED footprint on this resident's own admitted worker lease — the
   * runtime reads what its seat's process actually holds and writes it here, so the byte budget
   * counts reality. A lease another resident owns is not ours to rewrite (identity is (nonce,
   * residentId), the release law); a nonce this resident holds no worker lease for answers
   * false. */
  async observeWorkerBytes(holder, nonce, measuredBytes) {
    if (typeof holder !== 'string' || holder.length === 0) throw new TypeError('host capacity worker measurement requires a holder');
    if (typeof nonce !== 'string' || !/^[a-f0-9]{32}$/u.test(nonce)) throw new TypeError('host capacity worker measurement requires an exact lease nonce');
    if (!Number.isSafeInteger(measuredBytes) || measuredBytes <= 0) throw new TypeError('host capacity worker measurement must be a positive safe integer');
    return this._mutex(() => {
      const path = join(this.leasesDir, leaseName({ kind: 'worker', nonce }));
      const record = readRecord(path, 'host capacity lease', LEASE_FIELDS);
      if (record === null || record.kind !== 'worker' || record.holder !== holder
        || record.residentId !== this.residentId) return false;
      atomicWrite(path, { ...record, bytes: measuredBytes });
      fsyncDirectory(this.leasesDir);
      return true;
    });
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

  // ── post-admission shedding (#495) ─────────────────────────────────────────────────────────────

  /** The newest admitted verify lease by `acquiredAt`, ties broken by nonce DESCENDING — the
   * reverse of the queue's own same-instant order, so the lease that arrived LAST is the one that
   * yields. Only verify leases are candidates: a worker holds no slot, so removing a worker's
   * record returns nothing to the budget (see deriveHostCapacity). Null when none is admitted. */
  #newestVerifyLease() {
    let newest = null;
    for (const record of listRecords(this.leasesDir, 'host capacity lease', LEASE_FIELDS)) {
      if (record.kind !== 'verify') continue;
      if (newest === null || record.acquiredAt > newest.acquiredAt
        || (record.acquiredAt === newest.acquiredAt && record.nonce > newest.nonce)) {
        newest = record;
      }
    }
    return newest;
  }

  /** #495: the post-admission half of the capacity rule. Admission judges a request BEFORE it
   * starts; nothing judged the leases already admitted, so a host that loses the memory to fund the
   * verify runs it admitted went on counting them and no reader learned that the host can no longer
   * pay for what it holds. This is that reading, on the SAME observation and the SAME derivation
   * admission refuses on.
   *
   * The host is GENUINELY exhausted when `hostCapacityShortfall` refuses the verify kind on the
   * `memory` dimension — `pagingBytes` (available memory plus the swap the disk can still back)
   * below the `suiteBytes` share every admitted verify was measured against — while verify
   * leases are admitted, and seen on two consecutive observations.
   * One reading records a sighting; the second sheds the newest admitted verify lease's record and
   * answers ONE typed row naming what was shed and the observed and required numbers; the next
   * `observe`/`observeNow` reads the freed budget.
   *
   * Bounded by construction: ONE shed per exhaustion episode. The memory an admitted lease's
   * process holds is not returned by removing its record, so a host that stays exhausted is not
   * stripped lease by lease — further sheds would only make the ledger describe a host that funds
   * nothing while its suites run. An observation with room again closes the episode, and a later
   * exhaustion sheds the newest lease admitted at that time. A `load` shortfall — the host at or
   * above its own core count — records no exhaustion: a shed admits nothing there.
   *
   * Runs under the host mutex: the dead-holder sweep runs first, so a crashed resident's lease is
   * reclaimed and leaves the candidate set; the removal is an exact-name `rmSync({ force: true })`
   * — the module's own pattern — so a release racing the shed is a no-op on both sides. */
  async shedIfExhausted() {
    return this._mutex(() => {
      this.#sweep();
      const capacity = deriveHostCapacity(hostCapacityObservation(this.observation()));
      const used = this.#usedBudget(capacity);
      const shortfall = used.leases.verify > 0 ? hostCapacityShortfall('verify', capacity, used) : null;
      if (shortfall === null || shortfall.dimension !== 'memory') {
        // Room again (or nothing admitted to shed): the episode is over.
        this.#exhaustionSeen = false;
        this.#exhaustionActed = false;
        return null;
      }
      if (this.#exhaustionActed || !this.#exhaustionSeen) {
        this.#exhaustionSeen = true;
        return null;
      }
      const shed = this.#newestVerifyLease();
      if (shed === null) return null;
      rmSync(join(this.leasesDir, shed.name), { force: true });
      fsyncDirectory(this.leasesDir);
      this.#exhaustionActed = true;
      return Object.freeze({
        kind: HOST_CAPACITY_SHED_ROW,
        leaseKind: shed.kind,
        holder: shed.holder,
        residentId: shed.residentId,
        acquiredAt: shed.acquiredAt,
        shortfall,
        at: new Date(this.now()).toISOString(),
      });
    });
  }

  /** #495: the resident's post-admission watch — a bounded interval that asks
   * `shedIfExhausted()` every `shedPollMs` and hands each shed row to `onShed`, which the resident
   * records on its own ledger. Bounded like every other wait here: the timer does not keep the
   * process alive (`unref`), one check is in flight at a time, and the check itself yields (it
   * takes the host mutex and returns a promise). A handler that throws leaves the watch running.
   * Idempotent: a second call returns the timer already running. */
  watchExhaustion(onShed) {
    if (typeof onShed !== 'function') throw new TypeError('host capacity exhaustion watch requires a shed row handler');
    if (this.#exhaustionWatch !== null) return this.#exhaustionWatch;
    const timer = setInterval(() => {
      if (this.#exhaustionWatchInFlight) return;
      this.#exhaustionWatchInFlight = true;
      this.shedIfExhausted().then((row) => {
        this.#exhaustionWatchInFlight = false;
        if (row === null) return;
        try { onShed(row); } catch { /* a failing handler leaves the watch running */ }
      }, () => { this.#exhaustionWatchInFlight = false; });
    }, this.shedPollMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.#exhaustionWatch = timer;
    return timer;
  }

  /** #495: stop the watch (a closing resident calls this). True when one was running, false when
   * none was — the same shape `release` answers with. */
  stopExhaustionWatch() {
    if (this.#exhaustionWatch === null) return false;
    clearInterval(this.#exhaustionWatch);
    this.#exhaustionWatch = null;
    return true;
  }
}
