# #59 FOLD — blocker → change map (v1.0 → v1.1)

Source: `contract-redteam.md` (pass r9-2026-08-07, **NOT FOLD-READY — 7 numbered blockers**).
Fold target: `redrive-continuity-contract.md` v1.1. Fold HEAD:
`a53d148c2ed107bdb39277047e81d286b56bea29` (the red-team pass ran against
`2c4018ffd27b30cf2129a5de02c2bd8cfb53393b`; every corrected anchor and every new pin was
re-grepped at the fold HEAD before writing — `impl/src/*` and the two cited contracts
`worker-delivery-push-contract.md` / `repl-realization-contract.md` are byte-identical across the
v1.0 HEAD `3ab3970…`, the red-team HEAD `2c4018f…`, and the fold HEAD, so every citation
re-verifies).

Verdict folding: all **7 numbered blockers** resolved with the report's concrete fix; the
**3 loose-range notes** (§1.2) adjudicated (note A no-change, note B re-anchored in D3, note C
folded into GT4/D2); open questions **OQ1/OQ2 RESOLVED** (as v1.1 blockers), **OQ3/OQ4 SOUND** as
written.

---

## Loose-range notes (report §1.2) — adjudicated

| # | Note (report) | v1.0 wording | v1.1 change |
|---|---|---|---|
| A | GT7 "`FRAME_LIMITS` (limits.mjs:53-110)" opens one line late / closes on the declaration row (:110) | `FRAME_LIMITS` (limits.mjs:53-110) | No change — range-loose only; the row objects span :51-109, the export is at :110, and the cited range's substance is right. GT7 keeps :53-110. |
| B | D3 "R-DC-2's manifest-based shape, redteam-v1.md:40-54" — line :40 states the OLD defective signature; the repair is at :52-54 | redteam-v1.md:40-54 | **D3 re-anchored to `redteam-v1.md:52-54`** (the manifest-based repair), with a parenthetical noting the §1.2 note B. |
| C | GT4 "`renderPrompt` (cli-adapters.mjs:78-109) is the CLI dialect of the same served brief" — renderPrompt renders NO `## Ambient knowledge` block / no briefing field; it is a flat CLI prompt | GT4 last sentence | **GT4 amended** to state the renderPrompt reality (renders `Task`/dispatch/immutable-context/constraints/path-scope/`Done when:`/verification only; no `## Ambient knowledge` slot), and **D2 pins renderPrompt's continuity position separately** (after the verification execution contract line, mirroring #79 D1). |

## Numbered blockers (report §10) — all resolved

| # | Blocker | Concrete fix (from the report) | Change in v1.1 |
|---|---|---|---|
| 1 | **Per-item framing + body neutralization unpinned (D1/D2).** A carried scratchpad note can inject `## `-prefixed orchestration-reserved sections or a fake frame header; a single section-opening frame literal does not stop it. | Per-item `[carried/untrusted]` frames + `wrapProse` wrapping + neutralization of `## `-prefixed/reserved lines at the render seam, and amend R3 to test exactly that. | **D1** new "Per-item framing + body neutralization — the injection seam" block: per-item frame `- [carried/untrusted] ${scope} ${entryId\|digest}: …` (mirroring #79 D1/R8, worker-delivery-push-contract.md:155-163, :409); body neutralization of `## `-prefixed / orchestration-reserved lines + `wrapProse` wrapping (messages.mjs:463-465) with the #69 B5/R9 single-line-leaf discipline as the compliant mechanism (messages.mjs:560-571; repl-realization-contract.md:257-267, :536-540); one closed serializer with the typed refusal `redrive_carry_unframable` — never an unframed append. **D2** provenance-framing bullet extended (fake frame headers neutralized). **R3 amended** to make the red test exactly the inert carried note (`## Pending attention` / a fake `UNTRUSTED_...` header renders inside the bullet, never as a new section). |
| 2 | **Renderer coverage under-specified (D2).** One render order is pinned; two renderers exist, and `renderPrompt` has no `## Ambient knowledge` slot. | Pin the section in BOTH renderers with renderPrompt's position (mirror #79 D1: after the verification contract line), or scope explicitly to the structured brief and define the CLI surface. | **GT4 amended** (note C): renderPrompt renders no `## Ambient knowledge` block. **D2** rendering-order bullet pins the section in BOTH renderers — `renderBrief` after `## Ambient knowledge` (:147-161); `renderPrompt` after the verification execution contract line (the last lines of the prompt, mirroring #79 D1, worker-delivery-push-contract.md:150-153), before `## Cited REPL objects` / `## Pending attention`. **R2 amended** to require EITHER renderer absent → RED. |
| 3 | **Fold-order collision with #69 R7 / #79 D1 (D2).** The amended order invalidates whichever of #69/#79 folds second; nothing resolves who lands first or who amends whom. | Pin the fold-order resolution (who lands first, who amends whom) in the contract, not just the registry-row independence. | **D2** rendering-order bullet gains the **"Fold-order resolution"** clause: #59 folds AFTER #69/#79 (both already v1.1); THIS contract owns the total composed render order and AMENDS the #69 R7 / #79 D1 render-order pins (repl-realization-contract.md:524; worker-delivery-push-contract.md:150-153) — the #69/#79 sections still render in their pinned mutual order AFTER the continuity block, and the #69/#79 red suites' render-order assertions are re-run/amended at implementation. Registry-row independence (repl-realization-contract.md:430) is unaffected — it covers the ROWS, this pin covers the shared render seam. **New acceptance pin R9** asserts the total order + the #69/#79 amendment. |
| 4 | **Pin digest list disambiguation unpinned (D1.2).** A raw window scan can include other members'/attempts' pins. | Pin the list to the dead member's `{report, startedAtMs, excludeShas}`-derived checkpoint history and carry `startedAtMs` + `report`. | **D1 member 2 rewritten** to pin the `resolveResultPin`-disambiguated list (wave.mjs:134-148): per `{report, startedAtMs, excludeShas}`, per report path, within the member's start window, excluding shas attributed to other members — NEVER a raw `refs/baton/results/*` ref scan. The dead attempt's `startedAtMs` + `report` are carried alongside so the fresh attempt re-runs the salvage path (93B rule 5) with the same disambiguation; the carried shas are directly citable. **OQ2 resolved** with this (see below). |
| 5 | **Wave-chain and carryForward-option validation unpinned (D3).** "Same wave chain" is caller-assertable; a malformed/empty `carryForward` option has no typed refusal. | Pin the chain relation to the fresh wave's recorded predecessor / idempotency-key chain, and add `redrive_carry_option_invalid`. | **D3** wave-chain relation pinned: the source attempt must be a member of (i) the SAME `waveId` as the re-driven member, or (ii) the wave recorded as this wave's direct predecessor in the fresh wave's manifest / idempotency-key chain — never a caller-asserted relation. **D3** new bullet "The option's own admission is validated": a `carryForward` that is not an object / missing `sourceRunId` / empty `scopes` refuses `redrive_carry_option_invalid`. **Refusal vocabulary** gains `redrive_carry_option_invalid`. **R5 amended** to pin the option-shape refusal + the chain relation. |
| 6 | **No-store-write invariant unpinned (D4/R6).** A restore-implementation would leak dead-attempt rows into the fresh run's own scratchpad horizon. | Amend R6 with a red test that the carry writes nothing to the fresh run's store. | **D4** new bullet "The capture is a projection into the brief, never a store write into the fresh run": the carry NEVER writes the dead attempt's rows into the fresh run's store (no `writeScratchpad`, no `context.cell`, no REPL binding, no coordination-store record) — a restore-implementation would weaken the GT3 boundary and blur "this attempt's digests" (`run.scratchpad({workerId})`, scratchpad-decisions.md:1258). **R6 amended** with the no-store-write red test (fresh run's store has no dead-attempt rows after a carry). |
| 7 | **Within-block allocation unpinned (D1).** A large scratchpad can consume all 8 items and push the pin list/refusal evidence to the spill. | Pin per-member reservation or a fixed render order inside the block, plus the rows' `graceful` values. | **D1** new "Within-block allocation, pinned": fixed in-block render order **terminal cause → refusal evidence → scratchpad projection → pin digest list**; terminal + refusals always in-block (small, closed), scratchpad + pins share the remainder, overflow (only) degrades to the digest-cited spill. Rows' graceful values pinned: `view.continuity.items` = 8 graceful `'spill-digest-citation'`; `view.continuity.bytes` = 4096 graceful `'shed-flagged'` (mirroring #79). **R7 amended**. |

## Per-decision notes (red-team, folded)

- **D1 (HOLE, §2).** The injection seam (blocker 1) and the within-block allocation (blocker 7)
  are folded as new D1 blocks; the §2.2 graceful-values request is folded into the D1 rows
  sentence and R7.
- **D2 (HOLE, §3).** Renderer coverage (blocker 2) and the fold-order collision (blocker 3) are
  folded into the D2 rendering-order bullet; the §3.1 note-C reality (renderPrompt has no
  `## Ambient knowledge` slot) is folded into GT4 and the D2 renderPrompt position.
- **D3 (SOUND with minor gaps, §4).** The two under-specifications — the wave-chain definition and
  the option-shape admission — are folded as new D3 bullets (blocker 5). The role/wave validation
  BEFORE any side effect is preserved unchanged.
- **D4 (SOUND, §5).** The evidence law (TG2) is preserved unchanged; the report's one
  strengthening pin — the capture is a projection into the brief, never a store write into the
  fresh run — is folded as a new D4 bullet and into R6 (blocker 6).
- **Pin digest list (HOLE, §6).** Folded as the D1 member 2 rewrite (blocker 4) and the OQ2
  resolution.
- **Refusal vocabulary (SOUND with minor gaps, §7).** The malformed-option gap (§4) is folded as
  `redrive_carry_option_invalid`; blocker 1(c)'s closed-serializer refusal is folded as
  `redrive_carry_unframable`. The frame-economics refusals still route through the #89 ONE-composer
  (`composeFrameLimitRefusal`, limits.mjs:40-42).
- **Acceptance pins (SOUND with amendments, §8).** R3 strengthened (injection discipline, not just
  the header), R2 requires BOTH renderers, R6 gains the no-store-write invariant, R7 pins the
  graceful values + in-block order, and **R9** is new for the total-order / fold-order resolution
  (blocker 3).

## Open questions (report §9) — verdicts

- **OQ1 — The carry window.** **RESOLVED as a v1.1 blocker.** The fold pins capture-at-re-drive
  composition with a digest-cited snapshot (D3 → D2); `redrive_carry_unknown_source` /
  `redrive_carry_no_evidence` cover the records-reaped degradation. No blocker.
- **OQ2 — The pin list's freshness.** **RESOLVED by folding with blocker 4 (§6).** The
  `startedAtMs` / `report` re-resolution inputs are now part of the carried set (D1 member 2), so
  the fresh attempt re-resolves pins with the same disambiguation; the window itself
  (`wave.mjs:143` lower bound) is not widened.
- **OQ3 — Default-on for same-role re-drives.** **SOUND** as a successor; kept gated on the opt-in
  surface proving the evidence law (D4) in the fold first. D3 unchanged.
- **OQ4 — The REPL-lane composition.** **SOUND** as a successor; D2's non-blocking posture is
  consistent with #69's own independent-rows pin (repl-realization-contract.md:430). D2 unchanged;
  re-evaluate after #69's fold lands.

## What the fold must NOT change (report §10 — verified sound) — preserved intact

- **The D4 evidence law (blocker-free).** Only THIS attempt's digests count; carried rows can
  never re-arm a gate, satisfy a verification, or answer a steering cycle (GT8 / D4 core bullets).
- **The opt-in/refusal posture (blocker-free).** Per re-drive opt-in, never default-on; typed,
  surface-constant refusals; cross-role / unrelated-wave refusal BEFORE any side effect (D3 core).
- **The closed four-member content set** (D1) — right-sized; unchanged, with the framing and
  allocation now pinned around it.
- **The byte-stability pin (R8).** The continuity block rides the `{brief, briefing}` augmentation
  and never mutates `task.brief`.

## Deliverable status

- `redrive-continuity-contract.md` — v1.0 DRAFT → **v1.1**, header carries the fold note; all 7
  blockers folded; new refusal codes **`redrive_carry_option_invalid`** and
  **`redrive_carry_unframable`**; amended pins **R2, R3, R5, R6, R7**; new pin **R9**; open
  questions **OQ1/OQ2 RESOLVED**, **OQ3/OQ4 SOUND**.
- `contract-fold.md` — this map (blocker → change, all items + open questions).
- Every corrected anchor and every new pin was re-verified at the fold HEAD with NUL-safe
  `grep -an` / `sed -n` (the two NUL files `application.mjs` and `coordination-store.mjs` were
  never whole-file-read).
