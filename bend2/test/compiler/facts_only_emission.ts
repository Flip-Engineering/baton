// A facts-only unit retains the analysis result that full emission produces.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? path.join(import.meta.dir, "../../.."));
const source = process.env.BEND_COMPILER_SOURCE ?? path.join(root, "bend2/compiler/upstream");
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bend-facts-only-"));
const url = (name: string): string => pathToFileURL(path.join(source, name)).href;
const Driver = await import(url("driver.ts"));
const Comp = await import(url("comp.ts"));
const Fact = await import(url("facts.ts"));

function sorted<T>(values: Iterable<T>): T[] {
  return [...values].sort((a, b) => String(a).localeCompare(String(b)));
}

try {
  for (const [fixture, unit] of [["emission_chain.bend", "main"],
    ["poly_spin_hot.bend", "main"], ["facts_only_table.bend", "match_table"]]) {
    const entry = path.join(root, "bend2/test/compiler/fixtures", fixture);
    const prepared = await Driver.prepare(entry, workspace);
    let full_inputs: unknown, full_reads: unknown;
    let fact_inputs: unknown, fact_reads: unknown;
    const full_record = Fact.trace();
    const full = Comp.unit_emitter(prepared.directory, (inputs: unknown, reads: unknown) => {
      full_inputs = inputs; full_reads = reads;
    })(unit, false, Fact.empty(), full_record);
    const fact_record = Fact.trace();
    const facts = Comp.unit_emitter(prepared.directory, (inputs: unknown, reads: unknown) => {
      fact_inputs = inputs; fact_reads = reads;
    })(unit, true, Fact.empty(), fact_record);
    assert.deepEqual(fact_record.events, full_record.events,
      fixture + ": facts-only and full unit fact traces agree");
    assert.deepEqual(sorted(facts.lend), sorted(full.lend), fixture + ": lend facts agree");
    assert.deepEqual(facts.masks, full.masks, fixture + ": borrow masks agree");
    assert.deepEqual(sorted(facts.refs), sorted(full.refs), fixture + ": external references agree");
    assert.deepEqual(facts.edges, full.edges, fixture + ": obligation edges agree");
    assert.deepEqual(fact_reads, full_reads, fixture + ": header dependencies agree");
    assert.deepEqual(fact_inputs, full_inputs, fixture + ": checked body dependencies agree");
    assert.ok(full.code.bytes > 0, fixture + ": full emission produces C");
    if (fixture === "facts_only_table.bend") {
      assert.ok(full.code.tabs.length > 0, "table fixture takes the table-lowering path in full emission");
    }
  }
  console.log("PASS facts-only emission preserves unit facts and references");
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
