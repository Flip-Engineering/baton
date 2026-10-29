import assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const Link = await import(pathToFileURL(path.join(source, "link.ts")).href);
const graph = (prefix: string, offset: number, recursive: boolean) => {
  const a = prefix + "spin_" + offset, b = prefix + "spin_" + (offset + 1);
  return [
    [a, `INLINE Term ${a}(Env e) { return ${b}(e); }`, new Set([b]), new Map()],
    [b, `INLINE Term ${b}(Env e) { return ${recursive ? a + "(e)" : "term_pak(CID_LEAF, 0)"}; }`,
      new Set(recursive ? [a] : []), new Map([["Leaf", 0]])],
  ];
};
for (const recursive of [false, true]) {
  const a = Link.canonical_helpers(graph("u6161_", 0, recursive));
  const b = Link.canonical_helpers(graph("u6262_", 9, recursive).reverse());
  const code = (result: typeof a) => result.helpers.map(([name, source, refs]) =>
    [name, source, [...refs].sort()]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  assert.deepEqual(code(a), code(b), "helper array order, unit prefix and local index offsets");
}
const input = 'old("old", \'x\'); /* old */ // old\nint old_value = 0xdead;';
assert.equal(Link.c_identifiers(input, name => name === "old" ? "fresh" : name),
  'fresh("old", \'x\'); /* old */ // old\nint old_value = 0xdead;');
console.log("PASS helper dependency groups and C identifier rewriting");
