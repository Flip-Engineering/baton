// Usage: bun module_parse.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
const Front = await import(pathToFileURL(path.join(source, "module-front.ts")).href);
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-module-parse-test-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
const results: Record<string, unknown>[] = [];

async function test(name: string, run: () => Promise<void>) {
  const before = performance.now();
  try { await run(); results.push({ test: name, status: "passed", duration_ms: performance.now() - before }); }
  catch (error) { results.push({ test: name, status: "failed", error: String(error),
    detail: (error as any)?.$ === "Err" ? Bend.err_show(error) : (error as Error).stack }); }
}

async function fixture(name: string, files: Record<string, string>, run: (entry: string, store: string) => Promise<void>) {
  const own = path.join(directory, name); fs.mkdirSync(own);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(own, name), text);
  const entry = path.join(own, "main.bend"), store = await Front.parse_file(entry, own, "parse-fixture");
  await run(entry, store);
}

try {
  await test("headers keep bodies deferred through declaration copies", async () => {
    await fixture("deferred", { "dep.bend": "import Base\n\ndef answer() -> U32:\n  42\n",
      "main.bend": "import ./dep.bend as D\n\ndef main() -> U32:\n  D.answer()\n" }, async (entry, store) => {
      const reads: any[] = [], program = new Front.ParsedProgram(store, "parse-fixture", read => reads.push(read));
      assert.deepEqual(reads, []);
      const header = { ...program.book.tlds["dep.answer"], v: null };
      assert.deepEqual(reads, []); assert.equal(header.v, null);
      const value = program.book.tlds["dep.answer"].v;
      assert.ok(value); assert.deepEqual(reads, []);
      assert.equal(Bend.u32_from_term(value), 42);
      assert.deepEqual(reads.map(read => read.name), ["dep.answer"]);
      assert.equal(reads[0].kind, "body");
      assert.equal(program.book.tlds["dep.answer"].v, value);
      Bend.term_lower(header.T);
      assert.deepEqual(reads.map(read => read.kind), ["body", "type"]);
      const module = program.manifest.modules.find(module => module.file === entry);
      assert.deepEqual(module.declarations, ["main"]);
      assert.equal(module.sha256, createHash("sha256").update(fs.readFileSync(entry)).digest("hex"));
      const baseline = Bend.book_nil(); await Bend.book_load(baseline, entry, "", new Map());
      Bend.book_valid(baseline); Bend.book_valid(program.book);
      assert.equal(Bend.term_key(program.book.tlds.main.e), Bend.term_key(baseline.tlds.main.e));
      assert.equal(program.book.hols + program.book.open, baseline.hols + baseline.open);
    });
  });
  await test("declarations and later law completions survive the parse store", async () => {
    await fixture("law", { "laws.bend": "import Base\n\nlaw same:\n  for x: Nat\n  {x == x : Nat}\n",
      "main.bend": "import ./laws.bend as L\n\ndef L.same(x):\n  {==}\n" }, async (entry, store) => {
      const reads: any[] = [], program = new Front.ParsedProgram(store, "parse-fixture", read => reads.push(read));
      const baseline = Bend.book_nil(); await Bend.book_load(baseline, entry, "", new Map());
      assert.deepEqual(program.book.order, baseline.order);
      assert.deepEqual(program.manifest.modules.flatMap(module => module.declarations), baseline.order);
      assert.equal(program.book.tlds["laws.same"].T.$, "All");
      assert.equal(program.book.tlds["laws.same"].v.$, "Lam");
      assert.deepEqual(reads.map(read => [read.kind, read.module]),
        [["type", path.join(path.dirname(entry), "laws.bend")], ["body", entry]]);
      Bend.book_valid(baseline); Bend.book_valid(program.book);
      assert.equal(program.book.hols + program.book.open, 0);
      assert.ok(Bend.term_compare("EQ", program.book,
        program.book.tlds["laws.same"].T, baseline.tlds["laws.same"].T));
      assert.ok(Bend.term_compare("EQ", program.book,
        program.book.tlds["laws.same"].v, baseline.tlds["laws.same"].v));
    });
  });
  await test("an unread private body edit preserves queried semantic inputs", async () => {
    await fixture("private-edit", { "dep.bend": "import Base\n\ndef answer() -> U32:\n  42\n\ndef unused() -> U32:\n  0\n",
      "main.bend": "import ./dep.bend as D\n\ndef main() -> U32:\n  D.answer()\n" }, async (entry, store) => {
      const before: any[] = [], first = new Front.ParsedProgram(store, "parse-fixture", read => before.push(read));
      Bend.term_lower(first.book.tlds["dep.answer"].T);
      assert.equal(Bend.u32_from_term(first.book.tlds["dep.answer"].v), 42);
      const dep = path.join(path.dirname(entry), "dep.bend");
      fs.writeFileSync(dep, fs.readFileSync(dep, "utf8").replace("  0\n", "  1\n"));
      const next = await Front.parse_file(entry, path.dirname(entry), "parse-fixture");
      const after: any[] = [], second = new Front.ParsedProgram(next, "parse-fixture", read => after.push(read));
      Bend.term_lower(second.book.tlds["dep.answer"].T);
      assert.equal(Bend.u32_from_term(second.book.tlds["dep.answer"].v), 42);
      assert.deepEqual(after, before);
      assert.notEqual(first.manifest.modules.find(module => module.file === dep).sha256,
        second.manifest.modules.find(module => module.file === dep).sha256);
    });
  });
  fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
  for (const result of results) console.log(JSON.stringify(result));
  if (results.some(result => result.status === "failed")) process.exitCode = 1;
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
