// Usage: bun bend2/test/compiler/spin_cid_definition.ts
// A constructor that the emitted C builds only inside a spin body needs its CID
// macro. Spin bodies are emitted as functions; the CID table is assembled from
// each live spin's recorded constructor references. Without that input the C
// referenced CID_ARTIFACT with no macro of that name and clang refused the
// queue bootstrap (issue #1176: "use of undeclared identifier 'CID_ARTIFACT'").
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import * as Bend from "../../compiler/upstream/bend.ts";
import * as Comp from "../../compiler/upstream/comp.ts";

const fixture = path.join(import.meta.dir, "fixtures/spin_cid.bend");
const upstream = path.resolve(import.meta.dir, "../../compiler/upstream");
const root = path.resolve(import.meta.dir, "../..");

const book = Bend.book_nil();
await Bend.book_load(book, fixture, "", new Map());
Bend.book_valid(book);
const source = Comp.compile_book(book);

const TABLE_NAMES: Record<string, true> = { CID_ARITY_T: true, CID_HOT_T: true };
const defined = new Set([...source.matchAll(/^#define (CID_[A-Z0-9_]+) \d+$/gm)]
  .map((m) => m[1]));
const used = new Set([...source.matchAll(/\bCID_[A-Z0-9_]+\b/g)]
  .map((m) => m[0]).filter((name) => TABLE_NAMES[name] !== true));
assert.deepEqual([...used].filter((name) => !defined.has(name)), [],
  "every CID macro the emitted C references is defined");

// The fixture carries its weight only while the construction stays in a spin.
function enclosing(at: number): string {
  const starts = [...source.slice(0, at).matchAll(/^(?:INLINE|FAR) Term (\w+)\(/gm)];
  return starts.length === 0 ? "" : starts[starts.length - 1][1];
}
const sites = [...source.matchAll(/term_(?:ctr|pak)\(CID_ARTIFACT\b/g)]
  .map((m) => m.index!);
assert.ok(sites.length >= 1, "the fixture builds Artifact in the emitted C");
for (const at of sites) {
  assert.match(enclosing(at), /^spin_\d+$/,
    "the Artifact construction must stay in a spin body");
}
assert.ok(defined.has("CID_ARTIFACT"), "CID_ARTIFACT is defined");

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "spin-cid-"));
try {
  // The emitted C builds and runs. Before the repair clang refused this text.
  const cPath = path.join(temp, "spin-cid.c");
  const bin = path.join(temp, "spin-cid");
  fs.writeFileSync(cPath, source);
  const cc = process.env.CC ?? "clang-19";
  execFileSync(cc, ["-std=c11", "-O1", "-pthread", cPath, "-lm", "-o", bin],
    { maxBuffer: 1 << 28 });
  const run = (...args: string[]): string =>
    execFileSync(bin, args, { encoding: "utf8" }).trim();
  assert.equal(run("alpha\tbeta"), "alpha", "a two-field row names one artifact");
  assert.equal(run("a\tb\nc\td"), "a\nc", "each two-field row names one artifact");
  assert.equal(run("lonely"), "", "a row without two fields is refused");

  // The compiler at the base commit emits the same construction with no macro
  // of that name. The base commit is the main revision before this repair, and
  // its comp.ts matches the source the selected compiler archive carries.
  const baseCommit = "0ff762e55071bffd09b58d37fd4d4019da701e53";
  const baseDir = path.join(temp, "base");
  fs.mkdirSync(baseDir);
  for (const name of ["bend.ts", "base.bend"]) {
    fs.copyFileSync(path.join(upstream, name), path.join(baseDir, name));
  }
  fs.symlinkSync(path.join(upstream, "effs"), path.join(baseDir, "effs"));
  fs.writeFileSync(path.join(baseDir, "comp.ts"),
    execFileSync("git", ["show", `${baseCommit}:bend2/compiler/upstream/comp.ts`],
      { cwd: root, maxBuffer: 1 << 28 }));
  const probe = path.join(baseDir, "probe.ts");
  fs.writeFileSync(probe, `import * as Bend from "./bend.ts";
import * as Comp from "./comp.ts";
const book = Bend.book_nil();
await Bend.book_load(book, ${JSON.stringify(fixture)}, "", new Map());
Bend.book_valid(book);
process.stdout.write(Comp.compile_book(book));
`);
  const before = execFileSync(process.execPath, [probe],
    { encoding: "utf8", maxBuffer: 1 << 28 });
  assert.ok(before.includes("term_ctr(CID_ARTIFACT"),
    "the construction is emitted at the base commit");
  assert.ok(!/#define CID_ARTIFACT \d+/.test(before),
    "the base commit leaves CID_ARTIFACT undefined");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log(`PASS spin cid definition: ${defined.size} CIDs defined, `
  + `CID_ARTIFACT from the spin body, emitted C compiles and runs`);
