import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { finished } from "node:stream/promises";
import * as Comp from "./comp.ts";
import * as Fact from "./facts.ts";
import { Admission, resident } from "./admission.ts";
import type { Workers } from "./admission.ts";
import type { Fragment } from "./fragments.ts";
import { UnitCache, emission } from "./unit-cache.ts";
import type { UnitData } from "./unit-cache.ts";

const WORKER = fileURLToPath(new URL("./worker.ts", import.meta.url));
const DIAGNOSTICS = process.env.BEND_COMPILER_DIAGNOSTICS === "1";

class CompilerFailure extends Error {
  constructor(readonly evidence: string, readonly cause_record: unknown, formatted: string) { super(formatted); }
  override toString(): string { return this.message; }
}

type Execution = { child: ChildProcessWithoutNullStreams; complete: Promise<{ code: number | null; signal: string | null }> };
function execute(directory: string, args: string[], front = false): Execution {
  const preloads: string[] = [];
  for (let index = 0; index < process.execArgv.length; index++) {
    const value = process.execArgv[index];
    if (value === "--preload") preloads.push(value, process.execArgv[++index]);
    else if (value.startsWith("--preload=")) preloads.push(value);
  }
  const argv = [process.execPath, "--smol", ...preloads, WORKER, ...args];
  return execute_argv(directory, argv, front, front || DIAGNOSTICS);
}

function execute_argv(directory: string, argv: string[], mirror_stdout: boolean, mirror_stderr: boolean,
  output: NodeJS.WriteStream = process.stdout): Execution {
  const started = new Date().toISOString();
  const cwd = process.cwd();
  const stdout = fs.createWriteStream(path.join(directory, "stdout"));
  const stderr = fs.createWriteStream(path.join(directory, "stderr"));
  const child = spawn(argv[0], argv.slice(1), { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  fs.writeFileSync(path.join(directory, "process-start.json"), JSON.stringify({ argv, cwd, pid: child.pid, started }));
  child.stdout.pipe(stdout); child.stderr.pipe(stderr);
  if (mirror_stdout) child.stdout.pipe(output, { end: false });
  if (mirror_stderr) child.stderr.pipe(process.stderr, { end: false });
  const complete = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
    let spawn_error: Error | null = null;
    child.once("error", error => {
      spawn_error = error;
      fs.writeFileSync(path.join(directory, "process-error.json"), JSON.stringify({
        name: error.name, message: error.message, stack: error.stack }));
    });
    child.once("close", async (code, signal) => {
      try {
        await Promise.all([finished(stdout), finished(stderr)]);
        fs.writeFileSync(path.join(directory, "process-result.json"), JSON.stringify({ argv, cwd,
          pid: child.pid, started, ended: new Date().toISOString(), code, signal }));
        if (spawn_error) reject(spawn_error);
        else resolve({ code, signal });
      } catch (error) { reject(error); }
    });
  });
  return { child, complete };
}

export async function run(directory: string, argv: string[], output: "stdout" | "stderr" = "stdout"):
  Promise<{ code: number | null; signal: string | null }> {
  const execution = execute_argv(directory, argv, true, true, output === "stderr" ? process.stderr : process.stdout);
  execution.child.stdin.end();
  return await execution.complete;
}

export type Prepared = { directory: string; evidence: string; inputs: string[] };
export async function prepare(file: string, workspace: string, outputs: string[] = []): Promise<Prepared> {
  const evidence = fs.mkdtempSync(path.join(workspace, ".bend-cgen-"));
  const front = path.join(evidence, "front"); fs.mkdirSync(front);
  const output = path.join(front, "result.json"), request = path.join(front, "request.json");
  fs.writeFileSync(request, JSON.stringify({ file, result: output, outputs }));
  const execution = execute(front, ["front", evidence, request], true);
  execution.child.stdin.end();
  const completed = await execution.complete;
  if (!fs.existsSync(output)) throw new CompilerFailure(front, completed,
    "Compiler front end ended without a result; evidence: " + front);
  const result = JSON.parse(fs.readFileSync(output, "utf8"));
  if (!result.ok) throw new CompilerFailure(front, result, result.error.formatted);
  if (completed.code !== 0 || completed.signal !== null) throw new CompilerFailure(front, completed,
    "Compiler front end failed; evidence: " + front);
  return { directory: result.directory, inputs: result.inputs, evidence };
}

type Emitted = { value: Fact.Emission<Fragment>; data: UnitData; growth: number; metadata: number };

// A worker process serves one unit at a time and any number of units in turn.
class Worker {
  readonly directory: string;
  private execution: Execution;
  private ready: Promise<void>;
  private pending: { file: string; unit: string; resolve: (value: any) => void; reject: (error: unknown) => void } | null = null;
  private failed = false;
  private finished: Promise<void> | null = null;
  metadata: number | null = null;
  // Resident peak while the process started, known once it reports ready.
  startup: number | null = null;
  get pid(): number | undefined { return this.execution.child.pid; }
  get usable(): boolean { return !this.failed; }

  constructor(readonly program: Prepared) {
    this.directory = fs.mkdtempSync(path.join(program.evidence, "worker-"));
    this.execution = execute(this.directory, ["units", program.directory, this.directory]);
    this.execution.child.stdin.on("error", error => {
      const record = { unit: this.pending?.unit, name: error.name, message: error.message, stack: error.stack };
      fs.writeFileSync(path.join(this.directory, "ipc-error.json"), JSON.stringify(record));
      this.pending?.reject(new CompilerFailure(this.directory, record,
        "Compiler worker input failed" + (record.unit === undefined ? "" : " for " + record.unit)
        + ": " + error.message + "; evidence: " + this.directory));
    });
    this.ready = new Promise((resolve, reject) => {
      let buffer = "";
      this.execution.child.stdout.setEncoding("utf8");
      this.execution.child.stdout.on("data", chunk => {
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
          try {
            const message = JSON.parse(line);
            if (message.kind === "ready") {
              this.startup = message.peak;
              fs.writeFileSync(path.join(this.directory, "ready.json"), JSON.stringify(message)); resolve();
            } else if (message.kind === "result") {
              const pending = this.pending;
              if (pending === null || pending.file !== message.file) throw new Error("Unexpected compiler unit result");
              this.failed ||= message.failed === true;
              this.pending = null; pending.resolve(message.file);
            }
          } catch (error) { reject(error); this.pending?.reject(error); }
        }
      });
      this.execution.complete.then(result => {
        const error = new CompilerFailure(this.directory, result,
          "Compiler worker ended before its result was collected"
          + (this.pending === null ? "" : " for " + this.pending.unit) + "; evidence: " + this.directory);
        reject(error); this.pending?.reject(error);
      }, error => { reject(error); this.pending?.reject(error); });
    });
  }

  async started(): Promise<void> { await this.ready; }

  async emit(job: Fact.Job, snapshot: string, snapshot_digest: string): Promise<Emitted> {
    await this.ready;
    this.metadata = null;
    const directory = fs.mkdtempSync(path.join(this.directory, "unit-"));
    const file = path.join(directory, "result.json");
    const request = { kind: "emit", unit: job.key, facts_only: job.facts_only, snapshot, snapshot_digest, result: file };
    fs.writeFileSync(path.join(directory, "request.json"), JSON.stringify(request));
    const file_result = await new Promise<string>((resolve, reject) => {
      this.pending = { file, unit: job.key, resolve, reject };
      this.execution.child.stdin.write(JSON.stringify(request) + "\n", error => { if (error) reject(error); });
    });
    const before = process.memoryUsage();
    const result = JSON.parse(fs.readFileSync(file_result, "utf8"));
    if (!result.ok) throw new CompilerFailure(directory, result, result.error.formatted);
    const value = emission(result);
    const after = process.memoryUsage();
    this.metadata = Math.max(0, after.rss - before.rss, after.heapUsed - before.heapUsed);
    return { value, data: result, growth: Math.max(0, result.rss_peak - result.rss_before), metadata: this.metadata };
  }

  finish(): Promise<void> { return this.finished ??= this.stop(); }

  private async stop(): Promise<void> {
    const child = this.execution.child;
    if (!this.failed && child.exitCode === null && child.signalCode === null && !child.stdin.destroyed) {
      child.stdin.end(JSON.stringify({ kind: "stop" }) + "\n");
    }
    const result = await this.execution.complete;
    if (!this.failed && (result.code !== 0 || result.signal !== null)) {
      throw new CompilerFailure(this.directory, result, "Compiler worker failed; evidence: " + this.directory);
    }
  }
}

// The workers of one compilation. They start when admission needs one, take
// units in turn across fact barriers, and stop when emission ends.
class Pool implements Workers {
  private idle: Worker[] = [];
  private started: Worker[] = [];
  private largest: number | null = null;
  constructor(readonly program: Prepared) {}

  private order(): Worker[] {
    const size = new Map(this.idle.map(worker => [worker, resident(worker.pid) ?? 0]));
    return this.idle.sort((a, b) => size.get(a)! - size.get(b)!);
  }
  next(): { pid: number | undefined } | null { return this.order()[0] ?? null; }
  baseline(): number | null { return this.largest; }

  take(): Worker {
    return this.order().shift() ?? this.start();
  }
  private start(): Worker {
    const worker = new Worker(this.program);
    this.started.push(worker);
    worker.started().then(() => { this.largest = Math.max(this.largest ?? 0, worker.startup!); }, () => {});
    return worker;
  }
  put(worker: Worker): void { if (worker.usable) this.idle.push(worker); }

  async retire(): Promise<boolean> {
    if (this.idle.length < 2) return false;
    const worker = this.order().pop()!;
    this.idle = this.idle.filter(other => other !== worker);
    await worker.finish();
    return true;
  }

  async close(): Promise<void> {
    const workers = this.started.splice(0);
    this.idle = [];
    const results = await Promise.allSettled(workers.map(worker => worker.finish()));
    const errors = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, errors.map(String).join("\n"));
  }
}

export async function emit(program: Prepared, output: string): Promise<void> {
  const snapshots = path.join(program.evidence, "snapshots"); fs.mkdirSync(snapshots);
  const observations = path.join(program.evidence, "admission.jsonl");
  const admission = new Admission((event, details) => fs.appendFileSync(observations,
    JSON.stringify({ event, at: new Date().toISOString(), ...details }) + "\n"));
  const cache = new UnitCache(program.directory, program.evidence);
  const pool = new Pool(program);
  const fd = fs.openSync(output, "wx");
  let failure: unknown;
  try {
    await Comp.compile_checked_to(program.directory, chunk => fs.writeFileSync(fd, chunk), {
      emit: async jobs => {
        const accepted = new Map<string, Fact.Emission<Fragment>>();
        const missing = jobs.filter(job => {
          const value = cache.get(job);
          if (value === undefined) return true;
          accepted.set(job.key, value);
          return false;
        });
        const digest = Fact.digest(jobs[0].initial), snapshot = path.join(snapshots, digest + ".json");
        if (!fs.existsSync(snapshot)) fs.writeFileSync(snapshot, JSON.stringify(Object.fromEntries(
          Fact.KINDS.map(kind => [kind, [...jobs[0].initial[kind]].sort()]))));
        const emitted = await admission.run(missing, job => JSON.stringify([job.key, job.facts_only]), job => {
          const worker = pool.take();
          const complete = (async () => {
            // A worker that fails a unit is collected with the others when emission ends.
            const unit = await worker.emit(job, snapshot, digest);
            pool.put(worker);
            cache.put(job, unit.data);
            return { value: unit.value, profile: { peak: unit.growth, metadata: unit.metadata } };
          })();
          return { pid: () => worker.pid, metadata: () => worker.metadata, complete };
        }, pool);
        for (const value of emitted) accepted.set(value.key, value);
        return jobs.map(job => accepted.get(job.key)!);
      },
      end_phase: async () => { fs.appendFileSync(observations, JSON.stringify({ event: "phase.end",
        at: new Date().toISOString(), memory: process.memoryUsage() }) + "\n"); },
    });
  } catch (error) { failure = error; }
  try { await pool.close(); }
  catch (cause) {
    failure = failure === undefined ? cause : new AggregateError([failure, cause],
      String(failure) + "\nWhile collecting compiler workers: " + String(cause));
  }
  fs.closeSync(fd);
  if (failure !== undefined) throw failure;
}

export function cleanup(program: Prepared): void {
  for (const file of ["index.json", "program.json"]) fs.copyFileSync(path.join(program.directory, file), path.join(program.evidence, file));
  const history = path.join(program.directory, "facts");
  if (fs.existsSync(history)) fs.cpSync(history, path.join(program.evidence, "facts"), { recursive: true });
  fs.rmSync(program.directory, { recursive: true });
  fs.rmSync(path.join(program.evidence, "snapshots"), { recursive: true });
}
