// Usage: bun bend2/test/compiler/poly_spin_hot.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source_dir = path.join(root, "bend2/compiler/upstream");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-poly-spin-"));
try {
  for (const name of fs.readdirSync(source_dir).filter(name =>
    name.endsWith(".ts") || name === "base.bend")) {
    fs.copyFileSync(path.join(source_dir, name), path.join(directory, name));
  }
  fs.symlinkSync(path.join(source_dir, "effs"), path.join(directory, "effs"));
  let source = fs.readFileSync(path.join(source_dir, "comp.ts"), "utf8");
  source = source.replace("function emit_native(fl: File, ck: Call, ers: HTerm[]): string {",
    `function emit_native(fl: File, ck: Call, ers: HTerm[]): string {
      const name = test_native(fl, ck, ers);
      test_spins.set(fl.unit + ck.k + "|" + ers.map(e => lay_key(e)).join(","), name);
      return name;
    }
    function test_native(fl: File, ck: Call, ers: HTerm[]): string {`);
  source = source.replace("  const reach = (from: string[]): Set<string> => file_reach(fl, from);",
    `  test_hot = new Set(cb.hot);
       const reach = (from: string[]): Set<string> => file_reach(fl, from);`);
  source = source.replace("function compile_def(fl: File, k: Bend.Name, tld: Def): void {",
    "function compile_def(fl: File, k: Bend.Name, tld: Def): void { test_units.add(k);");
  fs.writeFileSync(path.join(directory, "comp.ts"), source + `
    export const test_spins = new Map<string, string>();
    export const test_units = new Set<string>();
    export let test_hot = new Set<string>();
  `);
  const Bend = await import(pathToFileURL(path.join(directory, "bend.ts")).href);
  const Comp = await import(pathToFileURL(path.join(directory, "comp.ts")).href);
  const book = Bend.book_nil();
  await Bend.book_load(book, path.join(import.meta.dir, "fixtures/poly_spin_hot.bend"), "", new Map());
  Bend.book_valid(book);
  const c = Comp.compile_book(book);
  assert.ok(Comp.test_hot.has("duplicate~0"), "the erased type parameter has a poly key");
  assert.ok(!Comp.test_hot.has("*"), "known recursive types keep their own heating facts");
  const spins = [...Comp.test_spins].filter(([key]) => key.startsWith("u6d61696e_duplicate|"));
  assert.equal(spins.length, 2, "main calls duplicate with two distinct recursive types");
  assert.equal(new Set(spins.map(([, name]) => name)).size, spins.length,
    "different erased argument types have distinct spin functions");
  assert.ok(Comp.test_units.has("duplicate"),
    "the generic spin-only definition is also emitted for its facts");
  assert.ok(Comp.test_units.has("via"),
    "the generic fused definition is also emitted for its facts");
  assert.ok(!/^#define FID_VIA \d+$/m.test(c), "via is fused into its single call site");
  const hot = /CONSTV u8 CID_HOT_T\[\] = \{ ([\d, ]+) \};/.exec(c)![1]
    .split(",").map(Number);
  for (const name of ["LEAF", "BRANCH"]) {
    const id = Number(new RegExp("^#define CID_" + name + " (\\d+)$", "m").exec(c)![1]);
    assert.equal(hot[id], 1, name + " nodes are sealed and read through the counted path");
  }
  assert.ok(!/^#define FID_DUPLICATE \d+$/m.test(c),
    "the generic definition is reached through spins and has no entry segment");
  const file = path.join(directory, "main.c");
  const binary = path.join(directory, "main");
  fs.writeFileSync(file, c);
  execFileSync(process.env.CC ?? "clang-19", ["-std=c11", "-O1", "-pthread", file, "-lm", "-o", binary]);
  assert.equal(execFileSync(binary, { encoding: "utf8" }).trim(), "218");
  console.log("PASS generic spin type identity, hot constructors, and emitted C execution");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
