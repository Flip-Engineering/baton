# #80 BLUE-TEAM VERDICT — attack the TG3-window red-first suite

**Target:** `impl/test/tg3-window-red.test.mjs` — the suite's red-keeping power.
**Date:** 2026-08-07 · dispatch `ba-2026-08-07T06:02:22.112Z`
**Verdict:** **NEEDS-FOLD**

The suite's 8 red rows fail at the right named stages at HEAD and its 8 PIN rows are green today
without false-red pins. But the provider-call answer rows (TW-01/TW-03/TW-08b) and the B1 defect
row (TW-05) stage the D2 dispatch receipt against the checkpoint turn's **sealed** provider-turn
admission, and neither the contract nor the suite resolves what that means for the
`provider_call_after_terminal` governance gate. The rows are greenable only through a routing
detail the suite never pins, and they pass a wrong implementation that answers via the steering
path while still firing the governance violation (F1). One red row depends on real wall time
(F2). Two contract surfaces are never asserted (F3, F5). The depending-on-#67 row (TW-09b) is
staged honestly and correctly. Findings F1–F7 below, each with row/gap + attack + concrete fix.

---

## 1. Suite split — verified twice from the repo root

`node --test impl/test/tg3-window-red.test.mjs` from the repo root, two consecutive runs:

```
run 1 → tests 16 · pass 8 · fail 8
run 2 → tests 16 · pass 8 · fail 8
```

The 8 passes are exactly the PIN rows — TW-04, TW-06, TW-07, TW-08a, TW-09a, TW-disc-invalid,
TW-disc-digest, TW-disc-scope. The 8 failures are the red rows, each failing at its named stage
(verified individually):

| row | named stage | failure at HEAD (first-assertion) |
|---|---|---|
| TW-01 | provider-call-answer-missing | `task.status === 'working'` — no provider_call answer; the empty-fold expiry runs the full final (`coordinator.mjs:2303-2305`) → `failed` |
| TW-02 | dispatch-receipt-emission-missing | static `assert.match(codex, /resource\.provider_call[\s\S]*phase: 'requested'/)` — all adapters emit `completed` only at HEAD |
| TW-03 | queued-start-expires | `task.status === 'working'` — same empty-fold final → `failed` |
| TW-04b | steered-fold-missing | `steered.windowMs === 25` — the receipt is `{nudgeId, answered:false}` only (`:13206`) |
| TW-05 | evidence-gate-defect-missing | `task.status === 'working'` — no fold, no fire-time re-check; expiry runs the full final → `failed` |
| TW-08b | provider-call-answers-once | `task.status === 'working'` — same empty-fold final → `failed` |
| TW-09b | depending-on-#67: rearm-kinds-missing | `assert.ok(coordinatorNs.REARM_KINDS)` — no export at HEAD (`grep -rn REARM_KINDS impl/src` → 0 hits) |
| TW-10 | answer-not-evidence | static `assert.match(evidenceFn, /provider_call/)` — no provider_call branch in `_steeringEvidenceQualifies` at HEAD (`:2208-2238`) |

## 2. Method and citation discipline

- **NUL discipline.** `impl/src/application.mjs` and `impl/src/coordination-store.mjs` each carry
  3 NUL bytes (`tr -cd '\0' | wc -c`); they were inspected by `grep -an`/`sed -n` only, never read
  whole. The suite's own static rows read only the NUL-free sources (`coordinator.mjs`,
  `codex-appserver.mjs`, `cli-adapters.mjs`, `claude-session.mjs`), consistent with the suite
  header's claim.
- **Source anchors re-verified at HEAD.** `coordinator.mjs:9067-9097` (`_observeLogicalProviderCall`),
  `:9069-9072` (the sealed gate → `provider_call_after_terminal`), `:9075-9086` (id/phase/transition
  gates), `:9144-9152` (`_observeWatchdogEvent`, provider-call tracking at `:9151`), `:8867-8873`
  (`_scheduleProviderStop`, 250ms `_budgetTerminalGraceMs` default at `:1022/1032`), `:8876-8889`
  (`_recordProviderGovernanceViolation` → `providerPolicyHardExceeded = true` + kill arm),
  `:12331-12332` (seal on `turn_completed` with a usage seal), `:12372` (`_admitPauseRecord`),
  `:2165-2208` (`_armSteeringCycle`), `:2208-2238` (`_steeringEvidenceQualifies`), `:2251` (paused-only
  guard), `:2276-2306` (`_expireSteeringCycle`, full final at `:2303-2305`), `:12816-12817` + `:12827`
  (default case → `_observeWatchdogEvent`), `:12053`/`:12454` (the existing `_observeSteeringCycle`
  sites), `:3445` (`_admitProviderTurn` creates an unsealed `providerTurn`), `:8879/8896/9030`
  (`providerPolicyHardExceeded = true` setters).
- **Contract anchors.** `tg3-window-contract.md:139-145` (D2 answer, "validity is a prerequisite —
  an invalid or duplicate call (`_observeLogicalProviderCall`'s … `:9067-9097`) is telemetry noise"),
  `:220-228` (B1 fire-time re-check, "callId valid per `_observeLogicalProviderCall` :9067-9097"),
  `:233` ("validity-gated by `_observeLogicalProviderCall` before it ever reaches
  `_observeSteeringCycle`"), `:260-263` (D4, "`_observeWatchdogEvent` (which keeps its own
  provider-call tracking at `:9151`); the two consumers stay independent").
- **Green-side probes** were run against the real evidence chain (see F1).

---

## 3. Findings

### F1 — NEEDS-FOLD, HIGH — the provider-call answer rows stage the D2 receipt against the checkpoint turn's SEALED admission; the suite pins neither the false-red nor the false-green side of the `provider_call_after_terminal` gate

**Rows:** TW-01, TW-03, TW-08b.

**The staging.** Each row emits `turn_completed` with `UNAVAILABLE_USAGE_SEAL`
(`suite:153-155`) first; `_validateTerminalUsageSeal` accepts it (observe profile,
`terminalReserve` 0/0), so `handle.providerTurn.sealed = true` (`coordinator.mjs:12331-12332`)
fires before `_admitPauseRecord` (`:12372`) arms the 25ms window. The row then emits
`resource.provider_call {phase:'requested'|'completed'}` for the **same** turn against that sealed
admission. At HEAD this reaches `_observeWatchdogEvent` (`:12827`) → `_observeLogicalProviderCall`
(`:9151` → `:9067`), and the sealed gate at `:9069-9072` fires `provider_call_after_terminal`
before any id/phase check: probe-confirmed that the real worker's `providerTurn.sealed === true`,
the violation sets `providerPolicyHardExceeded = true`, arms the 250ms kill
(`:8867-8873`), and the call is never added to `providerCallPhases`.

**Attack.** Under a CORRECT v1.1 implementation the same receipt is the real turn-start dispatch
receipt: the adapter emits it at dispatch (`codex-appserver.mjs` turn/start before the await), and
the steering nudge path (`_armSteeringCycle:2179` → `send(... 'nudge')` → `_send` → `_deliver`
bare prompt) performs **no** `_admitProviderTurn`, so the receipt in the real flow also arrives while
`handle.providerTurn` is the sealed checkpoint object. The contract's own D2 text
(`tg3-window-contract.md:144-145`) and B1 (`:228-233`) make `_observeLogicalProviderCall` the D2
validity gate, and D4 (`:260-263`) keeps the watchdog observation undisturbed. That combination is
self-contradictory for an in-window receipt: the sealed gate at `:9069-9072` rejects exactly the
event D2 says must answer. The suite inherits the contradiction and asserts neither resolution:

1. **False-red.** An implementer who reads D2 literally and routes D2 validity through
   `_observeLogicalProviderCall` gets the sealed gate firing first → the receipt is rejected →
   the cycle never answers → the empty-fold expiry runs the full final → `task → failed` → TW-01/
   TW-03/TW-08b stay red under a correct contract implementation. The suite cannot tell this from
   the correct-bypass implementation, because both keep the rows red.
2. **False-green.** An implementer who adds the steering answer but leaves the watchdog observation
   untouched (exactly what D4 literally prescribes) answers the cycle in the new `_handleEvent`
   case and THEN fires `provider_call_after_terminal` in `_observeWatchdogEvent`. TW-01/TW-03/
   TW-08b all PASS: `gateEvents` filters only `forbidden_effect_observed` /
   `worker_path_scope_violation` / `required_effect_absent` (`suite:316`), so
   `resource.provider_governance_exceeded {code:'provider_call_after_terminal'}` is invisible;
   `adapter.calls.kill.length === 0` is sampled ~100ms in, before the 250ms kill fires; and the
   hard-exceeded flag is never asserted. Such an implementation also breaks the real flow (every
   dispatch receipt becomes a governance violation) — and the suite cannot see that.

**Concrete fix (suite-level).** Add to TW-01, TW-03 and TW-08b (or a new PIN row beside them) the
governance-clean receipt property, sampled with no clock:

- zero `resource.provider_governance_exceeded` and zero `resource.provider_telemetry_invalid`
  events in `coordinator._log.read(handle.id)` for the in-window receipt (assert the fold is
  clean of `provider_call_after_terminal` / `provider_call_id_invalid` / `provider_call_phase_invalid`);
- `coordinator._workers.get(handle.id).providerPolicyHardExceeded === false`;
- `coordinator._workers.get(handle.id).budgetStopTimer === null` (the kill is not armed — this is
  the no-clock way to prove the 250ms kill never fires);
- `adapter.calls.kill.length === 0`.

This pins that the D2 path answers **and** stays governance-clean, discriminating the false-red
and false-green wirings. Also flag the contract for a one-line clarification: the D2/B1 "validity
gate" is the id/phase/transition validity of `_observeLogicalProviderCall` **excluding** the
`provider_call_after_terminal` sealed gate for in-window receipts, which is the only reading that
makes the real dispatch flow work.

### F2 — NEEDS-FOLD, MEDIUM — TW-03's "minute 4" staging is real-wall-time dependent (#7 class)

**Row:** TW-03. **Stage:** `sleep(15); // minute 4 of the 25ms window` (`suite:402`) then
`emitProviderCall(... 'requested')`, then `sleep(60)` to cross the window.

**Attack.** `flush()` is a pure microtask pump (`suite:267-269`), so the only thing that positions
the call inside the 25ms window is the real 15ms sleep. The margin to the window expiry is 10ms.
Under event-loop load (parallel `node --test` files, CI), the 15ms timer can fire after the 25ms
window has already expired; the window expiry then runs the full final before the call is emitted,
the call lands post-expiry, `task → failed`, and TW-03 fails under a correct implementation. This
is exactly the #7 class the brief forbids: the row's green-side depends on real wall time.

**Concrete fix.** Emit the receipt from the same synchronous turn that arms the window — replace
the `sleep(15)` with `await flush(40)` immediately after `emitTurnCompleted`, then
`emitProviderCall`, then `sleep(60)` to cross the window. "At minute 4" is cosmetic; the semantic
the row pins is "a requested-phase receipt in-window, no turn_started, no content, settles the
cycle." Emitting at t≈0 is just as faithful and removes the real-time dependence entirely.
(Alternatively inject a deterministic clock for `progressNudgeWindowMs`, which the brief permits.)

### F3 — NEEDS-FOLD, MEDIUM — no row pins that qualifying in-window evidence is APPENDED to `record.steering.observedEvidence`; TW-05 injects the fold directly

**Gap:** the evidence fold (invented surface #3, `suite:103`; contract `:243-250`) is the
centerpiece of the #55-class debug trace and the B1 re-check, yet `observedEvidence` appears in
the suite only in the comment (`:103`) and in TW-05's direct assignment
`record.steering.observedEvidence = [{kind:'provider_call', phase:'requested', callId:'tw5-call'}]`
(`:486`). No row stages a real in-window evidence evaluation and then asserts the fold was appended
with the correct kind/phase identity before the settle.

**Attack.** A wrong implementation that answers the cycle without recording the fold passes every
row: TW-01/TW-03/TW-08b assert the settle, not the fold; TW-04b asserts the fold **summary**
(`windowMs`/`startEvidenceObserved`/`answerClasses`) on the receipt and the `steering_expired`
payload — which a fold-less implementation can still populate with `startEvidenceObserved:false`/
`answerClasses:[]`; TW-05 injects the fold, so it never tests the append path. The "append at each
evidence evaluation" contract is unpinned.

**Concrete fix.** Add a PIN row: stage a qualifying in-window evidence (e.g., `turn_started`, or a
valid `provider_call` for the seat), and before the cycle settles assert
`record.steering.observedEvidence` (via `coordinator._pausedTurns.get(pauseId)`) carries the
observed kind with the provider_call **phase** identity (`requested` vs `completed`) — then cross
the window and assert TW-04b's receipt/settle carry the same fold. This also unblocks F4's "which
call" discrimination.

### F4 — LOW — TW-08b's title claims "the first call answers" but no assertion pins which call answered

**Row:** TW-08b. **Attack.** The title (`suite:603`) and the assertion message
(`suite:618`) claim *the first* provider call answers, but the assertions pin only: task →
working, exactly one `turn.settled {basis:'steering_answered'}`, one nudge, the record consumed,
zero gate events. An implementation that answers on the second call (`tw8b-1 completed`) or the
third (`tw8b-2 requested`) passes every assertion. The row cannot discriminate the D2
requested-only answer class from a completed-only or any-call answer class.

**Concrete fix.** Assert the answering evidence's identity: the settle's recorded answer (or the
fold, per F3) must carry `callId === 'tw8b-1'` with `phase === 'requested'`. Because the record is
consumed at the settle, capture the fold before consumption (F3's append assertion) or assert the
`steering.evidence_gate_defect`/diagnostic fold identity.

### F5 — LOW — the TG6 "content-free write must never answer" class is never staged

**Gap:** the brief's axis (c) and the suite's own row map (`suite-draft-notes.md:78`) claim
TW-disc-digest kills "the TG6 class regressed — an impl that credits a content-free write — a
replayed digest or a digest-less write answering the cycle." The replay half is staged and pinned
(distinct digest answers once; a replayed digest never re-answers nor re-arms). The **digest-less
write** half is not: `emitScratchWrite` always carries a non-empty `text` and a key
(`suite:295-300`), and no row stages a write that yields a null/empty `contentDigest`
(`writeScratchpad` → `receipt.contentDigest ?? receipt.entry?.contentDigest ?? null`,
`coordinator.mjs:10585,12454`). An exotic wrong impl that answers only on digest-less writes passes
every row.

**Concrete fix.** Extend TW-disc-digest (or add a row): stage a scratchpad.write whose entry
produces a null/empty `contentDigest` (e.g., a content-less entry shape, or a store-refused write
that still yields a digest-less receipt) and assert the cycle does **not** answer — the honest
stall fires. This is the direct pin of "content-free write must never answer."

### F6 — LOW — TW-02's static regexes are shape-pinned, not semantic

**Row:** TW-02 (static half). **Attack.** The codex regex
`/resource\.provider_call\s*,\s*\{[^{}]*phase\s*:\s*['"]requested['"]/` (`suite:361`) matches only
`_emit(session, 'resource.provider_call', { …, phase: 'requested', … })` with `phase` directly in
the third-arg object; a semantically-identical emission through a shared helper, or with the
receipt nested in a `payload:` field, fails the assertion. The cli regex (`suite:364`) allows a
`payload:` field or a trailing object within 250 chars — also style-bound. A correct v1.1
implementation that emits the receipt in a differently-shaped (but valid, D2-conforming) way
false-reds.

**Concrete fix.** Assert the receipt semantically: wire the adapter's `onEvent` in a test and
assert a `resource.provider_call {phase:'requested'}` event is emitted before the turn-start
await resolves, instead of grepping the adapter source for a call shape. (The dynamic half of
TW-02, `suite:370`, already does the right thing.)

### F7 — MEDIUM — TW-05 and the B1 fire-time re-check inherit the same sealed-gate ambiguity as F1

**Row:** TW-05. **Attack.** TW-05 injects the fold (`suite:486`) and expects the expiry re-check to
find `startEvidenceObserved:true` and settle constructively. But the contract's B1 text
(`tg3-window-contract.md:228-233`) makes the re-check's validity test "callId valid per
`_observeLogicalProviderCall` :9067-9097" — which includes the sealed gate at `:9069-9072`. The
staged `tw5-call` is a post-terminal receipt against the sealed admission, so a literal
re-check rejects it as `provider_call_after_terminal`, the fold is "empty of start-class
identity", and the expiry runs the full final → `task → failed` → TW-05 stays red under the
contract's own literal reading. Conversely, a re-check that accepts any id/phase-valid call
(ignoring the sealed gate) greens the row — which is the only reading consistent with the real
flow (F1). The row discriminates neither.

**Concrete fix.** Same root as F1: after the contract clarifies that in-window receipts bypass the
sealed gate, TW-05 must assert that the re-check consumed the **injected** fold and that the
constructive settle produces the `steering.evidence_gate_defect` receipt with
`answerClasses: ['provider_call']` AND leaves the worker governance-clean (no
`provider_call_after_terminal`, `providerPolicyHardExceeded === false`, `budgetStopTimer === null`).
Until then the row is greenable only through the ambiguous reading.

---

## 4. Green-side check — which rows are safely greenable under a correct v1.1 implementation?

- **TW-02** — greenable; the emission points are real (`codex-appserver.mjs` turn/start dispatch
  before the await; `cli-adapters.mjs` exec dispatch) and the dynamic half stages the wire order.
  Only the static half is shape-pinned (F6).
- **TW-04b** — greenable; the fold summary (`{windowMs, startEvidenceObserved, answerClasses}`) on
  the steered receipt (`:13206`) and the `steering_expired` payload is a clean, clock-free target.
  The fold **contents** stay unpinned (F3).
- **TW-09b** — correctly failing at its named depending-on stage: the first assertion is
  `assert.ok(coordinatorNs.REARM_KINDS)` on an invented export that does not exist at HEAD
  (`grep -rn REARM_KINDS impl/src` → empty; contract G7). Greenable only when #67 lands — the
  target-state posture is honest.
- **TW-10** — greenable; the no-clock pins (window default `300_000` byte-unchanged, no
  `windowMsByRoute|latencyScale|perRouteWindow`, no `_expireSteeringCycle` → `_setTimeout` re-arm)
  are the right D1 shape. Note: TW-10's `doesNotMatch /_expireSteeringCycle[\s\S]{0,400}?_setTimeout/`
  is satisfied at HEAD because the expiry's `_setTimeout` lives in `_armSteeringCycle` (the arm),
  which is correct — the expiry itself must not re-arm.
- **TW-01/TW-03/TW-08b/TW-05** — **NOT safely greenable** as written; their green-side is hostage
  to the sealed-gate routing ambiguity (F1, F7).

## 5. PIN-row verification — no false-red pins

All 8 PIN rows remain green under a correct v1.1 implementation (each verified):

- **TW-04** (honest stall → full final + `steered:{nudgeId, answered:false}`) — an empty-fold
  expiry is exactly today's path; the v1.1 fold only adds a summary, which does not change the
  verdict for an empty fold.
- **TW-06** (turn_started still answers) — the D2 fold preserves the turn_started class.
- **TW-07** (the nudge never self-answers) — `control.nudge` (actor policy) and the adapter's
  acceptance stay excluded from the answer set.
- **TW-08a** (once-per-record) — staged `governed:false` exactly because a governed second
  checkpoint would hit the unrelated `usage_seal_duplicate` (`coordinator.mjs:9024`); the
  once-per-record bound
  holds under either "HEAD non-answer" or "v1.1 first-call-answer" (exactly one settle either way).
- **TW-09a** (shipped watchdog half byte-unchanged) — the contract leaves `_armWatchdog`'s
  working-only refusal and `_observeWatchdogEvent`'s tracking intact (D4).
- **TW-disc-invalid** (invalid id/phase = noise) — the D2 validity gate rejects empty callId and
  `started` phase before the steering answer; the honest stall fires. The sealed check
  (`:9069-9072`) fires first at HEAD but the row's assertions hold under the correct id/phase gate
  too, since the honest stall is the outcome either way.
- **TW-disc-digest** (distinct-digest class) — preserved; the digest set dedup
  (`coordinator.mjs:2214-2215`) and once-per-record survive the fold.
- **TW-disc-scope** (per-handle scoping) — the observation routes by the event's worker; a call
  from another worker never reaches the seat's cycle.

No PIN row depends on real wall time: TW-04/TW-06/TW-07/TW-08a/TW-disc-* use `flush(40)` +
`sleep(60)` crossings only, which exceed the 25ms window with a comfortable margin. Only the red
TW-03 uses a sub-window real sleep (F2).

## 6. Deployment verification

Baton execution contract (from the dispatch): executable `true`, argv `[]`, working directory `.`,
**expected exit 0**. This blue-team review adds no build/run step; the measured artifact is the
suite split in §1.
