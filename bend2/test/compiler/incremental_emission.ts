// Usage: bun bend2/test/compiler/incremental_emission.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-incremental-"));
try {
  const result = spawnSync(process.execPath, ["--smol",
    path.join(root, "bend2/compiler/upstream/main.ts"),
    path.join(import.meta.dir, "fixtures/ref_bang_marked.bend"),
    "-o", path.join(directory, "main.c")], {
    encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1",
      BEND_COMPILER_DIAGNOSTICS: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  const frames = result.stderr.split("\n").flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const passes = frames.filter((f) => f.compiler_diagnostic === "pass.end");
  assert.ok(passes.length > 1, "the fixture adds ownership facts");
  assert.equal(frames.filter((f) => f.compiler_diagnostic === "definition.end"
    && f.name === "deep").length, 1, "new facts do not affect the U32 function");
  const reach = frames.find((f) => f.compiler_diagnostic === "reach.end");
  assert.equal(passes.at(-1).segments, reach.segments,
    "every retained segment is reachable before final assembly");
  assert.ok(passes.slice(1).some((f) => f.reemitted < f.definitions),
    "a later pass reuses output from unaffected definitions");
  console.log("PASS incremental emission " + JSON.stringify(passes));
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
