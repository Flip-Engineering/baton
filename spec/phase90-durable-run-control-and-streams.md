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
- RT3 progress ignores transport/audit/token chatter and survives restart exactly.
- RT4 events are safe facts; output is opt-in, bounded, redacted, and explicitly untrusted.
- RT5 ordered at-least-once resume uses durable cursors; expiry requests a fresh snapshot.
- RT6 revocation/downgrade/incarnation change closes before the next frame.
- RT7 backpressure/disconnect never controls provider work.
- RT8 interrupt confirmation, stop admission, terminal cause, and zero-reap truth cannot be dropped.

## 7. Ordered implementation

1. Semantic action schemas, recipient projection, Pythonic client methods, CLI aliases, and help.
2. First-class coordination control state, provider-boundary correlation, replay, and race tests.
3. Direct/Web/MCP parity and resident reconnect/restart tests.
4. Rebuildable Run timeline index and progressive inspect branches.
5. Run-bound Web streaming and browser migration.
6. Baton-on-Baton proof: exact parallel routes, semantic guidance, selective interrupt with sibling
   survival, reconnect/restart, whole-group stop, and zero ownership/worktrees.

Current checkpoint: steps 1-2 are green, the authenticated resident CLI has exercised semantic
send and interrupt against an exact Codex route, and the subsequent Run stop proved one process
observed/closed with zero remaining ownership. Dogfood also made ordinary mutation output compact
and exposed the existing inspection cascade directly as `run show --depth ...`. Step 3 remains
partially green through the existing Web/MCP `run.act` parity; steps 4-5 are the active next slice.
The read-only objective that dogfood rejected as `required_effect_absent` is separately retained as
an intent/effect-authority gap rather than weakened into an implicit exception.

The next phases consume this surface for addressed Episodes/workstreams, recursive feedback,
parallel composition, Context/RLM programs, Slate-like bounded synchronization, Atlas structural
intelligence, and Cairn shared knowledge. None introduces another operator control plane.
