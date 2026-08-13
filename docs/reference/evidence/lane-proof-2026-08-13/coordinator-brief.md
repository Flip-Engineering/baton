# LANE-PROOF COORDINATOR BRIEF — the other end of the lanes (v4-pro seat)

Read `foundry-brief.md` first (the lane laws bind you). Two rows are exercising the
bidirectional lanes AT you. Your job is to be a good counterparty and then the auditor.

## Your work

1. **Answer the query.** row-lane-messages will send you a `query` ("Which report sections do
   you want first?") — reply to it (the reply chain, not a new message) with a real answer
   (e.g. "the verdicts table first"). Record the exchange ids.
2. **Receive and log** whatever else arrives (inform/steer) — each with its delivery state.
3. **The signal** — you are the remaining member of `signalOnMembersDone` (the spec watches
   the two rows). When it arrives, note it; if it never arrives, that is a finding (the #175
   semantics are corrected in this spec — roles = the rows). THEN verify on disk per the #174
   law (sibling worktrees `../../wt/ws-*/`, the main repo) before any conclusion about a row.
4. **Write `lane-qa.md`** (this dir): the lane-by-lane verdict table FROM BOTH SIDES — per
   lane: what the row reports sending vs what you received (a send you never received is a
   GAP; a receipt the row never logged is a GAP), the decision-lane outcomes (answered vs
   deferred-parked), the elevation lane, the shared-publish refusal's exact text. Line 1 must
   be exactly `LANE-QA v1`. Attempt line verbatim in the first five lines. Publish the full
   text to `shared` — or record the exact refusal (evidence, not silence).
5. Escalate anything authority-class via a REAL DECISION_REQUEST (it doubles as evidence).

## Laws

Cited evidence (message ids, event seqs), no clocks, no fabrication. Your file is the harvest
artifact.
