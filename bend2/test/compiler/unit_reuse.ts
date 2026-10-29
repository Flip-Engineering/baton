// Usage: bun unit_reuse.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
//
// A cached unit applies when every header entry and body its emission read keeps its content
// identity. Each source change below is built twice: against a cache warmed by the original
// source, and against an empty cache. The two outputs must be the same C, and the units that
// were emitted again must be the ones whose inputs changed.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-unit-reuse-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });

function digest(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function build(name: string, text: string, cache: string, extra: NodeJS.ProcessEnv = {}) {
  const own = path.join(directory, name); fs.mkdirSync(own, { recursive: true });
  const input = path.join(own, "program.bend"), output = path.join(own, "output.c");
  fs.writeFileSync(input, text);
  const run = spawnSync(process.execPath, ["--smol", path.join(source, "main.ts"), input, "-o", output], {
    cwd: own, encoding: "utf8", maxBuffer: 1 << 28,
    env: { ...process.env, XDG_CACHE_HOME: cache, BEND_COMPILER_DIAGNOSTICS: "1", BEND_NO_TELEMETRY: "1", ...extra } });
  fs.writeFileSync(path.join(own, "stderr"), run.stderr);
  assert.equal(run.status, 0, run.stderr.split("\n").filter(line => !line.startsWith("{")).join("\n"));
  const frames = run.stderr.split("\n").flatMap(line => {
    try { const value = JSON.parse(line); return typeof value === "object" && value !== null ? [value] : []; }
    catch { return []; }
  });
  const events = frames.filter(frame => String(frame.compiler_diagnostic).startsWith("cache."));
  const named = (kind: string) => events.filter(event => event.compiler_diagnostic === "cache." + kind);
  return { sha256: digest(output), hits: named("hit").length, emitted: named("write").map(event => event.unit as string).sort() };
}

type Case = { name: string; text: string; emitted: string[] };

function scenario(label: string, original: string, cases: Case[]) {
  const cache = path.join(directory, label + "-cache");
  const cold = build(label + "-cold-original", original, cache);
  assert.ok(cold.emitted.length > 2, label + ": the fixture has several units");
  const rerun = build(label + "-same", original, cache);
  assert.equal(rerun.sha256, cold.sha256);
  assert.deepEqual(rerun.emitted, [], label + ": an unchanged build emits no unit");
  assert.equal(rerun.hits, cold.emitted.length);
  const summary: Record<string, unknown>[] = [];
  for (const item of cases) {
    const warm = build(label + "-" + item.name + "-warm", item.text, cache);
    const fresh = build(label + "-" + item.name + "-cold", item.text, path.join(directory, label + "-" + item.name + "-cache"));
    assert.equal(warm.sha256, fresh.sha256, label + " " + item.name + ": a reused unit leaves the C unchanged");
    assert.deepEqual(warm.emitted, item.emitted, label + " " + item.name + ": units emitted again");
    assert.equal(warm.hits + warm.emitted.length, fresh.emitted.length, label + " " + item.name + ": every unit is reused or emitted");
    summary.push({ label, name: item.name, units: fresh.emitted.length, reused: warm.hits, emitted: warm.emitted,
      changed_c: warm.sha256 !== cold.sha256 });
  }
  return { cold, summary };
}

try {
  const chain = `import Base

def r1(n: Nat) -> U32:
  match n:
    case 0n: 1
    case 1n+p: U32.add(r1(p), 1)

def r2(n: Nat) -> U32:
  match n:
    case 0n: 2
    case 1n+p: U32.add(r2(p), 2)

def r3(n: Nat) -> U32:
  match n:
    case 0n: 3
    case 1n+p: U32.add(r3(p), 3)

def r4(n: Nat) -> U32:
  match n:
    case 0n: 4
    case 1n+p: U32.add(r4(p), r1(2n))

def r5(n: Nat) -> U32:
  match n:
    case 0n: 5
    case 1n+p: U32.add(r5(p), 5)

def r6(n: Nat) -> U32:
  match n:
    case 0n: 6
    case 1n+p: U32.mul(r6(p), 1)

def main() -> U32:
  U32.add(U32.add(U32.add(r1(3n), r2(4n)), U32.add(r3(5n), r4(6n))), U32.add(r5(7n), r6(8n)))
`;
  const one = scenario("chain", chain, [
    { name: "leading-comment", text: "# a comment above every definition\n" + chain, emitted: [] },
    { name: "unused-definition", text: chain.replace("def main", "def unused(x: U32) -> U32:\n  U32.add(x, 99)\n\ndef main"), emitted: [] },
    { name: "unused-type", text: chain.replace("def main", "type Pair2 is Data:\n  Both{a: U32, b: U32}\n\ndef main"), emitted: [] },
    { name: "body-same-length", text: chain.replace("U32.add(r3(p), 3)", "U32.add(r3(p), 7)"), emitted: ["r3"] },
    { name: "body-longer", text: chain.replace("U32.add(r3(p), 3)", "U32.add(U32.add(r3(p), 3), 11)"), emitted: ["r3"] },
    { name: "entry-edit", text: chain.replace("r5(7n)", "r5(9n)"), emitted: ["main"] },
    { name: "callee-signature",
      text: chain.replace("def r6(n: Nat) -> U32:\n  match n:\n    case 0n: 6\n    case 1n+p: U32.mul(r6(p), 1)",
        "def r6(n: Nat, k: U32) -> U32:\n  match n:\n    case 0n: 6\n    case 1n+p: U32.mul(r6(p, k), 1)").replace("r6(8n)", "r6(8n, 1)"),
      emitted: ["main", "r6"] },
  ]);

  // The body of loop_a does not change when loop_b adds a second call site to helper.
  // helper stops being inlined into loop_a, so loop_a's C changes with the call-site count.
  const sites = `import Base

def helper(x: U32) -> U32:
  U32.add(x, 3)

def loop_a(n: Nat) -> U32:
  match n:
    case 0n: helper(1)
    case 1n+p: U32.add(loop_a(p), 1)

def pad(n: Nat) -> U32:
  match n:
    case 0n: 0
    case 1n+p: U32.add(pad(p), 2)

def main() -> U32:
  U32.add(loop_a(5n), pad(4n))
`;
  const two = scenario("sites", sites, [
    { name: "second-call-site", text: sites.replace("def main() -> U32:\n  U32.add(loop_a(5n), pad(4n))\n", `def loop_b(n: Nat) -> U32:
  match n:
    case 0n: helper(2)
    case 1n+p: U32.add(loop_b(p), 2)

def main() -> U32:
  U32.add(U32.add(loop_a(5n), pad(4n)), loop_b(1n))
`),
      emitted: ["loop_a", "loop_b", "main"] },
  ]);
  // Builds that run under different home directories share units through BEND_CGEN_CACHE_DIR.
  const shared = path.join(directory, "shared-cache");
  const first = build("shared-first", chain, path.join(directory, "home-a"), { BEND_CGEN_CACHE_DIR: shared });
  const second = build("shared-second", chain.replace("U32.add(r3(p), 3)", "U32.add(r3(p), 7)"),
    path.join(directory, "home-b"), { BEND_CGEN_CACHE_DIR: shared });
  assert.deepEqual(second.emitted, ["r3"], "a build under another home reuses the shared directory");
  assert.equal(first.hits, 0);
  assert.ok(fs.existsSync(path.join(shared, "cgen-units-v1")));
  assert.ok(!fs.existsSync(path.join(directory, "home-a", "bend2")) && !fs.existsSync(path.join(directory, "home-b", "bend2")));
  fs.writeFileSync(path.join(directory, "summary.json"), JSON.stringify([...one.summary, ...two.summary], null, 2));
  console.log(JSON.stringify({ test: "unit_reuse", chain_units: one.cold.emitted.length, sites_units: two.cold.emitted.length,
    cases: [...one.summary, ...two.summary] }));
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
