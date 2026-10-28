// Usage: bun bend2/test/compiler/arm_walks_linear.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = path.join(root, "bend2/compiler/upstream");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-arm-linear-"));
try {
  if (fs.existsSync(path.join(source, "store.ts"))) {
    fs.copyFileSync(path.join(source, "store.ts"), path.join(temporary, "store.ts"));
  }
  if (fs.existsSync(path.join(source, "link.ts"))) {
    fs.copyFileSync(path.join(source, "link.ts"), path.join(temporary, "link.ts"));
  }
  for (const name of ["bend.ts", "base.bend"]) fs.copyFileSync(path.join(source, name), path.join(temporary, name));
  fs.symlinkSync(path.join(source, "effs"), path.join(temporary, "effs"));
  let compiler = fs.readFileSync(path.join(source, "comp.ts"), "utf8");
  compiler = compiler.replace("function term_kids(cf: Carb, tm: HTerm): HTerm[] {",
    "function term_kids(cf: Carb, tm: HTerm): HTerm[] { if (test_scope > 0) test_nodes += 1;");
  compiler = compiler.replace("function capture_order(", "function test_capture_order(")
    .replace("function term_any(", "function test_term_any(");
  let wrappers = `
    let test_scope = 0;
    export let test_nodes = 0;
    function capture_order(fl: File, h: HTerm, u: UMap): [Probe, Bind][] {
      test_scope += 1;
      try { return test_capture_order(fl, h, u); } finally { test_scope -= 1; }
    }
    function term_any(cf: Carb, t: HTerm, p: (s: HTerm, tail: boolean) => boolean,
      tail = true, seen = new Set<HTerm>()): boolean {
      const sharing = p.toString().includes("call_kind") && p.toString().includes("flat_call");
      test_scope += Number(sharing);
      try { return test_term_any(cf, t, p, tail, seen); }
      finally { test_scope -= Number(sharing); }
    }
  `;
  if (compiler.includes("function term_sum(")) {
    compiler = compiler.replace("function term_sum(", "function test_term_sum(");
    wrappers += `
      function term_sum(cf: Carb, t: HTerm): TermSum {
        test_scope += 1;
        try { return test_term_sum(cf, t); } finally { test_scope -= 1; }
      }
    `;
  }
  fs.writeFileSync(path.join(temporary, "comp.ts"), compiler + wrappers);
  const Bend = await import(pathToFileURL(path.join(temporary, "bend.ts")).href);
  const Comp = await import(pathToFileURL(path.join(temporary, "comp.ts")).href);
  const counts: number[] = [];
  const sizes: number[] = [];
  const syntax_nodes = (root: unknown): number => {
    const seen = new WeakSet<object>();
    const stack = [root];
    let count = 0;
    while (stack.length > 0) {
      const value = stack.pop();
      if (value === null || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      const term = value as Record<string, unknown>;
      if (typeof term.$ === "string") count += 1;
      // These fixture constructors are closed literal values.
      if (term.$ === "Ctr") continue;
      for (const [key, child] of Object.entries(term)) {
        if (key !== "s" && key !== "T") stack.push(child);
      }
    }
    return count;
  };
  for (const n of [12, 24]) {
    const fixture = path.join(temporary, "nested" + n + ".bend");
    const params = Array.from({ length: n }, (_, i) => "x" + i + ": Tag").join(", ");
    const arms = Array.from({ length: n }, (_, i) => {
      const indent = "  ".repeat(1 + 2 * i);
      return indent + "match x" + i + ":\n" + indent + "  case Hit{}: " + i + "\n"
        + indent + "  case other:\n";
    }).join("") + "  ".repeat(1 + 2 * n) + n + "\n";
    const arguments_ = Array(n).fill("flag").join(", ");
    fs.writeFileSync(fixture, `import Base
 type Tag is Data:
   Hit{}
   Miss{}
 def choose(${params}) -> U32:
${arms}
 def tag(n: Nat) -> Tag:
   match n:
     case 0n: Miss{}
     case 1n+p: tag(p)
 def run(+flag: Tag) -> U32:
   U32.add(choose(${arguments_}), choose(${arguments_}))
 def main() -> U32:
   run(tag(32n))
`.replace(/^ /gm, ""));
    const book = Bend.book_nil();
    await Bend.book_load(book, fixture, "", new Map());
    Bend.book_valid(book);
    sizes.push(syntax_nodes(book.tlds.choose.e));
    const before = Comp.test_nodes;
    Comp.compile_book(book);
    counts.push(Comp.test_nodes - before);
  }
  assert.ok(counts[0] > 0);
  assert.ok(sizes[1] > sizes[0]);
  // The flattener copies the remaining parameters into each arm. Measure the
  // resulting runtime graph, with literals as leaves, as the input size.
  assert.ok(counts[1] * sizes[0] <= counts[0] * sizes[1] * 1.25,
    "arm discovery visits should scale with checked syntax: " + JSON.stringify({ counts, sizes }));
  console.log("PASS linear arm discovery " + JSON.stringify({ counts, sizes }));
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
