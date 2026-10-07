# #59 CONTRACT BRIEF — re-drive continuity: carry a dead attempt's context into the next attempt

You are drafting the implementation contract for issue #59 (re-drive continuity). Read fully, in
order: (1) the issue — `gh issue view 59` (sonnet's ask: "carry forward a dead attempt's
scratchpad into the next attempt's objective"); (2) the campaign's OWN evidence this week: the
impl-114 deepseek attempt drained after 2.5h (its scratchpad/findings died with it — only the
boundary-commits saved the code) and the #71 contract attempt died on a transient provider error
and re-drove COLD (the fresh attempt re-read everything from scratch); (3) the machinery: the 93B
attach/pin preservation (the dead attempt's checkpoint pins persist), the scratchpad projection
(#33 — write/elevate/settle; the per-member notes), the re-drive path (the 93B rule 5 /
`redriveMembers` in the recipes lane — `impl/src/recipes.mjs`), the brief-assembly seam
(`impl/src/adapter.mjs` — where the fresh attempt's objective is composed); (4) the #142 lesson
(evidence/context deliverables and scope) and the #69 REPL-realization contract v1.1 (cited
context objects — the continuity pack COULD ride the REPL lane once #69 lands; name the
composition posture, don't block on it).

## The contract must decide

- **What carries forward (the closed content set).** The dead attempt's scratchpad projection
  (notes/plans/doubts — the settled + unsettled reads), the checkpoint-pin digest list (NOT the
  diffs themselves — the fresh attempt resolves pins it needs), the terminal cause, and the
  refusal/failure evidence. Everything UNTRUSTED-framed (a dead attempt's notes are
  model-authored content entering a fresh worker's brief — the injection discipline is the
  whole game). Byte/item-bounded with digest-cited spill (#89 law).
- **The composition seam.** Where in the fresh objective the continuity block lands (a named
  section, like #79's pending-attention and #69's cited objects — the rendering order across all
  three must compose; name it), and how the fresh attempt is TOLD the provenance (this is a
  re-drive of attempt N, its work died of X, here is its state — never presented as the
  orchestrator's own instructions).
- **Opt-in vs default.** Per re-drive (the orchestrator declares `carryForward: true` + the
  source attempt) or default-on for same-role re-drives? Pin the admission surface (the wave
  member field / the redriveMembers option), the closed shape, and the refusal for a
  carry-forward from a DIFFERENT role or an unrelated wave (never silent).
- **The trust posture.** Carried content is evidence, not authority: the fresh attempt's plan +
  gate evaluate it as untrusted input. Pin that a carried scratchpad can never re-arm gates,
  satisfy verifications, or answer steering cycles on the new attempt's behalf (the TG2
  evidence law: only THIS attempt's digests count).
- **Refusal vocabulary + acceptance pins (red-first)** per decision.

## Laws + deliverable

Ring-2 form. No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files);
sorted-key literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec): #33,
#69, #79, #93B, #141, #142. Deliverable: ONLY
`docs/reference/evidence/redrive-continuity-2026-08-07/redrive-continuity-contract.md` (v1.0
DRAFT with the verification HEAD).
