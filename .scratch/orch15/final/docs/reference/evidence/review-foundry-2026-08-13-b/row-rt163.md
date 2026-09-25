# ROW BRIEF — row-rt163: adversarial red-team of the #163 contract

Read `foundry-brief.md` first (the shared frame binds you: the axes, the citation law, the
verdict scale, the publish-as-you-go rule). Your target:
`docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md` (quiescence-derived
completion — the no-clocks replacement for elapsed-time caps) — read it FULLY, plus the
foundry-qa cross-check (`docs/reference/evidence/contract-foundry-2026-08-13/foundry-qa.md`,
the section naming your contract) and the issue (`gh issue view 163`).

Attack per the shared axes, with special attention to: does the quiescence signal survive
pathological member mixes (a silent-but-alive row + a dead row + a waiting-on-decision row)?
A quiescence definition that can fire while a member is legitimately mid-thought is the
classic failure — attack it against the REAL event taxonomy in the code. Citation audit
first (a wrong citation is an automatic blocker), then per-decision attacks, the refusal
vocabulary, the acceptance pins (shallow-greenability), the open questions. Verdict per
decision SOUND/HOLE with the fix; final FOLD-READY or NOT with numbered blockers.

Deliverable: `docs/reference/evidence/review-foundry-2026-08-13-b/redteam-163.md` ONLY, plus
the full text published to the `shared` scratchpad partition (kind `note`, title "#163").
