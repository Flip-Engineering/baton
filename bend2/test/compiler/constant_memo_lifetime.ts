// Usage: bun bend2/test/compiler/constant_memo_lifetime.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { HTerm } from "../../compiler/upstream/bend.ts";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-constant-memo-"));
try {
  fs.cpSync(source, directory, { recursive: true });
  const compiler = path.join(directory, "comp.ts");
  fs.appendFileSync(compiler, "\nexport { term_const };\n");
  const Comp = await import(pathToFileURL(compiler).href) as {
    term_const(t: HTerm): boolean;
  };
  const Bend = await import(pathToFileURL(path.join(directory, "bend.ts")).href);
  const weak = [true, false].map(constant => {
    const term = Bend.Ctr("Payload", [constant ? Bend.Ctr("Value", []) : Bend.Ref("dynamic")]);
    assert.equal(Comp.term_const(term), constant);
    assert.equal(Comp.term_const(term), constant, "a live term keeps its classification");
    return { constant, reference: new WeakRef(term) };
  });
  // WeakRef keeps targets alive until the current JavaScript job ends.
  await new Promise<void>(resolve => setImmediate(resolve));
  Bun.gc(true);
  for (const { constant, reference } of weak) {
    assert.equal(reference.deref(), undefined,
      "the constant classifier releases an unused " + (constant ? "constant" : "dynamic") + " term");
  }
  console.log("PASS constant classification releases unused terms within a definition");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
