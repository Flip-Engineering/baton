# CONTRACT-LEDGER v1 — the served-context ledger (#194 · #205)

[attempt: 0b60dbeb-913e-4a9c-a6ee-3329e8bd75f4 row-lc-ledger]
Package ③ (wave lifecycle), the LEDGER row. Gates its suite + impl.

Provenance and discipline: every citation below was re-read THIS session against HEAD
`dc476d87` (the effective-tree snapshot this worktree was provisioned from) with `sed -n` /
`grep -an` on `impl/src/coordination-store.mjs`, `impl/src/limits.mjs`,
`impl/src/application.mjs`, `impl/src/coordinator.mjs`, `impl/src/claude-session.mjs`,
`impl/src/adapter.mjs`, `impl/src/workflow-interpreter.mjs`. `coordination-store.mjs` is long-line
UTF-8 with 1 NUL byte — searched with `grep -a` and opened only at the cited ranges, never in
full; `application.mjs` is NUL-bearing binary, opened only at the cited ranges. The store event
kind set was enumerated by `grep -ao "_append('[a-z0-9._]*'"` over the whole file. No clocks in
any pin; sorted-key literals in ACTUAL source order.

**Recorded judgment calls (two):**
1. **Deliverable path.** The row brief's deliverable line says
   `redrive3/contract-ledger.md` (stale boilerplate copied forward — the identical
   `redrive3/contract-*.md` line appears in the redrive3/4/5 briefs of every row); the v21 wavefile
   pins this member's scope and report to `redrive6/**` / `redrive6/contract-ledger.md` (the
   deployment constraint likewise says work only within `redrive6/**`), and the redrive-6
   filesystem row already recorded the governing rule for the identical conflict ("The wavefile
   governs; the deliverable is THIS file", `redrive6/contract-filesystem.md` judgment call #2).
   The wavefile governs; the deliverable is THIS file.
2. **Anchor drift at HEAD.** No prior redrive ever landed a ledger contract (the redrive-6 QA at
   `redrive6/contract-qa.md` records "contract-ledger.md — ABSENT (never landed in any redrive)").
   There are therefore no stale anchors to re-anchor; every citation in this contract was taken
   fresh at HEAD `dc476d87`. Where the QA's seed anchors agree, this contract cites the same
   lines (`coordination-store.mjs:124` `_spills`, `:3574-3583` decision FRAME_LIMITS,
   `:13661-13670` spill mint).

---

## 1. Ground truths (cited)

**G1 — the coordination store's durable kind set is closed at 96 kinds, and NOT ONE is a
`decision.*` event.** Enumerated this session: `grep -ao "_append('[a-z0-9._]*'"`
over `impl/src/coordination-store.mjs` → 96 unique kinds (sorted list in the Appendix), spanning
`artifact.*`, `authority.*`, `board.*`, `context.*`, `driver.recorded`, `evidence.mapped`,
`goal.version_defined`, `knowledge.*`, `mcp.*`, `plan.*`, `provider.*`, `recovery.*`,
`repl.*`, `run.*`, `scratch.*`, `scratchpad.*`, `spill.minted`, `task.*`, `wave.closed`,
`web.*`, `worker.generation_bound`, and `reuse.decision_request_bound` — the last being the
KNOWLEDGE-reuse lane (minted by `recordReuseDecision` → `knowledge.reuse_decided`,
`coordination-store.mjs:13159-13180`), a different lane from the session/coordinator DECISION_REQUEST
round-trip this contract owns. The `decision.*` tokens that DO appear in the file are field paths
(`decision.node`, `decision.dossier`, `decision.subject`, …) and the FRAME_LIMITS lane names
(`decision.need`, `decision.rationale`, …) — none is an appended kind.

**G2 — the decision lane round-trips end-to-end at the session, coordinator, and steering
layers, and its ONLY durable store traces are task transitions and refusals.** The round-trip,
verified at HEAD:
- **Mint** — `scanForDecisionRequest` (`impl/src/claude-session.mjs:77-79`, grammar
  `DECISION_REQUEST_GRAMMAR` :26-27) parses worker prose inside `_writeUserFrame`;
  `this._emit(session, 'decision.requested', {requestId, request})` at :1135-1142, guarded
  one-live by `!session.pendingDecisionRequestId`.
- **Admission** — `coordinator.mjs:13316-13421` `case 'decision.requested'`: closed-shape
  `createDecisionRequest` first (malformed → typed `authority.rejected` with coaching
  `{cap, actual, unit, gracefulPath}`, :13337-13349), drain/dedup/already-pending refusals
  (:13358-13406), then the in-memory `_pending` record + `_coordTransition(task,
  'input_required', …)` at :13414.
- **Answer** — `answer()` (`claude-session.mjs:1463-1481`) delivers a `DECISION_ANSWER:` plain
  user-turn continuation, always flagged `emulated: true` (:1480), pending cleared :1476.
- **Settle** — `coordinator.mjs:13423-13437` `case 'decision.settled'`: operational
  `appendAttributed` + `_coordTransition(task, 'working', …)` when the task sat `input_required`.
- **Steering** — `answerDecision` (`workflow-interpreter.mjs:1055-1100`) with outcomes
  `deferred`/`denied`/`answered`/`refused`, recorded ONLY in the steering trail
  (`s.handledDecisionKeys` / `s.deniedDecisionKeys` / `steering.push`) plus the D1.3 one-shot
  `deniedDecisionKeys` guard — never in the store.

**G3 — the lane's settlement is not even digest-mapped: `decision.settled` is a REARM kind but
NOT an operational kind.** `REARM_KINDS` is the closed four (`approval.resolved`,
`decision.settled`, `lifecycle.turn_started`, `question.answered`, `coordinator.mjs:71-76`), but
`RUN_TIMELINE_OPERATIONAL_KINDS` (`:52-65` — the allowlist that earns an `evidence.mapped` digest
reference, `_coordMapEvent` :8545-8555, mapped only when `RUN_TIMELINE_OPERATIONAL_KINDS.has(kind)`
:1157) contains NEITHER `decision.settled` NOR `decision.requested` NOR `approval.resolved` NOR
`question.answered`. The decision lane's question/options/answer/choice content lives ONLY in the
operational log (`decision.requested` / `DECISION_ANSWER` frames); the store's only durable
records of the round-trip are `task.transitioned` (input_required → working, `_coordTransition`
:8519-8535) and, on the refusal paths, `authority.rejected`/`driver.recorded`
(:13303-13306/:13275-13281). This is the #205 ledger gap in its strongest form: a full
round-trip that answers a DECISION_REQUEST leaves zero `decision.*` events.

**G4 — the durable no-step turn does not exist.** `grep -ran "turn_attempted\|no_step\|noStep\|no-step\|no_turn"`
across `impl/src/` returns zero matches for any no-step record; the only `pending_empty` hits
(`workflow-interpreter.mjs:643/:828/:1010`) are the driveLane quiescence EXIT default — a WAVE
terminality vocabulary (#163), not a member turn record. `lifecycle.turn_started` IS emitted
(`claude-session.mjs:894` on `beginsTurn`; `coordinator.mjs:2524` on nudge admission; the
adapter's turn loop at `adapter.mjs:632`), and `lifecycle.turn_completed` closes a turn that ran
— but nothing records the ATTEMPT that produced no step. A rejected/empty first response and a
never-started worker are observationally identical to the log; the #67 watchdog's re-arm set
(`REARM_KINDS`) sees neither as progress evidence. This is the #194 gap, exactly as the dsh
comparison framed it (`docs/reference/evidence/dsh-comparison-2026-08-13/dsh-lifecycle.md`
C3:228-233: "the *attempt* itself — 'a turn boundary was opened and no step was entered' — is
not a first-class durable event").

**G5 — the spill lane is content-addressed, replay-derived, and the store-resident
reconstruction substrate for oversize served contexts.** `mintSpill`
(`coordination-store.mjs:13643-13676`): sha256 of the body's UTF-8 bytes → `spillId =
spill:sha256:<digest>`; the 1 MiB ceiling is `FRAME_LIMITS['spill.body'].value`
(`impl/src/limits.mjs:86`, enforcedAt `'coordination-store.mintSpill / admission spill seam'`,
refusal `spill_body_exceeded`); idempotent by auth key AND by content (same body → same
spillId, no new event); `_append('spill.minted', payload, auth)` at :13674, replay-derived into
`this._spills` at :8885-8892 (field declared :124, allocated :1232). `materializeSpill(spillId)`
(:13678-13682) reads the body back.

**G6 — the model-visible served context is the run OBJECTIVE, admitted gracefully and
reconstructable by citation.** `run.objective` is a graceful admission lane (limits.mjs:56: 4096
bytes, `graceful: 'spill-digest-citation'`). At `application.mjs:4519-4541` an oversize objective
(up to the spill ceiling) mints a spill and stores a bounded head + a `[SPILLED {citation}]`
suffix naming `{spilled, bytes, digest, spill}` (:4538-4539); the goal record stores that as
`objective: request.objective` (`coordination-store.mjs:10783-10791`, `goal.version_defined`).
For a wave member the served context is the RENDERED objective — `renderObjective`
(`workflow-interpreter.mjs:340-355`) prepends `[attempt: <salt> <role>] ` to the `objectiveRef`
brief (64KB bound `OBJECTIVE_REF_MAX_BYTES` :46, escape guard, oversize → typed
`objectiveRefInvalid`, never served) — and the rendered objective flows into the run the member
is started with (`application.mjs:11775-11824` `startWave`; rendered member objectives at
`workflow-interpreter.mjs:577-588`). So the served-context chain holds at HEAD for the objective
seam: goal record (bounded head + citation) → `materializeSpill` (full body). What does NOT
exist at HEAD is any GUARD that the citation resolves: a dangling `spillId` in the `[SPILLED
{citation}]` suffix would be served silently.

**G7 — the wave record carries the roster, not the served contexts.** `wave.started` is a
`recordDriver` row `{waveId, deploymentId, roster, idempotencyKey}`
(`application.mjs:4682-4691`) — no member objectives, no objectiveRef bodies. Served contexts are
reconstructable per-RUN via the goal record (G6), not from a wave-level record; the roster is the
run inventory, the goal records are the served-context ledger.

**G8 — the decision lane's content size boundaries already exist and are closed.**
`decision.question` 2048, `decision.need` 2048, `decision.rationale` 8192,
`decision.option.label` 160, `decision.option.summary` 512, `decision.text` 4096 — all
`graceful: null`, `limits.mjs:59-70` — enforced at `messages.createDecisionRequest` /
`coordination-store.recordReuseDecision` (the coaching `coachingRefusal` seam at
`coordination-store.mjs:3574-3583`). This contract FREEZES these; it introduces no new
decision-lane size code.

---

## 2. Decisions (D-numbered; judgment calls recorded)

**D1 — the durable no-step turn (#194, adopting the dsh C3 landing zone verbatim).** A new
ADDITIVE operational-log kind `lifecycle.turn_attempted` with the worker/turn identity
(`{worker, harness, turnEpoch, actor, payload:{empty: true|refused: true, turnBoundary}}`),
emitted on the adapter's turn-boundary observation when a turn is opened and NO step starts —
the explicit empty/refused acknowledgement after an admitted spawn (the C3 wording: "an
attempted no-step turn is not the same as no turn at all"). `REARM_KINDS` is UNCHANGED: a
`turn_attempted` record is NOT progress evidence and does not re-arm the #67 watchdog (the
closed four, `coordinator.mjs:71-76`, remain the only re-arm kinds). The run view's
waitingOn/attention projection consumes the record as a distinct honest state. Additive-only;
no existing kind, re-arm, or admission path changes.

**D2 — model-visible-means-logged is an asserted, guarded invariant (#194).** The exact served
context of any member — the rendered objective, salt line included — MUST be reconstructable
from the coordination store via the cited spill artifact, never bodies-inline (limits.mjs keeps
bodies out of the store wherever a graceful lane applies). The reconstruction chain is G6; the
contract makes it a SERVING-SEAM GUARD: whenever a served context is admitted oversize, the
goal record MUST carry the `[SPILLED {citation}]` suffix naming a `spillId`, and a serving seam
that encounters a citation it cannot resolve (a dangling `spillId` — no `spill.minted` in the
store's replay) MUST refuse typed rather than serve an unreconstructable context. The existing
spill mechanics (G5/G6) are PRESERVED untouched — this decision adds the guard and the
assertion, not new spill machinery.

**D3 — the decision lane ledgers its round-trip (#205).** A new durable store kind
`decision.ledged` is minted when a pending decision settles (the `decision.settled` handling at
`coordinator.mjs:13423-13437`), carrying DIGEST REFERENCES to the operational-log content, never
bodies-inline: `{requestId, worker, questionDigest, answerDigest, optionId, steeringOutcome,
consumer}`. `questionDigest` resolves to the `decision.requested` operational event's question
content; `answerDigest` resolves to the `DECISION_ANSWER` delivery; `steeringOutcome` is the
`answerDecision` trail's outcome (`deferred`/`denied`/`answered`/`refused`,
`workflow-interpreter.mjs:1055-1100`) where available. The lane's bodies stay in the operational
log; the store record names them by digest so the round-trip is reconstructable from the store
WITHOUT inlining bodies. This is the only new store kind this contract adds.

**D4 — additive-only boundary posture; every existing surface is frozen.** The 96-kind store set
gains EXACTLY `decision.ledged`; the operational log gains EXACTLY `lifecycle.turn_attempted`;
`REARM_KINDS`, `RUN_TIMELINE_OPERATIONAL_KINDS`, the decision FRAME_LIMITS rows (G8), the spill
lane (G5), the steering-trail outcomes, the receipt keys, and the #163 verdict enum are all
unchanged. Cross-row: the served-context reconstructability is the ledger half of the
`spill-digest-citation` lane (launch row #207 owns advertisement/admission; this contract owns
reconstruction), and the `decision.ledged` record's `steeringOutcome` reads the launch row's
steering trail rather than duplicating it. No new receipt key; the store is the durable truth
lane (the fs row's D6 posture, adopted).

---

## 3. Refusal vocabulary (closed, typed, surface-constant)

New codes — this is the COMPLETE set added by this contract; once shipped they never rename
(surface-constant), and payloads are sorted-key literals:

| Code | Site | Payload | Next-action coached |
|---|---|---|---|
| `no_step_turn_unrecorded` | the no-step turn observer (D1) when a turn boundary with no step is observed but the `lifecycle.turn_attempted` append cannot carry the turn identity | `{turnEpoch, worker}` | name the turn identity; the attempt must be recorded — an empty member is not a dead member |
| `decision_lane_unledgered` | the `decision.settled` ledger mint (D3) when the durable `decision.ledged` record cannot be written | `{requestId, worker}` | the lane must leave a store-visible record; the round-trip is not ledgered until it does |
| `spill_citation_dangling` | the serving-seam reconstruction guard (D2) when a cited `spillId` does not resolve in the store's replay | `{citation, spillId, servedLane}` | name the dangling citation; do not serve an unreconstructable context |

Existing surfaces this contract FREEZES unchanged (boundary agreement, not redefinition): the
decision FRAME_LIMITS refusal codes (`decision_question_exceeded`, `decision_need_exceeded`,
`decision_rationale_exceeded`, `decision_option_label_exceeded`, `decision_option_summary_exceeded`,
`decision_text_exceeded`), the spill family (`spill_invalid`, `spill_conflict`,
`spill_body_exceeded`), `operational_log_unavailable` (the authoritative-log poisoning,
`coordinator.mjs:1128-1165`), and `scratchpad_write_invalid` (the actor gate, §6).

---

## 4. Red-first acceptance pins

Each pin names its stage, is RED at HEAD (verified against the cited HEAD behavior this
session), and is written so a wrong or shallow impl cannot go green. Fixture discipline: real
runs through the session/coordinator/adapter layers, no clocks, no mocking of the store.

**L-P1 — the no-step turn is recorded as a durable, distinct kind.** Stage: turn-boundary
observation (adapter turn loop / coordinator admission). Fixture: an admitted member whose first
response is an explicit empty/refused acknowledgement — a turn boundary with ZERO steps entered.
Assert: (a) a `lifecycle.turn_attempted` record exists carrying `{worker, turnEpoch}`; (b) it is
a distinct kind, NOT a re-tagged `lifecycle.turn_started`. RED at HEAD — no `turn_attempted`
kind exists anywhere in `impl/src/` (G4, grep zero matches), so (a) fails outright. Anti-shallow:
(b) blocks the lazy impl that reuses `turn_started` with a flag; the honest distinct kind is
required. Control side (same pin): a NEVER-started member (pure silence after spawn) produces NO
`turn_attempted` — silence stays silence (the #174 law) — blocking an always-record impl.

**L-P2 — the no-step record does NOT re-arm the #67 watchdog.** Stage: watchdog re-arm gate.
Assert: after the L-P1 recording, `REARM_KINDS` is exactly the closed four (`approval.resolved`,
`decision.settled`, `lifecycle.turn_started`, `question.answered`, `coordinator.mjs:71-76`) and
the `turn_attempted` record did NOT re-arm a re-armed-down worker. RED at HEAD — no record
exists at all, but the CONTROL is the point: an impl that adds `turn_attempted` to `REARM_KINDS`
fails this pin, because the #67 evidence gate must stay untouched (C3's "the closed four, GT-B1,
remain"). L-P1 and L-P2 must both pass — a green L-P1 with a re-arm side effect is still wrong.

**L-P3 — the served context is reconstructable AND the reconstruction is guarded.** Stage: run
objective admission (`application.mjs:4519-4541`) + goal record (`coordination-store.mjs:10783-10791`)
+ serving seam. Fixture: drive a run whose objective is over 4096 bytes (under the 1 MiB spill
ceiling) to a member. Assert: (a) the goal record's `objective` ends with the `[SPILLED
{citation}]` suffix naming `{spilled, bytes, digest, spill}`; (b) `materializeSpill(spillId)`
returns the FULL original objective bytes (the exact served context, salt line included);
(c) NEW GUARD — a serving seam presented with a `[SPILLED {citation}]` whose `spillId` has no
`spill.minted` in the store's replay refuses `spill_citation_dangling` instead of serving the
bounded head. RED at HEAD — (a)/(b) pass (the machinery is real, G5/G6 — this pin does not
pretend otherwise), but (c) FAILS: no reconstruction guard exists, so a dangling citation is
served silently. Anti-shallow: (c) blocks an impl that "satisfies" #194 by deleting the spill
path or by serving bodies-inline; (a)/(b) block an impl that breaks the existing graceful seam
to make (c) trivially green.

**L-P4 — the decision lane ledgers: a full round-trip leaves a `decision.ledged` record.**
Stage: `decision.settled` (`coordinator.mjs:13423-13437`). Fixture: drive a DECISION_REQUEST
round-trip to settlement — mint (`claude-session.mjs:1135-1142`), admission
(`coordinator.mjs:13316-13421`), `answerDecision` (`workflow-interpreter.mjs:1055-1100`), settle
(`coordinator.mjs:13423-13437`). Assert: (a) exactly one `decision.ledged` store event exists
for the requestId; (b) it carries `{requestId, worker, questionDigest, answerDigest, optionId,
steeringOutcome}`; (c) the round-trip's `decision.requested` operational event and the
`DECISION_ANSWER` delivery still exist in the operational log. RED at HEAD — the round-trip
completes (G2) but the store has zero `decision.*` events (G1/G3), so (a) fails outright. This
is the #205 acceptance in its sharpest form: the lane's answered round-trip leaves NO record
today (the lane-proof wave's answered DECISION_REQUEST left no trace).

**L-P5 — the ledger record is digest-ref only, never bodies-inline (the anti-shallow-green
control for L-P4).** Same fixture. Assert: (a) the `decision.ledged` record contains NO
`question`/`answer`/`options` body strings — only the digest references named in D3;
(b) the store's event kind set gains EXACTLY one kind (`decision.ledged`) — the count moves
96 → 97 and no other new kind appears; (c) `REARM_KINDS` and `RUN_TIMELINE_OPERATIONAL_KINDS`
are byte-identical to HEAD. RED at HEAD — no `decision.ledged` exists at all, so (a)-(c) all
fail; the control blocks an impl that "ledgers" by pasting the question/answer bodies into a
store event, or that adds extra kinds, or that quietly adds `decision.settled` to the
operational allowlist to earn an `evidence.mapped`.

---

## 5. Open questions

1. **No-step detection boundary (#194):** "a turn boundary with no step" is adapter-dependent —
   the adapter's turn loop emits `lifecycle.turn_started` at `adapter.mjs:632` and then iterates
   edits; an empty edit set is the natural no-step signal for MockAdapter, but the native
   adapters differ. Confirm the exact turn-boundary signal each adapter reports before the
   observer's `empty`/`refused` classification is frozen.
2. **`turnEpoch` availability at the observation site (#194):** the coordinator's turn identity
   is `stamp.turnEpoch` (`coordinator.mjs:2524`). Confirm it is reachable from the adapter's
   turn-boundary observation (or that the observer carries its own per-worker turn counter whose
   identity contract is documented).
3. **`answerDigest` resolution (#205):** the `DECISION_ANSWER` is delivered as a plain user-turn
   continuation inside `answer()` (`claude-session.mjs:1463-1481`, always `emulated: true`).
   Which operational-log event carries the ANSWER bytes so `answerDigest` resolves — a
   `content.message`, a `lifecycle.turn_completed` frame, or the session's own frame log?
   Decide at impl time; the digest must name a REAL resolvable occurrence.
4. **Cross-store reconstruction (#194):** a cited `spillId` resolves in the store whose replay
   saw the `spill.minted` event. Does "reconstructable from the coordination store" mean from
   the SAME store instance, or from ANY store replayed from the same event log? Lean: same event
   log (the replay at `coordination-store.mjs:8885-8892` is deterministic); the D2 guard should
   state which so the `spill_citation_dangling` refusal is not minted on legitimate
   cross-instance reads.
5. **`steeringOutcome` when the wave settles un-steered (#205):** `answerDecision` records
   `deferred`/`denied`/`answered`/`refused` only when the drive loop reaches the decision
   (`workflow-interpreter.mjs:1055-1100`). A pending decision still open at wave settle has no
   trail entry — does `decision.ledged` carry `steeringOutcome: null` (truthful) or is it minted
   only when a steering outcome exists? Lean: truthful null; the record is the round-trip's
   ledger, not the policy's verdict.

---

## 6. Publish to `shared` — the refusal, recorded (#158 law)

Instructed to publish to `shared` on completion. The shared-scope publish surface is gapped at
HEAD `dc476d87` and the gap has CHANGED SHAPE since the redrive-3 checkpoint (which recorded a
silent admission): `writeScratchpad` now REFUSES a non-worker actor at the gate —
`auth?.actor !== 'worker' || auth?.principalId !== fields?.workerId` →
`scratchpad_write_invalid` (`coordination-store.mjs:14240-14242`) — so a member publish does not
silently admit; it is typed-refused. Below that gate the scope is STILL hardcoded to the worker
partition: `const scope = \`worker:${fields.workerId}\`` (:14279). No write path mints a
`shared` scope; the only shared-scope settlement path is orchestrator-actor-only (:12594). Net:
there is no `shared` write lane; a member publish is refused at the actor gate and a worker
publish lands in `worker:<id>`. This contract is therefore published ON DISK (here) and the
refusal is recorded verbatim above for the fold to carry; fabricating a shared-scope publish was
not an option.

---

## Appendix — anchor verification record

Every citation re-grepped this session (`grep -an`/`sed -n`, exact-line confirmation; the store
searched with `grep -a` for its NUL/UTF-8 payload) against HEAD `dc476d87` (this worktree).
Confirmed exact:
- **`coordination-store.mjs`** — `_spills` field declared :124, allocated :1232; decision
  FRAME_LIMITS coaching seam :3574-3583; `spill.minted` replay :8885-8892; `mapOperationalEvent`
  :12792-12810 (`evidence.mapped` carries `{worker, workerSeq, digest, kind, ts}`, integrity
  check `evidence_mismatch`); `recordReuseDecision` → `knowledge.reuse_decided` :13159-13180;
  `recordDriver` → `driver.recorded` :13275-13281; `recordAuthorityRejected` → `authority.rejected`
  :13303-13306; `mintSpill` :13643-13676 (digest :13668, 1 MiB ceiling :13658, `spill.minted`
  append :13674); `materializeSpill` :13678-13682; goal record `goal.version_defined` storing
  `objective: request.objective` :10783-10791; `writeScratchpad` actor gate :14240-14242, scope
  hardcode :14279; shared-scope settlement orchestrator gate :12594. Event kind set enumerated:
  `grep -ao "_append('[a-z0-9._]*'"` → 96 unique kinds, zero `decision.*` (sorted set:
  artifact.registered, artifact.superseded, authority.rejected, board.claim_expired,
  board.claim_migrated, board.claim_requested, board.grant_minted, board.grant_revoked,
  board.item_posted, board.report_submitted, context.call_admitted, context.call_settled,
  context.cell_admitted, context.cell_settled, context.pack_granted, context.pack_minted,
  context.read, context.session_admitted, driver.recorded, evidence.mapped,
  fleet.drain_admitted, fleet.drain_completed, fleet.drain_disposition_recorded,
  goal.version_defined, knowledge.contradiction_resolved, knowledge.edge_added,
  knowledge.node_added, knowledge.promoted, knowledge.promotion_batch, knowledge.read,
  knowledge.recall, knowledge.recall_assessment_batch, knowledge.representation_produced,
  knowledge.representation_request_bound, knowledge.reuse_decided,
  knowledge.reuse_policy_reconciled, knowledge.reuse_provider_guarded,
  knowledge.reuse_risk_guarded, knowledge.reuse_ttl_invalidated, knowledge.scratch_corrected,
  knowledge.workflow_admitted, mcp.audit, mcp.call_admitted, mcp.call_completed,
  mcp.call_failed, orientation.rating_recorded, package.attached, plan.approval_decided,
  plan.node_budget_settled, plan.task_evidence_linked, plan.version_proposed,
  provider.delivery_received, provider.processing_checked, provider.processing_deferred,
  provider.reconciliation_completed, recovery.attempt_admitted, recovery.attempt_completed,
  repl.binding_dropped, repl.binding_set, repl.manifest_admitted, reuse.decision_request_bound,
  run.control_admitted, run.control_effect_started, run.control_provider_acked,
  run.control_settled, run.lineage_admitted, run.orchestrator_lease_issued,
  run.orchestrator_lease_revoked, run.result_adoption_admitted, run.result_adoption_completed,
  run.result_export_admitted, run.result_export_completed, run.sealed, run.stop_admitted,
  run.stop_completed, run.verification_retry_admitted, scratch.claim_expired, scratch.claimed,
  scratch.fact_expired, scratch.fact_posted, scratch.read, scratchpad.entry_appended,
  scratchpad.entry_written, spill.minted, task.acceptance_revoked, task.claimed, task.created,
  task.dispatch_deferred, task.resources_released, task.transitioned, wave.closed, web.audit,
  web.command_admitted, web.command_completed, web.command_failed, worker.generation_bound).
- **`limits.mjs`** — `run.objective` :56 (4096, graceful spill-digest-citation,
  `spill_body_exceeded`), `wave.member.objective` :57 (4096), `spill.body` :86 (1048576,
  enforcedAt mintSpill / admission spill seam), decision rows :59-70.
- **`application.mjs`** — run.objective graceful spill :4519-4541 (mint :4531, bounded head +
  `[SPILLED {citation}]` suffix :4538-4539), `storedObjective` :4597-4608, `wave.started`
  recordDriver :4682-4691, `startWave` :11775-11824.
- **`coordinator.mjs`** — `RUN_TIMELINE_OPERATIONAL_KINDS` :52-65 (no `decision.*`,
  `approval.resolved`, or `question.answered`), `REARM_KINDS` :71-76, `_log.append` proxy
  :1128-1165 (`evidence.mapped` gate :1157), `_coordMapEvent` :8545-8555, `_coordTransition`
  :8519-8535, decision admission :13316-13421 (malformed coaching :13337-13349, drain :13358-13366,
  duplicate :13374-13382, already-pending :13398-13406, `input_required` :13414), `decision.settled`
  :13423-13437.
- **`claude-session.mjs`** — `DECISION_REQUEST_GRAMMAR` :26-27, `scanForDecisionRequest` :77-79,
  `decision.requested` mint :1135-1142 (one-live guard), `answer` :1463-1481 (`DECISION_ANSWER`
  delivery :1480, `emulated: true`), `lifecycle.turn_started` :894.
- **`workflow-interpreter.mjs`** — `OBJECTIVE_REF_MAX_BYTES` :46 (64KB), `renderObjective`
  :340-355, rendered member objectives :577-588, driveLane quiescence exits (`pending_empty`)
  :643/:828/:1010, `answerDecision` :1055-1100.
- **`adapter.mjs`** — turn loop `lifecycle.turn_started` :632, turn-boundary block :625-645,
  MockAdapter emulated decision emit :643-648.
- **`docs/reference/evidence/dsh-comparison-2026-08-13/`** — `landing-note.md` (adoption ①:
  model-visible-means-logged, reconstructable via the cited spill artifact, never bodies-inline;
  the durable no-step turn), `dsh-lifecycle.md` C3 (no-step turn landing, :222-250).
- **`docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive6/contract-qa.md`** —
  ledger ABSENT verdict, #194/#205 seed anchors, shared-publish refusal shape.

No anchor drift was found (this contract was written fresh at HEAD; no prior ledger text exists
to re-anchor — judgment call #2). The `writeScratchpad` lines cited here (:14240-14242/:14279/
:12594) supersede the redrive-3 launch row's older citations (:14169/:12559) which the QA
flagged as stale at this HEAD.
