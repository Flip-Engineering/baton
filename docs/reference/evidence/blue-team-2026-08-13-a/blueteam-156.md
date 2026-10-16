# BLUE-TEAM #156 — mcp-profile-parity-red suite (row-bt156)

[attempt: 08338cdd-d549-4375-98ee-af1a313938d5 row-bt156]

**Target:** `impl/test/mcp-profile-parity-red.test.mjs` (543 lines; restored from git `ba78989`
for the split — absent from this worktree's HEAD `e371f70`, which predates the suite-foundry commit
on `master`; the code under attack is byte-identical at HEAD vs `ba78989`, verified).
**Authority:** `docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md`
(v1.1 FOLDED) + `fold-156.md` + `redteam-156.md` (all read from that dir).
**Laws:** foundry brief (blue-team law, attempt-echo #171, split-twice); row brief (`row-bt156.md`).

Verdict per row: **SOUND** / **SHALLOW** (named cheap wrong impl passes) / **DECORATIVE** (pin bites
nothing) / **BROKEN** (red/green for the wrong reason). Final: **NEEDS-FOLD** — see the four folds.

---

## 1. Split-twice (from the repo root, `node --test impl/test/mcp-profile-parity-red.test.mjs`)

Both runs are consecutive from the repo root this session (plus two identical runs earlier):

| run | tests | pass | fail | cancelled | skipped | todo |
|-----|-------|------|------|-----------|---------|------|
| run 1 | 21 | 8 | 13 | 0 | 0 | 0 |
| run 2 | 21 | 8 | 13 | 0 | 0 | 0 |

Stable — the identical 13 RED rows fail at their NAMED stages on both runs; the 8 PIN rows
(RG-P1..RG-P8) stay green. Matches the suite's declared notes. First-failing assertion per RED row
(all at named stages, all behavior assertions — not vacuous shape checks):

- RG-01 `mcpApplicationCommandNames export exists (stage: served-set export)` — `'undefined'` ≠ `'function'`
- RG-02 `application tools/list count 49` — `35 !== 49`
- RG-03 `mcpApplicationCommandNames export exists` — `'undefined'` ≠ `'function'`
- RG-04 `combined serves fleet_run_resume_work` — `false` ≠ `true`
- RG-05 `mcpApplicationDispatch export exists` — `'undefined'` ≠ `'function'`
- RG-06 `every inherited lifecycle sibling spelling is served on the combined surface` — missing list incl. `baton_run_workstream_notify`, `baton_run_workstream_stop`
- RG-07 `the extended wait/follow list is present` — `false` ≠ `true`
- RG-08 `combined serves fleet_run_resume_work` — `false` ≠ `true`
- RG-09 `combined tools/list count 102` — `86 !== 102`
- RG-10a `each non-canonical op has a [canonical, mcp.baton, sibling-tool] surfaceAlias row`
- RG-10b `renderMcpToolInventory resolves an alias whose canonical key has no canonicalOperations entry via the fallback`
- RG-10c `baton_run_status appears in the generated MCP.md inventory`
- RG-11-R `artifact mcp.application count 49` — `35 !== 49`

All 13 RED rows fail at named stages → the "fail at a NAMED stage" law claim holds.

---

## 2. Capability rows — cheapest wrong impl that turns the row green

| Row | Verdict | Cheapest wrong impl (or none-found reasoning) |
|-----|---------|------------------------------------------------|
| RG-01 | **SHALLOW** | `mcpApplicationCommandNames = () => [...webCommands].sort()` and `mcpApplicationDispatch = () => Object.freeze({})` — 3 lines pass all four assertions (function types, sorted+dedup served set, frozen dispatch). The served-set CONTENT is never pinned here (a superset ⊇ webCommands passes; garbage extras pass). |
| RG-02 | **SHALLOW** | The sibling check is **vacuous at green**: `mcpApplicationCommandNames()` returns the *grown* served set (D1 step 1: 25 commands), so the test's `uncovered = webCommands.filter(c => !served.includes(c))` is `[]` and `siblingTools` is `[]` — the "every D3-uncovered sibling" loop asserts nothing. Remaining force is count `49` (a bare magic number; composition 35+14 unverified) + a **self-referential** `sortedSet(names) == mcpApplicationToolNames()`. An impl serving any 49 self-consistent names passes. |
| RG-03 | **SHALLOW** | The D3 behavioral check (`uncovered == []`) is the contract's law and passes trivially at green. The **construction-order / mechanism pins are text-bypassable**: the test only requires `uncoveredCommands` to be defined before `LIFECYCLE_ORDINARY_SIBLINGS` with `.map` in the first 160 chars after the binding. A decoy `function uncoveredCommands() { … }` + `const LIFECYCLE_ORDINARY_SIBLINGS = uncoveredCommands().map(…)` (never used) + the 14 siblings **hand-inlined** into the real table passes all four anchors. Nothing checks that `LIFECYCLE_ORDINARY_SIBLINGS` actually feeds `ORDINARY_APPLICATION_TOOL_DEFINITIONS`, nor that the served export is the pre-spread snapshot. **The #159 hand-inline hole is NOT closed.** |
| RG-04 | **SHALLOW** | Name-only: append the 4 names (`fleet_run_resume_work`, `fleet_run_retry_verification`, `baton_run_resume_work`, `baton_run_retry_verification`) to `mcpCombinedToolNames()`/`mcpApplicationToolNames()`. No schema, dispatch, or derivation check here (the machinery is pinned only by RG-08/RG-06/RG-10c). |
| RG-05 | **SHALLOW** | Also vacuous at green (served = 25 → `uncovered = []` → `unbound = []`). Under any served set, a **hand-frozen** `Object.freeze({ [tool]: command, … })` map passes — no derivation check. Bites only the missing-map mutation. |
| RG-06 | **BROKEN** | See §3. The row's `inherited = webCommands.filter(c => byName.has('fleet_' + c.replaceAll('.','_')))` sweeps **all fleet-sourced web commands — 18 at HEAD, 20 after D2** — not the contract's 12. It demands `baton_run_workstream_notify`/`baton_run_workstream_stop` (never created by D1; the M4b hand rows spell them `baton_workstream_notify`/`baton_workstream_stop`). A contract-faithful impl FAILS this row; the suite is **unsatisfiable** by the contract (see §3). |
| RG-07 | **SOUND** | The byte-string `['fleet_run_wait','fleet_run_follow','baton_run_wait','baton_run_follow']` is comment-decoyable (noted), but Gate A (over-bound `baton_run_wait` → `invalid_run_wait`) and Gate B (`baton_run_follow` without the follow capability → observe-path `forbidden`) force a *registered* `baton_run_wait`/`baton_run_follow` with the maxWaitMs bound and the observe-path `_authority` gate. No cheap wrong impl passes both gates without the D1 item-4 behavior. |
| RG-08 | **SOUND** | Behavioral and strong: `idempotencyKey` required (`invalid_idempotency_key`), the command-lane typed refusal reaches the wire (`application_resume_invalid` passthrough), and an exact retry replays without re-dispatching (`commandCalls` count = 1). A generic result-cache cannot satisfy the typed-code passthrough. |
| RG-09 | **SHALLOW** | Count `102` (bare number; composition 86+2+14 unverified) + the same **vacuous** uncovered derivation (served = 25 → `siblingTools = []` → inclusion and the "14 siblings lead the ordinary prefix" slice assert nothing) + self-referential `sortedSet(names) == mcpCombinedToolNames()`. Any 102 self-consistent names incl. the two fleet names pass. |
| RG-10a | **SOUND** | Existence + shape of the 5 `mcp.baton` surfaceAlias rows (`[canonical, 'mcp.baton', sibling-tool]`). Missing or mis-`name`d rows fail; the row's closed literal matches the contract D4 rows and `deriveSurfaceNames`. |
| RG-10b | **SHALLOW** | The byte-string `?? { key: alias.canonical, profile: 'ordinary' }` is comment-decoyable — placing the string in a comment passes `source.includes`. The behavioral force is RG-10c. |
| RG-10c | **SOUND** | End-to-end render: `renderMcpToolInventory()` must emit each non-canonical tool under its operation key (Operation column = `run.status`, … not the tool name). Requires the real canonical-miss fallback path; the 5 non-canonical keys have no `canonicalOperations` entry (G11 9/5 split). |
| RG-11-R | **SHALLOW** | Count-only against the committed artifact JSON (`mcp.application` = 49, `mcp.combined` = 102). The JSON is hand-editable; RG-P2/P3 make the artifact == live *self-consistent*, so a lying impl (49/102 both sides) passes without any regeneration. The doc-parity *gate* (RG-P1) is the real regenerator, but it compares against the impl's own output. |

## 3. Headline finding — RG-06 is BROKEN and the suite is unsatisfiable by the contract

- **The contract mandates exactly 14 siblings** (§3 closed literal; D1 mechanism `uncoveredCommands() = webCommands − served(11)` = the 14 lifecycle ops). It forbids hand-inlining and requires the 5 pinned test-site lists + counts `49`/`102` = `35+14` / `86+2+14`.
- **RG-06's filter is broader than the contract's 12.** It computes `inherited = webCommands.filter(c => fleet source on combined)` — 18 at HEAD, **20 after D2** adds `fleet_run_resume_work`/`fleet_run_retry_verification`. Verified: the 6 over-swept, *served* commands are `run.start, run.episode, run.workstreams, run.workstream.notify, run.workstream.stop, run.stop` — none is uncovered, none gets a D1 sibling.
- For those 6, the test's sibling spelling is `deriveSurfaceNames(c).mcp`. Verified at HEAD: `baton_run_start`, `baton_run_episode`, `baton_run_workstreams`, `baton_run_stop` already exist and their `inputSchema`/`annotations`/`_meta` **byte-equal** their `fleet_run_*` sources (M4b holds). But `run.workstream.notify` → **`baton_run_workstream_notify` does not exist** and `run.workstream.stop` → **`baton_run_workstream_stop` does not exist** — the M4b hand rows are spelled `baton_workstream_notify`/`baton_workstream_stop` (`mcp-northbound.mjs:61-62`). The contract never creates the `baton_run_workstream_*` spellings.
- **Therefore a contract-faithful implementation (14 siblings, counts 49/102) FAILS RG-06** on the two missing `baton_run_workstream_*` spellings — while any impl that adds them as *extra* tools breaks RG-02/RG-09/RG-11-R's counts (49→51), and an impl that *renames* the M4b hand rows to make them fit violates the contract's "byte-identical M4b pattern" (§5 non-goal) and its §3 closed literal. **No implementation satisfies every row** under the contract; the row is red/green for the wrong reason.
- The suite author's own title says "the 12 inherited siblings"; the contract's RG-06 oracle says "all 12 inherited rows". The code's `inherited` filter does not implement either — a filter bug, not an intent.

## 4. The systematic vacuity — uncovered-derived checks are green-time-dead

Every test derives `uncovered` from `mcpApplicationCommandNames()` at run time. Per D1 step 1 the
export returns the **grown** served set (25 commands) — so at green, `uncovered = []` everywhere and
RG-02's sibling-inclusion, RG-05's dispatch-binding, and RG-09's sibling-inclusion **and** the
"14 siblings lead the ordinary prefix" slice are all vacuous. The sibling-existence force rests
entirely on RG-06 (BROKEN), RG-04 (names), RG-07 (2 tools), RG-10a/c (alias/render). The
construction-order mechanism (Amendment 2, the #159 pin) is text-bypassable (§2 RG-03). The suite
as written proves *outputs* (counts, names, alias rows, two wait/follow behaviors, resume/retry
machinery) but does **not** prove the mechanical-derivation claim it exists for.

## 5. PIN rows — pin-bite attacks

| Pin | Verdict | Plausible wrong impl it kills |
|-----|---------|-------------------------------|
| RG-P1 | **SOUND** | `surface-conformance.mjs` main green — kills an impl that leaves the doc-parity gate red. |
| RG-P2/P3 | **SOUND** | Artifact == live counts — kills an impl that regenerates live surfaces but forgets the committed artifact. |
| RG-P4..P7 | **SOUND** | The four hand-pinned tool lists (phase16, mcp-reflex, phase67, phase72) == `mcpApplicationToolNames()` — kills an impl that grows the surface without updating a pinned site (the common drift mutation). Consistent-but-wrong (impl + sites + artifact all 49/102) still passes — inherent to a self-consistency pin, acceptable. |
| RG-P8 | **SOUND** | phase16 combined-count pin == `mcpCombinedToolNames().length` — same class. |

No PIN row is decorative; each bites a plausible mutation.

## 6. Law re-check (per the foundry frame)

- **Named stages on every capability row** — ✓ every RED row's first assertion carries the `(stage: …)` tag.
- **Hermetic** — ✓ `mkdtemp` + `test.after` cleanup, no network/provider, no host state; RG-P1's `execFileSync` conformance subprocess is local.
- **No clocks as controls** — ✓ fixed `NOW`; `maxWaitMs` is the deployment-approved bound used as an over-bound input in RG-07, not a timer.
- **Namespace imports for invented surfaces** — ✓ `import * as mcpNorthbound`.
- **Sorted-key literals ACTUAL order** — the RG-07 extended list is a contract-mandated byte-string (D1 item 4), order per contract; `NON_CANONICAL_OPS` is neither sorted nor definition order (assertion-irrelevant — `.some()`/`find` only), noted as hygiene only.
- **watchdog.stallMs 60_000 + comment** — fixtures never construct a real Coordinator (stub `{}`), so no watchdog knob exists; the suite header declares the clause vacuous. Reasonable and recorded.
- **No absolute line-window anchors** — ✓ `indexOf`/byte-string/relative 160-char window only. (The 160-char window is a magic number; a legitimate impl with a longer doc comment above the binding could trip it — minor.)
- **Verbatim `[attempt:]` in the suite header** — ✓ line 2: `[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-156]`.
- **Attempt-echo law (#171)** — ✓ this line is in my first five lines.

## 7. Shared publish — attempt and exact refusal

The `shared` scratchpad publish was attempted against `writeScratchpad` (`impl/src/coordination-store.mjs:14065-14103`). The shared scope is **not expressible**; the exact refusals:

1. **Envelope path** — adding `scope: 'shared'` to the write envelope:
   `scratchpad_write_invalid | scratchpad write envelope is invalid`
   (the envelope must be exactly `['runId','taskId','workerId','entry']`; `scratchpadExact` at `:541`).
2. **Entry path** — a `scope` field inside the entry:
   `scratchpad_entry_invalid | scratchpad entry has unknown or missing fields`
   (a `note` entry is exactly `['kind','text']`).
3. **The only expressible write always mints `worker:<workerId>`** — verified: a valid 4-field write
   returns `scope: worker:worker-bt156`. No code path in `writeScratchpad` can mint `shared`
   (`const scope = 'worker:' + fields.workerId` at `:14103`).

This matches the refusal the suite author recorded in `suite-draft-notes.md`. The full report text
could not be published to `shared`; the publish is a failed publish and the refusal above is the
evidence (recorded per the row brief: "or the exact refusal recorded").

## 8. Final verdict — **NEEDS-FOLD**

The suite is **not** acceptance-ready: it is **unsatisfiable** by the contract's own implementation
(RG-06 BROKEN), its central mechanical-derivation claims are green-time-dead or decoyable
(RG-02/03/05/09), and its count pins are composition-blind. Named folds, in priority order:

1. **RG-06 — restrict the inherited filter to the uncovered set.** `inherited = uncovered.filter((command) => byName.has('fleet_' + command.replaceAll('.', '_')))` (or the contract's 12/14 closed rows). This alone makes the row pass for a contract-faithful impl *and* keeps it the strongest sibling-existence/schema pin.
2. **Close the vacuity — derive `uncovered` from the pre-spread snapshot, not the grown export.** Export `uncoveredCommands()` (or the pre-spread served set) so RG-02/RG-05/RG-09's sibling-inclusion, dispatch-binding, and prefix-lead checks bite at green. The construction-order mechanism must be the *observable* the tests derive from.
3. **RG-03 — pin that the derived table feeds the real definitions.** Assert `LIFECYCLE_ORDINARY_SIBLINGS` is referenced inside `ORDINARY_APPLICATION_TOOL_DEFINITIONS` (a second `indexOf` anchor), else the #159 hand-inline hole remains open (decoy `uncoveredCommands()` + unused `LIFECYCLE_ORDINARY_SIBLINGS` + hand-inlined rows pass everything).
4. **RG-02/RG-09/RG-11-R — tie the counts to composition**, not bare numbers (e.g. `mcpApplicationToolNames().length === 35 + uncoveredCommands().length`), so 49/102 cannot be hit with arbitrary names.

SOUND rows to keep: **RG-07, RG-08, RG-10a, RG-10c, and all eight PIN rows RG-P1..P8.**

---

## 9. Attack continuation — empirical demonstrations (checkpoint)

The verdicts in §2/§3 rest on three demonstrable claims. Each was re-run against the suite's own
assertion logic this checkpoint. Split confirmed a third consecutive time from the repo root:
`tests 21 · pass 8 · fail 13 · cancelled 0 · skipped 0 · todo 0` (stable).

### 9.1 The RG-03 #159 hole is real, not theoretical

A crafted `mcp-northbound.mjs` in which `uncoveredCommands()` and a derived
`LIFECYCLE_ORDINARY_SIBLINGS = uncoveredCommands().map(...)` are **decoy symbols** — the real
`ORDINARY_APPLICATION_TOOL_DEFINITIONS` is a hand-inlined 14-row array that never references the
derived table — was run through the suite's exact four anchors:

- `uncoveredCommands()` defined → **PASS**
- `LIFECYCLE_ORDINARY_SIBLINGS` defined → **PASS**
- `uncoveredCommands()` precedes the spread → **PASS**
- `.map` within the first 160 chars after the binding → **PASS**

All four pass. The suite cannot see that the derived table is unused. The construction-order pin
(Amendment 2) does not enforce the #159 doctrine.

### 9.2 RG-06 vs the 49/102 literals — the suite is unsatisfiable, arithmetically

Live HEAD counts: application 35, combined 86. The contract mandates **14** siblings (§3). RG-06's
filter demands sibling spellings for **16** net-new names after D2 (the 14 plus `baton_run_workstream_notify`
+ `baton_run_workstream_stop`).

- Contract-faithful impl (14): app **49** / combined **102** → RG-02/RG-09/RG-11-R counts pass, **RG-06 fails** (2 missing spellings).
- RG-06-compliant impl (16, no rename): app **51** / combined **104** → RG-06 passes, but RG-02/RG-09/RG-11-R **hard-assert 49/102** → fail.
- RG-06-compliant via M4b rename (`baton_workstream_notify` → `baton_run_workstream_notify`): app 49 / combined 102 → counts pass, but the §3 closed literal (14) is broken and the "byte-identical M4b pattern" non-goal (§5) is violated.

No implementation satisfies every row under the contract.

### 9.3 PIN bite tests — the pins bite the common drift mutation

Simulated the canonical wrong-impl mutation (live surface grows to 49/102, a hand-pinned test site
left stale) through the suite's own extraction/comparison code:

- **RG-P4 bite** — pinned site still lists the 35 HEAD names, live = 49: `pinned == live` → **false** (pin fails, bites).
- **RG-P8 bite** — pinned combined count still 86, live = 102: `86 === 102` → **false** (pin fails, bites).
- **Control** — a correctly-updated pinned site (49) against live 49 → **true** (pin is satisfiable, not over-strict).

All eight PIN rows are SOUND — none is decorative.
