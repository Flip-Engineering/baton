// Usage: bun bend2/test/compiler/layout_key_dag.ts [REPOSITORY_ROOT]
// Check exact LAYS key equality and linear traversal on shared type DAGs.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

type KeyModule = {
  test_lay_key(term: Bend.HTerm): number;
  test_lay_key_nodes(): number;
  test_reset_lay_keys(): void;
  TestBend: typeof Bend;
};

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = path.join(root, "bend2/compiler/upstream");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-layout-key-dag-"));
try {
  for (const name of fs.readdirSync(source).filter(name =>
    name.endsWith(".ts") || name === "base.bend")) {
    fs.copyFileSync(path.join(source, name), path.join(temp, name));
  }
  const compiler = fs.readFileSync(path.join(source, "comp.ts"), "utf8");
  fs.writeFileSync(path.join(temp, "comp.test.ts"), compiler + `
export { Bend as TestBend };
export function test_lay_key(term: HTerm): number { return lay_key(term); }
export function test_lay_key_nodes(): number { return LAY_KEY_NODES.size; }
export function test_reset_lay_keys(): void { LAY_KEY_NODES.clear(); LAY_KEY_NEXT = 0; }
`);
  const mod = await import(pathToFileURL(path.join(temp, "comp.test.ts")).href) as KeyModule;
  const old_key = (term: Bend.HTerm): string => Bend.term_key(Bend.term_lower(term));
  const compact_key = (term: Bend.HTerm): number => mod.test_lay_key(term);
  const make_dag = (depth: number, leaf = "Leaf"): Bend.HTerm => {
    let term = Bend.ADT(leaf, []);
    for (let i = 0; i < depth; i++) {
      term = Bend.ADT("Phantom", [term, term]);
    }
    return term;
  };
  const copy_tree = (term: Bend.HTerm): Bend.HTerm => {
    assert.equal(term.$, "ADT");
    return Bend.ADT(term.k, term.x.map(copy_tree), term.s, term.r);
  };

  const dag = make_dag(14);
  const tree = copy_tree(dag);
  const lowered_dag = mod.TestBend.term_lower_shared(dag);
  assert.equal(lowered_dag.$, "ADT");
  assert.strictEqual(lowered_dag.x[0], lowered_dag.x[1]);
  assert.equal(old_key(dag), old_key(tree));
  const dag_key = compact_key(dag);
  const dag_nodes = mod.test_lay_key_nodes();
  assert.equal(dag_nodes, 30);
  assert.equal(compact_key(tree), dag_key);
  assert.equal(mod.test_lay_key_nodes(), dag_nodes);

  const leaf = Bend.ADT("Leaf", []);
  const other_leaf = Bend.ADT("OtherLeaf", []);
  const with_span_a = Bend.ADT("Phantom", [leaf], { src: "a", beg: 1, end: 2 });
  const with_span_b = Bend.ADT("Phantom", [leaf], { src: "b", beg: 8, end: 9 });
  const missing_q = Bend.Lam("x", 0, (x: Bend.HTerm) => Bend.Var("x", 0)) as
    Bend.HTerm & { q?: Bend.Quant };
  delete missing_q.q;
  const binder = Bend.Lam("z", 0, (z: Bend.HTerm) => z);
  const at_two_depths = Bend.ADT("Phantom", [binder,
    Bend.Lam("outer", 0, () => Bend.ADT("Inner", [binder]))]);
  const terms = [
    Bend.ADT("Phantom", [leaf, leaf]),
    Bend.ADT("Phantom", [leaf, other_leaf]),
    Bend.ADT("Phantom", [other_leaf, leaf]),
    with_span_a,
    with_span_b,
    Bend.ADT("Phantom", [Bend.Lam("x", 0, (x: Bend.HTerm) => Bend.Var("x", 0))]),
    Bend.ADT("Phantom", [Bend.Lam("y", 0, (y: Bend.HTerm) => Bend.Var("y", 0))]),
    Bend.ADT("Phantom", [Bend.Var("v", 0)]),
    Bend.ADT("Phantom", [Bend.Var("v", 1)]),
    Bend.ADT("Phantom", [Bend.Lam("x", 0,
      (x: Bend.HTerm) => Bend.Var("x", 0), undefined, undefined)]),
    Bend.ADT("Phantom", [missing_q]),
    at_two_depths,
  ];
  const old_keys = terms.map(old_key);
  const compact_keys = terms.map(compact_key);
  for (let i = 0; i < terms.length; i++) {
    assert.equal(Bend.term_key(mod.TestBend.term_lower_shared(terms[i])), old_keys[i],
      `shared lowering changed old key ${i}`);
    for (let j = 0; j < terms.length; j++) {
      assert.equal(compact_keys[i] === compact_keys[j], old_keys[i] === old_keys[j],
        `old-key equality differs for pair ${i},${j}`);
    }
  }

  const pattern = { $: "PVar", k: "pat", i: 0, q: Bend.Lone() } as Bend.PVar;
  const all_forms = Bend.ADT("Forms", [
    Bend.Var("v", 0),
    Bend.Ref("R"),
    Bend.Sub(0, Bend.Var("v", 0), Bend.Var("v", 1)),
    Bend.Sub(0, pattern, Bend.Var("v", 1)),
    Bend.Let(["x"], [0], [Bend.Var("v", 0)], ([x]) => Bend.Ann(x, Bend.Ref("T"))),
    Bend.Typ(Bend.Var("v", 0)),
    Bend.Qnt(),
    Bend.Qua(Bend.Lone()),
    Bend.Min(Bend.Var("v", 0), Bend.Var("v", 1)),
    Bend.All(Bend.Lone(), "x", 0, Bend.Ref("A"), (x) => Bend.Ann(x, Bend.Ref("T"))),
    Bend.Lam("x", 0, (x) => Bend.Ann(x, Bend.Ref("T"))),
    Bend.App(Bend.Ref("f"), Bend.Var("v", 0)),
    Bend.ADT("A", [Bend.Ref("T")]),
    Bend.Ctr("C", [Bend.Var("v", 0)]),
    Bend.Lit("text"),
    Bend.Mat("m", Bend.Var("v", 0), Bend.Var("v", 1)),
    Bend.Efq(),
    Bend.Eql(Bend.Var("v", 0), Bend.Var("v", 1), Bend.Ref("T")),
    Bend.Rfl(),
    Bend.Rwt(Bend.Var("v", 0), Bend.Var("v", 1), Bend.Var("v", 2)),
    Bend.Hol("hole"),
    Bend.Ann(Bend.Var("v", 0), Bend.Ref("T")),
  ]);
  assert.equal(Bend.term_key(mod.TestBend.term_lower_shared(all_forms)), old_key(all_forms),
    "shared lowering changed a term constructor's old JSON key");

  const lowering_order = (lower: (term: Bend.HTerm) => Bend.LTerm): string[] => {
    const order: string[] = [];
    const all = Bend.All(Bend.Lone(), "a", 0,
      Bend.Lam("domain", 0, (x: Bend.HTerm) => {
        order.push("domain body");
        return x;
      }),
      (x: Bend.HTerm) => {
        order.push("All body");
        return x;
      });
    lower(all);
    const let_term = Bend.Let(["x"], [0], [Bend.Lam("value", 0, (x: Bend.HTerm) => {
      order.push("Let value");
      return x;
    })], ([x]) => {
      order.push("Let body");
      return x;
    });
    lower(let_term);
    return order;
  };
  assert.deepEqual(lowering_order(Bend.term_lower),
    lowering_order(mod.TestBend.term_lower_shared));
  assert.deepEqual(lowering_order(Bend.term_lower),
    ["domain body", "All body", "Let value", "Let body"]);

  mod.test_reset_lay_keys();
  const deep = make_dag(20_000);
  const deep_lowered = mod.TestBend.term_lower_shared(deep);
  assert.equal(deep_lowered.$, "ADT");
  mod.test_lay_key(deep);
  assert.equal(mod.test_lay_key_nodes(), 40_002);
  console.log("PASS layout key equality, binder order, shared DAG identity, and depth-20000 traversal");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
