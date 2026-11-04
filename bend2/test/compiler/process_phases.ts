import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-process-phases-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
process.env.XDG_CACHE_HOME = path.join(directory, "cache");
const json = (file: string): any => JSON.parse(fs.readFileSync(file, "utf8"));

async function run(name: string, entry: string): Promise<{ directory: string; code: number | null; output: string; stderr: string }> {
  const own = path.join(directory, name); fs.mkdirSync(own);
  const output = path.join(own, "output.c"), argv = ["--smol", path.join(source, "main.ts"), entry, "-o", output];
  const started = new Date().toISOString();
  const child = spawn(process.execPath, argv, { stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
  const out: Buffer[] = [], err: Buffer[] = [];
  child.stdout.on("data", chunk => out.push(chunk)); child.stderr.on("data", chunk => err.push(chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  const stdout = Buffer.concat(out).toString("utf8"), stderr = Buffer.concat(err).toString("utf8");
  fs.writeFileSync(path.join(own, "stdout"), stdout); fs.writeFileSync(path.join(own, "stderr"), stderr);
  fs.writeFileSync(path.join(own, "cli-result.json"), JSON.stringify({ argv: [process.execPath, ...argv],
    pid: child.pid, started, ended: new Date().toISOString(), code }));
  return { directory: own, code, output, stderr };
}

function processes(directory: string): { front: any; units: any[] } {
  const evidence = fs.readdirSync(directory).find(name => name.startsWith(".bend-cgen-"));
  assert.ok(evidence, "the C CLI retains its owned process results");
  const own = path.join(directory, evidence), front = json(path.join(own, "front/process-result.json"));
  const units = fs.readdirSync(own).filter(name => name.startsWith("worker-")).map(name => {
    const worker = path.join(own, name), completed = json(path.join(worker, "process-result.json"));
    assert.notEqual(completed.pid, front.pid, "front end and emitter have separate process heaps");
    assert.ok(Date.parse(completed.started) >= Date.parse(front.ended), "the front end exits before emission starts");
    const ready = json(path.join(worker, "ready.json"));
    assert.equal(ready.pid, completed.pid);
    const requests = fs.readdirSync(worker).filter(name => name.startsWith("unit-")).map(name => {
      const directory = path.join(worker, name), request = json(path.join(directory, "request.json"));
      const result = json(path.join(directory, "result.json"));
      assert.equal(result.unit, request.unit, "each assigned unit has its completed result");
      assert.equal(result.pid, completed.pid);
      return result;
    });
    assert.ok(requests.length > 0, "each emitter receives compilation work");
    assert.equal(json(path.join(worker, "worker-usage.json")).pid, completed.pid);
    return { completed, requests };
  });
  assert.ok(units.length > 0, "the C CLI emits units in owned processes");
  return { front, units };
}

try {
  const valid = await run("valid", path.join(root, "bend2/test/compiler/fixtures/emission_chain.bend"));
  assert.equal(valid.code, 0, valid.stderr);
  assert.ok(fs.readFileSync(valid.output, "utf8").includes("WL_TABLE"));
  const good = processes(valid.directory);
  assert.equal(good.front.code, 0); assert.equal(good.front.signal, null);
  for (const worker of good.units) {
    assert.equal(worker.completed.code, 0); assert.equal(worker.completed.signal, null);
    for (const result of worker.requests) assert.equal(result.ok, true);
  }

  const entry = path.join(directory, "missing.bend");
  fs.writeFileSync(entry, 'import Base\n\ndef absent() -> IO(Unit):\n  import "./missing-foreign.c"\n\ndef main() -> IO(Unit):\n  absent()\n');
  const invalid = await run("missing", entry);
  assert.equal(invalid.code, 1);
  assert.match(invalid.stderr, /missing-foreign\.c/);
  assert.ok(!fs.existsSync(invalid.output), "a failed unit leaves the output unpublished");
  const bad = processes(invalid.directory);
  assert.equal(bad.front.code, 0, "the foreign signature checks before its C body is read");
  for (const worker of bad.units) {
    assert.equal(worker.completed.code, 0);
    for (const result of worker.requests) assert.equal(result.ok, true);
  }

  const Driver = await import(pathToFileURL(path.join(source, "driver.ts")).href);
  const lost = path.join(directory, "missing-body"); fs.mkdirSync(lost);
  const input = path.join(lost, "main.bend");
  fs.writeFileSync(input, 'import Base\n\ndef main() -> IO(Unit):\n  IO.print("42")\n');
  const prepared = await Driver.prepare(input, lost);
  const index = json(path.join(prepared.directory, "index.json"));
  const section = index.bodies.find(([name]: [string]) => name === "main")[1];
  const body = path.join(prepared.directory, section.file);
  fs.copyFileSync(body, path.join(lost, "removed-body.json"));
  fs.writeFileSync(path.join(lost, "removed-input.json"), JSON.stringify({ unit: "main", ...section }));
  fs.unlinkSync(body);
  await assert.rejects(Driver.emit(prepared, path.join(lost, "partial.c")), /ENOENT/);
  const broken = processes(lost);
  assert.equal(broken.front.code, 0);
  const failed = broken.units.flatMap(worker => worker.requests).filter(result => !result.ok);
  assert.ok(failed.some(result => result.unit === "main"), "the failed unit retains its source identity");
  for (const result of failed) {
    assert.match(result.error.message, /ENOENT/); assert.ok(result.error.message.includes(section.file));
  }
  assert.ok(broken.units.some(worker => worker.completed.code === 1), "the failed emitter exits and is collected");
  console.log("PASS compiler process phases: completed front end, emitters, foreign link failure and failed unit");
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
