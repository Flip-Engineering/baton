// The FID namespace must hold far more than 65,536 reachable functions.
// Compile a real fixture, then include the emitted C in a small host test and
// round-trip FIDs above the old 16-bit limit through the term encoding.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Bend from "../../compiler/upstream/bend.ts";
import * as Comp from "../../compiler/upstream/comp.ts";

const fixture = path.join(import.meta.dir, "fixtures/fid_width.bend");
const book = Bend.book_nil();
await Bend.book_load(book, fixture, "", new Map());
Bend.book_valid(book);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-width-"));
try {
  fs.writeFileSync(path.join(dir, "gen.c"), Comp.compile_book(book));
  fs.writeFileSync(path.join(dir, "test.c"), `#define main bend_generated_main
#include "gen.c"
#undef main
#include <assert.h>
int main(void) {
  Term a = term_clo(70000u, 123u);
  assert(term_tag(a) == TAG_CLO);
  assert(term_aux(a) == 70000u);
  assert(term_loc(a) == 123u);
  Term b = term_tsk((1u << 20) - 1u, 7u);
  assert(term_tag(b) == TAG_TSK);
  assert(term_aux(b) == (1u << 20) - 1u);
  assert(term_loc(b) == 7u);
  Term c = term_ctr(70000u, 99u);
  assert(term_tag(c) == TAG_CTR);
  assert(term_aux(c) == 70000u);
  Term d = term_blk(true, 3u, 4u);
  assert(term_tag(d) == TAG_ARR);
  assert(term_aux(d) == 3u);
  assert(term_loc(d) == 4u);
  return 0;
}
`);
  const bin = path.join(dir, "test");
  const names = [...(process.env.CC ? [process.env.CC] : []), "clang",
    ...Array.from({ length: 10 }, (_, i) => "clang-" + (14 + i))];
  const compiler = names.find((name) =>
    spawnSync(name, ["--version"], { encoding: "utf8" }).status === 0);
  assert.ok(compiler !== undefined, "a clang is available");
  const cc = spawnSync(compiler, ["-std=gnu11", "-O0", "-w", "-pthread",
    path.join(dir, "test.c"), "-o", bin], { encoding: "utf8" });
  assert.equal(cc.status, 0, cc.stderr || cc.error?.message);
  const run = spawnSync(bin, [], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  console.log("PASS fid width: FID 70000, task 1048575, CID 70000 round-trip");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
