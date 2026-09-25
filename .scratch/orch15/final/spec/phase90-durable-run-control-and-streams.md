# Phase 90 — durable semantic Run control and Run-scoped streams

Status: active implementation objective, 2026-07-18.

Phase 90 closes the most visible remaining split between Baton's strong fleet kernel and its
ordinary resident application. It does not add another control plane. Pythonic Run methods, CLI,
authenticated Web, MCP, and the browser compile into the semantic action and progressive
inspection authority already owned by the Run application.

Normative dependencies:

- Phase 89 authenticated resident application and security matrix CA1–CA14, CS1–CS12,
  SR1–SR15, SV1–SV11;
- Phase 87 semantic action authority;
- Phase 8 session, fencing, delivery serialization, and confirmed-interrupt contracts;
- Phase 12 Web command reconciliation and stream admission; and
- Phase 64 integrated Run application.

## 1. Ordinary surface

```js
const run = await baton.runs.attach(runId);

await run.send('Recheck the authority boundary.', {
  recipient: 'work',
  delivery: 'nudge',
});

await run.interrupt({
  recipient: 'work',
  reason: 'Pause for contradictory evidence.',
});

for await (const view of run.changes()) { /* progressive Run views */ }
for await (const event of run.events()) { /* normalized mechanical facts */ }
for await (const output of run.output()) { /* opt-in untrusted provider content */ }
```

Ordinary callers never submit worker IDs, task IDs, fences, process identities, provider request
IDs, event cursors, page sizes, budgets, byte ceilings, receipts, sockets, or credentials.

`send()` and `interrupt()` discover their currently advertised semantic action and call the exact
two-argument command port:

```text
command('run.act', {runId, actionId, inputs})
```

Raw `run.steer(target, ...)`, `fleet_send`, and `fleet_interrupt` remain advanced compatibility
operations. They cannot be relabeled as durable ordinary control.

## 2. Semantic recipients

The server resolves a semantic recipient at the serialized effect slot:

- `work`: the sole eligible current work member;
- a Workflow role: the exact current Attempt generation for that role; or
- `review`: the exact current semantic-review generation.

An ordinary Run with one eligible member defaults to `work`. A parallel Run without an exact
`work` role requires one advertised role. Ambiguity refuses before provider effect. A disappeared,
recovered, replaced, or differently fenced generation is not a substitute for the action's bound
target.

Internal binding includes repository, Run, Goal/Plan, semantic role, task, worker, session/process
generation, turn epoch, current fence, and a digest. Only the semantic recipient set is visible in
the ordinary action descriptor.

## 3. Durable control state

The coordination ledger remains truth. The intended first-class state machine is:

```text
admitted -> effect_started -> provider_acked -> settled
                                              -> confirmed
                                              -> refused
                                              -> outcome_unknown
```

Admission binds:

- control and semantic-action identities;
- semantic-registry, repository, Run, profile, Goal/Plan, actor, principal, and session;
- operation, delivery mode, normalized message/message digest, and reason digest;
- semantic recipient and exact target-generation digest; and
- provider request identity and request digest.

The bounded normalized message is durable so a crash before the provider boundary can resume the
same delivery. Credential-shaped text is refused. It is never projected into ordinary summaries.

Recovery is closed:

| Durable point | Recovery |
|---|---|
| admitted, no effect start | execute once against the exact stored generation, else refuse |
| effect started, no conclusive proof | correlate operational/provider facts; otherwise settle `outcome_unknown` |
| provider acknowledged | settle the exact recorded result without another provider call |
| settled | reauthorize and replay the persisted compact outcome |

Baton never retries an ambiguous external effect. `delivered_despite_stale` is explicit uncertainty,
not ordinary success.

The current first vertical persists integrity-checked first-class coordination events for
admission, effect start, provider acknowledgement, and settlement, and correlates operational
provider events with one opaque control identity. RC1/RC2 and recovery before effect, after effect,
after provider acknowledgement, and after settlement are executable-green. Response-loss replay
returns the persisted outcome without a second provider call; an uncorrelated post-boundary
exception settles explicit `outcome_unknown`.

## 4. Send and interrupt invariants

1. Concurrent sends to one recipient retain durable admission and adapter delivery order.
2. Delivery-slot fence recheck remains authoritative.
3. `nudge`, `now`, and `turn` are closed values; unsupported delivery refuses honestly.
4. Provider acknowledgement loss after a recorded boundary settles `outcome_unknown`.
5. Selective interrupt is confirmed only by the adapter/session confirmation event.
6. Interrupt ends only the addressed current turn and preserves unrelated Workflow members.
7. Session preservation is claimed only when the exact provider session remains attached.
8. `stop_member` remains kill/reap, not an interrupt alias.
9. Whole-Run `stop()` remains the only Run method that closes dispatch and proves exact reap.
10. Stop admitted before a provider boundary forbids the control; boundary first preserves honest
    late-effect truth while stop continues to reap.
11. Interrupt racing stop cannot enqueue a successor turn.
12. An already-terminal, absent, orphaned, or replaced target is not reported as newly interrupted.

Phase 91 closes the semantic-interrupt defect that remained at this checkpoint. Ordinary interrupt
now requests `preserve_turn`, binds the exact task/session/process/worktree/route/Plan/Run generation
through schema-v2 admission and settlement, and serializes both its effect and any successor send
through the member delivery slot. A successor consumes one closed preservation receipt; Run stop
admitted first forbids it, while stop after provider prompt acceptance records explicit
`outcome_unknown` and continues exact reap. Direct low-level coordinator interrupt remains
cancel-by-default for compatibility and is not the ordinary semantic contract. See
`phase91-semantic-interrupt-preservation.md`.

Evidence note: Phase90's historical authenticated live interrupt exercised the pre-Phase91
semantic interrupt surface. It is not evidence that a live persistent provider preserved its exact
native session, completed attach-only restart recovery, or resumed on a Phase91 receipt. Those are
separate Phase91 live gates.

## 5. Progressive Run timeline

Streams extend the same outline -> index -> section -> item -> content cascade. They do not add
three unrelated low-level command families.

The execution chapter gains addressed `progress`, `events`, and `output` items:

- progress: stage, attention, control settlement, ownership, result, and terminal transitions;
- events: normalized lifecycle, tool, file, verification, resource, stop, and cleanup facts; and
- output: opt-in bounded provider content marked `contentTrust: untrusted_provider`.

The coordination ledger remains truth. A rebuildable per-Run timeline index owns one durable
sequence across mapped worker and coordination facts. Timestamps never define ordering.

Every frame binds Run scope, event ID/cursor, occurrence trust, content trust, source coordinate,
digest, and bounded projection. Initial stream state is an atomic RunView, not a repository-wide
snapshot.

Web tickets bind repository, Run, channel, user/session/credential, exact Origin, resident
incarnation, and starting cursor. Revocation, scope downgrade, incarnation change, lag, and shutdown
close delivery without controlling a worker.

Ticket admission is ordered: transport/session/repository/channel authorization and the edge ticket
reservation complete before any application inspection. A refusal at either boundary performs zero
`run.inspect` reads. At connection open, the initial projection is accepted only from a stable
`outline -> channel content -> outline` sandwich whose three application cursors are equal.
Authorization and resident incarnation are rechecked after every awaited inspection and again
immediately before each snapshot or page write. Timeline pages require a boolean `hasMore`; a
continuing page must contain at least one item.

## 6. Acceptance matrix

### RC — semantic control

- RC1 action descriptors expose recipients, never worker/fence/process coordinates.
- RC2 Pythonic methods compile through exactly `run.act` and the two-argument command port.
- RC3 ordinary, Workflow-role, and review resolution are exact; ambiguity has zero provider calls.
- RC4 authorization yield, action swap, Run swap, recipient swap, capability drift, and registry
  drift refuse before admission/effect.
- RC5 target replacement/generation change refuses without substitution.
- RC6 same retry deduplicates; changed body under the same identity conflicts.

### RR — recovery and races

- RR1 crash before effect executes exactly once.
- RR2 crash after effect-start never blindly redelivers.
- RR3 acknowledgement without conclusive delivery proof becomes `outcome_unknown`.
- RR4 settlement-before-response replays without provider work.
- RR5 concurrent sends preserve durable order.
- RR6 delivered-after-stale is not reported as confirmed ordinary success.
- RR7 interrupt admission precedes the adapter boundary; Ack alone is not confirmation.
- RR8 confirmed replay performs no second adapter call and preserves the reusable session.
- RR9 stop/control races are decided by the coordination writer and never leave admitted limbo.

### RT — timeline and streams

- RT1 initial state and every frame contain only the authorized Run.
- RT2 sibling Runs never affect counts, cursors, stages, or frames.
- RT3 progress ignores transport/audit/token chatter, survives restart exactly, and the first read
  after a supplied progress cursor emits the accumulated newer state before advancing.
- RT4 events are safe facts; output is opt-in, bounded, recursively projected through a closed
  provider-output schema, and explicitly untrusted. Unknown, authority, session, and credential
  fields are absent at every nesting depth.
- RT5 ordered at-least-once resume uses direct durable cursors; expiry requests a fresh snapshot.
  A page cursor is committed to SSE only after its page body is accepted. Backpressure lag and
  shutdown frames carry only the last successfully committed channel cursor, never the candidate
  cursor of an undelivered page.
- RT6 revocation/downgrade/incarnation change closes before the next frame.
- RT7 backpressure/disconnect never controls provider work.
- RT8 interrupt confirmation, stop admission, terminal cause, and zero-reap truth cannot be dropped.
- RT9 singleton summary item addresses bind the authoritative Goal/Plan version, never the
  coordination cursor. They remain stable across coordination-only churn and a selector for a
  different authority version refuses closed; no cursor-suffix alias maps stale meaning to a new
  view.
- RT10 verification failures expose a closed structural projection: enum-checked outcome and
  ownership, expected/observed exit, candidate/baseline execution state and code, output-exceeded
  state, exact captured-output byte count/SHA-256 digest, a closed diagnostic code, bounded
  duration, validated runtime/verdict digests, and attempt ordinal. The same closed verdict is the
  durable task/log/coordination/artifact authority; raw verifier output, tails, free-form notes,
  argv/cwd/environment echoes, identities, and provider prose are absent from persistence.

### RV — durable candidate-confirmation retry

An initial `candidate_failed` checkpoint is retriable through the ordinary reason-only Run action
under a durable Phase 69 invariant, not a broadened outcome condition:

- pin the non-adoptable exact checkpoint and record `originOutcome=candidate_failed`;
- admit exactly one operator-authorized confirmation across concurrency, restart, and response
  loss with the same Plan, command, base, runtime, toolchain, candidate SHA/ref, and no provider
  turn;
- consume that one shot for passed, candidate-failed, or inconclusive confirmation;
- retain both closed attempt records, the original losing verdict/counterexample, and its route
  loss; and
- accept a later pass only for the exact SHA with
  `stability=passed_after_candidate_failure`, project `mechanically_verified_unstable`, and retain
  that classification through restart, artifacts, evidence, integration, and learning.

Candidate-origin failure or inconclusiveness is final. Inconclusive-origin runtime repair remains a
separate repeatable state and may bind the current corrected deployment runtime; it is neither
consumed nor widened by candidate confirmation. Persisted-secret acceptance scans the worker and
coordination stores after a verifier-only credential canary and proves RT10 at rest, rather than
inferring it from an application projection.

## 7. Ordered implementation

1. Semantic action schemas, recipient projection, Pythonic client methods, CLI aliases, and help.
2. First-class coordination control state, provider-boundary correlation, replay, and race tests.
3. Direct/Web/MCP parity and resident reconnect/restart tests.
4. Rebuildable Run timeline index and progressive inspect branches.
5. Run-bound Web streaming and browser migration.
6. Baton-on-Baton proof: exact parallel routes, semantic guidance, selective interrupt with sibling
   survival, reconnect/restart, whole-group stop, and zero ownership/worktrees.

Current checkpoint: steps 1-5 are green. The authenticated resident CLI has exercised semantic
send and interrupt against an exact Codex route and whole-Run stop with zero remaining ownership.
The execution chapter now projects stable progress/events/output content, Pythonic and CLI
facades consume server-owned cursors and waits, mapped operational events are integrity checked in
one per-Run coordination order, sibling traffic is excluded, large Unicode output resumes
losslessly, and stop frames retain zero-reap truth. Authenticated Web and MCP inherit the exact
`run.inspect` authority and reauthorization boundary. Web tickets bind Run/channel/recipient,
session, credential, Origin, resident incarnation, and the application timeline cursor; initial
state is the authorized atomic RunView, events/output resume directly from rebuildable
`run.inspect` cursors, and provider output remains explicit opt-in and untrusted. The browser now
renders progress and safe events as one Run activity chapter while preserving the repository-wide
trace under advanced controls. Run frames use one closed schema per channel and bind the projected
payload digest to a `run.inspect` source coordinate containing repository, Run, channel, view
cursor, channel cursor, and optional recipient. The browser verifies that provenance, exact scope,
channel trust, payload schema, payload digest, and SSE id/cursor agreement before retaining a
resume cursor. Switching Runs clears the prior output consent and restores the per-Run output
opt-in control. Step 6 is partially green through live exact Kimi Code failure/reap and
Codex output-follow dogfood. The read-only objective rejected as `required_effect_absent` remains
an explicit intent/effect-authority gap rather than an implicit exception.

The next phases consume this surface for addressed Episodes/workstreams, recursive feedback,
parallel composition, Context/RLM programs, Slate-like bounded synchronization, Atlas structural
intelligence, and Cairn shared knowledge. None introduces another operator control plane.
