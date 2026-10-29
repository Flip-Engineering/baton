// A String match on an affine (Lone) parameter uses the inline String.eq chain
// of a + parameter: the syntax graph stays the size of the + version, and the
// interpreter and the emitted C give the same results. A final binder that its
// row could use more than once keeps the character decision tree, so a plain
// binder used twice is still refused and a + binder used twice still runs.
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
function unique(term: L): number {
  const seen = new WeakSet<object>(), stack: L[] = [term];
  let n = 0;
  while (stack.length > 0) {
    const node = stack.pop() as L;
    if (seen.has(node)) continue;
    seen.add(node); n += 1;
    stack.push(...children(node));
  }
  return n;
}

const expected = ["B", "?zeta", "G", "E", "?zeta", "?", "?alphas", "A", "twicetwice", "tw!",
  "A", "abab", "ut", "tu", "uG", "uothert", "2", "0", "BX", "B", "-"];
const root = path.join(import.meta.dir, "../../..");
const fixture = path.join(import.meta.dir, "fixtures/string_chain_lone.bend");
const book = Bend.book_nil();
await Bend.book_load(book, fixture, "", new Map());
Bend.book_valid(book);
assert.deepEqual(book.order.filter((name) => name.includes("$lit")), [], "the String chain defines no helpers");
const size = (name: string): number => {
  const def = book.tlds[name];
  assert.ok(def !== undefined && def.$ === "Def" && def.v !== null, `${name} is a filled def`);
  return unique(Bend.term_lower_shared(def.v) as L);
};
const many = size("pick_many"), lone = size("pick_lone"), param = size("pick_lone_param");
const middle = size("pick_lone_middle"), total = size("pick_lone_total"), plus = size("pick_lone_plus");
assert.ok(lone < many + 16, `an affine parameter lowers like a + parameter (${many} nodes with +, ${lone} without)`);
assert.ok(param < many, `a final binder that reads the parameter stays small (${param} nodes)`);
assert.ok(middle < 2 * many, `an affine matched parameter between others stays small (${middle} nodes)`);
assert.ok(total < many, `a total match on an affine parameter stays small (${total} nodes)`);
assert.ok(plus > lone, `a final binder used twice keeps the character decision tree (${plus} nodes)`);

const run = spawnSync(process.execPath, [path.join(root, "bend2/compiler/upstream/main.ts"), fixture],
  { cwd: root, encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
assert.equal(run.status, 0, run.stderr);
assert.deepEqual(run.stdout.trim().split("\n"), expected, "results");

// The final binder of an affine parameter is still affine.
const affine = path.join(import.meta.dir, "fixtures/string_chain_lone_affine.bend");
const refused = spawnSync(process.execPath, [path.join(root, "bend2/compiler/upstream/main.ts"), affine, "--check-only"],
  { cwd: root, encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
assert.notEqual(refused.status, 0, "a final binder used twice is refused: " + refused.stdout);
assert.match(refused.stderr + refused.stdout, /other/, "the refusal names the binder");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-string-chain-lone-"));
try {
  const output = path.join(directory, "chain.c"), binary = path.join(directory, "chain");
  const emitted = spawnSync(process.execPath, ["--smol", path.join(root, "bend2/compiler/upstream/main.ts"), fixture, "-o", output],
    { cwd: root, encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
  assert.equal(emitted.status, 0, "the chain emits C: " + emitted.stderr);
  execFileSync(process.env.CC ?? "clang-19", ["-std=c11", "-O1", "-pthread", output, "-lm", "-o", binary]);
  assert.deepEqual(execFileSync(binary, { encoding: "utf8" }).trim().split("\n"), expected, "results of the C");
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log(JSON.stringify({ test: "string_chain_lone", pick_many: many, pick_lone: lone,
  pick_lone_param: param, pick_lone_plus: plus, pick_lone_middle: middle, pick_lone_total: total }));
