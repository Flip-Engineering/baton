// Usage: bun unit_cache_pressure.ts REPOSITORY_ROOT ARTIFACT_DIR PRIVATE_FILESYSTEM
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2]), directory = path.resolve(process.argv[3]);
const filesystem = path.resolve(process.argv[4]);
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const { UnitCache } = await import(pathToFileURL(path.join(source, "unit-cache.ts")).href);
const Fact = await import(pathToFileURL(path.join(source, "facts.ts")).href);
fs.mkdirSync(directory, { recursive: true });
assert.notEqual(fs.statSync(filesystem).dev, fs.statSync(path.dirname(filesystem)).dev,
  "pressure runs on a separately mounted private filesystem");
const own = fs.mkdtempSync(path.join(filesystem, "unit-cache-pressure-"));
process.env.XDG_CACHE_HOME = path.join(own, "cache");
const hash = (data: string) => createHash("sha256").update(data).digest("hex");
const state = () => {
  const value = fs.statfsSync(own);
  return { block_bytes: value.bsize, available_bytes: value.bavail * value.bsize, free_inodes: value.ffree };
};
const observations: Record<string, unknown>[] = [];

function program(parent: string, name: string) {
  const program = path.join(parent, name); fs.mkdirSync(program);
  fs.mkdirSync(path.join(program, "fragments"));
  fs.writeFileSync(path.join(program, "index.json"), JSON.stringify({ compiler: hash("compiler"),
    header: { sha256: hash("header") }, tables: { sha256: hash("tables") }, bodies: [] }));
  return program;
}

function unit(program: string, name: string, bytes: number) {
  const fragment = fs.mkdtempSync(path.join(program, "fragments", "emitted-"));
  const text = name.padEnd(bytes, " "); fs.writeFileSync(path.join(fragment, "code"), text);
  fs.writeFileSync(path.join(fragment, "metadata.json"), JSON.stringify({ directory: fragment,
    unit: name, segs: [], spins: [], statics: [], tabs: [], clos: [], lend: [], bytes: text.length }));
  const job = { key: name, facts_only: false, initial: Fact.empty() };
  const data = { unit: name, facts_only: false, trace: [], lend: [], masks: [], refs: [], edges: [], inputs: [], fragment };
  return { job, data, text, sha256: hash(text) };
}

function variant(evidence: string, unit: string): string {
  return fs.readFileSync(path.join(evidence, "unit-cache.jsonl"), "utf8").trim().split("\n")
    .map(line => JSON.parse(line)).findLast(value => value.compiler_diagnostic === "cache.write" && value.unit === unit).variant;
}

function fill(file: string): void {
  const fd = fs.openSync(file, "wx"), block = Buffer.alloc(65536, 17);
  let bytes = 0, failure: unknown;
  try { for (;;) bytes += fs.writeSync(fd, block); }
  catch (error) { assert.equal((error as NodeJS.ErrnoException).code, "ENOSPC"); failure = String(error); }
  finally { fs.closeSync(fd); }
  observations.push({ event: "physical.enospc", file, bytes, failure, state: state() });
}

try {
  const host = program(directory, "host-program"), mounted = program(own, "mounted-program");
  const cache = new UnitCache(host, directory), activeCache = new UnitCache(mounted, directory);
  const active = unit(mounted, "active", 1024 * 1024);
  activeCache.put(active.job, active.data);
  const restored = activeCache.get(active.job); assert.ok(restored);
  const activeVariant = variant(directory, "active"), activeCode = path.join(activeVariant, "code");
  fs.rmSync(active.data.fragment, { recursive: true });
  assert.equal(fs.statSync(activeCode).nlink, 2, "the active fragment holds its cache inode");

  const inactive = unit(host, "replace", 2 * 1024 * 1024); cache.put(inactive.job, inactive.data);
  const inactiveVariant = variant(directory, "replace");
  assert.equal(fs.statSync(path.join(inactiveVariant, "code")).nlink, 1);

  const stageParent = path.dirname(activeVariant);
  const live = fs.mkdtempSync(path.join(stageParent, ".write-" + process.pid + "-"));
  fs.writeFileSync(path.join(live, "code"), Buffer.alloc(1024 * 1024, 21));
  const child = spawnSync(process.execPath, ["-e", ""], { encoding: "utf8" });
  fs.writeFileSync(path.join(directory, "former-writer-result.json"), JSON.stringify({
    pid: child.pid, status: child.status, signal: child.signal, stdout: child.stdout, stderr: child.stderr }));
  assert.equal(child.status, 0); assert.equal(child.signal, null);
  const abandoned = fs.mkdtempSync(path.join(stageParent, ".write-" + child.pid + "-"));
  fs.writeFileSync(path.join(abandoned, "code"), Buffer.alloc(512 * 1024, 22));
  fs.utimesSync(abandoned, new Date(0), new Date(0));
  const replacement = unit(host, "replace", 1024 * 1024);
  observations.push({ event: "prepared", state: state(), active: activeVariant, inactive: inactiveVariant,
    live, abandoned, active_sha256: active.sha256, replacement_sha256: replacement.sha256 });
  const filler = path.join(own, "filler"); fill(filler);
  assert.doesNotThrow(() => cache.put(replacement.job, replacement.data));
  assert.ok(fs.existsSync(live), "pressure preserves a live writer");
  assert.ok(!fs.existsSync(abandoned), "pressure reclaims a completed writer's abandoned staging");
  assert.ok(!fs.existsSync(inactiveVariant), "pressure reclaims the unreferenced variant");
  assert.equal(hash(fs.readFileSync(activeCode, "utf8")), active.sha256);
  assert.equal(hash(fs.readFileSync(path.join(restored.result.code.directory, "code"), "utf8")), active.sha256);
  const hit = cache.get(replacement.job); assert.ok(hit);
  assert.equal(hash(fs.readFileSync(path.join(hit.result.code.directory, "code"), "utf8")), replacement.sha256);
  observations.push({ event: "reclaimed", state: state(), replacement: variant(directory, "replace") });

  fs.rmSync(filler); fill(filler);
  const protectedUpdate = unit(host, "active", 2 * 1024 * 1024);
  assert.doesNotThrow(() => cache.put(protectedUpdate.job, protectedUpdate.data));
  assert.equal(hash(fs.readFileSync(path.join(protectedUpdate.data.fragment, "code"), "utf8")), protectedUpdate.sha256,
    "storage failure preserves the completed emitted unit");
  assert.equal(hash(fs.readFileSync(activeCode, "utf8")), active.sha256);
  assert.ok(fs.existsSync(live));
  assert.equal(fs.readdirSync(stageParent).filter(name => name.startsWith(".write-")).length, 1,
    "the failed writer removes its own staging");
  observations.push({ event: "protected.storage.failure", state: state(), live, active_sha256: active.sha256 });
  console.log(JSON.stringify({ test: "unit_cache_pressure", status: "passed", observations }));
} catch (error) {
  observations.push({ event: "failure", error: String(error), stack: (error as Error).stack, state: state() });
  console.error(error); process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(directory, "filesystem-observations.json"), JSON.stringify(observations, null, 2));
  fs.rmSync(own, { recursive: true, force: true });
}
