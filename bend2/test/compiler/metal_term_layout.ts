// The Metal window kernel decodes the term tag itself. It must use the same
// 3-bit tag at bits 60..62 as the C term layout, and no embedded effect may
// keep the old 56-bit tag read or mask.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const source = path.join(import.meta.dir, "../../compiler/upstream");
const window = fs.readFileSync(path.join(source, "effs/window_frame.c"), "utf8");
assert.match(window, /\(\(t >> 60\) & 0x7\) == TAG_CTR/,
  "Metal window kernel decodes the 3-bit tag at bit 60");
assert.ok(!window.includes(">> 56") && !window.includes("0x7f"),
  "the Metal window kernel keeps no old tag constant");
for (const macro of ["TAG_CTR", "RFC_BIT", "LOC_MASK"]) {
  assert.ok(window.includes(`WIN_DEF(${macro})`), `Metal shader receives ${macro}`);
}
assert.ok(window.includes("t & LOC_MASK"), "Metal window kernel keeps the 40-bit location");

const comp = fs.readFileSync(path.join(source, "comp.ts"), "utf8");
for (const layout of ["((u64)(tag) << 60)", "(t >> 60) & 0x7",
  "(t >> 40) & 0xFFFFF", "((u64)arr << 61)", "LOC_MASK ((1ull << 40) - 1)"]) {
  assert.ok(comp.includes(layout), `compiler C layout has ${layout}`);
}

for (const name of fs.readdirSync(path.join(source, "effs")).filter((n) => n.endsWith(".c"))) {
  const text = fs.readFileSync(path.join(source, "effs", name), "utf8");
  assert.ok(!text.includes(">> 56") && !text.includes("0x7f"),
    `${name} keeps no old term tag constant`);
}
console.log("PASS metal term layout: tag 60..62, aux 20, loc 40, no old constants");
