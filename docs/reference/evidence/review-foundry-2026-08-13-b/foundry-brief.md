# REVIEW FOUNDRY wave-b — shared frame (multi-member red-team workflow, 2026-08-13)

Every member reads this first. This wave red-teams FIVE contracts in parallel — one per row —
with a heavyweight coordinator cross-checking the attacks. Same doctrine as wave-a: rows
publish to the `shared` scratchpad partition as they complete; the coordinator reads there.

## The shared laws (bind every member)

- You are an ADVERSARIAL RED TEAM. Verdict per decision: SOUND (survives contact with the
  landed code) / HOLE (a named failure with a named fix; severity blocker / amendment /
  note). Final verdict FOLD-READY or NOT with numbered blockers (what + why + concrete fix).
- **Every citation re-verified this session** (`grep -an`/`sed -n` on `application.mjs` +
  `coordination-store.mjs` — NUL discipline; plain grep elsewhere). A wrong citation is an
  automatic blocker.
- Attack axes, minimum: (1) citation audit; (2) per-decision attack against the REAL code
  (not the contract's claims about it); (3) the refusal vocabulary (closed, typed,
  surface-constant); (4) the acceptance pins (would a wrong impl actually fail each —
  shallow-greenability); (5) the open questions.
- No clocks anywhere. Sorted-key literals ACTUAL order; `localeCompare` banned.
- **Escalation posture:** authority-class ambiguity → DECISION_REQUEST with 2–4 options +
  free response (defers to the top orchestrator). Judgment calls are yours — record them.
- **Publish-as-you-go:** your final report goes to your file AND the full text to the
  `shared` scratchpad partition (kind `note`, title = your issue number).
- **THE ATTEMPT-ECHO LAW (#171):** your objective opens with an `[attempt: <salt> <role>]`
  line. Your report file MUST carry that line VERBATIM in its header — the wave's harvest
  refuses to attribute content without it, however complete the work.

## Row assignments

- `row-rt170` → `docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` —
  the workflow DSL contract (523 lines, HIGH priority; budget depth accordingly — this is
  the campaign's next serialized impl). Also read the operator fold-in on the issue
  (`gh issue view 170 --comments`): baton-attached dispatch fields vs orchestrator-authored
  intent — attack whether the grammar actually makes hand-written machinery JSON impossible.
- `row-rt163` → `docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md`
  (quiescence-derived completion)
- `row-rt165` → `docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md`
  (launch-time contract validation)
- `row-rt167` → `docs/reference/evidence/contract-foundry-2026-08-13/contract-167.md`
  (readiness honesty / bounded inference probe)
- `row-rt146` → `docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md`
  (seat telemetry surface)

Each row writes `docs/reference/evidence/review-foundry-2026-08-13-b/redteam-<issue>.md` ONLY
(plus the shared publish). Your report will be moved into the contract's own evidence dir at
landing — write it as if it lives there (cite the contract's dir paths as they are).
