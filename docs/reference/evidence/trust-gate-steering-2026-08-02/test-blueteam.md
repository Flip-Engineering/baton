# Blue-team: trust-gate-steering red suite — adversarial verification

(Target: `impl/test/trust-gate-steering-red.test.mjs` — 14 rows, numbered T1-T17 with T4/T10/T14
absent. Verified against the v1.0 contract (`trust-gate-steering-decisions.md`), both red-team
reports, and `impl/src/` ground truth (NUL-containing files read via `grep -an`/`sed -n`),
2026-08-02. Suite run from repo root: `node --test impl/test/trust-gate-steering-red.test.mjs`.)

Verdict scale: **SOUND** = red for the named stage today, green only on a contract-correct
implementation, and a wrong implementation cannot pass it. **WEAK** = correctly staged and
discriminating in composition, but a named wrong implementation can pass it (false-green hole).
**VACUOUS** = passes/passed without exercising the named behavior. **STAGED-WRONG** = the row's
red/green state does not track the named contract behavior (false-red on a correct
implementation, or green against its own declared stage).

## Verdict summary

| Row | Named behavior | Verdict | One-line basis |
|-----|----------------|---------|----------------|
| T1 | TG1 checkpoint non-dispatch + one provenance nudge | WEAK | Pins consequences (no terminal, no kill, 3 verdict codes, 1 nudge) but cannot distinguish non-dispatch from silent dispatch-with-no-verdict |
| T2 | Finals evaluate as today (anti-gaming pin) | SOUND | Real final seam (non-pausable card → 'claim' → straight to gate); green for the documented reason |
| T3 | No mid-workflow acceptance (A1 hole) | SOUND | Red today on observed `completed`; pins the accept-phase half of the taxonomy |
| T5 | Diff inside window answers the cycle | WEAK | Allowed-status set includes contract-forbidden `completed`/`verifying`; answer path never forced; no post-window observation |
| T6 | Distinct receipt answers the cycle | WEAK | "Answered via receipt" vs "never fails" not distinguished standalone; T7 is the only backstop and it is staged-wrong |
| T7 | Dup dedup + expiry + steering receipt | STAGED-WRONG | Verdict-event finder names kinds the gate never mints on the worker stream; fixture makes `progress_unchanged` unreachable; "counts once" measured by outcome only; encodes a content floor the contract text does not state |
| T8 | Resolution-gated interactions | WEAK | The discriminating branch (pending past expiry → verdict) is never exercised; a pending-crediting implementation passes |
| T9 | No policy cycle when drivered | SOUND (half vacuous today) | `paused` assertion has teeth via the real driver seam; no-nudge half is vacuous until TG3 exists |
| T11 | Verdict in re-driven brief, sanitized, self-naming | STAGED-WRONG | Recovery-refinement call violates the API's closed field set + lineage pins — throws before any verdict assertion once reached; sanitization negatives vacuous in a no-diff scenario; baseSha leak unchecked |
| T12 | `analysis: true` node validates | STAGED-WRONG | Malformed request envelope throws at the outer `exactObject` before node validation; can never go green |
| T13 | Omission without analysis = validation error | VACUOUS | Green via the same envelope malformation; the named behavior is unimplemented — both omission forms validate today; a corrected T13 would be RED |
| T15 | TG6 coaching retirement source pin | STAGED-WRONG | Declared stage says coaching still shipped (should be red); patterns miss the actual shipped coaching; green today and unflippable by a real TG6 edit |
| T16 | path_scope fires at finals (regression pin) | SOUND | Real gate path, real phase, correct outcome |
| T17 | Drivered claim re-runs the FULL gate | SOUND | Real recordDriver + pausedTurns + claimTurn seam; green for the documented reason |

Observed split (matches the declared 8 red / 6 green): red T1, T3, T5, T6, T7, T8, T11, T12;
green T2, T9, T13, T15, T16, T17. Five reds fail at their named contract stage (T1/T3/T5/T6/T8:
gate dispatched at checkpoint → `failed`/`completed`, no cycle exists); T11 fails at its named
self-naming assertion (before its staged-wrong API call is reached); T7 fails at its
staged-wrong event finder (its stage-appropriate first assertion already passes); T12 fails at
its malformed envelope (the named stage is masked). Corrected for the two harness bugs
(T12/T13 envelope), the honest split is 9 red / 5 green — T13's green is an artifact.

## Closing verdict

**GATE-NOT-READY.** Blocking items in §6.

---

## 1. FALSE-GREEN hunt (per red row)

For each red row: can an implementation that VIOLATES the named contract behavior still pass?

### T1 — "no gate dispatch" (WEAK)

Assertions: status ∉ {failed, completed}; `kill.length === 0`; zero log events with
`payload.code` in {forbidden_effect_observed, worker_path_scope_violation, required_effect_absent};
exactly one `adapter.prompt` call containing `baton-progress-check:`.

- **Does it distinguish non-dispatch from dispatch-with-no-verdict? No.** The three codes are
  the gate's real failure codes (coordinator.mjs:11158, :11170, :11185, minted on kind `error`
  at :11460-11471), so any gate run that TERMINATES is caught (status/kill/code filter). But a
  wrong implementation that dispatches the gate at the checkpoint and silently discards the
  outcome — runs capture/forbidden/path_scope, creates verify worktrees, invokes the referee,
  writes no verdict event, settles `paused` — passes all four assertions. The contract's
  "deferral is non-dispatch, never a gate run with phases skipped" (TG1, folding A9) exists
  precisely because the dispatched phases cost real machinery per turn; T1 has no spy on
  `createVerifyWorktree`/referee invocations (both are injected fixtures — trivially countable)
  and no filter for the gate's non-verdict emissions (e.g. `atlas.structural_classified`,
  verify events). The fix is one spy counter, not new machinery.
- The exactly-one-nudge assertion is the row's strength: a no-op deferral (no gate, no nudge)
  fails it; two prefixed nudges fail it; the prefix pins TG3's provenance mark, observed at the
  real delivery seam (`nudgeTurn` → `adapter.prompt`, coordinator.mjs:2208).
- Residual gaps: the contract's "the task stays `paused`" is not pinned (any non-terminal
  status passes), and "no gate event is written" is only proxied by the three failure codes.
- Red today for the right reason: the gate dispatched at the checkpoint → `failed` (observed).

### T3 — no mid-workflow acceptance (SOUND)

Single assertion: status ≠ `completed` on a zero-requiredEffects brief. Red today on the
observed `completed` — A1's accept-hole is live (passingReferee + green base + no
required_effect throw → accept at :11380-11423). Narrow by design: it pins only the
acceptance half; T1 pins the not-failed half. A wrong implementation that FAILS every
checkpoint would pass T3 alone, but that violates T1 — the pair composes. Does not pin
non-dispatch (same proxy gap as T1), but its named target is the acceptance hole specifically.

### T5 — diff answers the cycle (WEAK)

- **The allowed-status set tolerates a taxonomy violation.** `['working','paused','verifying',
  'completed']` — but under v1.0, turn 2 of a pausable worker mints a pause record = a
  CHECKPOINT, where "no gate dispatch" applies and acceptance is impossible. `completed`
  requires a gate run + accept; `verifying` means the gate is mid-run. An implementation that
  (wrongly) gates the second checkpoint and accepts passes T5 green. The set should have been
  `['working','paused']` plus the separate `notEqual('failed')` it already has.
- **Nothing forces the answer via the diff-capture path.** A never-fail implementation (defer
  everything, nudge once, never expire a window) passes T5 — and T1, T6, T8. The suite's only
  expiry-enforcing row is T7 (see its own problems). Composition, not T5, carries the weight.
- **No post-window observation.** After turn 2 there is no `sleep` past the 25 ms window —
  `flush(60)` advances microtasks only, so a lost/broken expiry timer is invisible here.
- Doesn't count nudges across the two checkpoints — the once-per-record property (TG3's "keyed
  on the record's own epoch") is unpinned anywhere (see §2).
- Red today for the right reason: turn 1's checkpoint killed the task before turn 2 (observed
  `failed`).

### T6 — distinct receipt answers the cycle (WEAK)

Standalone, the row cannot distinguish "the receipt answered the cycle" from "no window ever
expires" — both end not-failed. The discriminating power is entirely compositional (T7 demands
an expiry verdict for dupes). The scenario does exercise the REAL receipt path (worker
`scratchpad.write` → `writeScratchpad` admission :9689-9725 → hub receipt
`scratchpad.write_result` :10868-10873), and red today is for the right reason (gate fired at
the checkpoint; no cycle exists). Robustness note: the 25 ms window vs microtask-flush wall
time is timing-fragile under load — the receipt must land between cycle-arming and expiry with
only ~ms of slack.

### T7 — dup dedup, expiry, steering receipt (STAGED-WRONG)

Three independent defects:

1. **The verdict-event finder names kinds the machinery never mints on the worker stream.**
   It searches `coordinator._log.read(handle.id)` for kind `task.failed` or
   `worktree.progress_unchanged{no_progress}`. The gate's actual verdict event is kind `error`
   with `payload.code` (coordinator.mjs:11460-11471); the failed transition is a coordination
   event (`task.transitioned`, coordination-store.mjs:11692/:12495) in the coordination log
   root, not the worker stream (empirically confirmed: today's run fails the task and the
   finder still returns undefined). `worktree.progress_unchanged` is minted only by
   `_preserveProgressBeforeReap` (:7605), which the suite's own fixture makes UNREACHABLE — the
   fake worktrees lack `retainCheckpoint`/`resolveCheckpoint`, so the manager check at
   :7578-7580 returns `{state:'unsupported'}` before any event (and the fake sha `sha-base`
   fails the hex-40 guard at :7601 anyway). Consequence: a contract-perfect v1.0
   implementation — expiry settles the pause and dispatches today's auto-settle gate, receipt
   on the `error` payload — keeps T7 RED unless it also mints an uncontracted `task.failed`
   event on the worker stream. The row forces machinery the contract never names.
2. **"Counts once" is measured by outcome only, never counted.** The distinct-digest property
   is observed solely through "cycle not answered → verdict". T6+T7 jointly bound the answer
   threshold to exactly-one-distinct, so the composition is adequate, but no row inspects the
   dedup itself.
3. **The row encodes a content floor the contract text does not state.** TG2's bullet reads
   "receipts dedupe by content digest within the window… The window needs ≥1 distinct receipt
   to re-arm, nothing more." T7's six dupes dedupe to one distinct receipt — under the bullet's
   literal text that ANSWERS the cycle and T7's expected verdict is wrong. Only the acceptance
   paragraph ("A farmer (128 duplicate one-char notes…) does NOT answer the cycle: dedup counts
   them once") and red-team A4's amendment ("entries below a minimum content bound earn
   liveness but not progress") support T7's reading (one-char content earns nothing; T6's
   51-char note earns). This is a CONTRACT ambiguity the suite silently resolves one way —
   an implementation following the TG2 bullet literally goes false-red here. Amend TG2 to name
   the floor, or redesign T7 (substantive-content dupes across two windows).
4. Minor: the receipt assertion's first disjunct stringifies the WHOLE worker log for
   `"answered":false` — any unrelated future event carrying that substring satisfies it. The
   second disjunct (on the verdict event) is the honest one.

Red today at the finder assertion (status-failed already passes) — so its red stage is
"verdict event + receipt", consistent with intent; the defect is that the finder can never be
satisfied in this harness.

### T8 — resolution-gating (WEAK, half-vacuous)

The title claims two behaviors: "a pending question earns nothing" and "resolving it inside
the window answers the cycle". Only the second is exercised: the question is always resolved
(`coordinator.respond`, the real resolution seam :8710) before any `sleep`. The discriminating
branch — question emitted, window expires UNANSWERED, verdict lands — has no row. An
implementation that credits PENDING questions (violating TG2's resolution gate, the A10/6b
farm) passes T8 cleanly: pending question wrongly answers → settled working → respond →
not-failed ✓. The first assertion ("no verdict while the cycle window is open") is checked
microtasks after arming, so it cannot catch premature answering either. TG2's second bullet
(resolution-gated interactions) therefore has NO effective negative row; nor does the
past-deadline/null-deadline clause ("a blocking interaction older than its deadline… does not
re-arm", #67's sibling).

Red today for the right reason (gate fired at the checkpoint before the question exists —
observed `failed` at the first assertion).

### T11 — revision-channel verdict (STAGED-WRONG)

- **The re-drive call cannot survive the real admission rules.** `createAndClaimRecoveryRefinement`
  enforces a closed field set (coordination-store.mjs:2853-2873): T11 omits `brief`, `deps`,
  and `relation` → `CoordinationRefusal('recovery refinement request is malformed')` the moment
  the call is reached. It also passes `reservedWorkerId: 'w-retry'`, which violates the lineage
  pin at :2878 (must equal the prior task's `reservedWorkerId` — the spawned worker id,
  coordinator.mjs:3960). Today the row never gets there (it fails earlier on the `failure`
  assertion); post-implementation it throws at the API and stays red. A correct row must send
  the full closed set with lineage-identical values.
- **Deeper: the brief-digest byte-identity pin (:2880) means a verdict-carrying brief cannot
  arrive through this API as it stands.** TG4's "readable by the worker's harness in its next
  brief" requires the re-driven brief to CHANGE (hub-minted verdict attached); today's
  admission refuses any brief change as `recovery_refinement_conflict`. The v1.0 implementation
  must amend that pin deliberately (hub-side augmentation), and the row should anticipate the
  amended shape — as written it neither respects the current pin nor names the amendment.
- **Sanitization negatives are vacuous in this scenario.** The capture is `noDiff`
  (changedPaths: []), so there are no path strings in the verdict evidence to leak;
  `doesNotMatch(/file-in-scope\.txt|\/tmp\/wt\//)` passes even if the implementation dumps raw
  paths into the brief. The honest scenario is a path_scope/forbidden failure with real path
  strings (cf. T16's `etc/evil.txt`). And the baseSha/sha-hub-side clause (TG4, authority 3(b))
  is never asserted — an implementation leaking `'sha-base'` into the brief passes.
- **Channel vs content:** the row pins content-presence in the revision-channel brief (the
  right channel), but cannot distinguish hub-minted verdict text from caller-authored text
  arriving via the same field, and the run.feedback exclusion ("accepts no new caller shape")
  has no row at all (§2).
- The self-naming intent (failure names its gate, never `'unknown'` — the :797-804 degradation
  fix) is sound and correctly red today (`task.failure ?? task.terminalCause` is null; the gate
  puts `terminalCause` on the HANDLE at :11484, not the task).

### T12 — analysis field admission (STAGED-WRONG)

The harness passes `tgPlanRequest(...)` = `{goal, request}` to
`normalizePlanRequest(value, policy, goal, options)` — the outer object has `request` where the
API expects `predecessor`+`nodes`, and the third (`goal`) argument is never passed. Both rows
therefore throw at the outer `exactObject` (goal-plan.mjs:372, observed:
`goal_plan_invalid` at :372:3) BEFORE node validation. T12 can never go green: when the
implementation adds `analysis` to the node schema (:296), the envelope is still malformed. The
correct call is `normalizePlanRequest(req.request, tgPolicy, req.goal)` — after which T12
throws at the NODE `exactObject` (:296, unknown key `analysis`) today and goes green on the
contract's implementation: the correct staging, one harness fix away.

## 2. Coverage ledger

Every v1.0 decision point, mapped to rows. ✓ = adequately pinned; ◐ = row exists but weak/
staged (see §1); ✗ = no row.

### TG1 — checkpoint/final taxonomy; deferral is non-dispatch

| Decision point | Row(s) | Status |
|---|---|---|
| Checkpoint: gate does not dispatch | T1 | ◐ WEAK — consequences pinned, dispatch itself unmeasured (no verify-worktree/referee spy) |
| Checkpoint: no gate event written | T1 | ◐ partial — only the 3 failure codes filtered; other gate-run emissions unfiltered |
| Checkpoint: task stays `paused` pending steering/claim | — | ✗ (T1 allows any non-terminal status) |
| Checkpoint: no mid-workflow acceptance (A1) | T3 | ✓ |
| Finals run exactly as today (all phases incl. required_effect + referee) | T2, T16 | ✓ |
| `claim_turn` = drivered final, FULL gate | T17 | ✓ |
| Un-driven final (a): later turn_completed with no pause record | — | ✗ (no mixed-classification sequence) |
| Un-driven final (b): TG3 window expiry → full final evaluation | T7 | ◐ status assertion pins it; finder STAGED-WRONG |
| Un-driven final (c): run termination → no gate (lifecycle.exited unchanged) | — | ✗ |

### TG2 — farm-proof progress evidence

| Decision point | Row(s) | Status |
|---|---|---|
| Distinct-content dedup (N identical count once) | T7 | ◐ outcome-only + content-floor ambiguity (§1 T7.3) |
| ≥1 distinct receipt re-arms the window | T6 | ◐ WEAK standalone |
| Resolution-gated interactions (pending earns nothing) | T8 | ◐ negative branch unexercised |
| Past-deadline / null-deadline blocking interaction does not re-arm | — | ✗ (#67 sibling) |
| Board mutations as evidence class | — | ✗ (minor) |
| Acceptance untouched: finals still demand a real in-scope diff | T2 | ✓ |

### TG3 — one bounded steering cycle at the pause-admission seam

| Decision point | Row(s) | Status |
|---|---|---|
| Cycle lives at `_admitPauseRecord` (auto-settle replaced) | T1 (nudge) | ◐ implicit |
| Provenance prefix `baton-progress-check:` | T1 | ✓ (presence; sanitization pipeline unpinned — low value, hub-fixed string) |
| Bounded window = `progressNudgeWindowMs`, NOT stallTimeoutMs | T6/T7 timing | ◐ implicit via the 25 ms opt + sleeps |
| Answer classes {diff capture, TG2 receipt, resumed turn} | T5, T6 | ◐ "resumed turn" alone: ✗ |
| Expiry → full final evaluation, steering receipt durable on verdict | T7 | ◐ STAGED-WRONG finder; receipt disjuncts loose |
| Once per pause record, keyed on epoch; micro-progress cannot re-arm | — | ✗ (no two-checkpoint nudge-count row — T5 emits two checkpoints but counts nothing) |
| `claim_turn` on a cycle-armed record counts as its answer (6c) | — | ✗ (T17 claims a DRIVERED record — no cycle armed; a claim on a cycle-armed un-driven record is never exercised) |

### TG4 — verdict through the revision channel

| Decision point | Row(s) | Status |
|---|---|---|
| Verdict reaches the re-driven brief | T11 | ◐ STAGED-WRONG call shape |
| Self-naming (`required_effect` names itself, never `'unknown'`) | T11 | ◐ intent sound, unreachable today |
| Sanitized shape (digests+counts, never path strings) | T11 | ◐ vacuous in a no-diff scenario |
| baseSha/sha digests hub-side (never in worker-bound verdict) | — | ✗ |
| `run.feedback` is NOT the lane / accepts no new caller shape | — | ✗ |

### TG5 — plan-node `analysis` field, sole omission path

| Decision point | Row(s) | Status |
|---|---|---|
| `analysis: true` node may omit requiredEffects | T12 | ◐ STAGED-WRONG envelope |
| Any other omission is a plan-validation error | T13 | ◐ VACUOUS — behavior unimplemented today, green is an envelope artifact |
| `contextEffectNodeBinding` binds the field for context-program nodes (6d) | — | ✗ (binding comparison at coordination-store.mjs:6813-6845 untouched) |
| Post-approval flip refusal (digest-bound) | — | ✗ (machinery DEFENDED per authority attack 4, but no pin) |
| Analysis node's final skips required_effect, runs every other phase | — | ✗ (the gate-behavior half of TG5 has NO row — neither the skip nor the "every other phase" regression) |

### TG6 — coaching retires at this epic's acceptance

| Decision point | Row(s) | Status |
|---|---|---|
| Source scan: no shipped constraint line references beating the gate | T15 | ◐ STAGED-WRONG — green against its declared stage; patterns miss the shipped coaching (recipes.mjs:529, :533-536); scans one file while the contract names "the objective boilerplate family" too |

### Numbering note

Rows T4, T10, T14 do not exist in the suite — the T1-T17 numbering has three gaps. Flagged so
future readers don't hunt for them; if they were dropped during authoring, their intended
subjects should be confirmed against this ledger's ✗ rows.

## 3. Fixture authority

Does the ScriptableAdapter/fake-worktrees harness prove the real coordinator paths, or can rows
pass through fixture artifacts? **Verdict: the seams that matter are real; four fixture limits
have teeth (two already bite T7).**

Real (verified in source):

- **Event ingress is the real trust boundary.** `adapter.onEvent` → coordinator callback
  (:1143-1165) stamps `actor: 'worker'` and routes into the real `_handleEvent` switch — the
  same path every production adapter takes. The mock's `pausable` card mirrors all four
  production adapters (kimi-acp.mjs:182, codex-appserver.mjs:314, claude-session.mjs:488,
  grok-acp.mjs:238); the `pausable:false` variant takes the real legacy `'claim'` default at
  `_turnCompletionOf` (:2657-2659). Both checkpoint and final classifications are the genuine
  seam, not a fixture fiction.
- **The auto_no_driver seam is real**: `_admitPauseRecord` (:2003-2063) mints `turn.paused`,
  pends the record, runs the `driver.recorded` scan (:2051-2054), and auto-settles with basis
  `auto_no_driver` → the caller dispatches `_runTrustGate` (:10802). T9/T17 register drivers
  through the real `recordDriver` (coordination-store.mjs:12876), which mints exactly the event
  shape the scan reads.
- **The pause-record lifecycle is real**: `pausedTurns` (:2093), `_reservePauseRecord`,
  `claimTurn` (:2295-2327) re-running the same `_runTrustGate`.
- **The scratchpad admission is real**: worker `scratchpad.write` → `writeScratchpad`
  fence/idempotency admission (:9689-9725) → coordination store → hub-actor
  `scratchpad.write_result` receipt (:10868-10873) — the exact trigger-vs-receipt asymmetry
  authority 6a names.
- **The interaction family is real**: non-blocking `question.asked` pend record +
  `input.requested` (:10906-10919); `coordinator.respond` (:8710) resolves through the real
  single-consumer reservation.
- **Plan validation and recovery refinement are the real store code** (goal-plan.mjs,
  coordination-store.mjs:12142/:2851) — which is exactly why T12/T13/T11's call-shape bugs
  throw real refusals instead of passing through fixture laxity.
- **Nudge observation has real authority**: TG3's delivery lane is `adapter.prompt`
  (coordinator.mjs:2208), precisely where T1/T2/T9 count calls.

Fixture limits with teeth:

1. **Fake worktrees lack `retainCheckpoint`/`resolveCheckpoint`** →
   `_preserveProgressBeforeReap` returns `unsupported` (:7578-7580) →
   `worktree.progress_unchanged` can never appear in this harness. Kills T7's finder (§1).
2. **Capture is injected** (`noDiff`/`withDiff` closures) — legitimate: it is the control
   point for the gate's diff input, and the real gate consumes exactly that return shape. But
   it means no row proves the implementation reads a REAL diff; the boundary between capture
   and cycle-answering is entirely mocked.
3. **Frozen clock (`now: () => 0`) + real timers**: window expiry can only be observed via
   `setTimeout` — an implementation that computes windows from the injected clock can never
   expire in these rows. The harness silently constrains the implementation's time source;
   say so in the contract or unfreeze the clock.
4. **No `processRef` + 15 s `stopDeadlineMs`**: the kill/stop chain after a gate failure
   pends beyond the test horizon, so post-verdict receipts (stop completion, preservation)
   are unobservable — rows can only see the verdict itself, not the reap.
5. **Timing fragility**: the 25 ms window against microtask `flush()` sequencing leaves ~ms
   of slack for answers to land (T6/T8). Fine on a quiet machine; flaky under load. A
   controllable fake timer would make the window semantics deterministic.

## 4. The greens

Is each declared pin green today for the documented reason?

- **T2 (finals evaluate as today) — YES.** Non-pausable card → `'claim'` classification → no
  pause minted → straight to `_runTrustGate` → `required_effect_absent` → `failed`. The real
  final seam, green for exactly the documented reason. The no-nudge assertion is vacuous today
  (no cycles exist) but gains teeth the day TG3 lands — correct red-first pin shape.
- **T9 (no policy cycle when drivered) — MOSTLY.** The `status === 'paused'` half has teeth
  today: without the `recordDriver` call the auto-settle would fire the gate and fail the task.
  The no-nudge half is vacuous until TG3 exists (T1's red proves no nudge exists anywhere).
  Acceptable pin; documented reason holds via the pause half.
- **T13 (omission without analysis = validation error) — NO.** Green only because the harness
  envelope is malformed (§1 T12/T13): the throw fires at goal-plan.mjs:372 before node
  validation. The named behavior is NOT implemented — key omission validates (:331-333 has-
  check), empty array validates (`normalizedSet` `empty: true` :56; the :341-344 check is
  vacuous for `[]`), and the gate skips required_effect when the brief lacks the field
  (:11178 + buildAuthoritativeBrief :412) — the live hole authority attack 4(b) named. A
  corrected T13 is RED today. Reclassify: this is a red row wearing a green artifact.
- **T15 (TG6 source pin) — NO.** The suite's own stage comment says "coaching still shipped" —
  a red-first row for that stage should be RED. It is green because its patterns miss the
  shipped coaching: `skeleton`/`trust gate`/`beat the gate`/`survive the gate` appear nowhere in
  recipes.mjs, and `/write.*first.*diff/i` needs `diff` on the same line as `write…first` —
  the actual red-first line (:529) has none, and the SCRATCHPAD_WRITE shape coaching
  (:533-536, authority attack 5's second named item) matches no pattern at all. A compliant
  TG6 reword leaves it green; a regression adding diff-churn coaching leaves it green unless
  it uses the literal words. Discriminates nothing in either direction; also scans only
  recipes.mjs while TG6 names an "objective boilerplate family".
- **T16 (path_scope at finals) — YES.** Out-of-scope diff at a final →
  `worker_path_scope_violation` → `failed` through the real phase (:11163-11178).
- **T17 (drivered claim = full gate) — YES.** Real driver registration → pause pends → real
  `claimTurn` → `_runTrustGate` → `required_effect_absent` → `failed` (:2295-2327, :2316).
  Green for the documented reason; this is also the row that keeps 6c's claim-bypass visible
  (the claim gate runs with NO steering cycle today, by design for drivered runs).

## 5. Run confirmation

`node --test impl/test/trust-gate-steering-red.test.mjs` from the repo root (2026-08-02):
**8 failing / 6 passing — matches the declared split exactly.**

Red, each at its named stage:

- T1 fails at :141 — checkpoint turn produced `failed` (gate dispatched; taxonomy missing).
- T3 fails at :170 — checkpoint on a zero-effects brief produced `completed` (A1 accept-hole
  live on a green base with a passing referee).
- T5 fails at :188 — turn 1's checkpoint killed the task before the turn-2 diff (`failed`).
- T6 fails at :205 — scratchpad receipt irrelevant; already `failed` at the checkpoint.
- T7 fails at :223 — status already `failed` (assertion 1 passes today), but no `task.failed`/
  `worktree.progress_unchanged` event exists on the worker stream (§1 T7.1 — the staged-wrong
  finder; it will still fail after a correct implementation).
- T8 fails at :242 — gate fired at the checkpoint before the question was even emitted.
- T11 fails at :281 — `task.failure ?? task.terminalCause` is `null` (the gate puts
  `terminalCause` on the handle, not the task; nothing names the gate on the task record).
- T12 fails at goal-plan.mjs:372 — `GoalPlanValidationError: goal/plan object has unknown or
  missing fields` at the OUTER `exactObject` (envelope malformation, not the missing analysis
  field — §1 T12).

Green: T2, T9, T13, T15, T16, T17 — per-row adjudication in §4. T13's and T15's greens are
artifacts (vacuous / staged-wrong), so the honest split after harness fixes is
**9 red / 5 green**, with T12 red until its envelope is fixed AND the field lands.

## 6. Blocking items (must fix before the suite can gate the epic)

1. **Fix the TG5 harness envelope (T12/T13).** Call
   `normalizePlanRequest(req.request, tgPolicy, req.goal)`. After the fix, T12 is correctly red
   (node `exactObject` rejects `analysis` until implementation) and T13 becomes RED — the
   named behavior (sole omission path) is unimplemented; both omission forms validate today.
   Reclassify T13 out of the green pins. This is also the only way TG5's core invariant gets
   an effective row.
2. **Fix T7's verdict-event finder.** Point it at the gate's real verdict event (kind `error`,
   `payload.code === 'required_effect_absent'`, `payload.steered.answered === false`) or add
   `retainCheckpoint`/`resolveCheckpoint` to the fixture worktrees and keep
   `progress_unchanged`. As written, a contract-perfect implementation stays red.
3. **Fix T11's re-drive call.** Full closed field set (`brief` byte-identical to the prior
   task's, `deps: []`, `relation: 'recovery'`, lineage-correct `reservedWorkerId`), and decide
   how TG4's hub-side verdict augmentation amends the brief-digest pin
   (coordination-store.mjs:2880) — the row must name the amended shape, not bypass it. Make
   the sanitization negatives non-vacuous: use a path_scope failure with real path strings and
   assert absence of `'sha-base'`/`'sha-result'` (baseSha/sha hub-side).
4. **Fix or restage T15.** Either match the coaching the contract actually names (the
   red-first line recipes.mjs:529 and the SCRATCHPAD_WRITE shape coaching :533-536) so the row
   is red today as its stage comment declares, or drop the row and move TG6's source scan to
   acceptance review. A green-forever source pin is worse than none — it fakes coverage.
5. **Tighten T5's status set** to `['working','paused']` (a checkpoint cannot be `verifying`
   or `completed` under the taxonomy) and add a post-window observation; **add T8's missing
   branch** (pending question past expiry → verdict lands) so resolution-gating has a negative
   row.
6. **Resolve the TG2 content-floor ambiguity in the contract text.** T7 encodes "one-char
   content earns nothing" (T6's substantive note earns); TG2's bullet ("≥1 distinct receipt,
   nothing more") reads the other way. Amend TG2 to name the floor (red-team A4's "minimum
   content bound" language) or redesign T6/T7 around substantive content.

Non-blocking but required before the epic's own acceptance (coverage ✗ rows, §2): once-per-
record nudge count across two checkpoints; claim on a cycle-armed record counts as its answer
(6c); run.feedback exclusion (no new caller shape); TG5 gate behavior (analysis node's
edit-free final skips required_effect, every other phase still runs); TG1(c) run-termination
no-gate; past-deadline/null-deadline interaction non-re-arm; post-approval flip refusal pin;
contextEffectNodeBinding coverage (6d).

## Closing verdict (full)

**GATE-NOT-READY.**

The suite's spine is honest: every red row fails today for its named stage, the core TG1/TG3
taxonomy and cycle rows (T1/T3/T5/T6/T8) discriminate in composition, the fixture exercises
the real coordinator seams (pause admission, driver scan, claim, scratchpad admission,
interaction resolution, plan validation), and four of six green pins are sound. But it cannot
yet certify a correct implementation: T7's finder and T12's envelope are false-red traps; T11
cannot survive the real recovery-refinement admission; T13 is a vacuous green that hides the
unimplemented sole-omission path; T15 is green against its own declared stage; and six named
v1.0 decision points (once-per-record, claim-as-answer, run.feedback exclusion, TG5 gate
behavior, baseSha-hub-side, content-floor) have no effective row. Fix blocking items 1-4
before any green on this suite is read as contract conformance; items 5-6 and the coverage ✗
rows before the epic's acceptance gate.
