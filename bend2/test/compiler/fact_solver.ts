import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const Facts = await import(pathToFileURL(path.join(source, "facts.ts")).href);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "bend-fact-solver-"));
try {
  const lend = path.join(temporary, "lend"); fs.mkdirSync(lend);
  const result = Facts.solve({ graph: new Map([["f", new Set<string>()]]),
    entries: new Set(["f"]), generic: new Set<string>(), roots: ["f"], directory: lend,
    observe: () => {}, emit: (key, facts_only, initial, record) => {
      const view = Facts.views(initial, record), owned = view.own.has("f~0");
      if (!owned) view.stat.add("superseded");
      view.hot.add("independent");
      assert.ok(view.hot.has("independent"));
      return { code: owned, refs: new Set<string>(), edges: [],
        lend: new Set(owned ? ["f~0"] : []), masks: [["f", [true]]] };
    } });
  assert.ok(result.facts.own.has("f~0"));
  assert.equal(result.records.get("f")!.code, true);
  assert.ok(result.facts.stat.has("superseded"));
  assert.ok(!result.records.get("f")!.trace.wrote.has("stat:superseded"),
    "a historical producer remains valid after the final revision stops writing its fact");
  assert.ok(Facts.read_valid(result.records.get("f")!.trace.reads, result.facts));
  assert.deepEqual([...Facts.lend_own(Facts.empty(), result.records.get("f")!.lend,
    result.records.get("f")!.masks)], [], "the final lend inputs cannot reproduce the historical own write");
  const unexplained = Facts.snapshot(result.facts);
  unexplained.stat.add("unexplained");
  assert.throws(() => Facts.Journal.verify(result.history, unexplained), /no producer: stat:unexplained/);
  const rows = fs.readFileSync(result.history, "utf8").trim().split("\n").map(line => JSON.parse(line));
  const first = rows.find(row => row.kind === "unit");
  assert.deepEqual(first.events.at(-1), ["write", "hot", "independent"]);
  const bad = path.join(temporary, "bad-history");
  first.events[0][3] = true;
  fs.writeFileSync(bad, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  assert.throws(() => Facts.Journal.verify(bad, result.facts), /Fact replay read differs/);

  const rebuild = path.join(temporary, "rebuild"); fs.mkdirSync(rebuild);
  const observations: { event: string; details: any }[] = [];
  const initial_facts: string[] = [];
  const graph = new Map([["a", new Set(["b"])], ["b", new Set<string>()]]);
  const rebuilt = Facts.solve({ graph, entries: new Set(["a", "b"]), generic: new Set(["b"]),
    roots: ["a"], directory: rebuild, observe: (event, details) => observations.push({ event, details }),
    emit: (key, facts_only, initial, record) => {
      initial_facts.push(Facts.digest(initial));
      const view = Facts.views(initial, record);
      view.stat.add(key);
      return { code: key, lend: new Set<string>(), masks: [], refs: new Set(key === "a" ? ["b"] : []),
        edges: [[key, key === "a" ? "b" : "a"]] };
    } });
  assert.equal(Facts.levels(graph).get("a"), Facts.levels(graph).get("b"), "the discovered edge merges the SCC");
  const plans = observations.filter(row => row.event === "facts.plan");
  assert.equal(plans.length, 2, "the old schedule is replaced after discovery");
  assert.equal(initial_facts[0], Facts.digest(Facts.empty()));
  assert.ok(initial_facts.slice(1).every(value => value === Facts.digest(Facts.empty())),
    "reanalysis starts from empty facts and both SCC units read the same snapshot");
  assert.deepEqual([...rebuilt.facts.stat].sort(), ["a", "b"]);
  assert.ok(fs.existsSync(path.join(rebuild, "facts-0.jsonl")), "superseded analysis is retained");
  assert.ok(fs.existsSync(path.join(rebuild, "graph-1.json")));
  console.log("PASS historical lend replay, local writes and SCC schedule replacement");
} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
