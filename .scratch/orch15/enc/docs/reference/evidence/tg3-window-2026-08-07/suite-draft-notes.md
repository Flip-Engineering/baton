# #80 Suite Draft Notes — `tg3-window-red.test.mjs`

Date: 2026-08-07 · Contract: **TG3-window v1.2** (blue-team fold 2 folded; suite 17 rows)
Deliverable: `impl/test/tg3-window-red.test.mjs` (this draft's only other deliverable).
Authority: `tg3-window-contract.md` (v1.2 source of truth with the depending-on-#67 posture and the
F1/F7 sealed-gate clarification), `contract-fold.md` (B1/B2/B3 blockers), `contract-redteam.md`
(attack surface), `suite-blueteam.md` (the 7 blue-team findings F1-F7), `suite-fold-2.md` (the
finding → resolution map), `suite-80-brief.md` (this suite's brief).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/tg3-window-red.test.mjs   # run from repo root
ℹ tests 17
ℹ pass 8
ℹ fail 9
ℹ cancelled 0  skipped 0  todo 0
```

Recorded after the suite was finalized (fold 2). Two consecutive runs of the finished suite both
produced **pass 8 · fail 9** (run 1 ≈ 2.0 s, run 2 ≈ 2.0 s — the behavioral codex row adds one real
child process) — the split is deterministic. The 8 passes are exactly the eight PIN rows (TW-04,
TW-06, TW-07, TW-08a, TW-09a, TW-disc-invalid, TW-disc-digest, TW-disc-scope); the 9 failures are
the red rows, each confirmed to fail at its NAMED stage (the per-row stage is in the header and in
each row's assertion message): TW-01 `provider-call-answer-missing` · TW-02
`dispatch-receipt-emission-missing` · TW-03 `queued-start-expires` · TW-04b `steered-fold-missing` ·
TW-05 `evidence-gate-defect-missing` · TW-08b `provider-call-answers-once` · TW-09b
`depending-on-#67: rearm-kinds-missing` · TW-10 `answer-not-evidence` ·
TW-disc-fold `observed-evidence-append-missing`.

## Row map

Every red row fails at the named stage today and goes green on the v1.2 implementation ONLY. Stages
in **bold** are the current HEAD failure seam. Rows marked **(F#)** fold the blue-team finding of
that number (see `suite-fold-2.md`).

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| TW-01 | A | | **provider-call-answer-missing** (F1) | `_steeringEvidenceQualifies` has NO provider_call branch (:2208-2238); `_observeSteeringCycle` is never called for `resource.provider_call` — the default-case append (:12816-12817) feeds `_observeWatchdogEvent` only (:9144-9152), so a valid `requested`/`completed` call rides the log as an observation and the expiry runs the full final → task failed; the row ALSO asserts the v1.2 governance-clean side (zero `provider_governance_exceeded`/`provider_telemetry_invalid`, `providerPolicyHardExceeded === false`, `budgetStopTimer === null`, never killed) |
| TW-02 | A | | **dispatch-receipt-emission-missing** (F6) | the REAL codex adapter emits only a `completed`-phase provider_call (:655-660); the turn/start dispatch (:997, before the await) emits NO `requested` receipt, so the behavioral wire-order assertion (part a) fails — a `requested` receipt never precedes the second `turn_started`. cli-adapters has no requested-phase emission at its exec/turn dispatch (:120/:155). The atomic claude pipe emits `completed` only (:1124) and needs none |
| TW-03 | B | | **queued-start-expires** (F1, F2) | a `requested` call emitted from the same synchronous turn that armed the window (t≈0, no sub-window sleep — the #7 class removed) is observed-but-never-an-answer; `_expireSteeringCycle` (:2276-2306) runs the full final anyway → the queued-start worker is killed by a clock alone; the row also asserts the governance-clean settle at expiry |
| TW-04 | B | PIN | honest-stall-evaluates | green today — an EMPTY-fold expiry runs the full final exactly as T7b pins, with `steered: {nudgeId, answered:false}` durable on the gate error event (:2303-2305, :13206) |
| TW-04b | B | | **steered-fold-missing** | the `steered` receipt (:13206) is `{nudgeId, answered:false}` only — no `windowMs`/`startEvidenceObserved`/`answerClasses`; the `turn.settled {basis:'steering_expired'}` payload (:2276-2306) has no fold |
| TW-05 | B | | **evidence-gate-defect-missing** (F7) | `record.steering.observedEvidence` does not exist; an injected start-class fold is ignored at expiry — the full final kills a healthy worker, no `steering.evidence_gate_defect` receipt exists, and no governance-clean assertion holds |
| TW-06 | C | PIN | turn-started-first-class | green today — a resumed `turn_started` answers via `_observeSteeringCycle` (:12039 → :2241-2256), zero gate events |
| TW-07 | C | PIN | nudge-never-self-answers | green today — the policy nudge rides the control lane (`send` → `_deliver`, actor 'policy', mode 'nudge'); `_observeSteeringCycle` answers only on the closed evidence kinds + the paused-only guard (:2241-2256), so the nudge's delivery and its adapter acceptance never settle; the honest stall fires |
| TW-08a | C | PIN | once-per-record | green today — one-shot arm per pause record (:2116-2194), consume at settle (:2259-2272); post-answer evidence never re-arms; a NEW record gets its own single cycle; the FINAL (cycle 2 expiry) still demands the diff |
| TW-08b | C | | **provider-call-answers-once** (F1, F4) | multiple valid provider_calls — none answer at HEAD (same seam as TW-01); the record expires → task failed; the row ALSO pins WHICH call answered (`answer.callId === 'tw8b-1'`, `phase === 'requested'`) and the governance-clean settle |
| TW-09a | D | PIN | shipped-watchdog-half | green today — `_armWatchdog`'s working-only refusal (:8731-8733) and `_observeWatchdogEvent`'s provider-call tracking into `providerCallIds` (:9144-9152 → :9067-9097) are byte-unchanged |
| TW-09b | D | | **depending-on-#67: rearm-kinds-missing** | the coordinator exports no `REARM_KINDS` — the #67 closed re-arm set does not exist (verified when #67 folds; the row is a target-state row) |
| TW-10 | E | | **answer-not-evidence** | `_steeringEvidenceQualifies` (:2208-2238) carries no provider_call class; the window default (`Number.isSafeInteger(this._progressNudgeWindowMs) ? … : 300_000`) is byte-unchanged; no per-route latency knob; the expiry never re-arms a timer |
| TW-disc-invalid | E | PIN | invalid-call-noise | green today — `_observeLogicalProviderCall` rejects an empty callId / a phase outside `LOGICAL_CALL_PHASES` (:9067-9097) as telemetry noise; the honest stall fires |
| TW-disc-digest | E | PIN | distinct-digest-class (F5) | green today — the TG6 distinct-digest class holds: a distinct scratchpad digest answers via `_observeSteeringCycle` (:12454, `receipt.contentDigest`), the `digestSet` dedup (:2215-2220) means a replay never re-answers nor re-arms; the **content-free-write** half is staged — a store-refused content-less write (`emitScratchWrite(…, '')` → `{ok:false}`, `_observeSteeringCycle` never called) and a direct digest-less evidence (`{kind:'scratchpad', digest:null}`) both never answer — the honest stall fires; the consumed record never double-settles, and the FINAL (a second record expiring empty) still demands the diff |
| TW-disc-scope | E | PIN | per-handle-scoping | green today — `_observeSteeringCycle` scopes to `record.worker` (:2241-2256); another worker's call is tracked on ITS providerTurn, never the seat's cycle; the seat honest-stalls |
| TW-disc-fold | E | | **observed-evidence-append-missing** (F3) | `record.steering.observedEvidence` does not exist at HEAD, so a real in-window `provider_call` leaves no appended fold; the row asserts the fold carries the observed kind with the provider_call **phase** identity (`requested`) on the pause record, then the cycle settled |

## Invented surfaces

The invented surfaces that must be namespace-imported are `coordinator.mjs` members
(`_steeringEvidenceQualifies`'s provider_call class, `REARM_KINDS`); the rest are probed through
REAL surface entry points (behavioral rows). Every invented member is absent at HEAD (the seam the
red row holds). The first assertion on every invented export is an `assert.ok(...)` (or the static
source `assert.match`), so the row fails at the named stage — never on a shape assertion that
`Object.isFrozen(undefined) === true` could spuriously satisfy.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `_steeringEvidenceQualifies` provider_call class — a valid `requested`/`completed`-phase provider call for the seat inside the armed window answers the cycle | static `coordinator.mjs` source read (the evaluator body :2208-2238) | no `provider_call` branch — the evaluator answers only turn_started/scratchpad/interaction/capability_op (TW-10) |
| `_observeSteeringCycle` call for `resource.provider_call` — the D2 consume path beside the existing turn_started site (:12039) | behavioral (TW-01/TW-03/TW-08b/TW-disc-fold stage the call, assert the settle + the governance-clean fold) | no such call site — provider calls append (:12816-12817) and reach `_observeWatchdogEvent` only |
| `record.steering.observedEvidence` — the answer-class evidence fold on the in-memory pause record, **appended** at each evidence evaluation; the provider_call class records its PHASE identity (`requested` vs `completed`) | behavioral (TW-disc-fold asserts the append path — a real in-window provider_call leaves the fold; TW-05 injects the fold only to stage the B1 defect) | no such field — `record.steering` is `{nudgeId, answered, answer, digestSet, resolvedRequestIds, windowMs, timer}` (:2116-2194) |
| `steered` receipt fold `{windowMs, startEvidenceObserved, answerClasses}` — on the gate error-event payload (:13206) AND the `turn.settled {basis:'steering_expired'}` payload | the honest-stall log (TW-04b) | `{nudgeId, answered:false}` only |
| `steering.evidence_gate_defect` — a NEW named error-event receipt (kind 'error', payload.code) on the B1 constructive settle, carrying the fold | the log after the injected-fold expiry (TW-05) | no such receipt — the expiry runs the full final, no constructive settle |
| Adapter dispatch emission — codex (`codex-appserver.mjs`, at the turn/start dispatch ~:997, before the await) and cli (`cli-adapters.mjs`, at its exec/turn dispatch) emit `resource.provider_call {phase:'requested', callId}`; the atomic claude pipe (`claude-session.mjs`) emits NO requested phase | **behavioral + semantic** (TW-02): a REAL `CodexAppServerCli` against the `fake-codex-appserver.mjs` fixture asserts the receipt precedes the second `turn_started` on the wire; cli positive / claude negative use kind+phase window regexes — no pinned call shape | all three emit `completed` only (`codex-appserver.mjs:655-660`, `cli-adapters.mjs:7410/:9538`, `claude-session.mjs:1124`) |
| `coordinator.mjs` REARM_KINDS — the #67 closed set, frozen, ACTUAL-sorted `['approval.resolved','decision.settled','lifecycle.turn_started','question.answered']`, excluding `resource.provider_call` | namespace import `* as coordinatorNs` (TW-09b) | no such export |

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **TW-04** honest-stall-evaluates | an impl that stops evaluating the empty-fold expiry (the un-driven final becomes a silent `working` settle — a stalled worker never fails, the #55-class-debuggability regression) |
| **TW-06** turn-started-first-class | an impl that drops `turn_started` from the answer set (a resumed turn would expire as an honest stall and kill a productive worker) |
| **TW-07** nudge-never-self-answers | an impl that lets the control.nudge delivery or its adapter acceptance answer (the create-and-answer self-dealing loop — a worker that never starts a turn clears the window by receiving the nudge) |
| **TW-08a** once-per-record | an impl with a broken once-per-record bound: re-arming a settled record, double-settling, or letting a dispatch receipt buy a content-floor pass at the final |
| **TW-09a** shipped-watchdog-half | an impl that regresses the working-only refusal (`_armWatchdog`) or the provider-call tracking (`_observeWatchdogEvent`) while touching the watchdog surface |
| **TW-disc-invalid** invalid-call-noise | an impl that answers on an invalid callId/phase (a garbage call settling a worker) |
| **TW-disc-digest** distinct-digest-class | an impl that credits a content-free write — a replayed digest OR a digest-less write (store-refused content-less write, or a direct digest-less evidence) answering the cycle (the TG6 class regressed) |
| **TW-disc-scope** per-handle-scoping | an impl that answers the seat on another worker's call (a cross-handle leak — a teammate's activity clearing a stalled seat) |

## What makes each stage go green (implementer's checklist)

- **provider-call-answer-missing / provider-call-answers-once / observed-evidence-append-missing** →
  D2: `_steeringEvidenceQualifies` gains a provider_call branch — a valid call (`validLogicalCallId`,
  phase inside `LOGICAL_CALL_PHASES`, `record.worker === handle.id`) for the armed record qualifies
  ONCE (`observedEvidence` fold dedup), `_observeSteeringCycle` is called for
  `resource.provider_call` events beside the turn_started site (:12039), AND each evaluation
  APPENDS to `record.steering.observedEvidence` (kind + the provider_call phase identity). A
  `requested` OR `completed` phase answers; the FIRST call in the record consumes it (TW-08b pins
  the recorded answer: callId `tw8b-1`, phase `requested`; TW-disc-fold pins the append path). The
  in-window receipt stays governance-clean (v1.2: the D2 path answers WITHOUT firing the sealed gate
  — TW-01/TW-03/TW-08b assert zero governance violations, `providerPolicyHardExceeded === false`,
  `budgetStopTimer === null`, never killed).
- **dispatch-receipt-emission-missing** → D2 emission: codex mints the `{phase:'requested', callId}`
  receipt at the turn/start dispatch (:997, before the await resolves) — TW-02(a) asserts it
  precedes the second `turn_started` on the real adapter's wire; cli mints it at its exec/turn
  dispatch (TW-02(b) semantic kind+phase identity). The atomic claude pipe mints NONE (turn_started
  is synchronous with dispatch, `_writeUserFrame` :884-894) — the D2 gate holds via the claude
  negative.
- **queued-start-expires** → D3/B1: the expiry re-checks the fold; a provider_call start-class
  identity (a `requested` receipt observed in-window, valid, unconsumed) settles CONSTRUCTIVELY —
  `working`, zero gate events, zero `steered` receipts (TW-03), governance-clean. The queued-start
  worker is never final-evaluated as unanswered by a clock alone.
- **steered-fold-missing** → D3: the genuine empty-fold expiry receipts the #55-class-debuggable
  fold `{windowMs, startEvidenceObserved:false, answerClasses:[]}` on BOTH the `steered` receipt
  (:13206) and the `turn.settled {basis:'steering_expired'}` payload (:2276-2306).
- **evidence-gate-defect-missing** → B1/D3 + v1.2: `_expireSteeringCycle` re-checks the fold at fire
  time; a start-class identity settles constructively `turn.settled {basis:'steering_answered', via:
  'evidence_gate_defect'}` and mints the NEW `steering.evidence_gate_defect` error-event receipt
  carrying `{windowMs, startEvidenceObserved:true, answerClasses:['provider_call']}`. The D2-gate
  defect never kills a healthy worker (TW-05), AND the re-check's validity test excludes the sealed
  gate for in-window receipts — the worker is left governance-clean.
- **depending-on-#67: rearm-kinds-missing** → #67 fold: the frozen ACTUAL-sorted `REARM_KINDS`
  (`['approval.resolved','decision.settled','lifecycle.turn_started','question.answered']`) is
  exported from the coordinator; the #80 provider_call answer class is NOT in the set (the steering
  surface and the watchdog re-arm surface stay separate). Verified when #67 lands.
- **answer-not-evidence** → D1/D2: the steering answer set carries the provider_call class (the
  queued-start answer is EVIDENCE, never a bigger window); the window default
  (`Number.isSafeInteger(this._progressNudgeWindowMs) ? … : 300_000`) stays byte-unchanged; no
  per-route latency knob (`windowMsByRoute`/`latencyScale`/`perRouteWindow`) and no expiry re-arm
  (`_expireSteeringCycle` never calls `_setTimeout`) appear anywhere.

## Suite-law hygiene (verified)

- **Hermetic**: ScriptableAdapter (no harness, no network) + a REAL `CodexAppServerCli` child process
  against the `fake-codex-appserver.mjs` fixture (`--serve` sentinel, zero model quota, killed in a
  `finally`); `mkdtempSync` logs/verification worktrees and a global `test.after` cleanup; the
  deployment-verification stub is the brief's `true` command. The providerGovernance deployment
  profile is observe-mode (`mode: 'observe'`, MockAdapter-shaped governance card) so provider calls
  are validity-tracked without strict binding; every governed `turn_completed` carries the valid
  `{counterId:null, tokenMetric:null, tokens:'unavailable', usd:'unavailable'}` terminal seal. The
  two-record PIN rows (TW-08a, TW-disc-digest) stage their second checkpoint turn NON-governed — a
  governed worker completing two checkpoint turns reuses the spawn-sealed `providerTurn` and would
  hit `usage_seal_duplicate` on the second turn, a real HEAD governance behavior orthogonal to the
  TG3 window (documented at `setup`'s `governed` switch).
- **Red-first at named stages**: every RED row's first assertion is the named-stage failure (a
  static `assert.match` / namespace `assert.ok` for invented surfaces, a behavior assertion for the
  cycle seams); the PIN rows are verified to fail under a plausible wrong implementation (each pin's
  kills are named in the pin list). 9 RED rows / 8 PINs, stable across consecutive runs. The F1
  discrimination is probe-verified: a false-green wiring (steering answer + sealed gate left firing)
  fails TW-01/TW-03/TW-08b at the governance-clean assertion; the F5 discrimination likewise (a
  digest-less-crediting impl fails TW-disc-digest).
- **NUL discipline**: the two NUL-bearing files (`application.mjs`, `coordination-store.mjs`, 3 NUL
  bytes each) are never read whole — only their exports are imported (`coordinationForLog`). The
  four statically-read sources are NUL-free and verified so (`coordinator.mjs`,
  `codex-appserver.mjs`, `cli-adapters.mjs`, `claude-session.mjs`). The suite file itself is NUL-free.
- **No clocks as controls / the control law holds**: the window rows drive the REAL `_armSteeringCycle`
  timer exactly as production does (real `setTimeout`, unref'd, `progressNudgeWindowMs: 25` + a real
  sleep across it); `now: () => 0` is injected only for the coordinator's other timestamps and never
  drives a window verdict. No row asserts a fleet wall-clock behavior. The control-law line is
  asserted directly (TW-10: the answer is evidence, no window-extension knob, no expiry re-arm; TW-03:
  a queued start is never clock-finalized — its receipt is emitted from the same synchronous turn
  that armed the window, so no sub-window real sleep exists, the #7 class removed).
- **No `localeCompare`**; the `REARM_KINDS` literal is asserted in ACTUAL sorted order (the
  contract-verified `[...set].sort()` identity) and the target-state row deep-compares it to the
  sorted constant.
- **Sorted-key literals / map-order honesty**: no object-map iteration is asserted anywhere in the
  suite; the only sorted-literal assertion is the frozen `REARM_KINDS` deepEqual in ACTUAL order.
