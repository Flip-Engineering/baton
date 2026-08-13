# REVIEW FOUNDRY — shared frame (multi-member red-team workflow, 2026-08-13)

Every member reads this first. This wave red-teams FOUR contracts in parallel — one per row —
with a heavyweight coordinator cross-checking the attacks. Same doctrine as the contract
foundry: rows publish to the `shared` scratchpad partition as they complete; the coordinator
reads there.

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

## Row assignments

- `row-rt155` → `docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md` (the CLI silent-reinterpretation contract)
- `row-rt156` → `docs/reference/evidence/mcp-profile-parity-2026-08-13/mcp-profile-parity-contract.md` (MCP default profile as bus superset)
- `row-rt161` → `docs/reference/evidence/orchestrator-plan-object-2026-08-13/orchestrator-plan-object-contract.md` (the orchestrator plan object)
- `row-rt164` → `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md` (blind waits fail loud)

Each row writes `docs/reference/evidence/review-foundry-2026-08-13/redteam-<issue>.md` ONLY
(plus the shared publish). Your report will be moved into the contract's own evidence dir at
landing — write it as if it lives there (cite the contract's dir paths as they are).
