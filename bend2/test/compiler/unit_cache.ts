// Usage: bun unit_cache.ts [REPOSITORY_ROOT] [ARTIFACT_DIR] [COMPILER_LAUNCHER]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { finished } from "node:stream/promises";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-unit-cache-"));
const retained = process.argv[3] !== undefined;
const command = process.argv[4] === undefined ? [process.execPath, "--smol", path.join(source, "main.ts")] : [process.argv[4]];
fs.mkdirSync(directory, { recursive: true });
const input = path.join(directory, "program.bend");

function digest(file: string): string {
  const fd = fs.openSync(file, "r"), buffer = Buffer.allocUnsafe(65536), hash = createHash("sha256");
  try {
    for (let count = fs.readSync(fd, buffer); count > 0; count = fs.readSync(fd, buffer)) hash.update(buffer.subarray(0, count));
    return hash.digest("hex");
  } finally { fs.closeSync(fd); }
}

async function run(name: string, argv: string[], cache: string, extra: NodeJS.ProcessEnv = {}): Promise<{ own: string; stdout: string; stderr: string }> {
  const own = path.join(directory, name); fs.mkdirSync(own);
  const started = new Date().toISOString(), child = spawn(argv[0], argv.slice(1), {
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env,
      XDG_CACHE_HOME: cache, BEND_COMPILER_DIAGNOSTICS: "1", BEND_NO_TELEMETRY: "1", ...extra },
  });
  const stdout = fs.createWriteStream(path.join(own, "stdout")), stderr = fs.createWriteStream(path.join(own, "stderr"));
  child.stdout.pipe(stdout); child.stderr.pipe(stderr);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  await Promise.all([finished(stdout), finished(stderr)]);
  fs.writeFileSync(path.join(own, "result.json"), JSON.stringify({ argv, pid: child.pid,
    started, ended: new Date().toISOString(), code, signal: child.signalCode, environment: extra }));
  const out = fs.readFileSync(path.join(own, "stdout"), "utf8"), err = fs.readFileSync(path.join(own, "stderr"), "utf8");
  assert.equal(code, 0, err); assert.equal(child.signalCode, null);
  return { own, stdout: out, stderr: err };
}

async function build(name: string, cache: string, extra: NodeJS.ProcessEnv = {}) {
  const output = path.join(directory, name, "output.c"), result = await run(name, [...command, input, "-o", output], cache, extra);
  const evidenceName = fs.readdirSync(result.own).find(name => name.startsWith(".bend-cgen-"));
  assert.ok(evidenceName, "the launcher retains its compilation evidence");
  const evidence = path.join(result.own, evidenceName);
  const frames = result.stderr.split("\n").flatMap(line => {
    try { const value = JSON.parse(line); return typeof value === "object" && value !== null ? [value] : []; }
    catch { return []; }
  });
  const replay = frames.findLast(frame => frame.compiler_diagnostic === "facts.replay");
  assert.ok(replay, "cache responses pass the complete historical replay");
  const facts = new Set<string>(frames.filter(frame => frame.compiler_diagnostic === "fact.write" && frame.attempt === replay.attempt)
    .map(frame => frame.kind + ":" + frame.key));
  const cacheEvents = frames.filter(frame => frame.compiler_diagnostic?.startsWith("cache."));
  const workers = fs.readdirSync(evidence).filter(name => name.startsWith("worker-"));
  const passes = frames.filter(frame => frame.compiler_diagnostic === "pass.end");
  const reach = frames.findLast(frame => frame.compiler_diagnostic === "reach.end");
  assert.ok(passes.length > 0); assert.equal(passes.at(-1).segments, reach.segments);
  const value = { output, sha256: digest(output), facts, factHash: replay.result, cacheEvents, workers, evidence };
  fs.writeFileSync(path.join(result.own, "summary.json"), JSON.stringify({ ...value,
    facts: [...facts].sort(), passes, definitions: frames.filter(frame => frame.compiler_diagnostic === "definition.end") }));
  return value;
}

async function native(name: string, c: string, expected: string): Promise<void> {
  const binary = path.join(directory, name);
  await run(name + "-clang", [process.env.CC ?? "clang", "-std=c11", "-O1", "-w", c, "-lm", "-lpthread", "-o", binary], path.join(directory, "cache"));
  const result = await run(name + "-binary", [binary], path.join(directory, "cache"));
  assert.equal(result.stdout.trim(), expected);
}

try {
  const original = fs.readFileSync(path.join(root, "bend2/test/compiler/fixtures/poly_spin_hot.bend"), "utf8");
  fs.writeFileSync(input, original);
  const cache = path.join(directory, "cache"), cold = await build("cold", cache);
  assert.ok(cold.cacheEvents.some(event => event.compiler_diagnostic === "cache.write"), "the C launcher populates unit variants");
  assert.ok(cold.cacheEvents.some(event => event.inputs?.some((input: any) => input.name === "main")), "a cached entry records its decoded body input");
  const independent = await build("independent-cold", path.join(directory, "independent-cache"));
  const variants = (events: any[]) => [...new Set(events.filter(event => event.compiler_diagnostic === "cache.write")
    .map(event => path.basename(event.variant)))].sort();
  assert.equal(independent.sha256, cold.sha256); assert.equal(independent.factHash, cold.factHash);
  assert.deepEqual(variants(independent.cacheEvents), variants(cold.cacheEvents), "unit content identities are independent of process and timing observations");
  const warm = await build("warm", cache);
  assert.equal(warm.sha256, cold.sha256);
  assert.equal(warm.factHash, cold.factHash);
  assert.equal(warm.workers.length, 0, "all applicable variants are reused by an unchanged build");
  assert.ok(warm.cacheEvents.some(event => event.compiler_diagnostic === "cache.hit"));
  assert.ok(!warm.cacheEvents.some(event => event.compiler_diagnostic === "cache.miss"));
  await native("original", warm.output, "218");

  const hooks = path.join(directory, "storage-hooks"); fs.mkdirSync(hooks);
  const preload = path.join(directory, "storage-failure.ts");
  fs.writeFileSync(preload, `
    import fs from "node:fs";
    import * as path from "node:path";
    import { mock } from "bun:test";
    const probe = ${JSON.stringify(path.join(directory, ".write-positive-control", "metadata.json"))};
    const original = fs.writeFileSync;
    const writeFileSync = function(file, ...args) {
      const name = String(file);
      if (path.basename(name) === "metadata.json" && path.basename(path.dirname(name)).startsWith(".write-")) {
        if (name !== probe) fs.appendFileSync(path.join(${JSON.stringify(hooks)}, String(process.pid) + ".jsonl"),
          JSON.stringify({ pid: process.pid, file: name, code: "ENOSPC", syscall: "write" }) + "\\n");
        throw Object.assign(new Error("cache write fixture ENOSPC"), { code: "ENOSPC", syscall: "write", path: name });
      }
      return Reflect.apply(original, this, [file, ...args]);
    };
    const replacement = { ...fs, writeFileSync };
    mock.module("node:fs", () => ({ ...replacement, default: replacement }));
    const namespace = await import("node:fs");
    let observed = false;
    try { namespace.writeFileSync(probe, ""); }
    catch (error) { observed = error.code === "ENOSPC" && error.message === "cache write fixture ENOSPC"; }
    if (!observed) throw new Error("The cache storage interceptor is inactive");
  `);
  const failedStorage = await build("storage-failure", path.join(directory, "failed-cache"), {
    BUN_OPTIONS: (process.env.BUN_OPTIONS ?? "") + " --preload " + preload,
  });
  assert.ok(fs.readdirSync(hooks).length > 0, "the actual launcher reaches the failing cache write");
  assert.ok(failedStorage.cacheEvents.some(event => event.compiler_diagnostic === "cache.error" && event.error?.code === "ENOSPC"));
  assert.equal(failedStorage.sha256, cold.sha256); assert.equal(failedStorage.factHash, cold.factHash);
  assert.ok(failedStorage.workers.length > 0, "failed cache storage completes through actual emission");
  const staging = (at: string): string[] => fs.readdirSync(at, { withFileTypes: true }).flatMap(entry => {
    const child = path.join(at, entry.name);
    return entry.isDirectory() ? entry.name.startsWith(".write-") ? [child] : staging(child) : [];
  });
  assert.deepEqual(staging(path.join(directory, "failed-cache", "bend2", "cgen-units-v1")), []);

  assert.ok(original.includes("case 0n: Leaf{7}"));
  fs.writeFileSync(input, original.replace("case 0n: Leaf{7}", "case 0n: Leaf{8}"));
  const edited = await build("edited-warm", cache), editedCold = await build("edited-cold", path.join(directory, "edited-cache"));
  assert.equal(edited.sha256, editedCold.sha256); assert.equal(edited.factHash, editedCold.factHash);
  assert.notEqual(edited.sha256, warm.sha256);
  await native("edited", edited.output, "220");

  fs.writeFileSync(input, "import Base\n\ndef main() -> U32:\n  0\n");
  const removed = await build("removed-warm", cache), removedCold = await build("removed-cold", path.join(directory, "removed-cache"));
  assert.equal(removed.sha256, removedCold.sha256); assert.equal(removed.factHash, removedCold.factHash);
  assert.deepEqual([...removed.facts].sort(), [...removedCold.facts].sort());
  assert.ok([...cold.facts].some(fact => !removed.facts.has(fact)), "removing source removes previously produced facts");
  await native("removed", removed.output, "0");
  console.log(JSON.stringify({ test: "unit_cache", cold_workers: cold.workers.length,
    warm_workers: warm.workers.length, warm_hits: warm.cacheEvents.filter(event => event.compiler_diagnostic === "cache.hit").length,
    original_c: cold.sha256, edited_c: edited.sha256, removed_c: removed.sha256 }));
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
