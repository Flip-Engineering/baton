# ROW BRIEF — row-fold163: fold the #163 quiescence contract

Read `docs/reference/evidence/fold-2026-08-13-b/foundry-brief.md` first — it binds you, INCLUDING
the blind-QA law (row report governs on conflict). Your material:

- Contract: `docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md` (FULL read)
- Red-team: `docs/reference/evidence/contract-foundry-2026-08-13/redteam-163.md` — **B1-B3 + secondaries, all binding**:
  - B1 (the mid-thought false-quiescence): gate candidacy on liveness — a pending member whose
    `progressClass !== 'silent'` or whose run is in an active turn phase is NEVER a candidate;
    add the #67 liveness kinds (`lifecycle.turn_started`, `decision.settled`,
    `question.answered`, `approval.resolved`) to the reset set; pair with B2 so a phase-stuck
    member still terminates.
  - B2 (unreadable-member non-totality): a still-pending member unreadable for N consecutive
    polls is terminalized-unrecoverable (the D1.4 exit) — the loop must be total now that the
    hard cap is gone.
  - B3 (landing under-specified): name the `readView` projection extension
    (`lastProgress`/`silenceMs`/`progressClass`) in the contract and anchor D1.1/D1.3 on it.
  - Secondaries: D2.4(b) suite-safety reasoning invalid (gate the quiescence check on
    `hardCapMs === null`; the 120 ms floor is suite-only); D2.1 `stallTimeoutMs` parenthetical
    is a ghost; A2 greenable by a bare constant; A1 greenable by a relabel; D1.4 "worktree
    state" overclaims (harvest reads result shas).
- QA: `docs/reference/evidence/review-foundry-2026-08-13-b/review-qa.md` §2 — the §2.4 set:
  H1/H1a (the phase/progressClass-aware candidate predicate — SAME fix as row B1, fold once),
  keep D1.2 cadence derivation / D1.3 two-poll confirmation / D2.1 `hardCapMs: null` sentinel +
  `normalizeDriver` null branch + loop-condition fix / D6/F14 receipt preservation as written.

**TOP-ORCHESTRATOR DECISION (law):** DR-1 (OQ2, unrecoverable-terminal exit): **option (a),
hard-break for v1** — the first `cancelled/failed/stopped/denied` member stops the wave and
harvests already-written state (deterministic; matches the receipt's `manifestDigest` basis).
**Exclude-and-continue is a NAMED FOLLOW-ON RUNG**, and the fold must record today's evidence
for it: this campaign's foundries delivered through dead/limp members only because the current
interpreter effectively continues (four complete suites outlived a premature coordinator verdict
on 2026-08-13). The follow-on's spec should pin survivor-harvest semantics.

Also fold the operator-facing evidence already on the issue (`gh issue view 163` comments —
if `gh` works; else the copy at the campaign level): silence is not even weak evidence of death
for silent-turnless workers — B1's fix is the structural answer.

Deliverables per the shared frame: the folded contract in place +
`docs/reference/evidence/contract-foundry-2026-08-13/fold-163.md` (attempt line in the FIRST
FIVE lines).
