import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
const file = path.join(import.meta.dir, "fixtures/ctor-shadow/entry.bend");
const module = fs.realpathSync(path.join(import.meta.dir, "fixtures/ctor-shadow/laws.bend"));
const book = Bend.book_nil(), seen = new Map<string, string | null>();
await Bend.book_load(book, file, "", seen);

const namespace = seen.get(module);
assert.ok(typeof namespace === "string", "the imported module has a canonical namespace");
const law = book.tlds[namespace + ".keeps"];
assert.ok(law, "the imported law must be loaded");
const statement = Bend.term_show(Bend.term_lower(law.T));
assert.ok(statement.includes(namespace + ".Done"),
  "the law must refer to its module's Done definition: " + statement);
let rejected = false;
try { Bend.book_valid(book); } catch (error) {
  if (error?.$ !== "Err") throw error;
  assert.equal(error.exp, "a defined name");
  assert.equal(error.obs?.$, "Ref");
  assert.equal(error.obs?.k, namespace + ".Done");
  rejected = true;
}
assert.ok(rejected, "the checker requires the helper before the law that uses it");

const ordered = Bend.book_nil();
await Bend.book_load(ordered, path.join(import.meta.dir, "fixtures/ctor-shadow/ordered/entry.bend"), "", new Map());
Bend.book_valid(ordered);
assert.equal(ordered.hols + ordered.open, 0, "the ordered import fixtures have complete proofs");
console.log("PASS ctor shadow: module resolution, forward-name refusal and ordered import proofs");
