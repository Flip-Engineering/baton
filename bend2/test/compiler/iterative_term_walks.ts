// Usage: bun bend2/test/compiler/iterative_term_walks.ts [COMPILER_DIR]
// Compare shallow terms with the retained recursive definitions and exercise
// deep constructor and let terms through the compiler's private traversal APIs.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

type Module = {
  term_const(t: Bend.HTerm): boolean;
  term_uses(cb: { book: Bend.Book }, t: Bend.HTerm): number[];
  term_any(cb: { book: Bend.Book }, t: Bend.HTerm,
    p: (t: Bend.HTerm, tail: boolean) => boolean): boolean;
  probe(k: string): Bend.HTerm;
  DUMMY: Bend.HTerm;
  test_reset(): void;
  test_state(): { consts: [string, boolean][]; uses: number };
};

// Recursive reference semantics, with the current unit cache lifetime.
const reference_const = `function term_const(t: HTerm): boolean {
  const s = term_strip(t);
  if (s.$ !== "Ctr") return false;
  if (CONSTANTS.has(s)) return true;
  const got = CONSTS.get(s);
  if (got !== undefined) return got;
  const value = s.x.every(term_const);
  if (value) CONSTANTS.add(s);
  CONSTS.set(s, value);
  return value;
}
`;
const reference_uses = `function term_uses(cb: Carb, tm: HTerm): UMap {
  const got = USES.get(tm);
  if (got !== undefined) return got;
  const t = term_force(tm);
  let out: UMap;
  switch (t.$) {
    case "Var": {
      const p = probe_of(t);
      out = p === DUMMY ? USE0 : [p.i, 1];
      break;
    }
    case "Mat": {
      out = use_union(term_uses(cb, t.h), term_uses(cb, t.m), Math.max);
      break;
    }
    default: {
      out = term_kids(cb, t).reduce((u, x) =>
        use_union(u, term_uses(cb, x), (a, b) => a + b), USE0);
    }
  }
  USES.set(tm, out);
  return out;
}
`;
const hooks = `
export { term_const, term_uses, term_any, probe, DUMMY };
export function test_reset(): void { memo_gc(); SIGS.clear(); }
export function test_state() {
  return { consts: [...CONSTS].map(([t, value]) => [(t as Of<"Ctr">).k, value]),
    uses: USES.size };
}
`;
function replace_function(source: string, name: string, next: string, body: string): string {
  const start = source.indexOf("function " + name + "(");
  const end = source.indexOf("function " + next + "(", start);
  assert.ok(start >= 0 && end > start);
  return source.slice(0, start) + body + "\n" + source.slice(end);
}

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source_dir = path.join(root, "bend2/compiler/upstream");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-iterative-term-walks-"));
try {
  for (const name of ["bend.ts", "base.bend"]) {
    fs.copyFileSync(path.join(source_dir, name), path.join(tmp, name));
  }
  const source = fs.readFileSync(path.join(source_dir, "comp.ts"), "utf8");
  let reference = replace_function(source, "term_const", "use_get", reference_const);
  reference = replace_function(reference, "term_uses", "rest_use", reference_uses);
  fs.writeFileSync(path.join(tmp, "iterative.ts"), source + hooks);
  fs.writeFileSync(path.join(tmp, "reference.ts"), reference + hooks);
  const iterative = await import(pathToFileURL(path.join(tmp, "iterative.ts")).href) as Module;
  const recursive = await import(pathToFileURL(path.join(tmp, "reference.ts")).href) as Module;
  const U32 = Bend.ADT("U32", []);
  const pair = (a: Bend.HTerm, b: Bend.HTerm): Bend.HTerm => Bend.Ctr("Pair", [a, b]);
  type Build = (m: Module, book: Bend.Book) => Bend.HTerm;
  const uses_cases: [string, Build, number[]][] = [
    ["probe", (m) => m.probe("x"), [1, 1]],
    ["dummy", (m) => m.DUMMY, []],
    ["shared", (m) => { const p = m.probe("x"); return pair(p, p); }, [1, 2]],
    ["distinct_names", (m) => pair(m.probe("x"), m.probe("x")), [1, 1, 2, 1]],
    ["lambda_shadow_outer", () => Bend.Lam("x", 0, (x) =>
      Bend.Lam("x", 0, () => x)), [1, 1]],
    ["lambda_shadow_inner", () => Bend.Lam("x", 0, () =>
      Bend.Lam("x", 0, (x) => x)), [2, 1]],
    ["let_shadow", () => Bend.Lam("x", 0, (outer) =>
      Bend.Let(["x"], [0], [pair(outer, outer)], ([inner]) => pair(inner, outer))),
      [1, 3, 2, 1]],
    ["dead_let", () => Bend.Lam("x", 0, (x) =>
      Bend.Let(["unused"], [0], [x], () => Bend.Rfl())), []],
    ["live_let", (m) => { const p = m.probe("x"); return Bend.Let(["x"], [0], [p],
      ([x]) => pair(x, x)); }, [1, 1, 2, 2]],
    ["parallel_let", (m) => { const p = m.probe("x");
      return Bend.Let(["x", "x"], [0, 1], [p, p], ([a, b]) => pair(a, b)); },
      [1, 2, 2, 1, 3, 1]],
    ["match_maximum", (m) => { const p = m.probe("x");
      return Bend.Mat("A", pair(p, pair(p, p)), pair(p, p)); }, [1, 3]],
    ["annotation_type", () => Bend.Lam("x", 0, (x) =>
      Bend.Ann(Bend.Rfl(), Bend.Eql(x, x, U32))), []],
    ["rewrite_body", (m) => { const p = m.probe("x");
      return Bend.Rwt(p, p, pair(p, p)); }, [1, 2]],
    ["cell", (m) => Bend.term_cell(Bend.Ann(m.probe("x"), U32)), [1, 1]],
    ["literal", () => Bend.Lit("a🙂"), []],
    ["erased_call_argument", (m, book) => {
      book.tlds.f = { $: "Def", n: 2, v: Bend.Rfl(), h: Bend.Rfl(), T:
        Bend.All(Bend.Many(), "x", 0, U32, () =>
          Bend.All(Bend.None(), "erased", 1, U32, () => U32)) } as Bend.Def;
      return Bend.App(Bend.App(Bend.Ref("f"), m.probe("x")), m.probe("erased"));
    }, [1, 1]],
    ["erased_constructor_field", (m, book) => {
      book.ctrs.Pair = { k: "Pair", n: 2, T:
        Bend.All(Bend.Many(), "x", 0, U32, () =>
          Bend.All(Bend.None(), "erased", 1, U32, () => U32)) } as Bend.Ctr;
      return pair(m.probe("x"), m.probe("erased"));
    }, [1, 1]],
  ];
  for (const [name, build, want] of uses_cases) {
    for (const m of [recursive, iterative]) {
      m.test_reset();
      const book = Bend.book_nil();
      const t = build(m, book);
      assert.deepEqual(m.term_uses({ book }, t), want, name);
      assert.deepEqual(m.term_uses({ book }, t), want, name + " repeated");
    }
  }
  console.log("PASS " + uses_cases.length + " use-map cases and repeated queries");

  const const_cases: [string, Build, boolean][] = [
    ["empty", () => Bend.Ctr("Zero", []), true],
    ["nested", () => pair(Bend.Ctr("Zero", []), Bend.Ctr("Zero", [])), true],
    ["probe", (m) => pair(m.probe("x"), Bend.Ctr("Zero", [])), false],
    ["annotation", () => Bend.Ann(Bend.Ctr("Zero", []), U32), true],
    ["short_circuit", () => pair(Bend.Ref("global"), Bend.Ctr("Skip", [])), false],
    ["small_nat", () => Bend.Lit(32), true],
    ["large_nat", () => Bend.Lit(257), false],
    ["string", () => Bend.Lit("a🙂"), true],
    ["shared", () => { const t = Bend.Ctr("Zero", []); return pair(t, t); }, true],
  ];
  for (const [name, build, want] of const_cases) {
    const results = [recursive, iterative].map((m) => {
      m.test_reset();
      const t = build(m, Bend.book_nil());
      assert.equal(m.term_const(t), want, name);
      const state = m.test_state();
      assert.equal(m.term_const(t), want, name + " repeated");
      assert.deepEqual(m.test_state(), state, name + " cache admission");
      return state;
    });
    assert.deepEqual(results[1], results[0], name);
  }
  console.log("PASS " + const_cases.length + " constructor cases and cache insertion order");

  const reference_outcome = (run: () => unknown, want: unknown): string => {
    try {
      assert.deepEqual(run(), want);
      return "completed";
    } catch (error) {
      if (error instanceof RangeError && /stack/i.test(error.message)) return "RangeError";
      throw error;
    }
  };
  const depth = 70000;
  iterative.test_reset();
  let nat: Bend.HTerm = Bend.Ctr("Zero", []);
  for (let i = 0; i < depth; i++) nat = Bend.Ctr("Succ", [nat]);
  recursive.test_reset();
  const const_reference = reference_outcome(() => recursive.term_const(nat), true);
  assert.equal(iterative.term_const(nat), true);
  assert.equal(iterative.test_state().consts.length, depth + 1,
    "every constructor in this unit remains memoized until the unit ends");
  console.log("PASS " + depth + " constructor levels with unit-owned memoization; reference="
    + const_reference);

  iterative.test_reset();
  const Nat = Bend.ADT("Nat", []);
  let nested: Bend.HTerm = Bend.Ann(Bend.Lit(0), Nat);
  for (let i = 0; i < depth; i++) {
    const body = nested;
    nested = Bend.Let(["x"], [0], [Bend.Ann(Bend.Lit(0), Nat)], () => body);
  }
  recursive.test_reset();
  const let_reference = reference_outcome(() =>
    recursive.term_any({ book: Bend.book_nil() }, nested, () => false), false);
  let visited = 0;
  assert.equal(iterative.term_any({ book: Bend.book_nil() }, nested,
    () => { visited++; return false; }), false);
  assert.equal(visited, depth + 2);
  assert.deepEqual(iterative.term_uses({ book: Bend.book_nil() }, nested), []);
  console.log("PASS " + depth + " let levels through term_any and term_uses; reference="
    + let_reference);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
