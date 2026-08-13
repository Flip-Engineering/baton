[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-163]

# SUITE NOTES — #163 quiescence-completion red-first suite

- **Date:** 2026-08-13
- **Deliverables:** `impl/test/quiescence-completion-red.test.mjs` (the red-first suite; worktree
  `baton/ws-ddea5a827fcd8809c3c199330a6b17f5`) and this notes file (same dir as the contract).
- **Suite verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` — the tree the suite runs
  against (the worktree's `impl/src/workflow-interpreter.mjs` and `impl/src/application.mjs` are the
  pre-implementation sources the red rows fail on). Parent repo HEAD at note time:
  `ba789897fed74487ffb37810e5ae5286642c730e`.
- **Authority:** `contract-163.md` (v2 — folded source of truth), `fold-163.md` (fold notes + five
  judgment calls), `redteam-163.md` (B1/B2/B3 + secondaries), `row-quiescence.md` (this row's brief),
  `foundry-brief.md` (the shared frame — the attempt-echo law #171 binds the header above).

---

## Row inventory (the stage is the HEAD failure seam, named per row)

Fifteen rows over the v2 acceptance pins A1–A13 plus the D2.4/D3.3 preservation guardrails. Every
red row fails at its named stage on the current HEAD; the three pin/guard rows (P1, P2, N1) are green
today and under the correct implementation. N1 is green at HEAD by design — it is the null-gating
guardrail that kills a landing running the quiescence machinery under the suite's fast pinned policy.

| Row | Stage (named seam) | What it pins | At HEAD |
|---|---|---|---|
| R1 | `quiescence-verdict-missing` | A quiet full roster (single parked member) receipts `verdict: 'WAVE-QUIESCED'`, `basis: 'quiesced'`, the `{ evidence: 'wave_quiesced' }` steering line, and per-outcome additive fields `quiescenceLastMeaningfulAt`/`quiescenceSilenceMs`/`progressClass`; the D6 receipt stays exactly the seven sorted keys (F14) and the member's miss reports `harvest_miss`. | **RED** — the loop has no quiescence exit; verdict is `WAVE-INCOMPLETE`, steering `[]`, outcome carries no additive fields. |
| R2 | `totality-evidence-missing` | A mid-turn member (outline phase `'running'` — NOT the literal `ACTIVE_TURN_PHASES` vocabulary — with a 60 s edit delay) + a quiet member is NEVER declared `WAVE-QUIESCED`; the phase-stuck member is terminalized-unrecoverable with `{ role, evidence: 'wave_terminalized_unrecoverable' }`. | **RED** — steering `[]`; no totality evidence line exists. |
| R3 | `readview-projection-missing` | The landed `readView` return projects `lastProgress`/`silenceMs`/`progressClass` from the outline (B3) — the one-command poll the quiescence predicate reads. Static source pin. | **RED** — `readView` (`workflow-interpreter.mjs:451-461`) returns a closed shape; all three identifiers absent from the readView body. |
| R4a | `quiescence-floor-missing` | The window floor is the named evidence-count constant `QUIESCENCE_MIN_SILENT_POLLS` and the cadence term `maxObservedGapMs` (A2/D1.2) — never a bare wall clock. Static source pin. | **RED** — neither identifier exists. |
| R4b | `active-turn-phases-missing` | `ACTIVE_TURN_PHASES` is a named module-scope set (D1.1). Static source pin. | **RED** — absent. |
| R4c | `reset-set-missing` | The reset set is the union with the four #67 liveness re-arm kinds (`approval.resolved`/`decision.settled`/`lifecycle.turn_started`/`question.answered` — the `REARM_KINDS` mirror, A3/D1.1). Static source pin. | **RED** — all four literals absent from the interpreter. |
| R4d | `null-sentinel-missing` | `normalizeDriver` accepts `hardCapMs === null` and the loop condition honors the sentinel (A6/D2.2). Static source pin. | **RED** — `hardCapMs === null` appears nowhere; `number < null` would exit immediately. |
| R4e | `quiescence-vocabulary-missing` | The named verdict `WAVE-QUIESCED` and both evidence lines (`wave_quiesced`, `wave_terminalized_unrecoverable`) exist (D1.5). Static source pin. | **RED** — all three absent. |
| R5 | `hard-break-evidence-missing` | A member terminalizing unrecoverably (`failed`) hard-breaks the loop at that poll (A5/DR-1(a)): `WAVE-INCOMPLETE` + `{ role, evidence: 'wave_terminalized_unrecoverable' }`, and the survivor **result-sha** is still harvested. | **RED** — a failed member merely leaves `pending` (`:733`); steering `[]`; the survivor sha IS harvested at HEAD (the assertion that stays green under the landing). |
| R6 | `production-driver-uncapped-missing` | `PRODUCTION_WORKFLOW_DRIVER` ships `hardCapMs: null` (A6/D2.1) — the production cadence is uncapped. Static source pin, region-restricted to the driver block, `application.mjs` read via `latin1` (NUL discipline). | **RED** — the block still ships `hardCapMs: 3 * 3_600_000`. |
| P1 | `lane-driver-preserved` | **PIN.** The suite lane driver stays byte-identical (`LANE_DRIVER` = `{ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 }`, the D2.4/A11 backstop) and a settling wave receipts `WAVE-OK` + the seven-key receipt. Kills an impl that changes the fast policy or drops the D6 shape. | **GREEN** — the fast path is untouched at HEAD. |
| P2 | `stuck-decision-preserved` | **PIN.** A decision-stuck roster (answerDecisions non-matching pattern defers) exits via the stuck-decision early-break (`D3.3`/A10), receipts `WAVE-INCOMPLETE`, and is NEVER `WAVE-QUIESCED`. Kills an impl that lets quiescence preempt the stuck-break or misreports a decision-stuck roster. | **GREEN** — the early-break exists and fires. |
| N1 | `null-gating-missing` | **GUARD (green at HEAD).** The SAME quiet-roster fixture as R1 driven under `LANE_DRIVER` (`hardCapMs: 3000`) NEVER receipts `WAVE-QUIESCED` and pushes no `wave_quiesced` line — the check is gated on `hardCapMs === null` (D2.4/A13) and the suite's pinned fast policy (A11) never runs the machinery. Kills a wrong landing that runs the predicate under a clock (a false 120 ms-floor `WAVE-QUIESCED` breaks A11). | **GREEN** — no quiescence machinery exists at HEAD at all. |
| N2 | `cadence-derived-window-missing` | A roster observed producing meaningful events at a CONTROLLED gap (two `content.file_edit` events, the second `delayMs` 400 then 800 across two waves) is NOT quiesced at the 120 ms floor — the declared `quiescenceSilenceMs` scales with 2× the observed cadence in BOTH scenarios (A2/D1.2). The cross-scenario ordering kills a bare-constant window. The edits also behaviorally demonstrate the reset set (edits advance `lastProgress.at` — A3). | **RED** — both waves run to the 3000 ms fallback cap; verdict `WAVE-INCOMPLETE`. |
| N3 | `post-declaration-rewake-missing` | After a `WAVE-QUIESCED` declaration no member WORK event (`lifecycle.turn_started`/`content.file_edit`/`task.claimed`) lands after the declaration snapshot's `quiescenceLastMeaningfulAt` (A9/G8 — `wave.close` stops every member). | **RED** — no declaration machinery exists; the verdict assertion fails first. |

## Stage table (what each row's red failure means for the landing)

| Stage | The landing must... | A plausible wrong landing this row kills |
|---|---|---|
| `quiescence-verdict-missing` | Add the quiescence exit: named verdict, named basis, evidence line, per-outcome additive fields, D6 shape preserved. | Relabeling `WAVE-INCOMPLETE` as `WAVE-QUIESCED` (A1's shallow-greenability) — R1 asserts the basis `'quiesced'` AND the additive fields, so a relabel alone fails. |
| `totality-evidence-missing` | Re-check the REAL phase vocabulary (the outline renders mid-turn `'running'`, not the literal `ACTIVE_TURN_PHASES` member `'working'` — fold judgment call 1) and terminalize a phase-stuck member via the totality rule. | A landing that uses the literal set without re-checking the outline vocabulary quiesces the mid-turn member → `WAVE-QUIESCED` (R2's `notEqual` fails). |
| `readview-projection-missing` | Project `lastProgress`/`silenceMs`/`progressClass` from the outline in the `readView` return. | A landing whose drive loop reads quiescence data it never projects (B3's under-specification). |
| `quiescence-floor-missing` | Name the window floor constant and derive the cadence term from observed gaps. | A bare-constant window (A2's shallow-greenability). |
| `active-turn-phases-missing` | Name the `ACTIVE_TURN_PHASES` module-scope set. | A landing with no phase gate (D1.1's mid-thought false-quiescence). |
| `reset-set-missing` | Include the four #67 liveness re-arm kinds in the reset set. | A reset set that excludes `lifecycle.turn_started`/`decision.settled`/`question.answered`/`approval.resolved` (B1's liveness mirror). |
| `null-sentinel-missing` | Accept `hardCapMs === null` in `normalizeDriver` and honor it in the loop condition. | A landing that leaves `number < null` (immediate exit) or falls back to the default. |
| `quiescence-vocabulary-missing` | Add the named verdict and both evidence lines. | A landing with a different vocabulary (the closed enum + evidence lines are the contract's honesty channel). |
| `hard-break-evidence-missing` | Hard-break on `cancelled/failed/stopped/denied` and push the evidence line; harvest survivor result-shas. | Exclude-and-continue (the named follow-on, not v1 law) or a landing that stops the survivor harvest. |
| `production-driver-uncapped-missing` | Ship `PRODUCTION_WORKFLOW_DRIVER` with `hardCapMs: null`. | A landing that keeps the 3 h production cap (the #153 repair — D2.1's de-clocking). |
| `lane-driver-preserved` (PIN) | Leave the suite lane policy and D6 shape untouched. | An impl that nulls `LANE_DRIVER.hardCapMs` or drops/reorders a receipt key. |
| `stuck-decision-preserved` (PIN) | Evaluate the stuck-decision break BEFORE the quiescence check, and never report a decision-stuck roster quiesced. | An impl that lets quiescence preempt the stuck-break or misreports the exit. |
| `null-gating-missing` (GUARD) | Run the quiescence check ONLY under `hardCapMs === null` (D2.4); under the suite's pinned 3000 ms lane the same quiet roster must stay `WAVE-INCOMPLETE`. | An impl that runs the predicate regardless of sentinel — a false 120 ms-floor `WAVE-QUIESCED` under the fast policy (A11). |
| `cadence-derived-window-missing` | Derive the window from the observed cadence: `max(2 * maxObservedGapMs, QUIESCENCE_MIN_SILENT_POLLS * pollIntervalMs)` — the two-scenario ordering (400/800) is the discriminator. | A bare-constant window (A2's shallow-greenability) — it cannot satisfy both scenarios. |
| `post-declaration-rewake-missing` | `wave.close` stops every member at declaration; no WORK event lands past the snapshot's `quiescenceLastMeaningfulAt` (A9/G8). | A landing that declares quiescence but lets a member resume (liveness hole — B2's "no post-declaration re-wake"). |

## Measured splits (split-twice from repo root, pre-implementation tree)

Both runs from the worktree root (`impl/test/quiescence-completion-red.test.mjs`), against
`e371f704727cbca5fdff86af31ec8b154620a71f`, with `node --test`:

| Run | tests | pass | fail | duration |
|---|---|---|---|---|
| Split 1 | 15 | 3 | 12 | 30 320 ms |
| Split 2 | 15 | 3 | 12 | 34 740 ms |

The red rows (R1–R6, N2–N3) fail at their named stages on both runs; the pin/guard rows (P1–P2, N1)
pass on both. R1/R2/N3 each run the HEAD 3 s `hardCapMs` fallback (the `null` sentinel falls back to
the 3000 ms default at HEAD — D2.2's red state); R5 and N1 break at the 3 s backstop; N2 runs two
waves (each to the fallback cap) ≈ 2 × 4.2 s; the static source pins (R3, R4a–e, R6) fail in
sub-millisecond. Deterministic: no `provider_failure` race, no `wave.close()` hang (the park
fixture's `delayMs: 30` first edit lands `turn_completed` after the wave's `steering.registered`
record — verified 5/5 deterministically during fixture development).

## Judgment calls recorded (mine to make per the row brief)

1. **The park fixture is a `delayMs` deterministic park, not a probe-I/O race.** A bare pausable
   member nondeterministically parks (good) vs. fails `terminal:provider_failure` + hangs
   `wave.close()` (bad) in the `runWorkflow` path, because `_admitPauseRecord`'s `hasDriver` gate
   arms a steering cycle when `lifecycle.turn_completed` lands before `steering.registered`. I give
   the parked member's first edit `delayMs: 30` so the turn completes after the record — deterministic
   without incidental probe I/O. The `modelSelection` override is deliberately NOT touched (it breaks
   route resolution → `provider_failure` at spawn).
2. **The decoupled-clocks double is the silence fixture.** `progressClass` becomes `'silent'` only at
   `silenceMs >= PROGRESS_SILENCE_THRESHOLD_MS = 120_000`, so a parked member with a real clock reads
   `'progressing'` for the whole test. The fixture's application clock runs `Date.now() + 130_000`
   (a double, not a control — the campaign law's "no clocks as controls" applies to the CONTRACT, not
   to fixture doubles) so a parked member reads `silenceMs ≈ 130 s` → `'silent'` immediately.
3. **R2's mid-turn member discriminates the phase-vocabulary seam.** The outline renders a mid-turn
   member's phase as `'running'` (application.mjs `_buildView`: `node.state === 'paused' → 'paused'`,
   `else if (node.taskId) → 'running'`), which is NOT the literal `ACTIVE_TURN_PHASES` member
   `'working'`. Fold judgment call 1 warns the landing must re-check the real vocabulary; R2 asserts
   `verdict !== 'WAVE-QUIESCED'` so a landing that naively applies the literal set (quiescing the
   mid-turn member) fails.
4. **The source pins are EXISTENCE/byte-string anchors, never line-window anchors** (the suite law):
   R3 scopes to the `readView` body (slice `async function readView` → `const TERMINAL_PHASES`),
   R6 scopes to the `PRODUCTION_WORKFLOW_DRIVER` block (slice the constant → first `});`), and the
   R4 rows assert identifier/literal presence. No `localeCompare`; sorted-key literals in ACTUAL
   sorted order.
5. **`watchdog.stallMs` is 60_000** — far beyond any row window, so a parked turn's freshly armed
   timer never fires and writes nothing that flaps the stall marker (the wave-driver-policy idiom).
6. **N1 is green at HEAD by design — it is the null-gating guardrail, not a pin on current behavior.**
   The quiet-roster fixture is byte-for-byte R1's; only the driver changes (`LANE_DRIVER`, `hardCapMs:
   3000`). A naive re-run of the quiescence machinery at HEAD would fail A11 (the suite's fast policy),
   so N1's assertions (`verdict !== 'WAVE-QUIESCED'`, no `wave_quiesced` line) must hold both at HEAD
   and under the landing — it kills a wrong landing that runs the predicate under a clock (D2.4/A13).
7. **A4's two-poll confirmation race is not hermetically drivable; N2 + R4a cover it instead.** The
   confirmation re-arm (any `lastProgress.at` advance or `progressClass` flip between the candidate
   poll and the confirmation poll) is a 15 ms poll-interval race — a scenario that re-arms the pair
   deterministically would itself be the flaky fixture. Coverage: N2 behaviorally demonstrates the
   reset set (a second edit inside the window re-arms — the cadence gap is only counted after the last
   edit) and R4a statically pins the window term (`maxObservedGapMs`). The race seam stays covered by
   the contract's per-poll order (D3.3) which R4e's vocabulary and N1's gating pin.
8. **A12's totality leg (a) — an unreadable member — is not hermetically inducible; R2 + R4e cover
   totality.** A spawn failure reads `{ phase: 'failed', terminal: true }` (A5's hard-break path), not
   "unreadable", so `readView`-throws-every-poll cannot be induced without stubbing the run handle.
   Coverage: R2 behaviorally drives the phase-stuck leg (b) (a mid-turn `'running'` member
   terminalized-unrecoverable) and R4e pins the `wave_terminalized_unrecoverable` evidence line that
   BOTH legs emit. A landing that drops either the totality rule or its evidence line fails R2/R4e.

## Open notes

- **OQ5's split is honored in the assertions.** R1 asserts the declaration-snapshot evidence under
  the pinned names (`quiescenceLastMeaningfulAt`/`quiescenceSilenceMs`) — the contract's quiescence
  evidence — while preOutcome remains settlement evidence. The row does not merge the two.
- **A12's totality rule is exercised via R2's phase-stuck leg (b); the unreadable leg (a) is not
  behaviorally driven** — an unreadable member (`readView` throws on every poll) is hard to induce
  hermetically without stubbing the run handle, and the totality source vocabulary is pinned by R4e
  (the `wave_terminalized_unrecoverable` line). The phase-stuck leg is the behavioral representative.
  Rationale and coverage split: judgment call 8.
- **A2's cadence discriminator lives in N2's cross-scenario ordering, not a constant.** The two waves
  (400 ms / 800 ms) assert `quiescenceSilenceMs >= 2*delay − 150` per wave AND `s800 > s400 + 300`
  — a landing whose window is any fixed constant (including a bare `QUIESCENCE_MIN_SILENT_POLLS *
  pollIntervalMs` floor) fails the second comparison. The `−150` tolerance absorbs the mock adapter's
  ~124 ms measured edit-to-evidence overhead.
- **N3's re-wake scan is scoped to member WORK events only.** The `wave.close` stop sequence
  (`run.stop_admitted` / kill.* / cleanup) legitimately lands after the declaration snapshot; the
  scan filters to `evidence.mapped` payloads of `lifecycle.turn_started` / `content.file_edit` /
  `task.claimed` with a `worker` role, with a +50 ms event-vs-snapshot ordering tolerance.
- **R5's survivor-sha assertion is green at HEAD by design** — the contract (D1.4/A5) says survivor
  result-shas are still harvested, and HEAD already harvests them; the row's RED is the missing
  evidence line, which discriminates a landing that stops survivor harvest or fails to push the line.
