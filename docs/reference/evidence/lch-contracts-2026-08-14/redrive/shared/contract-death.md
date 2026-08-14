# Issue #182 — death certificates: every terminal run carries a derived suspicionClass + evidence

[attempt: fcd0b7ea-f684-4c3c-a417-19cf736c8509 row-death]

- **Issue:** #182 — death certificates (the waves.run operator surface, package ④ lifecycle-honesty)
- **Date:** 2026-08-14
- **Status:** DRAFT — implementation contract (Ring-2 form: ground truths → decisions → closed refusal
  vocabulary → red-first acceptance pins → open questions)
- **Verification HEAD:** `09200e97c1be113946459d901c8fab56034d8a1f` (`09200e9`). Every `file:line`
  citation below was re-verified THIS session with `grep -an`/`sed -n` at the verification HEAD
  (NUL discipline: `application.mjs` + `coordination-store.mjs` via `grep -an`/`sed -n` only; plain
  grep elsewhere), unless explicitly marked spec-referenced (a cross-contract pin, not a
  working-tree read). Sorted-key literals are the ACTUAL sorted orders, verified by node against the
  declared arrays. No clocks.
- **Brief:** `foundry-brief.md` + `row-death.md` (same dir) — read fully; the campaign evidence
  (#182's manual recoveries) is the requirement source.
- **Harvest note:** this file is `contract-death.md` — contains "contract" (wavefile
  `lch-contracts-2026-08-14/redrive/lch-contracts.wavefile` mustContain "contract").
- **Frame:** every terminal run must carry a DERIVED `suspicionClass` + evidence, chosen from a
  CLOSED 7-set: `provider_refusal` / `capacity_reap` / `watchdog_stall` / `wave_close_teardown` /
  `credential_death` / `explicit_stop` / `clean_terminal`. Today a terminal run names its typed
  cause (`terminalCause`) but never a suspicion class, and the manual recoveries were "pin
  archaeology" — reading code paths by hand to learn why a member died. The derivation inputs
  exist: #67 watchdog stall states, #79 delivery receipts, adapter refusals, the wave-close path.
  This contract fixes the surface, the closed vocabulary, the precedence, and the honest-degradation
  boundary for inputs that are process-scoped at HEAD.

## Ground truths (verified against HEAD `09200e9`)

1. **The certificate vocabulary does not exist at HEAD.** `grep -an "certificate\|suspicionClass\|deathCertificate\|death_certificate\|derivedSuspicionClass"`
   returns ZERO hits in each of `application.mjs`, `coordination-store.mjs`, `coordinator.mjs`,
   `wave-driver.mjs`, `application-semantics.mjs`. The surface is genuinely additive; every
   acceptance pin below is RED at HEAD by construction.
2. **The terminal-phase vocabularies are closed sets.** `APPLICATION_RUN_TERMINAL_PHASES` =
   `{cancelled, completed, denied, failed, stopped}` (declared `completed, failed, cancelled,
   denied, stopped`, `application.mjs:161-165`); `PROVIDER_EXECUTION_SETTLED_PHASES` =
   `{cancelled, candidate_selected, completed, denied, failed, selection_required, stopped,
   work_completed}` (declared `work_completed, selection_required, candidate_selected, completed,
   failed, cancelled, denied, stopped`, `application.mjs:158-160`). The registry L4 predicates own
   the canonical vocabulary; outward surfaces resolve through them (`application.mjs:157-159`).
3. **The single-run view is the terminal-cause surface.** The `run.inspect` view
   (`application.mjs:7885-7970`) carries `phase`, `narrative` (via `terminalCauseNarrative`,
   `application.mjs:2295-2308`), `terminalCause` (`application.mjs:7964`), a `stop` block
   `runStop ? {state, admittedAt, completedAt, targetCount, targetDigest, receipt} : null`
   (`application.mjs:7966-7969`), and a `close: null` stub (`application.mjs:7970`). It has NO
   `certificate` key. `run.inspect` is a `definition.web: true, mcp: true` entry
   (`application.mjs:179`).
4. **The typed terminal-cause projection is closed.** `projectTypedTerminalCause`
   (`application-semantics.mjs:2180-2212`) folds `{terminalResult, terminalOutcome, runStop,
   dispatchRefusal}` into exactly the kinds `budget_exceeded` / `provider_failure` /
   `policy_failure` / `dispatch_refused` / `operator_stop`; the `runStop ? {kind:'operator_stop',
   code:'operator_stop'} : null` branch is the operator_stop tail (`application-semantics.mjs:2211`).
5. **The terminal-guidance vocabularies are closed maps.** `PROVIDER_TERMINAL_GUIDANCE`
   (`application-semantics.mjs:2109-2134`): `authentication_required` +
   `authentication_refresh_required` (category `provider_authentication`), `wire_frame_oversize`
   (`provider_protocol`), `provider_crashed` (`provider_runtime`). `DISPATCH_REFUSAL_GUIDANCE`
   (`application-semantics.mjs:2145-2164`): `worktree_capacity_exceeded` +
   `worktree_capacity_unavailable` (category `workspace_capacity`). No other codes exist.
6. **The durable run-stop record exists, receipt-validated, sorted-key.** Admission
   `run.stop:<runId>` binds `{schemaVersion, scope, repoId, runId, reasonDigest, requestDigest,
   targetRunIds, targetTaskIds, targetWorkerIds, targetDigest, ...}` (`coordination-store.mjs:4611-4614`);
   the completion receipt is validated as a closed sorted-key shape
   (`coordination-store.mjs:4705-4725`): receiptFields ACTUAL order =
   `checks,context,counts,effects,receiptDigest,remainingCount,repoId,runId,schemaVersion,scope,state,targetCount,targetDigest`
   (`context` present for schemaVersion ≥ 2); countFields = `alreadyTerminal,killConfirmed,
   pendingCancelled,processesClosed,processesObserved`; checkFields = `dispatchClosed,
   interactionsResolved,runAuthorityReleased`; effectFields = `coordinatorClosed,transportsClosed,
   writerReleased`. The stop mints `run.stop_admitted` (`coordination-store.mjs:8701`). The
   application `stop()` path admits with `{actor: principal.actor, key:'run.stop:<runId>'}`
   (`application.mjs:13456-13499`) — the actor is the issuing principal; there is NO
   driver-vs-operator authority class in the durable record.
7. **The wave registry + close shape are closed.** `wave.started` fold derives the registry row
   `{closedAtEventSeq, deploymentId, roster, startedAtEventSeq, state, waveId}`
   (`coordination-store.mjs:8116-8138`); `wave.closed` closes the row (`coordination-store.mjs:8854-8868`);
   the closed payload must be the 8-key shape, ACTUAL order `blockedOn,knowledge,lanes,parked,
   receiptDigest,rings,settlementErrors,waveId` (`coordination-store.mjs:13371-13427`). The wave
   driver appends `wave.closed` in its guaranteed post-close window (`wave-driver.mjs:830-904`),
   after `wave.close({reason:'Wave driver settled.'})` in the close finally.
8. **The store task record persists a DERIVED `termination` block for non-completed tasks.**
   `terminalCause(task)` validates terminal-event identity and maps `coordinate.coordinationSeq` →
   `evidence.mapped` → `_operationalRead` (`coordination-store.mjs:6395-6410`); the record carries
   `termination` for non-completed statuses (`coordination-store.mjs:6510`). The trust-gate kill
   sets `handle.terminalCause = {kind:'policy_failure', code:'worker_path_scope_violation'}` and
   `task.terminalCause = handle.terminalCause` (`coordinator.mjs:13835-13837`). Cancelled tasks fold
   a `cancelCause` on transition (`coordination-store.mjs:8039-8049`).
9. **#79 delivery receipts read coordinator memory, not the store.** `_controlOperationalState`
   reads `this.driver.log.read` (`application.mjs:2768-2798`) — states `confirmed` / `refused` /
   `outcome_unknown`, codes `stale_fence` / `stale_after_provider_boundary` /
   `provider_boundary_observed`. Not store-durable at HEAD.
10. **#67 watchdog stall is coordinator memory, not the store.** `_mintStallDeclared` pushes into
    `this._attentionReasons` (`coordinator.mjs:9135-9152`); `watchdogConfig()` returns
    `{stallMs, basis:'no_progress_evidence', rearmKinds}` (`coordinator.mjs:9154-9161`);
    `REARM_KINDS` ACTUAL order = `approval.resolved,decision.settled,lifecycle.turn_started,
    question.answered` (`coordinator.mjs:71-75`). Not store-durable at HEAD.
11. **#148 credential death is observable but not written to any terminal record.** The cache state
    is `fresh` / `stale` / `expired_needs_login` (`claude-credential-cache.mjs:240-249`);
    `ensureFresh` throws `authentication_required` / `authentication_refresh_required`
    (`claude-credential-cache.mjs:252-261`); the 24h session TTL lives in
    `application-deployment.mjs:1758` — the #169 finding is "credential death written nowhere".
12. **The trust-gate maps to a closed gate enum, digests-only.** `worker_path_scope_violation` →
    gate `'scope'` (`application.mjs:959`, `coordinator.mjs:3919`); `pathScopeEvidence` is
    `{digests:{changedPathsDigest,inScopeChangedPathsDigest,outOfScopeChangedPathsDigest},
    counts:{changedPathCount,inScopeChangedPathCount,outOfScopeChangedPathCount}}` — digests +
    counts only, NEVER path strings (`application.mjs:968-978`, `coordinator.mjs:13506-13516`).
13. **Campaign evidence — the manual recoveries #182 names:**
    - trust-gate-killed impl member: phase `'failed'`, narrative `"Run terminated:
      worker_path_scope_violation."`, `resultSha: null`
      (`docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20/evidence-wave2.json`);
      "the trust gate killed the task AFTER the work committed"
      (`docs/reference/evidence/run-task-wave.mjs:106-110`).
    - suite-fold member: attempts a–c "died to the interpreter's spawn-window race"
      (`docs/reference/evidence/workflow-dsl-2026-08-13/suite-addendum-170-brief.md:3`); "died to
      the member-creation silence (#199/#200 — no `task.created`, no capacity reservation, a
      receipt claiming `failed` for a member that never existed)"
      (`docs/reference/evidence/workflow-dsl-2026-08-13/suite-addendum-notes.md:5-6`).
    - #169 drives: silent stale writer-lease recovery (`coordination-store.mjs:1319-1324`);
      credential death "written nowhere" (`application-deployment.mjs:1758`); capacity refusals
      "name nothing" (`worktree-capacity.mjs:399-402`); dead-owner reaps silent
      (`worktree-capacity.mjs:535-560, 307-330`)
      (`docs/reference/evidence/kernel-honesty-2026-08-13/kernel-honesty-audit.md`).
    - #182 itself: "why did that die is pin archaeology — no death certificates — 4 manual
      recoveries" (`reviews/baton-foundry-day-2026-08-13.html`).
14. **The replay-derived law (spec-referenced):** "a replayed run answers 'who stopped this member
    and why' from the log, never from process-scoped memory"
    (`docs/reference/evidence/dsh-comparison-2026-08-13/dsh-lifecycle.md`, C5/R6, lines 275-430).
    The certificate MUST derive from durable store projections; where an input is process-scoped at
    HEAD (#67, #79), the certificate degrades honestly or the input is made durable — it never
    fabricates.
15. **The evidence manifest is byte-bounded.** `MAX_RUN_VIEW_BYTES = 524288` (`limits.mjs:97`);
    `_buildEvidence` enforces the cap over the whole manifest (`application.mjs:5068`). The
    additive certificate block must respect the cap — bounded digests+counts (never path strings)
    keep it small (GT12 discipline).

## Decisions

### D1 — The certificate is a DERIVED projection, never a stored event
Computed on read from durable projections: the `run.inspect` view (GT3), the store task
`termination` block (GT8), the wave registry + `wave.closed` (GT7), the `cancelCause` fold (GT8),
and the credential state surface (GT11). No new store event kind, no store mutation, no clock.
Replay-byte-stability is the acceptance bar (A9). Caching the result as a durable store field is
explicitly rejected (OQ4) — a cache adds a write path and crosses into row-lc-ledger's store-field
territory for no honest gain.

### D2 — Additive surface on two existing verbs; NO new verb
(a) `run.inspect` single-run view (`application.mjs:7885-7970`) gains a `certificate` block
(`{suspicionClass, evidence}`) on a terminal phase, `certificate: null` on a non-terminal phase.
(b) `run.evidence` manifest (`_buildEvidence`, `application.mjs:5000-5060`, reachable only for
terminal runs — `application.mjs:5003`) gains an additive `certificate` block equal to the view's.
No command-table, MCP, or CLI churn; the surface-constant law (#114 W6,
`workflow-as-data-contract.md:203-207`, spec-referenced) is trivially preserved because no new
surface is added.

### D3 — Closed 7-class `suspicionClass` + first-match precedence
The closed set is EXACTLY `{provider_refusal, capacity_reap, watchdog_stall, wave_close_teardown,
credential_death, explicit_stop, clean_terminal}`. Evaluation order (first match wins):
`clean_terminal` → `explicit_stop` → `wave_close_teardown` → `credential_death` → `capacity_reap`
→ `watchdog_stall` → `provider_refusal`.
Rationale for the order: the first three answer the highest-authority question "who stopped it" from
precise durable records; the middle two are specific failure signatures; `provider_refusal` is the
honest catch-all. **Judgment call recorded:** trust-gate kills, `budget_exceeded`, and unmatched
`provider_failure` all fold into `provider_refusal` — the alternative (a per-code class expansion)
breaks the closed 7-set. A run with no cause at all and a clean terminal phase is `clean_terminal`,
never absent.

### D4 — Derivation reads durable projections only; honest degradation where an input is process-scoped
#67 stall (`coordinator.mjs:9135-9161`) and #79 delivery receipts (`application.mjs:2768-2798`)
are coordinator memory at HEAD (GT9, GT10). The certificate MUST NOT fabricate either.
- `watchdog_stall` is derived ONLY from a durable stall record at the terminal epoch; absent one,
  the run falls through to `provider_refusal` with evidence `watchdogUnproven: true` (A7).
- #79 delivery states are NOT consumed by the 7 classes in v1 — they are transport receipts, not
  terminal suspicion (OQ3 boundary recorded).

### D5 — `wave_close_teardown` vs `explicit_stop` is authority-class → DECISION_REQUEST
At HEAD the wave driver stops members through the SAME `stop()` path as operators
(`stopWaveMember` → `this.stop(request.runId, request.reason, principal, context)`,
`application.mjs:12006-12012` → `application.mjs:13456-13499`); the durable `run.stop_admitted`
record stores the issuing principal's actor but no driver/operator authority class
(`coordination-store.mjs:4660-4670`). The discrimination cannot be proven from the store at HEAD.
Options are set out in OQ1. The A5 pin is CONDITIONAL on that resolution.

### D6 — Trust-gate kills name the gate in `provider_refusal` evidence
The trust-gate-killed impl member (GT13) derives `provider_refusal` with evidence
`{code:'worker_path_scope_violation', gate:'scope', kind:'policy_failure',
pathScopeEvidence:{digests, counts}}` — digests+counts only, never path strings (GT12). **Judgment
call recorded:** a trust-gate kill is not a dispatch refusal, but `provider_refusal` is the correct
closed class (the provider's result was refused acceptance); a separate class would break the
closed 7-set.

### D7 — Derivation never throws; `certificate` is optional-shaped
A derivation failure yields `certificate: null` and reuses the existing `application_run_not_terminal`
boundary (`application.mjs:5003`) — NO new refusal code (refusal-vocabulary section). Non-terminal
runs carry `certificate: null` on the view and are refused on `run.evidence` as today.

## Refusal vocabulary

Existing, reused unchanged:

| Code | Where | Meaning |
|---|---|---|
| `application_run_not_terminal` | `application.mjs:5003` | `run.evidence` (and hence a certificate) requested for a non-terminal run — unchanged; the certificate is absent rather than fabricated |
| `application_command_unavailable` | `application.mjs:1848` (validator) | any external attempt to invoke a certificate "verb" — there is none; the existing command-refusal path is the whole answer |

New: **NONE.** This contract is additive on existing surfaces only; no refusal code is introduced
or amended. The "typed, named, surface-constant" invariant is preserved vacuously — a refusal is
only ever the pre-existing `application_run_not_terminal`, byte-stable across embedded/web/MCP/CLI
by the existing `application_` pass-through.

## Red-first acceptance pins

Each pin names the RED condition observed at HEAD `09200e9` and the GREEN condition for a CORRECT
impl only. Shallow-greenability is a defect: a pin that a wrong impl could pass is failed as drafted.

- **A1 — certificate surface existence (D2).** Red: `run.inspect` on a terminal run (e.g. a
  completed run) returns a view WITHOUT a `certificate` key (the view object at
  `application.mjs:7885-7970` has none), and the `run.evidence` manifest has no certificate block.
  Green: a terminal run's `run.inspect` view carries `certificate: {suspicionClass, evidence}`
  with top-level keys in ACTUAL sorted order `evidence,suspicionClass`; a NON-terminal run's view
  carries `certificate: null`; the `run.evidence` manifest (terminal-only, `application.mjs:5003`)
  carries an additive `certificate` block byte-equal to the view's (A9). A wrong impl that stamps a
  constant block on every view — including non-terminal — fails the non-terminal `null` leg.

- **A2 — clean_terminal (D3 rung 1).** Red: a completed run derives no class. Green: a run with
  view phase `completed` or `denied`, no durable runStop, no task `cancelCause`, and no
  terminalCause of kind `budget_exceeded`/`provider_failure`/`policy_failure`/`dispatch_refused`
  derives `suspicionClass: 'clean_terminal'` with evidence keys ACTUAL order
  `phase,runStop,terminalCause` (e.g. `{phase:'completed', runStop:null, terminalCause:null}`).
  Shallow-greenability guard: a `denied` run that carries a policy/provider terminalCause must NOT
  derive clean_terminal — it falls to provider_refusal.

- **A3 — explicit_stop (D3 rung 2).** Red: a stopped run carries no class. Green: a run whose view
  phase is `stopped` with a DURABLE runStop (view.stop.receipt present; `run.stop_admitted` minted,
  `coordination-store.mjs:8701`) and NOT a wave-close teardown (D5) derives `explicit_stop` with
  evidence `{reasonDigest, receiptDigest, state, targetCount, targetDigest}` (sorted keys). The
  receipt literal is pinned in ACTUAL order: `checks,context,counts,effects,receiptDigest,
  remainingCount,repoId,runId,schemaVersion,scope,state,targetCount,targetDigest`.
  Shallow-greenability guard: `operator_stop` from `projectTypedTerminalCause`
  (`application-semantics.mjs:2211`) alone is NOT sufficient — the runStop must be durable on the
  store, else the class cannot be replay-proven (A9).

- **A4 — capacity_reap (D3 rung 5).** Red: a dispatch-refused run carries no class. Green: a run
  whose typed terminal cause is `dispatch_refused` with code `worktree_capacity_exceeded` or
  `worktree_capacity_unavailable` (`DISPATCH_REFUSAL_GUIDANCE`,
  `application-semantics.mjs:2145-2164`) derives `capacity_reap` with evidence `{code,
  remediation}`; a cancelled task whose `cancelCause` folds a capacity/worktree reap
  (`coordination-store.mjs:8039-8049`) also derives capacity_reap. Shallow-greenability guard: a
  `dispatch_refused` run with ANY code outside the two capacity codes does NOT derive
  capacity_reap — it derives provider_refusal.

- **A5 — wave_close_teardown (D3 rung 3; CONDITIONAL on D5/OQ1).** Red: no class derives for a
  member stopped at wave close. Green (per the OQ1 resolution): a wave-member run whose terminal
  event is coincident with the member's `wave.closed` window (`coordination-store.mjs:8854-8868`)
  derives `wave_close_teardown` with evidence `{closeReason, memberRole, waveClosedAtEventSeq,
  waveId}` (sorted keys). Until the DECISION_REQUEST resolves, this pin is marked CONDITIONAL:
  the OQ1 Option B/C resolution (conservative fold into explicit_stop) makes the class unreachable
  and re-keys the pin under A3; the Option A resolution makes it reachable by actor. A wrong impl
  that discriminates on a guess — e.g. any member stopped in a closed wave is teardown regardless
  of stop authority — is a defect.

- **A6 — credential_death (D3 rung 4).** Red: a provider-failure authentication run carries no
  class. Green: a run whose terminalCause.kind is `provider_failure` with code
  `authentication_required` or `authentication_refresh_required` (`PROVIDER_TERMINAL_GUIDANCE`
  category `provider_authentication`, `application-semantics.mjs:2109-2134`) derives
  `credential_death` with evidence `{code, credentialState}` where credentialState ∈ `{fresh,
  stale, expired_needs_login}` (`claude-credential-cache.mjs:240-249`). Shallow-greenability guard:
  the credential state must be captured at the TERMINAL event epoch — from a durable terminal record
  or honestly `null` — never at read epoch; a fabricated `'expired_needs_login'` read at certificate
  time is a defect.

- **A7 — watchdog_stall (D3 rung 6; D4 degradation).** Red: a run whose worker stalled carries no
  class. Green: a run with a DURABLE stall_declared record (`basis:'no_progress_evidence'`, #67) at
  the terminal epoch derives `watchdog_stall` with evidence `{basis, mintEpoch, rearmKinds,
  stallMs, workerId}` (REARM_KINDS literal ACTUAL order `approval.resolved,decision.settled,
  lifecycle.turn_started,question.answered`). Shallow-greenability guard: because stall reasons are
  coordinator memory at HEAD (GT10), a run WITHOUT a durable stall record MUST NOT derive
  watchdog_stall — it degrades per D4 to provider_refusal with evidence `watchdogUnproven: true`.
  Two green paths: (a) #67 lifted to durable, or (b) honest degradation; fabrication is never green.

- **A8 — provider_refusal (D3 rung 7 catch-all; D6 trust-gate).** Red: the trust-gate-killed impl
  member (the phase93a2 witness: phase `'failed'`, narrative `"Run terminated:
  worker_path_scope_violation."`, `resultSha: null`) derives no class at HEAD. Green: that witness
  derives `provider_refusal` with evidence `{code:'worker_path_scope_violation', gate:'scope',
  kind:'policy_failure', pathScopeEvidence:{digests:{changedPathsDigest,inScopeChangedPathsDigest,
  outOfScopeChangedPathsDigest}, counts:{changedPathCount,inScopeChangedPathCount,
  outOfScopeChangedPathCount}}}` — digests+counts only, never path strings (GT12). Any terminal run
  not matched by rungs 1-6 (`budget_exceeded`, unmatched `provider_failure`, unmatched
  `dispatch_refused`, denied-with-policy-cause) derives `provider_refusal` with evidence
  `{code, kind}`. Shallow-greenability guard: a run that derives ANY other class must not ALSO emit
  provider_refusal — exactly one class per terminal run.

- **A9 — replay-derived byte-stability + surface-constancy (D1, D2).** Red: no derivation exists.
  Green: given a fixed store log, the certificate block is byte-identical (1) across a fresh-host
  replay over the same logDir (store close/reopen — the #132 F6 replay posture,
  `wave-observability-contract.md`, A2 F6 row) and (2) across the two surfaces (`run.inspect` view
  certificate === `run.evidence` manifest certificate, byte-equal JSON). Shallow-greenability guard:
  a certificate computed from `this._attentionReasons` or `this.driver.log` (process memory, GT9/GT10)
  fails the replay leg by construction — the replay host has no coordinator memory.

## Open questions

- **OQ1 — DECISION_REQUEST: `wave_close_teardown` vs `explicit_stop` authority discrimination (D5).**
  At HEAD the wave driver stops members through the SAME `stop()` path as operators
  (`application.mjs:12006-12012` → `13456-13499`); the durable `run.stop_admitted` record stores
  the issuing principal's actor but no driver/operator authority class
  (`coordination-store.mjs:4660-4670`). Options:
  - **Option A — actor-based:** discriminate on the stop admission's actor being the wave-driver
    principal → `wave_close_teardown`. Risk: the driver's actor identity is not a stable authority
    class today; a future operator-driven wave stop could misclassify.
  - **Option B — conservative fold:** never claim teardown; a wave member stopped at close derives
    `explicit_stop`; `wave_close_teardown` is an unreachable class until a driver-authority marker
    lands. Zero risk, but the class is dead in v1.
  - **Option C — durable marker:** extend the runStop admission with a driver-issued authority
    marker (new durable field, new schemaVersion) making the discrimination provable; until the
    field exists, both map to `explicit_stop` (Option B behavior). Highest cost (store schema
    change, crosses row-lc-ledger's boundary), most honest.
  **Recommendation:** Option C if the store change is acceptable, else Option B for v1. A5 is keyed
  to this resolution.
- **OQ2 — #67 stall durability lift.** A7 needs a durable stall record for replay-proof
  `watchdog_stall`. Is lifting the stall_declared attention reason onto the store (a new event kind
  or a durable projection) in scope for this package, or is honest degradation the v1 posture (D4)?
  The degradation path keeps the class reachable only for already-durable stall evidence.
- **OQ3 — #79 delivery receipts boundary.** The 7 classes do not consume delivery states
  (`confirmed`/`refused`/`outcome_unknown`); they are transport receipts, not terminal suspicion.
  Confirm this is the intended boundary — if a certificate should name delivery refusal, that is a
  NEW class (breaks the closed 7-set) or an evidence field on `provider_refusal`, not a rung.
- **OQ4 — cache vs compute.** The certificate is always-computed per D1 (byte-stability, A9).
  Caching it as a durable field on the store task record would cross into row-lc-ledger territory
  and add a write path; not recommended. Confirm.
- **OQ5 — clean_terminal for `denied`.** A `denied` run is clean only when it carries no
  terminalCause/policy failure (A2). Confirm denied-with-policy is rare enough to fold into
  `provider_refusal`, or whether `denied` deserves its own suspicion — the closed 7-set says no
  (judgment recorded in D3).

## Verification

- Citations above re-verified this session at `09200e97c1be113946459d901c8fab56034d8a1f`
  (`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs`; plain grep on the others).
- Sorted-key literals verified by node against the declared arrays: run-stop receipt fields v3,
  `wave.closed` closedShape, countFields/checkFields/effectFields, `APPLICATION_RUN_TERMINAL_PHASES`,
  `PROVIDER_EXECUTION_SETTLED_PHASES`, `REARM_KINDS`.
- `grep -an "certificate\|suspicionClass\|deathCertificate"` on all five core sources → zero hits
  (the RED baseline for every pin).
- Execution contract: executable `true`, args `[]`, working dir `.`, expected exit 0 — trivially
  satisfied by this document's creation; no destructive or push actions taken.
- Fold-record-ready pin list: A1 surface · A2 clean_terminal · A3 explicit_stop · A4 capacity_reap ·
  A5 wave_close_teardown (conditional) · A6 credential_death · A7 watchdog_stall (degradation guard) ·
  A8 provider_refusal (trust-gate gate-naming) · A9 replay byte-stability.
