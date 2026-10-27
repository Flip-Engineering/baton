// Usage: bun bend2/test/compiler/emission_pass_file_reuse.ts [REPOSITORY_ROOT]
// The emission fixed point reuses one File, resetting every per-pass field
// before each pass. Compare that pass loop with one that allocates a File per
// pass, on the same fixtures: the emitted C must be byte-identical, the reuse
// copy must construct exactly one File per compile, and the per-pass copy must
// construct more than one (the fixtures converge in several passes).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

import * as Bend from "../../compiler/upstream/bend.ts";

type Comp = {
  compile_book(book: Bend.Book): string;
  test_file_news: number[];
};

function replaceOnce(source: string, before: string, after: string): string {
  assert.equal(source.split(before).length, 2, `expected one source anchor: ${before}`);
  return source.replace(before, after);
}

// count File constructions without changing anything else in the compiler.
function instrument(source: string): string {
  return replaceOnce(source, "function file_new(cb: Carb, decl: string): File {",
    "export const test_file_news: number[] = [];\n"
    + "function file_new(cb: Carb, decl: string): File {\n"
    + "  test_file_news.push(1);");
}

// The pre-change pass loop: every pass constructs its own File.
function perPass(source: string): string {
  source = replaceOnce(source,
    '  const fl = file_new(cb, "Term");\n  const pass = (defs:',
    "  let fl: File;\n  const pass = (defs:");
  source = replaceOnce(source,
    '    file_reset(fl, cb, "Term");\n',
    '    const fl = file_new(cb, "Term");\n');
  source = replaceOnce(source,
    "      pass(emission_defs, false);\n",
    "      fl = pass(emission_defs, false);\n");
  source = replaceOnce(source,
    "    pass(emission_defs, false);\n",
    "    fl = pass(emission_defs, false);\n");
  return source;
}

const fixtures = [
  "native_arm_collision.bend",
  "u32_table_bitvar.bend",
  "arm_nonflat_call.bend",
  "compiler776_capture_default.bend",
  "ref_bang_marked.bend",
];

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const upstream = path.join(root, "bend2/compiler/upstream");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-emission-file-reuse-"));
try {
  for (const name of ["bend.ts", "base.bend"]) {
    fs.copyFileSync(path.join(upstream, name), path.join(temp, name));
  }
  const source = fs.readFileSync(path.join(upstream, "comp.ts"), "utf8");
  fs.writeFileSync(path.join(temp, "reuse.ts"), instrument(source));
  fs.writeFileSync(path.join(temp, "per-pass.ts"), instrument(perPass(source)));
  // The temp directory is selected at run time, so these imports cannot be static.
  const reuse = await import(pathToFileURL(path.join(temp, "reuse.ts")).href) as Comp;
  const per_pass = await import(pathToFileURL(path.join(temp, "per-pass.ts")).href) as Comp;

  const load = async (file: string): Promise<Bend.Book> => {
    const book = Bend.book_nil();
    await Bend.book_load(book, file, "", new Map());
    Bend.book_valid(book);
    return book;
  };
  const hash = (c: string): string =>
    createHash("sha256").update(c).digest("hex");

  for (const name of fixtures) {
    const file = path.join(import.meta.dir, "fixtures", name);
    reuse.test_file_news.length = 0;
    const reused_c = reuse.compile_book(await load(file));
    const reused_files = reuse.test_file_news.length;
    per_pass.test_file_news.length = 0;
    const per_pass_c = per_pass.compile_book(await load(file));
    const per_pass_files = per_pass.test_file_news.length;
    assert.equal(reused_files, 1, `${name}: compile_book constructs one File`);
    assert.ok(per_pass_files > 1,
      `${name}: the per-pass reference converges in more than one pass`);
    assert.equal(hash(reused_c), hash(per_pass_c),
      `${name}: reused File changes the emitted C`);
    console.log(`PASS ${name}: ${per_pass_files} per-pass Files -> ${reused_files}, `
      + `emitted C ${hash(reused_c)}`);
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
