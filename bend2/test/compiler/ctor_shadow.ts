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
Bend.book_valid(book);
console.log("PASS ctor shadow: imported law retains its module-local helper and its proof checks");
