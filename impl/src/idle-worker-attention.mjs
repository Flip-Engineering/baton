import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const OBSERVATION_TIMEOUT_MS = 1_000;
const PRESSURE_OBSERVATION_MS = 30_000;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function command(file, args, cwd) {
  return (await execute(file, args, { cwd, encoding: 'utf8', timeout: OBSERVATION_TIMEOUT_MS,
    maxBuffer: 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })).stdout;
}

async function disk(path) {
  if (!path) return { path: null, held: false, allocatedBytes: 0, observation: 'absent' };
  try {
    const value = await command('du', ['-sk', path]);
    const kb = Number(value.trim().split(/\s+/u)[0]);
    if (!Number.isSafeInteger(kb) || kb < 0) throw new Error('invalid disk observation');
    return { path, held: true, allocatedBytes: kb * 1024, observation: 'measured' };
  } catch (error) {
    return { path, held: true, allocatedBytes: null, observation: 'unavailable', code: error.code ?? 'disk_observation_unavailable' };
  }
}

async function checkout(path, baseSha) {
  if (!path) return { head: null, baseSha: baseSha ?? null, commitsAhead: null, uncommitted: null, observation: 'absent' };
  try {
    const head = (await command('git', ['rev-parse', 'HEAD'], path)).trim();
    const status = await command('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal'], path);
    const fields = status.split('\0');
    const changes = [];
    for (let i = 0; i < fields.length; i += 1) {
      const entry = fields[i];
      if (!entry) continue;
      changes.push({ status: entry.slice(0, 2), path: entry.slice(3) });
      if (/[RC]/u.test(entry.slice(0, 2))) i += 1;
    }
    let commitsAhead = null;
    if (baseSha) {
      try { commitsAhead = Number((await command('git', ['rev-list', '--count', `${baseSha}..${head}`], path)).trim()); }
      catch { /* HEAD and worktree status remain usable when the base is unavailable. */ }
    }
    return { head, baseSha: baseSha ?? null, commitsAhead,
      uncommitted: { clean: changes.length === 0, count: changes.length,
        entries: changes.slice(0, 128), omittedEntries: Math.max(0, changes.length - 128) }, observation: 'measured' };
  } catch (error) {
    return { head: null, baseSha: baseSha ?? null, commitsAhead: null, uncommitted: null,
      observation: 'unavailable', code: error.code ?? 'checkout_observation_unavailable' };
  }
}

async function processMemory(handle) {
  const ref = handle.processRef;
  if (!ref || ref.state === 'closed') return { held: false, pid: ref?.pid ?? null, residentBytes: 0, observation: 'absent' };
  const unknown = { held: true, pid: ref.pid, processGroupId: ref.processGroupId ?? null,
    residentBytes: null, observation: 'unavailable' };
  const authority = handle.processAuthority;
  if (!authority?.pidStart || authority.generation !== ref.generation
    || authority.pid !== ref.pid || authority.processGroupId !== ref.processGroupId) return unknown;
  try {
    const text = await command('/bin/ps', ['-axo', 'pid=,pgid=,rss=,lstart=']);
    const rows = text.split('\n').flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
      return match ? [{ pid: Number(match[1]), group: Number(match[2]), bytes: Number(match[3]) * 1024, start: match[4].trim() }] : [];
    });
    const leader = rows.find((row) => row.pid === ref.pid && row.group === ref.processGroupId);
    if (!leader || leader.start !== authority.pidStart || handle.processRef !== ref) return unknown;
    const members = rows.filter((row) => row.group === ref.processGroupId);
    return { held: true, pid: ref.pid, processGroupId: ref.processGroupId,
      residentBytes: members.reduce((sum, row) => sum + row.bytes, 0), processes: members.length,
      observation: 'measured', metric: 'process_group_rss_bytes' };
  } catch { return unknown; }
}

/** Read metadata and allocation sizes; credential and source file contents are not read. */
export async function observeIdleWorker(coordinator, handle) {
  const task = coordinator._tasks.get(handle.taskId);
  const path = typeof handle.worktree === 'string' ? handle.worktree : handle.worktree?.path ?? null;
  const runtime = handle.runtimeScope?.active === false ? null : handle.runtimeLease?.paths ?? null;
  const [process, worktree, runtimeHome, git] = await Promise.all([
    processMemory(handle), disk(path), disk(runtime?.root ?? runtime?.home), checkout(path, task?.worktreeBaseSha),
  ]);
  return { observedAt: new Date(coordinator._now()).toISOString(), git,
    resources: { process, worktree, runtimeHome: { ...runtimeHome, home: runtime?.home ?? null } } };
}

export async function observeIdlePressure(coordinator) {
  const dimensions = [];
  let host;
  try { host = coordinator._hostCapacity?.observeNow?.(); }
  catch { /* Disk pressure remains observable when host memory observation fails. */ }
  if (host?.capacity?.memoryTight) dimensions.push({ kind: 'memory', availableBytes: host.capacity.availableBytes,
    requiredBytes: host.capacity.suiteBytes });
  const snapshot = coordinator._worktrees?.capacitySnapshot?.();
  const path = [...coordinator._workers.values()].find((handle) => typeof handle.worktree === 'string')?.worktree;
  if (snapshot?.floor && path) {
    try {
      const observed = await statfs(path);
      const freeBytes = observed.bavail * observed.bsize;
      const freeInodes = observed.ffree;
      const outstanding = snapshot.outstanding ?? { bytes: 0, inodes: 0 };
      if (freeBytes - outstanding.bytes < snapshot.floor.bytes || freeInodes - outstanding.inodes < snapshot.floor.inodes) dimensions.push({ kind: 'disk',
        freeBytes, freeInodes, outstanding, floorBytes: snapshot.floor.bytes, floorInodes: snapshot.floor.inodes });
    } catch { /* An unavailable capacity observation is not evidence of pressure. */ }
  }
  return dimensions;
}

function idle(coordinator, entry) {
  const handle = coordinator._workers.get(entry.workerId);
  const task = handle && coordinator._tasks.get(handle.taskId);
  return handle && ['working', 'idle', 'blocked'].includes(handle.status) && !TERMINAL.has(task?.status)
    && handle.turnTerminalObserved === true && handle.turnInFlight !== true
    && handle.reportedTurnEpoch === entry.event.turnEpoch;
}

function bytes(value) { return value == null ? 'unknown' : `${value} bytes`; }

function decisionReport(report, observed, pressure = null) {
  const source = typeof report === 'object' && report !== null ? report : { summary: String(report ?? '') };
  const { process, worktree, runtimeHome } = observed.resources;
  const originalSummary = source.summary ?? null;
  const originalText = typeof originalSummary === 'string' ? originalSummary
    : typeof source.output === 'string' ? source.output : JSON.stringify(source);
  const summary = `Worker retained after its turn. Choose continue or stop. HEAD ${observed.git.head ?? 'unknown'}; `
    + `uncommitted entries ${observed.git.uncommitted?.count ?? 'unknown'}. `
    + `Process memory ${bytes(process.residentBytes)}; worktree ${worktree.path ?? 'none'} (${bytes(worktree.allocatedBytes)}); `
    + `runtime home ${runtimeHome.home ?? runtimeHome.path ?? 'none'} (${bytes(runtimeHome.allocatedBytes)}).`
    + (pressure ? ` Host pressure: ${pressure.dimensions.map((row) => row.kind).join(', ')}. Idle workers ranked by ${pressure.ranking[0]?.metric}: `
      + pressure.ranking.map((row) => `${row.rank}. ${row.workerId} (${bytes(row.value)})`).join('; ') + '.' : '')
    + `\nTurn report: ${originalText}`;
  const operatorDecision = { kind: 'retained_worker', choices: ['continue', 'stop'], originalSummary,
    ...observed, ...(pressure ? { pressure } : {}) };
  return Object.assign({ summary, operatorDecision }, source, { summary, operatorDecision });
}

export function deliverIdleReport(coordinator, handle, event, report, attention = null) {
  const runtime = coordinator._participantRuntimes?.get(handle.runId);
  return typeof runtime?.onTurnCompleted === 'function'
    ? runtime.onTurnCompleted({ workerId: handle.id, turnSeq: event.seq, turnEpoch: event.turnEpoch,
      report, attention, assignmentDone: runtime.isDone?.() === true })
    : coordinator._reportRunTurn(handle, attention ? { ...event, attention } : event, report);
}

/** Notify the worker's orchestrator; resource observations never choose an action for it. */
export class IdleWorkerAttention {
  constructor(coordinator, { observe = observeIdleWorker, pressure = observeIdlePressure,
    intervalMs = PRESSURE_OBSERVATION_MS, schedule = setTimeout, cancel = clearTimeout } = {}) {
    this.coordinator = coordinator;
    this.observe = observe;
    this.pressure = pressure;
    this.intervalMs = intervalMs;
    this.schedule = schedule;
    this.cancel = cancel;
    this.entries = new Map();
    this.pending = new Set();
    this.timer = null;
    this.running = null;
    this.episode = null;
    this.arm(true);
  }

  async report(handle, event, report, deliver) {
    const entry = { workerId: handle.id, event, report, deliver };
    this.entries.set(handle.id, entry);
    const work = (async () => {
      const observed = await this.observe(this.coordinator, handle);
      if (this.entries.get(handle.id) !== entry) return deliver(report);
      entry.observed = observed;
      if (!idle(this.coordinator, entry)) { this.entries.delete(handle.id); return deliver(report); }
      await deliver(decisionReport(report, observed));
      entry.delivered = true;
      this.arm();
    })();
    this.pending.add(work);
    try { return await work; } finally { this.pending.delete(work); this.arm(); }
  }

  arm(discover = false) {
    if (this.timer || (!discover && this.entries.size === 0) || this.coordinator._closed) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      if (this.coordinator._closed) { this.close(); return; }
      return Promise.resolve().then(() => this.coordinator._trackAuthorityPromise(() => this.check(), true))
        .catch((error) => this.coordinator._noteFailure('idle_worker_attention', error));
    }, this.intervalMs);
    this.timer?.unref?.();
  }

  async flush() { await Promise.all([...this.pending]); }

  async check() {
    if (this.running) return this.running;
    this.running = this.checkOnce();
    try { return await this.running; } finally { this.running = null; this.arm(); }
  }

  async recover() {
    for (const handle of this.coordinator._workers.values()) {
      if (this.entries.has(handle.id) || !['working', 'idle', 'blocked'].includes(handle.status)
        || handle.turnTerminalObserved !== true || handle.turnInFlight === true
        || TERMINAL.has(this.coordinator._tasks.get(handle.taskId)?.status)) continue;
      const event = this.coordinator._log.byKind(handle.id, 'lifecycle.turn_completed').at(-1);
      const report = event?.payload?.result ?? event?.payload;
      if (!event || report?.status !== 'completed') continue;
      handle.reportedTurnEpoch ??= event.turnEpoch;
      this.entries.set(handle.id, { workerId: handle.id, event, report, delivered: true,
        deliver: (value, attention) => deliverIdleReport(this.coordinator, handle, event, value, attention) });
    }
  }

  async checkOnce() {
    if (this.coordinator._closed) { this.close(); return; }
    if (this.coordinator._drainState !== 'open') return;
    if (this.coordinator._startupReconstructionPending) { this.arm(true); return; }
    await this.recover();
    for (const [id, entry] of this.entries) if (!idle(this.coordinator, entry)) this.entries.delete(id);
    if (this.entries.size === 0) { this.episode = null; return; }
    for (const entry of this.entries.values()) {
      if (entry.delivered || this.pending.size > 0 || !idle(this.coordinator, entry)) continue;
      const observed = await this.observe(this.coordinator, this.coordinator._workers.get(entry.workerId));
      if (!idle(this.coordinator, entry)) continue;
      await entry.deliver(decisionReport(entry.report, observed));
      entry.delivered = true;
    }
    const dimensions = await this.pressure(this.coordinator);
    if (dimensions.length === 0) { this.episode = null; return; }
    const entries = [...this.entries.values()].filter((entry) => entry.delivered);
    const identity = JSON.stringify([dimensions.map((row) => row.kind).sort(), entries.map((entry) => [entry.workerId, entry.event.turnEpoch, entry.event.seq]).sort()]);
    if (this.episode?.identity === identity && this.episode.complete) return;
    if (this.episode?.identity !== identity) this.episode = { identity, complete: false, seq: null };
    if (this.episode.seq === null) {
      for (const entry of entries) {
        if (!idle(this.coordinator, entry)) continue;
        entry.observed = await this.observe(this.coordinator, this.coordinator._workers.get(entry.workerId));
      }
      const memory = dimensions.some((row) => row.kind === 'memory');
      const rank = (entry) => memory ? entry.observed.resources.process.residentBytes
        : (entry.observed.resources.worktree.allocatedBytes == null || entry.observed.resources.runtimeHome.allocatedBytes == null ? null
          : entry.observed.resources.worktree.allocatedBytes + entry.observed.resources.runtimeHome.allocatedBytes);
      const ranked = entries.filter((entry) => idle(this.coordinator, entry)).sort((a, b) => (rank(b) ?? -1) - (rank(a) ?? -1) || a.workerId.localeCompare(b.workerId));
      if (ranked.length === 0) return;
      const ranking = ranked.map((entry, index) => ({ rank: index + 1, workerId: entry.workerId,
        metric: memory ? 'process_group_rss_bytes' : 'allocated_disk_bytes', value: rank(entry), resources: entry.observed.resources }));
      const event = this.coordinator._coordination.recordDriver('worker.idle_pressure_observed', { dimensions, ranking },
        { actor: 'baton-runtime', key: `idle-pressure:${this.coordinator._coordination.eventCursor()}:${createHash('sha256').update(identity).digest('hex')}` }).event;
      this.episode.seq = event.seq;
      this.episode.attention = { seq: event.seq, dimensions: event.payload.dimensions, ranking: event.payload.ranking };
      this.episode.entries = ranked.map((entry) => ({ ...entry }));
    }
    const { attention } = this.episode;
    for (const entry of this.episode.entries) if (idle(this.coordinator, entry)) {
      await entry.deliver(decisionReport(entry.report, entry.observed, attention), attention);
    }
    this.episode.complete = true;
  }

  close() {
    if (this.timer) this.cancel(this.timer);
    this.timer = null;
    this.entries.clear();
  }
}
