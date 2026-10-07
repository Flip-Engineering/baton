# Phase 90 — Durable Run control: control-authority design review

Role: independent durable-control-authority designer (route `glm`/`glm-5.2`/`xhigh`).
Date: 2026-07-18 evidence pack (review written 2026-07-19).
Companion: `codex-run-control-ax-review.md` (progressive-run-control-AX role).
Precedent: `../phase89-resident-application-dogfood-live-2026-07-18/glm-resident-review.md` (this
slice is that review's explicit "C5 later slice": crash-safe send/interrupt settlement and
Run-scoped streaming).

## 1. Scope, method, and verification evidence

Inspected against `spec/phase89-authenticated-resident-application.md` §2.3, §8.3, §8.7 and the
acceptance-red `spec/phase89-authenticated-resident-security-matrix.md` §4 (CA), §5 (CS), §6 (SR),
§7 (SV), with `spec/phase70/preserved-stop-and-resumable-work.md` (PS) and
`spec/phase86-progressive-execution-ax-and-dogfood-integrity.md` (PX) as the stop/reap and
progressive-AX authority. Slate's thread-weaving/episodic-memory framing is read as
`docs/28-exhaustive-capability-audit.md:478-495` (an addressed-Episode projection over existing
authority, not a second ledger).

Source seams inspected (file:line verified by reading the code, not grep alone):

- `impl/src/application.mjs` — `APPLICATION_COMMAND_DEFINITIONS` (57-80), `semanticViewDigest`
  (99), `semanticAuthorityForAction`/`authorityDigest` (256-289), `_withRunEffect` per-Run serial
  chain (1444), `_authorizeSemanticAuthority` CA4 (1520-1543), `_resolveSemanticAction` CA2
  (1562-1570), `_recheckSemanticAction` CA7 (1587-1599), `_reconcileWorkflowMemberStops` restart
  re-perform (1825-1850), `_performRunStop` exact-stop barrier (2368-2454), `_assertRunMutable`
  stop-race gate (2456-2462), `stopWorkflowMember` role→worker durable member-control (4573-4654),
  `_semanticActionId` action-identity digest (5967-5980), `follow()`/`_followPage()` Run-scoped
  long-poll (5869-5965), `_semanticActions` live action catalog (7169-7280), `act()` dispatch +
  re-resolution (7832-8040), `card()` (8042), `command()` dispatch (8086-8166), `steer()` non-durable
  raw path (8189-8218), `stop()`/`_stop()` (8220-8249).
- `impl/src/application-semantics.mjs` — action registry `actions` (144-417), capability source
  (419-441), `APPLICATION_SEMANTIC_REGISTRY.digest` (620-623). `send`/`interrupt` are absent.
- `impl/src/application-client.mjs` — `BatonRun` (630-906): `act()` (794), `stopMember()`→`act`
  (817-820), `steer()` raw (886-898), `stop()` (900-905). No `send`/`interrupt` methods.
- `impl/src/coordinator.mjs` — `send`/`_send`/`_deliver` fenced delivery (4871/4875/4939),
  `interrupt` session-preserving stop (5139), `kill` destructive reap (5169), `respond`/`_resolveRecord`
  (6613/6640), `interactionStatus` (6623), `_finalizeStop` interrupt-vs-kill branch (6487-6524).
- `impl/src/fence.mjs` — in-memory `FenceTable` (1-64); `check` is the only stale-guard; never rehydrated.
- `impl/src/coordination-store.mjs` — `admitRunStop` (9689-9723), `runStop` (9331), `completeRunStop`
  (9725-9741), `admitWebCommand`/`completeWebCommand`/`failWebCommand` (9798-9824),
  `admitRunVerificationRetry` (9557-9572), `admitRunLineage` (1199-1227), append-only substrate
  `_append` + `_byKey` idempotency (726-746), restart replay `_load()` (702-724), unsettled-admission
  scanners `pendingRunStops` (9683), `pendingRunVerificationRetries` (9408).
- `impl/src/web-stream.mjs` — stream-ticket `issue` (84-108)/`consume` (140-154)/`open` (156-275):
  the ticket binds `repoId`/`sessionId`/`credentialId`/`origin` but **not `runId`** and **not
  incarnation**; cursor resume + `snapshot_required` already exist (156-275); frames are repo-wide
  (`_projectSnapshot` 389-395, frame `resource:{repoId}` 210).
- `impl/src/web-northbound.mjs` — `execute` ordering: `run_act` authority preflight (564-590) →
  `edge.takeCommand` quota (595) → `admitWebCommand` (604); reconcilable re-dispatch (647-687) and
  completed-outcome replay (692-726); `scopeKey` (561); `RECONCILABLE` set (24-25).
- `impl/src/application-cli.mjs` — `BatonWebClient.command` single-POST + GET-poll `reconcile`
  (1130-1190); `_json` throws `cli_transport_failed` on mid-POST loss (1047-1058) — no re-drive today.
- `impl/test/phase87-semantic-action-authority.test.mjs` (SA1-SA4 authority) and
  `impl/test/phase89-resident-application-red.test.mjs` (RA1-RA13) + `impl/test/phase64-integrated-run-application.test.mjs`
  — authority tests to extend and the pinned verification targets.

Method: static read of the above plus live execution of the repo's own verification commands. No
nested Baton was invoked; only read-only inspection and the pinned `node --test` commands were run.
`rtk` was used for every shell command, one command per call. No credentials, harness installations,
global configuration, or the main checkout were mutated; the only file written is this review.

Verification evidence (deployment verification command is `node`, per this evidence pack's `run.mjs`):

```
node --test impl/test/phase64-integrated-run-application.test.mjs \
          impl/test/phase89-resident-application-red.test.mjs
ℹ tests 42  ℹ pass 42  ℹ fail 0   (UA3–UA8 + RA1–RA13 incl. all sub-cases)
```

The bare deployment-verification command `node` exits 0 in this non-interactive context. This review
adds no code and disturbs no test; the baseline stays green.

## 2. Verdict

The ordinary `run.send(message, options)` / `run.interrupt(options)` surface and the Run-scoped
resumable event/output/progress streams are **acceptance-red and currently absent** — confirmed by
the registry (`application-semantics.mjs` has no `send`/`interrupt` actions), the client (`BatonRun`
has no `send`/`interrupt` methods), the command bus (`APPLICATION_COMMAND_DEFINITIONS` has no
`run.send`/`run.interrupt`), and the coordination store (no `admitRunControl`/`runControl`/\
`completeRunControl`; zero matches for any send/interrupt admission kind). `run.steer` exists but is
the **raw, explicitly non-reconcilable** verb (`reconcilable:false`, `application.mjs:69`) and is not
crash-safe.

The good news — and the reason this is a small slice rather than a new subsystem — is that **every
authority the slice needs already exists and is green**:

- the semantic-action authority spine CA1-CA8/CA12/CA14 lives in `act()` + `_semanticActions` +
  `_semanticActionId` + `_authorizeSemanticAuthority` + `_recheckSemanticAction`;
- the exact-stop barrier PS1/SR1-SR15 lives in `_performRunStop` + `_assertRunMutable`;
- the per-Run serial effect ordering lives in `_withRunEffect`;
- the fenced provider-control primitives live in `coordinator.send`/`interrupt` (and `interrupt`
  already preserves the provider session — CS7 is satisfied at the coordinator layer,
  `_finalizeStop:6500-6524`);
- the durable admit→settle template lives in `admitRunStop`/`completeRunStop`;
- the response-loss replay template lives in `admitWebCommand`;
- the Run-scoped long-poll already lives in `run.follow`.

The single structural addition required is a **durable control-admission ledger entry** for
send/interrupt that mirrors `admitRunStop` and introduces the missing `outcome_unknown` settlement
state (CS4/CS12). Everything else is thin projection of `send`/`interrupt` onto the existing
`run.act` authority and the existing stream ticket — not a second control plane, and no internal
receipt is exposed to callers.

§3 states the design constraint that makes this small. §4 is the implementation-ready vertical.
§5 lists exact source seams. §6 gives the RED tests. §7 critiques overengineering. §8 preserves
later composition.

## 3. The one design constraint that makes the slice small

**`send` and `interrupt` are semantic actions under `run.act`, not new top-level commands.** This is
the decisive choice. The existing `run.act` spine already binds everything the brief requires through
**two complementary digests**:

- `_semanticActionId` (`application.mjs:5967-5980`) — the **action identity**, which binds the
  server-resolved recipient and worker generation into `target`:

  ```
  digest({ schemaVersion, registryDigest, repoId, runId, principalScopeDigest,
           profileDigest, planDigest, viewDigest, kind, target })
  ```
- `semanticAuthorityForAction().authorityDigest` (`application.mjs:256-289`) — the **CA3 authority
  digest** over `{actionId, kind, effect, requiredCapabilities}`.

Between them, registry/repo/Run/actor-session/plan/view (identity) and kind/effect/capabilities
(authority) are all bound; the recipient/worker/fence flows through the identity digest's `target`,
and `_recheckSemanticAction` (1587-1599) replays-fail-closed if either the actionId no longer resolves
or the `authorityDigest` changed (CA4/CA7). Adding `run.send`/`run.interrupt` as parallel top-level
commands would duplicate this entire spine (capability check, both digests, recheck, help,
CLI/Web/MCP/bridge projection) and would, by construction, be a second control plane — exactly what
the brief and matrix CA14 forbid. Treating them as actions (actionId `send`, `interrupt`) dispatched
through `run.act` inherits CA1-CA8, CA12, CA14, the cascading help, and direct/Web/MCP/CLI parity for
free. The precedent is already in tree: `stop_member` is an action invoked via `run.act` with a
`stopMember()` client convenience wrapper (`application-client.mjs:817-820`), and `stop` is
simultaneously an action (`actions.stop`) and the `run.stop` command. `send`/`interrupt` follow the
`stop_member` shape.

The only thing `run.act` does **not** do today is durable provider-effect settlement — its dispatch
(`answer_question`→`coordinator.respond`, etc.) is in-memory. CS1-CS12 demand crash-safe settlement,
so the one new substrate is a control-admission ledger entry that wraps the provider effect. That
ledger is a direct extension of `admitRunStop`, not a new control plane.

## 4. The smallest implementation-ready vertical

### 4.1 One Pythonic cascading Run API

Client surface (add to `BatonRun`, `application-client.mjs`, mirroring `stopMember` at 817):

```js
async send(message, options = {}) {
  if (!nonempty(message)) throw clientError('Run send message is invalid');
  exactOptions(options, new Set(['recipient', 'delivery', 'reason']), 'send');
  // recipient/delivery are closed semantic values; defaults resolve server-side.
  this.#last = await this.act('send', { message, ...options });
  return this.#last;
}
async interrupt(options = {}) {
  exactOptions(options, new Set(['recipient', 'reason']), 'interrupt');
  this.#last = await this.act('interrupt', { ...options });
  return this.#last;
}
```

`this.act('send'|'interrupt', …)` already validates the action against the live outline
(`application-client.mjs:794-810`) and refuses `application_action_unavailable` when the Run does not
advertise it. The caller never supplies a worker ID, fence, request ID, event limit, budget, or
transport coordinate.

Cascading, context-sensitive help (`spec` §5): `run.help('send')` and `run.help('interrupt')` resolve
through the existing `application.help` topic router. `send` help names the closed `delivery` values
(`turn` default, `now`, `nudge`) and their consequence; `interrupt` help states plainly that it ends
the current turn but preserves the provider session for a later authorized turn, and contrasts with
whole-Run `stop()`. The registry is the single help authority (PX1).

CLI (`application-semantics.mjs` `cliCommands`): add `run.send` → `baton run RUN_ID send "MESSAGE"
[--to work|ROLE|review] [--delivery turn|now|nudge]` and `run.interrupt` → `baton run RUN_ID
interrupt [--to …] [--reason "…"]`, projected from the same action registry so CLI/Web/MCP/direct
parity (CA12) is structural, not maintained.

### 4.2 `send`/`interrupt` as semantic actions with server-side recipient resolution

Registry entries (add to `actions` in `application-semantics.mjs`, beside `answer_question`/`stop_member`):

```js
send: {
  label: 'Send semantic guidance',
  summary: 'Deliver bounded guidance to the current semantic work recipient (work, a workflow role, or review).',
  inputSchema: objectSchema({
    message: { type: 'string', minLength: 1, maxLength: 4096 },
    recipient: { type: 'string', enum: ['work', 'review'], default: 'work' },   // role names added server-side
    delivery: { type: 'string', enum: ['turn', 'now', 'nudge'], default: 'turn' },
    reason: { type: 'string', minLength: 1, maxLength: 1024 },
  }, ['message']),
  serverDerived: ['workerId', 'fence', 'role', 'recipientDigest', 'providerRequest'],
  effect: 'provider_control', destructive: false, irreversible: false,
  idempotent: true, priority: 'recommended', helpTopic: 'run.act.send', expectedDepth: 'outline',
},
interrupt: {
  label: 'Interrupt the current turn',
  summary: 'End the current semantic work turn selectively while preserving the reusable provider session and unrelated members.',
  inputSchema: objectSchema({
    recipient: { type: 'string', enum: ['work'], default: 'work' },
    reason: { type: 'string', minLength: 1, maxLength: 1024 },
  }, []),
  serverDerived: ['workerId', 'fence', 'role', 'recipientDigest', 'providerRequest'],
  effect: 'provider_control', destructive: false, irreversible: false,
  idempotent: true, priority: 'recommended', helpTopic: 'run.act.interrupt', expectedDepth: 'outline',
},
```

with matching `APPLICATION_ACTION_CAPABILITY_SOURCE` entries `send: ['control','observe']`,
`interrupt: ['control','observe']`. The registry self-check at `application-semantics.mjs:448-451`
forces the capability map to stay in sync, so a forgotten entry fails loud.

Recipient resolution is **server-side and at-effect-time** (CA2/CA5/CA6). Today `_semanticActions`
(`application.mjs:7169`) fills `target` only for attention actions (`answer_approval`/
`answer_question`, 7181-7188) and `context_retry`; every `nextActions` entry gets `target:null`
(7175). The slice adds a `send`/`interrupt` branch that advertises them only when the current Run
view has an attachable, controllable worker (or, for a workflow Run, an active role; for a reviewing
Run, the review recipient), and fills `target = { workerId, fence, role, recipientDigest }` from the
**current** view — never from a caller-supplied or persisted coordinate. The role→worker resolution
model already exists in `stopWorkflowMember` (`application.mjs:4611-4616`: role → attempt binding →
node → task → `workerId = task.assignee`); `send`/`interrupt` reuse it. The filled `target` feeds
`_semanticActionId` (5978), so the actionId — and thus the replay check — binds the resolved
recipient. `act()` then calls `_resolveSemanticAction` (1562-1570, invoked at 7841), which re-resolves
the action from the view a second time immediately before effect, and `_recheckSemanticAction`
(1587-1599, CA7) re-runs the authority check. If the worker was replaced, route-changed, or stopped
between discovery and dispatch, the re-resolution fails closed (`application_action_scope_mismatch` /
`application_worker_not_controllable`) — CA6 "replacement is not substitution" is inherited from the
existing spine, not newly built.

This is the precise meaning of "callers never manage worker IDs, fences, request IDs": the client
sends `{message, recipient:'work', delivery:'turn'}`; the server binds `workerId`/`fence`/`role`/
`providerRequest` into `serverDerived` and into the authority digest, and never echoes them in the
ordinary outline (LX2/LX3 — they are evidence-depth only).

### 4.3 Durable control admission (the one new substrate)

Mirror `admitRunStop`/`completeRunStop` (`coordination-store.mjs:9689/9725`) exactly. Add:

- `admitRunControl(fields, auth)` — fields `['schemaVersion','repoId','runId','action','recipient',
  'recipientDigest','deliveryMode','messageDigest','reasonDigest','targetDigest','providerRequest',
  'principalScopeDigest','registryDigest','planDigest','viewDigest','requestDigest']`;
  `auth.key === \`run.control:${fields.runId}:${fields.action}:${fields.providerRequest}\``;
  `requestDigest === canonicalDigest({repoId,runId,action,recipientDigest,deliveryMode,messageDigest,
  reasonDigest,targetDigest,principalScopeDigest,registryDigest,planDigest,viewDigest,providerRequest})`.
  Replay-vs-conflict resolves through the substrate `_byKey` Map exactly as `admitRunStop` does at
  9697-9704 (same key+actor+requestDigest ⇒ `{result:'replay'}`; anything else ⇒
  `run_control_conflict`). Appends `run.control_admitted`; projection status `admitting`.
- `runControl(runId, providerRequest)` — reader, mirroring `runStop` (9331).
- `completeRunControl(runId, providerRequest, settlement, auth)` — appends `run.control_settled`
  with `settlement ∈ {confirmed, refused, outcome_unknown}` plus a bounded `receiptDigest`
  (no raw provider payload), mirroring `completeRunStop` (9725). Idempotent on the same key.
- `pendingRunControls(limit)` — scanner mirroring `pendingRunStops` (9683), returning admissions
  whose status is `admitting` or `delivering`, sorted by `admittedEvent`.

The binding the brief requires is the field list above: **semantic recipient** (`recipient`/
`recipientDigest`), **resolved worker and current fence at effect time** (`targetDigest` over
`{workerId,fence,role}`, captured at the effect boundary — see 4.5 — never a stale persisted fence),
**delivery mode** (`deliveryMode`), **message/reason digests**, **actor/session**
(`principalScopeDigest = digest({principalId,sessionId})`, already used at `application.mjs:7967`),
**registry digest** (`registryDigest = APPLICATION_SEMANTIC_REGISTRY.digest`), and **provider request
identity** (`providerRequest`, a Baton-minted id such as `control-${runId}-${workerId}-${seq}`,
because `coordinator.send` mints no durable identity of its own — coordinator.mjs:4987 only snapshots
the fence on the JS stack). The admission record is the durable Episode binding (see §8).

This is not the first durable member-control ledger in tree: `stopWorkflowMember`
(`application.mjs:4573-4654`) already resolves a role to a worker, admits a durable
`application.workflow_member_stop_admitted` event keyed `runId:planDigest:role` (4641-4646) with
same-`(role,reason,principal,session)` replay vs `application_workflow_member_stop_conflict`
(4597-4610), performs inside `_withRunEffect`, and is **re-driven on restart by
`_reconcileWorkflowMemberStops`** (`application.mjs:1825-1850`, which re-performs every `stopping`
admission after a crash). `admitRunControl` is the coordination-store analogue of that pattern for
crash-safe provider-control effects, and its restart sweep mirrors `_reconcileWorkflowMemberStops`
exactly. The ledger split is deliberate: `stop_member` reaps (`effect:'member_cleanup'`), so
`interrupt` (`effect:'provider_control'`, session-preserving) gets its own kind rather than
overloading the destructive one — preserving the `PROVIDER_EXECUTION_SETTLED_PHASES` distinction
(`application.mjs:50-52`).

### 4.4 Settlement: confirmed / refused / outcome_unknown, restart, response loss

The substrate currently has **no `outcome_unknown` state** — `admitWebCommand` settles only
`admitted`→`completed`|`failed` (`coordination-store.mjs:7287-7293`), and restart replay
(`_load()` at 702) re-derives projection purely from event kinds. CS4/CS12 therefore require
`outcome_unknown` to be a first-class settlement kind introduced by this slice. Semantics:

- **confirmed** — the durable log proves the provider acknowledged the effect (for `send`, the
  after-the-fact `control.send`/`control.steer`/`control.nudge` event at coordinator.mjs:5018-5023;
  for `interrupt`, `control.interrupt_confirmed` at 6472). Settle `confirmed`; no second delivery.
- **refused** — the durable log proves a typed refusal (`stale_fence`, `delivery_refused`,
  `worker_not_active`, `task_terminal`) or the recipient was already terminal/unattached (CS8). Settle
  `refused`; never report a stale recipient as newly interrupted.
- **outcome_unknown** — admission is durable but the provider acknowledgement cannot be reconciled
  (the process died between `control.stop_requested`/delivery and the two-phase confirmation). Settle
  `outcome_unknown`, attach a bounded attention item, and **do not** automatically retry (CS4). This
  is the honest terminal for an irreconcilable effect boundary.

Restart reconciliation (CS1-CS4, CS12): on `_load()` replay, the projection repopulates
`run.control_*` admissions; the driver's startup sweep (the existing pattern that consumes
`pendingRunStops`/`pendingRunVerificationRetries`) additionally consumes `pendingRunControls()`. For
each, it **re-resolves the current worker and current fence** (CA2 — never trusts a persisted fence),
then:

1. **admitted before provider boundary** (CS1) → resume exactly one delivery through
   `coordinator.send`/`interrupt`;
2. **provider acknowledged, not settled** (CS2) → settle `confirmed` from the durable ack event,
   never repeat the message;
3. **settled before response returned** (CS3) → the existing admission is the answer; the client
   re-reads durable status;
4. **ack unreconcilable** (CS4) → settle `outcome_unknown`;
5. an admitted control never remains permanent `admitting`/`delivering` (CS12) — the sweep converges
   every admission to one of the three terminals before readiness (RD14).

Response-loss replay (distinct from crash reconciliation): the **server** side already handles it.
`execute` derives `scopeKey = hash({userId, command, repoId, idempotencyKey})`
(`web-northbound.mjs:561`) and admits via `admitWebCommand` (9798); a re-POST of the same `run.act`
envelope with the same idempotency key resolves to the same scopeKey and either returns the stored
outcome (`replayed:true`, `web-northbound.mjs:692-726`) or, if still merely `admitted`, re-dispatches
the admitted command exactly once and stores the outcome (`web-northbound.mjs:647-687`) — never a
second provider effect. Because `send`/`interrupt` ride `run.act` (`reconcilable:true`,
`application.mjs:62`), they enter the `RECONCILABLE` set automatically (`web-northbound.mjs:24-25`),
and the durable control admission is what makes that re-dispatch idempotent.

One honest gap the slice must close: the connected client does **not** currently re-POST on transport
loss. `BatonWebClient.command` (`application-cli.mjs:1130-1144`) only GET-polls `/v1/commands/:id`
after a successful `admitted` response, and `_json` (`application-cli.mjs:1047-1058`) throws
`cli_transport_failed` on a mid-POST fetch failure with no retry. CS3 therefore needs a small,
localized client change: on transport loss, re-POST the **same** `{commandId, idempotencyKey}` and,
on 409 `idempotency_conflict` or 202 `admitted`, fall back to `reconcile(commandId)` instead of
throwing — not a new transport. (This is the same hardening the precedent review's D3/D4 flagged for
the connected client.)

### 4.5 Ordering and races

- **Concurrent sends serialize (CS9).** All send/interrupt provider effects run inside
  `_withRunEffect(runId, …)` (`application.mjs:1444`), the existing per-Run serial chain. Combined
  with the substrate's `admittedEvent` ordering, two concurrent messages to one recipient preserve
  durable admission order and cannot overtake each other at `coordinator._deliver` (which is already
  per-worker serial, coordinator.mjs:4939).
- **send versus interrupt (CS10).** Both are provider-control admissions on the same Run, so they
  serialize through the same `_withRunEffect` chain. The race therefore has one honest
  effect-boundary result. If an interrupt lands after a send was already delivered to a now-stale
  turn, the interrupt re-resolution sees the bumped turnEpoch and surfaces
  `delivered_despite_stale`/`stale_fence` rather than ordinary success (the coordinator already
  emits `control.stale_rejected`/`control.delivery_amended`, coordinator.mjs:4994-5010).
- **interrupt versus stop (CS11).** Once `run.stop` is durably admitted (`admitRunStop`), every
  mutable command — including the send/interrupt dispatch — passes through `_assertRunMutable`
  (`application.mjs:2456-2462`), which throws `application_run_stopped`/`application_run_stopping`.
  Interrupt therefore cannot queue a follow-up turn or preserve authority that stop must reap. The
  in-flight `coordinator.interrupt` waiter is already escalated to an exact kill on authority loss
  (phase86 PX acceptance evidence), so an interrupt racing stop converges to stop's reap.
- **Selective interrupt preserves the session (CS7).** `coordinator.interrupt` ends the current turn
  via `adapter.interrupt` and, in `_finalizeStop`, parks the handle (`handle.status = 'idle'`,
  coordinator.mjs:6522) without `_removeRuntimeScope` or `_removeOwnedTaskWorktree`. This is already
  true; the slice exposes it as the ordinary `interrupt()` and guarantees that a later authorized
  turn can reuse the same provider session. Contrast `kill` (6487-6499), which is what `stop()` uses.
- **Exact stop/reap preserved (PS1/SR).** `send`/`interrupt` add no cleanup path of their own. Stop
  continues to flow through `_performRunStop` (2368): fence+stop the provider, prove exact process
  closure (`processesObserved === processesClosed`), preserve+checkpoint, then reap, with the strict
  invariant at 2401-2406 that otherwise throws `application_run_stop_incomplete` and retains
  ownership (SR12). `run.control_settled:outcome_unknown` is attention, never a substitute for stop's
  zero-ownership proof.

### 4.6 Run-scoped resumable event/output/progress streams (SV1-SV7)

Two streaming surfaces exist today: `run.follow` (Run-scoped long-poll, `application.mjs:5896`,
cursor = coordination-log seq, frames filtered to the Run — already SV-shaped) and the SSE stream
(`web-stream.mjs`). The SSE ticket is the gap: `issue` (84-108) and `consume` (140-154) bind
`repoId`/`sessionId`/`credentialId`/`origin` but **not `runId` and not incarnation**, so an attached
stream today begins from a repository-wide coordination snapshot (matrix §1; SV1).

The slice makes the SSE stream Run-scoped without a second stream substrate:

- **SV1 RunView snapshot boundary.** Today the SSE `open` (`web-stream.mjs:156`) begins from a
  repository-wide snapshot — `_projectSnapshot` clones the whole coordination snapshot (389-395) and
  every frame carries only `resource:{repoId}` (210). The slice routes `open` through the same
  `_buildView` projection that `run.inspect`/`run.follow` use, so the stream begins from one atomic
  **Run**-scoped RunView plus the durable semantic cursor and the stream/outline never disagree.
- **SV3 ticket coordinates.** Extend the ticket to bind `{repoId, runId, userId, sessionId,
  credentialId, origin, capabilityScope, incarnation}`. `runId` and `incarnation` are the two added
  fields; `consume` checks both.
- **SV2 event scope filtering.** Frames emit only the authorized Run and permitted descendants
  (reusing `run.follow`'s Run filter at `_followPage`, 5869-5882); sibling Runs/Goals/Plans/workers
  never appear.
- **SV5 restart resume + SV6 incarnation invalidation.** Cursor resume and bounded
  `snapshot_required` **already exist** at the SSE layer: `open` honors `Last-Event-ID`/`?cursor=`,
  resumes at `requested+1`, and returns 409 `snapshot_required` with a `snapshotCursor` when the
  requested cursor falls outside the replay window (`web-stream.mjs:156-275`). The slice makes that
  cursor a durable **Run-scoped** cursor and adds `runId`+`incarnation` to the ticket so an
  old-incarnation ticket fails `consume` against a replacement resident (SV6). Memory-only tickets do
  not survive restart (RR5), so re-ticket-then-resume is already the model; `beginIssue`
  (`web-stream.mjs:110-128`) already rolls back an undelivered ticket so the client must re-ticket.
  Terminal facts are delivered or replaced by bounded `snapshot_required` (SV9), never silently dropped.
- **SV7 live authorization.** `_liveAuthorized` (web-stream.mjs:77-82) already terminates issuance;
  extend the open-stream poll to re-run it before each frame so expiry/revocation/capability or
  Run-scope loss closes the stream before its next event (AA12/SV7).
- **SV8 observation is effect-free.** Disconnect/backpressure/cursor expiry never call
  `coordinator.interrupt`/`kill`; the stream is a read over the same projection `run.inspect` uses.
- The ordinary `run.follow` cursor is already restart-stable (it is a coordination-log seq replayed
  by `_load()`); volatile observed-time is already excluded from the semantic digest
  (`semanticViewDigest`, `application.mjs:99-102`), so SV10-SV16 timing invariants are inherited.

### 4.7 Web/direct parity, no second control plane, no exposed receipts

Because `send`/`interrupt` are `run.act` actions, every surface (direct `BatonRun`, `BatonWebClient`,
browser, MCP, bridge, CLI) dispatches the same `run.act` command and derives the same
`semanticAuthorityForAction` digest — CA12 transport parity is structural. The Web `execute` path
derives actor/capabilities/fence server-side (AA16), so request JSON cannot inject a recipient, worker
generation, or fence. Riding `run.act` also yields the correct **cost ordering**: for `run_act` the
semantic-authority preflight (`web-northbound.mjs:564-590`) runs *before* `edge.takeCommand` quota
(595) and *before* durable `admitWebCommand` (604), so a refused send/interrupt consumes neither
privileged quota nor a durable admission (LX11 ideal — the gap the precedent review's C4 flagged for
raw commands does not apply here).

No internal receipt is exposed: the outline carries only `send`/`interrupt` in `actions` with closed
input schemas and contextual help (CA1); `workerId`/`fence`/`providerRequest`/`requestDigest` are
evidence-depth coordinates, surfaced only at `depth:'evidence'` and never in list/outline/status
(LX2/LX3, matching how `stop` already hides `workerIds`/`fences` behind `serverDerived`).

## 5. Exact source seams

| Change | File:line | What |
|---|---|---|
| `send`/`interrupt` action definitions + capabilities | `application-semantics.mjs:144` (actions), `:419` (cap source) | New actions; self-check at `:448` enforces capability sync. Registry digest changes → bump `core.version` (`:606`). |
| Advertise `send`/`interrupt` from current view | `application.mjs:7169` (`_semanticActions`) | Add candidate kinds resolved to `{workerId,fence,role}` from the live view. |
| Dispatch `send`/`interrupt` in `act()` | `application.mjs:7930-8038` (the `action.kind` chain) | Two new `else if` branches calling the durable control path (4.3/4.4). |
| Durable control admission | `coordination-store.mjs:9689` (beside `admitRunStop`) | `admitRunControl`/`runControl`/`completeRunControl`/`pendingRunControls` + projection on `run.control_admitted`/`run.control_settled` (beside the `run.stop_*` projection at 7173-7253). |
| Effect-boundary perform + settle | new private method on the application, invoked from the `act()` branches inside `_withRunEffect` (`application.mjs:1444`) | Re-resolve worker+fence, call `coordinator.send`/`interrupt`, settle confirmed/refused/outcome_unknown. |
| Stop-race gate | `application.mjs:2456` (`_assertRunMutable`) | Already present; the new dispatch must call it (no change to the gate). |
| Client `send`/`interrupt` | `application-client.mjs:817` (beside `stopMember`) | Thin wrappers over `this.act(…)`. |
| Client response-loss re-drive | `application-cli.mjs:1130` (`BatonWebClient.command`) | On transport loss, re-POST the same `{commandId,idempotencyKey}` and fall back to `reconcile` on 409/202 instead of throwing (§4.4). |
| SSE ticket Run+incarnation binding | `web-stream.mjs:84` (`issue`), `:140` (`consume`), `:156` (`open`) | Add `runId`/`incarnation` to the ticket and the consume check; route `open` through the Run-scoped `_buildView` instead of `_projectSnapshot` (`:389`). |
| Restart sweep | mirror `_reconcileWorkflowMemberStops` (`application.mjs:1825-1850`) | Consume `pendingRunControls()` at startup and re-perform/reconcile per §4.4; the server-side replay path (`web-northbound.mjs:647-687`) already re-dispatches admitted reconcilable commands. |
| CLI projection | `application-semantics.mjs:458` (`cliCommands`) | `run.send`/`run.interrupt` rows projected from the action registry. |

`run.steer` (`application.mjs:69`, `:8189`) is intentionally left as the advanced, raw,
non-reconcilable compatibility verb. Its authority is unchanged; the spec note that "historical
non-reconcilable steer remains honestly non-reconcilable until migrated" (§2.3) is preserved — it is
not silently upgraded, and it is not the ordinary surface.

## 6. RED tests

New focused suite `impl/test/phase90-durable-run-control-red.test.mjs`, named DC1-DC13 to mirror the
phase89 RA* convention. Each is acceptance-red until the corresponding §4 behavior lands.

- **DC1** `send`/`interrupt` are advertised as closed `run.act` actions with server-derived recipient
  and no caller worker/fence/requestId (CA1/CA2/LX2).
- **DC2** the action authority digest binds repo/Run/action/recipient-generation/capabilities/
  registry/actor-session; action-swap, target-swap, registry-drift, and forged-token fail before
  effect (CA3/CA4 — extend `phase87-semantic-action-authority.test.mjs`).
- **DC3** crash after durable `send` admission but before the provider boundary resumes **exactly
  one** delivery on restart (CS1).
- **DC4** crash after provider acknowledgement but before settlement never repeats the message (CS2);
  crash after settlement returns the persisted outcome (CS3).
- **DC5** irreconcilable acknowledgement settles typed `outcome_unknown` attention and is not
  auto-retried (CS4/CS12).
- **DC6** confirmed interrupt replays after response loss without another adapter call (CS6) and the
  provider session is reused by a later turn (CS7).
- **DC7** a stale/terminal/unattached recipient cannot be reported as newly interrupted (CS8).
- **DC8** two concurrent sends to one recipient preserve admission order and do not overtake at the
  adapter (CS9).
- **DC9** send-vs-interrupt has one honest effect-boundary result; delivered-despite-stale is
  surfaced, not returned as success (CS10).
- **DC10** once `run.stop` is admitted, `interrupt` cannot queue a follow-up turn or preserve
  authority stop must reap (CS11); `_assertRunMutable` refuses it.
- **DC11** a control admission never remains permanent `202 admitted` after restart (CS12).
- **DC12** SSE ticket binds repo+Run+user/session/credential/Origin/capability/incarnation; an
  old-incarnation ticket cannot open a stream (SV3/SV6); frames carry only the authorized Run (SV2);
  re-ticket resumes the durable cursor (SV5); live revocation closes the stream before its next frame
  (SV7); disconnect never interrupts a worker (SV8).
- **DC13** direct, Web, MCP, and CLI derive the same send/interrupt authority digest and ordinary
  projection, and no worker/fence/requestId/receipt appears in list/outline/status/errors (CA12/LX2).

These mirror the phase89 RED file's structure (closed-arg validation, server-side derivation,
admission/replay ordering, projection safety) so they slot into the same verification command form.

## 7. Overengineering critique (what NOT to build)

- **Do not add `run.send`/`run.interrupt` as top-level commands.** That duplicates the `run.act`
  authority spine and is, by definition, a second control plane. They are actions. (§3.)
- **Do not persist a raw `expectedFence`.** The fence is in-memory and intentionally so; on restart
  the worker is gone or re-registered at fence 1. Persisting `expectedFence` would create a stale
  authority token. Persist `targetDigest` for audit and re-resolve the **current** worker+fence at
  effect time (CA2). This is the same reason `admitRunStop` persists `reasonDigest`, not a PID.
- **Do not build a new stream substrate.** The SSE ticket gains two fields (`runId`, `incarnation`)
  and a RunView open; `run.follow` already does Run-scoped progressive reads. A second streaming
  ledger would violate SV1's "projection, not snapshot" rule.
- **Do not surface `providerRequest`, `requestDigest`, fence, or workerId in any ordinary depth.**
  They are evidence-depth only. An ordinary `interrupt()` result says whether the member was the only
  active member and whether the Run now needs attention (§2.3) — not which worker was signaled.
- **Do not auto-retry `outcome_unknown`.** CS4 forbids it. The honest terminal plus a bounded
  attention item is the product; retry is a new authorized turn the operator chooses.
- **Do not conflate `interrupt` with `stop_member`.** `stop_member` is `member_cleanup` (it reaps);
  `interrupt` is `provider_control` that preserves the session. Reusing `stop_member`'s ledger kind
  would make selective interrupt destructive. A separate `run.control_*` ledger keeps the
  destructive/non-destructive distinction (already modeled by `PROVIDER_EXECUTION_SETTLED_PHASES`).
- **Do not default delivery effort/mode to a weakest value.** `delivery` defaults to `turn` (the
  non-interrupting semantic), matching PX1's "effort is selected by the orchestrator, never globally
  defaulted to low." No global `nudge`-as-low fallback.

## 8. Composition preservation (recursive / shared-task / RLM / Slate / Atlas / Cairn)

The design is deliberately a projection so later composition consumes it without a new control plane:

- **Recursive / shared-task.** `send`/`interrupt` go through the same `_authorizeRecursiveCommand`
  guard (`application.mjs:8092-8097`) and `run-lineage` admission (`admitRunLineage`, 1199) as other
  recursive commands, so a parent Run may guide/interrupt a descendant Run through the ordinary
  surface and a subtree stop (SR8) still fences both. No second recursive authority is introduced.
- **RLM / REPL substrate.** The durable control admission is the natural "one bounded tactic, commit
  one Episode, pause" unit (`docs/28:486-491`): `admitRunControl` is the addressed action, the
  provider effect is the tactic, and `completeRunControl` pauses with either a closed-process
  checkpoint or visible Run ownership — "paused must never mean an uncounted live process"
  (`docs/28:492-493`). A future `queue()` composes over `providerRequest` heads without a new ledger.
- **Slate (thread-weaving / episodic memory).** Per `docs/28:478-485`, Baton's reading of Slate is an
  **addressed Episode projection over existing authority, not a second receipt ledger**. The
  `admitRunControl` record *is* that Episode binding: it losslessly binds the bounded action to its
  exact repo/Run/plan/view, the server-resolved recipient and worker generation, immutable message/
  reason digests, the registry identity, the provider request identity, and the lifecycle/settlement
  state — and it projects as one compact Run change with outline → item → evidence expansion (the
  `actions` entry is the outline card; `targetDigest`/`providerRequest`/`settlement` are item/
  evidence depth). The slice therefore ships the first-class addressed Episode for control effects
  the audit asks for, as a projection rather than a new flat command family.
- **Atlas (AST/CST/SCIP/CPG) and Cairn (causal KG).** These consume Run/Task/Attempt coordinates and
  content-addressed evidence. Because control admissions bind `planDigest`/`viewDigest` and settle
  with a `receiptDigest` (no raw provider payload), Atlas can index a control effect against its
  exact Plan node and Cairn can link the `run.control_settled` event into the causal graph as a
  first-class, content-addressed node — exactly the "projection over existing authority" the audit
  requires. No Atlas/Cairn-specific field is added to the ordinary surface.

## 9. Verification

- Deployment verification command `node` exits 0 (baseline reproduced before writing; this review
  adds no code).
- `node --test impl/test/phase64-integrated-run-application.test.mjs
  impl/test/phase89-resident-application-red.test.mjs` → 42 pass / 0 fail (UA3-UA8, RA1-RA13).
- The Phase 90 dogfood (`run.mjs` in this evidence pack) dispatches this `glm`/`xhigh` review and a
  companion `codex`/`high` AX review; both write only their report, and the pinned `node` gate is the
  deployment verification. No nested Baton is invoked; no credentials, harness installations, global
  configuration, or the main checkout are mutated.

This review does not claim the slice is implemented — it is the implementation-ready design, exact
seams, and RED-test contract for it. The acceptance-red work (the §5 seams + DC1-DC13) remains open
until landed, gated by CS1-CS12, SV1-SV7, and CA1-CA14.
