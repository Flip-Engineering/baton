// Usage: bun test ./bend2/test/compiler/literal_prefix_lowering.ts
// Explicit baseline for the literal-prefix lowerings. The Many String path
// replaces one String.eq per row. The Lone List<String> path generates helper
// defs for the row continuations and one for the remaining rows, so each body
// is checked and emitted once and the Lone tail reaches one helper per path.
// The 11 existing compiler fixtures stay byte-identical; this test records the
// one fixture whose C changed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import path from "node:path";

import * as Bend from "../../compiler/upstream/bend.ts";

type L = { $: string; s?: { src: string; beg: number; end: number }; [x: string]: unknown };

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
function term_hash(term: L): string {
  const hashes = new WeakMap<object, string>();
  function hash(node: L): string {
    const prior = hashes.get(node);
    if (prior !== undefined) return prior;
    const fields: Record<string, unknown> = { $: node.$ };
    for (const key of ["k", "i", "n", "v", "b", "q", "r"]) {
      if (node[key] !== undefined && typeof node[key] !== "function") fields[key] = node[key];
    }
    if (node.s !== undefined) fields.s = [node.s.src, node.s.beg, node.s.end];
    const body = JSON.stringify([node.$, Object.fromEntries(
      Object.entries(fields).filter(([key]) => key !== "$"),
    ), node.s === undefined ? null : [node.s.src, node.s.beg, node.s.end],
    children(node).map(hash)]);
    const result = createHash("sha256").update(body).digest("hex");
    hashes.set(node, result);
    return result;
  }
  return hash(term);
}
function unique(term: L): number {
  const seen = new WeakSet<object>();
  const stack: L[] = [term];
  let n = 0;
  while (stack.length > 0) {
    const node = stack.pop() as L;
    if (seen.has(node)) continue;
    seen.add(node);
    n += 1;
    stack.push(...children(node));
  }
  return n;
}

async function load(file: string): Promise<Bend.Book> {
  const book = Bend.book_nil();
  await Bend.book_load(book, file, "", new Map());
  return book;
}
function check(book: Bend.Book, name: string, hash: string, nodes: number): void {
  const def = book.tlds[name];
  assert.ok(def !== undefined && def.$ === "Def" && def.v !== null, `${name} is a filled def`);
  const lowered = Bend.term_lower_shared(def.v) as L;
  assert.equal(term_hash(lowered), hash, `${name} normalized term`);
  assert.equal(unique(lowered), nodes, `${name} unique nodes`);
}

const root = path.join(import.meta.dir, "../../..");
const codex = await load(path.join(root, "bend2/src/coordinator/codex-inbox.bend"));
const verb = codex.tlds["../coordinator/commands.parse_verb_only"];
assert.ok(verb?.$ === "Def" && verb.v !== null, "the verb parser has a body");
assert.ok(unique(Bend.term_lower_shared(verb.v) as L) < 10_000,
  "whole-string dispatch keeps a bounded syntax graph");
const multi = ["../coordinator/commands.parse_verb_id",
  "../coordinator/commands.parse_verb_session_id",
  "../coordinator/commands.parse_verb_three_args"];
for (const name of multi) {
  const def = codex.tlds[name];
  assert.ok(def !== undefined && def.$ === "Def" && def.v !== null, `${name} is a filled def`);
}
assert.deepEqual(codex.order.filter((n) => n.includes("$lit")
  && multi.some((m) => n.startsWith(m + "$"))), [],
  "multi-argument parse verbs get no literal helpers");
console.log(`PASS codex-inbox literal-prefix String lowering: one-argument def; ${multi.length} multi-argument defs stay generic`);

const helperNames = (book: Bend.Book): string[] =>
  book.order.filter((name) => name.includes("$lit"));

const fixture = await load(path.join(import.meta.dir, "fixtures/literal_prefix_frames.bend"));
Bend.book_valid(fixture);
const helpers = helperNames(fixture);
assert.deepEqual(helpers, ["classify$litsuffix0", "classify$litrow1",
  "classify$litchain2", "classify$litrow3", "classify$litchain4"],
  "one helper per prefix row and literal group plus the remaining rows");
check(fixture, "classify_text",
  "d7de8d9a971f98b5500b0a69be3347faa70bd8675660461821f07ed4a32a48a4", 172);
check(fixture, "classify",
  "58957da5bc662bacad71bfa58d6b44eb5a2d009bb3a1e154a1cc5a7718794a33", 41);
console.log("PASS literal prefix fixture: Many String and Lone list lowered");
