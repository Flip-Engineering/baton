import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

// peak: bytes a unit added to its worker's resident size at the unit's high-water mark.
// metadata: bytes the coordinator added while it ingested the unit's result.
export type Profile = { peak: number; metadata: number };
export type Operation<T> = { pid: () => number | undefined; metadata: () => number | null;
  complete: Promise<{ value: T; profile: Profile }> };
// The worker processes that run the units of one compilation phase.
export interface Workers {
  // The idle worker the next unit reuses, or null when the next unit starts a new process.
  next(): { pid: number | undefined } | null;
  // The largest resident size a worker reached while it started, or null before any worker has.
  baseline(): number | null;
  // Stop one idle worker other than the next one. False when no such worker exists.
  retire(): Promise<boolean>;
}
type Observe = (event: string, details: Record<string, unknown>) => void;

function available(): { bytes: number | null; source: string; limits?: unknown[] } {
  if (process.platform !== "linux") return { bytes: os.freemem(), source: "os.freemem" };
  const match = /^MemAvailable:\s+(\d+) kB$/m.exec(fs.readFileSync("/proc/meminfo", "utf8"));
  let bytes = match === null ? null : Number(match[1]) * 1024;
  const root = "/sys/fs/cgroup", directories = new Set([root]);
  const group = /^0::(.*)$/m.exec(fs.readFileSync("/proc/self/cgroup", "utf8"))?.[1];
  if (group !== undefined) {
    let directory = path.resolve(root, "." + group);
    while (directory === root || directory.startsWith(root + "/")) {
      directories.add(directory);
      if (directory === root) break;
      directory = path.dirname(directory);
    }
  }
  const limits: { directory: string; maximum: number; current: number }[] = [];
  for (const directory of directories) {
    const limit = path.join(directory, "memory.max"), used = path.join(directory, "memory.current");
    if (!fs.existsSync(limit) || !fs.existsSync(used)) continue;
    const maximum = fs.readFileSync(limit, "utf8").trim();
    if (maximum === "max") continue;
    const current = Number(fs.readFileSync(used, "utf8")), total = Number(maximum);
    limits.push({ directory, maximum: total, current });
    bytes = Math.min(bytes ?? Infinity, Math.max(0, total - current));
  }
  return { bytes, source: "MemAvailable", limits };
}

export function resident(pid: number | undefined): number | null {
  if (pid === undefined) return null;
  try {
    if (process.platform === "linux") {
      const match = /^VmRSS:\s+(\d+) kB$/m.exec(fs.readFileSync("/proc/" + pid + "/status", "utf8"));
      return match === null ? null : Number(match[1]) * 1024;
    }
    const value = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim();
    return /^\d+$/.test(value) ? Number(value) * 1024 : null;
  } catch { return null; }
}

// Profiles are observations from completed units in this compilation. A unit
// without a profile is forecast at the largest growth any unit has shown so
// far, including the growth of units that are still running. The first unit of
// a compilation has nothing to be forecast from and runs alone.
export class Admission {
  private profiles = new Map<string, Profile>();
  private largest: Profile | undefined;
  constructor(private observe: Observe) {}

  async run<J, T>(jobs: J[], key: (job: J) => string,
    execute: (job: J) => Operation<T>, workers: Workers): Promise<T[]> {
    type Completed = { index: number; value?: T; profile?: Profile; error?: unknown };
    type Active = { key: string; forecast: Profile | undefined; started: number; ceiling: number;
      operation: Operation<T>; complete: Promise<Completed> };
    const active = new Map<number, Active>(), values: T[] = new Array(jobs.length);
    const failures: unknown[] = [];
    let next = 0, plan: { forecast: Profile | undefined; started: number; ceiling: number } | undefined;
    const evaluate = (): { allowed: boolean; limit: "memory" | "other" | null } => {
      const name = key(jobs[next]), measured = this.profiles.get(name);
      const memory = available(), cpus = os.availableParallelism();
      let growth = 0, readable = true, measuring = false, observed = 0;
      const residents: { key: string; pid: number | undefined; resident: number | null;
        forecast: Profile | undefined; metadata_ready: boolean }[] = [];
      for (const running of active.values()) {
        const pid = running.operation.pid(), rss = resident(pid);
        const metadata_ready = running.operation.metadata() !== null;
        residents.push({ key: running.key, pid, resident: rss, forecast: running.forecast, metadata_ready });
        if (running.forecast === undefined) measuring = true;
        if (rss === null) readable = false;
        else if (running.forecast) {
          growth += Math.max(0, running.ceiling - rss) + (metadata_ready ? 0 : running.forecast.metadata);
          observed = Math.max(observed, rss - running.started);
        }
      }
      const forecast = measured ?? (this.largest === undefined ? undefined
        : { peak: Math.max(this.largest.peak, observed), metadata: this.largest.metadata });
      // A unit grows from the resident size its worker has when the unit starts:
      // the idle worker's, or the size workers reach while starting.
      const reuse = workers.next(), baseline = workers.baseline();
      const origin = reuse === null ? baseline : resident(reuse.pid) ?? 0;
      const need = forecast === undefined || origin === null ? null
        : (reuse === null ? origin : 0) + forecast.peak + forecast.metadata;
      const room = need !== null && !measuring && readable && memory.bytes !== null;
      const fits_memory = room && need! + growth <= memory.bytes!;
      const fits = fits_memory && active.size < cpus;
      // The queue has admitted this compilation. Its next solitary unit runs
      // to its actual result; external memory pressure creates no parked job.
      const allowed = active.size === 0 || fits;
      plan = { forecast, started: origin ?? 0, ceiling: (origin ?? 0) + (forecast?.peak ?? 0) };
      this.observe("admission", { key: name, allowed, measuring: measured === undefined,
        forecast, cpus, available: memory, reserved_growth: growth, need, residents,
        reuse: reuse !== null, baseline, coordinator: process.memoryUsage() });
      return { allowed, limit: allowed || fits ? null : room && !fits_memory ? "memory" : "other" };
    };
    // Memory held by idle workers is returned before a unit waits for it.
    const admit = async (): Promise<boolean> => {
      for (;;) {
        const decision = evaluate();
        if (decision.limit !== "memory") return decision.allowed;
        const before = workers.next();
        if (!await workers.retire()) return false;
        this.observe("retire", { kept: before?.pid });
      }
    };
    const start = (index: number): void => {
      const name = key(jobs[index]), { forecast, started, ceiling } = plan!;
      try {
        const operation = execute(jobs[index]);
        const complete = operation.complete.then(({ value, profile }) => ({ index, value, profile }),
          error => ({ index, error }));
        active.set(index, { key: name, forecast, started, ceiling, operation, complete });
        this.observe("start", { key: name, pid: operation.pid(), forecast });
      } catch (error) { failures.push(error); }
    };
    try {
      while (next < jobs.length || active.size > 0) {
        while (failures.length === 0 && next < jobs.length && await admit()) start(next++);
        if (active.size === 0) break;
        const result = await Promise.race([...active.values()].map(value => value.complete));
        const running = active.get(result.index)!;
        active.delete(result.index);
        if ("error" in result) failures.push(result.error);
        else {
          values[result.index] = result.value!;
          const measured = result.profile!, previous = this.profiles.get(running.key);
          const profile = { peak: Math.max(measured.peak, previous?.peak ?? 0),
            metadata: Math.max(measured.metadata, previous?.metadata ?? 0) };
          this.profiles.set(running.key, profile);
          this.largest = { peak: Math.max(profile.peak, this.largest?.peak ?? 0),
            metadata: Math.max(profile.metadata, this.largest?.metadata ?? 0) };
          this.observe("measured", { key: running.key, pid: running.operation.pid(), profile });
        }
      }
    } catch (error) {
      failures.push(error);
      const remaining = await Promise.all([...active.values()].map(value => value.complete));
      for (const result of remaining) if ("error" in result) failures.push(result.error);
      active.clear();
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Compiler unit processes failed");
    return values;
  }
}
