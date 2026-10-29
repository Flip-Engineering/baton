import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { finished } from "node:stream/promises";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-process-units-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
process.env.XDG_CACHE_HOME = path.join(directory, "cache");
const json = (file: string): any => JSON.parse(fs.readFileSync(file, "utf8"));

try {
  const output = path.join(directory, "output.c");
  const argv = [process.execPath, "--smol", path.join(source, "main.ts"),
    path.join(root, "bend2/test/compiler/fixtures/emission_chain.bend"), "-o", output];
  const started = new Date().toISOString();
  const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BEND_NO_TELEMETRY: "1", BEND_COMPILER_DIAGNOSTICS: "1" } });
  const stdout = fs.createWriteStream(path.join(directory, "stdout"));
  const stderr = fs.createWriteStream(path.join(directory, "stderr"));
  child.stdout.pipe(stdout); child.stderr.pipe(stderr);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  await Promise.all([finished(stdout), finished(stderr)]);
  fs.writeFileSync(path.join(directory, "cli-result.json"), JSON.stringify({ argv,
    pid: child.pid, started, ended: new Date().toISOString(), code, signal: child.signalCode }));
  assert.equal(code, 0, fs.readFileSync(path.join(directory, "stderr"), "utf8"));
  assert.equal(child.signalCode, null);
  assert.ok(fs.statSync(output).size > 0);
  const name = fs.readdirSync(directory).find(name => name.startsWith(".bend-cgen-"));
  assert.ok(name, "the CLI retains its completed compilation processes");
  const evidence = path.join(directory, name);
  const workers = fs.readdirSync(evidence).filter(name => name.startsWith("worker-")).map(name => {
    const own = path.join(evidence, name), completed = json(path.join(own, "process-result.json"));
    const units = fs.readdirSync(own).filter(name => name.startsWith("unit-"));
    assert.ok(units.length > 0, "each worker takes at least one unit");
    assert.equal(completed.code, 0); assert.equal(completed.signal, null);
    const results = units.map(unit => {
      const result = json(path.join(own, unit, "result.json"));
      assert.equal(result.ok, true); assert.equal(result.pid, completed.pid);
      assert.ok(result.rss_before > 0 && result.rss_peak >= result.rss_before && result.rss_after > 0,
        "each unit reports its resident size before, at its peak and after");
      return result;
    });
    const turns = results.map(result => [Date.parse(result.started), Date.parse(result.ended)]).sort((a, b) => a[0] - b[0]);
    for (let at = 1; at < turns.length; at++) assert.ok(turns[at - 1][1] <= turns[at][0], "a worker takes one unit at a time");
    const usage = json(path.join(own, "worker-usage.json"));
    assert.equal(usage.pid, completed.pid); assert.ok(usage.usage.maxRSS > 0);
    return { completed, results, usage };
  });
  assert.ok(workers.length > 0);
  const unit_count = workers.reduce((sum, worker) => sum + worker.results.length, 0);
  assert.ok(workers.length < unit_count, "worker processes take several units");
  assert.ok(workers.some(worker => worker.results.length > 1), "a worker takes more than one unit");
  const observations = fs.readFileSync(path.join(evidence, "admission.jsonl"), "utf8")
    .trim().split("\n").map(line => JSON.parse(line));
  const active = new Map<number, any>(), completed = new Map<number, any>();
  let overlap = 0, reused = 0, measurements = 0;
  for (const event of observations) {
    if (event.event === "admission" && event.allowed && event.forecast === undefined) {
      assert.equal(active.size, 0, "the first unit of a compilation finishes alone, with nothing to forecast it from");
    } else if (event.event === "start") {
      assert.ok(!active.has(event.key), "a unit starts once at a time");
      active.set(event.key, event);
      overlap = Math.max(overlap, active.size);
      if (event.forecast !== undefined) reused++;
    } else if (event.event === "measured") {
      assert.ok(active.has(event.key), "each measurement belongs to a started unit");
      active.delete(event.key); measurements++;
      const worker = workers.find(worker => worker.completed.pid === event.pid);
      assert.ok(worker, "a measured unit ran in a worker with completed process evidence");
      assert.ok(event.profile.peak <= worker.usage.usage.maxRSS * 1024, "a unit's growth is within its worker's peak size");
      assert.ok(event.profile.metadata >= 0);
    } else if (event.event === "phase.end") {
      assert.equal(active.size, 0, "all units finish before the phase ends");
    }
  }
  assert.equal(active.size, 0);
  assert.equal(measurements, unit_count, "every unit has a measurement");
  assert.ok(reused > 0, "units that follow a measurement start with a forecast");
  console.log(JSON.stringify({ test: "process_units", workers: workers.length, units: unit_count,
    observed_parallelism: overlap, forecast_starts: reused, available_cpus: os.availableParallelism() }));
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
