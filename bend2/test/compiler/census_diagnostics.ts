// Usage: bun bend2/test/compiler/census_diagnostics.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-census-"));
try {
  let spin_count = 0;
  for (const name of ["emission_chain", "ref_bang_marked"]) {
    const outputs = [false, true].map((enabled) => {
      const out = path.join(temporary, name + String(enabled) + ".c");
      const result = spawnSync(process.execPath, ["--smol",
        path.join(root, "bend2/compiler/upstream/main.ts"),
        path.join(import.meta.dir, "fixtures", name + ".bend"), "-o", out], {
        encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1",
          BEND_COMPILER_DIAGNOSTICS: enabled ? "1" : "0" },
      });
      assert.equal(result.status, 0, result.stderr);
      const frames = result.stderr.split("\n").flatMap((line) => {
        try { return [JSON.parse(line)]; } catch { return []; }
      });
      if (enabled) {
        const census = frames.filter((f) => f.compiler_diagnostic === "heap.census");
        assert.ok(census.some((f) => f.phase === "checker.release"));
        assert.equal(census.filter((f) => f.phase === "pass.end").length,
          frames.filter((f) => f.compiler_diagnostic === "pass.end").length);
        for (const sample of census) {
          assert.ok(sample.heapSize > 0 && sample.objectCount > 0);
          assert.ok(sample.heapCapacity >= sample.heapSize);
          assert.ok(sample.objectTypeCounts.Function > 0);
        }
        const writes = frames.filter((f) => f.compiler_diagnostic === "fact.write");
        assert.ok(writes.length > 0);
        assert.equal(new Set(writes.map((f) => f.kind + ":" + f.key)).size, writes.length,
          "the first writer of each fact is recorded once");
        assert.ok(writes.every((f) => typeof f.writer === "string" && "unit" in f));
        const spins = frames.filter((f) => f.compiler_diagnostic === "spin.emit");
        spin_count += spins.length;
        assert.ok(spins.every((f) => typeof f.layout_key === "string"
          && (f.kind === "arm" ? f.erased_key === null : typeof f.erased_key === "string")
          && typeof f.unit === "string"
          && f.lines > 0 && f.duration_ms >= 0));
        const definitions = frames.filter((f) => f.compiler_diagnostic === "definition.end");
        assert.ok(definitions.every((f) => f.absent_reads >= 0 && f.writes >= 0 && f.lend >= 0));
        const columns = frames.filter((f) => f.compiler_diagnostic === "literal.columns");
        assert.equal(columns.length, definitions.length);
        assert.ok(columns.every((f) => f.word_leaves >= 0 && f.word_nodes >= 0
          && f.string_column_nodes >= 0));
      } else {
        assert.equal(frames.length, 0);
      }
      return fs.readFileSync(out, "utf8");
    });
    assert.equal(outputs[1], outputs[0], name + " C is unchanged by diagnostics");
  }
  assert.ok(spin_count > 0, "the fixtures emit native or shared-arm helpers");
  console.log("PASS compiler heap, fact, spin and literal census with identical C");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
