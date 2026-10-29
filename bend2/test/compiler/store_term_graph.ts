// Usage: bun bend2/test/compiler/store_term_graph.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const directory = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const Bend = await import(pathToFileURL(path.join(directory, "bend.ts")).href);
const Store = await import(pathToFileURL(path.join(directory, "store.ts")).href);
function copy<T>(term: T, share = true): T {
  const tables = new Store.EncoderTables();
  const encoded = Store.encode_term(term, tables);
  const graph = share ? Store.share_rows(encoded) : encoded;
  return Store.decode_term(JSON.parse(JSON.stringify(graph)),
    new Store.DecoderTables(JSON.parse(JSON.stringify(tables.data))));
}
const span = { src: "source", beg: 0, end: 6 };
const free = Bend.Var("T", 734123, span);
const cell = Bend.term_cell(free);
const raw = Bend.Ann(Bend.Var("x", 0, span), cell, span);
const decoded = copy(Bend.Lam("x", 0, raw, span));
const h = Bend.term_higher(decoded);
assert.equal(Bend.term_force(h.f(Bend.Ref("value")).T).$, "Var");
assert.equal(Bend.term_force(h.f(Bend.Ref("value")).T).i, free.i);
assert.equal(decoded.s, decoded.f.s);
assert.equal(decoded.f.s, decoded.f.x.s);

const shared = copy(Bend.Ctr("Pair", [cell, cell], span));
assert.equal(shared.x[0], shared.x[1], "cell identity survives the section transport");
shared.x[0].i = -2;
assert.equal(shared.x[1].i, -2);
assert.equal(cell.i, -1, "decoded mutations do not affect the front-end body");

const shadow = copy(Bend.Lam("x", 0, x =>
  Bend.Lam("x", 0, y => Bend.Ctr("Pair", [x, y]))));
const a = Bend.Ref("a"), b = Bend.Ref("b");
assert.deepEqual(shadow.f(a).f(b).x, [a, b], "shadowed binder indices retain their scopes");

const fresh = copy(Bend.Lam("x", 0, x => Bend.term_cell(x)));
const ca = fresh.f(a), cb = fresh.f(b);
assert.notEqual(ca, cb, "each callback invocation has fresh dependent cells");
assert.equal(ca.v, a);
assert.equal(cb.v, b);

const captured = copy(Bend.Lam("x", 0, () => Bend.Ctr("Pair", [cell, cell])));
assert.equal(captured.f(a).x[0], captured.f(b).x[0], "captured cells remain shared");

const holder = Bend.Ctr("Holder", [cell]);
const delayed = copy(Bend.Ctr("Pair", [cell, Bend.Lam("x", 0, () => holder)]));
assert.equal(delayed.x[0], delayed.x[1].f(a).x[0],
  "a delayed captured container retains aliases to earlier decoded cells");
assert.equal(delayed.x[1].f(a), delayed.x[1].f(b),
  "a captured container keeps its identity across callback invocations");

const literal = Bend.Ctr("WNil", [], span);
const nested = Bend.term_higher(Bend.Lam("x", 0, Bend.Lam("y", 1, literal)));
const nested_copy = copy(nested);
assert.equal(nested.f(a).f(a), nested.f(b).f(b));
assert.equal(nested_copy.f(a).f(a), nested_copy.f(b).f(b),
  "closed literal sharing survives nested callback instances");
console.log("PASS checked cells, free variables, binder scopes, spans and literal identity");

// Equal subterms become one row; terms that differ in a field, a span or an owner scope do not.
const equal = copy(Bend.Ctr("Pair", [Bend.Ctr("W", [Bend.Ctr("N", [], span)], span), Bend.Ctr("W", [Bend.Ctr("N", [], span)], span)], span));
assert.equal(equal.x[0], equal.x[1], "equal subterms share one decoded object");
const other_span = { src: "source", beg: 1, end: 6 };
const apart = copy(Bend.Ctr("Pair", [Bend.Ctr("N", [], span), Bend.Ctr("N", [], other_span)], span));
assert.notEqual(apart.x[0], apart.x[1], "equal subterms with different spans stay apart");
const twin = copy(Bend.Ctr("Pair", [Bend.term_cell(free), Bend.term_cell(free)], span));
assert.equal(twin.x[0], twin.x[1], "equal checker cells share one thunk");
assert.equal(Bend.term_force(twin.x[1]).i, free.i);
const solved = copy(Bend.Ctr("Pair", [Bend.term_cell(Bend.Ref("a", span)), Bend.term_cell(Bend.Ref("b", span))], span));
assert.notEqual(solved.x[0], solved.x[1], "cells with different contents stay apart");
const scoped = copy(Bend.Lam("x", 0, x => Bend.Ctr("Pair", [Bend.Ctr("N", [], span), Bend.Ctr("N", [], span)], span)));
const instance = scoped.f(a);
assert.equal(instance.x[0], instance.x[1], "equal subterms inside a callback share within an instance");
const tables_count = new Store.EncoderTables();
const duplicated = Bend.Ctr("Pair", Array.from({ length: 50 }, () => Bend.Ctr("W", [Bend.Ctr("N", [], span)], span)), span);
const plain = Store.encode_term(duplicated, tables_count), merged = Store.share_rows(plain);
assert.equal(plain.rows.length, 202);
assert.equal(merged.rows.length, 6, "fifty equal subtrees become one");
console.log("PASS row sharing keeps different contents, spans and scopes apart");

// A cycle is stored as it was.
const cyclic = { root: { node: 0 }, rows: [[0, 0, 0, 4, 0]], scopes: [-1] };
assert.equal(Store.share_rows(cyclic), cyclic, "a graph with a cycle is returned unchanged");
// The merged graph is the same whether equal subterms were one object or several.
const leaf = Bend.Ctr("W", [Bend.Ctr("N", [], span)], span);
const one_object = Store.share_rows(Store.encode_term(Bend.Ctr("Pair", [leaf, leaf], span), tables_count));
const two_objects = Store.share_rows(Store.encode_term(Bend.Ctr("Pair", [Bend.Ctr("W", [Bend.Ctr("N", [], span)], span),
  Bend.Ctr("W", [Bend.Ctr("N", [], span)], span)], span), tables_count));
assert.deepEqual(one_object.rows, two_objects.rows, "equal subterms give the same stored rows however they were built");
// A subterm that a callback returns unchanged and that is also used outside it is one decoded object.
// A subterm the callback builds anew on each call belongs to the callback instance and stays apart.
const captured_leaf = Bend.Ctr("W", [Bend.Ctr("N", [], span)], span);
const mixed = copy(Bend.Ctr("Pair", [captured_leaf, Bend.Lam("x", 0, () => captured_leaf, span)], span));
assert.equal(mixed.x[0], mixed.x[1].f(a), "a captured subterm outside and inside a callback decodes to one object");
const rebuilt = copy(Bend.Ctr("Pair", [Bend.Ctr("W", [], span), Bend.Lam("x", 0, () => Bend.Ctr("W", [], span), span)], span));
assert.notEqual(rebuilt.x[0], rebuilt.x[1].f(a), "a subterm built anew by each callback call stays in its instance");
console.log("PASS cycle fallback, canonical rows and callback instances");

const evaluation_book = Bend.book_nil();
const identity = () => Bend.Lam("z", 0, z => z, span);
const redex = (value = Bend.Ctr("Answer", [], span)) => Bend.App(identity(), value, span);
const beta_pair = Bend.Ctr("Pair", [Bend.term_cell(redex()), Bend.term_cell(redex())], span);
const beta_shared = copy(beta_pair), beta_separate = copy(beta_pair, false);
assert.equal(beta_shared.x[0], beta_shared.x[1], "equal beta-redex cells share a decoded thunk");
assert.notEqual(beta_separate.x[0], beta_separate.x[1]);
for (let i = 0; i < 2; i++) {
  assert.deepEqual(Bend.term_wnf(evaluation_book, beta_shared.x[i]),
    Bend.term_wnf(evaluation_book, beta_separate.x[i]), "shared beta reduction preserves the value");
}
assert.equal(beta_shared.x[0].i, -2, "evaluation memoizes the shared cell");
assert.equal(beta_pair.x[0].i, -1, "decoded evaluation leaves the source cell unchanged");

const dependent = copy(Bend.Lam("x", 0, x =>
  Bend.Ctr("Pair", [Bend.term_cell(redex(x)), Bend.term_cell(redex(x))], span), span));
const dependent_a = dependent.f(a), dependent_b = dependent.f(b);
assert.equal(dependent_a.x[0], dependent_a.x[1], "equal dependent cells share within a callback invocation");
assert.notEqual(dependent_a.x[0], dependent_b.x[0], "callback invocations retain separate evaluation cells");
assert.equal(Bend.term_wnf(evaluation_book, dependent_a.x[0]).k, "a");
assert.equal(dependent_b.x[0].i, -1, "evaluating one invocation leaves the other invocation unevaluated");
assert.equal(Bend.term_wnf(evaluation_book, dependent_b.x[1]).k, "b");

const outer_capture = copy(Bend.Lam("x", 0, x => {
  const outer_cell = Bend.term_cell(redex(x));
  return Bend.Ctr("Pair", [outer_cell, Bend.Lam("y", 1, () => outer_cell, span)], span);
}, span));
const outer_a = outer_capture.f(a), outer_b = outer_capture.f(b);
assert.equal(outer_a.x[0], outer_a.x[1].f(b), "nested callbacks retain the outer invocation's cell");
assert.notEqual(outer_a.x[0], outer_b.x[1].f(a), "outer invocations retain their own captured cells");
assert.equal(Bend.term_wnf(evaluation_book, outer_a.x[1].f(b)).k, "a");
assert.equal(Bend.term_wnf(evaluation_book, outer_b.x[1].f(a)).k, "b");

const annotation_type = Bend.Ref("AnswerType", span);
const annotated_pair = copy(Bend.Ctr("Pair", [
  Bend.term_cell(Bend.Ann(redex(), annotation_type, span)),
  Bend.term_cell(Bend.Ann(redex(), annotation_type, span))
], span));
assert.equal(annotated_pair.x[0], annotated_pair.x[1]);
assert.equal(Bend.term_wnf(evaluation_book, annotated_pair.x[0]).k, "Answer");
assert.equal(annotated_pair.x[1].v.$, "Ann", "memoized reduction retains the annotation");
assert.equal(Bend.term_force(annotated_pair.x[1].v.T).k, "AnswerType", "memoized reduction retains its type");

const fields_apart = copy(Bend.Ctr("Cells", [
  Bend.Var("first", -1, span, redex()), Bend.Var("second", -1, span, redex()),
  Bend.Var("first", -2, span, redex()), Bend.Var("first", -1, other_span, redex()),
  Bend.Var("first", -1, span, redex(Bend.Ctr("Other", [], span)))
], span));
assert.equal(new Set(fields_apart.x).size, fields_apart.x.length,
  "cells with different names, indices, spans or values retain separate rows");
console.log("PASS shared cell evaluation, callback isolation, captured cells and annotations");

const book = Bend.book_nil();
await Bend.book_load(book, path.join(root, "bend2/test/compiler/fixtures/poly_spin_hot.bend"), "", new Map());
Bend.book_valid(book);
const tables = new Store.EncoderTables();
const sections = Object.entries(book.tlds).flatMap(([name, def]) =>
  def.e === undefined ? [] : [{ name, def, graph: Store.share_rows(Store.encode_term(def.e, tables)) }]);
const reader = new Store.DecoderTables(JSON.parse(JSON.stringify(tables.data)));
for (const { name, def, graph } of sections) {
  const raw = Store.decode_term(JSON.parse(JSON.stringify(graph)), reader);
  assert.deepEqual(Bend.term_lower_shared(Bend.term_higher(raw)),
    Bend.term_lower_shared(Bend.term_higher(def.e)), name + " checked term round trip");
}
console.log("PASS checked term round trip for " + sections.length + " definitions");
