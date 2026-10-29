// Usage: bun unit_cache_storage.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { mock } from "bun:test";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-cache-storage-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
const original = { ...fs };
let fault: ((name: string, args: any[]) => void) | undefined;
const intercepted = Object.fromEntries(Object.entries(original).map(([name, value]) => [name,
  typeof value === "function" ? function(...args: any[]) {
    fault?.(name, args);
    return Reflect.apply(value, original, args);
  } : value]));
mock.module("node:fs", () => ({ ...intercepted, default: intercepted }));
const { UnitCache } = await import(pathToFileURL(path.join(source, "unit-cache.ts")).href);
const Fact = await import(pathToFileURL(path.join(source, "facts.ts")).href);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

function fixture(name: string, inputs = false) {
  const own = path.join(directory, name); fs.mkdirSync(own);
  const program = path.join(own, "program"); fs.mkdirSync(program);
  const fragments = path.join(program, "fragments"); fs.mkdirSync(fragments);
  const fragment = path.join(fragments, "emitted"); fs.mkdirSync(fragment);
  const code = "completed compiler unit\n";
  fs.writeFileSync(path.join(fragment, "code"), code);
  fs.writeFileSync(path.join(fragment, "metadata.json"), JSON.stringify({ directory: fragment,
    unit: "main", segs: [], spins: [], statics: [], tabs: [], clos: [], lend: [], bytes: code.length }));
  const body = path.join(program, "body.json"), bodyText = "checked body";
  fs.writeFileSync(body, bodyText);
  fs.writeFileSync(path.join(program, "index.json"), JSON.stringify({ compiler: hash("compiler"),
    header: { sha256: hash("header") }, tables: { sha256: hash("tables") },
    bodies: inputs ? [["main", { file: "body.json", mode: "flat", sha256: hash(bodyText) }]] : [] }));
  process.env.XDG_CACHE_HOME = path.join(own, "cache");
  const cache = new UnitCache(program, own), job = { key: "main", facts_only: false, initial: Fact.empty() };
  const data = { unit: "main", facts_only: false, trace: [], lend: [], masks: [], refs: [], edges: [],
    inputs: inputs ? [{ name: "main", mode: "flat", sha256: hash(bodyText) }] : [], fragment };
  return { own, program, fragment, code, body, cache, job, data };
}

function entries(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? [path.join(directory, entry.name), ...entries(path.join(directory, entry.name))] : []);
}

function injected(code: string, syscall: string, file: string): NodeJS.ErrnoException {
  return Object.assign(new Error("cache fixture " + code + ": " + file), { code, syscall, path: file });
}

const results: { test: string; status: string; error?: string }[] = [];
async function test(name: string, run: () => void): Promise<void> {
  try { run(); results.push({ test: name, status: "passed" }); }
  catch (error) { results.push({ test: name, status: "failed", error: String(error) }); }
  finally { fault = undefined; }
}

try {
  for (const operation of ["copy", "metadata", "rename"]) await test("failed " + operation + " releases its staging", () => {
    const f = fixture(operation); let observed = false;
    fault = (name, args) => {
      const target = String(args[operation === "metadata" ? 0 : 1]);
      if (operation === "copy" && name === "linkSync" && target.includes(".write-")) {
        throw injected("EXDEV", "link", target);
      }
      if (!observed && ((operation === "copy" && name === "copyFileSync" && target.includes(".write-"))
        || (operation === "metadata" && name === "writeFileSync" && target.includes(".write-") && target.endsWith("metadata.json"))
        || (operation === "rename" && name === "renameSync" && String(args[0]).includes(".write-")))) {
        observed = true; throw injected("ENOSPC", name, target);
      }
    };
    assert.doesNotThrow(() => f.cache.put(f.job, f.data));
    assert.ok(observed, "the selected filesystem operation actually failed");
    assert.deepEqual(entries(f.cache.root).filter(name => path.basename(name).startsWith(".write-")), []);
    assert.deepEqual(entries(f.cache.root), [], "failed publication releases empty cache directories");
    assert.equal(fs.readFileSync(path.join(f.fragment, "code"), "utf8"), f.code);
    assert.equal(fs.statSync(path.join(f.fragment, "code")).nlink, 1);
  });

  await test("evicted unit directory is a cache miss", () => {
    const f = fixture("directory-race"); f.cache.put(f.job, f.data); let observed = false;
    fault = (name, args) => {
      if (!observed && name === "opendirSync" && path.dirname(String(args[0])) !== path.dirname(f.cache.root)) {
        observed = true; fs.rmSync(String(args[0]), { recursive: true });
      }
    };
    assert.equal(f.cache.get(f.job), undefined); assert.ok(observed);
  });

  await test("existing variant removed during publication preserves emitted output", () => {
    const f = fixture("publication-race"); f.cache.put(f.job, f.data); let observed = false;
    fault = (name, args) => {
      const file = String(args[0]);
      if (!observed && name === "readFileSync" && file.startsWith(f.cache.root) && file.endsWith("metadata.json")) {
        observed = true; fs.rmSync(path.dirname(file), { recursive: true });
      }
    };
    assert.doesNotThrow(() => f.cache.put(f.job, f.data)); assert.ok(observed);
    assert.equal(fs.readFileSync(path.join(f.fragment, "code"), "utf8"), f.code);
  });

  await test("observation storage failure preserves cache operations", () => {
    const f = fixture("observation"); let observed = false;
    fault = (name, args) => {
      if (!observed && name === "appendFileSync" && String(args[0]).endsWith("unit-cache.jsonl")) {
        observed = true; throw injected("ENOSPC", "write", String(args[0]));
      }
    };
    assert.doesNotThrow(() => f.cache.put(f.job, f.data)); assert.ok(observed);
    const restored = f.cache.get(f.job); assert.ok(restored);
    assert.equal(fs.readFileSync(path.join(restored.result.code.directory, "code"), "utf8"), f.code);
  });

  await test("checked input failures preserve their cause", () => {
    const f = fixture("checked-input", true); f.cache.put(f.job, f.data);
    const cause = injected("EIO", "open", f.body); let observed = false;
    fault = (name, args) => {
      if (name === "openSync" && String(args[0]) === f.body) { observed = true; throw cause; }
    };
    assert.throws(() => f.cache.get(f.job), error => error === cause); assert.ok(observed);
  });

  await test("compiler invariant failures preserve their cause", () => {
    const f = fixture("invariant"); const cause = new Error("compiler invariant fixture"); let observed = false;
    fault = (name, args) => {
      if (name === "mkdirSync" && String(args[0]).startsWith(f.cache.root)) { observed = true; throw cause; }
    };
    assert.throws(() => f.cache.put(f.job, f.data), error => error === cause); assert.ok(observed);
  });
  fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
  for (const result of results) console.log(JSON.stringify(result));
  if (results.some(result => result.status === "failed")) process.exitCode = 1;
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
