import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as Bend from "./bend.ts";
import * as Comp from "./comp.ts";
import * as Fact from "./facts.ts";
import type { BodyInput } from "./store.ts";

function error_record(error: unknown): { name: string; message: string; formatted: string; stack: string | null } {
  Comp.diagnostic_error(error);
  return { name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : String(error),
    formatted: (error as Bend.Err)?.$ === "Err" ? Bend.err_show(error as Bend.Err) : String(error),
    stack: error instanceof Error ? error.stack ?? null : null };
}
function result(file: string, value: unknown): void {
  const partial = file + ".partial";
  fs.writeFileSync(partial, JSON.stringify(value));
  fs.renameSync(partial, file);
}
function send(value: unknown): void { process.stdout.write(JSON.stringify(value) + "\n"); }

// Resident size and its high-water mark in bytes. Linux can reset the mark, so
// a reading after reset_peak() covers only the time since that reset.
function resident(): { rss: number; peak: number } {
  if (process.platform === "linux") {
    const status = fs.readFileSync("/proc/self/status", "utf8");
    const field = (name: string): number => Number(new RegExp("^" + name + ":\\s+(\\d+) kB$", "m").exec(status)?.[1]) * 1024;
    const rss = field("VmRSS"), peak = field("VmHWM");
    if (rss > 0 && peak > 0) return { rss, peak: Math.max(rss, peak) };
  }
  return { rss: process.memoryUsage().rss, peak: Math.max(process.memoryUsage().rss, process.resourceUsage().maxRSS * 1024) };
}
function reset_peak(): boolean {
  if (process.platform !== "linux") return false;
  try { fs.writeFileSync("/proc/self/clear_refs", "5"); return true; } catch { return false; }
}

const [phase, directory, argument] = process.argv.slice(2);
if (phase === "front") {
  const request = JSON.parse(fs.readFileSync(argument, "utf8"));
  const started = new Date().toISOString(), before = performance.now();
  try {
    const Main = await import("./main.ts");
    const prepared = await Main.prepare_file(request.file, directory, request.outputs);
    result(request.result, { ok: true, ...prepared, pid: process.pid, started,
      ended: new Date().toISOString(), duration_ms: performance.now() - before,
      memory: process.memoryUsage(), usage: process.resourceUsage() });
  } catch (error) {
    result(request.result, { ok: false, error: error_record(error), pid: process.pid, started,
      ended: new Date().toISOString(), duration_ms: performance.now() - before,
      memory: process.memoryUsage(), usage: process.resourceUsage() });
    process.exitCode = 1;
  }
} else if (phase === "units") {
  let inputs: BodyInput[] = [], reads: Comp.HeaderReads = { names: [], listed: [] };
  const before = performance.now(), emit = Comp.unit_emitter(directory, (value, header) => {
    inputs = value; reads = header;
  });
  let last: { digest: string; facts: Fact.MutableFacts } | null = null;
  const startup = resident();
  send({ kind: "ready", pid: process.pid, startup_ms: performance.now() - before,
    rss: startup.rss, peak: startup.peak,
    memory: process.memoryUsage(), usage: process.resourceUsage() });
  let high = startup.peak;
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    const request = JSON.parse(line);
    if (request.kind === "stop") { input.close(); break; }
    const started = new Date().toISOString(), before = performance.now();
    const exact = reset_peak(), begin = resident();
    try {
      if (last?.digest !== request.snapshot_digest) {
        const data = JSON.parse(fs.readFileSync(request.snapshot, "utf8"));
        const facts = { own: new Set<string>(data.own), hot: new Set<string>(data.hot), stat: new Set<string>(data.stat) };
        if (Fact.digest(facts) !== request.snapshot_digest) throw new Error("Unit snapshot differs: " + request.unit);
        last = { digest: request.snapshot_digest, facts };
      }
      const trace = Fact.trace(), emitted = emit(request.unit, request.facts_only, last!.facts, trace);
      // The unit's own high-water mark. Without a reset, a mark that did not
      // rise during the unit leaves its peak unknown below the earlier mark.
      // The mark read after a reset can lag the resident sizes read around it, and the unit was at least
      // as large as both.
      const end = resident(), peak = exact ? Math.max(end.peak, begin.rss, end.rss)
        : end.peak > high ? end.peak : Math.max(begin.rss, end.rss);
      high = Math.max(high, end.peak);
      result(request.result, { ok: true, unit: request.unit, facts_only: request.facts_only,
        rss_before: begin.rss, rss_peak: peak, rss_after: end.rss, rss_peak_exact: exact,
        trace: trace.events, lend: [...emitted.lend], masks: emitted.masks,
        refs: [...emitted.refs], edges: emitted.edges, inputs, reads, fragment: emitted.code.directory,
        pid: process.pid, started, ended: new Date().toISOString(), duration_ms: performance.now() - before,
        memory: process.memoryUsage(), usage: process.resourceUsage() });
      send({ kind: "result", file: request.result });
    } catch (error) {
      result(request.result, { ok: false, unit: request.unit, facts_only: request.facts_only,
        error: error_record(error), pid: process.pid, started, ended: new Date().toISOString(),
        duration_ms: performance.now() - before, memory: process.memoryUsage(), usage: process.resourceUsage() });
      send({ kind: "result", file: request.result, failed: true });
      process.exitCode = 1; input.close(); break;
    }
  }
  result(path.join(argument, "worker-usage.json"), { pid: process.pid,
    ended: new Date().toISOString(), memory: process.memoryUsage(), usage: process.resourceUsage() });
} else throw new Error("Unknown compiler phase: " + phase);
