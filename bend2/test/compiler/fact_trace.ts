import assert from "node:assert/strict";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const Facts = await import(pathToFileURL(path.join(source, "facts.ts")).href);
for (const present of [false, true]) {
  const initial = Facts.empty();
  if (present) initial.hot.add("k");
  const trace = Facts.trace(), view = Facts.views(initial, trace);
  view.hot.add("k");
  assert.ok(view.hot.has("k"));
  assert.deepEqual([...trace.reads], [], "local writes answer reads in both snapshot states");
  assert.ok(Facts.replay_trace(trace.events, initial, "local").hot.has("k"));
}
const record = Facts.trace(), view = Facts.views(Facts.empty(), record);
view.hot.add("a");
assert.equal(view.hot.has("b"), false);
view.hot.add("c");
assert.deepEqual(record.events, [["write", "hot", "a"], ["read", "hot", "b", false],
  ["write", "hot", "c"]]);
view.hot.has("b");
view.hot.add("a");
assert.equal(record.events.length, 3, "fixed snapshot answers and repeated writes share their trace positions");

const expected = Facts.empty();
expected.hot.add("a"); expected.hot.add("c");
expected.own.add("f~0");
const history = [
  { kind: "units", units: [{ key: "earlier", events: record.events }] },
  { kind: "lend", asks: [], masks: [["f", [true]]], added: ["f~0"] },
  { kind: "lend", asks: ["f~0"], masks: [["f", [true]]], added: [] },
];
Facts.replay(history, expected);
assert.deepEqual([...Facts.lend_own(Facts.empty(), ["f~0"], [["f", [true]]])], [],
  "final negative lend data cannot reproduce the earlier own producer");
expected.stat.add("unexplained");
assert.throws(() => Facts.replay(history, expected), /no producer: stat:unexplained/);
console.log("PASS local fact writes, trace prefixes and historical negative lend replay");
