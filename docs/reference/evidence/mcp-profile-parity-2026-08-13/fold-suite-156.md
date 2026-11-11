# FOLD NOTES — row-sf156 (mcp-profile-parity-red suite)

[attempt: c8f618f9-2f2a-4a1d-a367-eda8fd71da5c row-sf156]

- **Suite (folded IN PLACE):** `impl/test/mcp-profile-parity-red.test.mjs`
- **Blue-team:** `docs/reference/evidence/blue-team-2026-08-13-a/blueteam-156.md` (row-bt156, **NEEDS-FOLD**)
- **QA:** `docs/reference/evidence/blue-team-2026-08-13-a/blueteam-qa.md` #156 (**UPHELD** — spot-check reproduced)
- **Authority:** `docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md`
  (v1.1 FOLDED) + `fold-156.md` + `redteam-156.md`
- **Fold laws:** `docs/reference/evidence/fold-2026-08-13-c/foundry-brief.md` (all applied)
- **Sacred header preserved:** the suite's existing `[attempt: 08d0dac7-8ad0-4e7c-a13e-9d7a3bb855bc row-suite-156]`
  line is untouched (verbatim, line 2).

## 1. Measured splits — post-fold, from the repo root, TWICE

Command: `node --test impl/test/mcp-profile-parity-red.test.mjs` (repo root, this worktree).

| run | tests | pass | fail | cancelled | skipped | todo |
|-----|-------|------|------|-----------|---------|------|
| run 1 | 21 | 8 | 13 | 0 | 0 | 0 |
| run 2 | 21 | 8 | 13 | 0 | 0 | 0 |

Stable — the identical 13 RED rows fail at their NAMED stages on both runs; the 8 PIN rows
(RG-P1..RG-P8) stay green. The pre-fold split (also 21/8/13) is unchanged in the aggregate: RED
honesty is preserved, and the same 13 capability rows remain red (each at a named stage, each for
the RIGHT reason now — never vacuous, never the phantom RG-06 over-sweep).

**Pass 2 (incremental — RG-07's byte-string anchor comment-stripped, see §6).** Re-measured twice
after the edit, from the repo root, same command — aggregate unchanged:

| run | tests | pass | fail | cancelled | skipped | todo |
|-----|-------|------|------|-----------|---------|------|
| run 3 | 21 | 8 | 13 | 0 | 0 | 0 |
| run 4 | 21 | 8 | 13 | 0 | 0 | 0 |

RG-07 still fails at its NAMED stage (`wait-follow-lists-admit-siblings`): the extended wait/follow
list is absent from executable source at HEAD (comment or otherwise), so the comment-stripped anchor
holds its red state; the behavioral gates A/B are unchanged.

**First-failing assertion per RED row post-fold (all at named stages, all behavior assertions):**

- RG-01  `mcpApplicationCommandNames export exists (stage: served-set export)` — `'undefined'` ≠ `'function'`
- RG-02  `application tools/list count 49 (stage: application-tools-count-49)` — `35 !== 49`
- RG-03  `mcpApplicationCommandNames export exists (stage: served-set export)` — `'undefined'` ≠ `'function'`
- RG-04  `combined serves fleet_run_resume_work (stage: combined-includes-fleet-resume-retry)` — `false` ≠ `true`
- RG-05  `mcpApplicationDispatch export exists (stage: dispatch-map export)` — `'undefined'` ≠ `'function'`
- RG-06  `uncoveredCommands export exists (stage: uncovered-set-export)` — `'undefined'` ≠ `'function'`
- RG-07  `the extended wait/follow list is present … (stage: wait-follow-lists-admit-siblings)` — `false` ≠ `true`
- RG-08  `combined serves fleet_run_resume_work (stage: combined-includes-fleet-resume-retry)` — `false` ≠ `true`
- RG-09  `combined tools/list count 102 (stage: combined-102-includes-siblings)` — `86 !== 102`
- RG-10a `each non-canonical op has a [canonical, mcp.baton, sibling-tool] surfaceAlias row (stage: alias-rows-registered)`
- RG-10b `renderMcpToolInventory resolves an alias whose canonical key has no canonicalOperations entry via the fallback (stage: renderer-fallback-absent)`
- RG-10c `baton_run_status appears in the generated MCP.md inventory (stage: non-canonical-ops-render-operation-keys)`
- RG-11-R `artifact mcp.application count 49 (stage: artifact-counts-49-102)` — `35 !== 49`

## 2. The four named folds (blue-team §8) — all applied

1. **RG-06 — inherited filter restricted to the uncovered set.** `inherited = uncovered.filter((command) => byName.has(fleetName(command)))` over `mcpNorthbound.uncoveredCommands()`. The 18/20 over-sweep is gone; the never-created `baton_run_workstream_notify`/`baton_run_workstream_stop` spellings are no longer demanded (the M4b hand rows keep their contract spelling). A contract-faithful impl (12 inherited at the floor, 14 after D2) now passes; counts 49/102 stay consistent (verified: at D1+D2 the fleet source for every uncovered command is served, so `inherited` = 14).
2. **Close the vacuity — export `uncoveredCommands()` (the PRE-SPREAD snapshot).** New invented surface `mcpNorthbound.uncoveredCommands()`; RG-02/RG-05/RG-09's sibling-inclusion, dispatch-binding, and prefix-lead checks all derive from it, so they BITE at green (the grown served set has no uncovered commands — deriving from it was the green-time-dead hole). RG-03 additionally pins the snapshot length `=== 14` (the contract's §3 closed literal).
3. **RG-03 — pin that the derived table feeds the real definitions.** New second `indexOf` anchor: `LIFECYCLE_ORDINARY_SIBLINGS` must be referenced **inside** `const ORDINARY_APPLICATION_TOOL_DEFINITIONS = Object.freeze([…])`. A decoy `uncoveredCommands()` + unused `LIFECYCLE_ORDINARY_SIBLINGS` + hand-inlined real table (blue-team §9.1) now fails. All source anchors run on **comment-stripped** source.
4. **RG-02/RG-09/RG-11-R — counts tied to composition.** `names.length === 35 + uncovered.length` (app), `86 + 2 + uncovered.length` (combined), artifact `35 + uncovered.length` / `86 + 2 + uncovered.length`. A bare 49/102 of arbitrary self-consistent names cannot pass.

## 3. Finding → resolution map (every blue-team finding dispositioned; no silent drops)

| Finding (blue-team) | Verdict | Disposition | Fold / evidence |
|---|---|---|---|
| RG-01 SHALLOW — 3-line `() => [...webCommands].sort()` + `Object.freeze({})` passes | SHALLOW | **FOLDED** | Served-set CONTENT pinned: `webCommands.filter(c => !served.includes(c))` must be `[]` (stage `served-set-covers-web`). A superset that omits any web command fails. |
| RG-02 SHALLOW — sibling check vacuous at green + bare magic 49 | SHALLOW | **FOLDED** | Sibling set derives from pre-spread `uncoveredCommands()`; count ties to `35 + uncovered.length`; prefix-set equality vs `mcpApplicationToolNames()` kept. Bare-49-of-any-names fails. |
| RG-03 SHALLOW — mechanism pins text-bypassable, #159 hole open | SHALLOW | **FOLDED** | (a) snapshot length pin `=== 14`; (b) fold-#3 feed anchor (`LIFECYCLE_ORDINARY_SIBLINGS` inside `ORDINARY_APPLICATION_TOOL_DEFINITIONS`); (c) all anchors comment-stripped. The §9.1 decoy now fails. |
| RG-04 SHALLOW — name-only append of 4 strings | SHALLOW | **FOLDED** | D2 spellings computed from the closed op list `D2_LIFECYCLE_OPS` + shared `fleetName()`/`deriveSurfaceNames()` rules — no hand-written tool names. A differently-named D2 pair fails. |
| RG-05 SHALLOW — dispatch binding vacuous at green; hand-frozen map passes | SHALLOW | **FOLDED** | Binding force derives from pre-spread `uncoveredCommands()`: at green all 14 siblings must route through `APPLICATION_TOOL`. Hand-frozen map missing a binding fails. |
| RG-06 BROKEN — filter over-sweeps 18/20, demands phantom spellings, suite unsatisfiable | BROKEN | **FOLDED** | Filter restricted to the uncovered set (fold #1). The §9.2 three-way arithmetic deadlock dissolves: contract-faithful impl (14 siblings, 49/102) passes RG-06; no impl needs the phantom spellings. `>= 12` floor kept (contract oracle). |
| RG-07 SOUND, comment-decoyable note | SOUND | **FOLDED** (pass 2) | The byte-string anchor now runs on comment-stripped source (`stripComments(source).includes(extendedList)`, fold pass 2), so a comment-placed decoy cannot satisfy it — consistent with the RG-10b/RG-03 treatment. Gates A/B are unchanged and carry the behavioral force (registered `baton_run_wait`/`baton_run_follow`, maxWaitMs bound, observe-path gate). |
| RG-08 SOUND | SOUND | **KEPT** (no finding) | No fold needed. Machinery (idem required, typed refusal passthrough, replay without re-dispatch) intact. |
| RG-09 SHALLOW — bare magic 102 + vacuous sibling checks | SHALLOW | **FOLDED** | Sibling checks derive from pre-spread `uncoveredCommands()`; count ties to `86 + 2 + uncovered.length`; the "14 siblings lead the ordinary prefix" slice now bites at green (definition order). |
| RG-10a SOUND | SOUND | **KEPT** (no finding) | No fold needed. |
| RG-10b SHALLOW — byte-string comment-decoyable | SHALLOW | **FOLDED** | Fallback byte-string now checked on **comment-stripped** source: a comment-placed decoy cannot satisfy `stripComments(source).includes(fallback)`. Behavioral force remains RG-10c. |
| RG-10c SOUND | SOUND | **KEPT** (no finding) | No fold needed. |
| RG-11-R SHALLOW — count-only vs hand-editable JSON; self-consistent lie passes | SHALLOW | **FOLDED** | Committed counts tie to composition (`35 + uncovered.length` / `86 + 2 + uncovered.length`): an arbitrary 49/102 (artifact == live, both wrong) fails without the true pre-spread 14. |
| RG-P1..P8 SOUND (pin-bite tests §9.3) | SOUND | **KEPT** (no finding) | All eight pins bite the canonical drift mutation; no fold needed. |
| §3 headline — RG-06 BROKEN / suite unsatisfiable | BROKEN | **FOLDED** | Fold #1 (restricted filter). Verified post-fold: a contract-faithful impl (14 siblings, app 49, combined 102) now satisfies RG-06 + RG-02/RG-09/RG-11-R together. |
| §4 systematic vacuity — uncovered-derived checks green-time-dead | — | **FOLDED** | Fold #2 (pre-spread `uncoveredCommands()` export): every uncovered-derived check now bites at green. |
| §9.1 #159 hand-inline hole real | — | **FOLDED** | Fold #3 (feed anchor): the decoy is now visible. |
| §9.2 arithmetic unsatisfiability | — | **FOLDED** | Fold #1 (see §3 headline). |
| §6 law note — 160-char `.map` window is a magic number, doc comment could trip it | minor | **FOLDED** | All source anchors now run on comment-stripped source, so a doc comment above the binding is removed before the window applies; the window starts at real code. Kept at 160 chars (a `const NAME = uncoveredCommands().map(…)` binding always fits; judged robust). |
| §6 law note — `NON_CANONICAL_OPS` order hygiene | minor | **STRUCK** | Assertion-irrelevant (`.some()`/`find` only) per the blue-team's own note; the closed literal is the contract D4 list. No change. |

## 4. Judgment calls (recorded per the fold law)

1. **The pre-spread snapshot is pinned `=== 14` (RG-03), not just composition-derived.** The 14 is the contract's §3 closed literal and the D1 oracle (`uncoveredCommands() = webCommands − served(11)`); pinning it is contract-faithful, not an arbitrary limit. The composition checks (`35 + n`, `86 + 2 + n`) remain the primary force; the `=== 14` closes the "wrong pre-spread set that still sums to 49/102" gap.
2. **RG-01's content pin is one-directional (`bus ⊆ application`), so "garbage extras" in the served set still pass.** This is the contract's D3 law itself (superset, never equality) — the contract legitimately admits MCP-only extras. Demanding set equality would over-pin beyond the authority; recorded, not folded.
3. **RG-06's floor is `>= 12` (contract oracle), with the derived `missingSibling` check carrying the real force.** The contract's RG-06 oracle says "all 12 inherited rows"; after D2 the set is 14. `>= 12` is the floor; the byte-inheritance loop runs over the derived `inherited` (12 or 14), so the row's force scales with the actual contract count.
4. **RG-09's prefix-lead slice stays prepend-order in definition order.** The contract oracle ("the 14 baton_* siblings lead the ordinary prefix") implies the siblings precede the ordinary prefix; `uncoveredCommands()` preserves `webCommands` iteration order, so the slice compares definition order, not sorted. This matches the D1 three-spread construction.
5. **`stripComments` is a simple block+line regex.** Safe for these anchors (they are identifiers/code byte-strings, never strings containing `//`/`/*`), but it would mangle a URL literal if one ever became an anchor — noted, not a live concern.
6. **The `watchdog.stallMs: 60_000` suite-law clause is vacuous here.** The fixtures build an `McpFleetServer` with a stub coordinator `{}` — no real `Coordinator`, no watchdog knob exists. Declared vacuous in the suite header (as before the fold); no knob was introduced.
7. **Split unchanged in aggregate (21/8/13).** No row flipped green or red; the fold hardened red-for-the-wrong-reason into red-for-the-right-reason and made the green-time-dead checks bite. This is the fold law's intent.

## 6. Incremental notes — fold pass 2 (RG-07 anchor hardening)

Re-reading the blue-team's RG-07 note against the fold doctrine ("a byte-string that appears only in
a comment must not satisfy a source anchor"), the pass-1 disposition (STRUCK — the note, since the
behavioral gates carry the force) was upgraded to a **FOLDED** hardening, consistent with the
RG-10b/RG-03 treatment:

- **Suite change:** RG-07's first assertion now reads the source comment-stripped —
  `stripComments(readFileSync(…)).includes(extendedList)`. A wrong impl that places the extended
  wait/follow list only inside a comment can no longer satisfy the source anchor; the behavioral
  gates A/B (registered `baton_run_wait`/`baton_run_follow`, maxWaitMs bound, observe-path gate) are
  unchanged and remain the row's real force.
- **RED honesty re-verified:** RG-07 still fails at `wait-follow-lists-admit-siblings` (the list is
  absent from executable source at HEAD), and the aggregate split is unchanged: runs 3/4 measured
  21/8/13 (see §1).
- **Judgment call:** `stripComments` is safe for this anchor — the extended list is a
  contract-mandated executable byte-string (D1 item 4), never containing `//`/`/*`; stripping only
  removes comment text, so a legitimate in-code `const` list still satisfies the anchor.

## 7. Scope confirmation

Both deliverables land under this worktree
(`.baton/wt/ws-98117b8a29a50117123ad6ed0366311a`), verified by `pwd` before writing:
- `impl/test/mcp-profile-parity-red.test.mjs` (folded in place; sacred attempt header untouched)
- `docs/reference/evidence/mcp-profile-parity-2026-08-13/fold-suite-156.md` (this file)
No writes to the main checkout; nothing outside the declared scope.
