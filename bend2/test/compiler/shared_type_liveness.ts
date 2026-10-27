// Usage: bun bend2/test/compiler/shared_type_liveness.ts [REPOSITORY_ROOT]
// Exercise v_live with production traversal code copied into a temporary module.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import * as Bend from "../../compiler/upstream/bend.ts";

type Module = {
  v_live(cb: { book: { tlds: Record<string, Bend.TLD & { h?: Bend.HTerm }>; ctrs: Record<string, Bend.Ctr> } }): Set<string>;
  test_counts: { type_calls: number; type_nodes: number; type_opens: number };
  test_diagnostics: { event: string; details: Record<string, unknown> }[];
  test_reset(): void;
  test_set_srckeys(names: string[]): void;
};

function replaceOnce(source: string, before: string, after: string): string {
  assert.equal(source.split(before).length, 2, `expected one source anchor: ${before}`);
  return source.replace(before, after);
}

function priorTraversal(source: string): string {
  const annStart = source.indexOf("function ann_live(");
  const liveStart = source.indexOf("// The defs whose parsed body", annStart);
  const liveEnd = source.indexOf("// Flat\n", liveStart);
  assert.ok(annStart >= 0 && liveStart > annStart && liveEnd > liveStart);
  let ann = source.slice(annStart, liveStart);
  ann = ann.replaceAll(", type_seen)", ")");
  let live = source.slice(liveStart, liveEnd);
  live = live.replaceAll(", type_seen)", ")");
  const shared = "  const type_seen = new WeakSet<HTerm>();\n";
  assert.ok(live.includes(shared), "shared-set source anchor");
  live = live.replace(shared, "");
  return source.slice(0, annStart) + ann + live + source.slice(liveEnd);
}

// The source before this change walked each parsed body with a fresh visited
// set.
function retainedClosure(source: string): string {
  return replaceOnce(source, "type_live(tld.v, got, type_seen);",
    "type_live(tld.v, got);");
}

function instrument(source: string): string {
  source = replaceOnce(source,
    'const DIAGNOSTICS = process.env.BEND_COMPILER_DIAGNOSTICS === "1";',
    'const DIAGNOSTICS = process.env.BEND_COMPILER_DIAGNOSTICS === "1";\n'
      + 'const test_counts = { type_calls: 0, type_nodes: 0, type_opens: 0 };\n'
      + 'const test_diagnostics: { event: string; details: Record<string, unknown> }[] = [];');
  source = replaceOnce(source, "function type_live(", "export function type_live(");
  source = replaceOnce(source, "function ann_live(", "export function ann_live(");
  source = replaceOnce(source, "function v_live(", "export function v_live(");
  source = replaceOnce(source,
    '  if (DIAGNOSTICS) diagnostic_context = { event, details };',
    '  if (DIAGNOSTICS) { test_diagnostics.push({ event, details }); '
      + 'diagnostic_context = { event, details }; }');

  const start = source.indexOf("export function type_live(");
  const end = source.indexOf("// The types a higher body carries", start);
  assert.ok(start >= 0 && end > start);
  let type = source.slice(start, end);
  type = replaceOnce(type, "): void {", "): void {\n  test_counts.type_calls += 1;");
  type = replaceOnce(type, "    seen.add(s);", "    seen.add(s);\n    test_counts.type_nodes += 1;");
  type = replaceOnce(type, '      case "Lam":\n        stack.push(',
    '      case "Lam":\n        test_counts.type_opens += 1;\n        stack.push(');
  type = replaceOnce(type, '      case "All":\n        stack.push(',
    '      case "All":\n        test_counts.type_opens += 1;\n        stack.push(');
  source = source.slice(0, start) + type + source.slice(end);

  return source + `
export { Bend as TestBend };
export { test_counts, test_diagnostics };
export function test_reset(): void {
  test_counts.type_calls = 0;
  test_counts.type_nodes = 0;
  test_counts.type_opens = 0;
  test_diagnostics.length = 0;
}
export function test_set_srckeys(names: string[]): void {
  SRCS.clear();
  for (const name of names) SRCS.set(name, { refs: new Set(), deps: new Set(), flat: true });
}
`;
}

function sharedType(depth: number): Bend.HTerm {
  let body: Bend.HTerm = Bend.Ref("SharedLeaf");
  for (let i = depth - 1; i >= 0; --i) {
    const next = body;
    body = Bend.All(Bend.Lone(), `a${i}`, i, Bend.Ref(`Domain${i}`), () => next);
  }
  return body;
}
const annotation = (type: Bend.HTerm): Bend.HTerm =>
  Bend.Ann(Bend.Ref("value"), type);
function definition(T: Bend.HTerm, v: Bend.HTerm | null, h?: Bend.HTerm): Bend.Def & { h?: Bend.HTerm } {
  return { $: "Def", n: 0, x: 0, T, v, h };
}

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const upstream = path.join(root, "bend2/compiler/upstream");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bend-shared-type-liveness-"));
const previousDiagnostics = process.env.BEND_COMPILER_DIAGNOSTICS;
process.env.BEND_COMPILER_DIAGNOSTICS = "1";
try {
  for (const name of ["bend.ts", "base.bend"]) {
    fs.copyFileSync(path.join(upstream, name), path.join(temp, name));
  }
  const source = fs.readFileSync(path.join(upstream, "comp.ts"), "utf8");
  fs.writeFileSync(path.join(temp, "current.ts"), instrument(source));
  fs.writeFileSync(path.join(temp, "prior.ts"), instrument(priorTraversal(source)));
  fs.writeFileSync(path.join(temp, "retained.ts"), instrument(retainedClosure(source)));
  const current = await import(pathToFileURL(path.join(temp, "current.ts")).href) as Module;
  const prior = await import(pathToFileURL(path.join(temp, "prior.ts")).href) as Module;
  const retained = await import(pathToFileURL(path.join(temp, "retained.ts")).href) as Module;

  const depth = 64;
  const shared = sharedType(depth);
  const left = Bend.App(Bend.Ref("DistinctLeft"), shared);
  const right = Bend.ADT("DistinctRight", [shared]);
  const mainBody = Bend.Ctr("Body", [
    ...Array.from({ length: 128 }, () => annotation(shared)),
    annotation(Bend.Ref("C")),
  ]);
  const book = {
    tlds: {
      main: definition(shared, Bend.Ref("ClosureA"), mainBody),
      A: definition(shared, null, Bend.Ctr("BodyA", [annotation(left)])),
      B: definition(left, null, Bend.Ctr("BodyB", [annotation(right)])),
      ClosureA: definition(Bend.Ref("SigClosureA"),
        Bend.App(Bend.Ref("ClosureB"), Bend.Ref("ClosureNameA"))),
      ClosureB: definition(Bend.Ref("SigClosureB"), Bend.Ref("ClosureNameB")),
      C: definition(shared, Bend.App(Bend.Ref("DistinctClosure"), shared),
        Bend.Ctr("BodyC", [])),
    },
    ctrs: { TestCtor: { k: "TestCtor", n: 0, T: right } },
  } as unknown as { tlds: Record<string, Bend.TLD & { h?: Bend.HTerm }>; ctrs: Record<string, Bend.Ctr> };
  const expected = new Set([
    "main", "C", "SharedLeaf", "DistinctLeft", "DistinctRight", "DistinctClosure",
    "SigClosureA", "SigClosureB", "ClosureA", "ClosureB", "ClosureNameA",
    "ClosureNameB", ...Array.from({ length: depth }, (_, i) => `Domain${i}`),
  ]);
  const results: Set<string>[] = [];
  const states: Module["test_counts"][] = [];
  for (const [label, mod] of [["prior", prior], ["retained", retained],
    ["current", current]] as [string, Module][]) {
    mod.test_set_srckeys(["main", "A", "B", "C"]);
    mod.test_reset();
    const live = mod.v_live({ book });
    assert.deepEqual([...live].sort(), [...expected].sort(), label + " live names");
    assert.deepEqual(mod.test_diagnostics.map(({ event, details }) => [event, details.definition]), [
      ["pass.v_live.ann_live.begin", "main"], ["pass.v_live.ann_live.end", "main"],
      ["pass.v_live.ann_live.begin", "A"], ["pass.v_live.ann_live.end", "A"],
      ["pass.v_live.ann_live.begin", "B"], ["pass.v_live.ann_live.end", "B"],
      ["pass.v_live.ann_live.begin", "C"], ["pass.v_live.ann_live.end", "C"],
    ], label + " per-definition diagnostics");
    results.push(live);
    states.push({ ...mod.test_counts });
  }
  assert.deepEqual([...results[0]].sort(), [...results[2]].sort(), "prior/current live names");
  assert.deepEqual([...results[1]].sort(), [...results[2]].sort(), "retained/current live names");
  assert.equal(states[2].type_opens, depth, "shared type graph opens once including parsed bodies");
  assert.equal(states[1].type_opens, 2 * depth, "retained closure re-opens the shared type");
  assert.equal(states[1].type_nodes - states[2].type_nodes, 2 * depth + 1,
    "closure skips the visited shared type graph");
  assert.ok(states[0].type_opens > 8_000, "prior traversal repeats shared All openings");
  assert.ok(states[2].type_nodes < 200, "current traversal visits unique shared graph nodes");
  console.log(`PASS shared type liveness: names unchanged; All openings ${states[0].type_opens}`
    + ` -> ${states[1].type_opens} -> ${states[2].type_opens}; type nodes`
    + ` ${states[0].type_nodes} -> ${states[1].type_nodes} -> ${states[2].type_nodes};`
    + " parsed-body closure verified");
} finally {
  if (previousDiagnostics === undefined) delete process.env.BEND_COMPILER_DIAGNOSTICS;
  else process.env.BEND_COMPILER_DIAGNOSTICS = previousDiagnostics;
  fs.rmSync(temp, { recursive: true, force: true });
}
