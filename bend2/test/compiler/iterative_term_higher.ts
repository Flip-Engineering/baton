// Usage: bun bend2/test/compiler/iterative_term_higher.ts
import assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { HTerm, LTerm, Span } from "../../compiler/upstream/bend.ts";

const source = process.env.BEND_COMPILER_SOURCE ?? path.join(import.meta.dir, "../../compiler/upstream");
const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
const depth = 50_000;
const failures: unknown[] = [];

function check(name: string, action: () => void): void {
  const before = performance.now();
  try { action(); console.log("PASS " + name); }
  catch (error) { failures.push(error); console.error(name + ": " + String(error)); }
  console.error(JSON.stringify({ test: name, duration_ms: performance.now() - before,
    memory: process.memoryUsage(), usage: process.resourceUsage() }));
}

check("deep applications", () => {
  let term: LTerm = Bend.Ref("leaf");
  for (let i = 0; i < depth; i++) term = Bend.App(term, Bend.Ref("argument"));
  let raised = Bend.term_higher(term), applications = 0;
  while (raised.$ === "App") {
    assert.equal(raised.x.$, "Ref"); assert.equal(raised.x.k, "argument");
    raised = raised.f; applications++;
  }
  assert.equal(applications, depth); assert.equal(raised.$, "Ref"); assert.equal(raised.k, "leaf");
});

check("deep constructors", () => {
  let term: LTerm = Bend.Ctr("Leaf", []);
  for (let i = 0; i < depth; i++) term = Bend.Ctr("Node", [term]);
  let raised = Bend.term_higher(term), nodes = 0;
  while (raised.$ === "Ctr" && raised.k === "Node") { raised = raised.x[0]; nodes++; }
  assert.equal(nodes, depth); assert.equal(raised.$, "Ctr"); assert.equal(raised.k, "Leaf");
});

check("deep let values", () => {
  let term: LTerm = Bend.Ref("leaf");
  for (let i = 0; i < depth; i++) term = Bend.Let(["x"], [0], [term], Bend.Var("x", 0));
  let raised = Bend.term_higher(term), lets = 0;
  const replacement: HTerm = Bend.Ref("replacement");
  while (raised.$ === "Let") {
    assert.strictEqual(raised.f([replacement]), replacement);
    raised = raised.v[0]; lets++;
  }
  assert.equal(lets, depth); assert.equal(raised.$, "Ref"); assert.equal(raised.k, "leaf");
});

check("binders, substitution and spans", () => {
  const span: Span = { src: "x", beg: 0, end: 1 };
  const a: HTerm = Bend.Lit(10), b: HTerm = Bend.Lit(20);
  const term: LTerm = Bend.Let(["a", "b"], [0, 1], [Bend.Ref("left"), Bend.Ref("right")],
    Bend.App(Bend.Lam("c", 2, Bend.Ctr("Tuple", [Bend.Var("a", 0), Bend.Var("b", 1), Bend.Var("c", 2)])), Bend.Lit(30)));
  const raised = Bend.term_higher(term); assert.equal(raised.$, "Let");
  const body = raised.f([a, b]); assert.equal(body.$, "Ctr");
  assert.strictEqual(body.x[0], a); assert.strictEqual(body.x[1], b); assert.deepEqual(body.x[2], Bend.Lit(30));
  const all = Bend.term_higher(Bend.All(Bend.Lone(), "a", 0, Bend.Ref("Domain"),
    Bend.Ctr("Tuple", [Bend.Var("a", 0), Bend.Var("free", 7)])));
  assert.equal(all.$, "All"); assert.deepEqual(all.A, Bend.Ref("Domain"));
  const bound = all.B(a); assert.equal(bound.$, "Ctr");
  assert.strictEqual(bound.x[0], a); assert.deepEqual(bound.x[1], Bend.Ref("free"));
  assert.deepEqual(Bend.term_higher(Bend.Sub(0, Bend.Ref("value"), Bend.Var("x", 0, span))), Bend.Ref("value", span));
  assert.deepEqual(Bend.term_higher(Bend.Sub(0, { $: "PCtr", k: "SNil", x: [] }, Bend.Var("x", 0, span))), Bend.Ctr("SNil", [], span));
  const cell: LTerm = Bend.Var("cell", -1, span, Bend.Ref("value"));
  assert.strictEqual(Bend.term_higher(cell), cell);
  const fallback: LTerm = Bend.Ref("fallback");
  assert.strictEqual(Bend.term_higher(Bend.Var("missing", 3, undefined, fallback)), fallback);
});

check("literal sharing across binder callbacks", () => {
  const span: Span = { src: '"x"', beg: 0, end: 3 };
  const literal = (s: Span): LTerm => Bend.Ctr("SCon", [Bend.Ctr("True", [], s), Bend.Ctr("SNil", [], s)], s);
  const term: LTerm = Bend.Ctr("Tuple", [literal(span),
    Bend.Lam("x", 0, literal(span)),
    Bend.All(Bend.Lone(), "x", 0, Bend.Ref("Domain"), literal(span)),
    Bend.Let([], [], [], literal(span)), literal({ ...span })]);
  const raised = Bend.term_higher(term); assert.equal(raised.$, "Ctr");
  const [first, lam, all, local, distinct] = raised.x;
  assert.equal(lam.$, "Lam"); assert.equal(all.$, "All"); assert.equal(local.$, "Let");
  assert.strictEqual(lam.f(Bend.Ref("unused")), first);
  assert.strictEqual(all.B(Bend.Ref("unused")), first);
  assert.strictEqual(local.f([]), first);
  assert.notStrictEqual(distinct, first);
  assert.notStrictEqual(Bend.term_higher(literal(span)), first);
});

if (failures.length) throw new AggregateError(failures, "Term raising failed");
