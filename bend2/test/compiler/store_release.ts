// Usage: bun bend2/test/compiler/store_release.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = path.join(root, "bend2/compiler/upstream");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-store-release-"));
try {
  for (const name of ["bend.ts", "base.bend", "store.ts"]) {
    if (fs.existsSync(path.join(source, name))) {
      fs.copyFileSync(path.join(source, name), path.join(temporary, name));
    }
  }
  fs.symlinkSync(path.join(source, "effs"), path.join(temporary, "effs"));
  let compiler = fs.readFileSync(path.join(source, "comp.ts"), "utf8");
  const diagnostic = 'export function diagnostic(event: string, details: Record<string, unknown> = {}): void {';
  assert.ok(compiler.includes(diagnostic));
  compiler = compiler.replace(diagnostic, diagnostic + "\n  test_phase(event);");
  fs.writeFileSync(path.join(temporary, "comp.ts"), compiler + `
    export let test_refs: [string, WeakRef<HTerm>][] = [];
    export let test_checked = false;
    export function test_front(book: Bend.Book): void {
      const cb = carb_book(book, ["main", ...RUNTIME_ADTS]);
      test_refs = done_defs(cb).map(([k, def]) => [k, new WeakRef(def.h!)]);
    }
    function test_phase(event: string): void {
      if (event !== "unit.begin" || test_checked) return;
      test_checked = true;
      Bun.gc(true);
      const retained = test_refs.filter(([, ref]) => ref.deref() !== undefined).map(([k]) => k);
      if (retained.length !== 0) throw new Error("front-end bodies retained: " + retained.join(", "));
    }
  `);
  const Bend = await import(pathToFileURL(path.join(temporary, "bend.ts")).href);
  const Comp = await import(pathToFileURL(path.join(temporary, "comp.ts")).href);
  const book = Bend.book_nil();
  await Bend.book_load(book, path.join(root,
    "bend2/test/compiler/fixtures/poly_spin_hot.bend"), "", new Map());
  Bend.book_valid(book);
  Comp.test_front(book);
  assert.ok(Comp.test_refs.length > 0);
  // WeakRef construction retains its target for the current JavaScript job.
  await new Promise(resolve => setTimeout(resolve, 0));
  const c = Comp.compile_book(book);
  assert.ok(Comp.test_checked, "the first unit checked front-end body release");
  assert.ok(c.includes("MAIN_FID"));
  console.log("PASS original front-end bodies collected before unit emission");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
