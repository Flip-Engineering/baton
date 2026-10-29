// Usage: bun bend2/test/compiler/iterative_arm_walks.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = path.join(root, "bend2/compiler/upstream");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-arm-walks-"));
try {
  for (const name of fs.readdirSync(source).filter(name =>
    name.endsWith(".ts") || name === "base.bend")) {
    fs.copyFileSync(path.join(source, name), path.join(temporary, name));
  }
  fs.writeFileSync(path.join(temporary, "comp.ts"),
    fs.readFileSync(path.join(source, "comp.ts"), "utf8")
      + "\nexport { arm_eq, capture_order, probe, memo_gc, term_uses };\n");
  const Bend = await import(pathToFileURL(path.join(temporary, "bend.ts")).href);
  const Comp = await import(pathToFileURL(path.join(temporary, "comp.ts")).href);
  const A = Bend.Ref("U32");
  const p = Comp.probe("free");
  let a = p, b = p;
  for (let i = 0; i < 40000; i++) {
    a = Bend.Ann(a, A);
    b = Bend.Ann(b, A);
  }
  assert.equal(Comp.arm_eq(a, b), true, "deep equal arms compare without JS recursion");
  const binding = { val: { ws: ["x"], lay: { ks: ["box"], arms: null }, stat: false },
    n: 1, A };
  const fl = { book: Bend.book_nil(), uses: new Map([[p, binding]]) };
  assert.deepEqual(Comp.capture_order(fl, a, Comp.term_uses(fl, a)), [[p, binding]],
    "a deep arm preserves the first-use capture order");
  console.log("PASS deep arm equality and capture discovery");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
