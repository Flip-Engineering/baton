// Usage: bun bend2/test/compiler/cli_native_streaming.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { finished } from "node:stream/promises";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-native-streaming-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });
const json = (file: string): any => JSON.parse(fs.readFileSync(file, "utf8"));

async function run(name: string, argv: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const started = new Date().toISOString(), child = spawn(argv[0], argv.slice(1), {
    stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, BEND_NO_TELEMETRY: "1" },
  });
  const output = fs.createWriteStream(path.join(directory, name + ".stdout"));
  const errors = fs.createWriteStream(path.join(directory, name + ".stderr"));
  child.stdout.pipe(output); child.stderr.pipe(errors);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  await Promise.all([finished(output), finished(errors)]);
  fs.writeFileSync(path.join(directory, name + "-result.json"), JSON.stringify({
    argv, pid: child.pid, started, ended: new Date().toISOString(), code, signal: child.signalCode }));
  return { code, stdout: fs.readFileSync(path.join(directory, name + ".stdout"), "utf8"),
    stderr: fs.readFileSync(path.join(directory, name + ".stderr"), "utf8") };
}

try {
  const preload = path.join(directory, "observe.ts"), entry = path.join(directory, "main.bend");
  const binary = path.join(directory, "main");
  fs.writeFileSync(preload, `
    import fs from "node:fs";
    import * as path from "node:path";
    import { syncBuiltinESMExports } from "node:module";
    const original = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      const name = typeof file === "string" ? path.resolve(file) : "";
      if (name.startsWith(${JSON.stringify(path.resolve(directory) + path.sep)}) && name.endsWith(".c")) {
        throw new Error("Native build materialized generated C: " + name);
      }
      return Reflect.apply(original, this, [file, ...args]);
    };
    syncBuiltinESMExports();
  `);
  fs.writeFileSync(entry, 'import Base\n\ndef main() -> IO(Unit):\n  IO.print("42")\n');
  const built = await run("build", [process.execPath, "--smol", "--preload", preload,
    path.join(source, "main.ts"), entry, "-o", path.join(directory, "output.c"), "-o", binary]);
  assert.equal(built.code, 0, built.stderr);
  const executed = await run("binary", [binary]);
  assert.equal(executed.code, 0, executed.stderr);
  assert.equal(executed.stdout.trim(), "42");
  const evidence = fs.readdirSync(directory).find(name => name.startsWith(".bend-cgen-"));
  assert.ok(evidence, "the native build retains compiler and Clang results");
  const own = path.join(directory, evidence);
  const commands = fs.readdirSync(own).filter(name => name.startsWith("native-")).map(name =>
    json(path.join(own, name, "process-result.json")));
  assert.ok(commands.length > 0);
  for (const command of commands) {
    assert.equal(command.code, 0); assert.equal(command.signal, null);
    assert.ok(command.argv.includes("-std=c11"), "the completed command compiles the generated C");
  }
  console.log("PASS native CLI streams C and collects Clang before running the binary");
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
