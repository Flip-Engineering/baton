// Usage: bun store_cleanup.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-store-cleanup-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
const Comp = await import(pathToFileURL(path.join(source, "comp.ts")).href);
const input = path.join(directory, "program.bend");
fs.writeFileSync(input, "import Base\n\ndef main() -> U32:\n  42\n");
const failures: unknown[] = [];

async function book() {
  const value = Bend.book_nil();
  await Bend.book_load(value, input, "", new Map());
  Bend.book_valid(value);
  return value;
}
function directories(parent: string): string[] {
  return fs.readdirSync(parent, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => path.join(parent, entry.name));
}
async function check(name: string, action: (workspace: string) => Promise<void>): Promise<void> {
  const workspace = path.join(directory, name); fs.mkdirSync(workspace);
  try { await action(workspace); console.log("PASS " + name); }
  catch (error) { failures.push(error); console.error(String(error)); }
}

try {
  await check("output-failure", async workspace => {
    const original = new Error("output callback failed"), value = await book();
    let stores: string[] = [];
    assert.throws(() => Comp.compile_book_to(value, () => {
      stores = directories(workspace).filter(directory => fs.existsSync(path.join(directory, "index.json")));
      throw original;
    }, workspace), error => error === original, "the output failure preserves its original exception");
    assert.ok(stores.length > 0, "the callback observes the checked store before output fails");
    fs.writeFileSync(path.join(workspace, "observed.json"), JSON.stringify({ stores, remaining: stores.filter(directory => fs.existsSync(directory)) }));
    assert.ok(stores.every(directory => !fs.existsSync(directory)), "synchronous output failure removes its checked store and fragments");
  });

  await check("prepare-failure", async workspace => {
    const original = new Error("checked preparation failed"), value = Bend.book_nil();
    let stores: string[] = [];
    Object.defineProperty(value, "tlds", { get() { stores = directories(workspace); throw original; } });
    assert.throws(() => Comp.prepare_book(value, workspace), error => error === original,
      "preparation failure preserves its original exception");
    assert.ok(stores.length > 0, "preparation owns a store before it fails");
    fs.writeFileSync(path.join(workspace, "observed.json"), JSON.stringify({ stores, remaining: stores.filter(directory => fs.existsSync(directory)) }));
    assert.ok(stores.every(directory => !fs.existsSync(directory)), "failed preparation removes stores whose ownership was not returned");
  });

  await check("returned-store", async workspace => {
    const stored = Comp.prepare_book(await book(), workspace);
    assert.ok(fs.existsSync(path.join(stored, "index.json")), "successful preparation returns a live checked store");
    fs.writeFileSync(path.join(workspace, "observed.json"), JSON.stringify({ returned: stored }));
    fs.rmSync(stored, { recursive: true });
  });

  await check("successful-output", async workspace => {
    const output = path.join(directory, "output.c"), fd = fs.openSync(output, "wx");
    try { Comp.compile_book_to(await book(), chunk => fs.writeSync(fd, chunk), workspace); }
    finally { fs.closeSync(fd); }
    assert.ok(fs.statSync(output).size > 0);
    assert.ok(!directories(workspace).some(directory => fs.existsSync(path.join(directory, "index.json"))), "successful one-shot output releases its store");
  });
  if (failures.length) throw new AggregateError(failures, "Checked-store cleanup failed; evidence: " + directory);
} finally {
  if (!retained && failures.length === 0) fs.rmSync(directory, { recursive: true, force: true });
  else console.error("Checked-store test evidence: " + directory);
}
