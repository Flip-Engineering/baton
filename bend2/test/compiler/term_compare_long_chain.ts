// A law whose two sides normalize to a constructor chain of 200,000 cells checks:
// term_compare walks the last field of each constructor in a loop, so its stack
// depth does not grow with the length of a list or of a string in constructor
// form. The coordinator's laws compare such chains; with one recursive frame per
// cell the check ended with "Maximum call stack size exceeded".
import assert from "node:assert/strict";
import * as path from "node:path";
import * as Bend from "../../compiler/upstream/bend.ts";

const fixture = path.join(import.meta.dir, "fixtures/term_compare_long_chain.bend");
const book = Bend.book_nil();
await Bend.book_load(book, fixture, "", new Map());
assert.doesNotThrow(() => Bend.book_valid(book), "the long-chain law checks");
const law = book.tlds["long_lists_compare"];
assert.ok(law !== undefined && law.$ === "Def" && law.v !== null, "the law is filled");
console.log(JSON.stringify({ test: "term_compare_long_chain", cells: 200000 }));
