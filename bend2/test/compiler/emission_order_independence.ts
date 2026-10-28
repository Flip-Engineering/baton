import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-unit-order-"));
try {
  fs.cpSync(source, temporary, { recursive: true });
  let compiler = fs.readFileSync(path.join(source, "comp.ts"), "utf8");
  const carb = /^  const cb = carb_book\(book, \["main", \.\.\.RUNTIME_ADTS\](?:, writer)?\);$/m;
  assert.ok(carb.test(compiler));
  compiler = compiler.replace(carb, line => line + "\n  test_state.cb = cb;");
  const rounds = compiler.includes('Fact.solve<Unit>');
  if (rounds) {
    let facts = fs.readFileSync(path.join(source, "facts.ts"), "utf8");
    const next = "              const key = queue[cursor];";
    assert.ok(facts.includes(next));
    facts = facts.replace(next, "              test_reorder(queue, cursor);\n" + next);
    facts += `
      export const test_order = { mode: 0 };
      function test_reorder(queue: string[], from: number): void {
        if (test_order.mode === 0) return;
        const suffix = queue.slice(from);
        if (test_order.mode === 1) suffix.reverse();
        else {
          const key = (name: string) => [...name].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
          suffix.sort((a, b) => key(a) - key(b));
        }
        queue.splice(from, suffix.length, ...suffix);
      }
    `;
    fs.writeFileSync(path.join(temporary, "facts.ts"), facts);
    const solve = "  const solved = Fact.solve<Unit>({";
    assert.ok(compiler.includes(solve));
    compiler = compiler.replace(solve, "  Fact.test_order.mode = test_state.mode;\n" + solve);
  } else {
    const next = "      const fid = queue[i];";
    assert.ok(compiler.includes(next));
    compiler = compiler.replace(next, "      test_reorder(queue, i);\n" + next);
  }
  const diagnostic = 'export function diagnostic(event: string, details: Record<string, unknown> = {}): void {';
  assert.ok(compiler.includes(diagnostic));
  compiler = compiler.replace(diagnostic, diagnostic + `
    if (event === "unit.begin") test_state.units.push(String(details.name));
  `);
  compiler += `
    export const test_state = { cb: null as Carb | null,
      mode: 0, units: [] as string[] };
    function test_reorder(queue: string[], from: number): void {
      if (test_state.mode === 0) return;
      const suffix = queue.slice(from);
      if (test_state.mode === 1) suffix.reverse();
      else {
        const key = (name: string) => [...name].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
        suffix.sort((a, b) => key(a) - key(b));
      }
      queue.splice(from, suffix.length, ...suffix);
    }
  `;
  fs.writeFileSync(path.join(temporary, "comp.ts"), compiler);
  const Bend = await import(pathToFileURL(path.join(temporary, "bend.ts")).href);
  const Comp = await import(pathToFileURL(path.join(temporary, "comp.ts")).href);
  let changed_order = false;
  for (const name of ["emission_chain", "poly_spin_hot", "ref_bang_marked"]) {
    const load = async () => {
      const book = Bend.book_nil();
      await Bend.book_load(book, path.join(root, "bend2/test/compiler/fixtures", name + ".bend"), "", new Map());
      Bend.book_valid(book);
      return book;
    };
    Comp.test_state.mode = 0;
    Comp.compile_book(await load());
    const seed = Object.fromEntries(["own", "hot", "stat"].map(kind => [kind, [...Comp.test_state.cb[kind]]])) as
      Record<"own" | "hot" | "stat", string[]>;
    Comp.test_state.cb = null;
    const outputs: string[] = [], orders: string[] = [];
    for (const mode of [0, 1, 2]) {
      Comp.test_state.mode = mode;
      Comp.test_state.units = [];
      outputs.push(Comp.compile_book(await load()));
      orders.push(Comp.test_state.units.join(","));
      for (const kind of ["own", "hot", "stat"] as const) {
        assert.deepEqual(new Set(Comp.test_state.cb[kind]), new Set(seed[kind]), name + " cold facts");
      }
      Comp.test_state.cb = null;
    }
    changed_order ||= new Set(orders).size > 1;
    assert.ok(outputs[0] === outputs[1], name + " reversed unit order");
    assert.ok(outputs[0] === outputs[2], name + " shuffled unit order");
    console.log("PASS identical cold C for three orders: " + name);
  }
  assert.ok(changed_order, "the fixture executions used different unit orders");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
