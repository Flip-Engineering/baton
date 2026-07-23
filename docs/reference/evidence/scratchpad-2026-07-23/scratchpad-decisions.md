# Scratchpad decisions contract — typed writes into the ephemeral task horizon (issue #33)

Status: implementation contract, 2026-07-23.

Ground truth: issue #33 plus its reframe comment. The scratchpad is **not a new filesystem
convention, service, graph, or query subsystem**. It is the missing typed worker-write surface
into KG-1's existing task/workflow horizon projections. Workers propose private entries;
the orchestrator may elevate selected entries to the workflow-shared partition at end-of-task
and selected workflow candidates to the project KG at end-of-workflow. Entries remain candidates
after their authoring worker exits and are logically reaped only when the workflow settles.

Every citation below was checked against this worktree. The brief's coordination-store line
numbers predate intervening changes: `_apply` is now at
`impl/src/coordination-store.mjs:7367-8235`, the board slice at `:12590-12785`, REPL bindings at
`:12845-13057`, and `snapshot()` at `:10883`. The rules cite those current locations while
preserving the intended seams.

Code this contract is grounded in:

- KG-1 already supplies three projections, not three stores: `taskHorizon`,
  `workflowHorizon`, and `projectHorizon` plus their exact-tuple cache
  (`impl/src/coordinator.mjs:9634-9720`). Task and workflow reads call the plain
  `boardSnapshot`/`queryKnowledge` paths and are non-evented; project recall remains separately
  ownership-bound by `recallKnowledge` (`coordinator.mjs:9467-9487`).
- Board and binding partitions are the slice precedent. Boards maintain an indexed per-board
  projection and a replay-derived board fence (`coordination-store.mjs:12590-12613`,
  `:12774-12785`). REPL bindings are keyed by the JSON tuple `(runId, scope, name)`, bind caller
  identity through an admitted manifest rather than trusting caller-supplied ownership, bump a
  replay-derived per-scope fence on every write, and expose a non-evented active-only snapshot
  (`:12845-12956`, `:13035-13057`). Scratchpad partitions follow those rules; they do not reuse
  board claims, REPL cells, or the worker turn fence as their read fence.
- Existing Scratch is the naming and promotion neighbor, not the read-model template.
  `postScratchFact` derives `ownerWorker`/`ownerTask` and checks the worker turn fence
  (`coordinator.mjs:9510-9527`), while `readScratch` appends `scratch.read`
  (`coordinator.mjs:9530-9538`; store append at
  `coordination-store.mjs:12582-12587`). Issue #33 explicitly takes the F10 path instead:
  scratchpad polling appends **no** read event.
- Replay is closed and fail-fast. Projection fields are enumerated in
  `PROJECTION_CHECKPOINT_FIELDS` (`coordination-store.mjs:92-118`), initialized by
  `_resetProjection` (`:897-939`), folded by `_apply` (`:7367-8235`), rejected after run-stop
  admission where appropriate (`:7376-7403`), exposed by `snapshot()` (`:10883`), and unknown
  event kinds fail with `unsupported_event_kind` (`:8223-8225`). Adding only an admission method
  is therefore incomplete.
- F14's established projection discipline is `boundedAttentionText` plus
  `SECRET_SHAPED_TEXT` (`impl/src/application.mjs:226-240`) and an explicit untrusted provenance
  marker (`projectContextPackageBranch`, `:242-261`). Raw worker prose is not promoted visually
  to hub-authored truth merely because the hub stored or projected it.
- The two existing promotion paths remain distinct. Observed Scratch facts qualify only after
  `minScratchReaders` completed, verified reader tasks in `_deriveKnowledgePromotion`
  (`coordination-store.mjs:13143-13200`); workflow Findings enter the project horizon only through
  `admitWorkflowFinding`'s promotion-actor and active-run-lease gate
  (`:13423-13510`; coordinator wrapper `:9618-9631`). Scratchpad adds a candidate source to the
  latter path and never weakens or impersonates the former.

## Part A — one write surface, four closed entry shapes

1. **The worker API is one method, `writeScratchpad(workerId, entry, opts)`, and it always writes
   the caller's private partition.** It mirrors `postScratchFact`'s ownership boundary:
   the coordinator resolves the live handle, derives `runId`, `ownerTaskId`, and `ownerWorkerId`,
   admits only task status `working|input_required|paused`, checks
   `opts.expectedFence` against the worker's current turn fence, and requires a non-empty
   `opts.idempotencyKey`. The caller cannot supply `runId`, task/worker ownership, partition,
   identity, digest, ordinal, timestamps, elevation state, or provenance. A stale fence returns
   `stale_fence`; a non-live task returns `task_not_active`; neither appends an event. This is the
   same late-turn protection at `coordinator.mjs:9490-9527`, not a new fence family.

2. **`entry` is an exact discriminated union with no unknown or omitted fields.** Validate with
   the same exact-key discipline as `exactObject` (`application.mjs:214-219`), normalize every
   string to NFKC and trim it before deriving digests, reject NUL/control characters, and refuse
   an empty string after normalization:

   - `note`: `{ kind: 'note', text }`; `text` is 1..4,096 UTF-8 bytes.
   - `plan`: `{ kind: 'plan', goal, steps }`; `goal` is 1..1,024 bytes; `steps` is 1..32 exact
     objects `{ text, state }`; each `text` is 1..512 bytes and `state` is the closed enum
     `pending|active|done|blocked`.
   - `doubt`: `{ kind: 'doubt', question, basis }`; `question` is 1..1,024 bytes; `basis` is
     exactly `null` or a non-empty string of at most 4,096 bytes.
   - `link`: `{ kind: 'link', label, ref }`; `label` is 1..256 bytes; `ref` is the exact object
     `{ kind, value }`, with `kind` in `artifact|board|repl|knowledge|uri` and `value` 1..2,048
     bytes. A link is a typed pointer, not proof that the target exists; resolution and target
     authorization remain with the target subsystem.

   The canonical normalized `entry` must also fit `MAX_SCRATCHPAD_ENTRY_BYTES = 16 * 1024`.
   Bounds are checked before hashing or append. No generic metadata bag, tags array, Markdown
   attachment, arbitrary JSON value, or caller-chosen type string is accepted.

3. **Entries are immutable observations, not tiny mutable documents.** A worker records a new
   plan snapshot when its plan changes and may link related entries through an ordinary
   `link` value. There is no edit/upsert/delete verb, no caller-supplied `supersedes`, and no
   last-write-wins record. This keeps the fold append-only and makes every elevated candidate
   cite one exact entry digest. Workflow reap is the only removal from the active projection
   (Part E, rule 24).

4. **Admission has hard aggregate ceilings in addition to per-entry bounds.** A worker partition
   admits at most 256 active entries and 1 MiB of canonical entry bytes per `(runId,
   ownerWorkerId)`; the entire run admits at most 1,024 active rows and 4 MiB of canonical entry
   bytes across all private partitions plus workflow-shared elevated copies. Exceeding any count
   or byte ceiling refuses
   `scratchpad_capacity_exceeded` without append. These are deployment constants validated as
   positive safe integers; they are not caller options. They prevent a legal sequence of small
   writes from manufacturing an oversized projection or checkpoint.

## Part B — partitions, ownership, hub identity, and content address

5. **There are exactly two partitions, and worker authors cannot choose between them.**

   - Private key: `JSON.stringify([runId, 'worker', ownerWorkerId])`.
   - Shared key: `JSON.stringify([runId, 'shared'])`.

   `scratchpad.entry_posted` can create only a private row. Only the lease-bound orchestrator
   elevation in rule 9 can create a shared row. A worker read returns its own private rows plus
   the run's shared rows; it never returns a sibling worker's private rows. An orchestrator read
   may target one member and returns that member's private rows plus the same shared rows. This
   is the board/binding slice rule applied to prose: scope is part of the indexed key and is
   derived from authority, never a post-filter over one unbounded global scan.

6. **Identity and content address are separate hub-authored values.** On a new private write the
   store assigns the next partition-local `ordinal` and prospective coordination `mintSeq`, then
   computes:

   ```
   entryId = "scratchpad-entry:" + canonicalDigest({
     runId, ownerTaskId, ownerWorkerId, ordinal, mintSeq
   })
   contentDigest = canonicalDigest(normalizedEntry)
   entryDigest = canonicalDigest({
     schemaVersion: 1, entryId, runId, ownerTaskId, ownerWorkerId,
     partition: { kind: "worker", workerId: ownerWorkerId },
     ordinal, kind: normalizedEntry.kind, content: normalizedEntry, contentDigest,
     sourceEntryId: null, provenance: "worker-authored"
   })
   ```

   The caller may not submit any of these three values. `entryId` distinguishes two intentional
   identical notes; `contentDigest` proves their normalized content is identical; `entryDigest`
   binds content to ownership and partition. This follows board's hub-minted id plus recomputed
   item digest (`coordination-store.mjs:12628-12635`) rather than `claimScratch`'s optional
   caller id (`:12545-12552`), which is deliberately not copied.

7. **Idempotency is payload-bound, not `_append`'s blind key replay.** Reusing an auth key with
   the same derived ownership tuple and the same normalized `contentDigest` returns the original
   entry/event. Reusing it with a different kind, content, task, worker, or run refuses
   `scratchpad_idempotency_conflict`. Validate that comparison before allocating the next ordinal;
   a replay neither consumes capacity nor bumps the scratchpad fence.

8. **The durable private row is a closed projection.** It contains exactly the core fields in
   rule 6 plus `createdEvent`, `createdAt`, `active: true`, `elevatedEntryId: null`, and
   `reapedEvent: null`, where lifecycle fields are derived by `_apply`, never stored in the event
   payload. The shared row uses
   `entryId = "scratchpad-shared:" + canonicalDigest({ runId, sourceEntryId })`,
   partition `{ kind: 'shared' }`, preserves the source's content/kind/ownership/contentDigest,
   binds `sourceEntryId`, uses a shared-partition ordinal, and has its own recomputed
   `entryDigest`. Raw caller objects are cloned and frozen at the fold boundary, matching board
   and binding projections (`coordination-store.mjs:7916-7960`).

## Part C — event kinds and the complete replay/fold surface

9. **Exactly three new event kinds own scratchpad lifecycle.**

   - `scratchpad.entry_posted`: one worker-authored private entry payload.
   - `scratchpad.entry_elevated`: one orchestrator-selected private entry copied into the
     workflow-shared partition. Admission is atomic with one existing `knowledge.node_added`
     event for its observed workflow candidate (rule 20).
   - `scratchpad.reaped`: one run-level logical reap after settle-time selection. Its payload is
     `{ schemaVersion: 1, runId, expectedScratchpadFence, throughSeq, activeCount,
     activeSetDigest }`, not an unbounded array of entry bodies or ids.

   There is deliberately no `scratchpad.read`, `scratchpad.updated`,
   `scratchpad.entry_deleted`, `scratchpad.candidate_created`, or worker-authored shared event.
   Candidacy is a property of every active private row; elevation is the admission decision, not
   a second per-entry "candidate" write.

10. **`scratchpad.entry_elevated` is an orchestrator authority operation, not a worker mode
    flag.** `elevateScratchpadEntry(runId, sourceEntryId, expectedScratchpadFence, lease)` requires:

    - an active private source in that run;
    - the source task in `completed|failed|cancelled` (end-of-task means terminal, not only
      successful);
    - no prior shared entry for that source;
    - `expectedScratchpadFence` equal to the current run scratchpad fence;
    - `promotionActor(auth.actor)` and the same active run-orchestrator lease tuple required by
      `admitWorkflowFinding` (`coordination-store.mjs:13473-13487`);
    - a payload-bound idempotency key.

    Success creates the shared row described in rule 8 and marks only the private row's
    `elevatedEntryId`; the private row stays active and historically exact until the run reap.
    A worker death, handle removal, adapter stop, failed task, or cancelled task does not delete
    or disqualify it. This is what “candidacy is continuous” means operationally.

11. **The store gains four replay-derived structures, not a second subsystem:**
    `_scratchpadEntries: Map<entryId,row>`,
    `_scratchpadEntriesByPartition: Map<JSON-tuple, readonly entryId[]>`,
    `_scratchpadFences: Map<runId,number>`, and
    `_scratchpadReaps: Map<runId,reapRecord>`. Every admitted post/elevation increments the
    run fence once; a reap increments it once after applying the reap. Elevation's accompanying
    `knowledge.node_added` does not increment the scratchpad fence. All four are ordinary
    in-memory projections over `events.jsonl`; the ledger remains the single truth.

12. **All checkpoint/reset/snapshot sites change together.** Implementation is incomplete unless
    the same patch:

    - adds all four fields to `PROJECTION_CHECKPOINT_FIELDS`
      (`coordination-store.mjs:92-118`);
    - initializes them in `_resetProjection` beside existing Scratch/board/binding projections
      (`:897-939`);
    - folds all three new kinds in `_apply`, with exact shape/digest/invariant validation before
      mutating indexes (`:7367-8235`);
    - adds a bounded `scratchpad` branch to `snapshot()` containing active entries, per-run
      fences, and reap records (`:10883`);
    - includes the new store methods in the coordinator's mutation/dependency contracts
      (`impl/src/coordinator.mjs:246-260`, `:665-671`); and
    - leaves `_apply`'s final unknown-kind refusal intact
      (`coordination-store.mjs:8223-8225`).

    Checkpoint restore followed by tail replay must equal full replay byte-for-byte for entries,
    partition indexes, fences, elevation links, and reap state.

13. **The run-stop admission guard distinguishes new work from cleanup.** In `_apply`'s
    `admittedRunId` derivation (`coordination-store.mjs:7376-7403`), both
    `scratchpad.entry_posted` and `scratchpad.entry_elevated` resolve their hub-bound `runId` and
    are rejected with `run_stopping` once that run is in `_runStopByTarget`/`_runStops`. They are
    new semantic work. `scratchpad.reaped` is intentionally excluded from `admittedRunId`: it is
    bounded cleanup, may run after a forced stop, creates no candidate, and only removes rows
    from active projections. Its validator still requires an existing run, an unreaped exact
    active-set digest at `throughSeq`, and a matching `expectedScratchpadFence`; excluding it
    from the stop guard is not a general mutation escape hatch.

14. **Reap payloads are replay-verifiable without carrying the active set.** At admission the
    store derives the sorted active entry ids for `runId` through the current event boundary,
    computes `activeSetDigest = canonicalDigest(ids)`, records their count and the current
    scratchpad fence, and appends one event. `_apply` re-derives that same set before mutation;
    any count/digest/fence mismatch is `scratchpad_reap_integrity`. The fold marks each row
    inactive with the reap event, removes its id from active partition indexes, records the reap,
    and bumps the run fence once. A same-key retry replays; a second distinct reap is
    `scratchpad_already_reaped`, including when the first active set was empty.
    The admission method is
    `reapScratchpad(runId, expectedScratchpadFence, auth, lease = null)`: before ordinary settle
    it requires `promotionActor(auth.actor)` plus the active run lease; after forced stop it
    accepts only `actor:'policy'` with an existing run-stop record. No worker actor can reap.

15. **Scratchpad events are horizon inputs with their own named fence, not hidden behind an
    evented read.** Add `scratchpadFence(runId)` to the store. Append it to both the task-horizon
    and workflow-horizon fence tuples at `coordinator.mjs:9670-9709`; their computed values add
    the relevant scratchpad projection. This is sufficient because every event that can change a
    scratchpad slice bumps that run fence. Do not also add these kinds to
    `PROJECTION_INPUT_NONKG_EVENTS` (`coordination-store.mjs:136-142`): double-invalidating a
    second global fence would add cache churn without additional correctness. The project
    horizon remains fenced by `eventFence()` (`:12610-12614`) and therefore observes the
    candidate knowledge event normally.

## Part D — non-evented bounded reads and the driver steering projection

16. **`scratchpadSnapshot(runId, targetWorkerId, page)` is a cached, non-evented projection.**
    The exact page request is `{ after, limit }`, where `after` is `null` or the exact object
    `{ createdEvent, entryId }` (`createdEvent` a positive safe integer and `entryId` a valid
    scratchpad id), and `limit` is 1..128. The store reads only the target private
    partition index and the run shared index, merges them in `(createdEvent, entryId)` order, and
    stops before either `limit` or `MAX_SCRATCHPAD_PROJECTION_BYTES = 256 * 1024`. It returns:

    ```
    {
      schemaVersion: 1,
      runId,
      targetWorkerId,
      scratchpadFence,
      entries,
      nextAfter,
      truncated
    }
    ```

    `nextAfter` is the last returned ordering cursor when more rows exist, otherwise `null`.
    A single row that cannot fit the result ceiling is impossible under rule 2's 16 KiB entry
    ceiling; any invariant breach fails `scratchpad_projection_oversize` rather than emitting an
    oversized frame. Cache key is the exact tuple
    `(runId,targetWorkerId,scratchpadFence,after.createdEvent,after.entryId,limit)`.

17. **A poll appends nothing.** `scratchpadSnapshot` must leave `_events.length`, `_byKey`,
    operational logs, `_scratchReads`, and `_knowledgeReads` byte-identical. In particular, do
    not implement it by adapting `readScratch`: that method explicitly appends `scratch.read`
    (`coordination-store.mjs:12582-12587`) and the coordinator requires an idempotency key for
    every read (`coordinator.mjs:9530-9538`). That evented read exists so
    `minScratchReaders` can later prove causal readership. Scratchpad is steering memory polled
    frequently; eventing every poll is exactly the F10 write-amplification defect the board and
    binding snapshots avoid (`coordination-store.mjs:12778-12785`, `:13035-13043`).

18. **Both readers are ownership-bound, but the orchestrator can deliberately target a member.**

    - `workerScratchpad(workerId, page)` resolves the handle's current `runId` and passes the same
      worker as `targetWorkerId`; there is no argument with which a worker can request a sibling.
    - `driverScratchpad(runId, targetWorkerId, page)` is an orchestrator-side coordinator
      projection. It verifies that the target worker owns a task in `runId` (live or terminal)
      before calling the same snapshot. This method remains readable after handle death because
      ownership comes from durable task records, not `_workers`.
    - `wave.scratchpad(role, page)` resolves `role` through the wave's own member map
      (`impl/src/wave.mjs:127-160`, `:342-349`) and calls that member run's driver projection.
      No raw run/worker id supplied by the wave caller is trusted.

    A wave driver can therefore read the private notes of the exact member it is steering plus
    the workflow-shared entries, even after that member crashes. This is the feature, not an
    audit side effect. `wave.progress()` may expose only `{scratchpadFence, entryCount}`; it must
    not inline prose into every progress poll.

19. **Every application-facing entry is sanitized and provenance-marked.** The store snapshot is
    an internal raw projection needed for deterministic replay and digest verification. Before a
    worker brief, RunView, MCP result, CLI output, or `wave.scratchpad` response receives it, one
    application helper maps every worker-authored `text`, `goal`, step text, `question`, `basis`,
    link `label`, and link `ref.value` through `boundedAttentionText`; credential-shaped content
    becomes `[credential-shaped content redacted]` under `SECRET_SHAPED_TEXT`
    (`application.mjs:226-240`). Each projected row carries
    `provenance: 'untrusted-worker-authored'` and retains immutable ids/digests separately.
    Sanitization never rewrites stored content or content digests. Hub labels, field names,
    states, ids, digests, ordinals, and fences are rendered as metadata, not passed through the
    prose helper. This mirrors `projectContextPackageBranch`'s explicit `provenance:'untrusted'`
    boundary (`application.mjs:242-261`).

## Part E — continuous candidacy and promotion through existing paths

20. **Task → workflow elevation is atomic with an observed KG candidate, following board-close.**
    `elevateScratchpadEntry` uses `_appendBatch` for exactly:

    1. `scratchpad.entry_elevated`, carrying the closed shared-row core and the source entry
       binding; then
    2. `knowledge.node_added`, hardcoded `actor:'policy'`, for
       `id: "finding:scratchpad-elevated:" + sharedEntryId`, `type:'Finding'`,
       `grounding:'observed'`, evidence `[{coordinationSeq: elevationSeq}]`,
       `promotion:{kind:'Finding',trigger:'scratchpad.entry_elevated'}`, `runId`, and
       `scratchpadEntryRef:{entryId,entryDigest,contentDigest,kind,ownerTaskId,ownerWorkerId}`.

    The candidate body is the normalized worker entry rendered into a deterministic
    type-specific form (note text; plan goal plus ordered steps/states; doubt question plus
    basis; link label plus typed ref). It remains worker-authored untrusted prose and must obey
    rule 19 on every projection. This is structurally the existing board-close batch:
    `_boardSuccessor` appends `board.item_closed` followed by a policy-authored observed Finding
    with evidence pointing to the first event (`coordination-store.mjs:12657-12677`). The
    knowledge event is not a claim that the entry is true; it is a stable workflow candidate
    saying exactly what one task proposed.

21. **End-of-workflow promotion extends the KG-2 candidate allowlist, not its authority gate.**
    `_deriveWorkflowAdmission` currently admits observed Findings triggered by
    `board.item_closed|package.admitted` (`coordination-store.mjs:13423-13437`). Add only
    `scratchpad.entry_elevated` to that trigger allowlist. Keep every other derive/validate,
    digest, evidence, `DerivedFrom`, `promotionActor`, run-lease, prospective-time, result-byte,
    and idempotency rule at `:13439-13510` unchanged. The orchestrator calls the existing
    coordinator `admitWorkflowFinding` wrapper (`coordinator.mjs:9618-9631`) for each selected
    candidate before lease revocation and before reap. Unselected workflow candidates are not
    admitted as verified project findings.

22. **The existing observed Scratch-fact path remains intact and cannot be bypassed by a note.**
    `scratch.fact_posted` with `grounding:'observed'` still requires
    `minScratchReaders` distinct completed tasks with verified outcomes before
    `knowledge.promotion_batch` will derive a Finding
    (`coordination-store.mjs:13176-13190`). A scratchpad `note` is not silently coerced into a
    Scratch fact, a non-evented scratchpad poll is not counted as a `scratch.read`, and an
    orchestrator elevation does not fabricate reader receipts. If a worker has an actual
    environment-bound observation, it continues to use `postScratchFact` and may add a
    scratchpad `link` to that fact. Thus both settled routes climb honestly:

    - factual Scratch → readership/verified-outcome policy → `knowledge.promotion_batch`; and
    - typed scratchpad proposal → task-settle observed workflow candidate → workflow-settle
      `knowledge.workflow_admitted`.

    Neither route auto-upgrades raw worker prose to verified truth.

23. **End-of-task selection runs after terminal transition and before task cleanup; end-of-workflow
    selection runs before reap.** The orchestrator's settle order is:

    1. transition the task terminal and retain its durable worker/task ownership;
    2. read that worker's fixed-fence scratchpad pages;
    3. elevate zero or more selected private entries under the active run lease;
    4. when the workflow settles, review the shared projection and call
       `admitWorkflowFinding` for zero or more selected observed candidates;
    5. finish or explicitly abandon all admissions;
    6. append `scratchpad.reaped`;
    7. revoke the run-orchestrator lease and/or admit run stop.

    A fence change during steps 2-3 invalidates the selection and forces a fresh read; it never
    silently elevates a stale page. Forced stop may skip steps 2-5 and still perform rule 14's
    cleanup-only reap. This ordering is the same lease-before-revocation constraint already
    documented at `coordinator.mjs:9618-9624`.

24. **“Ephemeral” is a projection lifecycle promise, not a secure-erasure claim.** Before reap,
    active entries survive worker/adapter death, task terminality, coordinator restart,
    checkpoint restore, and full replay. After reap, task/workflow snapshots and driver/worker
    surfaces return no entry bodies for that run; only the bounded reap receipt and any
    explicitly elevated KG candidate/admission remain visible. Original event bytes necessarily
    remain in the append-only ledger for replay/audit until the deployment's existing log
    retention policy removes them. This contract adds no shredding, encryption, compaction, or
    “right to erasure” mechanism and must not describe logical reap as physical deletion.

## Part F — red tests first (`impl/test/scratchpad-33-red.test.mjs`)

- **Closed input and bounds (rules 1-4):** each of the four exact shapes admits at its byte/count
  boundary and rejects empty/oversized/unknown/missing fields, an unknown kind, more than 32
  plan steps, an invalid plan state/link kind, NUL/control text, a >16 KiB canonical entry, the
  257th private entry, and the first write crossing the per-worker or all-partitions run
  aggregate byte ceiling. Tests use a
  fixed clock (`2026-07-23T12:00:00.000Z`) and deterministic increments only.
- **Ownership and identity (rules 5-8):** a worker cannot supply or spoof run/task/worker,
  partition, id, ordinal, digest, timestamps, or provenance; two equal entries with different
  idempotency keys have different hub ids and equal content digests; a same-key same-payload
  retry returns the original event without fence/capacity change; a same-key changed-payload
  retry refuses `scratchpad_idempotency_conflict`. A worker slice contains own+shared and never a
  sibling private row; the orchestrator can target either member exactly.
- **Fence and stale-turn admission (rules 1, 11, 15):** every post/elevation/reap advances the
  run scratchpad fence exactly once; idempotent retries/refusals do not; a stale worker turn fence
  appends nothing; task/workflow horizon caches hit on an identical tuple and miss after each
  scratchpad event without any `projectionInputFence` double bump.
- **Full replay surface (rules 9-14):** post/elevate/reap replay from genesis equals checkpoint+
  tail replay and `snapshot().scratchpad`; omitting/tampering each id/content/set digest or closed
  field poisons replay; an unknown scratchpad event kind still reaches `unsupported_event_kind`.
  Source/private elevation linkage, partition indexes, fences, and reaps survive restart.
- **Run-stop guard (rule 13):** posts and elevations admitted after `run.stop_admitted` fail
  `run_stopping` on live apply and replay; cleanup reap succeeds after forced stop, cannot mint a
  candidate, and refuses a mismatched fence/set digest or second reap.
- **Non-evented projections (rules 16-18):** repeated first/middle/final-page worker, driver, and
  `wave.scratchpad(role)` reads leave coordination and operational event counts, `_scratchReads`,
  and `_knowledgeReads` unchanged; paging has no gaps/duplicates across the private+shared merge,
  obeys 128-item/256 KiB ceilings, and marks `nextAfter`/`truncated` honestly. A crashed member
  remains readable from durable ownership; an unknown role/run-worker mismatch refuses.
- **F14 projection (rule 19):** every prose position in all four kinds is independently seeded
  with a private-key block, `password=...`, `sk-proj-...`, and `ghp_...`; RunView, worker
  briefing, CLI/MCP, and wave responses emit only the redaction marker with
  `provenance:'untrusted-worker-authored'`, while ids/digests remain exact. Stored digests and
  replay remain unchanged by projection sanitization.
- **Continuous candidacy (rules 10, 20, 23-24):** kill/remove the worker and restart the
  coordinator before task terminality; its private entries remain active and driver-readable.
  Terminal `completed`, `failed`, and `cancelled` tasks can each have a selected entry elevated;
  a live task, wrong run, inactive source, revoked/mismatched lease, worker actor, or duplicate
  elevation refuses without append. Unselected entries survive task death and disappear only at
  run reap.
- **Promotion separation (rules 20-22):** elevation atomically appends one shared row and one
  policy-authored observed Finding whose evidence is the elevation seq and whose entry-ref
  digests match. `admitWorkflowFinding` accepts the new trigger only under its existing active
  lease and creates the same verified Finding/`DerivedFrom` shape as board/package candidates.
  A plain note with many non-evented readers never enters `knowledge.promotion_batch`; an
  observed Scratch fact still needs `minScratchReaders` evented reads and verified completed
  tasks exactly as before.
- **Settle/reap ordering (rules 21-24):** end-task elevation succeeds before workflow settle;
  selected workflow admissions occur before reap and lease revocation; unselected entries and
  raw scratchpad projections are absent afterward; elevated observed and admitted verified KG
  records remain. A zero-entry workflow still appends one idempotent bounded reap receipt.

All fixtures use fixed clocks and bounded in-memory data. No fixture writes ad-hoc Markdown or a
filesystem scratch directory.

## Part G — boundaries

- **No scratch files.** No `.md` convention, ignored directory, worktree-local scratch folder,
  `/tmp` path, hidden home-directory state, or adapter-specific note file is created or scanned.
  The proper surface is the typed coordination write plus the existing horizon projections.
- **No new database, service, graph, or subsystem.** Four replay maps/indexes and one fence are
  ordinary coordination-store projections, analogous to boards and REPL bindings. Cairn remains
  the only project KG.
- **No worker-to-worker private read and no direct worker-to-shared write.** Sharing is an
  explicit orchestrator elevation under the run lease. The driver's addressed read is not a
  blanket worker capability.
- **No evented scratchpad read.** `scratch.read` remains unchanged for causal Scratch-fact
  readership. There is no `scratchpad.read`, fake idempotency key per poll, or reuse of
  `readKnowledge`/`recallKnowledge` merely to view task memory.
- **No truth laundering.** Storage by the hub does not make worker prose trusted; task elevation
  creates an `observed` candidate, workflow admission is explicit and lease-gated, and existing
  `minScratchReaders` policy is neither weakened nor fed synthetic reads.
- **No implicit promotion or automatic “best note” selection.** Settle may choose zero entries.
  Ranking, summarization, embeddings, semantic deduplication, and auto-selection are follow-ups;
  this contract provides deterministic bounded pages and exact digests.
- **No mutable-plan protocol.** Plan entries are immutable snapshots. Editing, retracting,
  resolving doubts, link health checks, and cross-entry graph edges are outside issue #33.
- **No secure-erasure guarantee.** Reap removes active projection visibility; append-only event
  retention remains deployment policy.
- **No redesign of KG-1/KG-2.** Existing horizon and workflow-admission machinery is extended by
  a named fence component, a projection slice, and one candidate trigger. Board/package
  candidates, Scratch promotion, recall ownership, and all knowledge validators retain their
  current behavior.

## Part H — validation

The focused implementation suite, once authored, must pass:

```
node --test impl/test/scratchpad-33-red.test.mjs
```

Then the repository's full suite must pass. The deployment acceptance command for this contract
is exactly:

```
node --test impl/test/wave-driver-red.test.mjs
```

Run from the assigned worktree root with expected exit code 0. Do not claim completion from prose
review, a different test, or an inferred prior result.
