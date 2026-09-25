# Phase 90 durable Run control — progressive AX review

Date: 2026-07-19  
Role: independent progressive-run-control-AX designer

## Decision

The next implementation vertical should add exactly two ordinary mutations to the existing bound
`BatonRun`: `send(message, options)` and `interrupt(options)`. Both must lower through the existing
application command port, semantic registry, coordination log, Coordinator fence/stop machinery,
and provider adapters. They must not be implemented as aliases over raw `run.steer`, and they must
not create a second queue, attachment ledger, receipt API, or worker-facing control plane.

The missing authority is a first-class durable **Run control effect** between Web/MCP command
admission and `Coordinator.send()`/`Coordinator.interrupt()`. It records a server-resolved semantic
recipient and exact current worker generation/fence immediately before the provider boundary,
orders controls durably, gives the adapter one stable provider-control request identity, and
settles to exactly one of `confirmed`, `refused`, or `outcome_unknown`. Only those semantic
settlements appear on the ordinary surface. Internal command IDs, control IDs, receipts, worker
IDs, fences, provider IDs, event limits, budgets, and transport recovery remain hidden.

After that mutation vertical is green, add one Run-bound stream operation projected as
`run.events()`, `run.output()`, and `run.progress()`. These are three views over one Run-scoped,
resumable semantic feed, not three new transports and not the current repository-wide coordination
SSE snapshot.

This ordering is important. Streaming an effect whose delivery truth is still memory-only would
make uncertainty easier to watch without making it correct.

## What the tree already proves, and what it does not

The implementation has the right reusable pieces:

- `impl/src/application-client.mjs:628` already supplies the Pythonic bound `BatonRun` object and
  `impl/src/application-client.mjs:908` supplies the shared Runs collection.
- `impl/src/application-semantics.mjs:88` owns the closed operation registry; the action registry,
  registry digest, cascading help, and ordinary/advanced boundary are already centralized there.
- `impl/src/application.mjs:58` defines the shared command bus, `impl/src/application.mjs:8086`
  dispatches it, and Web/MCP derive their application commands from those definitions.
- `impl/src/application.mjs:8189` resolves raw steering inside the application and passes the
  current fence to the Coordinator. That is a useful compatibility implementation, but it still
  accepts a caller-supplied worker target and is explicitly non-reconcilable.
- `impl/src/coordinator.mjs:4878` serializes sends per worker in memory and rechecks the caller's
  expected fence at delivery-slot acquisition. `impl/src/coordinator.mjs:5139` implements
  selective two-phase interrupt, and a confirmed interrupt leaves the session/process reusable.
- `impl/src/coordination-store.mjs:9689` and `impl/src/application.mjs:2368` already demonstrate the
  durable admit/perform/complete/reconcile pattern for exact Run stop. Result adoption, verifier
  retry, and export demonstrate the same pattern for other effects.
- `impl/src/web-northbound.mjs:540` owns authenticated Web admission and replay, while
  `impl/src/application-cli.mjs:1130` hides the Web envelope behind the high-level client.
- `impl/src/application.mjs:5896` already filters coordination changes to one Run and builds a
  bounded semantic follow page. This is the correct starting projection for Run streams.
- `impl/src/web-stream.mjs:20` already has strong ticket secrecy, single use, authorization
  rechecks, bounded buffering, and disconnect-without-control behavior. Its ordinary snapshot and
  event scope are wrong for Phase 90 because they are repository-wide.
- `impl/src/application.mjs:8220` plus the coordination Run-stop authority already provide durable
  whole-Run stop and exact target-set reap. Selective interrupt must compose with that authority,
  never weaken or duplicate it.

The current gap is equally precise. `run.steer` has only the outer Web command record and an
in-memory Coordinator delivery. A resident crash after the adapter receives a message but before
the application/Web response is persisted cannot distinguish delivery from non-delivery. Raw
interrupt is not an ordinary Run action. `BatonWebClient.command()` polls a returned `202`, but a
lost POST response is not reconciled before it throws, and an admitted command is only polled rather
than re-driven with its exact original envelope. The existing per-worker `sendChain` does not
survive restart. None of these gaps can be closed by changing client wording alone.

## The ordinary API

The exact public shape should be:

```js
const run = await baton.runs.attach(runId);

await run.send('Check the replay ordering before changing the dispatcher.');

await run.send('Compare the two candidate reviews.', {
  recipient: { role: 'critic' },
  delivery: 'nudge',
  reason: 'The critic owns the concurrency review.',
});

await run.interrupt({
  recipient: 'review',
  reason: 'The reviewer needs operator input.',
});

await run.stop('Cancel the entire Run and reap everything it owns.');
```

`send()` accepts a non-empty bounded message and an exact options object. `interrupt()` accepts an
exact options object. Their ordinary options are:

| Method | Option | Closed values and default |
|---|---|---|
| `send` | `recipient` | `'work'` by default; `'review'`; or `{ role: ROLE }` where ROLE is currently advertised by the Run |
| `send` | `delivery` | `'nudge'` by default; `'turn'`; or `'now'` |
| `send` | `reason` | bounded semantic reason with a registry-defined default |
| `interrupt` | `recipient` | `'work'` by default; `'review'`; or `{ role: ROLE }` |
| `interrupt` | `reason` | bounded semantic reason with a registry-defined default |

Unknown fields fail in the client and again at the server before durable effect admission. There
is no advanced escape field for `workerId`, `expectedFence`, `taskId`, `requestId`, `turnId`,
`sessionId`, a timeout, a retry count, or a provider budget.

Delivery semantics are application semantics, not adapter verb names:

- `nudge` delivers bounded guidance at the provider's supported safe active-turn boundary without
  ending the turn. It is the least disruptive default.
- `turn` starts or queues one subsequent turn after the recipient becomes reusable. It never asks
  the caller for a provider-turn budget; deployment policy can refuse it.
- `now` ends the active turn and delivers the supplied message as the next turn while preserving
  the same reusable session when confirmation is possible. It is one durable application cascade,
  not a client-side `interrupt()` followed by `send()`.
- `interrupt()` ends the active turn without an implicit follow-up. It is selective: unrelated
  workflow members, sibling Runs, the resident, and the reusable provider session remain owned.
- `stop()` remains the distinct emergency whole-Run authority. It closes future dispatch and does
  not preserve any target session that belongs to the stopped Run.

The methods return the normal compact Run outline, preserving the existing cascading API. The
outline's `lastAction` contains only semantic outcome data, for example:

```js
{
  kind: 'interrupt',
  recipient: { kind: 'workflow_role', role: 'critic' },
  settlement: 'confirmed',
  session: 'retained',
  onlyActiveRecipient: false,
  attention: null,
}
```

It never contains an internal receipt or coordinate. Validation, authentication, authorization,
and integrity failures remain typed exceptions. Once an effect request is durably accepted,
provider-boundary disposition is data: `confirmed`, `refused`, or `outcome_unknown`, not a generic
transport exception.

## Semantic recipient resolution

Use one closed tagged semantic recipient internally:

```text
{ kind: work }
{ kind: review }
{ kind: workflow_role, role }
```

The application resolves it under the Run's current Goal/Plan/workflow-definition authority and
the current coordination prefix:

1. `work` resolves only when there is exactly one current, live, controllable non-review work
   Attempt. A multi-member Workflow with no unique primary work recipient is `refused` with
   `recipient_ambiguous` and advertises its role choices; Baton never picks the first worker.
2. `workflow_role` resolves the current role catalog and current Plan generation, then the role's
   current node, task, assigned worker generation, and fence. An old role binding cannot redirect
   to a successor Plan or replacement worker.
3. `review` resolves only the current independent semantic-review Attempt. A completed, absent,
   or not-yet-admitted review is `refused`, not silently redirected to ordinary work.
4. Resolution requires exactly one attached current worker with a safe control fence and a
   provider session posture compatible with the requested delivery. Zero or several candidates
   refuse with attention.
5. Authorization and Run mutability are rechecked after resolution and again at the serialized
   provider slot. A worker replacement between discovery and effect produces a refusal against the
   original binding; the control is never applied to the replacement.

The resolved binding contains the current Plan/definition generation, task, worker, fence, turn
epoch, and provider-session generation internally. Only the semantic recipient is projected.
This makes later recursive descendants and shared-task roles additive: they extend the closed
recipient resolver, not the public API with worker coordinates.

## Durable control authority

Add first-class Run-control state to `CoordinationStore`; do not encode this as ad hoc
`driver.recorded` scans and do not rely on the outer `web.command_admitted` row as provider-effect
truth.

For a resolved effect, `run.control_admitted` must bind at least:

```text
schemaVersion
repoId, runId
kind                         send | interrupt
semanticRecipient
recipientGenerationDigest   Plan/definition/task generation
resolvedTaskId
resolvedWorkerId
resolvedWorkerGeneration
fence, turnEpoch
delivery                    nudge | turn | now | null
message, messageDigest      message is retained privately for safe pre-effect restart
reason, reasonDigest
actor, principalId, sessionId
registryDigest
invocationDigest            hidden direct/Web/MCP idempotency identity
providerRequestId           server-minted and stable for every adapter attempt/reconcile
predecessorControlId        durable per-recipient ordering predecessor, or null
requestDigest
admissionDigest
```

The normalized message and reason are required internally because a crash before the provider
boundary cannot resume a send from digests alone. They remain private coordination state, are
suppressed from generic Web streams/audits/status, and are exposed only through explicitly
authorized bounded semantic output where applicable. The digests bind the exact bytes. Secret-
shaped input refusal remains in force.

If semantic resolution itself refuses, append a terminal `run.control_refused` decision under the
same hidden invocation identity, binding the semantic recipient, message/reason digests,
actor/session, registry digest, and closed refusal code but no worker or provider request. This is
necessary so a response lost after a no-effect refusal cannot be replayed later against a newly
available worker.

The internal state machine is:

```text
request
  -> terminal refused decision                     (no effect admission)
  -> admitted -> dispatch_started -> settled
                                  -> confirmed
                                  -> refused
                                  -> outcome_unknown
```

`run.control_dispatch_started` is appended before calling an adapter and binds the same admission
and provider request identity. A matching mapped operational event or provider reconciliation fact
is appended before `run.control_settled` when one exists. The settlement binds the admission,
provider request identity, final state, a closed reason code, semantic session-preservation facts,
and exact evidence references. Public clients never receive this record.

The store needs `runControlByInvocation`, `pendingRunControls`, `admitRunControl`,
`beginRunControlDispatch`, `settleRunControl`, and a bounded per-recipient pending query. Replay
validation must reconstruct and validate the maps exactly as it does for Run stop, recovery
attempts, verifier retry, and result export. Same hidden invocation plus changed recipient,
delivery, message, reason, Run, actor/session, or registry identity is an idempotency conflict
before effect.

The provider request identity is minted by Baton before admission and passed through the existing
adapter `prompt` or `interrupt` call as optional control context. Adapters may record a native wire
request/turn identity against it, but callers never see either. The adapter card declares whether
it can reconcile that identity after response loss. Lack of provider reconciliation does not
prevent use; it narrows the honest result to `outcome_unknown` at an ambiguous boundary.

## Exact settlement

The semantic states mean exactly this:

| Settlement | Required proof | Replay behavior |
|---|---|---|
| `confirmed` send | The exact provider request was accepted, and the matching current worker/generation/fence delivery observation is durably mapped. A post-effect fence change is retained as `delivered_despite_state_change`, not ordinary success. | Return the persisted semantic outcome; never call the adapter again. |
| `confirmed` interrupt | The exact interrupt request has a matching `control.interrupt_confirmed` observation; no follow-up was admitted; the process/session remains attached and reusable unless a later Run stop superseded ownership. | Return the persisted semantic outcome; never interrupt again. |
| `refused` | Baton proves the provider boundary was not crossed, or the provider proves `not_sent`/rejected for the exact request identity. Ambiguous/absent/stale recipients and stop-fenced controls are refused. | Return the same closed refusal even if the world later changes. |
| `outcome_unknown` | Dispatch may have crossed the provider boundary, but neither provider lookup nor durable operational evidence proves acceptance or refusal. | Never redeliver automatically. Surface attention and block later ordinary sends to that recipient generation until interrupt, stop, or authorized recovery establishes a new generation. |

An adapter Ack of `{ok:false}` is `refused` only when it also proves `notSent:true` or the adapter
contract makes that response authoritative for the exact provider request. A thrown write,
response loss, missing Ack, or response-less notification after `dispatch_started` is not refusal.
An interrupt deadline that escalates to a kill does not claim `session: retained`; it settles
`refused` with `selective_interrupt_not_preserved` when exact kill is known, otherwise
`outcome_unknown`.

Append failure ordering is strict:

- admission/refusal append failure means no adapter call and no success;
- dispatch-start append failure means no adapter call;
- effect-evidence or settlement append failure after a possible provider effect returns no false
  success and leaves the same admission for restart reconciliation;
- audit failure before admission refuses; audit failure after an effect cannot rewrite effect
  truth and leaves the resident degraded until durable settlement is possible.

The ordinary call must not remain `202 admitted` forever. Deployment-owned control deadlines wake
reconciliation. At deadline or restart, every admitted control converges to one terminal state;
the deadline value is never a caller option or ordinary response field.

## Execution and restart algorithm

For `send` and `interrupt`, the application performs this exact sequence:

1. Normalize the closed request, derive the hidden invocation identity from the command-port
   context, authenticate, authorize, and check for an existing durable decision/settlement.
2. Enter a short Run-control admission critical section. This section performs no network wait.
3. Recheck Run stop authority, current capabilities/scope, registry identity, and semantic
   recipient. Resolve the exact current target and fence.
4. If resolution refuses, durably append the terminal refused decision and return its semantic
   projection.
5. Atomically append the resolved admission with its per-recipient predecessor and stable provider
   request identity. Run-stop admission and control admission must share the same coordination
   serialization point, so exactly one wins.
6. Wait for the durable predecessor to settle. Recheck stop, target generation, fence,
   authorization, and delivery availability at the Coordinator slot.
7. Append `dispatch_started`, call the existing Coordinator control method with the admitted
   target/fence/provider request identity, map any exact operational/provider evidence, and append
   one terminal settlement.
8. Reauthorize observation, build a compact outline, and project only the semantic `lastAction`.

On application startup, reconstruct all Run-control rows before accepting commands. Reconciliation
uses these rules:

- admitted with no dispatch-start event is safe to dispatch once, unless a Run stop or current
  authorization/target check now refuses it;
- dispatch-started plus matching durable evidence settles from that evidence;
- dispatch-started plus provider lookup `accepted` or `not_sent` settles accordingly;
- dispatch-started plus authoritative provider `not_found` may re-drive only when the adapter
  guarantees idempotent use of the same provider request identity;
- dispatch-started without proof settles `outcome_unknown`; it is never blindly repeated;
- already settled returns its persisted semantic projection;
- a pending Run stop is reconciled as an emergency barrier. Controls are classified from durable
  evidence, never newly delivered, before Run-stop completion can assert `dispatchClosed`.

Readiness remains false while the bounded pending-control scan is incomplete. Failure to settle a
row leaves recoverable ownership and explicit degraded readiness; it cannot be forgotten.

## Ordering and race truth

The existing `Coordinator.sendChain` remains a useful same-process backstop, but the durable
predecessor is authoritative.

### Concurrent sends

Two sends to the same semantic recipient are ordered by coordination admission sequence. The
second record names the first as predecessor and cannot enter the adapter until the first is
terminal. Restart replays this order. Sends to unrelated recipient generations may proceed
concurrently; a single Run-wide network mutex would unnecessarily serialize a reviewer and an
independent worker.

If the first settles `outcome_unknown`, the second is refused with
`recipient_control_uncertain`; it cannot overtake the uncertain effect. A confirmed selective
interrupt or a new authorized generation can clear future delivery eligibility without changing
the historical unknown settlement.

### Send versus interrupt

Admission order at the same recipient is the durable winner:

| First admission | Required outcome |
|---|---|
| send, then interrupt | The send either reaches its exact boundary first and settles confirmed (possibly `delivered_despite_state_change`), proves refusal, or becomes unknown. The interrupt then acts on the same still-current generation or refuses if it is no longer current. |
| interrupt, then send | Interrupt fences the active turn. The already-racing send cannot become an implicit follow-up and is refused. A later, separately invoked `send(..., {delivery:'turn'})` may start a new generation after confirmed interrupt. |

Fence change after provider acceptance is never rewritten as ordinary refusal. The old target was
not replaced with its successor, and the response explicitly says delivery occurred despite the
state change.

### Interrupt versus stop

Run-stop admission is the whole-Run barrier:

- stop admitted first: interrupt is durably refused before the adapter boundary;
- interrupt confirmed first: its historical settlement remains confirmed, but stop then kills and
  reaps the retained session, so the current outline does not claim reusable ownership;
- interrupt admitted but not dispatched when stop wins: interrupt settles refused as
  `superseded_by_stop`;
- interrupt already at an ambiguous provider boundary when stop wins: stop escalates through the
  existing exact kill path; interrupt settles from exact evidence or `outcome_unknown`, never as a
  preserved session;
- no `then` message is passed to `Coordinator.interrupt()` for ordinary `run.interrupt`, so an
  interrupt/stop race cannot create an internal follow-up turn.

The same barrier applies to send versus stop. Emergency stop does not wait behind a hung send
promise. It appends stop authority, fences later effects, resolves/cancels pending control rows,
and proceeds with physical reap.

## Selective interrupt and exact stop/reap

A confirmed ordinary interrupt must prove all of the following:

- the active turn ended for the admitted target generation;
- pending question/approval authority for that turn was resolved or cancelled;
- no replacement message or follow-up turn was internally queued;
- the adapter process/provider session remains attached and reusable;
- the worktree, runtime, capacity, and Run ownership remain held;
- unrelated workflow members and sibling Runs are unchanged; and
- the Run outline reports whether this was its only active semantic recipient and whether operator
  attention is now required.

This matches the existing Coordinator's soft-interrupt behavior and makes its consequence explicit.
It does not mark the Run stopped or report zero ownership.

Whole-Run `stop()` remains the only ordinary operation that snapshots the transitive target set,
closes dispatch, kills/reaps every exact owned process group, and releases worktrees, runtimes,
capacity, branches, exports, Context owners, recovery leases, and lineage authority. Extend Run-stop
completion validation so `checks.dispatchClosed` also requires every target-Run control row to be
terminal. The public stop receipt shape need not grow another internal count. An immediate reattach
must still show non-null stop truth, `remainingCount: 0`, and zero current-Run ownership, while the
resident writer/listener remains open.

## Direct, Web, MCP, bridge, browser, and CLI parity

Add `run.send` and `run.interrupt` to `APPLICATION_COMMAND_DEFINITIONS` with `reconcilable: true`.
Because Web and MCP derive application commands from that table, they should use the same
application dispatcher and internal control ledger. Do not add special raw Web `send`/`interrupt`
handling for the ordinary operations; those existing commands remain advanced worker-coordinate
compatibility controls.

Every command port supplies hidden invocation context:

- the direct port mints and retains a request/idempotency identity for one method invocation;
- the Web port uses the original Web command ID/key;
- MCP uses its durable call identity;
- the Web-to-MCP bridge preserves the originating logical identity rather than minting one for each
  cascade step.

`BatonWebClient.command()` must retain the exact original envelope. On a lost POST response it
reauthenticates and reads the original command status. A terminal status returns the persisted
outcome. A still-admitted reconcilable command is re-POSTed with the same command ID,
idempotency key, args, Run, and origin so the resident can resume dispatch. A status `404` after a
connection replacement permits the same exact POST, not a fresh command. Changed args conflict.
This recovery is bounded and redirect/body/time limits remain in force.

Completed replay still rechecks current capability, repository, Run scope, subject, and semantic
registry authority before revealing the result. Downgrade denies replay without rerunning the
effect. Web command status may retain its advanced sanitized command identifier, but bound
`BatonRun` methods, ordinary JSON output, help, and streams never expose it.

The browser replaces its raw worker-target steering form with recipient and delivery choices from
the attached outline. CLI becomes `baton run RUN_ID send MESSAGE [--recipient work|review|ROLE]
[--delivery nudge|turn|now]` and `baton run RUN_ID interrupt [--recipient ...] --reason REASON`.
CLI and browser do not implement target resolution, interrupt/send composition, retry loops, or
provider settlement.

## Context-sensitive help

The registry adds `run.send` and `run.interrupt` operation/help topics and matching live action
descriptors. `run.help()` remains about the attached Run. `run.help('send')`,
`run.help('interrupt')`, and `run.help('stop')` explain:

- the default recipient and currently available closed recipient choices;
- `nudge`, `turn`, and `now` consequences;
- selective interrupt versus whole-Run stop/reap;
- confirmation, refusal, and honest uncertainty;
- which fields are server-derived;
- current authorization/availability in closed safe categories; and
- the next safe action after `outcome_unknown`.

Help must never display the resolved worker, fence, provider request, session coordinate, internal
deadline, retry count, event ceiling, or control receipt. Registry definitions, validation,
outline descriptors, card metadata, CLI, browser, Web, MCP, and help must share one registry digest.

## Follow-on vertical: Run-scoped resumable streams

Once control settlement is green, add one registry operation:

```text
run.stream(runId, channel, checkpoint?)
channel = events | output | progress
```

The bound client projects it as:

```js
for await (const event of run.events()) { /* semantic Run events */ }
for await (const item of run.output()) { /* bounded untrusted output */ }
for await (const update of run.progress()) { /* meaningful progress only */ }
```

The client owns server-derived page size, long-poll timing, reconnect, ticket rotation, duplicate
suppression, and its last processed checkpoint. An optional opaque checkpoint can be persisted by
an advanced caller for cross-process resume, but it is an application checkpoint, not a raw
coordination sequence or SSE `Last-Event-ID`.

All channels use one ordered coordination boundary and at-least-once resume:

- `events` projects Run/authorized-descendant semantic changes, attention, control settlement,
  terminal cause, stop admission, and exact zero-reap facts. It never emits raw ledger events.
- `output` projects bounded full message/result prose and safe tool/file activity summaries as
  untrusted content. It excludes hidden reasoning, token/thought deltas, raw tool arguments,
  credentials, paths outside approved relative scope, and provider wire frames.
- `progress` projects only durable meaningful transitions already defined by Phase 89. Polls,
  traffic, token chatter, and observation time do not manufacture progress.

For output ordering, map stream-eligible operational events into coordination with the existing
`evidence.mapped` pattern. The mapping stores the source worker sequence/digest while prose remains
in the bounded operational log. The Run projector verifies the mapping and dereferences the source.
This gives all three channels one coordination cursor without copying every token into a second
event store. Missing/expired source evidence produces `snapshot_required`; it never fabricates or
skips output silently.

The first page contains one atomic RunView snapshot and checkpoint. Every frame is filtered by the
application's existing Run-belonging logic plus current recursive scope. The server binds an opaque
checkpoint to repository, Run, channel, registry identity, authorization scope, and projection
policy. Old/out-of-window/incompatible checkpoints return `snapshot_required`; the client refreshes
the bounded snapshot and clearly emits that boundary.

For authenticated Web, extend the existing stream-ticket authority rather than creating a WebSocket
or a second stream service. A ticket additionally binds Run, channel, current user/session,
credential, Origin, capability/Run scope, registry digest, and resident incarnation. Tickets stay
random, hashed, short-lived, count-bounded, single-use, and non-durable. After resident restart the
client authenticates, obtains a new ticket, and resumes the durable application checkpoint. An old
incarnation's ticket fails. Capability loss or revocation closes the established stream before its
next frame. Disconnect, tab suspension, backpressure, and cursor expiry remain observation-only and
never call interrupt or stop.

Backpressure may coalesce ordinary progress, but attention, control settlement, terminal cause,
stop admission, and final zero-reap facts must be delivered or replaced by `snapshot_required`.
Server policy owns frame, buffer, scan, and replay ceilings. No ordinary method accepts those
numbers.

## Exact source seams

Implement the control vertical in these existing seams:

1. **Registry and help — `impl/src/application-semantics.mjs:88`, `:144`, `:493`.** Add the two
   closed operations, shared control definitions/action descriptors, help topics, CLI projections,
   required capabilities, effect/reconciliation metadata, and a registry version bump. Generate
   operation and action metadata from one definition to avoid schema drift.
2. **Bound API — `impl/src/application-client.mjs:628`.** Add `BatonRun.send()` and
   `BatonRun.interrupt()` with exact option validation and semantic results. Keep `steer()` as an
   explicitly advanced compatibility method. Update `bindBaton()`/`bindBatonPort()` near `:1168`
   so direct and transport ports hide invocation identity consistently.
3. **Command definitions/validation — `impl/src/application.mjs:58` and `:851`.** Register and
   validate the new commands. Extend command context only internally; request JSON cannot inject
   actor, session, registry digest, target, fence, or provider identity.
4. **Application authority — `impl/src/application.mjs:1520`, `:7169`, `:8086`, and `:8189`.** Add
   semantic recipient resolution, live descriptors, admission/settlement projection, and the two
   dispatcher branches. Reuse `_assertRunMutable` and semantic authorization. Do not implement the
   ordinary methods by manufacturing a raw `run.steer` request.
5. **Startup and stop composition — `impl/src/application.mjs:1388`, `:1808`, `:2368`, and
   `:8220`.** Add bounded control reconciliation, stop/control barrier handling, and the requirement
   that Run-stop completion sees no nonterminal target-Run controls. Keep emergency stop out of a
   hung network promise chain.
6. **Durable state — `impl/src/coordination-store.mjs:567`, `:7173`, `:9331`, and `:9689`.** Add
   replay-validated control maps/events/APIs, per-recipient ordering, hidden-invocation
   idempotency, pending scans, and atomic stop-versus-control admission. Follow the first-class
   Run-stop/recovery/retry patterns rather than loose `driver.recorded` projections.
7. **Coordinator boundary — `impl/src/coordinator.mjs:4878`, `:4940`, `:5139`, and `:5350`.** Pass
   the admitted provider request identity, preserve the current delivery-slot fence recheck, map
   exact provider/control observations, and distinguish proven `notSent` from ambiguous failures.
   Keep `sendChain` as a defensive local ordering layer.
8. **Adapters — `impl/src/adapter.mjs:366` and each native adapter's `prompt`/`interrupt` methods
   (`codex-appserver.mjs:952`, `grok-acp.mjs:831`, `kimi-acp.mjs:602`,
   `claude-session.mjs:893`).** Accept optional internal control context, correlate native request/
   turn evidence, and report reconciliation capability honestly. Preserve the eight-verb adapter
   interface; do not add a public ninth control plane.
9. **Web reconciliation — `impl/src/web-northbound.mjs:540`, `:647`, and `:799`; and
   `impl/src/application-cli.mjs:1130`.** Reuse derived application-command dispatch, preserve the
   admitted semantic identity, and teach the client to status-read/re-POST the exact lost envelope.
10. **Thin projections — `impl/src/mcp-web-bridge.mjs:192`, `impl/src/mcp-northbound.mjs`,
    `impl/src/web-operator.mjs:114`, and `impl/src/application-cli.mjs`.** Project the same
    registry/outcome; remove ordinary worker target and raw reconciliation choreography.

Implement streams only after those seams are green:

11. **Run projection — `impl/src/application.mjs:5750` through `:5965`.** Generalize the existing
    Run event filter/follow page into channel projections and opaque checkpoints; retain one
    semantic progress definition.
12. **Output mapping — `impl/src/coordinator.mjs:7470` and the default event append near `:7950`.**
    Map only bounded stream-eligible output observations into coordination, retaining untrusted
    content classification and exact operational source digests.
13. **Web stream — `impl/src/web-stream.mjs:20`.** Bind ticket and projection to Run/channel and
    replace the ordinary repository snapshot with the application RunView boundary. Retain the
    current advanced repository stream only behind the advanced surface if compatibility requires
    it.
14. **Client iterator — `impl/src/application-client.mjs:628` and the command port.** Add one
    resumable iterator implementation and the three small channel helpers; do not duplicate retry
    logic per helper.

## RED tests to write first

Create `impl/test/phase90-durable-run-control-red.test.mjs` and make these the first control gates:

1. **DC1 — closed ordinary API:** registry, client, card, help, CLI, Web, MCP, bridge, and browser
   expose `send`/`interrupt` from one digest; unknown options and all worker/fence/request/budget/
   limit fields refuse before store or adapter calls.
2. **DC2 — semantic resolution:** `'work'`, `{role}`, and `'review'` resolve the exact current
   generation; absent/ambiguous roles refuse with attention; a replacement between resolution and
   effect is not substituted.
3. **DC3 — complete admission binding:** inspect internal test state and assert semantic recipient,
   current worker generation/fence, delivery, message/reason digests, actor/principal/session,
   registry digest, provider request identity, predecessor, and request/admission digests. Request
   JSON cannot override any derived field.
4. **DC4 — exact idempotency:** identical hidden-invocation replay returns one settlement and one
   adapter call; changing message, reason, recipient, delivery, Run, actor/session, or registry
   conflicts without mutation.
5. **DC5 — crash before effect:** crash after admission but before `dispatch_started`, restart,
   and prove exactly one adapter delivery with the original message and provider request identity.
6. **DC6 — provider Ack/settlement gaps:** inject crash after provider acceptance before evidence,
   after durable evidence before settlement, and after settlement before response. Provider lookup
   or mapped evidence confirms where possible; an unreconcilable boundary becomes
   `outcome_unknown`; none redeliver.
7. **DC7 — refusal honesty:** stale/terminal/unattached targets, current stop fences, policy
   downgrade, and explicit `notSent` settle refused; thrown/response-less ambiguous delivery never
   does.
8. **DC8 — concurrent order:** block the first adapter call, admit two same-recipient sends, restart
   between them, and assert adapter order equals durable admission order. A first unknown blocks the
   second. Independent roles may overlap.
9. **DC9 — send/interrupt matrix:** exercise both admission orders plus fence change during send;
   prove no implicit follow-up, no replacement substitution, and explicit
   `delivered_despite_state_change` when delivery is known.
10. **DC10 — interrupt/stop matrix:** exercise stop-before-interrupt, interrupt-before-stop, stop
    while interrupt is admitted, and stop at an ambiguous provider boundary. Assert one durable
    winner, no post-stop turn, and no false session-preservation claim.
11. **DC11 — selective preservation:** interrupt one of two overlapping workflow roles; prove its
    turn and interactions close, its provider session/process/worktree remain reusable, its sibling
    is unchanged, a later explicit turn can reuse it, and subsequent Run stop kills/reaps it.
12. **DC12 — exact stop closure:** stop with admitted/dispatching/unknown controls and descendants;
    prove all controls terminal, non-null stop truth, `remainingCount: 0`, equal observed/closed
    process counts, zero Run ownership after reattach, sibling/resident survival, and exact restart
    replay.
13. **DC13 — Web response loss:** lose the initial POST response, return admitted across resident
    restart, and lose the completion response. The client status-reads and re-POSTs the same
    envelope; adapter count stays one; changed replay conflicts; current-authority downgrade hides
    the persisted result.
14. **DC14 — direct/Web/MCP parity:** invoke equivalent semantic controls through each port and
    compare registry identity, semantic recipient, delivery, settlement, attention, and resulting
    Run digest while proving no outward internal coordinates.
15. **DC15 — sentinel leakage:** place unique token, session, provider request, worker, fence,
    private path, message, reason, and receipt sentinels in internal state and assert they are absent
    from ordinary outlines, errors, help, command status, audits, CLI JSON, browser state, and MCP
    results except for explicitly authorized semantic message/output content.

Then create `impl/test/phase90-run-streams-red.test.mjs`:

1. **RS1 — atomic Run boundary:** each channel starts from one authorized RunView/checkpoint and
   never exposes a repository snapshot, sibling Run, unauthorized descendant, raw sequence, worker,
   receipt, path, session, or authority field.
2. **RS2 — channel truth:** events contain semantic lifecycle/control/attention/terminal facts;
   output is bounded and marked untrusted; progress advances only on meaningful transitions.
3. **RS3 — restart resume:** consume through checkpoint N, restart the resident, obtain a new
   ticket, and receive ordered at-least-once frames after N without interpreting disconnect as
   termination.
4. **RS4 — ticket and live scope:** cross-Run/session/credential/origin/incarnation ticket use,
   reuse, expiry, revocation, and capability downgrade all fail before the next frame.
5. **RS5 — gap and pressure:** stale checkpoints, missing mapped operational output, oversized
   frames, and buffer pressure yield bounded `snapshot_required`; terminal, stop, interrupt, and
   zero-reap truth is never silently lost.
6. **RS6 — direct/Web parity:** direct long-poll and authenticated Web SSE produce identical frame
   IDs, semantic payloads, checkpoints, and terminal boundaries while transports retain their own
   security behavior.
7. **RS7 — observation is inert:** disconnect, reconnect, abort, tab suspension, and cursor expiry
   cause zero Coordinator send/interrupt/kill calls and no coordination effect admission.

Existing tests remain important supporting gates rather than substitutes: the fence/send races in
`phase8-correctness.test.mjs`, queued-send stop guards in
`phase10.1-reconciliation.test.mjs`, Coordinator interrupt confirmation tests in
`coordinator.test.mjs`, Web status tests in `phase12-web-command-status.test.mjs`, Run stop/isolation
tests in `phase64-integrated-run-application.test.mjs`, progressive registry/help tests in
`phase67-progressive-agent-experience.test.mjs`, preserved stop tests in
`phase70-preserved-stop.test.mjs`, and resident application tests in
`phase89-resident-application-red.test.mjs`.

## Overengineering to reject

- Do not build a general durable actor/message broker. Two Run mutations and one existing
  coordination log are enough for this slice.
- Do not expose `ControlReceipt`, `WorkerHandle`, idempotency key, provider request, fence, or event
  page size in the ordinary API. A public receipt would turn recovery machinery into caller
  choreography.
- Do not promise provider exactly-once where the provider offers no request reconciliation. The
  correct state is `outcome_unknown`, followed by attention and an exact stop/recovery choice.
- Do not serialize an entire Run behind a network promise. Durable admission ordering is short;
  independent recipients remain concurrent and emergency stop remains preemptive.
- Do not implement `now` in CLI/browser as two calls. Its interrupt-and-next-turn behavior is one
  server-owned durable cascade.
- Do not replace the adapter interface with a second application-control adapter. Add optional
  internal correlation/reconciliation context to the existing `prompt`/`interrupt` boundary.
- Do not make the current repository-wide `WebEventStream` the ordinary attached stream by adding
  more redaction. Start from a RunView and a Run-bound projector.
- Do not stream raw tokens, hidden reasoning, raw coordination events, or provider frames. They add
  volume and leakage without semantic progress.
- Do not add WebSockets, Kafka, a cursor database, callbacks, arbitrary selectors, or Python/
  TypeScript Program execution in this vertical. Long-poll plus the existing SSE ticket transport
  can project the same application feed.
- Do not merge selective interrupt with Run stop, member stop, fleet drain, or resident shutdown.
  Their ownership and settlement claims are intentionally different.

## Composition preserved

This design leaves the later architecture open in the right places:

- Recursive Runs can extend semantic recipients to authorized descendants while the admission
  still binds exact lineage generation and subtree stop.
- Shared tasks can add a closed task-role recipient and immutable shared-state lineage without
  exposing an assignee worker.
- RLM/Context loops can use `send`, `interrupt`, and progress checkpoints at durable effect
  boundaries; they do not need a parallel REPL control transport.
- Slate-style resumable workstreams can map `notify` to semantic `send` and workstream stop to the
  existing exact transitive ownership authority. A session is never mistaken for a process or
  durable logical identity.
- Atlas facts and Cairn knowledge remain evidence/output projections with source lineage, not
  authority-bearing messages. Stream summaries cannot grant completion, selection, or integration.
- Future Program IR can compile `notify`, `checkpoint`, `interrupt`, and `stop` into these same
  durable application effects. It need not teach callers fences, budgets, receipts, or transport
  cursors.

The smallest credible Phase 90 claim is therefore: semantic send and selective interrupt settle
durably and replay honestly through every ordinary port; stop still proves exact zero ownership;
then Run-scoped streams make that truth progressively observable. Anything less leaves the resident
surface pleasant but unsafe, and anything substantially larger delays the effect boundary that the
current tree actually lacks.

## Verification

Pinned command `node` was run through the required `rtk` wrapper as `rtk node` on 2026-07-19.
Exit code: `0`. Output: empty.
