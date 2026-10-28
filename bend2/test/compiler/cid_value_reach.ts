// Usage: bun test ./bend2/test/compiler/cid_value_reach.ts
// A book with 65,537 type-reachable constructors (one Big ADT) and three
// runtime-selected values. The base compiler seeds every type-reachable
// constructor and fails the CID guard; the value-reachable table keeps only
// the constructors the emitted C references, plus the runtime's own tags.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

import * as Bend from "../../compiler/upstream/bend.ts";
import * as Comp from "../../compiler/upstream/comp.ts";

type Compile = { compile_book(book: Bend.Book): string };
type ErrShape = { $?: string; msg?: string; exp?: unknown; obs?: unknown };

const root = path.resolve(import.meta.dir, "../../..");
const upstream = path.join(root, "bend2/compiler/upstream");
const baseCommit = "b4d86b06b6c7bbbe8e4a9bda8715e626f4fcb1cb";
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cid-value-reach-"));
const constructors = 65537;
const rows = Array.from({ length: constructors }, (_, i) => `  Big${i}{}\n`).join("");
const fixture = path.join(temp, "cid-boundary.bend");
fs.writeFileSync(fixture, `import Base

type Big is Data:
${rows}
def pick(flag: String) -> Big:
  match flag:
    case "b0": Big0{}
    case "b1": Big1{}
    case other: Big2{}

def use(x: Big) -> String:
  match x:
    case Big0{}: "big0"
    case Big1{}: "big1"
    case other: "other"

def run(args: List<String>) -> IO(Unit):
  match args:
    case +flag <> _: IO.print(use(pick(flag)))
    case Nil{}: IO.print(use(Big0{}))

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    run(args)
`);

async function load(): Promise<Bend.Book> {
  const book = Bend.book_nil();
  await Bend.book_load(book, fixture, "", new Map());
  Bend.book_valid(book);
  return book;
}
function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  const x = (typeof e === "object" && e !== null ? e : {}) as ErrShape;
  return String(e) + " " + JSON.stringify({ $: x.$, msg: x.msg,
    exp: x.exp === undefined ? undefined : String((x.exp as { $?: string }).$),
    obs: x.obs === undefined ? undefined : String((x.obs as { $?: string }).$) });
}
function cids(c: string): [string, number][] {
  return [...c.matchAll(/^#define (CID_[A-Z0-9_]+) (\d+)$/gm)]
    .map((m) => [m[1], Number(m[2])]);
}
function arityTable(c: string): number[] {
  const m = /CONSTV u8 CID_ARITY_T\[\] = \{ ([^}]*) \};/.exec(c);
  assert.ok(m !== null, "CID_ARITY_T");
  return m[1].split(",").map((x) => Number(x.trim()));
}
function hotTable(c: string): number[] {
  const m = /CONSTV u8 CID_HOT_T\[\] = \{ ([^}]*) \};/.exec(c);
  assert.ok(m !== null, "CID_HOT_T");
  return m[1].split(",").map((x) => Number(x.trim()));
}
function fids(c: string): string[] {
  return [...c.matchAll(/^#define (FID_[A-Z0-9_]+) \d+$/gm)].map((m) => m[1]);
}

// The base compiler still seeds every type-reachable constructor.
const baseDir = path.join(temp, "base");
fs.cpSync(upstream, baseDir, { recursive: true });
fs.writeFileSync(path.join(baseDir, "comp.ts"),
  execFileSync("git", ["show", `${baseCommit}:bend2/compiler/upstream/comp.ts`],
    { cwd: root, maxBuffer: 1 << 28 }));
const BaseComp = (await import(pathToFileURL(path.join(baseDir, "comp.ts")).href)) as unknown as Compile;
console.error("cid boundary: compiling with the base blanket seed");
const baseBook = await load();
let baseError: string | null = null;
try {
  BaseComp.compile_book(baseBook);
} catch (e) {
  baseError = errorText(e);
}
assert.match(baseError ?? "", /an id over 65535/,
  "the base compiler fails the CID guard");

// The repaired compiler assigns only the CIDs the live C references.
const book = await load();
const c = Comp.compile_book(book);
const cid = cids(c);
const expected_arities: Record<string, number> = {
  CID_IO_ARGS: 1, CID_IO_PRINT: 2, CID_TUPLE: 2, CID_SNIL: 0, CID_SCON: 2,
  CID_WCON: 2, CID_EMIT: 1, CID_HALT: 2, CID_FAIL: 1, CID_DONE: 1,
  CID_NONE: 0, CID_SOME: 1, CID_FALSE: 0, CID_TRUE: 0, CID_UNIT: 0,
  CID_NIL: 0, CID_CON: 2,
};
assert.deepEqual(cid.map(([name]) => name).sort(), Object.keys(expected_arities).sort(),
  "the live program and runtime constructor names");
assert.ok(!c.includes("CID_BIG"), "no Big constructor CID in the live C");
const arities = arityTable(c), hot = hotTable(c);
for (const [name, id] of cid) {
  assert.equal(arities[id], expected_arities[name], name + " arity");
  assert.equal(hot[id], 0, name + " sharing flag");
}
const fid = fids(c);
assert.ok(fid.length > 0 && fid.length <= (1 << 20) - 4, "FID table inside the limit");

// The emitted C keeps the runtime's own tags and runs the selected values.
const cPath = path.join(temp, "cid-boundary.c");
const bin = path.join(temp, "cid-boundary");
fs.writeFileSync(cPath, c);
const cc = process.env.CC ?? "clang-19";
execFileSync(cc, ["-std=c11", "-O1", "-pthread", cPath, "-lm", "-o", bin],
  { maxBuffer: 1 << 28 });
for (const [arg, expected] of [["b0", "big0"], ["b1", "big1"], ["x", "other"]] as const) {
  const out = execFileSync(bin, [arg], { encoding: "utf8" }).trim();
  assert.equal(out, expected, `runtime ${arg}`);
}
assert.equal(execFileSync(bin, [], { encoding: "utf8" }).trim(), "big0",
  "runtime without arguments");

// The CID and FID boundaries report their own count and limit.
function over(namespace: string, count: number, limit: number): string {
  try {
    Comp.check_id_limit(namespace, count, limit);
    return "";
  } catch (e) {
    return errorText(e);
  }
}
assert.equal(over("CID", 1 << 20, 1 << 20), "");
assert.match(over("CID", (1 << 20) + 1, 1 << 20), /CID: 1048577 over 1048576/);
assert.equal(over("FID live segments", (1 << 20) - 4, (1 << 20) - 4), "");
assert.match(over("FID live segments", (1 << 20) - 3, (1 << 20) - 4),
  /FID live segments: 1048573 over 1048572/);

console.log(`PASS CID value reach: 65,537 type-reachable -> ${cid.length} CIDs, `
  + `base guard failed, FID table ${fid.length} segments limits enforced`);
fs.rmSync(temp, { recursive: true, force: true });
