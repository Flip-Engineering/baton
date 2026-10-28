// Usage: bun bend2/test/compiler/store_term_graph.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const directory = path.join(root, "bend2/compiler/upstream");
const Bend = await import(pathToFileURL(path.join(directory, "bend.ts")).href);
const Store = await import(pathToFileURL(path.join(directory, "store.ts")).href);
function copy<T>(term: T): T {
  const tables = new Store.EncoderTables();
  const graph = Store.encode_term(term, tables);
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

const literal = Bend.Ctr("WNil", [], span);
const nested = Bend.term_higher(Bend.Lam("x", 0, Bend.Lam("y", 1, literal)));
const nested_copy = copy(nested);
assert.equal(nested.f(a).f(a), nested.f(b).f(b));
assert.equal(nested_copy.f(a).f(a), nested_copy.f(b).f(b),
  "closed literal sharing survives nested callback instances");
console.log("PASS checked cells, free variables, binder scopes, spans and literal identity");

const book = Bend.book_nil();
await Bend.book_load(book, path.join(root, "bend2/test/compiler/fixtures/poly_spin_hot.bend"), "", new Map());
Bend.book_valid(book);
const tables = new Store.EncoderTables();
const sections = Object.entries(book.tlds).flatMap(([name, def]) =>
  def.e === undefined ? [] : [{ name, def, graph: Store.encode_term(def.e, tables) }]);
const reader = new Store.DecoderTables(JSON.parse(JSON.stringify(tables.data)));
for (const { name, def, graph } of sections) {
  const raw = Store.decode_term(JSON.parse(JSON.stringify(graph)), reader);
  assert.deepEqual(Bend.term_lower_shared(Bend.term_higher(raw)),
    Bend.term_lower_shared(Bend.term_higher(def.e)), name + " checked term round trip");
}
console.log("PASS checked term round trip for " + sections.length + " definitions");
