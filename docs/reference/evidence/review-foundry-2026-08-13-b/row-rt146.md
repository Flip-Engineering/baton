# ROW BRIEF — row-rt146: adversarial red-team of the #146 contract

Read `foundry-brief.md` first (the shared frame binds you: the axes, the citation law, the
verdict scale, the publish-as-you-go rule). Your target:
`docs/reference/evidence/contract-foundry-2026-08-13/contract-146.md` (the seat telemetry
surface — real-time accurate seat/capacity reporting to the orchestrator) — read it FULLY,
plus the foundry-qa cross-check
(`docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md`, your section) and the
issue (`gh issue view 146`).

Attack per the shared axes, with special attention to: is the telemetry actually REAL-TIME
and actually DERIVED from the seat-holding machinery (not a parallel guess that can drift)?
The operator's challenge on this exact point — "where did these limits come from? is seat
telemetry real time and accurate?" — is the bar. A telemetry surface that can disagree with
the allocator is worse than none. Citation audit first (a wrong citation is an automatic
blocker), then per-decision attacks, the refusal vocabulary, the acceptance pins
(shallow-greenability), the open questions. Verdict per decision SOUND/HOLE with the fix;
final FOLD-READY or NOT with numbered blockers.

Deliverable: `docs/reference/evidence/review-foundry-2026-08-13-b/redteam-146.md` ONLY, plus
the full text published to the `shared` scratchpad partition (kind `note`, title "#146").
