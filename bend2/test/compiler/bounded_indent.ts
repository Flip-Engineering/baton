// Usage: bun bend2/test/compiler/bounded_indent.ts [REPOSITORY_ROOT]
// Emitted C leading indentation is capped, and the capped source is
// token-identical to the uncapped source for a deeply nested constructor match.
// A six-subject String constructor match keeps its per-subject decision `if`
// levels inline in one unit, so the uncapped output reaches 18 spaces while
// the capped output stays at the 16-space cap.
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

def dispatch(a: String, b: String, c: String, d: String, e: String, f: String) -> IO(Unit):
  match a b c d e f:
    case SNil{} SNil{} SNil{} SNil{} SNil{} SNil{}: IO.die(Unit, 21, "all-nil")
    case SCon{_, t1} SCon{_, _} SCon{_, _} SCon{_, _} SCon{_, _} SCon{_, _}: IO.die(Unit, 22, t1)
    case _ _ _ _ _ _: IO.die(Unit, 23, "other")

def route(args: List<String>) -> IO(Unit):
  match args:
    case Con{h1, Con{h2, Con{h3, Con{h4, Con{h5, Con{h6, _}}}}}}: dispatch(h1, h2, h3, h4, h5, h6)
    case _: IO.print("shallow")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    route(args)
`;

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const upstream = path.join(root, "bend2/compiler/upstream");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-bounded-indent-"));
try {
  for (const name of fs.readdirSync(upstream).filter(name =>
    name.endsWith(".ts") || name === "base.bend")) {
    fs.copyFileSync(path.join(upstream, name), path.join(temp, name));
  }
  fs.cpSync(path.join(upstream, "effs"), path.join(temp, "effs"), { recursive: true });
  // Observe file_push before the link removes leading helper indentation.
  // Helper hashes still use the canonical layout in both compiler copies.
  const linker = path.join(temp, "link.ts");
  if (fs.existsSync(linker)) {
    let text = fs.readFileSync(linker, "utf8");
    const layout = '  helpers = helpers.map(([name, text, refs, cids]) => [name, c_layout(text), refs, cids]);';
    if (text.includes(layout)) {
      text = replaceOnce(text, layout, '  const emitted_helpers = helpers;\n' + layout);
      text = replaceOnce(text, 'return { names, helpers: helpers.map(',
        'return { names, helpers: emitted_helpers.map(');
      fs.writeFileSync(linker, text);
    }
  }
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
  const cap = await import(pathToFileURL(path.join(temp, "capped.ts")).href) as Comp;
  const uncap = await import(pathToFileURL(path.join(temp, "uncapped.ts")).href) as Comp;
  const file = path.join(temp, "deep.bend");
  fs.writeFileSync(file, fixture);
  const load = async (Comp: Comp): Promise<string> => {
    const book = Bend.book_nil();
    await Bend.book_load(book, file, "", new Map());
    Bend.book_valid(book);
    return Comp.compile_book(book);
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
