<!-- Slice report of the 2026-09-14 deep codebase audit. Author: Claude Opus 5 reading agent (audit-adapters), dispatched read-only by the root orchestrator (Claude Fable 5.1) at master f2ea904c. The root's synthesis, verification status of each item and the fixes taken are in root.md; this file is the slice report as delivered, unedited. -->

# Baton deep audit — adapters and harness sessions slice

Repo: /Users/wahargis/Development/Experiments/baton (branch agent/swarm-runtime-foundation, read-only audit)
Date: 2026-09-13

Slice read in full: impl/src/adapter.mjs, cli-adapters.mjs, omp-rpc.mjs, omp-usage.mjs,
claude-session.mjs, codex-appserver.mjs, grok-acp.mjs, kimi-acp.mjs, acp-json-rpc-process.mjs,
native-subagent-observations.mjs, native-subagent-view.mjs, worker-policy.mjs,
toolchain-projection.mjs, runtime-isolation.mjs, messages.mjs, router.mjs.
Also read for cross-checking: process-lifecycle.mjs, usd.mjs, verification-presentation.mjs,
control-surface-unification.mjs, route-liveness.mjs, and the consuming seams in coordinator.mjs.

43 items. All line numbers are as of the audited working tree.

---

## FRICTIONS

**F1. Two brief dialects with materially different authority text, and the main production worker gets the weaker one.**
`renderBrief` carries `## Write authority`, `## Repository mutation authority`, `## Ambient knowledge`
and `## Output format` (impl/src/adapter.mjs:132-156, 160-174).
`renderPrompt` carries none of them (impl/src/cli-adapters.mjs:99-115).
Codex, Grok, Kimi and OMP call `renderBrief` (impl/src/codex-appserver.mjs:959,
impl/src/grok-acp.mjs:847, impl/src/kimi-acp.mjs:394, impl/src/omp-rpc.mjs:964).
`ClaudeSessionCli` — and by inheritance `GlmSessionCli` and `KimiSessionCli` — calls `renderPrompt`
(impl/src/claude-session.mjs:844, impl/src/claude-session.mjs:1466).
Net effect: the Claude-family session worker is never told to stay out of the home directory,
credentials, toolchains, shims, global config or caches; is never told when repository mutation is
*not* authorized; never receives the ambient knowledge slice; and never receives `outputFormat`.

**F2. Both dialects instruct the worker to use only advertised tools, and neither lists any tool.**
`brief.tools` is consumed solely to choose which paragraph to print, via
`advertisesBatonControlSurface(brief.tools)` (impl/src/adapter.mjs:108, impl/src/cli-adapters.mjs:82).
The instruction itself is at impl/src/cli-adapters.mjs:97 ("use only tools explicitly advertised in
this Brief") and impl/src/adapter.mjs:125 ("Any Baton tools listed here extend those native
capabilities"). No renderer ever emits the list. The worker is given an instruction it cannot follow.

**F3. `budget` is mandatory on every brief, never rendered to the worker, and no longer enforced.**
`validateBrief` requires exactly `{tokens, usd, wallMin}` with all three positive
(impl/src/messages.mjs:82-96). Neither renderer prints any of them. Wall time was removed from fate
by the #163 law and is now explicitly ignored in four adapters:
impl/src/claude-session.mjs:869-871, impl/src/codex-appserver.mjs:861-862,
impl/src/grok-acp.mjs:783-784, impl/src/kimi-acp.mjs:332-334.
A required field that nothing enforces and nobody sees is pure admission friction.

**F4. The write-authority paragraph points at a section that may not exist.**
"Write only inside the assigned Baton worktree and only at the Path scope below" is emitted
unconditionally (impl/src/adapter.mjs:133), but `## Path scope` is printed only when
`brief.pathScope?.length` is truthy (impl/src/adapter.mjs:145-148). An empty path scope leaves a
dangling reference in the most authority-sensitive paragraph of the brief.

**F5. Spawn refusals are typed on some adapters and prose-only on others.**
Typed: `{ok:false, code:'worktree_unavailable'}` at impl/src/kimi-acp.mjs:276 and
impl/src/omp-rpc.mjs:830; `{ok:false, code:'attach_only_requires_resume'}` at
impl/src/adapter.mjs:322-326, impl/src/claude-session.mjs:725-731,
impl/src/codex-appserver.mjs:783-789, impl/src/grok-acp.mjs:679-685.
Prose-only: `{ok:false, reason:'no worktree'}` at impl/src/cli-adapters.mjs:284;
`{ok:false, reason:'spawn requires a worktree (...)'}` at impl/src/codex-appserver.mjs:805 and
impl/src/grok-acp.mjs:700; `{ok:false, reason:'live:false — refusing to launch a real CLI'}` at
impl/src/cli-adapters.mjs:281. A caller cannot branch uniformly on cause.

**F6. Peer-messaging availability is invisible on the card.**
`WORKER_MESSAGE_GUIDANCE` is appended only by Claude, Codex and OMP
(impl/src/claude-session.mjs:844, impl/src/codex-appserver.mjs:959, impl/src/omp-rpc.mjs:964,
plus the `promptBrief` twins at impl/src/claude-session.mjs:1466,
impl/src/codex-appserver.mjs:1036, impl/src/omp-rpc.mjs:1015).
Grok and Kimi dispatch the brief with no guidance (impl/src/grok-acp.mjs:847,
impl/src/kimi-acp.mjs:394) and correspondingly never scan for `MESSAGE_SEND`. That is internally
consistent, but no card field records which harnesses can participate in peer messaging, so the
capability is discoverable only by reading adapter source.

**F7. `resource.tokens` carries three incompatible payload shapes under one kind.**
Delta with `tokens` and `counterId` (impl/src/claude-session.mjs:1242-1248,
impl/src/cli-adapters.mjs:40-58, impl/src/omp-usage.mjs:219-224).
Cumulative with `tokens` (impl/src/codex-appserver.mjs:733-746, `accounting:'cumulative'`).
Rate-limit spray with no `accounting`, no `tokens`, no `counterId` — the raw wire params spread
into the event (impl/src/codex-appserver.mjs:747-751). Consumers must discriminate on
`payload.source` prose, which is exactly the string-matching pattern the project is trying to retire.

**F8. `terminal: true` on an Ack means two different things.**
"The in-memory session already ended, so no confirmation event can ever be emitted"
(impl/src/adapter.mjs:464-467).
"The owned process group is already reaped" (impl/src/cli-adapters.mjs:464,
impl/src/claude-session.mjs:1575, impl/src/codex-appserver.mjs:1111,
impl/src/grok-acp.mjs:966, impl/src/kimi-acp.mjs:675-676, impl/src/omp-rpc.mjs:1090-1091).
The coordinator reads the single flag as "treat the Ack as the confirmation"
(impl/src/coordinator.mjs:10238, impl/src/coordinator.mjs:8604-8606).

---

## GAPS

**G1. OMP's card has no `verbs` block at all.**
impl/src/omp-rpc.mjs:416-467 declares harness, version, authPosture, concurrencyCeiling, maxContext,
governance, contentStream, modelSelection, steering, workerPolicy and containment — and no `verbs`.
Every other adapter publishes the canonical eight-verb vocabulary
(impl/src/adapter.mjs:271, impl/src/cli-adapters.mjs:545, impl/src/cli-adapters.mjs:608,
impl/src/claude-session.mjs:650-659, impl/src/codex-appserver.mjs:319-328,
impl/src/grok-acp.mjs:241-250, impl/src/kimi-acp.mjs:184-187).
OMP's `approve()` is a hard refusal (impl/src/omp-rpc.mjs:1050) and its `answer()` is native
(impl/src/omp-rpc.mjs:1053-1086), and the card says neither.

**G2. OMP's card omits `turnCompletion`, which silently changes its runtime semantics.**
`_turnCompletionOf` defaults an absent value to `'claim'` (impl/src/coordinator.mjs:3286-3288).
Consequence 1: an OMP completed turn is never parked as a steerable checkpoint and goes straight to
the trust gate (impl/src/coordinator.mjs:13580-13584).
Consequence 2: `routeMatches` requires `turnCompletion === 'pausable'` for probe capability, so
every OMP route is excluded from liveness probing (impl/src/route-liveness.mjs:37).
The three session siblings all declare it (impl/src/claude-session.mjs:649,
impl/src/codex-appserver.mjs:318, impl/src/grok-acp.mjs:240, impl/src/kimi-acp.mjs:183).

**G3. `kill()` can never report "unconfirmed".**
`authorizeStop` returns `{confirmed:false, reason:'close_pending'}` when no close fact exists
(impl/src/process-lifecycle.mjs:189) and nothing re-arms the attempt. A child that survives both
SIGTERM and SIGKILL produces `{ok:true}` from `kill()` (impl/src/claude-session.mjs:1571-1594) with
no `kill.confirmed` and no `lifecycle.process_reap_unconfirmed` ever emitted. The only bound is the
coordinator's own `stopDeadlineMs` timer (impl/src/coordinator.mjs:8595-8597). The adapter layer has
no way to say "I asked, it did not die, and I know that".

**G4. Claude's in-flight control requests are never settled on close.**
`session.pendingControlRequests` is written at impl/src/claude-session.mjs:1418 and read/deleted only
on a matching response (impl/src/claude-session.mjs:1390-1393). `_onClose`
(impl/src/claude-session.mjs:1600-1626) never drains it, so the interrupt confirmation promise from
`_sendInterrupt` (impl/src/claude-session.mjs:1418-1420) can hang forever and `session.pendingInterrupt`
stays non-null. Codex drains its pending map on close (impl/src/codex-appserver.mjs:535-538), Grok
drains its own (impl/src/grok-acp.mjs:413-417), and the shared ACP transport drains twice
(impl/src/acp-json-rpc-process.mjs:319-322, 340-342).

**G5. Frames arriving after a settled turn are dropped without a trace.**
impl/src/cli-adapters.mjs:368 skips every remaining parsed line once `session.turnSettled`, including
`resource.tokens` frames that would have completed the accounting.
Grok drops every `session/update` once `activeTurn` is cleared (impl/src/grok-acp.mjs:516).
Codex drops trailing `item/completed` for a terminal turn (impl/src/codex-appserver.mjs:664) but does
*not* gate `thread/tokenUsage/updated` (impl/src/codex-appserver.mjs:733), so late usage can still
mutate `session.lastTokenUsage`. The `lastTokenTurnId` guard in `tokenUsageSeal`
(impl/src/codex-appserver.mjs:161-171) is what keeps that from corrupting the next turn's seal.

**G6. Worker prose mints control frames with no capability gate.**
Six grammars are scanned on every assistant text regardless of what the brief advertised:
decision (impl/src/claude-session.mjs:1177-1185), scratchpad write (1186-1189), context read
(1190-1193), message send (1194-1197), board claim (1198-1201), board report (1202-1205).
None of them consults `brief.tools`. Admission is the coordinator's job by design, but the adapter
surface is uniformly open, so the brief's tool list has no effect on which control channels are live.

**G7. The spoof-safety claim for the decision grammar is narrower than stated.**
The header comment argues that tool results arrive as distinct `user` wire messages and never reach
the parser, and calls a quoted fixture containing the literal marker "spoof-safe"
(impl/src/claude-session.mjs:24-28). That holds for *frames*. It does not hold for a model quoting
untrusted file or web content back inside its own assistant text, which is the same wire path as a
genuine request. The same applies to the five sibling grammars.

**G8. Baton writes a config that disables the vendor sandbox, and the card only says "unverified".**
impl/src/runtime-isolation.mjs:100-111 writes a private `settings.json` with
`sandbox.enabled:false`, `failIfUnavailable:false`, `autoAllowBashIfSandboxed:false`,
`allowUnsandboxedCommands:true` for every `surface === 'claude'` worker.
The card reports `permissions.sandbox: 'unverified'` with a boundary string about containment being
unverified (impl/src/claude-session.mjs:626-629). "Unverified" understates "Baton wrote a file that
turns it off".

**G9. `credentialMechanism` ignores projected trees when classifying "mixed".**
impl/src/runtime-isolation.mjs:157-160 computes `mixed` only from `projectedEnvCount > 0 &&
projectedFileCount > 0`. A worker with projected env vars *and* a projected credential tree
(`projectedTreeCount > 0`, `projectedFileCount === 0`) reports `'environment'` while two mechanisms
are live. OMP is exactly the tree-projected surface (impl/src/runtime-isolation.mjs:136).

**G10. The legacy `SubprocessAdapterBase` tier publishes cards that no current gate can consume.**
`CodexAdapter`, `ClaudeAdapter` and `GlmAdapter` (impl/src/adapter.mjs:772-822) produce cards with no
`governance`, no `modelSelection` and no `workerPolicy`. `assertIsAdapter` passes them
(impl/src/adapter.mjs:86-95), but `normalizeWorkerPolicyCard(undefined)` throws a generic
`worker_policy_invalid` (impl/src/worker-policy.mjs:63-91). They are live exports on the module's
public surface.

---

## ERRORS (suspected bugs, with confidence)

**E1. HIGH — OMP spawns without `detached`, so every process-group operation is meaningless.**
impl/src/omp-rpc.mjs:169-171 passes only `{cwd, env, stdio}` — no `detached: true`.
A `ProcessCloseReapLatch` is nevertheless built with the child pid as the group id
(impl/src/omp-rpc.mjs:178-189), and `reapOwnedProcessGroup` probes `process.kill(-pid, 0)`
(impl/src/process-lifecycle.mjs:108-117). Without `detached`, the child sits in Baton's own process
group, so no group with id `child.pid` exists, the probe returns ESRCH, and the reap reports
`{confirmed:true}` having verified nothing (impl/src/process-lifecycle.mjs:109).
`processStartedPayload` and `processClosedPayload` both assert `processGroupId: pid`
(impl/src/process-lifecycle.mjs:275, 283). So OMP publishes `kill.confirmed` against a group that
never existed, its descendants are never reaped, and `kill()` sends only SIGTERM with no SIGKILL
escalation (impl/src/omp-rpc.mjs:320-325). This is the one defect in the slice that produces a
*false positive* confirmation rather than a missing one.

**E2. HIGH — Interrupting an idle session returns no confirmation on four of six adapters.**
`{ok:true, reason:'no active turn to interrupt'}` with no event and no `terminal` flag:
impl/src/codex-appserver.mjs:1047, impl/src/grok-acp.mjs:909, impl/src/kimi-acp.mjs:646.
`{ok:true}` on an already-terminal Claude session: impl/src/claude-session.mjs:1476.
`{ok:true, emulated:true}` on an unknown one-shot worker: impl/src/cli-adapters.mjs:453-460.
The coordinator's stop waiter finalizes only on `ack.ok === true && ack.terminal === true`
(impl/src/coordinator.mjs:10238) or on a `control.interrupt_confirmed` event
(impl/src/coordinator.mjs:10322, 15133). So a routine idle interrupt burns the full
`stopDeadlineMs`. Two adapters do it right, by two different mechanisms: OMP emits the event
synchronously (impl/src/omp-rpc.mjs:1027-1036) and MockAdapter returns a typed terminal Ack
(impl/src/adapter.mjs:464-467).

**E3. HIGH — Claude's auth-refresh respawn abandons the previous process generation.**
impl/src/claude-session.mjs:1316-1342.
Line 1340 replaces `session.processClose` with a fresh latch for the new pid *before* line 1342
kills the old child with a raw `process.kill(-oldPid, 'SIGKILL')`.
The old child's handlers are gated on `session.child === child`
(impl/src/claude-session.mjs:1290-1295), which is now false, so `_onClose` never runs for it.
Result: the first process emits no `lifecycle.process_closed`, no reap confirmation, and no
`lifecycle.process_reap_unconfirmed` — its group simply leaves the ledger.
Additionally the new child emits no `lifecycle.process_started` (compare impl/src/claude-session.mjs:875-876),
and `session.processGeneration` is not advanced (set once at impl/src/claude-session.mjs:799), so two
distinct OS processes share one generation number. The cost baseline is separately re-based at
impl/src/claude-session.mjs:1338, but `session.claudeResultIds` is not reset, and the
generation-keyed guard at impl/src/claude-session.mjs:1224-1227 cannot fire because the generation
did not change.

**E4. HIGH — Grok re-issues non-idempotent setup RPCs after a timeout with fresh ids.**
impl/src/grok-acp.mjs:306-320 retries up to eight times on `grok_transport_timeout`;
`_sendRequestOnce` mints a new id on every attempt (impl/src/grok-acp.mjs:324) and deletes the
abandoned pending entry (impl/src/grok-acp.mjs:328).
`initialize` (impl/src/grok-acp.mjs:790) and `session/new` / `session/load`
(impl/src/grok-acp.mjs:807) both ride this bounded path.
The sibling ACP transport states the opposite law verbatim, naming `session/new` and
`session/prompt` as the exact frames that must never be replayed because they may already have
landed provider-side with no idempotency authority (impl/src/acp-json-rpc-process.mjs:101-112).
OMP encodes the same law for its own commands (impl/src/omp-rpc.mjs:14-17, 236-246).
Grok is the one module that violates it, and the blast radius is orphaned provider sessions.

**E5. HIGH — Kimi kills the whole worker on any unmapped reverse request.**
impl/src/kimi-acp.mjs:565-569: any method other than `session/request_permission` triggers
`void session.process.kill()` and then throws.
Codex answers the unknown request with -32601 and keeps the session alive, explicitly to avoid a
wedge (impl/src/codex-appserver.mjs:630-636). Grok does the same (impl/src/grok-acp.mjs:503-507).
A future vendor `fs/read_text_file` or `terminal/create` request therefore destroys a Kimi worker's
entire turn, while the same request is a survivable decline on the two sibling ACP adapters.

**E6. MEDIUM-HIGH — Kimi's crash latch is per session, not per turn.**
`_emitCrash` sets `session.crashEmitted` once and suppresses everything after
(impl/src/kimi-acp.mjs:475-479).
But `_onTurnEnd` emits a crash for a non-`end_turn` stop reason and simply returns without closing or
killing the session (impl/src/kimi-acp.mjs:453-455), and `_onTurnError` does the same
(impl/src/kimi-acp.mjs:469-472). A later turn on the same live session can crash and emit nothing.

**E7. MEDIUM-HIGH — The Codex app-server child is spawned with no `cwd`.**
impl/src/codex-appserver.mjs:808-814 passes only `env`, `detached` and `stdio`.
The worktree is supplied to `thread/start` params (impl/src/codex-appserver.mjs:880) — the fix for
the documented G1 silent-wrong-cwd failure (impl/src/codex-appserver.mjs:794-796) — but the
app-server process itself still runs in the orchestrator's directory.
Every sibling passes `cwd` to the child: impl/src/grok-acp.mjs:730 (with an explicit comment that
grok indexes its cwd at startup), impl/src/claude-session.mjs:803,
impl/src/kimi-acp.mjs:303 via `AcpJsonRpcProcess` (impl/src/acp-json-rpc-process.mjs:78-80),
impl/src/cli-adapters.mjs:305, impl/src/omp-rpc.mjs:170.
Any config discovery, relative-path resolution or ambient file lookup the app-server does at startup
happens in Baton's directory, not the worker's.

**E8. MEDIUM-HIGH — Claude native subagents are recorded as agents only when they are being retried.**
impl/src/native-subagent-view.mjs:95-99 gates agent observation on
`observation.harness === 'claude-code' && observation.subagentRetry?.agent_id`.
The normalizer documents that `subagent_retry` present means retrying or in-flight, and *absent*
means resolved (impl/src/native-subagent-observations.mjs:637-646), and sets `subagentRetry: null`
when the field is missing (impl/src/native-subagent-observations.mjs:640-646).
So a Claude subagent that runs cleanly with no retry never enters the `agents` list at all — it
appears only as an invocation. Anything counting native subagents off `nativeSubagentView().agents`
systematically under-reports the common case.

**E9. MEDIUM — A trailing OMP progress frame can regress a terminal child.**
impl/src/native-subagent-observations.mjs:563-568 writes subagent records last-wins with no phase
guard, while the tool-frame path explicitly guards regressions and upgrades phase only on a terminal
async state (impl/src/native-subagent-observations.mjs:539-558).
A `subagent_progress` (always `NATIVE_PHASE.STARTED`, impl/src/native-subagent-observations.mjs:416)
arriving after a completed `subagent_lifecycle` moves the record from `completed` back to `active` in
`projectOmpParallelTasks` (impl/src/native-subagent-observations.mjs:576-591).
The module header records that the terminal lifecycle can arrive seconds after `tool_execution_end`
(impl/src/native-subagent-observations.mjs:42-46), so a late progress tick is plausible.

**E10. MEDIUM — OMP's advertised wire-frame ceiling is not enforced.**
`this.maxFrameBytes` is assigned at impl/src/omp-rpc.mjs:143 and never read anywhere in the file.
`_onStdout` performs unbounded line accumulation with no size check
(impl/src/omp-rpc.mjs:327-348).
The card nevertheless advertises `governance.maxWireFrameBytes: this._maxWireFrameBytes`
(impl/src/omp-rpc.mjs:428). Every other adapter enforces its ceiling:
impl/src/cli-adapters.mjs:363-377, impl/src/claude-session.mjs:1005-1014,
impl/src/codex-appserver.mjs:448-490, impl/src/grok-acp.mjs:352-358,
impl/src/acp-json-rpc-process.mjs:203-207.

**E11. MEDIUM — OMP's respawn guard ignores unreaped ownership, and its pending-spawn release drops the identity check.**
impl/src/omp-rpc.mjs:813 tests only `existing && !existing.closed`.
Every sibling additionally requires the close latch to be confirmed before a new generation may be
admitted: impl/src/claude-session.mjs:722, impl/src/cli-adapters.mjs:277,
impl/src/codex-appserver.mjs:780, impl/src/grok-acp.mjs:676, impl/src/kimi-acp.mjs:253-254.
Separately, impl/src/omp-rpc.mjs:967 releases the pending-spawn reservation unconditionally, where
the siblings guard with `if (this._pendingSpawns.get(worker) === pending)`
(impl/src/claude-session.mjs:905, impl/src/codex-appserver.mjs:972, impl/src/grok-acp.mjs:850,
impl/src/kimi-acp.mjs:402). A racing second spawn can cancel the wrong reservation.

**E12. MEDIUM — Provider authentication failure is classified from English prose.**
`claudeResultFailureCode` regex-matches vendor wording:
`message === 'authentication_error'`,
`/^Not logged in\s*[·:.-]?\s*Please run (?:\/login|claude auth login)\.?$/iu`,
and `/^Failed to authenticate\. API Error: 401\b/u`
(impl/src/claude-session.mjs:493-504).
The only consumer that matters is the credential-refresh retry at
impl/src/claude-session.mjs:1263-1268, so a vendor wording change silently downgrades an auth failure
to a generic failed turn and disables the refresh path entirely. The ACP adapters already moved off
prose to a typed numeric gate (impl/src/acp-json-rpc-process.mjs:12-19); the Claude path did not.

**E13. MEDIUM — Kimi gates every spawn on an exact product name string.**
impl/src/kimi-acp.mjs:342-344: `initialized?.agentInfo?.name !== 'Kimi Code CLI'` throws
`agent_identity_mismatch` and fails the spawn. A vendor renaming its `agentInfo.name` breaks every
Kimi worker with an identity error that reads like tampering.

**E14. HIGH confidence, LOW impact — Dead conditional in the worker-policy comparator.**
impl/src/worker-policy.mjs:269:
`const resolved = name === 'containment' ? expected.resolved : expected.resolved;`
Both branches are identical. Either the ternary is vestigial or the containment axis was meant to
compare something else (its `resolved` is a `RESOLVED_CONTAINMENT` value, not a requested mode).
As written it is provably a no-op.

**E15. MEDIUM — `total_cost_usd` is folded as a delta in the one-shot CLI parser.**
impl/src/cli-adapters.mjs:186 and 197 pass `o.total_cost_usd` straight into a payload stamped
`accounting: 'delta'` (impl/src/cli-adapters.mjs:46). This is only safe because a one-shot
`claude -p` run emits exactly one `result` frame, so cumulative and delta coincide.
The session adapter documents the same field at length as session-cumulative and calls re-adding it
"the runaway-budget bug" (impl/src/claude-session.mjs:245-266), converting it to a delta against a
session baseline (impl/src/claude-session.mjs:267-297). The one-shot parser is a latent trap for
anyone who later gives `ClaudeCli` a streaming input format.

**E16. LOW-MEDIUM — The attention byte bound is not actually a bound.**
`renderAttentionBody` divides the cap by item count and subtracts the rendered head
(impl/src/messages.mjs:702-709). Heads are unbounded — they embed `item.kind` and `item.requestId`
verbatim (impl/src/messages.mjs:706) — so `budget` clamps to 0 while the head itself still ships,
plus the `(truncated)` marker. With many long request ids the emitted block exceeds
`FRAME_LIMITS['view.attention_push.bytes']` (impl/src/messages.mjs:697).

**E17. LOW-MEDIUM — `router.getStat` ignores family.**
impl/src/router.mjs:353-361 scans all buckets for the first `(modelVersion, taskType)` match and
returns it, while buckets are keyed by `(family, modelVersion, taskType)`
(impl/src/router.mjs:71-73) and `snapshot()` preserves that key (impl/src/router.mjs:364-366).
Two families sharing a model version return an arbitrary one of the two stats.

**E18. LOW — `buildKnowledgeSlice` always admits the first item regardless of size.**
impl/src/messages.mjs:779: `if (items.length > 0 && bytes + itemBytes > maxBytes) break;`
The guard is deliberate (never an empty slice when something matched), but it means `maxBytes` is
advisory rather than a bound, and the brief can carry one arbitrarily large knowledge item.

**E19. LOW — Dead locals in the decision factories.**
`let sizeActual = 0;` is declared and never read at impl/src/messages.mjs:264 and
impl/src/messages.mjs:357. The real value travels inside `sizeRow`
(impl/src/messages.mjs:272, 369).

---

## IMPROVEMENTS

Narrow, no new hardcoded numeric limits as control mechanisms.

**I1. Collapse the two brief renderers into one.**
Have `renderPrompt` delegate to `renderBrief` with a dialect tag, or move the missing sections into
`renderPrompt`, so write authority, repository-mutation denial, ambient knowledge and output format
cannot be dialect-dependent (impl/src/cli-adapters.mjs:81, impl/src/adapter.mjs:106).
This is the single highest-leverage change in the slice: it is one function and it reaches the
busiest worker tier.

**I2. Render the advertised tool list wherever the text instructs the worker to use only advertised tools.**
Emit a `## Tools` section from `brief.tools` in both dialects, next to the paragraphs at
impl/src/adapter.mjs:115-130 and impl/src/cli-adapters.mjs:92-98.

**I3. Give the idle interrupt one shape across adapters.**
Pick either OMP's behavior (emit `control.interrupt_confirmed` synchronously,
impl/src/omp-rpc.mjs:1029-1032) or the Mock's (`{ok:true, terminal:true}`,
impl/src/adapter.mjs:464-467), and apply it to
impl/src/codex-appserver.mjs:1047, impl/src/grok-acp.mjs:909, impl/src/kimi-acp.mjs:646,
impl/src/claude-session.mjs:1476 and impl/src/cli-adapters.mjs:453-460.
The event form is preferable because it keeps the D9 rule that confirmed-stop is always an event.

**I4. Type the Claude authentication refusal at the adapter boundary.**
Mirror `typedAcpRefusal` (impl/src/acp-json-rpc-process.mjs:16-19) with a Claude equivalent keyed on
`api_error_status` (already present on the wire per the comment at
impl/src/claude-session.mjs:498-503) so `claudeResultFailureCode` stops parsing vendor prose.

**I5. Give the OMP child its own process group, and escalate its kill.**
Add `detached: true` at impl/src/omp-rpc.mjs:169-171 so the latch's asserted
`processGroupId` is real, and follow SIGTERM with a SIGKILL on the same grace derivation the Claude
session already uses (`killGraceMs`, derived from the vendor SDK's own close window,
impl/src/claude-session.mjs:1580-1586). Pass `cwd` to the Codex app-server child at
impl/src/codex-appserver.mjs:808-814 in the same pass.

**I6. Complete the OMP card.**
Add `verbs` (with `approve: 'unsupported'`, `answer: 'native'`, `steer: 'native'`),
`turnCompletion: 'pausable'`, and correct `authPosture` to `'api_key'`
(impl/src/omp-rpc.mjs:416-467). All three are read by existing gates
(impl/src/coordinator.mjs:3288, impl/src/route-liveness.mjs:37, impl/src/runtime-isolation.mjs:41).

**I7. Drain Claude's pending control requests on close.**
Reject every entry in `session.pendingControlRequests` inside `_onClose`
(impl/src/claude-session.mjs:1600-1626), matching impl/src/codex-appserver.mjs:535-538.

**I8. Make the Kimi crash latch per turn.**
Move `crashEmitted` from the session onto the turn record created in
`_startTurn` (impl/src/kimi-acp.mjs:413-423), so a second turn's crash is not swallowed by the
first's (impl/src/kimi-acp.mjs:475-479).

---

## NOVEL INSIGHTS

**N1. Terminal truth is generation-scoped, but one code path lets a single generation own two processes.**
The latch's entire design binds a close fact to the `(generation, pid, group)` triple
(impl/src/process-lifecycle.mjs:133-154), and `observeProcessGroupIdentity` adds a kernel start time
so a reused pid cannot masquerade as the same process (impl/src/process-lifecycle.mjs:31-45).
The auth-refresh respawn is the one place that swaps the pid without advancing the generation
(impl/src/claude-session.mjs:1326-1340). Every downstream invariant keyed on generation is
ambiguous across that boundary, and the ambiguity is invisible because no event marks the swap.

**N2. A missing card field is a behavior change, not a missing label.**
OMP omitting `turnCompletion` moves its turns from "steerable checkpoint" to "implicit claim"
(impl/src/coordinator.mjs:13580-13584) and removes it from liveness probing
(impl/src/route-liveness.mjs:37). Absence defaults are load-bearing control flow, so an incomplete
card is indistinguishable from a deliberate posture. The card is the contract, and silence in it is
a statement.

**N3. Containment attestation currently passes only because no card claims to observe it.**
Every adapter calls `attestWorkerPolicyObservation` with `{autonomy, access}` and no containment
value (impl/src/cli-adapters.mjs:290-297, impl/src/claude-session.mjs:788-797,
impl/src/codex-appserver.mjs:911-923, impl/src/grok-acp.mjs:709-719,
impl/src/kimi-acp.mjs:371-374, impl/src/omp-rpc.mjs:838-848).
`createWorkerPolicyObservation` fills the missing axis with `null`
(impl/src/worker-policy.mjs:230-244), which compares equal only while the card declares
`containment.observation: 'unavailable'` — which every card currently does
(impl/src/claude-session.mjs:640-643, impl/src/codex-appserver.mjs:312-315,
impl/src/grok-acp.mjs:234-237, impl/src/kimi-acp.mjs:177-180, impl/src/omp-rpc.mjs:458-461,
impl/src/cli-adapters.mjs:524-527). The first card that declares `'launch'` will fail every spawn on
that adapter with `worker_policy_observation_mismatch`.

**N4. What an agent inside a worker session structurally cannot know.**
Its token budget, dollar budget or wall budget (F3 — required, never rendered).
Which Baton tools it actually holds (F2 — instructed to use only advertised tools, given no list).
That the hub independently re-runs the verification command: `renderPrompt` says "A reviewer will
independently enforce" (impl/src/cli-adapters.mjs:109), `renderBrief` says only "preserve this
execution contract" (impl/src/adapter.mjs:151) — so Codex, Grok, Kimi and OMP workers are never told
their claimed exit is untrusted, even though `makeResult` hard-codes
`verification: {command:null, claimedExit:null}` on exactly those adapters
(impl/src/codex-appserver.mjs:205-214, impl/src/grok-acp.mjs:73-82, impl/src/kimi-acp.mjs:19-28).
Whether its native subagents are observed at all (Grok and Kimi receive no guidance and are not
instrumented). Whether a peer message was delivered. On Claude, that its ordinary prose is being
scanned by six control grammars (G6).

**N5. The no-hard-stop directive removed the clock but left its vocabulary, and pushed the residue into retry ladders.**
`wallMin` remains a required brief field (impl/src/messages.mjs:93) and `timeoutMs` is still accepted
and documented as ignored in four adapters (impl/src/claude-session.mjs:869-871,
impl/src/codex-appserver.mjs:861-862, impl/src/grok-acp.mjs:783-784, impl/src/kimi-acp.mjs:332-334).
The remaining timeout-shaped behavior now lives in backoff ladders
(impl/src/grok-acp.mjs:306, impl/src/omp-rpc.mjs:41). Two of the three ladders are observation-only
and never re-send (impl/src/omp-rpc.mjs:236-246, impl/src/acp-json-rpc-process.mjs:101-112); Grok's
is the one that re-issues effectful frames (E4). The lesson generalizes: when a bound is removed
from fate, check whether it reappeared as a retry.

**N6. The adapter layer has a consistent honesty discipline and one consistent blind spot.**
The discipline is real and unusually good: `emulated` flags on every non-native verb
(impl/src/codex-appserver.mjs:996, impl/src/grok-acp.mjs:883, impl/src/claude-session.mjs:1521),
`gaps` arrays on every subagent observation
(impl/src/native-subagent-observations.mjs:251, 324-327, 433-441), `usageSeal` marked
`unavailable` rather than zero (impl/src/cli-adapters.mjs:28-30), and presence-only capture of
unknown protocol fields so undocumented values are never retained
(impl/src/native-subagent-observations.mjs:109-115).
The blind spot is symmetrical across all of it: honesty is expressed about *provider* truth and
almost never about *Baton's own* actions. Nothing records that Baton disabled the vendor sandbox
(G8), that Baton dropped a process generation (E3), that Baton re-sent a non-idempotent frame (E4),
or that Baton's advertised frame ceiling is unenforced (E10). The cards describe what the harness
cannot promise; they do not describe what Baton itself did to the harness.

---

## The five I would fix first

**1. OMP's missing `detached` (E1).**
It is the only defect in this slice that produces a *false* confirmation rather than a missing one.
Baton publishes `kill.confirmed` for a process group that never existed, so orphaned OMP descendants
are invisible to the reap ledger instead of merely unproven. Every other stop-truth finding here
degrades to "we do not know yet"; this one degrades to "we said we knew, and we were wrong".
One-line change at impl/src/omp-rpc.mjs:169-171, plus the SIGKILL escalation at
impl/src/omp-rpc.mjs:320-325.

**2. Claude's `renderPrompt` dialect (F1, I1).**
The highest-traffic worker tier is the one never told to stay out of the home directory,
credentials and toolchains; never told when repository mutation is unauthorized; and never given the
ambient knowledge slice the coordinator built for it. It is a one-line dispatch change at
impl/src/claude-session.mjs:844 with the widest behavioral reach of anything in the slice, and it
closes a real containment gap rather than a reporting one.

**3. The idle interrupt with no confirmation (E2).**
Four adapters make a routine stop wait out the full stop deadline for no reason. It is cheap,
it is directly measurable, and it is the concrete mechanism behind the stop-convergence work already
in flight. Fixing it also forces the `terminal`-flag vocabulary in F8 to be settled, because the fix
has to choose between the event form and the Ack form.

**4. The auth-refresh respawn (E3).**
It drops an entire process generation's terminal evidence at precisely the moment credentials are
already failing, which is when operators most need the ledger to be complete. It also silently
breaks the generation/pid invariant that every other part of the lifecycle layer relies on, so the
damage is not confined to the auth path.

**5. The unlisted tool list (F2, I2).**
The brief issues an instruction it makes impossible to obey. That is the cheapest correctness win in
the brief layer, it removes a standing incentive for workers to improvise their tool discovery, and
it directly serves the delegation guidance added in #275 — which tells a worker to recruit through
`swarm.recruit` without ever confirming that `swarm.recruit` is among its tools.

