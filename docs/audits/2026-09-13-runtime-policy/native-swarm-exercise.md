# Native-agent swarm exercise — a live critique of the participant workflow

Date 2026-09-13. Participant: `builder` (native omp session, deepseek-flash), swarm
`swarm-57294b974661ac864ae5d3e247ea21c8`. The exercise ran the real deployment client end to end:
`node "$BATON_SWARM_CLIENT" <swarm.command> [json-args]` with the injected
`BATON_SWARM_BRIDGE_{URL,TOKEN,SWARM_ID,PARTICIPANT_ID,RUN_ID}` env (names only; no secret was
printed or logged).

Method: source reading of the contract, runtime, state folder, coordinator seams, bridge, and the
swarm test suites; then live probes of every command the deployed token grants (`inspect`, `watch`,
`guide`, `update`, `capture`, `check`, `stop`, `list`, `create`), including the refusal paths and
idempotent replay. Every JSON quoted below is verbatim output; nothing marked a finding was observed
only in a doc.

Tree note: the assigned worktree is `c200ced7`. The live deployment runs `0b816e45`
(`baton snapshot: ws-859283f6…`) plus two small uncommitted edits — `swarm-native-bridge.mjs` and
its test exist only in that commit, and the deployed `swarm-runtime.mjs`/`swarm-contract.mjs` add
a cross-swarm guard (`swarm-runtime.mjs:39-41`) and `detail.field` on contract refusals. Both
variants were checked for every claim; line references name the file's tree.

---

## 1. What works (so the critique has a baseline)

- **Identity is not the agent's problem.** The token table mints principal/context on every call
  (`swarm-native-bridge.mjs:206-208`), and identity-shaped request fields are refused before any
  effect: `swarm.inspect {"runId":"w-2"}` →
  `swarm_command_invalid` "unknown field runId" (`swarm-contract.mjs:228-231`).
- **Grants are real and typed.** `group_updated` → `swarm_permission_required {permission:"organize"}`,
  `stop` → `{permission:"stop"}`, `check` on a peer → `{permission:"review"}` — each names the
  permission and the participant.
- **Cross-swarm scope is airtight at the transport.** A foreign `swarmId` is refused by the bridge
  (`swarm_bridge_swarm_mismatch`, detail `{requested, authorized}`) before the runtime is reached;
  the deployed runtime adds a second guard for token contexts (`swarm-runtime.mjs:39-41`).
- **Explicit-key replay is safe, including under concurrency** (G5 below).

---

## 2. Findings

### G1 — Author self-capture is unreachable from a live turn; the advertised capture lane is reviewer-only in practice

`inspect` advertises `swarm.capture` in `availableActions` for a contribute-only participant
(`swarm-runtime.mjs:140-143`; live view below), and the docs describe capture as the author's move
("Capture pins an immutable contribution without finishing its author",
`docs/39-swarm-runtime.md:150-151`; SDK example `agent-experience.md:140`). Live, the same
participant gets:

```
$ node "$BATON_SWARM_CLIENT" swarm.capture '{"participantId":"builder","contributionId":"contribution:builder-introspect-1"}'
{ "ok": false, "error": { "message": "Contribution capture requires a paused turn",
  "code": "contribution_capture_not_paused", "detail": {} } }        # exit 1
```

Cause: `captureContribution` requires an unconsumed pause record (`coordinator.mjs:2253-2256`), and
pause records are minted only for a `'pausable'`-carded **turn completion**
(`coordinator.mjs:2106-2153`). While the author is running a turn — the only time a turn-scoped
harness can call the client — it has no pause record: `inspect` shows `builder`
`runtime {state:"working", turn:null}` (`swarm-runtime.mjs:127-131`). Capture by a *reviewer* works
(`impl/test/swarm-runtime.test.mjs:107`), so in practice the capture lane is not the author's; the
author's revision is only ever pinned by someone else, and only after the author can no longer act.

Blast radius: the whole capture→check lane is unusable *by the participant it is meant to pin*. An
agent following `availableActions` spends a turn and gets `contribution_capture_not_paused` with
`detail: {}` — no hint that a pause is required, or that the reviewer holds the working path.

Directions: either make `availableActions` pause-aware (the runtime already computes pause state at
`swarm-runtime.mjs:127`), or let `swarm.contribution_recorded` mint the capture it already has the
bytes for, or expose "pin this recorded contribution" as a coordinate
(`swarm-contract.mjs:67-74`), which is exactly what a live author can supply.

### G2 — `swarm.check` is advertised to contributors but closed in both directions they can reach

`inspect` adds `swarm.check` to a contributor's `availableActions` (`swarm-runtime.mjs:142`), but:

```
$ … swarm.check '{"participantId":"lead","contributionId":"contribution:whatever","checkId":"check:probe-1"}'
{ "message": "This swarm has not granted review authority to this participant",
  "code": "swarm_permission_required", "detail": { "permission": "review", "participantId": "builder" } }

$ … swarm.check '{"participantId":"builder","contributionId":"contribution-builder-probe-1","checkId":"check-probe-1"}'
{ "message": "Contribution has not been captured", "code": "contribution_unknown", "detail": {} }
```

Checking a peer needs `review` (`swarm-runtime.mjs:209-212`); checking yourself is admitted under
`contribute` but the coordinator's check requires a *captured* revision
(`coordinator.mjs:2285-2291`), which the same participant cannot have produced (G1). The contract
row names only coordinates (`swarm-contract.mjs:78-82`), so neither precondition is discoverable
before the call. Fix: stop advertising `swarm.check` to a participant with no capture path, or name
the precondition in the refusal (`contribution_unknown` with the expected capture coordinates).

### G3 — Per-event payload schemas live only in the state folder; shape errors surface late, unnamed

`swarm-contract.mjs:152` accepts any JSON object as `payload`; the real per-event schema is
`validateSwarmEvent` (`swarm-state.mjs:164-263` — context needs `key`+`body`, group needs
`groupId`+`members`, work needs `workId`+`objective`, review needs `contributionId`+`decision`).
The bridge and contract validate only "*is an object*", so a plausible call is admitted, costs an
authority check, and then fails in the store:

```
$ … swarm.update '{"event":"swarm.context_updated","payload":{"key":"probe-missing-body"},"idempotencyKey":"probe-ctx-1"}'
{ "message": "swarm.context_updated requires body", "code": "invalid_payload", "detail": {} }
```

`invalid_payload` carries no field detail, unlike contract refusals, which name the offending field
(`detail.field` in the deployed tree). The most likely agent mistake — a payload whose shape is
wrong — is the least explainable. Fix: derive the payload schema
from `SWARM_EVENT_KINDS` and refuse it in `validateSwarmCommand` (or at minimum add `{field,
expectation}` to these refusals, as `swarm-contract.mjs:213-217` promises for its own).

### G4 — `watch` cannot distinguish "event" from "timeout", and its relevance predicate is broad

Live: `watch {afterSeq:303, timeoutMs:2500}` returned in **2583 ms** with `cursor` still `303`.
That is the documented semantics ("timeout is a refresh, not progress", `agent-experience.md:90-91`)
but the result is byte-shaped like an event-driven return, so a caller must remember the prior
cursor to know whether anything happened. `swarm-runtime.mjs:158-181` returns `inspect` on either
branch; the default wait is 30 s (`:161`) and the CLI exposes no shorter default.

Second-order: the wake predicate matches any ledger event naming the swarm *or any member's runId,
taskId, or workerId* (`swarm-runtime.mjs:170-175`). A member's task lifecycle traffic therefore
wakes every watcher of that swarm, and the returned cursor is the ledger head, not the matching
event. This is a wake-amplification risk rather than an observed defect here (my 2.5 s wait saw no
wakeups), so treat it as a design note.

Fix: return `{reason:"event"|"timeout", afterSeq}` on the view, and let `watch` accept an event-kind
filter or a per-participant scope.

### G5 — Replay safety depends on a key the CLI mints and hides

Effectful commands auto-mint a key per invocation when the caller supplies none
(`swarm-native-bridge.mjs:380`), and the contribution identity derives from that key
(`swarm-runtime.mjs:232`). Re-running the same shell line therefore mints a *second* operation
instead of replaying the first; the minted key is never printed, so an agent cannot even learn the
identity it should replay with. With an explicit key, both directions are correct:

```
same key + identical args   → exit 0, refreshed inspect (no duplicate contribution)
same key + different payload → { "message": "Swarm mutation identity already names another request",
                                 "code": "swarm_replay_conflict", "detail": {} }
two concurrent identical updates, one explicit key, fresh contributionId
                            → both exit 0, identical stdout (cursor 295 for both), one new contribution
```

(`recordSwarm` owns the conflict check, `coordination-store.mjs:13960-13971`; concurrent duplicates
are served by the runtime's pending map, `swarm-runtime.mjs:94,115`, with the store's key index as the
durable backstop — the observable result was identical stdout and exactly one new contribution). Two
asymmetries worth noting: update replays return a freshly computed view (cursor advanced 282→286
between the two calls above) because only `recruit`/`guide`/`stop` store their result
(`swarm-runtime.mjs:85-93`); and the conflict refusal has no `detail`, unlike contract refusals.
Fix: print the minted `idempotencyKey`
in the CLI result (or require it), and give `swarm_replay_conflict` the conflicting coordinates.

### G6 — `inspect` is the only read and it returns the entire swarm

`inspect` spreads the whole cloned domain (`swarm-runtime.mjs:144-151`): every participant including
the full `role` text (the recruit *objective*), every contribution body, all reviews and context.
Measured live with two participants and two probe contributions: **8 405 bytes / 170 lines**;
`lead`'s `role` alone is 1 998 bytes. There is no projection, filter, or `since` parameter, so the
cost grows with swarm history while a native agent's context budget does not. Round-trip through
the CLI is ~66-69 ms, so frequency is cheap but the payload is not. Fix: a compact/projected mode
(omit `role`, truncate bodies, `afterSeq` filter) before swarms get large.

### G7 — Sharper edges

- **`swarm.create` by a run-carrying caller reuses `swarm_membership_required`**
  (`swarm-runtime.mjs:193-195`, live: "Recruit and organize within your granted swarm"). Same code
  as a missing membership (`:47`), so a client cannot tell "you are not a member" from "creation is
  the root's act" without string-matching the message.
- **`swarm.list` filters silently** (`swarm-runtime.mjs:187-190`): a caller with no visible swarm
  gets `[]`, not a typed refusal — fine for a UI, ambiguous for an agent deciding whether it is
  scoped.
- **`guide` returns a nested envelope**: live `{participantId, result:{ok:true, result:"ok",
  emulated:false}}` (`swarm-runtime.mjs:307-312`), where `emulated` is coordinator-internal
  vocabulary leaking into the participant surface; every other verb returns a direct result.
- **Self-leave needs only `read`**: `swarm.participant_left` naming yourself is downgraded to `read`
  authority (`swarm-runtime.mjs:213-215`) and returns `{state:"left", sessionStopped:false}`. The CLI
  auto-fills only `swarmId`, so this is not an accident-prone default, but no verb lists or reverses
  a self-leave; a participant that leaves can be re-admitted only by `recruit`.
- **Client/server frame bounds are independent**: the client always caps the *response* at the
  default `wire.frame` row (`swarm-native-bridge.mjs:340`), while the server's bound is overridable
  (`:127`). Raising `maxFrameBytes` for a large deployment would leave clients refusing the bigger
  responses. Source observation only; not exercised live.

---

## 3. Why the suite cannot see G1/G2

Both live failures are structural for the current tests:

- The runtime suite's fixture gives every spawned worker `paused: true`
  (`impl/test/swarm-runtime.test.mjs:48`) and its fake coordinator always captures
  (`:30-34`), so capture never meets a working turn; no test in `impl/test` matches
  `contribution_capture_not_paused` or `contribution_unknown` (search: no matches).
- The bridge suite runs against `createFakeSwarmRuntime` (`swarm-native-bridge.test.mjs:40-100` in
  the deployment tree), which re-implements membership and grants and asserts
  `availableActions.includes('swarm.capture')` (`:198`) against a double where capture always
  succeeds.

A real-Coordinator test that captures from a live (non-paused) turn, expected to refuse
`contribution_capture_not_paused`, would pin G1 before the capability is either fixed or removed.

---

## 4. Verification

Execution contract: `node --test impl/test/swarm-runtime.test.mjs` in the assigned worktree →
**exit 0; tests 6, pass 6, fail 0** (the suite passes on this tree and, per §3, does not exercise
the gaps above).

Live probes ran against the deployment bridge with this participant's own scoped token; no probe
mutated another participant's state, and no token or endpoint secret appears in this document or in
any contribution. Probe artifacts published during the exercise: `contribution-builder-probe-1`
(idempotency replay target), `contribution-builder-probe-2` (concurrent duplicate), and the final
`builder-critique` contribution (plain text, 3 313 bytes, attributed to `builder`, ledger seq 496),
published through `swarm.update {event:"swarm.contribution_recorded"}` with an explicit idempotency
key.


## Root integration follow-up

The findings above describe the exercised deployment, not the subsequent fixed tree. Root added a real native-shell application test for implementer self-capture and checking during an active turn; capture now preserves HEAD and index bytes. Capture attaches a revision to an existing finding without replacing its text or author. Inspect reports capture/check target participants and an explicit running turn. Watch filters routine tool, token and route-observation telemetry after the GLM lead actually encountered the predicted feedback loop.

In the completed native exercise, GLM captured the builder revision as `builder-code` at `2fc5f83cae77ac5f93a16a3c89e2bc112ca22a57` and independently checked it through Baton. The builder remained paused and available afterward. Both native sessions were explicitly stopped during deployment cleanup. Command discovery, selective observation and shared physical custody remain separate follow-up work.
