// ADT.r equality regression for arm_eq.
//
// Usage: bun arm_eq_adt_r.ts COMPILER_DIR
//
// Two arm bodies are alpha-equal except for the ADT type's constructor list
// `r`. arm_eq must reject them: emit_arm_shared keys on arm_eq, and sharing
// these bodies would merge arms whose constructor coverage differs from the
// consumer term_compare EQ at bend.ts:3267-3275.
// This fixture covers arm_eq equality only, NOT end-to-end capture emission;
// capture emission remains queue-held qualification.
//
// Source-only fixture. Do not run as part of the source commit; the root queue
// owns compiler checks.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

type TestModule = { arm_eq(a: Bend.HTerm, b: Bend.HTerm): boolean };

const dirArg = process.argv[2];
if (dirArg === undefined) {
  console.error("usage: bun arm_eq_adt_r.ts COMPILER_DIR");
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-arm-eq-adt-r-"));
const testModule = path.join(tmp, "comp.arm_eq_adt_r_test.ts");
fs.copyFileSync(path.join(path.dirname(source), "bend.ts"),
  path.join(tmp, "bend.ts"));
fs.copyFileSync(path.join(path.dirname(source), "base.bend"),
  path.join(tmp, "base.bend"));
fs.writeFileSync(testModule, fs.readFileSync(source, "utf8") + "\nexport { arm_eq };\n");
let mod: TestModule;
try {
  mod = (await import(pathToFileURL(testModule).href)) as unknown as TestModule;
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const U32 = Bend.ADT("U32", [], undefined);
const tag = (r: string[]): Bend.HTerm => Bend.ADT("Tag", [U32], undefined, r);
const arm = (r: string[]): Bend.HTerm =>
  Bend.Lam("z", 0, (z) => Bend.Ann(z, tag(r)));

const a = arm(["A"]);
const b = arm(["B"]);
const got = mod.arm_eq(a, b);
const ok = got === false;
console.log((ok ? "PASS " : "FAIL ") + "adt_r: arm_eq = " + got
  + ", expected false");
process.exit(ok ? 0 : 1);
