# FOLD NOTES — #163 quiescence-derived wave completion (contract v1 → v2)

[attempt: 31545279-5f3c-49ad-809b-2492a09b0efc row-fold163]

- **Date:** 2026-08-13 · **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f`
- **Deliverables:** `docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md` (folded v2,
  this dir) and this fold-notes file (same dir). Work confined to `contract-foundry-2026-08-13/**`.
- **Fold inputs (all binding):** `redteam-163.md` (same dir — B1/B2/B3 + secondaries; governs over the
  QA on conflict per the blind-QA law), `docs/reference/evidence/review-foundry-2026-08-13-b/
  review-qa.md` §2 (§2.4 instruction set), top-orchestrator decision **DR-1(a)** (hard-break for v1 —
  law), and the operator-facing evidence from issue #163 (campaign-level copy in `row-fold-163.md`).

---

## Blocker → resolution map

Each fold input resolves to exactly one of FOLDED / KEPT / ESCALATED. The same map, with the exact
contract anchors, is the `## Fold record` appended to `contract-163.md` (v2).

| # | Input | Resolution | Where it lands |
|---|---|---|---|
| 1 | **B1 — mid-thought false-quiescence** (redteam §2.1): candidate predicate is pure `silenceMs >= windowMs`; the reset set excludes the #67 liveness kinds; a turn producing only noise reads silent; the pathological mix (silent-but-alive + dead + waiting) escapes the stuck-break and false-declares. | **FOLDED** | D1.1 three-leg candidate predicate — `silenceMs >= windowMs` **AND** `progressClass === 'silent'` **AND** phase ∉ `ACTIVE_TURN_PHASES` (new named set). Reset set = `_followCategory`-meaningful kinds **∪** `REARM_KINDS`. D1.3 confirmation liveness-aware (a `progressClass` flip fails it). G11 records the liveness floor. D3.3 records mixed-roster honesty. |
| 2 | **B1 pairing — phase-stuck member would hang** (redteam §2.1 #3): a member phase-`working`-forever with `progressClass` eventually `silent` is a never-candidate under the gate. | **FOLDED** | D1.4 totality rule leg (b): phase-stuck for N consecutive polls → terminalized-unrecoverable. The liveness gate and the terminalization rule are specified as ONE design. |
| 3 | **B2 — unreadable-member non-totality** (redteam §2.2): `readView` swallows `inspect()` throws → `{ phase: null, terminal: false }` → never a candidate → infinite loop under `hardCapMs: null`. | **FOLDED** | G12 (unreadable seam + preOutcome `/* unreadable — settle at close */` precedent); D1.4 totality rule leg (a): unreadable for N = confirmation-pair + 1 consecutive polls → terminalized-unrecoverable via the existing D1.4 exit; **A12** new RED pin. |
| 4 | **B3 — landing under-specified** (redteam §2.3): `readView` (`workflow-interpreter.mjs:451-461`) drops `lastProgress`/`silenceMs`/`progressClass`; v1's G3 overclaim. | **FOLDED** | G3 corrected; the readView projection extension is NAMED (`lastProgress`/`silenceMs`/`progressClass` projected from `io`); D1.1/D1.3 anchor on the projected fields; A7 asserts the landed projection keeps the one-command poll. |
| 5 | **Secondary: D2.4(b) reasoning invalid** (redteam §3): the check is live in the suite with a 120 ms floor; a mid-LLM-generation member > 120 ms is a candidate. | **FOLDED** | D2.4 gates the quiescence check on `driver.hardCapMs === null`; the suite never runs the machinery; **A13** new RED pin + A11 amended. |
| 6 | **Secondary: D2.1 `stallTimeoutMs` ghost** (redteam §3): parsed/returned, never read by the drive loop; the parenthetical overstated its role. | **FOLDED** | D2.1 parenthetical deleted; G13 records the ghost; `stallTimeoutMs` retained for driver-shape compatibility only. |
| 7 | **Secondary: A2 shallow-greenable** (redteam §6): a bare `windowMs = 60 000` passes the 30 s/60 s assertions. | **FOLDED** | A2 now varies cadence across three scenarios (10 s→≥20 s; 60 s→≥120 s; 30 s→≥60 s). |
| 8 | **Secondary: A1 shallow-greenable** (redteam §6): relabeling any `WAVE-INCOMPLETE` as `WAVE-QUIESCED` passes A1 while skipping D1.1. | **FOLDED** | A1 marked shape-only AND paired with a mid-turn counterexample (kills the relabel). |
| 9 | **Secondary: D1.4 "worktree state" overclaim** (redteam §4): `harvestOne` reads the committed result sha (`git show` at the pin), never the live worktree. | **FOLDED** | D1.4/D3.1/A5 now read "survivor result-shas are still harvested". |
| 10 | **QA H1/H1a** (review-qa §2.3): predicate ignores live phase/progressClass; cold-start floor (160 s for the entire first turn) can false-declare a healthy long first turn. | **FOLDED once** (same fix as B1, per §2.4 "fold once") | D1.1 three-leg predicate + `ACTIVE_TURN_PHASES`; "never started" vs "first turn still running" distinguished. |
| 11 | **QA §2.4 keep-set** (review-qa §2.4 #2): keep D1.2 cadence derivation, D1.3 two-poll confirmation, D2.1 sentinel + `normalizeDriver` null branch + loop-condition fix, D6/F14 receipt preservation. | **KEPT** | D1.2, D2.2, G9/A8/F14 verbatim from v1; D1.3 kept and anchored on the projected fields (B3) plus the liveness-flip confirmation leg (B1). |
| 12 | **OQ2 → DR-1** (review-qa §6): hard-break vs exclude-and-continue, escalated. | **ESCALATED + RESOLVED (law)** | **DR-1(a): hard-break for v1** — the first `cancelled/failed/stopped/denied` member stops the wave and harvests already-written result shas (D1.4). Exclude-and-continue is a NAMED FOLLOW-ON RUNG. |
| 13 | **Operator evidence (issue #163)**: silence is not even weak evidence of death for silent-turnless workers. | **FOLDED** | G11 + D3.2 honesty paragraph; B1's liveness gate named as the structural answer. |
| 14 | **OQ3 / OQ4 / OQ5 verdicts** (redteam §7) | **FOLDED / RESOLVED / PINNED** | OQ3 → gating-on-`hardCapMs === null` (no new field); OQ4 → RESOLVED SOUND (wave-driver loop not armed in the interpreter path); OQ5 → declaration snapshot named as the quiescence evidence, preOutcome as settlement evidence. |

**Final verdict:** **FOLD-READY** — the mechanics (loop sentinel, de-clocking, suite backstop, exit
vocabulary, D6/F14 preservation) were verified sound by both the red-team and the QA; the fold closes
B1/B2/B3, all five secondaries, the QA §2.4 set, and DR-1(a). The remaining open items are named
follow-ons (exclude-and-continue survivor-harvest semantics; a merged preOutcome snapshot), not
blockers.

---

## Judgment calls recorded (mine to make per the fold frame)

1. **`ACTIVE_TURN_PHASES` boundary.** I define it as the complement of the terminal set
   (`APPLICATION_RUN_TERMINAL_PHASES`, `application.mjs:159-161`, plus the interpreter's
   `result_ready`/`closed`, `workflow-interpreter.mjs:464`) and the operator-gated waits
   (`progressBlockedDetail` non-null, `application.mjs:492-504`) within `CANONICAL_RUN_PHASES`
   (`application-semantics.mjs:20-25`) — concretely `{ planning, queued, working, uncertain,
   verifying, result_selected, reviewing, integrating, stopping }`. I EXCLUDE `paused`/`interrupted`:
   a suspended run cannot emit without a resume, so `progressClass` governs it (blocked-on-interaction
   → never a candidate; silent-and-unblocked → candidate). A landing should re-check this against the
   real phase vocabulary the outline carries (there are two phase name-spaces in the code —
   `awaiting_plan_approval`/`selection_required` in `progressBlockedDetail` vs
   `awaiting_approval`/`awaiting_selection` in `CANONICAL_RUN_PHASES`).
2. **`blocked_interaction` members are NOT covered by the totality rule.** A member waiting on an
   operator interaction is alive (the decision could settle at any moment) — the wave continues to
   wait for it; the stuck-decision break (D3.3) handles the handled-decision sub-case; a genuine
   operator wait is a wave-level wait, not a stall. This leaves one theoretical non-totality corner
   (an operator never answers a genuine wait), which is a human-in-the-loop wait, not a quiescence-
   machinery failure; recorded so a follow-on can decide whether the totality rule should extend to
   it.
3. **Liveness-kind re-arm sourcing.** The projected fields (`lastProgress`/`silenceMs`/`progressClass`)
   are meaningful-event-derived, so the `REARM_KINDS` reset-set extension is an event-level re-arm the
   landing must source from the same coordination log `_progressTiming` reads (or a projected
   `livenessRearmedAt`). The phase gate is the primary structural protection; the reset-set extension
   is the honest #67 mirror (B3's three projected fields are the named minimum, not the only channel).
4. **N = 3 for the totality rule** (confirmation pair + 1). Evidence-count derived from D1.3's
   structure, configurable alongside `quiescenceMinPolls`; not a wall clock.
5. **`progressClass` value vocabulary.** The red-team's fix text mentioned `progressClass` classes
   "active"/"working"; the actual `projectProgressClass` (`application.mjs:505-520`) returns
   `progressing`/`silent`/`blocked_interaction:*`/`terminal:*`. I folded against the REAL vocabulary
   (`progressClass !== 'silent'` gate), not the red-team's loose labels.

---

## Evidence for the DR-1(a) follow-on rung

The fold records, per `row-fold-163.md`: this campaign's foundries delivered through dead/limp members
only because the current interpreter effectively continues (four complete suites outlived a premature
coordinator verdict on 2026-08-13). Under a v1 hard-break those survivors would have been cut off.
The follow-on (exclude-and-continue) spec should pin survivor-harvest semantics: which survivors are
harvested, how in-flight (unwritten) work is counted, and how the verdict reconciles a
partially-harvested wave. Hard-break's adoption of the totality rule at the same D1.4 seam is what
makes the v1 control total.

---

## Incremental fold-audit — no silent drops (rows 17–25)

Rows 1–16 in the map above cover the numbered blockers and the QA keep-set. This incremental audit
closes every remaining finding so that EVERY red-team section and EVERY QA §2 instruction carries an
explicit FOLDED / STRUCK / ESCALATED / KEPT resolution — nothing implicit, nothing bundled into
another row without being named. The same rows are appended to `contract-163.md`'s `## Fold record`.

| # | Fold input | Resolution |
|---|---|---|
| 17 | Redteam §1 citation audit — no wrong citation; no automatic blocker; the holes are in logic/completeness, not anchors. | **KEPT** — audit clean at HEAD `e371f70`; re-applied to v2's new anchors (G3 projection, G11–G13, `ACTIVE_TURN_PHASES`, `progressBlockedDetail`) this session. |
| 18 | Redteam §3 mechanics SOUND — D2.2 sentinel handling, D2.1 de-clocking (facade default `request.driver ?? PRODUCTION_WORKFLOW_DRIVER`), wave-driver 3h loop not armed in the interpreter path. | **KEPT** — D2.1/D2.2 as written (minus the ghost, row 6); OQ4 resolved (row 15). |
| 19 | Redteam §4 D3.3 mixed-roster incompleteness — the stuck-break guarantee holds only for a whole-roster decision-stuck state. | **FOLDED** — D3.3 honesty fix: a mixed roster cannot false-declare under B1 (mid-thought member never a candidate); unreadable/phase-stuck members terminate via the D1.4 totality rule. |
| 20 | Redteam §6 A7 premise false at HEAD — the pin asserts the check reads fields the `readView` drops. | **FOLDED** — A7 asserts the LANDED projection (`lastProgress`/`silenceMs`/`progressClass` on the returned shape) and the one-command poll; not a silent subset of B3. |
| 21 | Redteam §6 all 11 pins RED verified at HEAD. | **KEPT** — recorded; the three greenability notes are rows 7/8/20; A12/A13 added as new RED pins. |
| 22 | Redteam §5 refusal vocabulary SOUND — no new refusal code; closed enum + two evidence lines complete. | **KEPT** — vocabulary unchanged in v2; the totality rule reuses `wave_terminalized_unrecoverable`/`terminalized_unrecoverable`. |
| 23 | QA §2.3 H2 (note) — the D1.4 hard-break discards in-flight survivor work. | **ESCALATED** — DR-1(a): hard-break for v1 (already-written result-shas harvested); exclude-and-continue follow-on rung pins survivor-harvest semantics (row 12). |
| 24 | QA §2.2 spot-check — every #163 anchor re-verified; no wrong anchor found. | **KEPT** — agrees with redteam §1 (row 17): anchors sound, holes are logical. |
| 25 | Blind-QA conflict — the QA's H1 fix is necessary but NOT sufficient alone (would hang a phase-stuck member; under-specifies the landing). Row report governs. | **FOLDED as row-governs** — the red-team's three-part B1 (row 1) + B2 pairing (row 2) + B3 projection (row 4) is the governing superset; the QA's H1/H1a is folded ONCE into that predicate, not as a separate weaker rule. |

**STRUCK items: none.** Every input was either implemented (FOLDED), verified-correct as written
(KEPT), or decided at the authority class (ESCALATED). No finding was dismissed as inapplicable.

### Blind-QA conflict record (explicit)

The QA was blind — it never saw `redteam-163.md` (the wave-b row reports were dead; the QA performed
a direct meta-cross-check and its §2.3 fix instruction names the same hole the red-team names). On
the one point of genuine tension — whether the phase/liveness-aware predicate ALONE closes the hole
(implicit in the QA's H1 "the only cure") vs the red-team's demonstration that it is necessary but
insufficient without the B2 totality pairing and the B3 readView projection — the **row report
governs** (blind-QA law). The fold therefore folds the QA's H1/H1a once, as a subset of B1, and
adds the B2 pairing + B3 projection the QA's fix would not have closed. No QA instruction was
dropped: §2.4 #1 is row 10, #2 is row 11, #3 is row 12.

### `lifecycle.turn_completed` note

Redteam §2.1 lists `lifecycle.turn_completed` among the kinds `_followCategory` returns `null` for.
It is deliberately NOT added to the reset set: the #67 re-arm set (`REARM_KINDS`, `coordinator.mjs:71-76`)
excludes it, and the row brief's explicit list excludes it. The fold mirrors #67 exactly (the four
`REARM_KINDS` kinds), consistent with the "mirror, not re-specify" law. `turn_completed` is a noise
kind at the #67 level and stays a noise kind here.
