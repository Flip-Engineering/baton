// The CID namespace holds only constructors the live program can reference.
// The fixture declares Grey but never constructs or matches it; the
// old blanket SRCS-ADT seed assigned it a CID anyway.
import assert from "node:assert/strict";
import * as path from "node:path";
import * as Bend from "../../compiler/upstream/bend.ts";
import * as Comp from "../../compiler/upstream/comp.ts";

const file = path.join(import.meta.dir, "fixtures/cid_reach.bend");
const book = Bend.book_nil();
await Bend.book_load(book, file, "", new Map());
Bend.book_valid(book);
const c = Comp.compile_book(book);
const has = (n: string): boolean => c.includes("#define CID_" + n + " ");
assert.ok(!has("GREY"), "the unused Grey constructor must not get a CID");
assert.ok(has("SOME") || has("NONE") || has("TRUE"),
  "the runtime constructor CIDs must remain");
assert.ok(!has("RED") && !has("GREEN") && !has("BLUE"),
  "type-reachable constructors optimized out of the live code keep no CID");
const defines = [...c.matchAll(/#define CID_(\w+) /g)].map((m) => m[1]);
console.log(`PASS cid reach: ${defines.length} CIDs; Colour constructors absent; runtime present`);
