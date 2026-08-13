# CONTRACT FOUNDRY — shared frame (multi-member workflow dogfood, 2026-08-13)

Every member reads this first. This wave drafts FOUR implementation contracts in parallel —
one per row — with a heavyweight coordinator cross-checking. It is also the campaign's second
#74-pattern dynamic-workflow dogfood: rows publish their drafts to the `shared` scratchpad
partition as they go; the coordinator reads them there.

## The shared laws (bind every member)

- Ring-2 contract form: ground truths → decisions → refusal vocabulary → red-first acceptance
  pins → open questions. Every acceptance pin RED at the current HEAD.
- Every citation verified THIS session (`grep -an`/`sed -n` on `application.mjs` +
  `coordination-store.mjs` — NUL discipline; plain grep elsewhere). A wrong citation is an
  automatic red-team blocker later — check twice.
- No clocks as controls anywhere (the campaign control law — your contract may not introduce
  one). Sorted-key literals ACTUAL order; `localeCompare` banned. Byte literals only in
  `limits.mjs` (cite the #89 registry for new bounds).
- Read the sibling contracts' form before writing: a good recent model is
  `docs/reference/evidence/scratchpad-write-2026-08-13/contract-fold.md` (v1.1, folded).
- **Escalation posture:** authority-class ambiguity → DECISION_REQUEST with 2–4 options +
  free response (it defers to the top orchestrator). Judgment calls are yours — record them
  in the contract's open-questions section.
- **Publish-as-you-go:** when your contract draft is complete, write your file AND post the
  full text to the `shared` scratchpad partition (worker-facing scratchpad write; scope
  `shared`, kind `note`, title = your issue number).

## Row assignments (your objectiveRef names yours)

- `row-quiescence` → issue #163 (de-clock the interpreter's hardCap)
- `row-launchval` → issue #165 (launch-time harvest-contract validation)
- `row-readiness` → issue #167 (bounded actual-inference readiness tier)
- `row-telemetry` → issue #146 (fleet seat telemetry surface)

Each row writes `docs/reference/evidence/contract-foundry-2026-08-13/contract-<issue>.md`
ONLY (plus the shared publish).
