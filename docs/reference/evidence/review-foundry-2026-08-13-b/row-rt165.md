# ROW BRIEF — row-rt165: adversarial red-team of the #165 contract

Read `foundry-brief.md` first (the shared frame binds you: the axes, the citation law, the
verdict scale, the publish-as-you-go rule). Your target:
`docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md` (launch-time contract
validation — the driver refuses when brief deliverables exceed harvest targets) — read it
FULLY, plus the foundry-qa cross-check
(`docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md`, your section) and the
issue (`gh issue view 165`).

Attack per the shared axes, with special attention to: the validation boundary itself — what
counts as "exceeds" (a deliverable path not in harvest paths? a mustContain the brief never
mentions? a scope path the harvest can't see?). If the rule can be gamed by an honest-but-
sloppy brief, or false-positives on a legitimate spec, name it. Citation audit first (a wrong
citation is an automatic blocker), then per-decision attacks, the refusal vocabulary, the
acceptance pins (shallow-greenability), the open questions. Verdict per decision SOUND/HOLE
with the fix; final FOLD-READY or NOT with numbered blockers.

Deliverable: `docs/reference/evidence/review-foundry-2026-08-13-b/redteam-165.md` ONLY, plus
the full text published to the `shared` scratchpad partition (kind `note`, title "#165").
