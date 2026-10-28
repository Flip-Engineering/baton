import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-streaming-c-"));
try {
  const observation = path.join(temporary, "observed.json"), preload = path.join(temporary, "observe.ts");
  fs.writeFileSync(preload, `
    import * as fs from "node:fs";
    let maximum = 0;
    for (const [prototype, name] of [[Array.prototype, "join"], [String.prototype, "replace"]]) {
      const original = prototype[name];
      prototype[name] = function(...args) {
        const result = Reflect.apply(original, this, args);
        if (typeof result === "string") maximum = Math.max(maximum, result.length);
        return result;
      };
    }
    process.on("exit", () => fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({ maximum })));
  `);
  const out = path.join(temporary, "output.c");
  const result = spawnSync(process.execPath, ["--smol", "--preload", preload,
    path.join(source, "main.ts"), path.join(root, "bend2/test/compiler/fixtures/emission_chain.bend"),
    "-o", out], { encoding: "utf8", env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
  assert.equal(result.status, 0, result.stderr);
  const generated = fs.readFileSync(out, "utf8");
  const { maximum } = JSON.parse(fs.readFileSync(observation, "utf8"));
  assert.ok(maximum < generated.length,
    "CLI replacement/join materialized the complete C: " + JSON.stringify({ maximum, generated: generated.length }));
  assert.ok(generated.includes("WL_TABLE"));
  console.log("PASS streaming C " + JSON.stringify({ maximum, generated: generated.length }));
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
