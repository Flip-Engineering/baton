# Blue-team v2: trust-gate-steering red suite v1.1 — re-verification

(Target: `impl/test/trust-gate-steering-red.test.mjs` v1.1 — 20 tests: T1-T3, T5-T10, T10b,
T7b, T8b, T11-T17, T14b (T4 absent). Re-verified against the contract as amended to v1.0.1
(`trust-gate-steering-decisions.md`), the v1 blue-team report (`test-blueteam.md`), and
`impl/src/` ground truth (NUL-containing files via `grep -an`/`sed -n`), 2026-08-02. Suite run
from repo root: `node --test impl/test/trust-gate-steering-red.test.mjs`.)

Verdict scale (unchanged from v1): **SOUND** / **WEAK** (correctly staged but a named wrong
implementation passes) / **VACUOUS** / **STAGED-WRONG**.

## Split confirmation

Run of record: **14 red / 6 green — the declared split.** The greens are
**T2, T9, T14b, T15, T16, T17** — note the fold's own guess was wrong on two names: T13 and
T8b are RED (correctly — see §1 items 1 and 5), and T14b is the sixth green. Reds: T1, T3,
T5, T6, T7, T7b, T8, T8b, T10, T10b, T11, T12, T13, T14. Every red fails at its named stage
(per-row failure modes in §2); no row fails for a harness artifact.

## Closing verdict

**GATE-NOT-READY (narrow)** — one blocking item (B1: TG5's "runs every other phase" has no
row; a phase-skipping analysis implementation goes green). All six v1 blocking items are
REPAIRED or contract-scoped; residuals in §6 are pre-acceptance follow-ups, not gate blockers.

---

## 1. v1 blocking items: REPAIRED or still-BLOCKING

### Item 1 (TG5 harness envelope, T12/T13) — REPAIRED

v1 defect: both rows threw at the outer `exactObject` (goal-plan.mjs:372) on a malformed
`{goal, request}` envelope; T12 could never go green, T13's green was an artifact.

v1.1: `const shaped = tgPlanRequest({ analysis: true }); normalizePlanRequest(shaped.request,
tgPolicy, shaped.goal)` (test :414-415; T13 :420-422) — the correct three-argument call on the
inner request. Verified by stack trace: T12 now fails at `normalizeNode`
(goal-plan.mjs:296:3) — the NODE-level `exactObject` rejecting the unknown `analysis` key,
exactly the named stage. T13 fails with `AssertionError: Missing expected exception` — the
omission validates today (the named behavior is unimplemented), so T13 is now honestly RED,
reclassified out of the green pins as v1 demanded. T13's refusal predicate
(`error?.name === 'GoalPlanValidationError' && /analysis/i.test(error?.message ?? '')`,
test :423-424) additionally pins that the future refusal NAMES the analysis field — it cannot
be satisfied by a generic envelope error. Clean repair.

### Item 2 (T7 verdict-event finder) — REPAIRED

v1 defect: the finder named `task.failed` / `worktree.progress_unchanged` on the worker
stream — the first is never minted there, the second is fixture-unreachable
(:7578-7580 manager check → `unsupported`).

v1.1: the expiry scenario moved to T7b (test :230-246), whose finder is
`event.kind === 'error' && event.payload?.code === 'required_effect_absent'` (:240-241) — the
gate's real verdict event (coordinator.mjs:11460-11471). The receipt assertion's disjuncts
(`includes('steered') || includes('"answered":false')`, :243-244) both scan the VERDICT
EVENT's payload, not the whole log. Verified by the run: T7b fails today at the receipt
assertion (:245) — status-failed and verdict-event-exists already pass; only the `steered`
receipt is missing. Precisely the named stage. Clean repair.

### Item 3 (T11 recovery-refinement call) — REPAIRED (by redesign + contract scope line)

v1 defect: the `createAndClaimRecoveryRefinement` call omitted mandatory closed-set fields
and violated the lineage pin — it threw `recovery_refinement_invalid` before any verdict
assertion, and the brief-digest byte-identity pin (coordination-store.mjs:2880) made a
verdict-carrying brief impossible through that API as written.

v1.1: the refinement traversal is dropped. The contract now carries the scope line the v1
report demanded, citing the finding: "Scope clarification (blue-team, v1.0.1): the
recovery-refinement brief is byte-identical to the prior task's brief by the store's digest
pin (coordination-store.mjs:2880) — the refinement brief is therefore NOT a verdict channel.
v1's testable core: (a) the projected terminal cause names the gate (`policy_failure` + the
exact code, never 'unknown'), and (b) the refusal is projected as sanitized {gate, detail} on
the DG-1 run.debug surface. The planner-composed next-brief delivery is the v1.1 half (named
follow-up)." (decisions :126-131). T11 (test :348-366) pins exactly (a) — `task.terminalCause
?? task.failure` must match `/required_effect_absent/` (red today: actual `null`; the gate
puts `terminalCause` on the HANDLE, coordinator.mjs:11484, nothing names the gate on the
task) — and (b) at the coordinator-observable level: the verdict event exists and
`payload.detail ?? payload` carries no `/tmp/wt/` path strings. Within the re-scoped testable
core: repaired. Residuals (non-blocking, §6): the sanitization negative is one pattern in a
no-diff scenario; baseSha/sha-hub-side and the DG-1 projection surface itself
(application.mjs:841-863, :797-804) have no row; the next-brief half is a named follow-up.

### Item 4 (T15 patterns vs shipped coaching) — PARTIALLY REPAIRED (narrowed, not closed)

v1 defect: patterns missed the actual coaching; green against the declared stage
("coaching still shipped"); discriminated nothing.

v1.1: patterns sharpened to `[/skeleton[- ]first/i, /trust.?gate/i, /beat(?:ing)? the gate/i,
/survive the gate/i, /no.?diff/i, /progress gate/i]` (test :456). Verified by grep: NONE
matches recipes.mjs today (exit 1) — the row is green, and for a defensible reason this time:
TG6's acceptance scan is reference-based ("no shipped constraint line references beating the
gate", decisions :150-151) and no shipped line references the gate today. The row now
discriminates gate-referencing coaching — it is a real pin, not a vacuous one.
What is NOT repaired: (a) the suite's own stage comment still reads "stage: coaching still
shipped" (test :451) — a red-first declaration the green row contradicts; (b) TG6's reword
obligation names recipes.mjs:529-536 verbatim (decisions :146-149) — the red-first line
(:529: 'Work red-first: write the failing test first…') and the SCRATCHPAD_WRITE shape
coaching (:533-536) match none of the sharpened patterns, so the epic can ship WITHOUT the
reword and T15 stays green; (c) the "objective boilerplate family" remains unscanned
(single-file scan). The row now honestly covers the reference-scan half of TG6; the reword
half still has no effective row. Downgraded from blocking to required-before-acceptance (§6).

### Item 5 (T5 status set + T8 negative branch) — REPAIRED

v1 defects: T5's allowed set included contract-forbidden `completed`/`verifying`; T8 never
exercised the pending-past-expiry branch.

v1.1 T5 (test :181-198): the set is `['working','paused']` (:194) with separate
`notEqual('failed')` and `notEqual('completed')` (:192-193), plus
`coordinator.pausedTurns({ taskId: task.id }).length === 0` (:196) — "the pause record is
consumed by the answer". The record-consumed assertion discriminates answered-and-settled
from window-never-expires (a lingering pending record fails it), closing the v1 hole in
composition with the status assertions. Note: T5's scenario changed from diff-on-turn-2 to
`lifecycle.turn_started` — the resumed-turn answer class (see §4 for the diff-capture row
that left with the old scenario).
v1.1 T8b (test :269-288): the missing negative branch — question emitted, window expires
UNANSWERED, `assert.equal(task.status, 'failed')` (:283) plus a steering-receipt assertion
(:284-287). A pending-crediting or window-holding implementation now goes red. The 6b farm is
closed by a row. Clean repair. (Nit: T8b's receipt predicate `payload?.steered ??
payload?.steering` (:286) is looser than T7b's — accepts a `steering` key and doesn't check
`answered: false`; §6.)

### Item 6 (TG2 content-floor ambiguity) — REPAIRED (by contract amendment; one stale paragraph)

v1 defect: T7 encoded a content floor ("one-char earns nothing") that TG2's bullet
("≥1 distinct receipt, nothing more") contradicted; only the acceptance paragraph supported it.

v1.1: TG2 is amended and now says it outright: "One distinct valid receipt answers the cycle;
ten identical one-char notes count once. There is NO content floor — the cycle is a liveness
check, and farming buys nothing beyond one answered cycle per pause record (the window is
bounded at 5 minutes, the cycle is once-per-record, and the FINAL evaluation still demands
the real diff — the farm bound lives at the final, not the window)." (decisions :78-82).
T7 was rewritten to match (test :217-228): six duplicate one-char receipts dedupe to one
distinct answer → cycle settles, not failed, record consumed. Row and contract are now
coherent, and the farm-bound argument (once-per-record × bounded window × final-still-demands-
diff) is stated in the contract text.
STALE RESIDUE: the acceptance paragraph was not amended and still says "A farmer (128
duplicate one-char notes; or a chain of unanswered trivial questions) does NOT answer the
cycle: dedup counts them once; unresolved interactions count never." (decisions :167-169) —
the first clause now contradicts TG2's own bullet (128 dupes = 1 distinct = ANSWERS the
cycle; the unanswered-question clause remains true via T8b). Contract hygiene fix required
before the document is cited against the suite (§6).

## 2. Vacuousness hunt on the new/changed rows

Per-row: what the row now pins, how it fails today (verified against the run), and whether a
wrong implementation can still pass.

### T1 (changed: verify-worktree spy) — SOUND

New assertion: `assert.equal(verifyWorktrees, 0, 'non-dispatch means the gate never even
builds its verify sandbox')` (test :137-139, :147). The v1 hole was "silent
dispatch-with-no-verdict" — undetectable because every terminal outcome was already pinned.
The spy closes it for the one path that could hide: a dispatch that suppresses the
required_effect throw and continues into the environment/verify phases now fires the counter.
(With T1's no-diff capture a naive full dispatch dies at required_effect before ever reaching
`createVerifyWorktree` — caught by the verdict assertions; the spy's specific prey is the
suppress-and-continue variant, v0.9's TG1 shape.) Red today at :144 (gate dispatched →
`failed`), named stage. The non-dispatch property is now measured, not proxied.

### T5 (rewritten: resumed-turn answer + record consumed) — SOUND

Allowed set now `['working','paused']` (:194) with separate failed/completed exclusions
(:192-193) — the taxonomy-tolerating statuses are gone. `pausedTurns(...).length === 0` (:196)
pins "consumed by the answer" against "window silently never expires" (a pending record would
fail it). Red today at :192 (`failed`). Residual (nit, §6): the answer path is
`lifecycle.turn_started` — like every answer-class row it cannot distinguish "answered by the
resumed turn specifically" from "answered by anything at all"; the negative rows (T7b/T8b)
carry that weight in composition.

### T6 (changed: settle assertion) — SOUND

Adds `pausedTurns(...).length === 0` — "the cycle SETTLED (answered) — not merely 'no verdict
yet'" (test :212-213). The v1 weakness (answered-via-receipt indistinguishable from
never-expires standalone) is closed: never-expires leaves the record pending. Red today at
:211. The 25 ms window vs microtask-flush timing note from v1 stands (§6).

### T7 (rewritten: no-content-floor) — SOUND with nits

Six duplicate one-char receipts → dedupe to one distinct → ANSWERS (test :217-228): not
failed (:226), record consumed (:227). Faithful to the amended TG2 (:78-82). Red today at
:226, named stage. Nits: (a) the title's tail "and the final still demands the diff" asserts
nothing in-row — that property lives only in the T2/T14b pins (composition, but the title
overclaims); (b) no post-window observation — an answer-then-later-expire-kill would pass
(T6's sleep covers the shape in composition); (c) under the no-floor semantics the dedup
sentence itself is now consequence-free at the cycle level (one distinct of any content
answers; each record gets exactly one cycle) — T7 mirrors the contract text faithfully, but
"count once" is no longer observable in any row, and the contract keeps the sentence anyway.
Contract-text residue, not a row defect (§6).

### T7b (new: expiry + receipt on the real verdict event) — SOUND with one gap

Nothing answers → sleep past the window → `failed` (:239), verdict event found by kind
`error` + code (:240-242), receipt on the event payload (:243-245). Red today at the receipt
assertion — the first two assertions already pass, so the row is red for exactly the missing
receipt, the cleanest staging in the suite. Gap: **the "window actually elapsed" property is
unmeasured.** No row asserts the task is alive BEFORE the sleep; an implementation that kills
instantly at the checkpoint but fabricates `steered: {answered: false}` passes T7b (and
T8b). Today's honest instant-kill fails only because it lacks the receipt. One
`assert.notEqual(task.status, 'failed')` before the `sleep` would pin the window's lower
bound. Below the plausibility bar for blocking (requires active receipt fabrication), but it
is the suite's only unmeasured time dimension (§6).

### T8 (changed: record-consumed added) + T8b (new: negative branch) — SOUND

T8 keeps the resolve-answers half and adds `pausedTurns(...).length === 0` (:266). T8b is the
pending-past-expiry negative (§1 item 5). Together they pin resolution-gating both ways.
T8b's receipt predicate is the loose one (`steered ?? steering`, no `answered:false` — §6);
composition with T7b still forces the `steered` key. Red today: T8 at :264 (already failed
before the question exists), T8b at the receipt assertion (:287).

### T10 (new: once-per-record) — SOUND

Three-count pin: checkpoint 1 → exactly 1 nudge (:312); `turn_started` + checkpoint 2 →
exactly 2 (:317) — a NEW record gets its own single cycle, the old one is not re-armed;
`content.message` chatter → still 2 (:320) — micro-progress does not re-arm. All three events
exercise the real switch (`lifecycle.turn_started` at coordinator.mjs:11960, `content.message`
in the event family at :48/:10323). Red today at :312 (0 nudges). Residual: chatter MUST NOT
ANSWER the cycle either — T10 checks only the nudge count, not the record's survival after
chatter; an implementation where `content.message` answers passes (nit, §6).

### T10b (new: claim on a cycle-armed record) — SOUND

Cycle armed (1 nudge, :329-330) → `claimTurn` on the pending record (:334) → full gate →
`failed` (:336) → verdict event carries NO `steered` (:338-341). Pins both halves of "claim
counts as its answer (6c)": the claim still resolves through the full gate (a
settle-working-without-gate implementation fails :336) and the claim's verdict is not
mislabeled as an expiry (a steered-on-everything implementation fails :340). Red today at
:329 (no cycle exists). The claim-resolved verdict's receipt-free shape is the exact
counterfactual T7b needs — the pair discriminates expiry-verdicts from claim-verdicts.

### T11 (rewritten: terminal cause + sanitized projection) — SOUND within the v1.0.1 scope

(a) `task.terminalCause ?? task.failure` must name `required_effect_absent` (:357-358) —
red today (`null`; the gate's `terminalCause` sits on the handle, not the task). (b) the
verdict event exists and carries no `/tmp/wt/` strings (:361-365) — passes today and
functions as a regression net. Within the contract's declared testable core (decisions
:126-131) the row is faithful. Its remaining softness is inherited from the scope, not a
defect: the DG-1 projection itself is application-layer (no row), baseSha/sha-hub-side is
unasserted, and the next-brief half is a named follow-up (§6).

### T12/T13 (fixed envelope) — SOUND

§1 item 1. T12 red at goal-plan.mjs:296 (node `exactObject`, the named stage); T13 red
"Missing expected exception" (named behavior unimplemented), with the analysis-named refusal
predicate pinning error quality. The TG5 schema pair is now honest.

### T14 (new: analysis node skips required_effect at finals) — WEAK (the one blocking gap)

Scenario: `makeBrief({ analysis: true })` — note the brief KEEPS
`requiredEffects: ['repository_edit']` alongside `analysis: true` (test :433 + :38-49). That
is the STRONGER scenario and contract-correct: "Final evaluation of an analysis node skips
required_effect" (decisions :142-143) is unconditional on requiredEffects' presence, so the
row proves the flag trumps the list rather than merely correlating with omission. Good
design. Red today at :437 (`failed` — the field is unknown to today's gate), named stage.
**The gap: "and runs every other phase" is asserted only as `status ∈ ['verifying',
'completed']` (:438) — an implementation that skips ALL phases for an analysis brief and
accepts immediately lands `completed` and passes.** That is not a hypothetical flavor of
wrong: it converts `analysis: true` into a forbidden_effect/path_scope exemption, the exact
weakening authority attack 4's red-team target named and the contract's sentence exists to
forbid. No spy (T1's pattern would work) and no analysis-plus-out-of-scope-diff row pins it.
This is blocking item B1 (§6).

### T14b (new: the boundary's near side) — SOUND

Non-analysis edit-free final → `failed` (test :441-448). Green today for the right reason
(the gate fires on the required-edit brief). Together T14/T14b pin "the flag is the
boundary" — an implementation ignoring the flag fails T14; one skipping required_effect for
EVERYONE fails T14b.

## 3. The greens

Actual greens (run of record): **T2, T9, T14b, T15, T16, T17.** The fold's own guess
"(T2, T8b?, T9, T13, T15, T16, T17)" is wrong on two: **T13 and T8b are red** — correctly so.
T13's green in v1 was the envelope-malformation artifact (v1 item 1); fixed, it goes red
because the sole-omission path is unimplemented. T8b is red at its receipt assertion (the
window machinery doesn't exist yet). T14b is the sixth green the guess missed.

- **T2 — SOUND.** Unchanged row, unchanged machinery: non-pausable card → `'claim'`
  classification (coordinator.mjs:2657-2659) → straight to gate → `required_effect_absent` →
  `failed`. Green for the documented reason; the no-nudge assertion remains vacuous until TG3
  lands (correct red-first pin shape).
- **T9 — SOUND.** Unchanged. The `paused` half has teeth today (real `recordDriver` → driver
  scan at :2051-2054); the no-nudge half is vacuous pre-TG3 by design.
- **T14b — SOUND.** New pin, green for the right reason: a non-analysis required-edit brief's
  edit-free final fails today. It is T2's boundary twin; together with T14 it makes the flag
  load-bearing in both directions.
- **T15 — green for a DEFENSIBLE reason, not the documented one.** §1 item 4: none of the
  sharpened patterns matches recipes.mjs today (verified by grep, exit 1), and TG6's
  acceptance scan is reference-based — so green is correct against the contract's letter. But
  the suite's own stage comment still declares "coaching still shipped" (a red stage), and
  the named reword targets (:529-536) match no pattern. Adjudication: a real pin now
  (discriminates gate-referencing coaching), mis-documented and narrower than TG6's full
  obligation. Not vacuous; not blocking.
- **T16 — SOUND.** Unchanged regression pin (out-of-scope diff at a final →
  `worker_path_scope_violation` → `failed`).
- **T17 — SOUND.** Unchanged drivered-final pin (real `recordDriver` + `pausedTurns` +
  `claimTurn` → full gate → `failed`).

## 4. Coverage ledger delta

Newly covered since v1 (all ✗→✓ unless noted):

- TG1 checkpoint non-dispatch: ✓ measured (T1 spy). "Task stays `paused`" still unpinned
  (T1 allows any non-terminal status) — residual nit.
- TG3 once-per-record / no re-arm: ✓ T10 (three-count pin).
- TG3 claim-on-armed counts as answer (6c): ✓ T10b (gate still runs; no expiry receipt).
- TG3 expiry → full final + receipt durable: ✓ T7b (real verdict event).
- TG2 resolution-gating, negative half: ✓ T8b (the 6b farm closed by a row).
- TG2 no-floor semantics: ✓ T7 (faithful to amended TG2).
- TG4 v1.0.1 testable core (self-naming cause + sanitized projection): ✓ T11.
- TG5 schema pair (analysis admission + sole-omission refusal): ✓ T12/T13.
- TG5 gate behavior, the skip half: ✓ T14. **The "every other phase" half: still ✗ (B1).**

Still uncovered (unchanged from v1, now mostly contract-scoped or follow-ups): diff-capture
answer class (T5's old scenario was replaced by resumed-turn — in practice turn_started
subsumes it: a capture happens only at turn boundaries, and the resumed turn answers first;
minor); un-driven final (a) mixed-classification sequence and (c) run-termination no-gate;
past-deadline/null-deadline interaction non-re-arm (#67 sibling); board-mutation evidence
class; baseSha/sha-hub-side and the DG-1 run.debug surface (application-layer); the
planner-composed next-brief delivery (v1.1 named follow-up); run.feedback "accepts no new
caller shape" (TG7 follow-up); `contextEffectNodeBinding` (6d) and post-approval flip
(machinery DEFENDED, no pin); node→brief surfacing of `analysis` through
`buildAuthoritativeBrief` (T14 injects the field at brief level — the realistic surfacing is
untested end-to-end); TG6's reword half and the objective-boilerplate family (§1 item 4).

Numbering note: the suite header (:4) still says "Seventeen rows" — the file now holds 20
tests; T4 remains the only absent number. Stale comment, trivial fix.

## 5. Fixture authority (new rows)

- `lifecycle.turn_started` (T5/T10) is a real switch case (coordinator.mjs:11960);
  `content.message` (T10) is in the handled event family (:48, :10323). The resumed-turn and
  chatter emits are not no-ops.
- `pausedTurns({ taskId })` filters to PENDING records only (coordinator.mjs:2093-2103) — the
  new record-consumed assertions (T5/T6/T7/T8) measure real pause-record state. Caveat worth
  knowing: today's auto-settle also resolves the record immediately, so the assertion is 0
  pre-implementation too; its discriminating target is the post-implementation "answered but
  left pending" wrong shape, and the status assertions carry the pre-implementation staging.
  Sound in composition, noted for accuracy.
- T10b exercises the real `_reservePauseRecord`/`claimTurn` path (:2295-2327) — the claim
  re-runs the same `_runTrustGate`; the receipt-free assertion reads the gate's real verdict
  event.
- T14 injects `analysis: true` at BRIEF level via `makeBrief` — a fixture shortcut for the
  hub-built brief (the node→brief surfacing through `buildAuthoritativeBrief` remains
  untested, §4). The gate reads `task.brief`, so the row exercises the real decision point
  the implementation must honor.
- The v1 fixture limits stand unchanged: fake worktrees (no `retainCheckpoint`), frozen
  `now()`, 15 s stop horizon, 25 ms wall-clock window against microtask flushes (T6/T8's
  answer must land within ~ms of arming — fine on a quiet machine, load-fragile).

## 6. Residual items

**BLOCKING (one):**

- **B1 — TG5's "runs every other phase" has no row (T14 WEAK).** An implementation that skips
  ALL phases for an analysis brief and accepts immediately passes T14 (`completed` ∈ the
  allowed set), green-certifying a forbidden_effect/path_scope exemption — the precise
  weakening the contract's sentence exists to forbid and authority attack 4's red-team target
  named. Fix: add T14c — analysis node + out-of-scope diff (`changedPaths: ['etc/evil.txt']`,
  `pathScope: ['src/**']`, T16's shape with `analysis: true`) must still fail
  `worker_path_scope_violation`; optionally arm T14 with T1's verify-worktree spy (an analysis
  final must still build the verify sandbox and run the referee). One small row; the suite is
  otherwise ready.

**Non-blocking, required before the epic's acceptance:**

- R1 (contract hygiene): amend the acceptance paragraph (decisions :167-169) — its farmer
  clause contradicts the amended TG2 no-floor bullet (:78-82); its TG4 clause ("verdict
  reaches the re-driven worker's brief… run.feedback accepts no new caller shape") predates
  the v1.0.1 scope line (:126-131).
- R2: T7b/T8b — assert `task.status !== 'failed'` BEFORE the `sleep` (the window's lower
  bound; today only the outcome after expiry is measured, so instant-kill-plus-fabricated-
  receipt passes). Unify the receipt predicate — T8b accepts a `steering` key T7b rejects,
  and neither checks `answered: false` on the key.
- R3: T15 — restage the comment (the row is a green pin for the reference-scan half of TG6,
  not a red row for "coaching still shipped") and decide the reword half: either a red-today
  row matching the named lines (recipes.mjs:529, :533-536) or an explicit acceptance-review
  item; extend the scan beyond recipes.mjs (objective boilerplate family).
- R4: T7 — title's "the final still demands the diff" asserts nothing in-row (rely on T2/T14b
  or trim the title); T10 — assert the record survives `content.message` chatter (chatter must
  not answer); T5/T6/T8's 25 ms wall-clock window is load-fragile.
- R5 (suite hygiene): header comment says "Seventeen rows" (20 tests); T4 remains the absent
  number.
- R6 (carried coverage ✗, §4): diff-capture answer class; un-driven final (a)/(c);
  past-deadline interaction non-re-arm; node→brief `analysis` surfacing; DG-1 surface;
  next-brief delivery (v1.1 follow-up); run.feedback caller-shape exclusion (TG7 follow-up).

## Closing verdict (full)

**GATE-NOT-READY (narrow) — one row away.**

Every v1 blocking item is REPAIRED or contract-scoped: the TG5 envelope (T12 red at
goal-plan.mjs:296, T13 honestly red), the T7 finder (T7b reads the gate's real `error`/
`required_effect_absent` verdict and is red only for the missing receipt), the T11 traversal
(replaced by the v1.0.1 scope line at decisions :126-131 — the contract now cites the
blue-team finding), T5's status set + T8b's negative branch, and the TG2 floor ambiguity
(amended away at decisions :78-82, T7 rewritten to match). The run of record is 14 red /
6 green with every red at its named stage and no staged-wrong or vacuous rows remaining. The
single blocking defect is B1: T14 claims "runs every other phase" but pins only the skip — a
phase-skipping analysis implementation green-certifies a scope-check exemption. Add T14c
(and preferably the T1-style spy on T14) and this suite can gate the epic; land R1-R3 before
the acceptance review cites any of these documents.
