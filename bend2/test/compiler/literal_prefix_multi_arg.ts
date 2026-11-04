// Multi-argument definitions stay on the ordinary lowering. The literal
// helper lowering binds only the matched first parameter; without this guard
// later parameters were abstracted into helper bodies whose signatures did
// not carry them. The used and unused forms must still check and run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import * as Bend from "../../compiler/upstream/bend.ts";

const root = path.join(import.meta.dir, "../../..");
const fixture = path.join(import.meta.dir, "fixtures/literal_prefix_multi_arg.bend");
const book = Bend.book_nil();
await Bend.book_load(book, fixture, "", new Map());
Bend.book_valid(book);
assert.deepEqual(book.order.filter((name) => name.includes("$lit")), [],
  "multi-argument definitions must not get literal helpers");

const run = spawnSync(process.execPath,
  [path.join(root, "bend2/compiler/upstream/main.ts"), fixture],
  { cwd: root, encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
assert.equal(run.status, 0, run.stderr);
assert.deepEqual(run.stdout.trim().split("\n"),
  ["a!", "!", "!", "a", "y", "z"], "multi-argument results");
console.log("PASS multi-argument literal prefixes stay generic and run");
