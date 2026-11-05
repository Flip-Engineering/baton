// Usage: bun module_check.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
const Front = await import(pathToFileURL(path.join(source, "module-front.ts")).href);
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-module-check-test-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
const results: Record<string, unknown>[] = [];

async function test(name: string, run: () => Promise<void>) {
  const before = performance.now();
  try { await run(); results.push({ test: name, status: "passed", duration_ms: performance.now() - before }); }
  catch (error) { results.push({ test: name, status: "failed", error: String(error),
    detail: (error as any)?.$ === "Err" ? Bend.err_show(error) : (error as Error).stack }); }
}

async function fixture(name: string, files: Record<string, string>) {
  const own = path.join(directory, name); fs.mkdirSync(own);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(own, name), text);
  const entry = path.join(own, "main.bend"), store = await Front.parse_file(entry, own, "check-fixture");
  const baseline = Bend.book_nil(); await Bend.book_load(baseline, entry, "", new Map());
  const program = () => new Front.ParsedProgram(store, "check-fixture");
  return { own, entry, store, baseline, program };
}

try {
  await test("a module boundary keeps a later law fill hidden", async () => {
    const f = await fixture("law-fill", {
      "laws.bend": "import Base\n\nlaw same:\n  for x: Nat\n  {x == x : Nat}\n",
      "main.bend": "import ./laws.bend as L\n\ndef L.same(x):\n  {==}\n\ndef future() -> U32:\n  7\n" });
    const prefix = f.program(), law = prefix.manifest.modules.find(module => module.file.endsWith("/laws.bend"));
    const checked = prefix.check(law);
    assert.equal(checked.book.tlds["laws.same"].v, null);
    assert.equal(checked.book.tlds.future, undefined);
    assert.equal(checked.book.hols + checked.book.open, 0);
    const final = f.program(), own = final.manifest.modules.find(module => module.file === f.entry);
    const complete = final.check(own); Bend.book_valid(f.baseline);
    assert.ok(complete.book.tlds["laws.same"].e);
    assert.equal(complete.book.hols + complete.book.open, 0);
    assert.ok(Bend.term_compare("EQ", complete.book,
      complete.book.tlds["laws.same"].T, f.baseline.tlds["laws.same"].T));
    fs.writeFileSync(path.join(f.own, "reads.json"), JSON.stringify(complete.reads, null, 2));
  });
  await test("a later invalid module does not enter an earlier check", async () => {
    const f = await fixture("later-error", {
      "valid.bend": "import Base\n\ndef value() -> U32:\n  42\n",
      "main.bend": "import ./valid.bend as V\n\ndef broken() -> U32:\n  Type\n" });
    const p = f.program(), module = p.manifest.modules.find(module => module.file.endsWith("/valid.bend"));
    const early = p.check(module); assert.ok(early.book.tlds["valid.value"].e);
    assert.equal(early.book.tlds.broken, undefined);
    assert.throws(() => Bend.book_valid(f.baseline), error => (error as any)?.$ === "Err"
      && (error as any).def === "broken");
    const current = f.program(), own = current.manifest.modules.find(module => module.file === f.entry);
    assert.throws(() => current.check(own), error => (error as any)?.$ === "Err"
      && (error as any).def === "broken");
  });
  await test("checked modules preserve template arguments across imports", async () => {
    const f = await fixture("templates", {
      "template.bend": "import Base\n\ndef add(~n: U32, value: U32) -> U32:\n  (value + n : U32)\n",
      "left.bend": "import ./template.bend as T\n\ndef value() -> U32:\n  T.add(~1, 40)\n",
      "right.bend": "import ./template.bend as T\n\ndef value() -> U32:\n  T.add(~2, 40)\n",
      "main.bend": "import ./left.bend as L\nimport ./right.bend as R\n\ndef main() -> U32:\n  (L.value() + R.value() : U32)\n" });
    Bend.book_valid(f.baseline);
    const observed = new Map<string, string>();
    for (const module of f.program().manifest.modules) {
      const checked = f.program().check(module); assert.equal(checked.book.hols + checked.book.open, 0);
      for (const [key, name] of Object.entries(checked.book.tmps["template.add"] ?? {})) {
        assert.equal(name, f.baseline.tmps["template.add"][key]); observed.set(key, name as string);
      }
    }
    assert.deepEqual(Object.fromEntries(observed), { ...f.baseline.tmps["template.add"] });
  });
  await test("type computation records the imported body it unfolds", async () => {
    const f = await fixture("type-body", {
      "dep.bend": "import Base\n\ndef Element() -> Data:\n  U32\n\ndef unrelated() -> U32:\n  9\n",
      "main.bend": "import ./dep.bend as D\n\ndef identity(value: D.Element()) -> D.Element():\n  value\n" });
    Bend.book_valid(f.baseline);
    const p = f.program(), own = p.manifest.modules.find(module => module.file === f.entry);
    const checked = p.check(own); assert.ok(checked.book.tlds.identity.e);
    assert.ok(checked.reads.some(read => read.kind === "body" && read.name === "dep.Element"));
    assert.ok(!checked.reads.some(read => read.kind === "body" && read.name === "dep.unrelated"));
    fs.writeFileSync(path.join(f.own, "reads.json"), JSON.stringify(checked.reads, null, 2));
  });
  fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
  for (const result of results) console.log(JSON.stringify(result));
  if (results.some(result => result.status === "failed")) process.exitCode = 1;
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
