// Usage: bun module_origins.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-module-origins-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
const Main = await import(pathToFileURL(path.join(source, "main.ts")).href);
const Comp = await import(pathToFileURL(path.join(source, "comp.ts")).href);
const Store = await import(pathToFileURL(path.join(source, "store.ts")).href);
const results: Record<string, unknown>[] = [];

function fixture(name: string, files: Record<string, string>, entry = "main.bend") {
  const own = path.join(directory, name); fs.mkdirSync(own);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(own, name), text);
  return { own, entry: path.join(own, entry) };
}

async function load(entry: string) {
  const book = Bend.book_nil(), seen = new Map<string, string | null>(), modules: any[] = [];
  const n0 = await Bend.book_load(book, entry, "", seen, undefined, (module: any) => modules.push(module));
  return { book, modules, n0 };
}

async function test(name: string, run: () => Promise<void>) {
  const before = performance.now();
  try { await run(); results.push({ test: name, status: "passed", duration_ms: performance.now() - before }); }
  catch (error) { results.push({ test: name, status: "failed", error: String(error),
    detail: (error as any)?.$ === "Err" ? Bend.err_show(error) : (error as Error).stack }); }
}

try {
  await test("physical modules preserve duplicate imports and shared namespaces", async () => {
    const f = fixture("origins", { "dep.bend": "import Base\n\ndef value() -> U32:\n  42\n",
      "main.bend": "import ./dep.bend as D\nimport ./dep.bend as Again\n\ndef main() -> U32:\n  D.value()\n" });
    const { book, modules, n0 } = await load(f.entry); Bend.book_valid(book);
    const entry = modules.find(module => module.file === f.entry);
    const dep = modules.filter(module => module.file === path.join(f.own, "dep.bend"));
    const base = modules.find(module => module.file === Bend.BASE_BEND);
    assert.ok(entry); assert.ok(base); assert.equal(dep.length, 1);
    assert.equal(entry.namespace, ""); assert.equal(base.namespace, ""); assert.equal(dep[0].namespace, "dep");
    assert.deepEqual(book.order.slice(dep[0].first, dep[0].last), ["dep.value"]);
    assert.deepEqual(book.order.slice(entry.first, entry.last), ["main"]); assert.equal(n0, entry.first);
    assert.deepEqual(entry.imports, [
      { file: path.join(f.own, "dep.bend"), namespace: "dep" },
      { file: path.join(f.own, "dep.bend"), namespace: "dep" }]);
    assert.deepEqual(modules.flatMap(module => book.order.slice(module.first, module.last)), book.order);
  });

  await test("a preceding module supplies a raw qualified reference", async () => {
    const f = fixture("visible-prefix", { "left.bend": "import Base\n\ndef value() -> U32:\n  42\n",
      "right.bend": "import Base\n\ndef use() -> U32:\n  left.value()\n",
      "main.bend": "import ./left.bend as L\nimport ./right.bend as R\n\ndef main() -> U32:\n  R.use()\n" });
    const { book } = await load(f.entry); Bend.book_valid(book);
    assert.equal(book.open, 0); assert.equal(book.hols, 0); assert.ok(book.tlds["right.use"].v);
  });

  await test("a later module cannot supply a forward reference", async () => {
    const f = fixture("hidden-later", { "left.bend": "import Base\n\ndef value() -> U32:\n  42\n",
      "right.bend": "import Base\n\ndef use() -> U32:\n  left.value()\n",
      "main.bend": "import ./right.bend as R\nimport ./left.bend as L\n\ndef main() -> U32:\n  R.use()\n" });
    const { book } = await load(f.entry);
    assert.throws(() => Bend.book_valid(book), error => (error as any)?.$ === "Err"
      && (error as any).def === "right.use");
  });

  await test("a law declaration and its completion retain separate source events", async () => {
    const f = fixture("law-completion", { "LAWS.bend": "import Base\n\nlaw same:\n  for x: Nat\n  {x == x : Nat}\n",
      "PROOF.bend": "import ./LAWS.bend as L\n\ndef L.same(x):\n  {==}\n" }, "PROOF.bend");
    const { book, modules } = await load(f.entry); Bend.book_valid(book);
    assert.equal(book.open, 0); assert.equal(book.hols, 0); assert.ok(book.tlds["LAWS.same"].v);
    const declaration = modules.find(module => module.file === path.join(f.own, "LAWS.bend"));
    const completion = modules.find(module => module.file === f.entry);
    assert.ok(declaration); assert.ok(completion);
    assert.deepEqual(book.order.slice(declaration.first, declaration.last), ["LAWS.same"]);
    assert.deepEqual(book.order.slice(completion.first, completion.last), ["LAWS.same"]);
    assert.ok(declaration.last <= completion.first);
  });

  await test("one physical file retains one namespace", async () => {
    const f = fixture("symlink", { "dep.bend": "import Base\n\ndef value() -> U32:\n  42\n",
      "main.bend": "import ./dep.bend as D\nimport ./alias.bend as A\n" });
    fs.symlinkSync("dep.bend", path.join(f.own, "alias.bend"));
    await assert.rejects(load(f.entry), error => (error as any)?.$ === "Err"
      && String((error as any).exp).includes("one namespace per file"));
  });

  await test("the default front end seals physical module origins", async () => {
    const f = fixture("default-front", { "dep.bend": "import Base\n\ndef value() -> U32:\n  42\n",
      "main.bend": "import ./dep.bend as D\n\ndef main() -> U32:\n  D.value()\n" });
    const prepared = await Main.prepare_file(f.entry, f.own);
    const reader = new Store.CheckedReader(prepared.directory, Comp.compiler_identity());
    const header = reader.header();
    const inputs = reader.index.inputs;
    const own = inputs.find((input: any) => input.path === f.entry);
    assert.deepEqual(own.declarations, ["main"]);
    assert.deepEqual(own.imports, [{ file: path.join(f.own, "dep.bend"), namespace: "dep" }]);
    assert.equal(own.sha256, createHash("sha256").update(fs.readFileSync(f.entry)).digest("hex"));
    assert.deepEqual([...inputs].sort((a: any, b: any) => a.first - b.first)
      .flatMap((input: any) => input.declarations), header.book.order);
    fs.writeFileSync(path.join(f.own, "source-manifest.json"), JSON.stringify(inputs, null, 2));
    fs.rmSync(prepared.directory, { recursive: true });
  });
  fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
  for (const result of results) console.log(JSON.stringify(result));
  if (results.some(result => result.status === "failed")) process.exitCode = 1;
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
