// Usage: bun bend2/test/compiler/diagnostic_error.ts [COMPILER_DIR]
// Inject failures before CARB operations; each attempt exits before emission.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import type * as BendTypes from "../../compiler/upstream/bend.ts";

const [dirArg, mode, stage, failureKind] = process.argv.slice(2);
if (mode === "child") {
  const dir = dirArg as string;
  const Bend = await import(pathToFileURL(path.join(dir, "bend.ts")).href);
  const Comp = await import(pathToFileURL(path.join(dir, "comp.ts")).href);
  const Main = await import(pathToFileURL(path.join(dir, "main.ts")).href);
  const message = failureKind === "stack" ? "Maximum call stack size exceeded"
    : failureKind === "oom" ? "Out of memory" : "Invalid string length diagnostic probe";
  const original = new RangeError(message);
  const fail = (): never => { throw original; };
  const def = { $: "Def", n: 0, v: Bend.Rfl(), T: Bend.Rfl(), h: Bend.Rfl() };
  const field = stage === "definition" ? "e" : stage === "types" ? "T" : "h";
  Object.defineProperty(def, field, { get: fail });
  const book = Bend.book_nil();
  book.tlds.main = def as unknown as BendTypes.Def;
  let caught: unknown;
  try {
    Comp.compile_book(book);
  } catch (error) {
    caught = error;
  }
  assert.equal(caught, original);
  const formatted = Main.book_err(caught);
  fs.writeSync(2, formatted + "\n");
  console.log(JSON.stringify({ formatted, stack: original.stack }));
  process.exit(0);
}

const root = path.resolve(dirArg ?? path.join(import.meta.dir, "../../.."));
const source = path.join(root, "bend2/compiler/upstream");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-diagnostic-error-"));
try {
  for (const name of ["bend.ts", "comp.ts", "main.ts", "base.bend"]) {
    fs.copyFileSync(path.join(source, name), path.join(tmp, name));
  }
  fs.appendFileSync(path.join(tmp, "main.ts"), "\nexport { book_err };\n");
  for (const [enabled, phase, kind] of [[true, "definition", "other"],
    [true, "types", "other"], [false, "types", "other"],
    [true, "types", "stack"], [true, "body", "oom"]] as const) {
    const result = spawnSync(process.execPath,
      [import.meta.path, tmp, "child", phase, kind], {
        env: { ...process.env, BEND_COMPILER_DIAGNOSTICS: enabled ? "1" : "0",
          BEND_NO_TELEMETRY: "1" },
        encoding: "utf8",
      });
    assert.equal(result.status, 0, result.stderr);
    const expected = JSON.parse(result.stdout);
    assert.equal(expected.formatted, kind === "stack"
      ? "Error: the machine stack overflowed (a deep recursion, or a literal too large to expand)"
      : "RangeError: " + (kind === "oom" ? "Out of memory" : "Invalid string length diagnostic probe"));
    const rows = result.stderr.trim().split("\n");
    assert.equal(rows.pop(), expected.formatted);
    if (enabled) {
      const frames = rows.map((row) => JSON.parse(row));
      const error = frames.find((frame) => frame.compiler_diagnostic === "exception");
      assert.ok(error);
      assert.deepEqual(error.last_operation,
        { event: "carb." + phase, details: { name: "main" } });
      assert.deepEqual(error.error, { name: "RangeError",
        message: kind === "stack" ? "Maximum call stack size exceeded"
          : kind === "oom" ? "Out of memory" : "Invalid string length diagnostic probe",
        stack: expected.stack });
    } else {
      assert.deepEqual(rows, []);
    }
    console.log("PASS diagnostics=" + Number(enabled) + " carb." + phase);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
