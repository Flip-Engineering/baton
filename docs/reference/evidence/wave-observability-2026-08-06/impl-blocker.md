# #132 IMPL BLOCKER — the §4 enumeration-count contradictions

Filed during the #132 implementation (2026-08-07). Two `34 → 35` count-drift rows
surfaced once `baton_waves_list` landed in the MCP ordinary surface. Per the impl
brief's campaign law — *"If a row is unsatisfiable-as-written, write the
contradiction to `impl-blocker.md`"* — and its explicit *"do NOT edit the red
suite's rows yourself"* clause, the two rows are treated differently:

## 1. `wave-observability-red.test.mjs` A3-2 — UNRESOLVED (left untouched)

`impl/test/wave-observability-red.test.mjs:799` and `:805` assert the ordinary
MCP enumeration count is **34**:

```js
assert.equal(names.length, 34,
  'stage: mcp-waves-list-row-missing — the pinned MCP enumeration is 33 at HEAD ...; §4 inserts baton_waves_list (33 → 34)');
...
assert.equal(sorted.length, 34, 'the sorted ordinary surface grows to 34 tools');
```

The row's position pins (14 `baton_waves_stop`, 15 `baton_waves_list`) are
satisfied, but the **count baseline is stale**: the red suite was authored
against "33 tools at HEAD", whereas HEAD actually carries **34** ordinary tools —
`baton_waves_run` (#114, contract-required) had already landed, and
`mcp-reflex-surface-red.test.mjs:201` pinned 34 at HEAD. The §4 drift is a
**+1** on top of that, so the real post-insertion count is **35**, not 34.

A3-2 is a row of the red suite (the epic's own target). The impl brief forbids
editing the red suite's rows (`impl-132-brief.md:38-40`), so the row was left
untouched. **Consequence: `node --test impl/test/wave-observability-red.test.mjs`
reports 29/30 — A3-2 fails on the two count assertions only.** The position and
inclusion assertions pass; the new enumeration lands exactly where A3-2 pins it.

Suggested resolution for the suite owner: re-base A3-2's count on "34 at HEAD →
35" (matching `mcp-reflex-surface-red.test.mjs:201` after the §4 edit).

## 2. `workflow-surface-red.test.mjs` FP-14 — RESOLVED (brief-owned §4 drift edit)

`impl/test/workflow-surface-red.test.mjs:1429` asserted the ordinary surface
count is **34** ("the landed 27 + the six + baton_waves_run (#114,
contract-required)"). The impl brief names this exact row in the §4 drift —
*"the workflow-surface FP-14 count moves 34→35"* (`impl-132-brief.md:37-38`) —
so the count was updated to **35** with `baton_waves_list (#132)` named in the
assertion message. This is the deliberate enumeration drift the brief owns (its
landing commit message owns it), **not** a weakening edit; every other FP-14
assertion is unchanged and the suite is green (37/37).

## Verification splits (repo root, 2026-08-07)

| Command | Result |
|---|---|
| `node --test impl/test/wave-observability-red.test.mjs` | 29/30 — A3-2 count drift (§1 above) |
| `node --test impl/test/workflow-surface-red.test.mjs` | 37/37 |
| `node --test impl/test/mcp-reflex-surface-red.test.mjs` | 21/21 |
| `node impl/scripts/surface-conformance.mjs` | ok |
| `node --test impl/test/phase16-mcp-northbound.test.mjs` | 29/29 |
| `node --test impl/test/phase67-progressive-agent-experience.test.mjs` | 12/12 |
| `node --test impl/test/phase72-kimi-orchestrator-mcp.test.mjs` | 20/20 |
