import assert from "node:assert/strict";
import * as path from "node:path";
import * as Bend from "../../compiler/upstream/bend.ts";

const file = path.join(import.meta.dir, "fixtures/ctor-shadow/entry.bend");
const book = Bend.book_nil();
await Bend.book_load(book, file, "", new Map());

const law = book.tlds["M.keeps"];
assert.ok(law, "the imported law must be loaded");
const statement = Bend.term_show(Bend.term_lower(law.T));
assert.match(statement, /M\.Done/, "the law must refer to its module's Done definition");
console.log("PASS ctor shadow: imported law retains its module-local helper");
