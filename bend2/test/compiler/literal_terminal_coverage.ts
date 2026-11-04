// Usage: bun bend2/test/compiler/literal_terminal_coverage.ts [REPOSITORY_ROOT]
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bend-literal-coverage-"));
const source = fs.readFileSync(path.join(import.meta.dir,
  "fixtures/literal_terminal_nil.bend"), "utf8");
const env = { ...process.env, BEND_NO_TELEMETRY: "1", BEND_COMPILER_DIAGNOSTICS: "1" };
function compile(name: string, text: string) {
  const input = path.join(directory, name + ".bend");
  const output = path.join(directory, name + ".c");
  fs.writeFileSync(input, text);
  return { output, run: spawnSync(process.execPath, ["--smol",
    path.join(root, "bend2/compiler/upstream/main.ts"), input, "-o", output],
    { encoding: "utf8", env }) };
}
try {
  const nil = '    case Nil{}: Fail{(2,"Supply source.")}';
  const con = '    case source <> rest: options(rest,[Field{"--source",source}])';
  for (const [name, text] of [["terminal_nil", source],
    ["terminal_con", source.replace(con + "\n" + nil, nil + "\n" + con)]]) {
    const { output, run } = compile(name, text);
    assert.equal(run.status, 0, name + " checks and emits C: " + run.stderr);
    const binary = path.join(directory, name);
    execFileSync(process.env.CC ?? "clang-19",
      ["-std=c11", "-O1", "-pthread", output, "-lm", "-o", binary]);
    for (const [args, expected] of [
      [[], "0"], [["--stdin"], "1"], [["text"], "1"],
      [["text", "--x", "y"], "2"], [["text", "--x"], "0"],
    ] as [string[], string][]) {
      assert.equal(execFileSync(binary, args, { encoding: "utf8" }).trim(), expected,
        name + " " + JSON.stringify(args));
    }
    console.log("PASS literal terminal coverage and C execution: " + name);
  }
  const incomplete = compile("incomplete", source.replace("\n" + nil, ""));
  assert.notEqual(incomplete.run.status, 0, "a missing Nil row remains a checker error");
  assert.match(incomplete.run.stderr, /Error:/, incomplete.run.stderr);
  console.log("PASS incomplete literal list match is rejected");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
