# swarm.md — swarm runtime, native subagents, suite harness

Participant `swarm` in swarm `audit-a`, 2026-09-14. Work item `work-swarm`.

Scope read in full: `impl/src/swarm-state.mjs`, `swarm-contract.mjs`, `swarm-event-schemas.mjs`,
`swarm-runtime.mjs`, `swarm-surface.mjs`, `swarm-client.mjs`, `swarm-native-bridge.mjs`,
`swarm-native-access.mjs`, `native-subagent-observations.mjs`, `native-subagent-view.mjs`,
`messages.mjs`, `impl/scripts/run-suite.mjs`, `suite-verdict.mjs`, `expected-red-tests.json`
(449 rows), `docs/39`, `docs/36` (names no swarm verb at all), `docs/audits/2026-09-13-runtime-policy/*`,
`docs/audits/2026-09-14-swarm-communication/*`.

Method: every claim below is a quote from the file named on it. Four candidates were executed
against the real modules rather than argued from reading — they are marked **[reproduced]**, with
the exact call and observed output. No source file was changed and no other file was written. The
test suite was **not** run (per the audit contract); two throwaway probes were executed through
`node --input-type=module -e` / the eval kernel, so nothing was added to the tree.

Live evidence from my own seat is used where it applies: I am a recruited participant of `audit-a`,
running on the bridge, watching the machinery that coordinates me.

---

## FRICTIONS

1. **`availableActions` advertises `swarm.update`; the real per-event whitelist is a different
   field.** `swarm-runtime.mjs:371-374` builds `updates` from `UPDATE_PERMISSIONS`, and
   `:374` `if (updates.length) availableActions.push('swarm.update');` — so a contribute-only
   participant sees `swarm.update` in `availableActions` while only `updates` names what it may
   actually write. My own live `swarm.view` returns
   `"availableActions":["swarm.view","swarm.watch","swarm.guide","swarm.capture","swarm.check","swarm.update"]`
   with `"updates":["swarm.context_updated","swarm.contribution_recorded","swarm.participant_left"]`.
   An agent that reads the first list and calls `swarm.update{"event":"swarm.work_updated"}` gets
   `swarm_permission_required` (probe-see reproduced exactly this, `probe-see.md:42-49`). The
   payload shapes that *are* permitted ride `updatePayloads` (`:448-450`), so the information is
   present — it is the advertisement that misleads.

2. **A wake names the row, not the subject.** `swarm-runtime.mjs:488-489`:
   `// The wake names what woke it, so a follower can act without re-reading the log.`
   `event: relevant ? { seq: relevant.seq, kind: relevant.kind, payloadKind: relevant.payload?.kind ?? null } : null,`
   The comment's promise cannot be met by `{seq, kind, payloadKind}`: a wake on
   `swarm.context_updated` does not say which key or who wrote it, and a wake on
   `swarm.contribution_recorded` does not say whose (root.md:59 and probe-see.md:126 record the
   same experience). Every follower re-reads the whole view after every wake — which is the next
   friction, and one of the costliest.

3. **Every mutation returns the whole view.** `swarm-runtime.mjs:664`
   `return this.inspect(this._swarm(args.swarmId), principal, context);` — including a
   plain-text finding. There is no receipt form: a complete, an update and a watch all return the
   same ~30–60 KB projection (root.md:74 measures one 30–60 KB view per minute of polling), so a
   writer must diff views by hand to learn what its own call changed.

4. **A successful `swarm.guide` receipt drops the message's identity.** `swarm-runtime.mjs:743-744`
   `const result = await this.coordinator.guideParticipant(worker.id, args.message, { actor: principal.actor });`
   `return { participantId: participant.participantId, result };` — the caller learns `ok`, not the
   message id, sender or seq, although the ledger row carries them (`message.sent`, root.md:115).
   Delivery cannot be claimed by the sender without reading the coordination log.

5. **Refusals leave no durable trace, so a peer cannot see that a request was refused.**
   `_permit` throws before any write (`:618`), the payload/author checks throw before `:660`, and
   `_once`'s `swarm.operation_unavailable` record exists only for the four `_once`-guarded verbs
   (`:130-163`). Live: I passed `{"cursor":520}` to `swarm.watch`; the bridge answered
   `swarm_command_invalid: unknown field cursor` and the swarm's ledger gained nothing. Confirmed
   from the other side in `probe-see.md:132-135`.

6. **Which verbs survive `swarm.closed` is not discoverable.** Only recruitment is gated:
   `swarm-runtime.mjs:666` `if (swarm.status !== 'open' && command === 'swarm.recruit') refuse('Swarm recruitment is closed', 'swarm_closed');`
   Every other verb — `swarm.update`, `capture`, `check`, `guide`, `stop` — still writes into a
   closed swarm, deliberately (`closed_with_live_participants`, `:345-347`). An agent cannot learn
   this rule from the refusal set: closing a swarm changes exactly one verb's behavior.

7. **`delegation.complete` reads `true` for a participant that has done nothing.**
   `swarm-runtime.mjs:233-235`
   `complete: work.every((workId) => swarm.work?.[workId]?.status === 'completed') && children(...).every(...)`
   — an empty `work` array makes both conjuncts vacuously true, so a freshly recruited participant's
   own row says `complete: true`. A worker can read that as "my part is finished"
   (`probe-see.md:52-54` saw exactly this).

8. **The guidance text shipped to every native participant names a verb that does not exist.**
   `swarm-native-access.mjs:56`: `'Group, work, context, and review updates use the permitted event
   kinds shown by inspect.'` — there is no `swarm.inspect`; `SWARM_COMMAND_DEFINITIONS`
   (`swarm-contract.mjs:39-111`) is list/create/view/watch/update/recruit/guide/capture/check/stop.
   The first thing a new participant is told to run does not exist (root.md:180 reports the same).
   One word fixes it.

---

## GAPS

9. **A contributor can check its own work, and the view advertises it as available.**
   `swarm-runtime.mjs:604-607`
   `if (command === 'swarm.check' || command === 'swarm.capture') { const author = this._caller(...); permission = author?.participantId === args.participantId ? 'contribute' : 'review'; }`
   plus `:369-370` `if (permissions.includes('contribute') && !availableActions.includes('swarm.check')) availableActions.push('swarm.check');`.
   `swarm.check` runs a real verification (`checkContribution`, `:730`), and the resulting row is
   attributed to the author. docs/39:91-94 says a check is "an observation about identified work
   under identified conditions"; self-checking is the one case where those conditions are the
   author's own. Filed as #269 (root.md:150-152); still open in code.

10. **A scoped view still leaks every in-flight operation swarm-wide.**
    `swarm-runtime.mjs:359-360`
    `const scopedAttention = !scope ? attention : attention.flatMap((row) => { if (row.kind === 'operation_unconfirmed') return [row];`
    and each row carries the raw request (`:350-355`, `request: clone(event.payload.request)`). A
    participant with only `read` and a scope of itself can read another participant's guide body,
    its target and its idempotency key — probe-see captured exactly this row (`probe-see.md:113-118`,
    finding 1 at `:122-125`). The scope is documented as "only the rows its subtree can act on"
    (`:358`).

11. **Completion evidence never considers what a check concluded.** `_acceptedContribution`
    (`:174-179`) counts `accept` decisions only, and `_workEvidence` (`:183-195`) derives
    `derivedComplete` from them; a check lands as `decision: 'comment'`
    (`:734-738` `reason: \`Check ${args.checkId}: ${checked.passed ? 'passed' : 'failed'} for ${checked.sha}; cleanup ...\``).
    So a **failed** check on the very contribution that completes a work item is invisible at the
    completion claim, and a **passed** check alone completes nothing. The evidence to reconcile them
    exists on both sides; nothing joins them, and the check outcome is only readable by parsing a
    prose `reason` string.

12. **A contribution completes work without ever being captured.**
    `_requireCompletionEvidence` (`:503-525`) accepts any accepted contribution that references the
    work; `swarm.contribution_revision_attached` is optional in the fold (`swarm-state.mjs:668-689`
    only checks that a revision, if present, does not conflict). `work.evidence` therefore reports
    `accepted: [...]` identically for a finding with a pinned revision and one with none, although
    docs/39:87-89 asks that "when a claim needs reproducibility, record the relevant observation or
    revision".

13. **The wake cannot be scoped or class-filtered.** `_watch`'s relevance test is swarm-internal
    (`:473-483`) and there is no argument for it: `SWARM_COMMAND_ARGUMENTS['swarm.watch']` is
    `{ required: ['swarmId'], optional: ['afterSeq', 'timeoutMs'] }` (`swarm-contract.mjs:196-199`).
    A subtree subscriber either polls the flat view or filters by hand — the same gap named in
    `delegated-completion.md:94-96`, and root.md:174 ("a follower cannot choose wake classes").

14. **The OMP parallel-task projection has no production consumer.**
    `projectOmpParallelTasks` (`native-subagent-observations.mjs:491`) is imported only by its own
    test (`impl/test/native-subagent-observations.test.mjs:16`); the live path is
    `nativeSubagentView` (`native-subagent-view.mjs:5`), reached from
    `coordinator.mjs:2442-2445` → `swarm-runtime.mjs:261-263`. The projection that owns the careful
    invariants (orphan ends, duplicate starts, contradictory ends, `:502-538`) is the one nothing
    runs, and the live view derives child-vs-invocation truth its own way (`:25-56`).

15. **Dead board factories, honestly labelled.** `messages.mjs:394-396`
    `// Board bounds imported from the registry (Decision 8). These factories are DEAD (no impl/src`
    `// importer — blocker 8); the LIVE board.title/board.detail/board.report.body bounds are the`
    `// store's` — `createBoardItem` (`:411`), `createBoardClaimRequest` (`:440`) and
    `createBoardReport` (`:453`) have no importer in `impl/src` or `impl/scripts`. Nothing is
    wrong with them except that three validation surfaces exist that no product path can reach.

---

## ERRORS

16. **[reproduced] `content.message` wakes swarm watchers, contradicting both the code's own
    comment and docs/39.** Confidence: **high**.
    `swarm-runtime.mjs:474-478`:
    ```js
    // A watch call is itself a native tool call. Waking on tool/usage telemetry makes
    // the observer generate the next wake indefinitely, even when every peer is paused.
    if (['evidence.mapped', 'driver.recorded'].includes(kind)
      && (payload?.kind === 'content.tool_call' || payload?.kind === 'route.observed'
        || payload?.kind?.startsWith('resource.'))) return false;
    ```
    Everything else falls through to `:479-482`, whose last clause is
    `|| (payload?.worker && workerIds.has(payload.worker))` — and `workerIds` are exactly the
    participants' bound workers (`:469-471`). `evidence.mapped` payloads carry
    `{ worker, workerSeq, digest, kind, ts }` (`coordination-store.mjs:12194`), so any operational
    event of a participant's worker inside `RUN_TIMELINE_OPERATIONAL_KINDS`
    (`coordinator.mjs:60-73`) matches. That set contains **`content.message`** (`coordinator.mjs:61`)
    — the same kind the repo itself classifies as non-progress telemetry:
    `application.mjs:88` `const NOISE_TELEMETRY_OPERATIONAL_KINDS = new Set(['content.tool_call', 'content.message']);`.
    Reproduced by driving the real `_watch` with the real payload shape (1 event, `afterSeq: 0`):
    ```
    WAKES   turn.paused
    WAKES   lifecycle.turn_completed
    WAKES   content.file_edit
    silent  content.tool_call
    silent  resource.tokens
    WAKES   content.message
    ```
    Mechanism: the OMP adapter emits `content.message` for ordinary UI frames —
    `omp-rpc.mjs:542-548` `if (['notify','setStatus','setWidget','setTitle','setEditorText'].includes(frame.method)) this._emit(session, 'content.message', { phase: 'notice', note: 'omp_ui_notification', ... })`
    — so a harness narrating its own work produces one wake per notification. docs/39:160 states
    "Routine tool and usage events do not wake swarm watchers into a self-generated feedback loop",
    and `integration.md:26` records this class as *corrected*. It is corrected for tool calls and
    resource telemetry only. [INFERENCE] the frequency claim (per UI frame) cannot be measured from
    here; the matching itself is reproduced. Independently observed outside: root.md:55 and
    root.md:174, and inside: probe-see.md:246-248.

17. **[reproduced] `swarm.holder_released` cannot land when the group it prunes still names another
    departed member — and the attention rows name it as the next step.** Confidence: **high**.
    `swarm-runtime.mjs:546-560` plans
    `members: group.members.filter((member) => member !== holder.participantId)`, i.e. it removes the
    holder and nothing else, then proves the batch at `:562-565`
    `const trial = new Map([[current.swarmId, current]]); for (const event of planned) foldSwarmEvent(trial, { kind: event.kind, payload: event.payload });`.
    The fold refuses any group row naming an inactive member (`swarm-state.mjs:435-439`
    `if (member.status !== 'active') integrity(\`group member ${memberId} is not active in swarm ...\`, 'participant_not_active');`),
    and `swarm.participant_left` does not touch groups (docs/audits/2026-09-13-runtime-policy/swarm-state.md:246-247).
    Sequence folded with the real fold: create → join `alpha` → join `beta` → group `g1`
    [alpha, beta] → work/assignment on `beta` → `alpha` leaves → release `beta`:
    ```
    folded   swarm.assignment_updated
    REFUSED  swarm.group_updated :: SwarmIntegrityError code=participant_not_active :: group member alpha is not active in swarm S
    ```
    Nothing is recorded, the caller gets an integrity error rather than a typed refusal, and this is
    the operation the runtime's own attention rows point at:
    `swarm-runtime.mjs:302` `next: { event: 'swarm.holder_released', participantId: row.parentId }`
    and `:312` for `assignment_holder_gone`. docs/39:203-207 promises the release as "one durable
    batch", and `delegated-completion.md:55-57` documents that batch as "proven to fold before the
    first write" — it is proven, and for this reachable state the proof fails.
    Verified fix direction (folded): filtering the roster to current active members lets the same
    batch land — `pruned roster  folded; g1 members = []`.

18. **[reproduced] An over-cap request sent without `content-length` is answered with a socket
    reset, not the typed refusal.** Confidence: **high**.
    `swarm-native-bridge.mjs:94-102`:
    ```js
    for await (const chunk of req) {
      total += chunk.length;
      if (total > limitBytes) { req.destroy(); throw refusal(total, 'request'); }
    ```
    `req.destroy()` tears down the socket, and the response writer refuses to touch a dead response —
    `:109` `if (res.writableEnded || res.destroyed) return;`. Live against a real bridge
    (`maxFrameBytes: 1024`, same oversized body both times):
    ```
    declared content-length (truthful) -> status 413 body {"ok":false,"error":{"message":"wire.frame is 4158 bytes (cap 1024);
                                            resend within the 1024-byte cap","code":"swarm_bridge_frame_exceeded", ...
    streamed/chunked, no length       -> CLIENT ERROR ECONNRESET
    ```
    The streamed path is exactly the one `native-swarm-access.md:180` claims is covered ("wire.frame
    request bound (streamed and declared content-length lie)"); `impl/test/swarm-native-bridge.test.mjs`
    contains no chunked/`transfer-encoding` case (the two hits at :476-489 both send a declared
    length). A `curl --data-binary @-` on a pipe is enough to hit it.

19. **`--write-expected-red` rewrites the whole manifest from whatever the run happened to see.**
    Confidence: **medium-high** (read, not executed — the suite was out of bounds for this audit).
    `run-suite.mjs:399-403`:
    ```js
    if (writeExpectedRedRequested) {
      const rows = summaries[0].failed.filter((row) => !isHang(row) && row.failureType !== 'fileCrashed').map((row) => rowKey(row.file, row.name));
      const written = writeExpectedRed(manifestPath, rows);
    ```
    with `suite-verdict.mjs:33-36` writing `{schemaVersion, rows: sorted}` wholesale. The runner
    accepts explicit files (`:130`, `:162-165`), and nothing guards the write against
    `explicitFiles.length > 0` — so `node impl/scripts/run-suite.mjs impl/test/one-file.test.mjs --write-expected-red`
    replaces all 449 rows with the failures of one file. The verdict path right below *does* know
    the difference (`:406-407` `An explicit partial run cannot judge rows it never ran`), so the
    guard exists one statement away.

20. **The lane-stall half of the verdict is unreachable, and a test pins it.** Confidence:
    **medium-high**.
    `run-suite.mjs:398` `const summaries = [{ lane: 'suite', passed: ..., failed: ..., stalled: null }];`
    — `stalled` is hardcoded null, so `suite-verdict.mjs:87`
    `if (summary.stalled) stalled.push({ lane: summary.lane, ...summary.stalled });`, the `stalled`
    clauses at `:92-93` and the `stalled lane` line at `:106` can never fire, while `:10` documents
    "no lane stalled (the runner's progress deadline expired with tests still pending)" as one of
    the four conditions of green. `impl/test/suite-verdict.test.mjs:64-70` asserts the behavior of
    an input the runner cannot produce (the per-file progress deadline at `run-suite.mjs:297,305-310`
    replaced it with `fileHung`, `:328`). Two derivations of one idea; one of them dead.

21. **The attention-shed accounting omits the marker it appends.** Confidence: **low** (real, small,
    and I did not measure it). `messages.mjs:703-709`:
    ```js
    const share = Math.max(1, Math.floor(byteCap / Math.max(1, inBlock.length)));
    ...
    const budget = Math.max(0, share - Buffer.byteLength(head));
    return `${head}${capBytes(attentionLeafText(item), budget).text}${ATTENTION_BYTE_SHED_MARKER}`;
    ```
    Each shed line is `head + budget + marker` = `share + 11` bytes, so a block that sheds `n` items
    overshoots `view.attention_push.bytes` by about `n × 11` — the one branch whose whole purpose is
    to stay inside the bound. The unshed branch accounts exactly (`:698` adds the newline).

22. **A capture that dies between its two appends leaves a contribution that reads as captured.**
    Confidence: **low** (no atomicity is claimed, but nothing downstream can tell).
    `swarm-runtime.mjs:715-726` writes `swarm.contribution_recorded` and then
    `swarm.contribution_revision_attached` as two separate `_write` calls. A failure between them
    leaves a contribution with `body` and no `revision`; `inspect` shows it identically to a
    captured one under `work.evidence.contributions`, and (see item 12) it can complete the work.

---

## IMPROVEMENTS

23. **Read the tail, not the ledger.** `swarm-runtime.mjs:472`
    `const events = this.store.eventsView().slice(cursor);` calls `eventsView()` with no argument,
    which copies the entire ledger — `coordination-store.mjs:8510-8513`
    `eventsView(fromSeq = 1, limit = null) { ... return this._events.slice(start, ...); }`, and the
    store already documents the cost: `:8500-8502` "#227 (2026-08-15): the O(1) ledger cursor. Delta
    consumers … need the current tail position WITHOUT materializing the ledger — eventsView() with
    no arguments copies the world (the #210 class)". `eventsView(cursor + 1)` returns exactly the
    events `slice(cursor)` returns, without the prefix copy; `eventCursor()` (`:8503-8505`) serves
    the head. This runs once per wait-loop iteration, so it is the follower's per-wake cost.

24. **Derive the `operation_unconfirmed` rows without copying the ledger per view.**
    `swarm-runtime.mjs:348-349`
    `const operations = this.store.eventsView().filter((event) => event.kind === 'driver.recorded' && event.payload.swarmId === swarm.swarmId && ...);`
    — a full-array copy plus a full scan on every `inspect`, i.e. on every mutation response and
    every wake, including wakes that changed nothing about operations (item 16 makes those
    frequent). A per-swarm index maintained at append, or a scan restricted to the driver.recorded
    coordinates, removes both.

25. **One source for "this event is not a milestone".** The watch exclusion list (item 16) is a
    hand-kept literal inside `_watch`; `application.mjs:88` already owns the classification
    (`NOISE_TELEMETRY_OPERATIONAL_KINDS`). Importing it — or naming the swarm's own set beside it —
    means the next noise kind is added once, and the comment at `:474-475` becomes checkable.

26. **Stop copying every participant's operational log on every view.**
    `swarm-runtime.mjs:261-262` calls `this.coordinator.observedNativeSubagents(worker.id)` for each
    participant; that is `coordinator.mjs:2444`
    `return nativeSubagentView(this._log.read(workerId));`, and `log.mjs:166-170`
    `read(worker, fromSeq = 1) { const events = this._load(worker); ... return events.slice(Math.max(0, fromSeq - 1)); }`
    — a full copy of that worker's whole JSONL index, per participant, per view. A long-lived
    participant's log is the largest thing in the deployment. Memoizing on `(workerId, log tail seq)`
    or projecting incrementally would make a view cost proportional to the change, not to the history.

27. **Make the holder-release batch prune, or name what blocks it.** (Fix for item 17.)
    In `_holderRelease`'s planned group event, keep only current active members:
    `members: group.members.filter((member) => member !== holder.participantId && participants[member]?.status === 'active')`
    — folded, verified above. If pruning is judged to say more than the operation means, the trial
    fold's `SwarmIntegrityError` should be converted to a refusal naming the group and the departed
    seat, so the caller is told which record to repair instead of receiving an integrity error.

28. **Answer the refusal instead of hanging up.** (Fix for item 18.) In `readBody`, drain the
    remaining request body and throw, letting the single response path write the 413 the registry
    composes; if the socket must be closed first, close it *after* `res.end` flushes
    (`res.end(body, () => req.destroy())`).

29. **Refuse a manifest rewrite from a partial run.** (Fix for item 19.) In `run-suite.mjs:399`,
    guard `writeExpectedRedRequested` with `explicitFiles.length === 0` (or make the flag mean
    "merge"), mirroring the reasoning already written at `:406`.

30. **Make the wake carry its subject.** (Fix for item 2.) The event the filter already matched is
    in hand; adding the acting participant and the changed coordinate (`key`, `contributionId`,
    `workId`, `participantId`) to `watch.event` costs nothing and is what the comment at `:488`
    already claims. Paired with items 23-24 it turns "wake → re-read 60 KB" into "wake → act".

---

## NOVEL INSIGHTS

31. **The swarm lane's error vocabulary is split in two, and the split is invisible to the caller.**
    Malformed or unauthorized requests throw `SwarmRefusal`/contract errors with codes the surfaces
    document (`swarm-state.mjs:41-48`); *reachable-state* blocks throw `SwarmIntegrityError`
    (`:50-56`), which the bridge has no status for and forwards as 422 — the same status as a
    refusal (`swarm-native-bridge.mjs:220-222`). So `participant_not_active` (item 17),
    `version_conflict`, `work_dependency_cycle` and `swarm_already_closed` reach an agent looking
    exactly like a permission problem. The distinction that matters — "your request was wrong" vs
    "the state is reachable and the operation cannot express it" vs "you may not" — is not in the
    code, the HTTP status, or the docs.

32. **The holder-release batch is atomic because nothing awaits, not because anything guarantees
    it.** `_holderRelease` writes N events in a synchronous `for` loop (`swarm-runtime.mjs:567`
    `for (const event of planned) this._write(event.kind, event.payload, principal, ...)`), after
    proving the batch against a trial map (`:564-565`). The store *has* a batch append, but its
    kinds are closed — `coordination-store.mjs:1531-1542` accepts only
    `recovery_refinement_create_claim`, …, `PLAN_OBJECT_BATCH_KINDS` — so the swarm lane cannot use
    it. Any later `await` inserted in that loop silently converts "one durable batch" (docs/39:203)
    into a partial release whose retry depends on `_once`'s replay path.

33. **`recordSwarm`'s pre-fold is load-bearing against a silent no-op.** The store's append path
    returns the prior event and writes nothing when the key already exists —
    `coordination-store.mjs:1488-1489` `const prior = this._byKey.get(key); if (prior) return prior;`
    — and `_byKey` is one namespace for every lane. `recordSwarm` (`:12822-12829`) is what turns that
    silence into `swarm_replay_conflict` by comparing kind, actor and canonical payload first, then
    folding a prospective event (`:12830-12834`). A new swarm write path that called `_append`
    directly would lose both protections without any test noticing.

34. **Three tested pure functions whose only consumer was deleted** — `projectOmpParallelTasks`
    (item 14), the three board factories (item 15), the lane-stall branch of the verdict (item 20) —
    share one shape: elaborate invariants, dedicated tests, no production caller. The suite stays
    green because it tests the derivation, not the wiring. It is the same failure mode three times,
    and it is cheap to detect: an export whose only importer is `impl/test/`.

35. **The completion chain and the check chain run in parallel and never meet.** Reading the three
    files together: `swarm.check` writes a `comment` review whose outcome lives in prose
    (`swarm-runtime.mjs:737`), acceptance reads only `accept`/`reject` (`:174-179`), completion reads
    only acceptance (`:503-525`), and the view projects all of it without relating any of it. So the
    answer to an orchestrator's question "is this work done, and was it checked?" is assembled from
    two disjoint projections plus a string parse. docs/39:91-94 insists checks and completion are
    different facts — that is the right call — but the projection never shows them *as* different
    facts about the same contribution.

---

## First five fixes

1. Exclude `content.message` from the watch filter (item 16) — one predicate, and it is the wake
   path every follower pays for.
2. Prune the holder-release roster to active members, or refuse with the blocking group named
   (item 17) — an operation the attention rows recommend currently cannot run.
3. Do not destroy the socket before answering the frame refusal (item 18) — the typed error the
   module promises is lost exactly when a caller is over the bound.
4. Guard `--write-expected-red` against partial runs (item 19) — one line, 449 rows of manifest at
   risk.
5. Give the wake its subject and read the ledger tail (items 2, 23) — the difference between a
   follower that acts and one that re-reads the world.

---

### Notes on this audit

- **Asserted but not re-verified here:** the test suites named in the audit docs were not executed
  (contract), so every "test pins X" statement is a read of the test file. Items marked
  **[reproduced]** were executed against the real modules and their output is quoted verbatim.
- **Cross-check against the expected-red manifest:** all 449 rows were scanned. None names
  `swarm`, `run-suite`, `suite-verdict`, `native-subagent-observations` or `messages` (the
  `wake`/`watch`/`holder` hits all belong to `orchestrator-wake-red.test.mjs`'s actions lane). The
  swarm family therefore asserts green everywhere, and no listed row covers any error above —
  including the three paths I reproduced, which no test exercises: 16 has no `content.message`
  case, 17 no group holding a departed seat, 18 no request without `content-length`.
- **Where I proceeded against an unsettled coupling:** the lead's protocol names a writer record
  over the shared checkout, but the swarm carries none — `swarm.view` shows only `sync-reports-in`
  (synchronization, arrivals `['surfaces']`) and `policy-auditors` (failure/independent). I recorded
  `context/writing:swarm` and wrote this file without waiting further, on the documented rule that
  coupling informs and does not fence (docs/39:238-244), and I name it here rather than let a
  missing record read as consent.
- **Live evidence used:** my own seat's `swarm.view` (frictions 1, 7), my refused `swarm.watch`
  (friction 5). I am a participant in the machinery I audited: my reports land through
  `swarm.contribution_recorded`, and my own harness frames are the `content.message` class of
  item 16.
