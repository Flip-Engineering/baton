import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as Bend from "./bend.ts";
import * as Comp from "./comp.ts";
import * as Fact from "./facts.ts";

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
  const before = performance.now(), emit = Comp.unit_emitter(directory);
  let last: { digest: string; facts: Fact.MutableFacts } | null = null;
  send({ kind: "ready", pid: process.pid, startup_ms: performance.now() - before,
    memory: process.memoryUsage(), usage: process.resourceUsage() });
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    const request = JSON.parse(line);
    if (request.kind === "stop") { input.close(); break; }
    const started = new Date().toISOString(), before = performance.now();
    try {
      if (last?.digest !== request.snapshot_digest) {
        const data = JSON.parse(fs.readFileSync(request.snapshot, "utf8"));
        const facts = { own: new Set<string>(data.own), hot: new Set<string>(data.hot), stat: new Set<string>(data.stat) };
        if (Fact.digest(facts) !== request.snapshot_digest) throw new Error("Unit snapshot differs: " + request.unit);
        last = { digest: request.snapshot_digest, facts };
      }
      const trace = Fact.trace(), emitted = emit(request.unit, request.facts_only, last!.facts, trace);
      result(request.result, { ok: true, unit: request.unit, facts_only: request.facts_only,
        trace: trace.events, lend: [...emitted.lend], masks: emitted.masks,
        refs: [...emitted.refs], edges: emitted.edges, fragment: emitted.code.directory,
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
