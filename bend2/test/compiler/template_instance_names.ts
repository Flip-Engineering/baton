// Usage: bun template_instance_names.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-template-names-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
const results: Record<string, unknown>[] = [];

const template = "def select(~n: U32, x: U32) -> U32:\n  (x + n : U32)\n";
const left = "def left() -> U32:\n  select(~1, 40)\n";
const right = "def right() -> U32:\n  select(~2, 40)\n";
const main = "def main() -> U32:\n  (left() + right() : U32)\n";

async function load(name: string, text: string, check = true) {
  const file = path.join(directory, name + ".bend");
  fs.writeFileSync(file, "import Base\n\n" + text);
  const book = Bend.book_nil();
  await Bend.book_load(book, file, "", new Map());
  if (check) Bend.book_valid(book);
  return book;
}

async function test(name: string, run: () => Promise<void>) {
  const before = performance.now();
  try { await run(); results.push({ test: name, status: "passed", duration_ms: performance.now() - before }); }
  catch (error) { results.push({ test: name, status: "failed", error: String(error),
    detail: (error as any)?.$ === "Err" ? Bend.err_show(error) : (error as Error).stack }); }
}

try {
  await test("instance names survive call discovery order", async () => {
    const a = await load("left-first", template + left + right + main);
    const b = await load("right-first", template + right + left + main);
    assert.deepEqual({ ...a.tmps.select }, { ...b.tmps.select });
  });
  await test("repeated arguments reuse one instance", async () => {
    const book = await load("repeat", template + left +
      "def again() -> U32:\n  select(~1, 41)\n" +
      "def main() -> U32:\n  (left() + again() : U32)\n");
    assert.equal(Object.keys(book.tmps.select).length, 1);
    assert.equal(book.hols + book.open, 0);
  });
  await test("body and signature edits retain their checked content", async () => {
    const a = await load("original", template + left);
    const b = await load("body-edit", template.replace("(x + n : U32)", "(x + n + 1 : U32)") + left);
    const c = await load("type-edit", template.replace("-> U32", "-> Nat")
      .replace("(x + n : U32)", "U32.to_nat((x + n : U32))") + left.replace("-> U32", "-> Nat"));
    const name = Object.values(a.tmps.select)[0] as string;
    assert.deepEqual({ ...a.tmps.select }, { ...b.tmps.select });
    assert.deepEqual({ ...a.tmps.select }, { ...c.tmps.select });
    assert.notEqual(Bend.term_key(a.tlds[name].e), Bend.term_key(b.tlds[name].e));
    assert.notEqual(Bend.term_key(Bend.term_lower(a.tlds[name].T)),
      Bend.term_key(Bend.term_lower(c.tlds[name].T)));
  });
  await test("an occupied content name reports its cause", async () => {
    const checked = await load("collision-name", template + left);
    const book = await load("collision", template + left, false);
    const name = Object.values(checked.tmps.select)[0] as string;
    book.tlds[name] = { $: "Def", n: 0, x: 0, T: Bend.Ref("U32"), v: Bend.Lit(777) };
    assert.throws(() => Bend.book_valid(book), error => (error as any)?.$ === "Err"
      && (error as any).exp === "a template instance with a distinct content name");
  });
  fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2));
  for (const result of results) console.log(JSON.stringify(result));
  if (results.some(result => result.status === "failed")) process.exitCode = 1;
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
