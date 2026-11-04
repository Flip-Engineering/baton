// Usage: bun bend2/test/compiler/iterative_term_lower.ts
// Verify term_lower handles a deeply nested source term without using the
// JavaScript call stack for each application node.
import assert from "node:assert/strict";
import * as Bend from "../../compiler/upstream/bend.ts";

const depth = 50_000;
let term: Bend.HTerm = Bend.Ref("leaf");
for (let i = 0; i < depth; i += 1) {
  term = Bend.App(term, Bend.Ref("argument"));
}

let lowered: Bend.LTerm = Bend.term_lower(term);
let applications = 0;
while (lowered.$ === "App") {
  assert.equal(lowered.x.$, "Ref");
  applications += 1;
  lowered = lowered.f;
}
assert.equal(applications, depth);
assert.equal(lowered.$, "Ref");
assert.equal(lowered.k, "leaf");
console.log(`PASS term_lower at ${depth} nested application nodes`);
