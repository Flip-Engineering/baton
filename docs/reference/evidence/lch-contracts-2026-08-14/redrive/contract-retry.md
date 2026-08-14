# LIFECYCLE CONTRACT — row-retry: durable member retry (package ④ lifecycle-honesty)

[attempt: fcd0b7ea-f684-4c3c-a417-19cf736c8509 row-retry]

Ring-2 contract form. Every citation re-verified THIS session at HEAD `09200e9` (`grep -an`/`sed -n`
on `application.mjs` + `coordination-store.mjs` — NUL discipline: both files carry bytes that force
`-a`; plain grep elsewhere). No clocks anywhere. Sorted-key literals in ACTUAL order. Issue set:
#201 [HIGH] durable member retry (classify-then-resume) · #188 failure-stall forced review
(event-derived, pm-adoption ③) · #50 glm stream death + #55 stall-marker blind spot · #163
quiescence reads retrying correctly. Cross-refs the folded quiescence contract
`docs/reference/evidence/contract-foundry-2026-08-13/contract-163.md`.

---

## Ground truths (HEAD `09200e9`)

### GT-1 — 'retrying' exists NOWHERE in the implementation or its closed vocabularies.

`grep -rn "retrying" impl/src/` returns **zero matches**. The closed member/run axes are:
- `CANONICAL_RUN_PHASES` (`application-semantics.mjs:20-25`), 20 phases, ACTUAL order:
  `planning, awaiting_approval, queued, working, paused, interrupted, uncertain, verifying,
  result_ready, awaiting_selection, result_selected, reviewing, integrating, completed, failed,
  cancelled, stopped, denied, stopping` — **no `retrying`**.
- `CANONICAL_MEMBER_STATES` (`application-semantics.mjs:26-29`), 11 states, ACTUAL order:
  `pending, idle, working, blocked, paused, interrupted, stopping, completed, failed, cancelled,
  stopped` — **no `retrying`**.
- `TERMINAL_TASK_STATUSES` (`coordinator.mjs:289`) = `{'completed','failed','cancelled'}` — the
  task-status axis a retry would have to escape.

The registry owns these enums and their legacy maps (`application-semantics.mjs:20-76`); no surface
hand-maintains a union. **Adding `retrying` is an additive registry change on the member-state
axis, never a run-phase axis change** (D-1).

### GT-2 — a failed member is terminal at the wave layer; no ladder exists.

`wave.mjs:353` — a member that never started projects in `progress()` as
`{ role, phase: 'failed', terminalCause: 'start', terminal: true, attention: null, error:
entry.startError, knowledgeDigest: null }` (the §7.2 canonical projection; legacy `start_failed`
is resolved away). `wave.mjs:472` — the same member settles with `{ phase: 'failed',
terminalCause: 'start', terminal: true, ... error: entry.startError }`. The start error is recorded
(`wave.mjs:250`, `:331`, `:334`), then the member is **terminal and immutable**: no retry ladder,
no preserved-dead-attempt record, no re-drive. `createWave` at `:189`, `attachWave` at `:275`.

### GT-3 — the wave driver folds failed-to-start into settled and re-drives only same-wave.

`wave-driver.mjs:763-768`: `const failedToStart = totalMembers - runs.size; let settled =
failedToStart;` — members that never produced a run are counted settled-failed at the stall sweep.
The only re-drive that exists is the **same-wave, same-key ritual resume** (`allowTerminalReplay:
true` at `:380`, the #183 idempotent re-attach), which recovers `failedToStart` by restarting the
same member key — not a classified durable retry. Delivery failures are bounded at K=3 consecutive
per pause (`:711-714`, `:744-752`) and stop being steered, not retried-with-classification. The
deployment-wide stall clock is `stallTimeoutMs: 20 * 60_000` (`:39`) with `hardCapMs: 3 * 3_600_000`
(`:40`).

### GT-4 — the interpreter's drive loop cannot see a retrying member's liveness.

`workflow-interpreter.mjs` `readView` (`:442-476`) returns a CLOSED shape —
`{ phase, actions, attention, taskId, workerId, planDigest, task, terminal, terminalStatus }` —
**dropping `lastProgress`/`silenceMs`/`progressClass`** (contract-163's B3 projection is NOT landed
at this HEAD). The loop (`:780`) removes a member only when `isTerminal(v)`; the loop runs
`while (pending.size > 0 && Date.now() - startedAt < driver.hardCapMs)` (`:783`). `TERMINAL_PHASES`
(`:478`) and `isTerminal` (`:479`) know nothing of a retry state. A member between attempts would
hold `pending` until `hardCapMs` or terminalize — no honest `retrying` intermediate exists.
`DEFAULT_DRIVER` (`:414`) = `{ pollIntervalMs: 15, stallTimeoutMs: 400, hardCapMs: 3000 }` — the
lane's fast test driver carries no retry policy.

### GT-5 — the #182 classifier exists and is the ONLY retryability authority.

`application-semantics.mjs`:
- `PROVIDER_TERMINAL_GUIDANCE` (`:2109-2134`): four codes, each `retryable: true`
  (`authentication_required`, `authentication_refresh_required`, `wire_frame_oversize`,
  `provider_crashed`).
- `GENERIC_PROVIDER_TERMINAL_GUIDANCE` (`:2136`) `retryable: true`; `DISPATCH_REFUSAL_GUIDANCE`
  (`:2146`) and `GENERIC_DISPATCH_REFUSAL_GUIDANCE` (`:2161`) `retryable: true`.
- `projectTypedTerminalCause` (`:2180-2204`) projects the closed `{kind, code}` with kinds
  `{budget_exceeded, provider_failure, policy_failure, dispatch_refused, operator_stop}`. **The
  `retryable` flag is present ONLY on the provider_failure and dispatch_refused arms.** The
  `budget_exceeded` arm carries `dimension/used/limit/ratio` and **no** `retryable`; the
  `policy_failure` and `operator_stop` arms carry **no** `retryable`. A correct retry gate must
  read the flag's presence, not assume it (D-2, DR-1).

### GT-6 — the durable two-phase content-addressed retry precedent exists: `run.verification_retry`.

`coordination-store.mjs:11817-12040` — the Phase 69 VR6 cascade:
- retry record keyed `_runVerificationRetryKey(runId, nodeKey)` = `` `${runId}\0${nodeKey}` ``
  (`:11820`); idempotency key `run.verification_retry:${runId}:${nodeKey}:${attempt}` (`:11874`).
- **admission** (`admitRunVerificationRetry`, `:12003`) requires the EXACT failed approved Plan
  task + hub-mapped `verify.reverified` evidence + pinned diagnostic checkpoint + digest-bound
  request (`requestDigest`/`admissionDigest`); **attempt sequencing is enforced**
  (`expectedAttempt`, `:11926-11927`).
- **completion** (`completeRunVerificationRetry`, `:12020`) closes the record with a receipt
  (`scope 'run-verification-retry'`, states `{accepted, candidate_failed, inconclusive,
  cancelled}`); the dead task stays `status: 'failed'` and is never overwritten.
- facade: `application.mjs:5344 retryVerification`; dispatch `:12807`; alias `run.retry`
  (`application-semantics.mjs:827`, `:1316`, `:1843`).

This is the structural model #201 must mirror: **content-addressed admission, bounded per-key
record, enforced attempt sequence, dead record preserved**.

### GT-7 — `waves.run` is executable at HEAD; its drive loop is a continuation.

`web-northbound.mjs:46` registers `waves_run` → `waves.run`; `mcp-northbound.mjs:1919` calls
`this.application.command('waves.run', …)`; `application.mjs:12729` dispatches `waves.run` →
`this.runWorkflow(...)`. The drive-to-settle leg is a CONTINUATION (`workflow-interpreter.mjs:
572-574`): detached callers get the acceptance receipt synchronously, `wave.settled` lands via
`onSettle`. A retry ladder is a `waves.run` drive policy, not a new transport.

### GT-8 — the `shared` scratchpad publish is NOT executable end-to-end at HEAD.

The write verb is **registered** on the surface transports (`web-northbound.mjs:52-53`
`run_scratchpad_append`; `mcp-northbound.mjs:118`, `:2044-2045`; `application-semantics.mjs:1710`)
and the kernel method exists (`coordination-store.mjs:14233 appendScratchpad`, accepts scope
`'shared'`, caps `MAX_SCRATCHPAD_SHARED_ENTRIES`). But the application facade dispatch routes
**only** `run.scratchpad.read` (`application.mjs:12654`) and `run.scratchpad.elevate` (`:12655`);
an append falls through every direct-port `if` and hits
`throw applicationError('unsupported application command …', 'application_command_unavailable')`
(`application.mjs:12830`). The #158 surface write is unlanded at this facade. Contract-163's OQ1
conclusion holds (its `application.mjs:12522-12523` anchors have shifted to `:12654-12655`).

### GT-9 — no redriveMembers helper; #59 carry-forward is contracted but not landed.

The #59 contract (`docs/reference/evidence/redrive-continuity-2026-08-07/
redrive-continuity-contract.md`) records at GT5 that `redriveMembers` is **absent** from
`recipes.mjs`. The carry-forward semantics (UNTRUSTED re-drive framing, R1-R9 pins,
`redrive_carry_*` refusals) are contracted, not implemented. The 93B wave-durability rule 5
(`docs/reference/evidence/wave-durability-2026-07-30/wave-durability-decisions.md`) specifies
re-drive-the-failed via fresh wave + salted objectives + checkpoint pins.

### GT-10 — the stall seam is blind to mid-turn provider activity (#55), and the #50 class has no adapter error.

`wave-driver.mjs:197-207` `stallMarker(outline)` **strips the derived liveness fields**
(cursor/progressClass/requiredAction/waitingOn) from the outline it marks. The #55 fix cited as
`_activityProjection` (`application.mjs:8041-8068`) in stall-watchdog G13 **does not exist at this
HEAD** (verified: `grep -an "_activityProjection" impl/src/application.mjs` → no match). The #50
failure class (glm stream death, ~20 min silent) emits **no adapter error** — there is no typed
terminal cause to classify from the wire. A retry gate that reads the stall marker, or that demands
an adapter error, is structurally blind to both classes (D-6).

### GT-11 — #188 is the pm-adoption "failure-stall → forced review", event-derived.

`docs/reference/evidence/pm-comparison-2026-08-13/landing-note.md:35` lists the corrected adoption
order, item ③: **"failure-stall → forced review (event-derived, #67's sibling)"**. The veto context
(`landing-note.md:27-29`) is that every wall-clock gate is REJECTED or ADAPTED to event-derived.
A member that dies unclassifiable must route to a forced review triggered by the terminal/stall
**event**, never by a timer (D-5).

### GT-12 — quiescence is itself unlanded and reads no member state.

Contract-163's D1.1 3-leg predicate is `silenceMs >= windowMs` AND `progressClass === 'silent'`
AND phase not in `ACTIVE_TURN_PHASES` (`contract-163.md:191-212`, `:263`). `ACTIVE_TURN_PHASES`
is a **proposed new module-scope set** — verified absent from `impl/src` at this HEAD (only the
unrelated `kimi-acp.mjs` `activeTurn` session field exists). The predicate reads a run-view
projection (contract-163's B3/G3), which is exactly the projection GT-4 shows is dropped at HEAD.
A `retrying` member, between attempts, would project as `silent` in the inter-attempt gap and
false-quiesce — unless the retry state is itself liveness (D-7).

---

## Decisions

### D-1 — `retrying` is an additive MEMBER state, never a run phase.

The roster is per-member; a retrying member's underlying run is a fresh re-drive with its own
normal run phase. Adding `retrying` to `CANONICAL_MEMBER_STATES` (additive, ACTUAL sorted position
between `paused` and `stopping`) is the honest surface; `CANONICAL_RUN_PHASES` is unchanged. The
roster projection (`wave.mjs` `progress()` and the registry's generated legacy maps) must emit the
member state `retrying` with the live attempt number, while the dead attempt's terminal record
stays `failed` (GT-2, GT-6's preserve-the-dead rule). No legacy literal maps to `retrying` at this
HEAD; the generated mapping resolves `retrying → retrying`.

**Judgment call recorded:** the issue text says "the roster shows 'retrying' honestly" — the roster
is the member axis. A run-phase `retrying` would collide with the run's own re-drive phase and is
rejected (DR-2 records the option).

### D-2 — classify-then-resume: the #182 classifier is the mandatory gate.

A member retry is admitted **only when** the dead attempt's `projectTypedTerminalCause` projection
exists **and carries `retryable: true`**. The classifier is the sole retryability authority (GT-5).
Because the flag is present only on the provider/dispatch arms, the budget/policy/operator arms are
**not auto-retryable** — they route to the deployment/operator gate (D-5, DR-1). The gate is
event-derived: it reads the dead attempt's terminal record, never a wall clock and never the stall
marker (D-6).

### D-3 — resume is a content-addressed re-drive with declared inheritance per #59.

The re-drive's objective is derived from the dead attempt's content address (its manifest/checkpoint
digest). The admission mirrors GT-6's cascade: a bounded per-member retry record keyed
`` `${runId}\0${memberKey}` ``, `requestDigest`/`admissionDigest` binding, enforced attempt
sequencing (attempt n requires the (n−1)th dead record), and the dead record preserved. The re-drive
**declares its inheritance**: the carry-forward set (scratchpad entries, pins, terminal cause,
refusals) is enumerated and digest-bound, framed UNTRUSTED per #59 — carried content is evidence
never authority (GT-9).

### D-4 — budget deployment-owned; no arbitrary numeric limits.

The retry budget is a deployment-scoped policy object (per CLAUDE.md, no hardcoded numeric caps —
any bound derives from deployment resource constraints, e.g. provider route quota or worktree
capacity). A `budget_exceeded` terminal on the ladder is **final** (no further retries). There is
**no retry-count cap in code**; the deployment budget is the natural throttle. Recorded so no later
implementer adds a `maxRetries` constant (DR-3).

### D-5 — failure-stall → forced review, event-derived (#188, pm-adoption ③).

A member whose dead attempt is unclassifiable — no terminal cause, the #50 stream-death class
(GT-10) — is **not** silently auto-retried. It routes to a forced review lane triggered by the
terminal/stall **event** (the classified failure record or the declared stall), never a wall-clock
(GT-11). The review is the existing `run.review` lane (`application.mjs:12812`), not an auto-resume
(OQ-4). The dead record's "unclassifiable" projection is itself a typed terminal cause
(`provider_failure` with `provider_crashed`, GT-5) — the forced review is what happens when the
classifier's `retryable: true` is absent OR the run died before any terminal record existed.

### D-6 — retryability reads the typed terminal cause, never the stall marker (#55).

The admission reads the run's terminal record through `projectTypedTerminalCause` (GT-5). It must
never depend on the stall marker, which strips liveness (`wave-driver.mjs:197-207`) and whose
`_activityProjection` fix is absent at this HEAD (GT-10). A mid-turn provider-activity member that
later fails is classified from the terminal record — the stall seam's blindness is not inherited by
the retry gate.

### D-7 — quiescence reads retrying correctly (#163 cross-ref).

The folded D1.1 predicate must exclude a `retrying` member: the member state `retrying` is itself
liveness, so a retrying member is never a quiescence candidate — even in the inter-attempt gap when
the underlying run projects `queued`/`working` and would otherwise read `silent` (GT-12). Concretely
the folded predicate gains a leg — `memberState === 'retrying'` → not a candidate — via the same
run-view projection seam contract-163's B3/G3 lands (GT-4). Contract-163's A1 counterexample is
extended: a wave whose only remaining member is retrying is never `WAVE-QUIESCED`.

### DECISION_REQUESTs

- **DR-1 (authority-class ambiguity — budget):** the classifier's budget arm has **no** `retryable`
  flag (GT-5). The issue text "budget deployment-owned" leans operator-gate, but the re-provisioning
  event that would unblock a budget retry is not yet a typed event. Options: **(a)** budget_exceeded
  is never auto-retryable — deployment/forced-review gate only (RECOMMENDED, matches the flag's
  absence); **(b)** budget_exceeded is auto-retryable after a typed deployment re-provision event
  (event-derived, no clock). Escalate to the orchestrator; the flag stays absent until decided.
- **DR-2 (axis):** `retrying` on the member-state axis only (RECOMMENDED, D-1) vs both member-state
  and run-phase axes. A run-phase `retrying` is rejected: it collides with the re-drive's own phase.
- **DR-3 (bound):** no retry-count cap in code (CLAUDE.md); the deployment budget is the natural
  throttle. If the orchestrator later wants a per-member ladder bound, it must be deployment-policy
  derived, never a constant.

---

## Closed refusal vocabulary

The retry machinery emits exactly these typed refusals (surface-constant, mirroring GT-6's
`run_verification_retry_*` codes):

- `member_retry_invalid` — envelope/spec malformed (unknown field, bad scope, bad runId).
- `member_retry_unavailable` — the dead attempt's classification carries no `retryable: true`
  (D-2); the gate refuses, it never silently skips.
- `member_retry_conflict` — idempotency / attempt-sequence mismatch (a duplicate or out-of-order
  admission, mirroring `run_verification_retry_conflict`, `coordination-store.mjs:11926-11927`).
- `member_retry_integrity` — the carry-forward digest binding is violated (declared inheritance
  does not match the dead attempt's record).
- `member_retry_budget_exhausted` — the deployment retry budget is consumed; the ladder is final
  (D-4).
- `member_retry_unchanged` — the re-drive's content address is identical to the dead attempt with
  no new admission authority (no silent same-address re-drive).
- `member_retry_forbidden` — authority-class violation (a coordinator-seat principal driving a
  retry, mirroring `coordinator_authority_forbidden`, `application.mjs:12711`).
- `member_retry_classifier_missing` — no terminal cause to classify (the #50 class); the refusal
  names the forced-review routing (D-5).

---

## Red-first acceptance pins (each RED at HEAD `09200e9`, green only for a correct impl)

| Pin | Named stage | Acceptance | RED at HEAD |
|---|---|---|---|
| **A1** | roster (`waves.progress`/`waves.list` / `wave.mjs progress()`) | The roster shows a member between dead attempt and fresh run as `retrying` with its live attempt number, while the dead attempt's terminal record stays `failed` (preserved, never overwritten). | **RED** — no `retrying` in `CANONICAL_MEMBER_STATES` (`application-semantics.mjs:26-29`); `wave.mjs:353`/`:472` mark a start-failed member terminal `failed` immediately with no ladder and no dead-record. |
| **A2** | admission | A member retry is refused `member_retry_unavailable` unless the dead attempt's `projectTypedTerminalCause` projection carries `retryable: true`. | **RED** — no member-retry admission exists at all; the classifier's `retryable: true` covers only the provider/dispatch guidance arms (`application-semantics.mjs:2109-2134`); the budget/policy/operator arms return no flag (`:2180-2204`). |
| **A3** | admission record | The re-drive admission is content-addressed: `requestDigest`/`admissionDigest` binding, bounded per-member record keyed `` `${runId}\0${memberKey}` ``, enforced attempt sequencing. | **RED** — no member-retry record exists; the only such cascade is `run.verification_retry` (`coordination-store.mjs:11817-12040`), verification-scoped not member-scoped. |
| **A4** | re-drive mint | The re-drive carries a declared, digest-bound carry-forward (scratchpad/pins/terminal/refusals) framed UNTRUSTED per #59. | **RED** — `redriveMembers` absent from `recipes.mjs` (#59 contract GT5); the carry-forward is contracted (`redrive-continuity-2026-08-07`), not landed. |
| **A5** | deployment policy | The retry budget is a deployment-scoped policy (configurable, derived); a `budget_exceeded` terminal on the ladder is final; no hardcoded retry cap exists. | **RED** — no member-retry budget exists; the budget arm (`application-semantics.mjs:2180-2204`) carries `dimension/used/limit/ratio` but no ladder binding and no `retryable`. |
| **A6** | failure-stall routing | A member whose dead attempt is unclassifiable (no terminal cause, #50 class) routes to forced review triggered by the terminal/stall EVENT, never a wall-clock. | **RED** — no forced-review routing; the interpreter loop terminalizes only (`workflow-interpreter.mjs:780`); the driver's stall recovery is a same-wave re-drive (`wave-driver.mjs:380`, `:785-788`), not a classified review. |
| **A7** | admission reads | Retryability classification reads the typed terminal cause from the run's terminal record, never the stall marker. | **RED** — `stallMarker` strips derived liveness (`wave-driver.mjs:197-207`); `_activityProjection` absent at this HEAD (GT-10) — a mid-turn-activity member is invisible to the stall seam. |
| **A8** | quiescence evaluate | A `retrying` member is never a quiescence candidate (contract-163 D1.1). | **RED** — `retrying` does not exist and `ACTIVE_TURN_PHASES` is absent from `impl/src`; the folded predicate cannot read a member's retry state, so an inter-attempt member would project `silent` in the gap and false-quiesce (GT-12). |
| **A9** | drive (`waves.run`) | `waves.run` drives a member retry ladder declared by the spec and settles with a receipt naming the retried attempts. | **RED** — the spec/`driveLane` has no retry fields (`workflow-interpreter.mjs:442-476` readView, `:726-810` driveLane); `DEFAULT_DRIVER` (`:414`) carries no retry policy. |
| **A10** | run-view projection | The run view/roster exposes the member retry state and the dead-attempt reference so surfaces and the quiescence evaluator read it. | **RED** — `readView` returns a closed shape without `progressClass`/`silenceMs`/`lastProgress` (`workflow-interpreter.mjs:442-476`); `wave.mjs:349-370` `progress()` emits no retry state. |

Every pin is RED at HEAD at its named stage and green only under a correct impl — a wrong impl
(relabeling the verdict, dropping the dead record, reading the stall marker, imposing a `maxRetries`
constant, or quiescing a retrying member) fails the corresponding pin (shallow-greenability is a
defect).

---

## Open questions

- **OQ-1 — the `shared` scratchpad publish is not executable at this HEAD; the durable file is the
  only channel.** The frame requires publishing the final draft to the `shared` scratchpad partition
  (`foundry-brief.md:23`). Verified THIS session at HEAD `09200e9`: the facade dispatches
  `run.scratchpad.read`/`run.scratchpad.elevate` only (`application.mjs:12654-12655`); the
  `run.scratchpad.append` surface verb is registered (`web-northbound.mjs:52-53`,
  `mcp-northbound.mjs:118`/`:2044-2045`) and the kernel method exists
  (`coordination-store.mjs:14233 appendScratchpad`), but the facade falls through to
  `application_command_unavailable` (`application.mjs:12830`). Contract-163 OQ1's verdict is SOUND
  and its anchors updated. The durable-file fallback per the prior foundry's coordinator brief
  (`contract-foundry-2026-08-13/coordinator-brief.md:12-13`) is this file.
- **OQ-2 — does the member retry ladder compose with `run.retry_verification`?** A retried member
  re-runs its verification; on a verification failure it would then need the run-level
  `run.verification_retry` cascade (GT-6). The two ladders must compose without double-recording the
  same dead attempt (A3's record key is per-member, GT-6's is per-run+nodeKey).
- **OQ-3 — what is the exact carry-forward boundary per #59?** Which scratchpad entries are carried
  into the re-drive — all worker-scoped entries, or only the set the dead attempt declared? The
  digest-bound enumeration (D-3, A4) needs the boundary fixed before the integrity refusal
  (`member_retry_integrity`) is enforceable.
- **OQ-4 — does the forced-review lane reuse `run.review` (`application.mjs:12812`) or need a new
  event-derived routing seam?** Reusing `run.review` is cheapest; a new seam must be typed in the
  refusal vocabulary (`member_retry_classifier_missing` currently names it).

---

*Judgment calls recorded (D-1..D-7); authority-class ambiguity escalated via DR-1..DR-3. Execution
contract: this file is the row's single deliverable (plus the shared publish — refused per OQ-1).
Exit 0, no command.*
