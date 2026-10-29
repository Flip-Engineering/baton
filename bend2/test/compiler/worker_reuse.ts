// Worker processes take several units, and the C they produce equals the C of
// an emitter that is opened afresh for every unit.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-worker-reuse-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
const json = (file: string): any => JSON.parse(fs.readFileSync(file, "utf8"));
const fixtures = ["emission_chain.bend", "poly_spin_hot.bend", "literal_prefix_frames.bend"]
  .map(name => path.join(root, "bend2/test/compiler/fixtures", name));
const url = (name: string): string => pathToFileURL(path.join(source, name)).href;
const Driver = await import(url("driver.ts")), Comp = await import(url("comp.ts")), Fact = await import(url("facts.ts"));

async function cli(name: string, entry: string): Promise<{ output: string; evidence: string }> {
  const own = path.join(directory, name); fs.mkdirSync(own);
  const output = path.join(own, "output.c");
  const child = spawn(process.execPath, ["--smol", path.join(source, "main.ts"), entry, "-o", output], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BEND_NO_TELEMETRY: "1", XDG_CACHE_HOME: path.join(own, "cache") } });
  const err: Buffer[] = [];
  child.stderr.on("data", chunk => err.push(chunk)); child.stdout.resume();
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(code, 0, Buffer.concat(err).toString("utf8"));
  const evidence = fs.readdirSync(own).find(entry => entry.startsWith(".bend-cgen-"));
  assert.ok(evidence, "the CLI retains its worker evidence");
  return { output: fs.readFileSync(output, "utf8"), evidence: path.join(own, evidence) };
}

// The reference: one emitter, opened from the checked store, for each unit.
async function fresh(entry: string, name: string): Promise<string> {
  const own = path.join(directory, name); fs.mkdirSync(own);
  const prepared = await Driver.prepare(entry, own);
  const chunks: string[] = [];
  await Comp.compile_checked_to(prepared.directory, (chunk: string) => chunks.push(chunk), {
    emit: async (jobs: any[]) => jobs.map(job => {
      const record = Fact.trace();
      return { key: job.key, trace: record, result: Comp.unit_emitter(prepared.directory)(job.key, job.facts_only, job.initial, record) };
    }),
    end_phase: async () => {},
  });
  return chunks.join("");
}

try {
  let reused = 0, units = 0, workers = 0;
  for (const [index, entry] of fixtures.entries()) {
    const label = path.basename(entry, ".bend");
    const first = await cli(label + "-1", entry), second = await cli(label + "-2", entry);
    assert.equal(second.output, first.output, label + ": two compilations with reused parallel workers agree");
    assert.equal(first.output, await fresh(entry, label + "-fresh"), label + ": reused workers emit the C of a fresh emitter per unit");
    const own = fs.readdirSync(first.evidence).filter(name => name.startsWith("worker-"));
    const counts = own.map(name => {
      const worker = path.join(first.evidence, name);
      assert.equal(json(path.join(worker, "process-result.json")).code, 0, "each worker exits cleanly when emission ends");
      assert.ok(json(path.join(worker, "ready.json")).peak > 0, "a worker reports the size it reached while starting");
      const requests = fs.readdirSync(worker).filter(name => name.startsWith("unit-"));
      for (const request of requests) {
        const result = json(path.join(worker, request, "result.json"));
        assert.equal(result.ok, true);
        assert.ok(result.rss_before > 0 && result.rss_after > 0 && result.rss_peak >= result.rss_before,
          "each unit reports the resident size before, at its peak and after");
      }
      return requests.length;
    });
    const total = counts.reduce((sum, count) => sum + count, 0);
    assert.ok(own.length < total, label + ": " + own.length + " worker processes took " + total + " units");
    assert.ok(Math.max(...counts) > 1, label + ": a worker takes more than one unit");
    const events = fs.readFileSync(path.join(first.evidence, "admission.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    const started = events.filter(event => event.event === "start"), measured = events.filter(event => event.event === "measured");
    assert.equal(started.length, total); assert.equal(measured.length, total);
    assert.ok(measured.every(event => event.profile.peak >= 0 && event.profile.metadata >= 0));
    units += total; workers += own.length; reused += total - own.length;
  }
  console.log(JSON.stringify({ test: "worker_reuse", fixtures: fixtures.length, units, worker_processes: workers,
    units_on_reused_workers: reused, available_cpus: os.availableParallelism() }));
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
