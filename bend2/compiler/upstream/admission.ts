import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

export type Profile = { peak: number; metadata: number };
export type Operation<T> = { pid: () => number | undefined; metadata: () => number | null;
  complete: Promise<{ value: T; profile: Profile }> };
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

function resident(pid: number | undefined): number | null {
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

// Profiles are observations from completed units in this compilation. New
// units finish their measurement before another unit is admitted.
export class Admission {
  private profiles = new Map<string, Profile>();
  constructor(private observe: Observe) {}

  async run<J, T>(jobs: J[], key: (job: J) => string,
    execute: (job: J) => Operation<T>): Promise<T[]> {
    type Completed = { index: number; value?: T; profile?: Profile; error?: unknown };
    type Active = { key: string; forecast: Profile | undefined;
      operation: Operation<T>; complete: Promise<Completed> };
    const active = new Map<number, Active>(), values: T[] = new Array(jobs.length);
    const failures: unknown[] = [];
    let next = 0;
    const admit = (): boolean => {
      const name = key(jobs[next]), profile = this.profiles.get(name);
      const memory = available(), cpus = os.availableParallelism();
      let growth = 0, readable = true, measuring = false;
      const residents: { key: string; pid: number | undefined; resident: number | null;
        forecast: Profile | undefined; metadata_ready: boolean }[] = [];
      for (const running of active.values()) {
        const pid = running.operation.pid(), rss = resident(pid);
        const metadata_ready = running.operation.metadata() !== null;
        residents.push({ key: running.key, pid, resident: rss, forecast: running.forecast, metadata_ready });
        if (running.forecast === undefined) measuring = true;
        if (rss === null) readable = false;
        else if (running.forecast) growth += Math.max(0, running.forecast.peak - rss)
          + (metadata_ready ? 0 : running.forecast.metadata);
      }
      const need = profile === undefined ? null : profile.peak + profile.metadata;
      const fits = profile !== undefined && !measuring && readable && memory.bytes !== null
        && need! + growth <= memory.bytes && active.size < cpus;
      // The queue has admitted this compilation. Its next solitary unit runs
      // to its actual result; external memory pressure creates no parked job.
      const allowed = active.size === 0 || fits;
      this.observe("admission", { key: name, allowed, measuring: profile === undefined,
        cpus, available: memory, reserved_growth: growth, need, residents,
        coordinator: process.memoryUsage() });
      return allowed;
    };
    const start = (index: number): void => {
      const name = key(jobs[index]), forecast = this.profiles.get(name);
      try {
        const operation = execute(jobs[index]);
        const complete = operation.complete.then(({ value, profile }) => ({ index, value, profile }),
          error => ({ index, error }));
        active.set(index, { key: name, forecast, operation, complete });
        this.observe("start", { key: name, pid: operation.pid(), forecast });
      } catch (error) { failures.push(error); }
    };
    try {
      while (next < jobs.length || active.size > 0) {
        while (failures.length === 0 && next < jobs.length && admit()) start(next++);
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
