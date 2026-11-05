// Usage: bun bend2/test/compiler/arm_capture_storage.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = path.join(root, "bend2/compiler/upstream");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-capture-storage-"));
try {
  for (const name of ["bend.ts", "base.bend"]) {
    fs.copyFileSync(path.join(source, name), path.join(temporary, name));
  }
  fs.writeFileSync(path.join(temporary, "comp.ts"),
    fs.readFileSync(path.join(source, "comp.ts"), "utf8") + `
    export { capture_order, term_uses, term_spine, probe, memo_gc, use_get, use_union };
    export function test_single(i: number, n: number): UMap {
      return Array.isArray(USE0) ? [i, n] : use_node(i, n, null, null);
    }
    export function test_storage() {
      const maps = new Set<object>();
      const parts = new Set<object>();
      const arrays = new Set<object>();
      let uses = 0, captures = 0, spines = 0;
      const stack = [...USES.values()];
      while (stack.length > 0) {
        const u = stack.pop();
        if (u === null || maps.has(u)) continue;
        maps.add(u);
        if (Array.isArray(u)) uses += u.length;
        else { uses += 2; stack.push(u.l, u.r); }
      }
      if (typeof SUMS !== "undefined") {
        const todo = [...SUMS.values()].map(s => s.probes);
        while (todo.length > 0) {
          const p = todo.pop();
          if (!Array.isArray(p) || parts.has(p)) continue;
          parts.add(p); captures += p.length;
          for (const child of p) if (Array.isArray(child)) todo.push(child);
        }
      }
      const chains = new Set<object>();
      for (const s of SPINES.values()) {
        if (s.chain !== undefined) {
          for (let c = s.chain; c !== null && !chains.has(c); c = c.prev) {
            chains.add(c); spines += 2;
          }
        } else for (const a of [s.all, s.args]) {
          if (!arrays.has(a)) { arrays.add(a); spines += a.length; }
        }
      }
      return { uses, captures, spines,
        shape_bytes: typeof SHAPES === "undefined" ? null
          : [...SHAPES.keys()].reduce((n, k) => n + k.length, 0) };
    }
  `);
  const Bend = await import(pathToFileURL(path.join(temporary, "bend.ts")).href);
  const Comp = await import(pathToFileURL(path.join(temporary, "comp.ts")).href);
  // Overlapping keys, insertion orders, sparse indices and operand ordering.
  for (const fold of [(a: number, b: number) => a + b, Math.max,
    (a: number, b: number) => 10 * a + b]) {
    const entries = [0, 2 ** 40, 2, 7, 1, 99, 2 ** 32 + 1];
    let a = Comp.test_single(7, 2), b = Comp.test_single(0, 3);
    const wantA = new Map([[7, 2]]), wantB = new Map([[0, 3]]);
    for (let j = 0; j < 100; j++) {
      const i = entries[(j * 17 + 3) % entries.length], n = 1 + j % 5;
      const intoA = j % 3 === 0;
      const map = intoA ? wantA : wantB;
      map.set(i, map.has(i) ? fold(map.get(i)!, n) : n);
      if (intoA) a = Comp.use_union(a, Comp.test_single(i, n), fold);
      else b = Comp.use_union(b, Comp.test_single(i, n), fold);
    }
    const result = Comp.use_union(a, b, fold);
    for (const i of entries) {
      assert.equal(Comp.use_get(a, i), wantA.get(i) ?? 0, "left map stays immutable");
      assert.equal(Comp.use_get(b, i), wantB.get(i) ?? 0, "right map stays immutable");
      assert.equal(Comp.use_get(result, i), wantA.has(i) && wantB.has(i)
        ? fold(wantA.get(i)!, wantB.get(i)!) : wantA.get(i) ?? wantB.get(i) ?? 0);
    }
  }
  console.log("PASS use-map counts, sparse keys, immutability and fold order");
  Comp.memo_gc();
  const book = Bend.book_nil(), cf = { book };
  const word = Bend.ADT("U32", []);
  const type = Bend.All(Bend.None(), "erased", 0, word, () =>
    Bend.All(Bend.Many(), "value", 1, word, () => word));
  const f = Comp.probe("function"), erased = Comp.probe("erased");
  const value = Comp.probe("value"), extra = Comp.probe("extra");
  const head = Bend.Ann(f, type);
  const first = Bend.App(head, erased), second = Bend.App(first, value);
  const outer = Bend.Ann(second, word);
  assert.deepEqual(Comp.term_spine(cf, first).args, []);
  assert.equal(Comp.term_spine(cf, first).call, null);
  for (const term of [second, outer]) {
    const view = Comp.term_spine(cf, term);
    assert.equal(view.h, head);
    assert.equal(view.t, f);
    assert.deepEqual(view.all, [erased, value]);
    assert.deepEqual(view.args, [value]);
    assert.deepEqual(view.call.args, [first, value]);
    const uses = Comp.term_uses(cf, term);
    assert.equal(Comp.use_get(uses, f.i), 1);
    assert.equal(Comp.use_get(uses, erased.i), 0);
    assert.equal(Comp.use_get(uses, value.i), 1);
  }
  assert.deepEqual(Comp.term_spine(cf, Bend.App(outer, extra)).call.args, [outer, extra]);
  book.tlds.direct = { $: "Def", n: 2, x: 0, T: type, v: Bend.Rfl(), h: Bend.Rfl() };
  const direct = Bend.Ref("direct", undefined, true);
  assert.equal(Comp.term_spine(cf, Bend.App(direct, erased)).call, null);
  const saturated = Comp.term_spine(cf, Bend.App(Bend.App(direct, erased), value));
  assert.equal(saturated.call.k, "direct");
  assert.deepEqual(saturated.call.args, [value]);
  assert.deepEqual(saturated.call.all, [erased, value]);
  assert.equal(saturated.call.bang, true);
  console.log("PASS erased arguments, annotations, closures and saturated direct calls");
  for (const n of [2000, 4000]) {
    Comp.memo_gc();
    const probes = Array.from({ length: n }, (_, i) => Comp.probe("p" + i));
    let term = probes[0];
    for (let i = 1; i < n; i++) term = Bend.Mat("M", term, probes[i]);
    const binding = { val: { ws: ["x"], lay: { ks: ["box"], arms: null }, stat: false },
      n: 1, A: Bend.Ref("U32") };
    const fl = { book: Bend.book_nil(), uses: new Map(probes.map(p => [p, binding])) };
    const u = Comp.term_uses(fl, term);
    for (const p of probes) assert.equal(Comp.use_get(u, p.i), 1);
    assert.deepEqual(Comp.capture_order(fl, term, u).map(([p]) => p), probes,
      "skewed arms preserve first-use capture order");
    const storage = Comp.test_storage();
    console.log(JSON.stringify({ n, ...storage, memory: process.memoryUsage() }));
    assert.ok(storage.uses + storage.captures <= 8 * n * Math.ceil(Math.log2(n + 1)),
      "subtree summaries share retained storage: " + JSON.stringify(storage));
  }
  for (const n of [512, 1024]) {
    Comp.memo_gc();
    const probes = Array.from({ length: n + 1 }, (_, i) => Comp.probe("p" + i));
    const prefixes = [];
    let term = probes[0];
    for (let i = 1; i <= n; i++) {
      term = Bend.App(term, probes[i]);
      prefixes.push(term);
    }
    const binding = { val: { ws: ["x"], lay: { ks: ["box"], arms: null }, stat: false },
      n: 1, A: Bend.Ref("U32") };
    const fl = { book: Bend.book_nil(), uses: new Map(probes.map(p => [p, binding])) };
    for (let j = 0; j < n; j++) {
      const view = Comp.term_spine(fl, prefixes[j]);
      assert.equal(view.h, probes[0]);
      assert.deepEqual(view.args, probes.slice(1, j + 2));
      assert.deepEqual(view.all, probes.slice(1, j + 2));
    }
    const u = Comp.term_uses(fl, term);
    assert.deepEqual(Comp.capture_order(fl, term, u).map(([p]) => p), probes);
    const storage = Comp.test_storage();
    console.log(JSON.stringify({ application_prefixes: n, ...storage, memory: process.memoryUsage() }));
    assert.ok(storage.uses + storage.captures + storage.spines
      <= 8 * (n + 1) * Math.ceil(Math.log2(n + 2)),
      "application prefixes share retained storage: " + JSON.stringify(storage));
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
