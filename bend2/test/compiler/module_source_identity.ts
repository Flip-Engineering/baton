// Usage: bun module_source_identity.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { mock } from "bun:test";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-module-source-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
const entry = path.join(directory, "main.bend");
const parsed = "import Base\n\ndef main() -> U32:\n  42\n";
const changed = "import Base\n\ndef main() -> U32:\n  13\n";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
fs.writeFileSync(entry, parsed);
const original = fs.readFileSync;
let observed = false, actual: string | undefined;
const readFileSync = function(file: any, ...args: any[]) {
  const text = Reflect.apply(original, fs, [file, ...args]);
  if (String(file) === entry && !observed) {
    assert.equal(text, parsed); actual = text; observed = true;
    fs.writeFileSync(entry, changed);
  }
  return text;
};
const replacement = { ...fs, readFileSync };
mock.module("node:fs", () => ({ ...replacement, default: replacement }));
let prepared: { directory: string } | undefined;
try {
  const Main = await import(pathToFileURL(path.join(source, "main.ts")).href);
  const Comp = await import(pathToFileURL(path.join(source, "comp.ts")).href);
  const Store = await import(pathToFileURL(path.join(source, "store.ts")).href);
  const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
  prepared = await Main.prepare_file(entry, directory);
  assert.ok(observed, "the default loader actually reads the intercepted source");
  assert.equal(actual, parsed); assert.equal(fs.readFileSync(entry, "utf8"), changed);
  const reader = new Store.CheckedReader(prepared.directory, Comp.compiler_identity());
  const input = reader.index.inputs.find((input: any) => input.path === entry);
  fs.writeFileSync(path.join(directory, "source-identity.json"), JSON.stringify({
    parsed_sha256: hash(parsed), changed_sha256: hash(changed), input,
    original: parsed, actual_read: actual, file_after_read: changed }, null, 2));
  assert.equal(input.sha256, hash(parsed), "the checked store identifies the text actually parsed");
  assert.notEqual(input.sha256, hash(changed));
  const value = Bend.term_wnf(reader.header().book, reader.body("main"));
  assert.equal(Bend.u32_from_term(value), 42);
  console.log(JSON.stringify({ test: "module_source_identity", status: "passed", input }));
} finally {
  if (prepared !== undefined) fs.rmSync(prepared.directory, { recursive: true });
  if (!retained) fs.rmSync(directory, { recursive: true, force: true });
}
