// Usage: bun bend2/test/compiler/constant_memo_lifetime.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { HTerm } from "../../compiler/upstream/bend.ts";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-constant-memo-"));
try {
  fs.cpSync(source, directory, { recursive: true });
  const compiler = path.join(directory, "comp.ts");
  fs.appendFileSync(compiler, "\nexport { term_const, memo_gc };\n");
  const Comp = await import(pathToFileURL(compiler).href) as {
    term_const(t: HTerm): boolean; memo_gc(): void;
  };
  const Bend = await import(pathToFileURL(path.join(directory, "bend.ts")).href);
  const Store = await import(pathToFileURL(path.join(directory, "store.ts")).href);
  const cell = Bend.term_cell(Bend.Ref("dynamic"));
  const changing = Bend.Ctr("Payload", [cell]);
  const encoded = () => {
    const tables = new Store.EncoderTables(), graph = Store.encode_term(changing, tables);
    return JSON.stringify({ graph, tables: tables.data });
  };
  const before = encoded();
  assert.equal(Comp.term_const(changing), false);
  assert.equal(encoded(), before, "classification preserves the checked term transport");
  const rewritten = { ...changing, x: [Bend.Ctr("Value", [])] };
  assert.equal(Comp.term_const(rewritten), true, "a copied term classifies its current children");
  cell.v = Bend.Ctr("Value", []);
  Comp.memo_gc();
  assert.equal(Comp.term_const(changing), true, "a new unit observes normalized cells");
  const weak = [true, false].map(constant => {
    const term = Bend.Ctr("Payload", [constant ? Bend.Ctr("Value", []) : Bend.Ref("dynamic")]);
    assert.equal(Comp.term_const(term), constant);
    assert.equal(Comp.term_const(term), constant, "a live term keeps its classification");
    return { constant, reference: new WeakRef(term) };
  });
  // WeakRef keeps targets alive until the current JavaScript job ends.
  await new Promise<void>(resolve => setImmediate(resolve));
  Bun.gc(true);
  for (const { constant, reference } of weak) {
    assert.equal(reference.deref(), undefined,
      "the constant classifier releases an unused " + (constant ? "constant" : "dynamic") + " term");
  }
  console.log("PASS constant classification, cell normalization, transport and unused-term release");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
