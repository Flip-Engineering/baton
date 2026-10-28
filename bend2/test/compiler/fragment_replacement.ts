import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-fragment-replacement-"));
try {
  fs.cpSync(source, path.join(temporary, "compiler"), { recursive: true });
  const file = path.join(temporary, "compiler/comp.ts");
  let compiler = fs.readFileSync(file, "utf8");
  const diagnostic = 'export function diagnostic(event: string, details: Record<string, unknown> = {}): void {';
  assert.ok(compiler.includes(diagnostic));
  compiler = compiler.replace(diagnostic, diagnostic + "\n  test_fragment(event, details);");
  compiler += `
    export const test_fragments = { active: new Map<string, { name: string; allocated: number }>(),
      released: 0, released_code: 0, released_allocated: 0, checked: false };
    function test_fragment(event: string, details: Record<string, unknown>): void {
      const state = test_fragments;
      if (event === "fragment.write") {
        const directory = String(details.directory);
        const allocated = fs.readdirSync(directory).reduce((sum, name) =>
          sum + fs.statSync(directory + "/" + name).blocks * 512, 0);
        state.active.set(directory, { name: String(details.name), allocated });
      } else if (event === "fragment.release") {
        const directory = String(details.directory), prior = state.active.get(directory);
        if (prior === undefined || fs.existsSync(directory)) throw new Error("old fragment remains: " + directory);
        state.released++; state.released_code += Number(details.bytes);
        state.released_allocated += prior.allocated; state.active.delete(directory);
      } else if (event === "book.end") {
        const names = [...state.active.values()].map(record => record.name);
        if (new Set(names).size !== names.length) throw new Error("multiple retained revisions for one unit");
        for (const directory of state.active.keys()) if (!fs.existsSync(directory)) throw new Error("current fragment missing");
        state.checked = true;
      }
    }
  `;
  fs.writeFileSync(file, compiler);
  const Bend = await import(pathToFileURL(path.join(temporary, "compiler/bend.ts")).href);
  const Comp = await import(pathToFileURL(file).href);
  const book = Bend.book_nil();
  await Bend.book_load(book, path.join(root, "bend2/test/compiler/fixtures/ref_bang_marked.bend"), "", new Map());
  Bend.book_valid(book);
  const c = Comp.compile_book(book, temporary);
  const observed = Comp.test_fragments;
  assert.ok(c.includes("MAIN_FID"));
  assert.ok(observed.checked && observed.released > 0 && observed.released_code > 0 && observed.released_allocated > 0);
  console.log("PASS replaced unit fragments " + JSON.stringify({ released: observed.released,
    code_bytes: observed.released_code, allocated_bytes: observed.released_allocated,
    current_units: observed.active.size }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
