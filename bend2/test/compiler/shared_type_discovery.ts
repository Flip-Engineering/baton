// Usage: bun bend2/test/compiler/shared_type_discovery.ts [COMPILER_DIR]
// Compare reachable-name order with the retained type walk and count repeated
// work on a checked book whose type arguments share their AST nodes.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

type Module = {
  type_adts(cb: { book: Bend.Book }, t: Bend.HTerm): string[];
  carb_book(book: Bend.Book, roots: string[]): unknown;
  test_reset(): void;
  test_state(): { normalizations: number; dequeues: number; sources: string[] };
};

// The definition at b9eb2d2b7, before shared type discovery.
const reference = `function type_adts(cb: Carb, T: HTerm): Bend.Name[] {
  const t = ty_wnf(cb.book, T);
  switch (t?.$) {
    case "All": return [...type_adts(cb, t.A), ...type_adts(cb, t.B(DUMMY))];
    case "Lam": return type_adts(cb, t.f(DUMMY));
    case "ADT": return [...WORDS[t.k] === undefined && t.k !== "Array"
      ? [t.k] : [], ...t.x.flatMap((x) => type_adts(cb, x))];
    default: return [];
  }
}
`;
const hooks = `
let test_normalizations = 0;
let test_dequeues = 0;
export { type_adts, carb_book };
export function test_reset() { test_normalizations = 0; test_dequeues = 0; }
export function test_state() {
  return { normalizations: test_normalizations, dequeues: test_dequeues,
    sources: [...SRCS.keys()] };
}
`;

const declarations = `type Leaf is Data:
  Leaf{}

type Phantom<-A: Type, -B: Type> is Data:
  Phantom{}

type Wrap<-A: Type> is Data:
  Wrap{}

def alias() -> Type:
  Leaf
`;
function book(): Bend.Book {
  const out = Bend.parse_book(Bend.book_nil(), "", declarations);
  Bend.book_valid(out);
  return out;
}
const leaf = (): Bend.HTerm => Bend.ADT("Leaf", []);
const wrap = (t: Bend.HTerm): Bend.HTerm => Bend.ADT("Wrap", [t]);
const pair = (a: Bend.HTerm, b: Bend.HTerm): Bend.HTerm =>
  Bend.ADT("Phantom", [a, b]);
function shared(depth: number): Bend.HTerm {
  let t = leaf();
  for (let i = 0; i < depth; ++i) t = pair(t, t);
  return t;
}

function replace_walk(source: string): string {
  const start = source.indexOf("function type_adts(");
  const end = source.indexOf("// V\n", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(0, start) + reference + "\n" + source.slice(end);
}
function instrument(source: string): string {
  const ty = "  return ty && Bend.term_wnf(book, ty);";
  const dequeue = "    const d = queue.shift() as Bend.Name;";
  assert.equal(source.split(ty).length, 2);
  assert.equal(source.split(dequeue).length, 2);
  return source.replace(ty, "  test_normalizations += 1;\n" + ty)
    .replace(dequeue, "    test_dequeues += 1;\n" + dequeue) + hooks;
}

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const upstream = path.join(root, "bend2/compiler/upstream");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-shared-type-discovery-"));
try {
  for (const name of ["bend.ts", "base.bend"]) {
    fs.copyFileSync(path.join(upstream, name), path.join(tmp, name));
  }
  const source = fs.readFileSync(path.join(upstream, "comp.ts"), "utf8");
  fs.writeFileSync(path.join(tmp, "current.ts"), instrument(source));
  fs.writeFileSync(path.join(tmp, "reference.ts"), instrument(replace_walk(source)));
  const current = await import(pathToFileURL(path.join(tmp, "current.ts")).href) as Module;
  const retained = await import(pathToFileURL(path.join(tmp, "reference.ts")).href) as Module;
  type Build = () => Bend.HTerm;
  const cases: [string, Build, string[]][] = [
    ["leaf", leaf, ["Leaf"]],
    ["ordered_arguments", () => pair(wrap(leaf()), leaf()), ["Phantom", "Wrap", "Leaf"]],
    ["shared_arguments", () => { const t = wrap(leaf()); return pair(t, t); },
      ["Phantom", "Wrap", "Leaf"]],
    ["equal_distinct_arguments", () => pair(wrap(leaf()), wrap(leaf())),
      ["Phantom", "Wrap", "Leaf"]],
    ["all_domain_before_body", () => Bend.All(Bend.Many(), "x", 0,
      wrap(leaf()), () => pair(leaf(), leaf())), ["Wrap", "Leaf", "Phantom"]],
    ["nested_shadowing", () => Bend.All(Bend.None(), "A", 0,
      Bend.Typ(Bend.Qua(Bend.Lone())), (outer) =>
        Bend.All(Bend.None(), "A", 1, Bend.Typ(Bend.Qua(Bend.Lone())),
          (inner) => pair(wrap(outer), inner))), ["Phantom", "Wrap"]],
    ["lambda", () => Bend.Lam("A", 0, (a) => pair(wrap(a), leaf())),
      ["Phantom", "Wrap", "Leaf"]],
    ["annotation", () => Bend.Ann(wrap(leaf()), Bend.Typ(Bend.Qua(Bend.Lone()))),
      ["Wrap", "Leaf"]],
    ["alias", () => pair(Bend.Ref("alias"), Bend.Ref("alias")), ["Phantom", "Leaf"]],
    ["shared_cell", () => { const t = Bend.term_cell(wrap(leaf())); return pair(t, t); },
      ["Phantom", "Wrap", "Leaf"]],
    ["word", () => Bend.ADT("Nat", []), []],
    ["array_arguments", () => Bend.ADT("Array", [wrap(leaf())]), ["Wrap", "Leaf"]],
  ];
  for (const [name, build, expected] of cases) {
    const old = retained.type_adts({ book: book() }, build());
    const got = current.type_adts({ book: book() }, build());
    assert.deepEqual([...new Set(old)], expected, name + " reference");
    assert.deepEqual(got, expected, name + " current");
  }
  console.log(`PASS ${cases.length} ordered name cases against the retained walk`);

  // The body of an All is opened after its complete domain walk.
  for (const m of [current, retained]) {
    const order: string[] = [];
    const t = Bend.All(Bend.Many(), "x", 0,
      Bend.All(Bend.Many(), "a", 0, leaf(), () => {
        order.push("domain"); return leaf();
      }), () => { order.push("body"); return leaf(); });
    m.type_adts({ book: book() }, t);
    assert.deepEqual(order, ["domain", "body"]);
  }
  console.log("PASS domain-before-body opening order");

  const depth = 14;
  const t = shared(depth);
  const checked = book();
  checked.tlds.entry = { $: "Def", n: 0, x: 0, T: t, v: Bend.Ctr("Phantom", []) };
  checked.order.push("entry");
  Bend.book_valid(checked);
  Bend.term_check_kind(checked, { def: "audit" }, t, Bend.Many(), Bend.ctx_nil(), 0);
  retained.test_reset();
  const old = retained.type_adts({ book: checked }, t);
  const old_state = retained.test_state();
  current.test_reset();
  assert.deepEqual(current.type_adts({ book: checked }, t), ["Phantom", "Leaf"]);
  const current_state = current.test_state();
  assert.equal(old.length, 2 ** (depth + 1) - 1);
  assert.equal(old_state.normalizations, old.length);
  assert.equal(current_state.normalizations, depth + 1);
  console.log(`PASS checked ${depth + 1}-node type: names ${old.length} -> 2; `
    + `normalizations ${old_state.normalizations} -> ${current_state.normalizations}`);

  const orders: string[][] = [];
  const dequeues: number[] = [];
  for (const m of [retained, current]) {
    const b = book();
    b.tlds.entry = { $: "Def", n: 0, x: 0, T: shared(depth), v: Bend.Ctr("Phantom", []) };
    b.order.push("entry");
    Bend.book_valid(b);
    m.test_reset();
    m.carb_book(b, ["entry"]);
    const state = m.test_state();
    orders.push(state.sources);
    dequeues.push(state.dequeues);
  }
  assert.deepEqual(orders[0], ["entry", "Phantom", "Leaf"]);
  assert.deepEqual(orders[1], orders[0]);
  assert.ok(dequeues[0] >= 2 ** (depth + 1));
  assert.ok(dequeues[1] <= 8);
  console.log(`PASS CARB source order; dequeues ${dequeues[0]} -> ${dequeues[1]}`);

  // This valid construction adds one shared node per level. The retained
  // traversal would expand over half a billion occurrences at this depth.
  current.test_reset();
  assert.deepEqual(current.type_adts({ book: checked }, shared(28)), ["Phantom", "Leaf"]);
  assert.equal(current.test_state().normalizations, 29);
  console.log("PASS 29-node shared type with 29 normalizations");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
