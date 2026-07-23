# 35 — Turn Checkpoints: steer, don't gate

Status: design groundwork for issue #31, **v2 revised per red-team findings R35-1..8**
(2026-07-23). v1's degenerate case was undecidable (a wave member is byte-identical to a bare
run at the coordinator), its card-default unstated, its `checkpointed` state unkeyed from the
unpark machinery, its settle/nudge acts riding the wrong lanes, its subagent claim factually
wrong, and its escalation default a back-door turn limit. All corrected below. The operator's
rule stands: turn-based limits make smart systems shallow and brittle — steer programmatically,
never gate on turn boundaries.

## 1. The truth today

`lifecycle.turn_completed {status:'completed'}` is an automatic result claim: the coordinator
launches the trust gate at every provider turn end (coordinator.mjs:9901-9913), exempt only
while a blocking interaction record is literally pending (8595e40). Ordinary agent work pauses
constantly — thinking, waiting on tools/suites — and the gate kills those pauses
(`required_effect_absent`: w-144, w-153, the suite-wait seat). Prompt-coaching against the
model's nature ("never pause") is not steering; the programmatic lanes to steer with
(progress/attention/nudge) exist but the gate fires before any of them can act.

## 2. Design

### 2.1 Claim vs pause is an adapter-card declaration, defaulting to TODAY'S semantics

1. `card().turnCompletion ∈ { 'claim', 'pausable' }`. **Absent field ⇒ `'claim'`** — the
   current behavior, so every one of the 77 test-double cards and MockAdapter (adapter.mjs:539,
   `scenario.outcome` completion) keeps its exact semantics with zero churn. Only the five
   interactive production cards (claude, codex, grok, kimi, glm) declare `'pausable'`. A
   card-completeness lint asserts the declaration exists on production cards (R35-2).
2. A `'pausable'`-carded turn end mints a **pause record** (renamed from v1's "checkpoint" —
   the word collides with the preserved-candidate checkpoint, application-semantics.mjs:506,
   R35-8): durable, replay-exact, single-consumer like the interaction family,
   `turn.paused { workerId, taskId, turnEpoch, changedPathsDigest }`. No `pendingTool` field —
   tool-call frames carry only `phase:'requested'` and results are dropped, so the coordinator
   has no honest provenance (claude-session.mjs:841-846, :871, R35-8).
3. The task transitions to **`paused`** (renamed from v1's `checkpointed`), a new non-terminal
   state. TRANSITIONS gains it (coordination-store.mjs:115-120); every guard keyed on
   `['working','input_required']` is audited (claimScratch :9122, postScratchFact :9139,
   requestBoardClaim :9199, submitBoardReport :9209, replay sweep :11473, representation
   admission :2879); settlement unparks it exactly like input_required (respond() durable +
   in-memory parity, coordinator.mjs:8463-8466, :8586-8594 — the DG2 flow preserved, R35-3);
   run-phase derivation (plan-node based, application.mjs:4979-4986), story.mjs fold maps, and
   wave.mjs progress mapping all get an honest `paused` rendering, never disguised as working.

### 2.2 Steering is registered, or the degenerate case fires — receipted either way

4. **The driver marker (R35-1, the P0).** A durable, replayable `steering.registered
   { runId, driverKind, actor }` is admitted at run creation: waves pass `driverKind:'wave'`
   (wave.mjs member admission carries it — the wave surface IS the registration channel, not a
   client-side hint); MCP/embedded controllers may register explicitly. `recordDriver` stays an
   event log; this is the liveness fact the degenerate rule reads.
5. **Degenerate case (R35-2, R35-5).** A pause record admitted for a run with NO live steering
   registration **auto-settles immediately**: the trust gate runs exactly as today, and a
   receipt `turn.settled { actor:'policy', basis:'auto_no_driver' }` is appended. This
   preserves every driverless flow in the suite (phase10 SC3/SC10 createDriver-to-completed,
   DG2's post-settlement continuation, all MockAdapter flows) with no behavior change. An
   orchestrator settle records `basis:'orchestrator'`; replay distinguishes them by
   construction (the driver.recorded receipt pattern). No attach race exists: registration is
   an admission-time fact, so "late attach" is simply a later registration for the NEXT pause.
6. **Three steering acts on a live registration, single-consumer with an explicit reservation
   + authority op** (R35-4 — settle does NOT ride `_resolveRecord`'s delivery path):
   - `nudge` — a full fresh-turn admission (watchdog re-arm, `bumpTurn`, budget re-arm; the
     bare prompt lane at coordinator.mjs:5990-6098 does none of this today). Pre-pause scratch
     claims CAS'd on the old fence expire honestly (the `_expireScratchClaims` mirror :10200 —
     the claimScratch trap is named, not stepped in).
   - `wait` — park legally; emits nothing, costs nothing.
   - `claim` (renamed from v1's "settle" — collides with wave.settle, R35-8) — the
     orchestrator claims the result on the worker's behalf; the trust gate runs with the
     pause's diff evidence. This and the worker's own done-signal are the ONLY paths to
     required-effect/verification evaluation.
7. **Stall watchdog interplay is explicit (R35-3).** The 120s stall watchdog re-arms on
   `turn_completed` (coordinator.mjs:7421-7429); a `paused` task is protected by the existing
   inner guard `task.status !== 'working'` (:7408) — that guard is named load-bearing in the
   contract, and `paused` joins it by construction, not by accident.
8. **Escalation default is visible-only (R35-7).** A pause parked beyond a deployment-owned
   bound escalates to a louder ATTENTION class and nothing more. `claim`-with-partial-evidence
   and typed stop are explicit orchestrator OPT-IN acts — never timer defaults. There is no
   policy knob that reintroduces the turn limit with extra steps.
9. **Mid-turn long work is a different mechanism (R35-6, correcting v1).** A worker waiting
   on its own subagents or a long test suite is INSIDE a turn — no result frame exists, so no
   pause record can or should mint. That case is the stall watchdog's domain (silence-vs-
   progress classification, a small named follow-up), NOT this epic. The suite-wait kill is
   fixed there, not here. This epic's scope is turn-boundary semantics only.

### 2.3 What dies

10. The `input_required`-pending-record exemption (8595e40) is subsumed with parity: a pending
    blocking interaction IS a pause with a named record; settlement unparks via the same
    respond() path (DG1/DG2 keep passing through the pausable flow; the phase11 CK2/CK8
    answer-delivery turn keeps passing through the degenerate auto-settle or the settle act).
11. No prompt-level prohibitions anywhere: driver objectives stop carrying "never pause",
    "no subagents", "write skeleton first". Acceptance includes a live wave whose member
    pauses twice mid-task and completes via nudges, with none of those phrases present.

## 3. Non-goals

No removal of the trust gate (capture/verification/effects move to claim time, unchanged in
content). No change to MockAdapter/`'claim'` semantics. No stall-watchdog redesign (named
follow-up, §2.2(9)). No nested-orchestration authority model (issue #12). No capability
restriction by default (#32's calibration stands). No prompt-level steering language in the
machinery.

## 4. Issue breakdown

- **31-a**: card declaration + default, pause record + `paused` state lifecycle
  (TRANSITIONS/guards/unpark/projections), steering registration at run creation, degenerate
  auto-settle with receipts. The backward-compat spine; the suite must stay green unchanged.
- **31-b**: steering acts (nudge/wait/claim) with reservation + authority op, claim
  invalidation on nudge, attention classification, RunView/wave/MCP projections, stall-guard
  parity.
- **31-c**: claim-time effect evaluation, visible-only escalation bound, the live pause-twice
  wave acceptance, and the stall-watchdog silence/progress follow-up spec.
