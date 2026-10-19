// Binder-key aliasing check for arm_eq's All case and its Ann.T analogue.
//
// Usage: bun arm_eq_binder_key.ts COMPILER_DIR
//
// Each case runs in a fresh process so the compiler's probe counter starts
// at 1: the Lam binder takes probe 1 and the All at depth 1 used to bind
// key 1, aliasing it. The script appends a temporary `export { arm_eq }`
// to a copy of COMPILER_DIR/bend2/comp.ts, imports it, and removes the copy.
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as Bend from "../../bend2/compiler/upstream/bend.ts";

type TestModule = { arm_eq(a: Bend.HTerm, b: Bend.HTerm): boolean };

const [dirArg, caseArg] = process.argv.slice(2);
if (dirArg === undefined || caseArg === undefined) {
  if (dirArg === undefined) {
    console.error("usage: arm_eq_binder_key.ts COMPILER_DIR");
    process.exit(2);
  }
  let bad = 0;
  for (const name of ["all", "ann", "control"]) {
    const r = spawnSync(process.execPath, [import.meta.path, dirArg, name], { stdio: "inherit" });
    if (r.status !== 0) bad = 1;
  }
  process.exit(bad);
}

const dir = path.resolve(dirArg);
const source = path.join(dir, "bend2/comp.ts");
const testModule = path.join(dir, "bend2/comp.arm_eq_test.ts");
fs.writeFileSync(testModule, fs.readFileSync(source, "utf8") + "\nexport { arm_eq };\n");
let mod: TestModule;
try {
  // The temporary module is the compiler under test; its path is selected
  // at run time, so the shape is asserted at this boundary.
  mod = (await import(pathToFileURL(testModule).href + "?case=" + caseArg)) as unknown as TestModule;
} finally {
  fs.rmSync(testModule, { force: true });
}

const U32 = Bend.ADT("U32", [], undefined);
const lamAllZ = Bend.Lam("z", 0, (z) =>
  Bend.All(Bend.Lone(), "k", 1, U32, () => z));
const lamAllK = Bend.Lam("z", 0, () =>
  Bend.All(Bend.Lone(), "k", 1, U32, (k) => k));
const annAllZ = Bend.Lam("z", 0, (z) =>
  Bend.Ann(z, Bend.All(Bend.Lone(), "k", 1, U32, () => z)));
const annAllK = Bend.Lam("z", 0, (z) =>
  Bend.Ann(z, Bend.All(Bend.Lone(), "k", 1, U32, (k) => k)));

const cases: Record<string, [Bend.HTerm, Bend.HTerm, boolean]> = {
  all: [lamAllZ, lamAllK, false],
  ann: [annAllZ, annAllK, false],
  control: [lamAllZ, lamAllZ, true],
};
const [a, b, want] = cases[caseArg];
const got = mod.arm_eq(a, b);
const ok = got === want;
console.log((ok ? "PASS " : "FAIL ") + caseArg + ": arm_eq = " + got
  + ", expected " + want);
process.exit(ok ? 0 : 1);
