// Usage: bun bend2/test/compiler/bounded_indent.ts [REPOSITORY_ROOT]
// Emitted C leading indentation is capped, and the capped source is
// token-identical to the uncapped source for a deeply nested literal match.
// The temp compiler disables the branch C literal lowering so this test isolates the indentation cap.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

type Comp = { compile_book(book: Bend.Book): string };

function replaceOnce(source: string, before: string, after: string): string {
  assert.equal(source.split(before).length, 2, "expected one source anchor");
  return source.replace(before, after);
}

function instrument(source: string): string {
  return replaceOnce(source,
    "function file_push(fl: File, line: string): void {",
    "export const test_indents = INDENTS.length;\n"
    + "function file_push(fl: File, line: string): void {");
}

const fixture = `import Base

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case +a <> "abcdefghijkl" <> +rest <> Nil{}: IO.die(Unit, 1, a)
    case +db <> "zyxwvutsrqpo" <> +rest <> Nil{}: IO.die(Unit, 2, db)
    case other: IO.die(Unit, 3, "fallback")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
`;

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const upstream = path.join(root, "bend2/compiler/upstream");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-bounded-indent-"));
try {
  for (const name of ["bend.ts", "base.bend"]) {
    fs.copyFileSync(path.join(upstream, name), path.join(temp, name));
  }
  fs.cpSync(path.join(upstream, "effs"), path.join(temp, "effs"), { recursive: true });
  // The branch C literal lowering removes the deep decision tree. This test
  // exercises the indentation cap, so use the generic lowering in its temp
  // compiler copies. The branch C lowering has its own test.
  const bendSource = fs.readFileSync(path.join(upstream, "bend.ts"), "utf8");
  const lower = "literal_chain(p, body, vars, def, k)\n      ?? body_flatten(body, vars, () => p.sc.frs++));";
  const generic = "body_flatten(body, vars, () => p.sc.frs++));";
  fs.writeFileSync(path.join(temp, "bend.ts"),
    bendSource.includes(lower)
      ? replaceOnce(bendSource, lower, generic) : bendSource);
  const source = fs.readFileSync(path.join(upstream, "comp.ts"), "utf8");
  const capped = source.match(/function file_push\(fl: File, line: string\): void \{\n[\s\S]*?\n\}/)?.[0];
  assert.ok(capped !== undefined, "file_push definition");
  const uncapped = `function file_push(fl: File, line: string): void {
${capped.includes("fl.dry") ? "  if (fl.dry) return;\n" : ""}  fl.seg.lines.push("  ".repeat(fl.tab) + line);
}`;
  fs.writeFileSync(path.join(temp, "capped.ts"), instrument(source));
  fs.writeFileSync(path.join(temp, "uncapped.ts"),
    instrument(replaceOnce(source, capped, uncapped)));
  // The temp compiler copies are selected at run time, so these imports cannot be static.
  const BendTmp = await import(pathToFileURL(path.join(temp, "bend.ts")).href) as typeof Bend;
  const cap = await import(pathToFileURL(path.join(temp, "capped.ts")).href) as Comp;
  const uncap = await import(pathToFileURL(path.join(temp, "uncapped.ts")).href) as Comp;
  const file = path.join(temp, "deep.bend");
  fs.writeFileSync(file, fixture);
  const load = async (Comp: Comp): Promise<string> => {
    const book = BendTmp.book_nil();
    await BendTmp.book_load(book, file, "", new Map());
    BendTmp.book_valid(book);
    return Comp.compile_book(book as Bend.Book);
  };
  const a = await load(uncap);
  const b = await load(cap);
  const norm = (c: string): string => c.replace(/^[ \t]+/gm, "");
  const maxIndent = (c: string): number =>
    Math.max(...c.split("\n").map((l) => l.length - l.trimStart().length));
  assert.equal(norm(a), norm(b), "capped C differs from the uncapped token stream");
  assert.ok(maxIndent(b) <= 16, "capped indentation exceeds 16 spaces");
  assert.ok(maxIndent(a) > 16, "fixture does not reach the cap");
  assert.ok(b.length < a.length, "capped C is not smaller");
  const hash = (c: string): string => createHash("sha256").update(norm(c)).digest("hex");
  assert.equal(hash(a), hash(b), "normalized C hash");
  console.log(`PASS bounded indent: uncapped ${a.length} B / max ${maxIndent(a)}, `
    + `capped ${b.length} B / max ${maxIndent(b)}, normalized ${hash(a)}`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
