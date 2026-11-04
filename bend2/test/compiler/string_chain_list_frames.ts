// A string literal inside a List or Data constructor pattern, in a definition
// with other parameters, a multi-column match or a recursive one, lowers to
// String.eq guards on the bound value: no character match (SCon) remains in the
// lowered body, and the interpreter and the emitted C give the same results. A
// literal row that calls the definition with the matched value keeps the
// character decision tree.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as Bend from "../../compiler/upstream/bend.ts";

type L = { $: string; [x: string]: unknown };
function children(term: L): L[] {
  switch (term.$) {
    case "Sub": return [term.f as L, term.v as L];
    case "Let": return [...(term.v as L[]), term.f as L];
    case "All": return [term.A as L, term.B as L];
    case "Lam": return [term.f as L];
    case "Typ": return [term.g as L];
    case "Min": return [term.a as L, term.b as L];
    case "App": return [term.f as L, term.x as L];
    case "ADT": case "Ctr": return term.x as L[];
    case "Mat": return [term.h as L, term.m as L];
    case "Eql": return [term.a as L, term.b as L, term.T as L];
    case "Rwt": return [term.e as L, term.p as L, term.f as L];
    case "Ann": return [term.x as L, term.T as L];
    default: return [];
  }
}
// Distinct nodes, and the distinct character matches (Mat on SCon) among them.
function census(term: L): { nodes: number; scon: number } {
  const seen = new WeakSet<object>(), stack: L[] = [term];
  let nodes = 0, scon = 0;
  while (stack.length > 0) {
    const node = stack.pop() as L;
    if (node === null || typeof node !== "object" || seen.has(node)) continue;
    seen.add(node); nodes += 1;
    if (node.$ === "Mat" && node.k === "SCon") scon += 1;
    stack.push(...children(node));
  }
  return { nodes, scon };
}

const expected = ["settings:proj/p", "legacy:db--project-settings,proj,extra,", "contextual:sessv7",
  "legacy:dbagent-contextual-input,", "legacy:dbother-mode,x,", "legacy:db", "missing:/p",
  "help:a", "help:d", "h", "-ha", "goa", "--source,x,s1,-,", "ab:t", "a:z", "first:a", "first:q", "none:t",
  "x:t", "hhhh", "a-nil", "a-cons:p", "b-any", "b-any", "other-nil:c", "other-cons:cp", "other-cons:p",
  "source=s1", "label=l1", "--other=o1", "=", "pretty", "flag:--pretty2", ">pdup,q,stop,r,q", ">pq"];
const root = path.join(import.meta.dir, "../../..");
const fixture = path.join(import.meta.dir, "fixtures/string_chain_list_frames.bend");
const book = Bend.book_nil();
await Bend.book_load(book, fixture, "", new Map());
Bend.book_valid(book);
const shape = (name: string): { nodes: number; scon: number } => {
  const def = book.tlds[name];
  assert.ok(def !== undefined && def.$ === "Def" && def.v !== null, `${name} is a filled def`);
  return census(Bend.term_lower_shared(def.v) as L);
};
const shapes = Object.fromEntries(["run", "execute", "options", "pair", "marked", "two", "opt", "echo"]
  .map((name) => [name, shape(name)]));
for (const name of ["run", "execute", "options", "pair", "marked", "two", "opt"]) {
  assert.equal(shapes[name].scon, 0, `${name} tests its literals with String.eq (${JSON.stringify(shapes[name])})`);
}
assert.ok(shapes.echo.scon > 0, "a literal row that calls the definition with the matched value keeps the character decision tree");
assert.deepEqual(book.order.filter((name) => name.includes("$lit")), [], "no literal helpers");

const run = spawnSync(process.execPath, [path.join(root, "bend2/compiler/upstream/main.ts"), fixture],
  { cwd: root, encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
assert.equal(run.status, 0, run.stderr);
assert.deepEqual(run.stdout.trim().split("\n"), expected, "results");
// A list head used twice by an affine binder row is still refused.
const affine = path.join(import.meta.dir, "fixtures/string_chain_list_affine.bend");
const refused = spawnSync(process.execPath, [path.join(root, "bend2/compiler/upstream/main.ts"), affine, "--check-only"],
  { cwd: root, encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
assert.notEqual(refused.status, 0, "an affine head used twice is refused: " + refused.stdout);
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-string-chain-frames-"));
try {
  const output = path.join(directory, "frames.c"), binary = path.join(directory, "frames");
  const emitted = spawnSync(process.execPath, ["--smol", path.join(root, "bend2/compiler/upstream/main.ts"), fixture, "-o", output],
    { cwd: root, encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
  assert.equal(emitted.status, 0, "the frames emit C: " + emitted.stderr);
  execFileSync(process.env.CC ?? "clang-19", ["-std=c11", "-O1", "-pthread", output, "-lm", "-o", binary]);
  assert.deepEqual(execFileSync(binary, { encoding: "utf8" }).trim().split("\n"), expected, "results of the C");
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
console.log(JSON.stringify({ test: "string_chain_list_frames", shapes }));
