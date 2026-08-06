# Fold summary — blue-team report → `harvest-accessor-red.test.mjs`

- **Report:** `docs/reference/evidence/harvest-accessor-2026-08-06/suite-blueteam.md`
- **Verdict:** NOT-READY — one primary blocker (B1) + four non-blocking recommendations
- **Date:** 2026-08-06
- **Result:** 39t (34r/5p) → **41t (36r/5p)**, exact and stable across two consecutive runs
  (`node --test impl/test/harvest-accessor-red.test.mjs` from the repo root).
  The execution contract is unchanged: the suite is invoked the same way, with the same
  runner flags; red rows exit non-zero as before (the suite is red-first by design).

## Blocker → change map

**B1 (primary): HA-08 facade-injection translation rows absent for `harvest_onto_dirty`,
`result_delta_oversize`, `harvest_onto_advanced`, `harvest_apply_failed`.**

| Blocker item | Fold change | Where |
|---|---|---|
| `harvest_onto_dirty` facade row | **+E3-onto-dirty** (new red row). Make the main checkout dirty with an uncommitted edit to a tracked file (`x.md`, untouched by the pin) before `waves.harvest`; assert the facade throws `harvest_onto_dirty`. Exactly the two-line fixture the report proposed. Fails today at the named stage (harvest absent). | `impl/test/harvest-accessor-red.test.mjs` E section |
| `result_delta_oversize` facade row | **+C3-oversize** (new red row). Fails today at the named stage (projection absent). **Construction differs from the report's suggestion** — see "rejected/deferred" item R1. | `impl/test/harvest-accessor-red.test.mjs` C section |
| Retitle H4 to "stateFailureCode mapping" + note the facade burden | **H4 retitled** `H4-translations` → `H4-stateFailureCode-mapping`, with a comment: the facade-translation burden for the constructible codes is carried by C3/E3; `harvest_onto_advanced`/`harvest_apply_failed` stay wire-mapping-only (item D1). | H section header + H4 comment |

The report's other two B1-named codes already had facade teeth, so no row was added for them:
- `structured_already_integrated → skipped` — E1's retry row already asserts
  `reason: 'already_integrated'` at the facade (no new merge commit).
- `structured_tool_unavailable → harvest_conflict (re-probed list)` — F2 already exercises the
  real conflict path at the facade (`harvest_conflict` + the conflict list). The report itself
  notes this ("tests the real conflict path at the facade (F2)").

## Recommendations → change map

| Rec | Fold change |
|---|---|
| 1. C2 `changedFilesDigest` against the full-set digest | **Adopted.** The 64-hex regex assert is replaced by a full-set oracle: reconstruct all N rows from the known edit contents (`blob = sha1("blob <size>\0<content>")`, verified against `git rev-parse ${resultSha}:${path}`; `digest = sha256(content)`; `mode = 100644`), `sha256(canonicalJSON)` them, and assert equality. A digest of the truncated page (or any subset) now turns red. |
| 2. F2: assert no probe worktree left behind | **Adopted, adjusted.** The report proposed "only the main worktree remains". Verified this session that the ceremony legitimately leaves the owned worker worktree registered (2 registered worktrees, `git worktree list --porcelain`), so an exactly-one assert would be a false-red. The row now snapshots the worktree registry before the refused harvest and asserts before/after equality — strictly stronger than the report's shape (any probe worktree the harvest adds turns red). |
| 3. E1: symlink-alias `onto` for the realpath admit | **Adopted.** The onto-equals-main step now passes a symlink alias of the main checkout (target = `fx.repo`); a naive string-equality implementation refuses it, only a realpath-aware one admits it. Pins the ADMIT half of the realpath law (the refuse half is the onto-invalid row above it). |
| 4. M2: fold the self-referential lint into a comment | **Deferred** — see D2. |

## Rejected / deferred items (with reasons)

**R1 — `result_delta_oversize` via a real N=1_025 ceremony (report's concrete fix): REJECTED as
unconstructible.** Verified this session: a 1_025-edit ceremony cannot complete. `run.status`'s
view build (`_semanticReview` → `_semanticTarget`, `application.mjs:3737`) calls
`inspectCapturedChanges` → `changedPathsAtCommit(baseSha, sha, 1_024)` at the default maxPaths and
throws `captured_change_oversize` **before the row's own assert can run** — the ceremony itself
dies on the view choke. C3 instead injects the kernel throw at the facade's diff seam
(`fx.driver.coordinator._worktrees.changedPathsAtCommit = () => { throw …captured_change_oversize }`),
the D5-precedent idiom (`resolveResult = null` for the pin_unverifiable lane) and the report's own
sanctioned alternative ("stub the engine seam at the facade"). The seam is the facade's real
diff seam, so a wrong implementation that lets the kernel code escape (or maps it elsewhere)
turns red at the same line a real oversize run would reach.

**D1 — facade rows for `harvest_onto_advanced` (engine `structured_main_advanced`) and
`harvest_apply_failed` (engine `structured_merge_failed`): DEFERRED as not facade-constructible.**
- `harvest_onto_advanced` fires when the main checkout has advanced beyond the expected
  integration base. A deterministic ceremony path to that state is the rewound/diverged-main
  territory already pinned by L2 (`harvest_base_diverged`, four shas); there is no separate
  constructible state where the facade must emit `harvest_onto_advanced` without colliding with
  the pinned divergence code.
- `harvest_apply_failed` fires on a merge failure **after** a clean probe. The facade probes for
  conflicts first (F2 refuses `harvest_conflict` before any apply), so a reachable conflict is
  refused at probe time; a merge failure after a clean probe needs a between-probe-and-apply race
  (another process mutating the worktree), which is not deterministically constructible in a
  hermetic test.
- Both stay pinned at the wire (H4 rows), and the retitle documents that the facade-translation
  burden for these two is intentionally unwired — the honest coverage statement rather than a
  stubbed false-green.

**D2 — M2 (self-referential lint): KEPT as a discipline pin.** The report itself calls M2
"acceptable as a discipline pin"; it guards the closed-shape sorted-key literals that every other
row depends on. Folding it into a comment would preserve none of the guard's regression value.

## Before / after splits

| | tests | red | green |
|---|---|---|---|
| Before fold (baseline run) | 39 | 34 | 5 |
| After fold (run 1) | 41 | 36 | 5 |
| After fold (run 2) | 41 | 36 | 5 |

Delta: +2 red rows (`C3-oversize`, `E3-onto-dirty`), both failing at their own named stages
(`application_command_unavailable` — projection/harvest absent — before the facade-translation
assert can pass). The 5 green pins are unchanged (I2/I5/I6/M1/M2 guards) and re-verified green
on both runs.

## Contract

`harvest-accessor-contract.md` remains at **v1.1** — no blocker demanded a contract amendment, so
its header is untouched.
