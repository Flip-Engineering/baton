# giants — audit of the core coordination engine (swarm-a, 2026-09-14)

Scope, read end to end: `impl/src/coordinator.mjs` (both halves), `coordination-store.mjs`,
`coordination-internals.mjs`, `coordination-replay.mjs`, `contribution-service.mjs`,
`contribution-verification.mjs`, `referee.mjs`, `worktree.mjs`, `worktree-capacity.mjs`, `log.mjs`,
`process-lifecycle.mjs`. No source file was changed and no project suite was run (wave contract:
reading audit). Findings marked **[reproduced]** were driven through the real modules with probes in
`/tmp` (store probes `/tmp/cs-audit-1/probe*.mjs`; referee probes inline; worker probes as noted);
everything else was read. Priorities followed: silent failures, non-converging waits, state the hub
reports that is not true, then the participant/orchestrator experience.

## FRICTIONS

1. **A wedged coordination directory is hand-repair-only.** The store tells the operator "restart and
   replay are required" (`coordination-store.mjs:1267`), but replay applies the same event through the
   same fold (`coordination-replay.mjs:279` `store._apply(frozen)` — no catch), so the only repair is
   deleting ledger/segment files by hand. Same for a legal history (`coordination-replay.mjs:317-318`)
   and for one torn line in a worker log (`log.mjs:99-103`). No `truncated_tail` repair verb exists
   anywhere in `impl/src` (grep: throw sites only).
2. **Nothing may ever delete an archived segment.** `compact()` leaves every segment forever and the
   rebuild demands contiguous coverage from seq 1 (`coordination-replay.mjs:208-212`), so the natural
   operator remedy (remove an old `<digest>.jsonl`) turns the store into a `coordination_segment_gap`
   refusal — disk grows while the file that could be deleted cannot be.
3. **`reapExpiredContextPacks` reports reaping and reaps nothing.** `coordination-replay.mjs:1016-1020`:
   `for (const pack of store._contextPacks.values()) { if (Date.parse(pack.validity) <= now) reaped += 1; }` —
   the loop mutates nothing and discards its `repoId`; an operator or scheduler reading `{reaped: N}`
   as cleanup progress will never converge.
4. **A contribution check receipt does not say what policy it passed under.**
   `contribution-service.mjs:135-143` records `{contributionId, checkId, sha, ref, verification, passed, verdict, attempt}`;
   `passed` is a function of `this.acceptOptions` (which hardening was required) but the receipt never
   names it, and the toolchain/sparse identities the check compared are dropped — two byte-identical
   receipts can mean "hardened and satisfied" or "hardening not required".
5. **The worker is told "legacy shell command"; the referee runs a hand-tokenized argv.**
   `verification-presentation.mjs:29-30` renders `Execution mode: legacy shell command` /
   `Command: ${verification.command}`, while `referee.mjs:105-127` splits the string with a greedy
   quote rule and `referee.mjs:135` execs it directly — a worker who reproduces its failure by pasting
   that `Command:` into a shell sees different behaviour from the gate that graded it.
6. **A `doing` checkpoint can be invisible while it is unadjudicable.** `pausedTurns()` filters records
   by `pausedTurnStatus` (`coordinator.mjs:2313-2326`) and a record stuck in `resolving` is skipped,
   yet `_reservePauseRecord` waits on `record.resolvingDone` forever (`coordinator.mjs:2492-2494`).

## GAPS

1. **The argv verification contract is unvalidated at the runner.** `referee.mjs:218-219` reads
   `verification.envAllowlist.filter(...)` and `referee.mjs:227-228` computes `headLimit` from
   `verification.maxOutputBytes`; a contract with `arguments` but no `envAllowlist` dies with an
   untyped `TypeError`, and without `maxOutputBytes` every bound comparison is `NaN` so the capture is
   unbounded while `outputExceeded` is set true. The sibling string path defaults
   (`referee.mjs:282`, `Array.isArray(...) ? ... : ['PATH']`) show the two runners disagree about
   what is required.
2. **Replay does not re-enforce the live transition table.** `TRANSITIONS` is checked only at
   `coordination-store.mjs:12140` (live); the fold applies any `to` (`:7588`), so a bit-flipped or
   hand-edited `task.transitioned` replays to `ready` with a state the live API can never mint
   (reproduced). The durable log is the authority; it is also the only tamper surface replay does not
   police.
3. **A poisoned projection is invisible to every reader and to health.** `_projectionPoison` is read
   only at `coordination-store.mjs:975, 1243, 1289, 1298` (write/checkpoint paths); `task()`,
   `snapshot()`, `eventsView()` keep serving the pre-poison projection and `startupStatus()` keeps
   `ready` (delegated at `:948-950`).
4. **Audit-class writes have no shape or byte ceiling.** `recordMcpAudit`/`recordWebAudit`
   (`coordination-store.mjs:11913-11919`) and `recordDriver` (`:12605-12611`) pass caller fields into
   `_append` (`:1497-1498`) with no validator; `_apply` deliberately ignores those kinds (`:8386-8389`),
   and the canonical-order ceilings apply only when configured (default null, `:689-690`). Every
   sibling writer is bounded.
5. **Sparse-checkout identity is checked for presence, never compared.** `contribution-verification.mjs:45-53`
   refuses only when exactly one side is missing; two present-but-different identities pass, unlike
   the digest equality `matchToolchain` (`:9-15`) applies to the toolchain pair.
6. **Two boundary values are decoded/executed before any validation.** The board cursor is
   base64url-decoded and `JSON.parse`d before the digest check (`coordination-store.mjs:14701`) with no
   length bound (the MCP lane bounds at 4 096); `changedLines` passes caller revisions straight to
   git argv (`worktree.mjs:2228-2229`), where an option-shaped revision such as `--output=<path>` is
   honored — and returns `{}`, i.e. "no changed lines", silently.

## ERRORS

1. **The referee's ENOENT shell fallback is dead code that also orphans a process. [high] [reproduced]**
   `referee.mjs:184-190` respawns `sh -c command` on `ENOENT`, but Node emits `error(ENOENT)` then
   `close(-2)` for the failed direct child, and the pre-existing listener `child.on('close', (code) => finish(code))`
   (`:194`) settles the run before the fallback finishes. Probe: `verify()` on command `:` returns
   `observedExit: -2`, `diagnosticCode: verification_exit_mismatch`, `outcome: candidate_failed`,
   `failureOwnership: candidate` — the shell would have exited 0. The fallback child keeps running
   unsupervised after the verdict is returned (and while `verifyContribution`'s `finally` removes the
   sandbox underneath it).
2. **The referee's hand tokenizer mangles any command with two same-quote arguments. [high] [reproduced]**
   `referee.mjs:113-118` matches each quoted span greedily against `command.lastIndexOf(ch)`, so
   `node -e "…" "two"` becomes argv `['node','-e','…" "two']`. Probe: `sh -c` exit **0**, referee
   `observedExit` **1**, `passed: false`, `outcome: candidate_failed`, `failureOwnership: candidate`,
   capsule showing the mangled source. The verdict is a fact about the mangled argv, reported as a
   fact about the candidate.
3. **`redGreen` is asserted from a base run that never completed. [high]** `referee.mjs:350-351`:
   `baseExit = baseRun.timedOut ? null : baseRun.exitCode; redGreen = passed && baseExit !== task.verification.expectExit;` —
   a timed-out or unspawnable base yields `null !== expectExit` → `redGreen: true`, while the same
   verdict records `baseExecution: {state:'timed_out'}`. `accept(verdict, {requireRedGreen:true})`
   then returns true (`:483`), so the hardening gate is satisfied by a non-observation. The sibling
   branch already knows better: `:454` requires `baseExecution?.state === 'completed'` before blaming
   the base.
4. **The legacy string runner has neither the capture bound nor the cancellation discipline of the
   argv runner. [high]** `referee.mjs:179-180` pushes every chunk into `chunks` and `:159-166`
   concatenates, utf8-decodes and hardcodes `outputExceeded: false` (the argv path bounds head/tail at
   `:227-228, 255-271`); probe: a `yes` verifier produced `capturedOutputBytes: 522 505 620` and
   ~1.5 GB RSS inside the hub process. The same runner is used for `coverageCommand`/`mutationCommand`
   (`:360, :385`) with **no `signal` argument and no post-run re-check**, so a check cancelled by its
   caller still resolves `passed: true` (the invariant at `:329-331` is enforced only for the pinned
   and base runs), leaving the auxiliary child running to its own timeout while holding a lane.
5. **A callback throw inside `ProcessCloseReapLatch` wedges the generation and rejects into unguarded
   callers. [medium-high] [reproduced mechanics]** `process-lifecycle.mjs:232-234` sets
   `_processClosedEmitted = true` *before* calling `onProcessClosed`; a throw leaves `_confirmed`
   false, `pending` true, and the promise rejected. Callers are `onProcessClosed` log-appenders
   (e.g. `cli-adapters.mjs:262-265`) and the stop paths drop the promise (`codex-appserver.mjs:529`,
   `grok-acp.mjs:406`, `claude-session.mjs:1620`), so with Node's default rejection mode this aborts
   the hub; the one guarded site (`lsp-pool.mjs:523`) shows the hazard was known.
6. **The reap ladder's attempt cap silently truncates the caller's timeout and then mislabels the
   refusal. [high] [reproduced]** `process-lifecycle.mjs:107,115` bound the loop at `maxAttempts`
   (default 500 × 5 ms ≈ 2.5 s) independently of `deadline = now() + timeoutMs` (`:114`), and `:121`
   reports `'deadline'` regardless. Probe: `reapOwnedProcessGroup(pgid, {timeoutMs: 15 000})` returned
   `{confirmed:false, reason:'deadline'}` after **3 063 ms**; the coordinator passes up to
   `_stopDeadlineMs` (`coordinator.mjs:1876`), so a 15 s budget is reported as an expired deadline
   with ~12 s left.
7. **`reapRecoveredProcessGroup` reports `signaled: true` when no signal was sent. [medium] [reproduced]**
   `process-lifecycle.mjs:263-264`: `const reaped = await reapOwnedProcessGroup(...); return Object.freeze({ ...reaped, signaled: true });` —
   unconditional, including the first-probe-absent path (`:108-109`) and the `EPERM` refusal (`:112`).
   The coordinator turns `reaped.signaled` into durable signal authority and later publishes
   `control.recovery_process_reaped` (`coordinator.mjs:1878-1883, 1907-1926`), so Baton durably records
   a kill it was never permitted to perform. Related fence gap: `processClosedPayload`
   (`:285`) accepts any safe integer as `code` — including libuv errnos such as the `-2` produced by
   item 1, which `:365` re-admits on the durable `lifecycle.process_closed` path.
8. **One torn log line bricks every reader and every append for that worker. [high] [reproduced]**
   `log.mjs:155` is a bare `appendFileSync` with no fsync or verification; `:99-103` throws
   `operational_log_truncated` before `indexed.push(...)`, so `read`, `at`, `range`, `tail` and
   `append` (via `_lastSeq`) all fail for the intact prefix too, and the hub's digest loop dies for
   that worker. No repair routine exists in `impl/src`.
9. **`deepFreeze` rejects payloads the wire format supports and freezes the caller's object. [high]**
   `log.mjs:154` freezes `{...partial, seq, ts}` *before* `JSON.stringify` at `:155`; `:209`
   `Object.freeze(value)` throws `TypeError: Cannot freeze array buffer views with elements` for a
   `Buffer`/typed array anywhere in `payload` (which JSON serializes fine), dropping the event; and
   because `payload` is the caller's reference, a successful *or failed* append leaves the caller's
   object graph deep-frozen (`shared.count += 1` then throws at an unrelated site).
10. **`Cursor` trusts a persisted floor it cannot use and advances memory before it persists. [medium]**
    `log.mjs:228` accepts any `typeof v === 'number'` (and `"3" + 1 === "31"` for a string floor), and
    `read` turns an unusable `fromSeq` into `[]` (`:168`) — so `{"floor":1.5}` or `{"floor":"3"}`
    silently delivers nothing forever from an at-least-once cursor. `ack` (`:239-243`) sets
    `this._floor` before `writeFileSync`; if the write throws, the coordinator's retry is swallowed by
    `if (uptoSeq <= this._floor) return` (`:240`, consumer `coordinator.mjs:13068-13073`) and that
    page is never delivered again in-process.
11. **The store validates after the durable append, so one refused fold poisons it permanently. [high] [reproduced]**
    `coordination-store.mjs:1498` `this._appendFile(this.file, eventBytes, undefined)` precedes
    `:1506-1507` `try { this._apply(event); } catch (error) { throw this._poisonProjection(event, error); }`.
    `_apply` rejects (e.g. `wave.started roster is malformed`, `:7670-7671`) and every later write is
    refused at `:1243-1248` (`coordination_projection_poisoned`). Probe `probe.mjs`: second append
    refused, and **reopen fails with the same `wave_registry_invalid`** because replay re-applies the
    event (`coordination-replay.mjs:279`). Sibling writers that validate before appending exist
    (`recordSwarm`, `:12816-12818`), which is why this is a boundary gap rather than a design.
12. **A short/torn ledger append is undetected in-process and bricks the next open. [high] [reproduced]**
    The in-memory identity advances only for complete writes (`:1500-1503`) while the file may carry a
    fragment; later appends land after it so the file still ends in `\n` and the only tail check
    (`:977-978`) passes. The drift error is thrown at `:984-988` from *outside* `_writeProjectionCheckpoint`'s
    try, so it never reaches `_checkpointWriteFailure` (`:1022`), and release swallows it
    (`:1298-1301`). Probe `probe7.mjs`: append under ENOSPC surfaced, reads still "worked", reopen
    failed `invalid_json at coordination line 2`.
13. **`compact()`'s own checkpoint is rejected by the reader's size guard. [medium] [reproduced]**
    The writer windows only `_events` and keeps full-history `_byKey` (`:959-960`, and the reader
    requires `_byKey.size === base + throughSeq`, `:1067`), but the read guard sizes the file against
    the *ledger window*: `stat.size > Math.max(16 * 1024 * 1024, raw.byteLength * 16 + 1024 * 1024)`
    (`:1037`). Probe `probe3.mjs`: identical store, `beforeSeq=2 → checkpoint=valid`,
    `beforeSeq=1991 → checkpoint=corrupt`, `source=segments_ledger_fallback` — a false "corrupt"
    verdict indistinguishable from real corruption, and a full reparse every start.
14. **Bounded reap receipts break the store's own idempotent-retry contract. [medium] [reproduced]**
    Receipts needed to rebuild a retry response are FIFO-evicted (`:8062-8064`,
    `MAX_SCRATCHPAD_SNAPSHOT_REAPS`), while `_byKey` keeps the reap event forever; a later retry of the
    same key reaches `coordination-replay.mjs:1121-1122` and throws `scratchpad_reap_integrity` — a
    corruption signal for a valid ledger. Probe `probe6.mjs`: 256 receipts retained; `seq 1/44` throw,
    `seq 45` present.
15. **Replay turns a legal acceptance revocation into a permanent startup refusal. [high] [reproduced]**
    The post pass reads the *final* projection (`coordination-replay.mjs:558-571`, `store._tasks.get(...)`)
    instead of the state at its own seq, but `revokeTaskAcceptance` legally rewrites the prior task's
    terminal (`coordination-store.mjs:7593-7600`, `status:'failed'`). Probe `/tmp/audit-demo/revoke.mjs`:
    nine legal admissions → restart refused `recovery_refinement_unverified`; the same ledger minus the
    revocation starts `ready`. `_historicalTaskState(taskId, throughSeq)` already exists
    (`coordination-store.mjs:2102-2112`) and is used by the sibling validators.
16. **Damaged-ledger shapes lose the coded-failure contract and name the wrong layer. [medium] [reproduced]**
    `coordination-replay.mjs:171-173` trusts a self-consistent `segments/index.json` without proving
    the segment files exist, so a missing segment dies as raw `ENOENT` at `:282` (the identical damage
    without the index fails closed as `sequence_gap`); and `applyReplayEvent` dereferences the parse
    result first (`:271` `event.schemaVersion`), so a `null` line is a raw `TypeError` and `{}`,
    `123`, `[]` are reported as `schema_version … at seq undefined`.
17. **A failed spawn leaves a phantom local-resource hold that refuses teardown. [high] [reproduced]**
    `coordinator.mjs:3781-3782` sets `handle.localAuthority = true` before anything can fail; the
    context-materialization exit clears it (`:3803`) but the runtime-scope exit (`:3811-3828`) and
    `_onSpawnRefused` (`:4446-4456`) do not, so `_localResourceOwnership` (`:2096-2097`) reports a live
    resource for a worker with no process and `closeAuthority()` refuses `coordinator_not_drained`
    (`:1671-1672`); the first `kill` returns `already_dead` without clearing it (`:8556-8570`) and only
    a second kill reaches the branch that clears it.
18. **`nudgeTurn` keeps writing turn/stop state after a stop that landed during the awaited prompt. [high] [reproduced]**
    Only the prompt call is guarded (`coordinator.mjs:2583-2598`); `bumpTurn` and the durable
    `turn.settled` append run outside any rollback boundary (`:2601-2614`), despite the comment at
    `:2622` claiming "inside the same rollback boundary". Probe (slow ack + concurrent kill): worker
    log ends `kill.requested / kill.confirmed / turn.settled(nudge)`, and the raw store refusal
    `{name:'CoordinationRefusal', code:'terminal'}` escapes a lane whose contract is a typed
    `{ok:false,result}` value.
19. **A pause record stuck in `resolving` hangs every later act on it, forever. [high] [reproduced]**
    `coordinator.mjs:2492-2497` awaits `record.resolvingDone`, which only `rollback`/`commit`
    (`:2509-2519`) can resolve; there is no timer, no `finally` and no repair, so any throw between
    reservation and commit strands it: the next `claimTurn`/`nudgeTurn` never settles (measured: both
    timed out with no timer of their own) while `pausedTurns()` hides the record.
20. **A `turn` delivery to a paused member bypasses the checkpoint and orphans the fresh one. [high] [reproduced]**
    `coordinator.mjs:8046-8065` only consults the pause on the `continueParticipant` path; a plain
    `mode:'turn'` send falls through to the adapter prompt (`:8102`) while `task.status === 'paused'`.
    The next completion mints a second pause (`:2237, :2250`), and because `pausedTurns()` is
    insertion-ordered oldest-first (`:2313-2323`), settling the old one leaves the fresh record
    permanently `not_paused` (`:2524-2529`) yet still reported as pending. Reachable from
    `fleet_send` (`mcp-northbound.mjs:2272`) and the web `send` envelope without new code.
21. **`question.asked`/`approval.requested` admit a missing `requestId`, minting an invisible,
    uncancellable blocking interaction. [high] [reproduced]** `coordinator.mjs:13953-14000` uses
    `payload?.requestId` with no type check (the decision case one branch later has it, `:14085`), so a
    malformed frame parks the worker `blocked` and the task `input_required` under the key
    `undefined`. `claimInteraction`/`interactionStatus` refuse it (`:10595, :10609`), the stop path's
    resolver is truthiness-gated (`:8755-8772`), so after the kill the record stays pending in
    `_activeInteractionIds` and `closeAuthority()` refuses (`:1674`). One untrusted frame wedges the
    task and the handoff.
22. **Cleanup failures replace the real outcome on three lanes. [medium-high] [reproduced for the
    first]** (a) `stopRunTargets` awaits `_removeOwnedTaskWorktree` outside any containment
    (`coordinator.mjs:1838`), so a per-target rejection (e.g.
    `physical workspace owner binding is not proven for cleanup`, `:9368-9374`) escapes the typed
    `coordinator_run_stop_incomplete` path and skips `clearTimeout(deadlineTimer)` (`:1952-1955`) —
    probe observed a leaked `Timeout` keeping the process alive for the drain window; (b) `_integrate`'s
    catch runs two sequential cleanups (`:6596-6597`), so a failing first one skips
    `removeStructuredIntegration` *and* the `integration.refused`/`integration.incomplete` records
    below it; (c) the same `removeStructuredIntegration` is not idempotent (a second call throws
    `integrate root is missing`, `worktree.mjs:1439-1445`) and runs a global `git worktree prune`
    (`:1442`) that `reap`'s own comment declares able to destroy another owner's authority (`:1711-1712`);
    (d) a verify-sandbox reap failure is thrown *after* `_dispatchPass()` (`coordinator.mjs:14609`),
    inside `claimTurn`'s rollback guard (`:2718-2720`), turning a leaked sandbox into a failed claim
    on a task whose pass was already observed and accepted.
23. **Capacity rows are written unvalidated and validated strictly on read — one bad value bricks the
    repo. [high] [reproduced]** `worktree-capacity.mjs:568-577` seals caller `baseSha`,
    `sparseCheckoutIdentity.digest` and `toolchainProjection.projectionDigest` into
    `reservations.json` with no format check; every later `_read` enforces `/^[a-f0-9]{40}$/` etc.
    (`:304-327`) and throws `worktree_capacity_unavailable`: reserve, materialize, release,
    `releaseAbsent`, `settleForCleanup` and `snapshot` all refuse for every deployment sharing the
    repo, and the only escape is deleting the ledger (discarding every live reservation).
24. **Legacy `dependencyDirs` copies sit inside the change boundary. [high] [reproduced]**
    `worktree.mjs:1324` copies the dependency tree into the checkout with no exclude, so for a sparse
    worker `assertChangedPathsCovered` refuses every capture (`:987`, "worker change escaped sparse
    policy"), on every retry, though the runtime copied the tree; without sparse mode the untracked
    copy is staged by `git add -A` (`:1394`) and lands in the snapshot commit (`changedPaths` included
    `deps/runtime/index.js`).
25. **`reap()` reports exact-absent while silently refusing to release the owner receipt. [medium] [reproduced]**
    `worktree.mjs:1727-1735` treats success as `existsSync`-clean and discards
    `releasePhysicalWorkspaceOwner`'s `false` (`:791-793` returns false while the branch survives);
    with default options the branch is not even checked (`if (opts.deleteBranch)`, `:1729`). Result:
    `physicalWorkspaceOwnerCleanupAbsent()` stays false, the `ws-*.json` receipt lives forever, and
    re-creating the task id fails `BranchAlreadyCheckedOutError` although nothing is checked out.
26. **An expected-active checkout is destroyed when its id is not an opaque `ws-` id. [medium] [reproduced]**
    `worktree.mjs:1940-1963` retains an invalid-but-expected opaque owner with a diagnostic, but for
    any other id shape falls into the destructive block (`:2030-2047`: `git worktree remove --force`,
    `rmSync`, `git branch -D`) with `diagnostics`/`errors` empty — so the facade cannot fail closed
    (`index.mjs:1132` keys its refusal on those) and a live worker's checkout and branch vanish
    mid-run. A control decision taken from an id's shape, not from the caller's declaration.
27. **A gate-rejected turn still mints the orchestrator's "member completed" wake. [medium]**
    `coordinator.mjs:13537-13538` mints `_mintMemberTerminal` from the worker's own claim
    (`wr?.status === 'completed'`) before capture/scope/effects/verification run (`:13601-13608`);
    when the gate then fails the task (`:14572-14586`) no compensating reason is minted, so
    `attentionFollow` reports `member_terminal{status:'completed'}` for work the hub refused.
28. **`prepareSemanticInterrupt` commits the supersession before the interrupting act is admitted. [medium]**
    `coordinator.mjs:8439-8451` durably appends `control.interaction_superseded`, releases the record
    and sets `handle.status = 'working'`; a follow-up `interrupt(..., {preserveTurn:true})` can still
    refuse (`:8467-8483`) or throw (`:8476`). Then no answer can be delivered, no interrupt reaches the
    adapter, and the stall watchdog is disarmed for a `working` handle with `turnInFlight` false
    (`:9656-9659`) — a silent wedge with no record.
29. **`permissionsForWaveRole` fails open on any unrecognized role. [medium]**
    `coordinator.mjs:108-111`: `if (role === 'coordinator-worker') return ['read']; return ['read','claim','report'];` —
    a member Run with no `steering.registered` row, or an absent/unrecognized `waveRole`, receives
    board write authority at `:12447-12453`. The store's own lookup is stricter
    (`coordination-internals.mjs:809` requires `runId` and `waveId != null`).
30. **Read answers bypass the delivery-slot authority. [low-medium]**
    `coordinator.mjs:12288-12296` pushes a `context.read` answer with a bare `prompt(...)` on the send
    chain: no `stopping`/terminal guard, no fence, no durable `control.*` delivery record (contrast
    `_deliver`'s guards at `:8034, :8070-8087, :8147-8156`), and the ack is discarded — so "was this
    worker spoken to after the stop decision?" is unanswerable.

## IMPROVEMENTS

1. **Validate before the append, and make poison recoverable without hand surgery.** Give the store's
   pass-through writers their own shape check (the `recordSwarm` precedent, `coordination-store.mjs:12816`)
   or run the fold's validators on the payload *before* `_appendFile`; add a supported
   quarantine/repair verb so a durable-but-fold-refused event does not make replay throw the same
   error forever; and let readers (and `startupStatus`) see `_projectionPoison` instead of serving
   derived state that contradicts `eventCursor()`.
2. **Give the ledger and the worker log a self-describing frame or a verified counter.** One
   length+digest per line (or a post-append `stat` comparison against `_loadedLedgerIdentity.bytes`)
   turns the silent short write into a typed refusal at the moment it happens, instead of an
   `invalid_json` on the next start; for `log.mjs`, serve the valid prefix and refuse only the torn
   suffix, and record the pre-`try` integrity failures in `_checkpointWriteFailure` rather than
   swallowing them on lease release.
3. **Make the referee one runner, not two.** Delete the dead ENOENT branch (or fix it by awaiting the
   replacement child) and replace the greedy quote tokenizer with the closed argv contract or `sh -c`
   — the presentation already promises shell semantics; then give both paths the same head/tail
   capture bound and the same signal handling, and require `envAllowlist`/`maxOutputBytes` up front
   with a typed refusal. Derive `redGreen` only from a completed base run, matching the
   `failureOwnership` branch's own rule (`referee.mjs:454`).
4. **Treat "reserved" state as live state: settle pause records and spawn holds in a `finally`.**
   Wrap pause-record acts (`nudgeTurn`/`claimTurn`) so every exit either commits or rolls back, and
   re-check task/handle terminality after every await (the `_dispatch` precedent at `:4032-4033`);
   clear `handle.localAuthority` on every spawn-failure exit (`_onSpawnRefused` included) so
   `closeAuthority()` stays an honest statement; and isolate latch callbacks so a log failure cannot
   strand a close fact or escape as an unhandled rejection.
5. **Unify the reap report with the reap evidence.** `signaled` must come from the ladder (and be
   false for an absent group or an `EPERM` refusal); a give-up caused by the attempt budget needs its
   own reason instead of `deadline`; and `processClosedPayload` should refuse errno-shaped codes and
   `code`+`signal` together, so a libuv `-2` can never read as an exit status in a death certificate.

## NOVEL INSIGHTS

1. **"Durable first, validate always" is a system-wide posture whose failure mode is a permanently
   unbootable store.** The store appends then folds (`coordination-store.mjs:1498 → :1506`); replay
   re-folds the same event and lets the error escape (`coordination-replay.mjs:279`); `log.mjs` refuses
   a file with a torn tail forever; the capacity ledger validates on read what the writer never
   checked (`worktree-capacity.mjs:568 vs :304`). Four independent modules, one shape: the write path
   is optimistic, the read path is strict, and nobody owns repair. Every one of them is single-writer,
   so there is no peer to heal from.
2. **Several evidence fields are assertions about *not observing*.** `redGreen: true` from a timed-out
   base (`referee.mjs:350-351`); `signaled: true` from an absent process group
   (`process-lifecycle.mjs:263-264`); `{reaped: N}` without reclamation
   (`coordination-replay.mjs:1016-1020`); `checkpoint: 'corrupt'` from a size heuristic
   (`coordination-store.mjs:1037`); `outcome: candidate_failed` from a dead fallback
   (`referee.mjs:184-194`). In each case a downstream gate or certificate treats the field as
   observation. A single rule — "an evidence field may only be set by the observation that names it" —
   would close all five.
3. **The two halves of the hub disagree about who can see which failure.** The coordinator keeps
   moving state after a stop/failure (`localAuthority`, `turn.settled`, pause records, member-terminal
   wakes) while the store/referee layer reports refusals that never reach a durable record; the
   projections that operators read (`pausedTurns`, `attentionFollow`, `interactionStatus`) filter out
   exactly the wedged rows. So the *authoritative* layer says "refused" and the *presented* layer says
   "fine", which is the failure mode the audit brief calls out first: the harness lying about its
   state — and it is not one bug but a habit of dropping the refusal on the floor (`.catch(noop)`,
   `catch { /* best effort */ }`, discarded `false`).

## First five fixes

1. Validate at the store boundary before the durable append, and ship a repair verb (quarantine or
   prefix-truncate) so no single fold refusal can make a store unreplayable (`coordination-store.mjs:1497-1507`,
   `coordination-replay.mjs:279`).
2. Make the referee one runner: delete/fix the ENOENT fallback, drop the greedy quote tokenizer, and
   give the string path the same capture bound and signal handling as the argv path (`referee.mjs:105-194, 358-385`).
3. Settle pause records in a `finally` and re-check terminality after every await — the unbounded
   `resolving` wait is the one hang a participant can trigger by ordinary timing (`coordinator.mjs:2489-2521, 2583-2638`).
4. Clear `handle.localAuthority` on every spawn-failure exit and guard the `turn` lane on a paused
   task, so teardown and checkpoints stop lying (`coordinator.mjs:3782, 4446-4456, 8046-8065`).
5. Isolate `ProcessCloseReapLatch` callbacks and fix the reap ladder's report: `signaled` from the
   ladder only, a distinct reason for the attempt cap, errno-free exit codes (`process-lifecycle.mjs:107-121, 232-243, 285, 359-368`).
