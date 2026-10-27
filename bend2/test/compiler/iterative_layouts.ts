// Usage: bun bend2/test/compiler/iterative_layouts.ts
// Compare datatype layouts with the retained implementation and exercise a
// checked datatype dependency chain across both layout implementations.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

const root = path.resolve(import.meta.dir, "../../..");
const upstream = path.join(root, "bend2/compiler/upstream");
const original = execFileSync("git", ["show",
  "b9eb2d2b7643994f3162f16ec264f429218f458c:bend2/compiler/upstream/comp.ts"],
  { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 });
const current = fs.readFileSync(path.join(upstream, "comp.ts"), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-iterative-layouts-"));
const hooks = `
export { lay_of, lay_cyclic };
export function reset_layouts() { LAYS.clear(); CYCLES.clear(); NODES.clear(); }
`;
type Module = {
  lay_of(book: Bend.Book, t: Bend.HTerm | null): unknown;
  lay_cyclic(book: Bend.Book, k: string): boolean;
  reset_layouts(): void;
};
function book(source: string): Bend.Book {
  const b = Bend.parse_book(Bend.book_nil(), "", source);
  Bend.book_valid(b);
  return b;
}
try {
  for (const name of ["bend.ts", "base.bend"]) {
    fs.copyFileSync(path.join(upstream, name), path.join(tmp, name));
  }
  fs.writeFileSync(path.join(tmp, "original.ts"), original + hooks);
  fs.writeFileSync(path.join(tmp, "current.ts"), current + hooks);
  const old = await import(pathToFileURL(path.join(tmp, "original.ts")).href) as Module;
  const now = await import(pathToFileURL(path.join(tmp, "current.ts")).href) as Module;
  const b = book(`type Atom is Data:
  Atom{}

type Pair is Data:
  Pair{a: Atom, b: Atom}

type Choice is Data:
  Empty{}
  Full{value: Pair}

type Wrap<-A: Type> is Type:
  Wrap{value: A}

type Tree is Data:
  Tip{}
  Fork{left: Tree, right: Tree}
`);
  const terms: (Bend.HTerm | null)[] = [null,
    ...["Atom", "Pair", "Choice", "Tree", "Nat", "Array", "Missing"]
      .map(k => Bend.ADT(k, [])),
    Bend.ADT("Wrap", [Bend.ADT("Atom", [])]),
    Bend.ADT("Wrap", [Bend.ADT("Choice", [])]),
    Bend.ADT("Wrap", [Bend.ADT("Tree", [])]),
  ];
  for (let i = 0; i < terms.length; ++i) {
    old.reset_layouts(); now.reset_layouts();
    assert.deepEqual(now.lay_of(b, terms[i]), old.lay_of(b, terms[i]), `layout ${i}`);
    // Exercise the completed-cache read as well as first construction.
    assert.deepEqual(now.lay_of(b, terms[i]), old.lay_of(b, terms[i]), `cached ${i}`);
  }
  for (const name of ["Atom", "Pair", "Choice", "Tree", "Nat", "Array"]) {
    old.reset_layouts(); now.reset_layouts();
    assert.equal(now.lay_cyclic(b, name), old.lay_cyclic(b, name), name);
  }
  console.log(`PASS ${terms.length} layouts, completed-cache reads and 6 cycle cases`);

  const count = 10000;
  const source = Array.from({ length: count }, (_, j) => count - 1 - j).map(i =>
    `type T${i} is Data:\n  C${i}{${i + 1 < count ? `next: T${i + 1}` : ""}}\n`).join("\n");
  const deep = book(source);
  old.reset_layouts(); now.reset_layouts();
  let retainedResult: boolean | string;
  try { retainedResult = old.lay_cyclic(deep, "T0"); }
  catch (err) { assert.ok(err instanceof RangeError); retainedResult = "RangeError"; }
  assert.ok(retainedResult === false || retainedResult === "RangeError");
  assert.equal(now.lay_cyclic(deep, "T0"), false);
  console.log(`PASS checked ${count}-datatype cycle walk; retained=${retainedResult}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
