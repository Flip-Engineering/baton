// Usage: bun store_sections.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const Bend = await import(pathToFileURL(path.join(source, "bend.ts")).href);
const Store = await import(pathToFileURL(path.join(source, "store.ts")).href);
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-store-sections-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });

const tables = new Store.EncoderTables(), encoded = new WeakMap<object, { section: string; node: number }>();
const graphs = new Map<string, any>();
function write(section: string, value: any): void {
  const graph = Store.encode_term(value, tables, {
    find: (value: object) => encoded.get(value),
    define: (node: number, value: object) => encoded.set(value, { section, node }),
  });
  graphs.set(section, graph); fs.writeFileSync(path.join(directory, section + ".json"), JSON.stringify(graph));
}

const cell = Bend.Var("cell", -1, undefined, Bend.Ctr("Zero", []));
const span = { src: "shared span", beg: 0, end: 4 };
const factory = Bend.Lam("x", 0, (x: any) => Bend.Ctr("Pair", [cell, Bend.term_cell(x)], span));
write("header", { cell, factory, span });
write("body", Bend.Lam("y", 0, factory.f));
const decoded = new Map<string, WeakRef<object>>(), decodeTables = new Store.DecoderTables(tables.data);
const key = (section: string, node: number) => JSON.stringify([section, node]);
function read(section: string, node?: number): any {
  const graph = graphs.get(section);
  return Store.decode_term(graph, decodeTables, {
    resolve: (reference: any) => decoded.get(key(reference.section, reference.node))?.deref()
      ?? read(reference.section, reference.node),
    find: (node: number) => decoded.get(key(section, node))?.deref(),
    define: (node: number, value: object) => decoded.set(key(section, node), new WeakRef(value)),
  }, node === undefined ? graph.root : { node });
}

try {
  // Read a body first to exercise a shared root fetched before its full header.
  const body = read("body"), header = read("header");
  assert.equal(body.f, header.factory.f, "a callback keeps its cross-section identity");
  const a = Bend.Var("a", 7, span), b = Bend.Var("b", 8, span);
  const first = body.f(a), second = body.f(b);
  assert.equal(first.x[0], header.cell); assert.equal(second.x[0], header.cell);
  assert.notEqual(first.x[1], second.x[1], "a callback allocates its own cells");
  assert.equal(Bend.term_force(first.x[1]), a); assert.equal(Bend.term_force(second.x[1]), b);
  assert.equal(first.s, header.span); assert.equal(second.s, header.span);
  header.cell.v = Bend.Ctr("Changed", []);
  assert.equal(Bend.term_force(first.x[0]).k, "Changed");
  assert.equal(Bend.term_force(second.x[0]).k, "Changed");
  const Module = await import(pathToFileURL(path.join(source, "module-store.ts")).href);
  const writer = new Module.ModuleWriter("section-fixture", directory);
  try {
    writer.write("header", { cell, factory, span });
    writer.write("body", Bend.Lam("y", 0, factory.f));
    writer.seal({ source: "fixture" });
    const reader = new Module.ModuleReader(writer.directory, "section-fixture");
    const storedBody: any = reader.read("body"), storedHeader: any = reader.read("header");
    assert.equal(storedBody.f, storedHeader.factory.f);
    const call = storedBody.f(a);
    assert.equal(call.x[0], storedHeader.cell); assert.equal(call.s, storedHeader.span);
    assert.equal(Bend.term_force(call.x[1]), a);
    storedHeader.cell.v = Bend.Ctr("StoredChange", []);
    assert.equal(Bend.term_force(call.x[0]).k, "StoredChange");
    assert.throws(() => new Module.ModuleReader(writer.directory, "other-compiler"),
      /Module store compiler or format differs/);
  } finally { writer.remove(); }
  console.log(JSON.stringify({ test: "store_sections", status: "passed" }));
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
