// Usage: bun bend2/test/compiler/string_pattern_literal_sharing.ts
// Check that captured fallbacks keep the same term while string-pattern
// constructor subtrees stay shared through the production parser transforms.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as Bend from "../../compiler/upstream/bend.ts";

const fixtures = [
  {
    name: "legacy stop-hook arm and captured fallback",
    source: `def test(args: List<String>) -> IO(Unit):
  match args:
    case "--stop-hook" <> Nil{}: StopHook.run()
    case other: normal_cli(other)
`,
    hash: "33a2bc1b3f13c0ac4e5720b11f11d1eedebeba7ea48fda599a6d3c6389c679bb",
    max_nodes: 50_000,
  },
  {
    name: "overlapping literal prefixes and captured fallback",
    source: `def test(args: List<String>) -> IO(Unit):
  match args:
    case "--wake-message" <> +db <> +id <> Nil{}: Wake.message_cli(db,id)
    case "--wake" <> +db <> Nil{}: Wake.message_cli(db,db)
    case other: normal_cli(other)
`,
    hash: "72bb8d70c44d314922ab191c74e298442deea22809cf4c5847af508be8f2114b",
    max_nodes: 60_000,
  },
];

function children(term: Bend.LTerm): Bend.LTerm[] {
  switch (term.$) {
    case "Sub": return [term.f, term.v];
    case "Let": return [...term.v, term.f];
    case "All": return [term.A, term.B];
    case "Lam": return [term.f];
    case "Typ": return [term.g];
    case "Min": return [term.a, term.b];
    case "App": return [term.f, term.x];
    case "ADT": case "Ctr": return term.x;
    case "Mat": return [term.h, term.m];
    case "Eql": return [term.a, term.b, term.T];
    case "Rwt": return [term.e, term.p, term.f];
    case "Ann": return [term.x, term.T];
    default: return [];
  }
}

function term_hash(term: Bend.LTerm): string {
  const hashes = new WeakMap<object, string>();
  function hash(node: Bend.LTerm): string {
    const prior = hashes.get(node);
    if (prior !== undefined) return prior;
    const fields: Record<string, unknown> = { $: node.$ };
    const value = node as unknown as Record<string, unknown>;
    for (const key of ["k", "i", "n", "v", "b", "q", "r"]) {
      if (value[key] !== undefined && typeof value[key] !== "function") fields[key] = value[key];
    }
    if (node.s !== undefined) fields.s = [node.s.src, node.s.beg, node.s.end];
    const body = JSON.stringify([node.$, Object.fromEntries(
      Object.entries(fields).filter(([key]) => key !== "$"),
    ), node.s === undefined ? null : [node.s.src, node.s.beg, node.s.end], children(node).map(hash)]);
    const result = createHash("sha256").update(body).digest("hex");
    hashes.set(node, result);
    return result;
  }
  return hash(term);
}

function term_nodes(term: Bend.HTerm): number {
  const seen = new WeakSet<object>();
  const stack = [term];
  let visits = 0;
  while (stack.length > 0) {
    const node = Bend.term_force(stack.pop() as Bend.HTerm);
    visits += 1;
    if (seen.has(node)) continue;
    seen.add(node);
    switch (node.$) {
      case "Lam": stack.push(node.f(Bend.Var(node.k, 0))); break;
      case "Let": stack.push(node.f(node.k.map((k, i) => Bend.Var(k, i))), ...node.v); break;
      case "All": stack.push(node.A, node.B(Bend.Var(node.k, 0))); break;
      default: stack.push(...children(node as Bend.LTerm)); break;
    }
  }
  return visits;
}

for (const fixture of fixtures) {
  const book = Bend.book_nil();
  await Bend.book_load(book, Bend.BASE_BEND, "", new Map());
  Bend.parse_book(book, "/tmp", fixture.source);
  const checked_shape = Bend.term_higher(Bend.term_lower(book.tlds.test.v as Bend.HTerm));
  assert.ok(term_nodes(checked_shape) < fixture.max_nodes, `${fixture.name} node bound`);
  assert.equal(term_hash(Bend.term_lower(checked_shape)), fixture.hash, `${fixture.name} term structure`);
  console.log(`PASS ${fixture.name}: ${term_nodes(checked_shape)} visits`);
}
