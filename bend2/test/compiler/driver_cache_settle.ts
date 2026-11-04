// Usage: bun driver_cache_settle.ts [REPOSITORY_ROOT]
// emit() of the compiler driver returns only after the cache writes of its units have
// finished, and it reports a late error of such a write together with the failure that
// ended emission. A stand-in compilation writes one completed unit through the driver's
// cache and then fails. The rename that publishes the unit's record waits until that
// failure has been thrown, and then either completes or fails with an error that is not
// a file system error.
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { mock } from "bun:test";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-driver-cache-"));
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

// The next rename of a staged record waits for hold.until and then runs hold.after.
const promises = fs.promises, rename = promises.rename;
let hold: { until: Promise<void>; after: () => void } | undefined;
const staged = { ...promises, rename: async (from: string, to: string) => {
  const held = hold;
  if (held !== undefined && String(from).includes(path.sep + ".write-")) {
    hold = undefined;
    await held.until;
    await new Promise(resolve => setTimeout(resolve, 100));
    held.after();
  }
  return rename.call(promises, from, to);
} };
mock.module("node:fs", () => ({ ...fs, promises: staged, default: { ...fs, promises: staged } }));

// The driver's cache, and a compilation that the test supplies.
const caches: any[] = [];
const Cache = await import(pathToFileURL(path.join(source, "unit-cache.ts")).href);
const UnitCache = Cache.UnitCache, emission = Cache.emission;
class Observed extends UnitCache { constructor(...args: any[]) { super(...args); caches.push(this); } }
mock.module(path.join(source, "unit-cache.ts"), () => ({ UnitCache: Observed, emission }));
let compile: () => Promise<void> = async () => {};
mock.module(path.join(source, "comp.ts"), () => ({ compile_checked_to: () => compile() }));
const Fact = await import(pathToFileURL(path.join(source, "facts.ts")).href);
const Driver = await import(pathToFileURL(path.join(source, "driver.ts")).href);

function program(name: string) {
  const own = path.join(directory, name), program = path.join(own, "program"), evidence = path.join(own, "evidence");
  const fragment = path.join(program, "fragments", "emitted"), code = "completed compiler unit\n";
  fs.mkdirSync(fragment, { recursive: true }); fs.mkdirSync(evidence);
  fs.writeFileSync(path.join(fragment, "code"), code);
  fs.writeFileSync(path.join(fragment, "metadata.json"), JSON.stringify({ directory: fragment,
    unit: "main", segs: [], spins: [], statics: [], tabs: [], clos: [], lend: [], bytes: code.length }));
  const header = JSON.stringify({ tld: {}, ctr: {}, src: {}, sites: {}, masks: {}, local: {}, bangs: [],
    field: {}, show: hash("show"), wide: false });
  fs.writeFileSync(path.join(program, "entries.json"), header);
  fs.writeFileSync(path.join(program, "index.json"), JSON.stringify({ compiler: hash("compiler"),
    entries: { file: "entries.json", sha256: hash(header), bytes: header.length, nodes: 0 }, bodies: [] }));
  process.env.BEND_CGEN_CACHE_DIR = path.join(own, "cache");
  return { prepared: { directory: program, evidence, inputs: [] }, output: path.join(own, "output.c"),
    cache: path.join(own, "cache", "cgen-units-v1"),
    job: { key: "main", facts_only: false, initial: Fact.empty() },
    data: { unit: "main", facts_only: false, trace: [], lend: [], masks: [], refs: [], edges: [], inputs: [],
      reads: { names: [], listed: [] }, fragment } };
}

// Directories under the cache root, relative to it.
function entries(at: string, base = at): string[] {
  if (!fs.existsSync(at)) return [];
  return fs.readdirSync(at, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? [path.relative(base, path.join(at, entry.name)), ...entries(path.join(at, entry.name), base)] : []);
}

// emit() with a compilation that puts the unit and then throws failure; the put's rename
// waits for that throw and then runs after.
async function emit(name: string, failure: Error, after: () => void) {
  const f = program(name), events: string[] = [];
  let thrown!: () => void;
  hold = { until: new Promise<void>(resolve => { thrown = resolve; }), after: () => { events.push("write"); after(); } };
  compile = async () => {
    await caches.at(-1).put(f.job, f.data);
    events.push("failure"); thrown();
    throw failure;
  };
  let error: unknown;
  try { await Driver.emit(f.prepared, f.output); } catch (cause) { error = cause; }
  events.push("returned");
  return { f, error, events };
}

try {
  const failure = new Error("emission fixture failure");
  const published = await emit("published", failure, () => {});
  assert.deepEqual(published.events, ["failure", "write", "returned"], "emit() returns after the pending write");
  assert.equal(published.error, failure, "a completed write leaves the emission failure as it was");
  const variants = entries(published.f.cache).filter(name => name.split(path.sep).length === 3);
  assert.equal(variants.length, 1, "the pending record is published");
  assert.ok(fs.existsSync(path.join(published.f.cache, variants[0], "metadata.json")));
  assert.deepEqual(entries(published.f.cache).filter(name => path.basename(name).startsWith(".write-")), []);

  const late = new Error("late cache invariant fixture"), second = new Error("emission fixture failure");
  const failed = await emit("late", second, () => { throw late; });
  assert.deepEqual(failed.events, ["failure", "write", "returned"], "emit() returns after the failing write");
  assert.ok(failed.error instanceof AggregateError, "the late write error joins the emission failure");
  assert.equal((failed.error as AggregateError).errors.length, 2);
  assert.equal((failed.error as AggregateError).errors[0], second, "the emission failure is kept");
  assert.equal((failed.error as AggregateError).errors[1], late, "the late write error is kept");
  assert.deepEqual(entries(failed.f.cache).filter(name => path.basename(name).startsWith(".write-")), [],
    "the failed write removes its staging");
  console.log(JSON.stringify({ test: "driver_cache_settle", status: "passed" }));
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
