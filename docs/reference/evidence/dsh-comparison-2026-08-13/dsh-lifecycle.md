# dsh-lifecycle — DeepSeek Harness's live-agent layer (turns, injection, interruption, scoping) vs baton's member lanes

[attempt: f793be9c-e387-469d-9847-9cd3f4299d0f row-dsh-lifecycle]

Row deliverable for the DSH-COMPARISON foundry (wave `dsh-comparison-2026-08-13-wave-a`). Verdicts
are per-candidate ADOPT / ADAPT / REJECT / ALREADY-HAVE with a named baton landing zone, per the
shared laws. The baton side of every candidate is grounded in this session's verified reads of
`impl/src/coordinator.mjs`, `impl/src/coordination-store.mjs`, `impl/src/application.mjs`,
`impl/src/limits.mjs`, the landed #79 delivery-push contract, the #71 orchestrator-wake contract,
the #74 comm-topology audit, and the lane-proof wave's evidence. The dsh side is grounded in the
dated `dsh-digest/` package (pulled 2026-08-13; the repo itself warns compatibility-breaking
changes land constantly, so every mechanism is cited to the digest, not to a moving upstream).

---

## Scope and method

This row covers the **live-agent layer**: how a single agent is born, turns, is injected with
context, is interrupted, scopes its own registrations, and recovers from error — and which of
those mechanisms baton should take, reshape, refuse, or already has.

### Laws binding this row (the standing vetoes + the single-agent trap)

These are laws, not preferences; every verdict below is checked against all six. A verdict that
violates one is out, regardless of the dsh affordance.

- **LAW-1 — No wall-clock controls.** dsh's turn/step log and baton's coordinator are both
  event/seq-based; nothing below introduces a clock.
- **LAW-2 — Honesty over comfort.** A surface that can lie is worse than none; every verdict prefers
  the receipted, replay-derived truth. A refused/empty interaction must be recorded as such, never
  conflated with silence.
- **LAW-3 — Machine channels stay sterile.** Worker-facing payloads are framed UNTRUSTED at the
  delivery seam; no new trusted path is minted; coordinator-authoritative facts are never
  worker-authored.
- **LAW-4 — Additive-only on closed vocabularies.** No closed kind/set is amended; new behavior
  adds rows. `REARM_KINDS`, the frame literals, and the phase literals stay pinned.
- **LAW-5 — No per-worker heaviness.** A mechanism that costs per-agent bookkeeping across a swarm
  is rejected or pushed to the coordinator side. The coordinator composes everything a member sees;
  a member never mints capability for itself.
- **LAW-6 — The single-agent trap.** dsh's primitives are single-agent-centric; **the multi-agent
  primitive is the WAVE.** Every candidate is evaluated for what it means across N members in
  fenced worktrees — run-scoped, coordinator-composed, receipted — never as a per-agent
  mechanism. A candidate that only makes sense inside one agent object is rejected or reshaped into
  a run-scoped lane (the C7 evidence below binds every verdict).

## Ground truths (verified this session)

### dsh side

- **GT-D1 — A turn is zero or more steps; a step is one model request plus its tools.** The
  turn-flow diagram opens `turn/start` before the first input is claimed and closes
  `turn/end` once nothing is owed. `agent/pre-step` is the authoritative gate between the claim
  and the step: `reject | enter(messages)`; "a rejected or empty first claim still closes a durable
  turn that spent no step, so the log records the attempt." (dsh-digest/architecture.md:65-88,
  :71, :88; dsh-digest/agent-lifecycle.md:28-31)
- **GT-D2 — Input reaches the driver through ONE inbox; waking and non-waking delivery are
  distinct.** "Some messages wake it immediately; injected context waits in the inbox until
  another message does." (dsh-digest/architecture.md:86) The `Agent` handle exposes `send(message,
  target, wakeup)`, `followup`, `steer`, and `inject` as fixed-preset aliases over one delivery
  vocabulary with two inbox boundaries (`next-turn` | `next-step`). (dsh-digest/subsystems/core.md:55,
  :114-140, :171-178)
- **GT-D3 — `agent.inject()` queues model-facing context for the next pre-step WITHOUT waking the
  driver.** It may miss a request whose pre-step already claimed its batch; idle drivers leave it
  pending until follow-up or steering wakes them; cancellation or disposal may discard it.
  (dsh-digest/subsystems/core.md:132-140) It lands as a `user/message` with a non-`user` `source`,
  projected verbatim into derived history. (dsh-digest/subsystems/session.md:49-55, :528)
- **GT-D4 — "Model-visible means logged."** Anything that reaches a model request must be
  reconstructable from the session log; a runtime invariant asserts it, so a new model-visible
  input requires a new `SessionEventMap` row rendered from the log. (dsh-digest/architecture.md:96)
- **GT-D5 — The agent handle separates cancellation, quiescence, and maintenance.** `cancel(cause,
  {keepInbox})` with a stable caller cause (user | parent | hook | disposed), first cause wins, a
  no-op with no active activity; `whenIdle()` resolves after whole-agent quiescence;
  `runMaintenance(task, signal)` runs one non-turn task from the idle phase. Durable `turn/end`
  retains only the coarse `{kind:'aborted'}` outcome; recording who cancelled would need a separate
  durable event. (dsh-digest/subsystems/core.md:82-101, :180-203)
- **GT-D6 — Recovery is a waterfall, not a kill.** `agent/request-error` runs after a failed model
  step closes and before its turn closes; a listener returns `{kind:'retry'}` to repair, and the
  default leaves the failure terminal. `agent/pre-step` is the only serial listener chain before
  request derivation. (dsh-digest/subsystems/core.md:228-235)
- **GT-D7 — Per-agent scoping is an identity-keyed registration layer.** `agent.ctx` is
  "agent-scoped context; its contributions are agent-local, unwind on disposal, and reject
  registration afterward" (dsh-digest/subsystems/core.md:72-73). The scope package keys `ScopeKey`
  to an opaque object identity and pairs one registration context with two teardown paths.
  (dsh-digest/subsystems/scope.md:9-43)

### baton side

- **GT-B1 — Baton's member lifecycle is coordinator-observed, evidence-gated, and receipted.** The
  closed re-arm set `REARM_KINDS` is exactly the four worker-observable progress kinds
  `approval.resolved` / `decision.settled` / `lifecycle.turn_started` / `question.answered`;
  "heartbeats, provider calls, tokens, tool calls, file edits, scratchpad notes, and
  orchestrator/policy kinds are all silence." (impl/src/coordinator.mjs:67-76) The #67 watchdog
  arms on evidence, re-arms with an in-flight turn ("A turn in flight IS the evidence check"),
  escalates before it reaps, and clears only on a qualifying D2 re-arm. (impl/src/coordinator.mjs:8787-8814,
  :8917-8936)
- **GT-B2 — The BD3-C message lane is the mid-flight delivery lane, orchestrator→member.** A send
  mints `message:<digest>` ids for kinds `inform|query|steer|brief|result` with a depth budget,
  spills oversize bodies (`FRAME_LIMITS['message.send.body']` = 2048 B; spill ceiling 1 MiB), and
  receipts are `{delivered, read, actedOn, reply}` where `read` is the worker's first
  `lifecycle.turn_started` in the SAME process generation. (impl/src/coordinator.mjs:6856-7000,
  :7010-7039; impl/src/limits.mjs:54-56, :86, :119) The member→orchestrator direction rides the
  `MESSAGE_SEND: {inReplyTo, body}` frame scanned from the worker's session text, membership- and
  depth-checked. (impl/src/claude-session.mjs:33; impl/src/coordinator.mjs:12770-12878)
- **GT-B3 — The wave's member briefing is the one-time context injection.** Members get the
  objectiveRef/objective + scope at spawn (workflow spec `members[].objectiveRef` required,
  impl/src/workflow-interpreter.mjs:205-207); the provider-facing brief is composed at the
  `_providerBrief` seam and explicitly "never enters task.brief". (worker-delivery-push-contract.md
  GT3; the digest pin at coordination-store.mjs:3003)
- **GT-B4 — The #79 delivery push (contract v1.1 folded; red suite landed; push itself in flight)
  is the next-turn context seam.** It composes a bounded `## Pending attention` block on the
  provider-facing brief — worker-addressed by `workerId`, sanitized `gate_verdict` from the
  per-worker `debugGateRefusal`, item-count bound 8 with digest-cited spill, frame
  `UNTRUSTED_ATTENTION …`. (worker-delivery-push-contract.md D1-D6; suite
  impl/test/worker-delivery-push-red.test.mjs) The impl-79 receipt records only `waves.start`
  (worker-delivery-push-2026-08-07/impl-79-receipt.json), so the push is the declared red target,
  not yet shipped.
- **GT-B5 — The up-channel park/wake seams are uneven.** The decision lane is LANDED: a worker's
  `decision.requested` parks the task at `input_required`; the orchestrator answers via
  `run.answer`. But the top is NOT woken — the #71 orchestrator-wake lane is RED (W-1..W-8), so the
  attention inbox is page-read-only and the orchestrator must poll. (orchestrator-wake-contract.md
  G6, W-1..W-8; comm-topology-audit Cell 2) The member-side analog (#181 member wake-on-signal, the
  park/wake gap) is this row's finding-by-analogy: a parked member is not woken on a signal either —
  `signalOnMembersDone` semantics are being corrected in this very wave (workflow.json steering:
  "#175 semantics are corrected in this spec — roles = the rows"), and the lane-proof evidence's
  verdict vocabulary includes PARKED-FOREVER for a deferred decision with no answer, no escalation,
  no timeout honesty. (lane-proof-2026-08-13/lane-messages.md Lane 2)
- **GT-B6 — Member blindness is the current reality, and the #174 law names the remedy.** The
  lane-proof coordinator brief instructs verification "on disk per the #174 law (sibling worktrees
  …)" — a member must not trust its own projection; it verifies against the actual worktrees and the
  main repo. The row's own spawn experience confirms the blindness: I could not see sibling
  members' writes from my seat, only my own run's evidence stream. (lane-proof-2026-08-13/
  coordinator-brief.md; this run's coordination events)
- **GT-B7 — The shared-publish lane is closed to members.** `writeScratchpad` hardcodes
  `const scope = \`worker:${fields.workerId}\`` (coordination-store.mjs:14103); the #158 gap means a
  member cannot write to the `shared` partition — only the orchestrator's elevate can. The
  lane-proof row recorded the exact landing (scope `worker:w-264`, not `shared`) as its load-bearing
  negative test. (lane-proof-2026-08-13/lane-messages.md Lane 4)
- **GT-B8 — The member surface is fixed; wave roles are the only per-member variation.** Roles map
  to permission subsets — executor-class `{read,claim,report}`, coordinator-worker exactly `{read}`
  (coordinator.mjs:82-85) — and the wave scope field restricts which paths a member may touch.
  #147's profile work is the surface-capability composition discussion, not per-member toolset
  customization. (control-surface-audit-2026-08-13/)

---

## Candidate evaluations

### C1 — `agent.inject()` as the mid-flight context lane

**dsh:** context lands in the **next admitted request**, does not wake the driver, may miss an
already-claimed batch, and is discarded by cancellation/disposal (GT-D3). It is a first-class,
durable, model-visible input (GT-D4): the session log records the injected `user/message` with a
non-`user` source, and derived history shows it verbatim at its chronological position.

**baton today:** the mid-flight context carriers are (a) the BD3-C message lane — frames delivered
between turns with `{delivered, read}` receipts and a 2 KiB/1 MiB spill economy (GT-B2), (b) the #79
next-turn attention push (GT-B4), and (c) the kernel-only BD3-B context packs
(`mintContextPack`/`materializeContextPack`/`recordContextRead`) with **no facade/MCP projection**
— a coordinator cannot today hand a member a precomposed context package through any surfaced verb
(comm-topology-audit Cell 3 GAP).

The operator's standing ask — "pass entire bodies of context into per-worker objects" — is the
BD3-B context-pack shape, not the 2 KiB message frame. The question is which delivery semantics the
materialized body should have.

**Verdict: ADAPT.** The "next admitted request, no wake, may-miss-a-batch" semantics is exactly
what baton's *spawn/refinement* seam already gives: a context pack materialized into the
provider-facing brief at the next spawn or recovery-refinement (the `_providerBrief` seam, GT-B3) is
"admitted" at the next request the member makes, does not itself wake a parked member, and re-serves
on re-spawn. What dsh adds that baton lacks is the **explicit no-wake admission** as a *distinct
semantic from steering*: baton's message lane conflates "deliver content" with "wake the turn";
dsh's `inject` deliberately does not wake. That separation is worth landing.

- **Landing zone:** project the kernel context-pack lane behind the facade (the comm-topology Cell 3
  seam: `run.context.materialize`, a closed `{packId}` normalizer over the store's
  `materializeContextPack`, application.mjs:12750-12780 (the `resolveBriefing` direct-port pattern;
  the admit/attach/branch facade verbs sit at :9789-9835), and give it the *inject* semantics: materialized packs compose into
  the next provider-facing brief, `wake:false` by default; a member's explicit `CONTEXT_READ
  {kind:'spill'}` resolution keeps the "entire body" reachable without shipping it inline. The
  existing spill/frame economy (#89) already bounds the body; the new row is the facade + the
  no-wake delivery law, additive-only.
- **Veto check:** no clock (delivery is event/seq-ordered); honesty (receipts ride the existing
  `recordContextRead` audit, replay-derived); machine channels sterile (the pack rides the
  UNTRUSTED_CONTEXT_PACK frame already at `_providerBrief`); additive-only (new facade verb + new
  row, no closed kind amended); no per-worker heaviness (the coordinator composes; the member just
  receives).

### C2 — `agent/pre-step` interception as the member-side steering answer

**dsh:** `agent/pre-step` is the one serial listener chain before request derivation; listeners may
rewrite the claimed messages or reject them outright, and the decision is authoritative (GT-D1,
GT-D6). It is a *per-step, content-level* gate: the policy sees and can change exactly what the
model sees.

**baton:** the equivalent steering seams are all *between* turns or at spawn: the objective/briefing
at spawn, `nudge-on-checkpoint` at the member's next checkpoint, the message lane's `steer` kind, and
the #79 push at the next provider-facing brief. Baton never inspects or rewrites a member's actual
message content mid-step; the coordinator is not inside the worker's harness.

**Verdict: REJECT as a content-rewrite seam; ALREADY-HAVE as a next-request composition seam.**

- The content-level rewrite is a structural mismatch. A baton member's "request content" is
  process-private inside its own harness worktree; the coordinator has no hook inside the worker's
  prompt assembly, and building one would require the exact per-worker heaviness the vetoes forbid.
  The honest equivalent of "decides what the model sees" is the provider-facing brief composition
  (`_providerBrief`), which already decides what the member sees on every spawn/recovery — and #79
  extends it. That is ALREADY-HAVE.
- What is NOT already had, and is worth keeping from dsh, is the *authoritative reject* as a
  *receipted outcome* rather than a silent drop: when the coordinator decides a member should not
  proceed (e.g. a steering focus the policy refuses), the member's next brief should carry the
  refusal as a typed `lastRefusal`-style fact (the message-lane precedent, coordinator.mjs:12808-12814)
  rather than just not delivering the nudge. That is an ADAPT of the refusal-honesty, not of the
  interception mechanics.
- **Landing zone:** fold this into C1's facade + the #79 block: `run.context.materialize` and the
  attention push already compose the *next* request; add the steering-refusal receipt
  (`steer.refused {nudgeId, reason}` riding the existing receipt accessors) so a refused steer is a
  durable, orchestrator-readable outcome — matching dsh's "reject is recorded, never silent."
- **Veto check:** honesty (refusal receipted, never a silent drop); machine channels sterile (the
  refusal rides the existing frame/receipt vocabulary); no per-worker heaviness (no hook inside the
  worker harness).

### C3 — The durable no-step turn (attempt recorded even when rejected)

**dsh:** a rejected or empty first claim closes a durable `turn/end` that spent no step — the log
records the attempt (GT-D1). The sequence diagram is explicit: "claimed batch stays removed, the
open turn spends no step" (dsh-digest/agent-lifecycle.md:31).

**baton:** the brief frames the contrast as "baton's silent-turnless workers law." The honest
reading of baton's machinery: a member that never emits `lifecycle.turn_started` after spawn is
observed as silent (the #67 watchdog's re-arm set requires turn_started or a resolution kind,
GT-B1), but the *attempt* itself — "a turn boundary was opened and no step was entered" — is not a
first-class durable event in baton's log. An empty/refused interaction and a never-started worker
both read as "no progress evidence," which the watchdog then treats the same way.

**Verdict: ADAPT.** The distinction dsh draws — *an attempted no-step turn is not the same as no
turn at all* — is a genuine honesty improvement and is cheap because baton already has the event
log. The landing is a **member-observable `lifecycle.turn_attempted` (no-step) record**: when the
coordinator admits a member's spawn brief but the member's first response is an explicit empty/
refused acknowledgement (or the adapter reports a turn boundary with no step), the log records the
attempt with the turn boundary, distinct from the pure silence that keeps the watchdog's re-arm
window open. This preserves honesty over comfort: an empty member is no longer indistinguishable
from a dead member, and the #67 evidence gate stays untouched (a `turn_attempted` record is NOT a
re-arm kind — only the closed four, GT-B1, remain).

- **Landing zone:** new additive event kind on the coordinator log (`lifecycle.turn_attempted`
  with the worker/turn identity), emitted on the adapter's turn-boundary observation when no step
  starts; consumed by the run view's waitingOn/attention projection as a distinct honest state.
  Additive-only: `REARM_KINDS` is unchanged.
- **Veto check:** honesty (the attempt is recorded; silence and emptiness no longer conflated);
  no clock (event-ordered); no per-worker heaviness (one log row, replay-derived).

### C4 — Per-agent scoped registration (`agent.ctx`)

**dsh:** `agent.ctx` gives one agent its own registration context — contributions are agent-local,
unwind on disposal, reject registration afterward (GT-D7). The scope primitive is a library, not a
service, keyed to an opaque identity.

**baton:** the member's capability surface is **fixed**; the only per-member variation is the wave
role's permission subset (executor-class `{read,claim,report}` vs coordinator-worker `{read}`,
GT-B8) and the scope field restricting touched paths. #147's profile work is about surface
capability composition (which profile a connection uses), not per-member toolset registration.

**Verdict: REJECT (per-worker toolset registration); ALREADY-HAVE (scoped visibility).**

- The *mechanism* — a member registering its own tools within scope — is the exact per-worker
  heaviness the foundry vetoes forbid, and it contradicts baton's fixed-member-surface design: the
  coordinator must be able to reason about what a member can do from the wave spec alone, not from
  registrations a member minted for itself. #147 profile composition is the right axis for surface
  variation.
- The *property* dsh's scoping gives — "registrations are agent-local, unwind on disposal, and
  reject registration afterward" — is already how baton's wave members work, just at the wave level
  instead of the tool level: the member's worktree, scopes, and leases are minted at spawn, unwind
  on reap/teardown, and reject cross-run use (`context_scope_forbidden`; the FP-05 unknown ≡ foreign
  law; comm-topology-audit Cell 6). That is ALREADY-HAVE as a wave-level property.
- **Landing zone:** none for the mechanism. If the campaign later wants per-member capability
  variation beyond roles, the landing zone is #147's profile-composition work — never a
  member-minted tool registry.

### C5 — The agent handle's cancellation / error recovery

**dsh:** cancellation is **cooperative and caused**: `cancel(cause, {keepInbox})`, first cause wins,
no-op when idle; causes are user | parent | hook | disposed (GT-D5). Recovery is a waterfall:
`agent/request-error` can `{kind:'retry'}` a failed step before the turn closes (GT-D6).
`whenIdle()` / `runMaintenance(task, signal)` give an owner an owned quiescence boundary.

**baton:** cancellation is **authoritative and evidence-gated**: the coordinator stops/kills/reaps,
with the #67 watchdog's escalate → claim/nudge → preserve-first-reap ladder (GT-B1), and the SC13
law ("cancellation is terminal too. No late spawn/delivery/turn continuation may revive it,"
coordinator.mjs:270). #182's death certificates are the durable record of *why* a worker died.

**Verdict: ADAPT.** The two models are complementary, not competing — dsh's cooperative signal is
the member's *view* of interruption; baton's authority is the coordinator's *fact*. Three specific
adaptations:

1. **The caused-cancel record.** dsh deliberately refuses to overload `turn/end` with the
   canceller identity — "recording who requested cancellation would require a separate durable
   event" (GT-D5). That is exactly the #182 death certificate. Baton already has `kill.confirmed` /
   `kill.requested` and the `AgentCancelCause`-shaped reasons in the coordinator; the ADAPT is to pin
   the death-certificate shape as the durable, replay-derived *why* — the member's terminal record
   carries the cause kind (user/parent/hook/disposed ≡ orchestrator-stop / watchdog / policy /
   reap) so a replayed run answers "who stopped this member and why" from the log, never from
   process-scoped memory.
2. **`keepInbox` ≡ recovery-refinement survival.** dsh's `cancel(cause, {keepInbox:true})`
   preserves pending work for a later turn. Baton's refinement/recovery path already re-serves
   pending items (the #79 still-pending predicates, D5) and rejects byte-identical brief mutation
   (the digest pin, GT-B3). The ADAPT is to make `keepInbox` an *explicit* policy on
   interrupt-then-recover, rather than an implicit property of whichever path re-drives — so an
   interrupted member's pending interactions (questions/decisions) are honestly re-served or
   honestly dropped, never silently both.
3. **`whenIdle()` quiescence.** dsh's owned receipt-to-idle interval maps to baton's `run.wait` /
   turn machinery, but the #164 fail-loud contract (a wait must re-check authority AND terminality
   per cycle and never burn the full clock on decided truth) is the baton-side equivalent law, and it
   is the more complete one. ADAPT: keep baton's fail-loud wait as the quiescence surface; do not
   import dsh's maintenance-task slot (baton has no member-side background tasks by design — that
   would be per-worker heaviness).

- **Landing zone:** #182 (death certificate shape) + the #164 fail-loud wait pins +
  recovery-refinement's existing digest-pinned re-serve (coordination-store.mjs:3003).
- **Veto check:** honesty (the death certificate is replay-derived; no process-scoped claim); no
  clock; machine channels sterile (the certificate is coordinator-authoritative, never
  worker-authored); additive-only (new durable row for the cause, or a field on the existing
  terminal record — the coordinator's choice at impl).

### C6 — (self-found) The model-visible-means-logged invariant vs baton's UNTRUSTED framing

**dsh:** a runtime invariant asserts everything a model request sees is reconstructable from the
log, and a new model-visible input requires a new `SessionEventMap` row (GT-D4).

**baton:** the equivalent discipline is the *provenance/framing* law — every worker-facing lane
frames its payload UNTRUSTED at the delivery seam (UNTRUSTED_CONTEXT_PACK, UNTRUSTED_ATTENTION,
UNTRUSTED_WEB_CONTENT), and hub-derived content is never `untrusted:false` (worker-delivery-push-
contract.md GT9, D1, R8′). Baton additionally makes every coordinator admission a durable store
event (the coordination-store append-only log; `recordMessage` for lane audit, coordination-store.mjs:13725-13728).

**Verdict: ALREADY-HAVE (as framing), with one ADAPT (as a stated invariant).** Baton's framing law
is stronger than dsh's on *trust* (it distinguishes hub-computed from hub-derived and refuses to
ship untrusted content as trusted), which is the direction that matters for a multi-agent fleet
where the coordinator is the only trusted party. What baton lacks is the *declaration*: dsh states
"model-visible means logged" as a runtime-asserted invariant. Baton's nearest analogue is the
digest-pinned brief (GT-B3) and the frame literals, but the invariant itself is not asserted as one
law. ADAPT: state the baton analogue explicitly — **"worker-visible means receipted"**: every
worker-facing payload the coordinator composes carries a durable audit row and a provenance class;
an augmentation that reaches a member without a receipt row is a bug. This is a documentation + a
red-pin, not a mechanism change.

### C7 — (self-found) The single-agent trap: dsh's inbox is per-agent, baton's lane is per-run

This is not a candidate — it is the enforcement of **LAW-6**. dsh's delivery vocabulary (inbox
targets, claims, pre-step) is entirely inside one agent object; there is no cross-agent delivery.
Baton's message lane is per-run with membership authorization (the B-2 check,
coordinator.mjs:12794-12801) and run-scoped fan-out. **None of the five candidates above may be
imported as a per-agent mechanism.** Every ADAPT above lands as a coordinator-composed, run-scoped,
receipted lane — never as a member-side registration or hook.

**Verdict: ALREADY-HAVE (the run-scoped shape is baton's native form); it is LAW-6 and the binding
constraint on every other verdict in this row.**

---

## Verdict table

| # | Candidate | dsh mechanism (digest cite) | baton landing zone | Verdict |
|---|---|---|---|---|
| C1 | `agent.inject()` as mid-flight context | core.md:132-140; architecture.md:86, :120 | `run.context.materialize` facade over BD3-B context packs (comm-topology Cell 3 seam) + no-wake delivery law | **ADAPT** |
| C2 | `agent/pre-step` interception | architecture.md:71, :88; core.md:217-235 | provider-brief composition (`_providerBrief`) + steer-refusal receipt | **REJECT** (content rewrite) / **ALREADY-HAVE** (next-request composition) |
| C3 | Durable no-step turn | architecture.md:88; agent-lifecycle.md:31 | new additive `lifecycle.turn_attempted` (no-step) log row; `REARM_KINDS` unchanged | **ADAPT** |
| C4 | Per-agent scoped registration (`agent.ctx`) | core.md:72-73; scope.md:9-43 | wave-role permission subsets + scope field (GT-B8) | **REJECT** (mechanism) / **ALREADY-HAVE** (wave-level scoping) |
| C5 | Agent-handle cancel/recovery | core.md:82-101, :180-203, :228-235 | #182 death certificates + #164 fail-loud wait + digest-pinned refinement re-serve | **ADAPT** |
| C6 | Model-visible-means-logged | architecture.md:96 | UNTRUSTED framing (already) + stated "worker-visible means receipted" invariant | **ALREADY-HAVE** (framing) / **ADAPT** (declared invariant) |
| C7 | Single-agent trap (cross-agent delivery) | core.md:114-178 (inbox is per-agent) | run-scoped lanes with B-2 membership (coordinator.mjs:12794-12801) | **ALREADY-HAVE** (LAW-6; binding constraint) |

---

## Refusal vocabulary / veto boundary

- **Machine channels stay sterile.** None of the ADAPTs mint a trusted worker-facing path: C1 rides
  the UNTRUSTED_CONTEXT_PACK frame, C2's refusal rides the existing receipt accessors, C5's death
  certificate is coordinator-authoritative, C3's log row is policy-observed, never worker-authored.
- **Additive-only.** Every landing adds a row/verb/field; nothing renames or retires a closed set.
  `REARM_KINDS`, `WAITING_ON_KINDS`, the phase literals, and the frame literals are pinned unchanged.
- **No per-worker heaviness.** C4 is rejected precisely because a member-minted registry is
  per-worker bookkeeping. The coordinator composes everything a member sees.
- **No clocks.** All landings are event/seq-ordered; the #67 evidence gate and the #164 wait budget
  keep their existing shapes.

## Red-first acceptance (what is RED at HEAD today, per the shared laws)

Each pin is RED at the current HEAD; the landing makes it GREEN.

- **R1 (RED)** — a member cannot publish to the `shared` scratchpad partition: `writeScratchpad`
  hardcodes `worker:<id>` (coordination-store.mjs:14103, the #158 gap). The lane-proof row already
  recorded the exact landing; this row's shared-publish attempt is recorded in the evidence section
  below.
- **R2 (RED)** — the BD3-B context-pack lane has no surfaced verb: `mintContextPack`/
  `materializeContextPack` are kernel-only (comm-topology-audit Cell 3). C1's facade is absent.
- **R3 (RED)** — the #79 delivery push is contract-folded with its red suite landed, but the push
  itself is not shipped (impl-79 receipt records only `waves.start`); the `## Pending attention`
  block does not exist on provider-facing briefs today.
- **R4 (RED)** — the #71 orchestrator wake is RED (W-1..W-8): the top is not woken on a member's
  park or doubt; #181's member-side wake-on-signal is the analogous gap, and #175's signal semantics
  are being corrected in this very wave (roles = the rows).
- **R5 (RED)** — an attempted no-step turn (C3) is not distinguished from pure silence: the log has
  no `lifecycle.turn_attempted` row, so an empty member and a dead member read identically to the
  #67 evidence gate.
- **R6 (RED)** — the death-certificate shape (#182, C5) is unpinned: the durable *why* of a worker
  stop is not a single replay-derived record; process-scoped `_messages`/receipt state is not the
  durable authority.

## Open questions / judgment calls

- **OQ1 — where does the no-step record surface?** The `lifecycle.turn_attempted` row (C3) could
  project into the run view's attention/waitingOn spine as a distinct honest state, or stay
  log-only. Judgment call for the coordinator; this row's recommendation is log-only first (no
  vocabulary amendment) with the projection following if the #10 owners sign off.
- **OQ2 — is the context-pack materialize `wake:false` by default, or a policy flag?** The dsh
  `inject` law is no-wake; baton's packs may sometimes want to wake (a blocking correction).
  Recommendation: `wake:false` default, `wake:true` only for the #79 corrective-push class —
  authority-class if contested.
- **OQ3 — does `steer.refused` (C2) reuse the message-lane receipt accessors or the #79
  `attention.pushed` receipt?** Both are replay-derived; the message-lane `lastRefusal` precedent
  (coordinator.mjs:12808-12814) is the closer shape.
- **OQ4 — the #182 death-certificate cause taxonomy.** dsh's four causes (user/parent/hook/disposed)
  do not map one-to-one onto baton's stop reasons (orchestrator-stop, watchdog stall, policy
  mismatch, reap, drain). This row records the mapping question for #182; it should be pinned before
  the certificate shape freezes.
- **Judgment calls made in this row:** C2 REJECTed as a content-rewrite seam (the vetoes outweigh
  the dsh affordance); C4 REJECTed as a mechanism (fixed member surface is a feature for a
  coordinator that must reason about member capability from the spec alone); C3 ADAPTed rather than
  REJECTed because the honesty-over-comfort law favors recording the attempt over conflation.

## Evidence note: the shared publish attempt (#158)

Per the foundry law ("Publish to `shared` when complete — or record the exact refusal"), this row
emits the worker-facing `SCRATCHPAD_WRITE` frame targeting the shared partition at completion. Per
the #158 gap (GT-B7), the kernel hardcodes `worker:<id>`, so the expected landing is this row's own
worker scope (`worker:w-273`, confirmed from the coordination store — the memory-dir path `w-272` is
not the worker id), not `shared` — and the exact landing/refusal is recorded in the coordination
store, exactly as the lane-proof row recorded `scope: "worker:w-264"` for its shared publish.

Attempt log (incremental, honest):

- **Attempt 1** — emitted in the row's completion turn (idempotencyKey
  `row-dsh-lifecycle.shared-publish.1`). **Did not land:** as of the follow-up steer's arrival, the
  coordination store shows **zero** `scratchpad.entry_written` (and zero scratchpad events of any
  kind) for run `run-ffd2d105989b4be780085184de71bd2b`. The frame was not scanned, not refused — the
  channel carried nothing. Recorded here so the gap is visible, not smoothed over.
- **Attempt 2** — re-emitted in this follow-up turn with the same idempotencyKey, per the steer
  ("publish to shared when complete — or record the refusal"). Expected landing per #158:
  `worker:w-273` (ordinal 1), not `shared`; a `shared` landing is impossible from a member seat
  (coordination-store.mjs:14103, :14173, :14326). Full deliverable text (34,054 B) exceeds the
  `scratchpad.entry.body` 8,192 B cap and the 20,480 B scan window, so the frame carries this
  manifest, not the full text; the full text is the harvest artifact at the deliverable path.

The #158 gap is load-bearing evidence (not a refusal to try): the frame is still emitted, and the
exact landing is the record. That a member *cannot* reach `shared` is the campaign's documented
negative test, and it reproduces.

## Cross-references

- dsh ground truth: `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-digest/architecture.md`,
  `agent-lifecycle.md`, `subsystems/core.md`, `subsystems/scope.md`, `subsystems/session.md`.
- Baton message lane + watchdog: `impl/src/coordinator.mjs` (REARM_KINDS :67-76, watchdog :8781-8936,
  sendMessage :6856, messageReceipt :7010, MESSAGE_SEND reply admission :12770-12878).
- Shared-publish gap: `impl/src/coordination-store.mjs:14103` (writeScratchpad worker-scope hardcode).
- #79 delivery push: `docs/reference/evidence/worker-delivery-push-2026-08-07/worker-delivery-push-contract.md`
  + `impl/test/worker-delivery-push-red.test.mjs`.
- #71 orchestrator wake: `docs/reference/evidence/orchestrator-wake-2026-08-07/orchestrator-wake-contract.md`
  (W-1..W-8).
- #164 fail-loud waits: `docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md`.
- Lane-proof evidence (member-lane exercise): `docs/reference/evidence/lane-proof-2026-08-13/`
  (lane-messages.md, coordinator-brief.md).
- Channel audit: `docs/reference/evidence/worker-orchestrated-swarm-2026-08-13/comm-topology-audit.md`.
- Surface profile composition (#147): `docs/reference/evidence/control-surface-audit-2026-08-13/`.
