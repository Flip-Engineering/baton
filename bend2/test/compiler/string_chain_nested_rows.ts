// A row of a string literal match whose body matches a String binder or
// parameter again, or a Data parameter, with a final binder row, lowers through
// the String.eq guards: no character match (SCon) remains in the lowered body,
// and the interpreter and the emitted C select the same rows as the nested match.
// An affine value that the nested binder row uses twice is still refused.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Bend from "../../compiler/upstream/bend.ts";

type L = { $: string; [x: string]: unknown };
function children(term: L): L[] {
  switch (term.$) {
    case "Sub": return [term.f as L, term.v as L];
    case "Let": return [...(term.v as L[]), term.f as L];
    case "All": return [term.A as L, term.B as L];
    case "Lam": return [term.f as L];
    case "Typ": return [term.g as L];
    case "Min": return [term.a as L, term.b as L];
    case "App": return [term.f as L, term.x as L];
    case "ADT": case "Ctr": return term.x as L[];
    case "Mat": return [term.h as L, term.m as L];
    case "Eql": return [term.a as L, term.b as L, term.T as L];
    case "Rwt": return [term.e as L, term.p as L, term.f as L];
    case "Ann": return [term.x as L, term.T as L];
    default: return [];
  }
}
// Distinct nodes, and the distinct character matches (Mat on SCon) among them.
function census(term: L): { nodes: number; scon: number } {
  const seen = new WeakSet<object>(), stack: L[] = [term];
  let nodes = 0, scon = 0;
  while (stack.length > 0) {
    const node = stack.pop() as L;
    if (node === null || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node); nodes += 1;
    if (node.$ === "Mat" && node.k === "SCon") scon += 1;
    stack.push(...children(node));
  }
  return { nodes, scon };
}

const expected = ["show:s1", "players-pretty", "invalid", "pending-index", "pending-pretty", "invalid", "abab",
  "invalid", "si", "resume-lift:s", "clear:s", "invalid", "inbox-index:s", "inbox-pretty:s", "inbox-other:sq",
  "invalid", ">iab|R", "|A", "invalid-state", "invalid", "invalid", "invalid", "acc|st", "al=hi;bob=yo",
  "missing-before-and", "bad:e", "al=!e", "unknown", "unknown", "xyz", "xy_", "x_", "_", "mode:fast", "slow!",
  "other:warp", "none", "abab", "empty", "none", "on-true", "on-false", "none"];
const root = path.join(import.meta.dir, "../../..");
const main = path.join(root, "bend2/compiler/upstream/main.ts");
const env = { ...process.env, BEND_NO_TELEMETRY: "1" };
const fixture = path.join(import.meta.dir, "fixtures/string_chain_nested_rows.bend");
const book = Bend.book_nil();
await Bend.book_load(book, fixture, "", new Map());
Bend.book_valid(book);
const shape = (name: string): { nodes: number; scon: number } => {
  const def = book.tlds[name];
  assert.ok(def !== undefined && def.$ === "Def" && def.v !== null, `${name} is a filled def`);
  return census(Bend.term_lower_shared(def.v) as L);
};
const lifted = ["verb_id", "verb_two", "index", "send", "deep2", "subst", "marked2"];
const shapes = Object.fromEntries([...lifted, "flags"].map((name) => [name, shape(name)]));
for (const name of lifted) {
  assert.equal(shapes[name].scon, 0, `${name} tests its literals with String.eq (${JSON.stringify(shapes[name])})`);
}

const run = spawnSync(process.execPath, [main, fixture], { cwd: root, encoding: "utf8", env });
assert.equal(run.status, 0, run.stderr);
assert.deepEqual(run.stdout.trim().split("\n"), expected, "results");
const affine = path.join(import.meta.dir, "fixtures/string_chain_nested_affine.bend");
const refused = spawnSync(process.execPath, [main, affine, "--check-only"], { cwd: root, encoding: "utf8", env });
assert.notEqual(refused.status, 0, "a nested affine binder used twice is refused: " + refused.stdout);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-string-chain-nested-"));
try {
  const output = path.join(directory, "nested.c"), binary = path.join(directory, "nested");
  const emitted = spawnSync(process.execPath, ["--smol", main, fixture, "-o", output], { cwd: root, encoding: "utf8", env });
  assert.equal(emitted.status, 0, "the nested rows emit C: " + emitted.stderr);
  execFileSync(process.env.CC ?? "clang-19", ["-std=c11", "-O1", "-pthread", output, "-lm", "-o", binary]);
  assert.deepEqual(execFileSync(binary, { encoding: "utf8" }).trim().split("\n"), expected, "results of the C");
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log(JSON.stringify({ test: "string_chain_nested_rows", shapes }));
