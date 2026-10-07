import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';

const MIB = 1024 * 1024;
const MIB_KIB = 1024;
const PROCESS_SAMPLE_MAX_BUFFER = 64 * MIB;

function numericPid(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`invalid ${label}: ${value}`);
  return number;
}

export function parseLinuxProcStat(text) {
  const end = text.lastIndexOf(')');
  const start = text.indexOf('(');
  if (start < 0 || end <= start || end + 2 >= text.length) throw new Error('malformed /proc stat command field');
  const pid = numericPid(text.slice(0, start).trim(), 'Linux process ID');
  const fields = text.slice(end + 2).trim().split(/\s+/);
  if (fields.length < 22 || fields[0].length !== 1) throw new Error(`malformed /proc/${pid}/stat fields`);
  const processGroup = Number(fields[2]);
  if (!Number.isSafeInteger(processGroup) || processGroup < 0) throw new Error(`invalid Linux process group: ${fields[2]}`);
  const userTicks = Number(fields[11]);
  const systemTicks = Number(fields[12]);
  if (!Number.isSafeInteger(userTicks) || userTicks < 0 || !Number.isSafeInteger(systemTicks) || systemTicks < 0) {
    throw new Error(`invalid CPU ticks in /proc/${pid}/stat`);
  }
  return { pid, processGroup, cpuTicks: userTicks + systemTicks };
}

export function parseLinuxProcStatus(text, pid = 'unknown') {
  const match = /^VmRSS:\s+(\d+)\s+kB\s*$/m.exec(text);
  if (!match) return 0;
  const kibibytes = Number(match[1]);
  if (!Number.isSafeInteger(kibibytes) || kibibytes < 0) throw new Error(`invalid VmRSS in /proc/${pid}/status`);
  return kibibytes * MIB_KIB;
}

export function parseProcessCpuTime(value) {
  const text = String(value).trim();
  const daySplit = text.split('-');
  if (daySplit.length > 2) throw new Error(`invalid process CPU time: ${value}`);
  const days = daySplit.length === 2 ? Number(daySplit[0]) : 0;
  const clock = daySplit.at(-1).split(':');
  if ((daySplit.length === 2 && clock.length !== 3) || (clock.length !== 2 && clock.length !== 3)) {
    throw new Error(`invalid process CPU time: ${value}`);
  }
  const secondsPart = Number(clock.at(-1));
  const minutes = Number(clock.at(-2));
  const hours = clock.length === 3 ? Number(clock[0]) : 0;
  if (!Number.isFinite(days) || days < 0 || !Number.isFinite(hours) || hours < 0 ||
      !Number.isFinite(minutes) || minutes < 0 || minutes >= 60 ||
      !Number.isFinite(secondsPart) || secondsPart < 0 || secondsPart >= 60) {
    throw new Error(`invalid process CPU time: ${value}`);
  }
  return days * 86400 + hours * 3600 + minutes * 60 + secondsPart;
}

export function parseDarwinProcessRow(line) {
  const fields = String(line).trim().split(/\s+/);
  if (fields.length !== 4) throw new Error(`malformed Darwin ps row: ${line}`);
  const pid = numericPid(fields[0], 'Darwin process ID');
  const processGroup = Number(fields[1]);
  if (!Number.isSafeInteger(processGroup) || processGroup < 0) throw new Error(`invalid Darwin process group: ${fields[1]}`);
  const rssKibibytes = Number(fields[2]);
  if (!Number.isSafeInteger(rssKibibytes) || rssKibibytes < 0) throw new Error(`invalid Darwin RSS: ${fields[2]}`);
  return { pid, processGroup, rssBytes: rssKibibytes * MIB_KIB, cpuSeconds: parseProcessCpuTime(fields[3]) };
}

export function parseDarwinProcessSnapshot(text) {
  return String(text).split(/\r?\n/).filter((line) => line.trim()).map(parseDarwinProcessRow);
}

export function aggregateProcessGroup(rows, processGroup) {
  const group = numericPid(processGroup, 'process group');
  let rssBytes = 0;
  const cpuSecondsByPid = new Map();
  for (const row of rows) {
    if (row.processGroup !== group) continue;
    if (!Number.isSafeInteger(row.pid) || row.pid < 1 || !Number.isFinite(row.rssBytes) || row.rssBytes < 0 ||
        !Number.isFinite(row.cpuSeconds) || row.cpuSeconds < 0) {
      throw new Error(`invalid process snapshot row for group ${group}`);
    }
    if (cpuSecondsByPid.has(row.pid)) throw new Error(`duplicate process ${row.pid} in snapshot`);
    rssBytes += row.rssBytes;
    cpuSecondsByPid.set(row.pid, row.cpuSeconds);
  }
  return { rssBytes, cpuSecondsByPid, processCount: cpuSecondsByPid.size };
}

function cpuTicksPerSecond() {
  const result = spawnSync('getconf', ['CLK_TCK'], { encoding: 'utf8', maxBuffer: 1024 });
  if (result.error || result.status !== 0) throw new Error(`getconf CLK_TCK failed: ${result.error?.message ?? result.stderr}`);
  const rate = Number(result.stdout.trim());
  if (!Number.isSafeInteger(rate) || rate < 1) throw new Error(`invalid getconf CLK_TCK value: ${result.stdout}`);
  return rate;
}

let cachedTicksPerSecond;
function linuxSnapshot(processGroups) {
  cachedTicksPerSecond ??= cpuTicksPerSecond();
  const rows = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try {
      stat = parseLinuxProcStat(readFileSync(`/proc/${entry}/stat`, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
      throw error;
    }
    if (!processGroups.has(stat.processGroup)) continue;
    let rssBytes;
    try {
      rssBytes = parseLinuxProcStatus(readFileSync(`/proc/${entry}/status`, 'utf8'), entry);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ESRCH') continue;
      throw error;
    }
    rows.push({ ...stat, rssBytes, cpuSeconds: stat.cpuTicks / cachedTicksPerSecond });
  }
  return rows;
}

function darwinSnapshot() {
  const result = spawnSync('/bin/ps', ['-axo', 'pid=,pgid=,rss=,time='], {
    encoding: 'utf8', maxBuffer: PROCESS_SAMPLE_MAX_BUFFER,
  });
  if (result.error || result.status !== 0 || result.signal) {
    throw new Error(`ps process snapshot failed: ${result.error?.message ?? result.stderr ?? result.signal ?? result.status}`);
  }
  return parseDarwinProcessSnapshot(result.stdout);
}

function captureProcessSnapshot(processGroups) {
  if (process.platform === 'linux') return linuxSnapshot(processGroups);
  if (process.platform === 'darwin') return darwinSnapshot();
  throw new Error(`process-group resource accounting is unsupported on ${process.platform}`);
}

export function createProcessGroupSampler({ intervalMs = 50, snapshotProvider = captureProcessSnapshot } = {}) {
  if (!Number.isFinite(intervalMs) || intervalMs < 10) throw new Error('process sampling interval must be at least 10 ms');
  if (typeof snapshotProvider !== 'function') throw new Error('snapshotProvider must be a function');
  const trackers = new Map();
  let latest = new Map();
  let failure = null;
  let closed = false;

  function refresh() {
    if (closed || trackers.size === 0) return;
    const processGroups = new Set([...trackers.values()].map(({ processGroup }) => processGroup));
    const rows = snapshotProvider(processGroups);
    if (!Array.isArray(rows)) throw new Error('process snapshot provider did not return an array');
    const next = new Map();
    for (const processGroup of processGroups) next.set(processGroup, aggregateProcessGroup(rows, processGroup));
    latest = next;
  }

  function poll() {
    if (failure) return;
    try {
      refresh();
    } catch (error) {
      failure ??= error;
    }
  }

  const timer = setInterval(poll, intervalMs);
  timer.unref();

  return {
    track(processGroup) {
      if (closed) throw new Error('process-group sampler is closed');
      const group = numericPid(processGroup, 'process group');
      const key = Symbol(String(group));
      const firstTracker = trackers.size === 0;
      trackers.set(key, { processGroup: group });
      if (firstTracker && !failure) poll();
      return {
        usage() {
          if (failure) throw new Error(`process-group sampling failed: ${failure.message}`, { cause: failure });
          return latest.get(group) ?? { rssBytes: 0, cpuSecondsByPid: new Map(), processCount: 0 };
        },
        close() {
          trackers.delete(key);
          if (![...trackers.values()].some(({ processGroup }) => processGroup === group)) latest.delete(group);
        },
      };
    },
    close() {
      closed = true;
      clearInterval(timer);
      trackers.clear();
      latest.clear();
    },
  };
}
