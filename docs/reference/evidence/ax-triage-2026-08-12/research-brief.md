# RESEARCH TASK (glm) — AX findings #108-#112 triage: the disposition table

You are a RESEARCH worker. Deliverable: ONE markdown report at
`docs/reference/evidence/ax-triage-2026-08-12/ax-108-112-triage.md`.

## The task

The AX-review wave (2026-08-06) produced five findings filed as issues #108, #109, #110, #111,
#112 (read each with `gh issue view N`). Their receipts live under the AX-review evidence —
find them (likely `docs/reference/evidence/ax-review-*/` or the reviews/ tree; also the
orchestrator friction ledger at `docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md`
references them).

For EACH of the five issues:

1. **Restate the finding in one sentence** (what's broken/missing, with its evidence file:line).
2. **Current truth check**: is it still present at HEAD? The codebase moved a LOT since (the
   #10 waitingOn vocabulary, #103 briefing pack, #132 wave observability all landed). Verify
   against the current tree with greps (`grep -an` for NUL files `application.mjs` +
   `coordination-store.mjs`; plain grep elsewhere). Mark each: STILL-PRESENT / PARTIALLY-FIXED
   (what changed) / FIXED-BY-OTHER-WORK (which commit/issue).
3. **Disposition proposal**: assign each to a lane — (a) fold into an EXISTING in-flight lane
   (name which: #71 wake, #72 prescriptive doctor, #79 delivery push, #132 follow-ups, the AX
   spine post-#10), (b) its own new contract (say the seed), or (c) close (if fixed, with the
   proof).
4. **Rank the survivors** by orchestrator-AX impact.

## Laws

Every claim cites the file:line it was read from. Read-only outside the deliverable. No clocks.
If a receipt file can't be found, say so and work from the issue bodies + the friction ledger.
