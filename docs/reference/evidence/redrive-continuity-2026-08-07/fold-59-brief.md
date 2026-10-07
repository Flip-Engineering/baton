# #59 FOLD BRIEF — fold the red-team report into the re-drive-continuity contract (v1.0 → v1.1)

You are folding an adversarial red-team report into the re-drive-continuity contract. Read fully,
in order: (1) `contract-redteam.md` (NOT FOLD-READY — the numbered blockers in §10, each with its
concrete fix; the per-decision notes carry the detail); (2) `redrive-continuity-contract.md`
(v1.0 — your edit target).

## The blockers, headlined (fold ALL per the report's fixes)

1. **Per-item framing + body neutralization** — the carried content gets per-item
   `[carried/untrusted]` frames + `wrapProse` wrapping + neutralization of `## `-prefixed /
   orchestration-reserved lines at the render seam (mirror the #69 B5 single-line-leaf
   discipline); amend R3 to test exactly that (a carried note containing `## Pending attention`
   or a fake frame header renders inert).
2. **Renderer coverage** — pin the section in BOTH renderers with `renderPrompt`'s position
   (mirror #79 D1: after the verification contract line), or scope the seam to one renderer and
   say why.
3. **The render-order collision with #69/#79** — the three carried-content sections (#69 cited
   objects, #79 pending attention, #59 continuity) need ONE pinned total order; fold the order
   and name the owning contract (recommend: this contract owns the order and the others cite it,
   or the order lives in a shared seam doc — the report's fix governs).
4+. **The remaining numbered blockers** per the report (the pin digest list binding, the refusal
   gaps, the acceptance-pin amendments) + the open-question verdicts.

## Laws + deliverables

No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files); sorted-key
literals ACTUAL order; `localeCompare` banned. Header to **v1.1** with the fold note. Edit ONLY:
`redrive-continuity-contract.md` (v1.1) + `contract-fold.md` (blocker → change map, all items +
open questions) — this directory.
