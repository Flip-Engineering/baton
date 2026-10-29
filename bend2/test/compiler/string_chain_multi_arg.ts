// A String match with later top-level parameters uses the same inline String.eq
// chain as one with a single parameter: no helper definitions, a syntax graph
// that does not grow with the extra parameter, and the same results.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

const root = path.join(import.meta.dir, "../../..");
const fixture = path.join(import.meta.dir, "fixtures/string_chain_multi_arg.bend");
const book = Bend.book_nil();
await Bend.book_load(book, fixture, "", new Map());
Bend.book_valid(book);
assert.deepEqual(book.order.filter((name) => name.includes("$lit")), [], "the String chain defines no helpers");
const size = (name: string): number => {
  const def = book.tlds[name];
  assert.ok(def !== undefined && def.$ === "Def" && def.v !== null, `${name} is a filled def`);
  return unique(Bend.term_lower_shared(def.v) as L);
};
const one = size("pick1"), two = size("pick2"), linear = size("pick_linear");
assert.ok(two < 2 * one, `a later parameter does not multiply the syntax graph (${one} nodes with one parameter, ${two} with two)`);
assert.ok(linear < 2 * one, `a later linear parameter does not multiply the syntax graph (${linear} nodes)`);

const run = spawnSync(process.execPath, [path.join(root, "bend2/compiler/upstream/main.ts"), fixture],
  { cwd: root, encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
assert.equal(run.status, 0, run.stderr);
assert.deepEqual(run.stdout.trim().split("\n"), ["B", "G1", "zzz2", "x", "y!", "z"], "results");
console.log(JSON.stringify({ test: "string_chain_multi_arg", pick1: one, pick2: two, pick_linear: linear }));
