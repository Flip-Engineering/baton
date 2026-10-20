// Ref.b equality regression for arm_eq.
//
// Usage: bun arm_eq_ref_bang.ts COMPILER_DIR
//
// Two alpha-equal arm bodies differ only in a Ref bang marker. b reaches
// call.bang (comp.ts:823), cb.bangs (comp.ts:1536), and emit_jump/once
// (comp.ts:2140), so arm_eq must reject the pair; otherwise a hint collision
// can share a spin and change bang semantics.
//
// Source-only fixture. Do not run as part of the source commit; the root queue
// owns compiler checks.
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

type TestModule = { arm_eq(a: Bend.HTerm, b: Bend.HTerm): boolean };

const dirArg = process.argv[2];
if (dirArg === undefined) {
  console.error("usage: bun arm_eq_ref_bang.ts COMPILER_DIR");
  process.exit(2);
}

const dir = path.resolve(dirArg);
const candidates = [
  path.join(dir, "bend2/compiler/upstream/comp.ts"),
  path.join(dir, "bend2/comp.ts"),
];
const source = candidates.find((p) => fs.existsSync(p));
if (source === undefined) {
  console.error("no comp.ts under " + dir);
  process.exit(2);
}
const testModule = path.join(path.dirname(source), "comp.arm_eq_test.ts");
fs.writeFileSync(testModule, fs.readFileSync(source, "utf8") + "\nexport { arm_eq };\n");
let mod: TestModule;
try {
  mod = (await import(pathToFileURL(testModule).href)) as unknown as TestModule;
} finally {
  fs.rmSync(testModule, { force: true });
}

const body = (bang: boolean): Bend.HTerm =>
  Bend.Lam("z", 0, (z) => Bend.App(Bend.Ref("f", undefined, bang), z));
const a = body(true);
const b = body(false);
const got = mod.arm_eq(a, b);
const ok = got === false;
console.log((ok ? "PASS " : "FAIL ") + "ref_bang: arm_eq = " + got
  + ", expected false");
process.exit(ok ? 0 : 1);
