// Usage: bun unit_worker_reads.ts [REPOSITORY_ROOT] [ARTIFACT_DIR]
//
// A worker emits many units in turn. The header entries recorded for a unit must be the entries a
// process that emits only that unit reads. Each unit is emitted last, after every other unit, in one
// process, and alone in a fresh process. The two sets of recorded reads must be equal.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const directory = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "bend-worker-reads-"));
const retained = process.argv[3] !== undefined;
fs.mkdirSync(directory, { recursive: true });

const program = `import Base

type Colour is Data:
  Red{}
  Green{}
  Blue{}

type Shade is Data:
  Light{c: Colour}
  Dark{c: Colour}

def rank(c: Colour) -> Nat:
  match c:
    case Red{}: 1n
    case Green{}: 2n
    case _: 0n

def next(c: Colour) -> Colour:
  match c:
    case Red{}: Green{}
    case Green{}: Blue{}
    case _: Red{}

def twice(c: Colour) -> Colour:
  next(next(c))

def shade_rank(s: Shade) -> Nat:
  match s:
    case Light{c}: rank(twice(c))
    case Dark{c}: rank(c)

def score(+c: Colour) -> Nat:
  Nat.add(rank(c), rank(twice(c)))

def main() -> IO(Unit):
  IO.print(Nat.show(Nat.add(score(Blue{}), shade_rank(Light{Red{}}))))
`;
const poly = fs.readFileSync(path.join(root, "bend2/test/compiler/fixtures/poly_spin_hot.bend"), "utf8");
const programs: [string, string][] = [["colour", program], ["poly", poly]];

// Runs in a child process: prepare the program (mode "prepare") or emit units in the order given.
const runner = path.join(directory, "runner.ts");
fs.writeFileSync(runner, `
  import * as fs from "node:fs";
  import * as path from "node:path";
  import { pathToFileURL } from "node:url";
  const source = ${JSON.stringify(source)};
  const [mode, ...rest] = process.argv.slice(2);
  const Comp = await import(pathToFileURL(path.join(source, "comp.ts")).href);
  const Fact = await import(pathToFileURL(path.join(source, "facts.ts")).href);
  if (mode === "prepare") {
    const Main = await import(pathToFileURL(path.join(source, "main.ts")).href);
    const prepared = await Main.prepare_file(rest[0], rest[1], []);
    console.log(prepared.directory);
  } else {
    const [dir, ...units] = rest;
    let reads = null;
    const emit = Comp.unit_emitter(dir, (inputs, header) => { reads = { inputs: inputs.map(i => i.name + ":" + i.content), header }; });
    const out = {};
    for (const unit of units) {
      emit(unit, false, Fact.empty(), Fact.trace());
      out[unit] = reads;
    }
    console.log(JSON.stringify(out));
  }
`);

function run(args: string[]): string {
  const result = spawnSync(process.execPath, ["--smol", runner, ...args], { encoding: "utf8", maxBuffer: 1 << 28,
    env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function attempt(args: string[]): string | null {
  const result = spawnSync(process.execPath, ["--smol", runner, ...args], { encoding: "utf8", maxBuffer: 1 << 28,
    env: { ...process.env, BEND_NO_TELEMETRY: "1" } });
  return result.status === 0 ? result.stdout : null;
}

try {
  const checked: Record<string, number> = {};
  for (const [label, text] of programs) {
    const input = path.join(directory, label + ".bend");
    fs.writeFileSync(input, text);
    const workspace = path.join(directory, "work-" + label); fs.mkdirSync(workspace);
    const prepared = run(["prepare", input, workspace]).trim().split("\n").at(-1)!;
    const declared = new Set([...text.matchAll(/^def ([A-Za-z_][A-Za-z0-9_]*)/gm)].map(match => match[1]));
    const graph: [string, string[]][] = JSON.parse(fs.readFileSync(path.join(prepared, "program.json"), "utf8")).graph;
    // A unit is a declared definition that a fresh emitter can emit.
    const units = graph.map(([name]) => name).filter(name => declared.has(name)
      && attempt(["emit", prepared, name]) !== null);
    assert.ok(units.length >= 5, label + ": the program has several units");
    for (const unit of units) {
      const alone = JSON.parse(run(["emit", prepared, unit]))[unit];
      const others = units.filter(name => name !== unit);
      const after = JSON.parse(run(["emit", prepared, ...others, unit]))[unit];
      assert.deepEqual(after, alone, label + " " + unit + ": reads recorded after other units match a fresh emitter");
      checked[label + ":" + unit] = alone.header.names.length;
    }
  }
  console.log(JSON.stringify({ test: "unit_worker_reads", reads: checked }));
} finally { if (!retained) fs.rmSync(directory, { recursive: true, force: true }); }
