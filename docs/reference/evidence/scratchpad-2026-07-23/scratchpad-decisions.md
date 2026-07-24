# Scratchpad decisions contract — typed task-horizon writes and settle-time elevation (issue #33)

Status: implementation-grade contract, 2026-07-23.

Ground truth is issue #33 plus its reframe comment. The reframe is controlling: this is **not a
second Scratch subsystem, not a filesystem convention, and not another knowledge graph**. Baton
already projects task, workflow, and project horizons over the coordination ledger and the Cairn
KG (`Coordinator.taskHorizon`/`workflowHorizon`/`projectHorizon`,
coordinator.mjs:9634-9720), and workers already query the project KG through
`recallKnowledge` with worker↔task ownership binding (coordinator.mjs:9469-9487; the issue's
pre-landing anchor was :9039-9052). Issue #33 adds the missing typed **write** authority into the
task-ephemeral horizon. Those writes remain candidates across worker death, may be elevated by
the orchestrator at task and workflow settlement, and disappear from live horizon projections
when their workflow settles.

The line references requested in the brief predate changes already present in this tree. This
contract cites both the requested anchor where it helps identify the precedent and the current
exact site:

- the board store/fence/non-evented snapshot slice is now coordination-store.mjs:12590-12785
  (the brief's :12057-12210); its application projection is application.mjs:319-376;
- REPL binding admission/projection starts at coordination-store.mjs:12845, with the non-evented
  snapshot at :13035-13043, and the viewer slice is application.mjs:378-418 (the brief's
  coordination-store.mjs:12600+);
- `_apply` is now coordination-store.mjs:7367+ (the brief's :7158+);
- `PROJECTION_CHECKPOINT_FIELDS` is coordination-store.mjs:92-118 (the brief's :89-113);
- `snapshot()` is now coordination-store.mjs:10883 (the brief's :9937+);
- the run-stop admission guard is now coordination-store.mjs:7376-7403 (the brief's
  :7196-7218);
- legacy `readScratch` is now coordination-store.mjs:12582-12587 (the F10/requested
  :11636-11641 anchor). It still appends `scratch.read` for every read and is explicitly the
  precedent this contract does **not** copy.

The complete surface inventory is closed:

| Surface | Authorized caller | Ledger effect |
| --- | --- | --- |
| worker tool `scratchpad.write` → `Coordinator.writeScratchpad` | authenticated live worker for its bound task/Run | standalone `entry_written`, or the named link-citation batch |
| `run.scratchpad` / RunView / task-workflow horizon projection | Run-bound driver/orchestrator or rule-2 worker viewer | none; one fenced batch snapshot |
| store query `scratchpadSnapshotBatch` → application `projectScratchpadView` | internal coordinator/application path after viewer authorization | none |
| `elevateTaskScratchpad` | registered Run orchestrator, or the closed no-driver policy fallback | named task-settlement batch |
| `settleWorkflowScratchpad` | active Run-orchestrator lease | named workflow-settlement batch |
| `reapRunScratchpads` | policy after `run.stop_admitted` | bounded named stop-cleanup batches |

There is no public `readScratchpad`, worker elevation/settlement method, free-form append API, or
operator semantic action hidden outside this table. Internal store queries/mutators remain behind
the Coordinator/Application ownership checks fixed below.

## Part A — one ledger, two ephemeral partitions, one worker write authority

1. **The scratchpad is a coordination-ledger projection, not a subsystem.** Its durable source
   is three new event kinds in the existing `CoordinationStore`; its live read is a cached horizon
   projection; its persistent destination is the existing Cairn KG. There is no scratchpad
   directory, Markdown fallback, side database, second event log, query engine, or background
   file watcher. `taskHorizon` and `workflowHorizon` continue to compose board/package/binding/KG
   state (coordinator.mjs:9634-9720); they gain scratchpad projection data and the corresponding
   scratchpad fence components, not a delegation to another service.

2. **There are exactly two scope forms: `worker:<workerId>` and `shared`.** Every record is also
   bound to one `runId`; a worker-scoped record is additionally bound to one `taskId` and its
   authenticated `workerId`. Visibility copies the settled board/REPL slice rule:

   - a worker sees `worker:<self>` plus `shared`, only in its own Run;
   - an orchestrator/driver bound to the Run sees `shared` plus every worker scope in that Run;
   - no worker can read another worker scope;
   - workers write only `worker:<self>`; `shared` is read-only to workers and is populated only by
     the task-settle elevation authority in rule 19.

   This is the same authority split implemented by `projectBoardView` (orchestrator sees all; a
   worker sees its owned/own-board slice, application.mjs:341-344) and
   `projectReplBindingView` (worker sees own + shared, orchestrator sees all,
   application.mjs:394-397). It is not a convention enforced by callers: the store validates the
   hub-derived coordinates on replay.

3. **The sole worker write operation is
   `Coordinator.writeScratchpad(workerId, entry, opts)`.** It is a sibling of
   `postScratchFact`/`submitBoardReport`, not an overload of either. The wrapper:

   - resolves the live handle and task from `workerId`;
   - accepts task states `working`, `input_required`, and `paused`, matching the now-settled
     scratch/board wrappers (coordinator.mjs:9490-9527/:9586-9596);
   - requires `opts.expectedFence` to be a nonnegative safe integer and rejects a stale
     worker-turn fence before admission;
   - requires an idempotency key matching
     `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`;
   - rejects a raw `entry` whose canonical JSON encoding exceeds
     `MAX_SCRATCHPAD_WRITE_REQUEST_BYTES = 16_384` before NFKC, URL parsing, recursive shape
     validation, or digest work;
   - passes authenticated `principalId: workerId`, the hub-resolved `runId`/`taskId`, and
     `actor: 'worker'` to `CoordinationStore.writeScratchpad`;
   - rejects every caller-supplied identity, scope, ordinal, timestamp, digest, candidacy,
     provenance, or elevation field.

   `writeScratchpad` is added to the coordination mutator allowlist beside the existing Scratch
   and board mutators (coordinator.mjs:246-265) and to the injected-store completeness check
   beside `postScratchFact` (coordinator.mjs:669+). The public worker tool is a thin closed-schema
   adapter named `scratchpad.write` with exact input
   `{entry,expectedFence,idempotencyKey}`; worker/task/run identity is injected by the hub. Its
   exact success receipt is
   `{ok:true,result:'written'|'idempotent',entryId,entryDigest,scope,scratchpadFence,eventSeq}`.
   The worker-tool adapter maps expected refusals to this closed union:

   ```js
   { ok: false, result: 'stale_fence', current }
   | { ok: false, result: 'worker_not_active' | 'run_stopping' }
   | {
       ok: false,
       result:
         'scratchpad_write_invalid'
         | 'scratchpad_entry_invalid'
         | 'scratchpad_partition_exhausted'
         | 'scratchpad_write_conflict'
     }
   ```

   Invalid tool/key/fence envelope uses `scratchpad_write_invalid`; invalid typed content uses
   `scratchpad_entry_invalid`. Missing/terminal ownership collapses to `worker_not_active` rather
   than exposing task/worker existence. These receipts contain no submitted content or exception
   message. Integrity/programmer failures still throw and poison/fail the owning operation; an
   expected `CoordinationRefusal` never leaks through the public worker tool as an unstructured
   exception. It does not expose an operator semantic action and does not turn arbitrary provider
   `content.tool_call` telemetry into a write.

## Part B — closed entry grammar, bounds, and hub-authored identity

4. **All entry inputs are exact objects selected by `kind`.** Unknown, missing, inherited, or
   discriminator-inapplicable fields fail `scratchpad_entry_invalid`; arrays must be real arrays.
   The validation order is fixed: enforce rule 3's raw request-byte ceiling; require a plain
   JSON-compatible object with the exact discriminator-selected own keys and primitive types;
   NFKC-normalize and trim every string; then enforce non-empty/null-byte/field-byte and semantic
   rules. The raw ceiling uses a short-circuiting own-data-property walker: it accepts only
   `Object.prototype`/null-prototype records, arrays, strings, finite JSON numbers, booleans, and
   null; rejects accessors, symbol keys, sparse arrays, cycles, `undefined`, functions, and
   bigint without invoking user code; and stops as soon as canonical UTF-8 bytes exceed 16,384.
   No `JSON.stringify`, parser, getter, or normalizer sees an unbounded attacker-controlled
   structure.

   URL targets are parsed with `new URL(normalizedInput)`, then require protocol exactly
   `https:`, non-empty hostname, and empty `username`/`password`; the stored string is the
   resulting `URL.href`, and the 2,048-byte bound applies again to that canonical result.
   Repository paths use no `path.normalize` call that could erase forbidden input. After NFKC
   and trim, admission rejects a leading `/`, any `\` or null byte, a Windows drive prefix
   matching `^[A-Za-z]:($|/)`, and any empty, `.` or `..` slash-delimited segment; the stored path
   is the segments rejoined with `/`, then checked against its 512-byte bound.

   The normalized exact object—not the caller's pre-normalization spelling—is the admitted
   `content`. One deployment constant,
   `MAX_SCRATCHPAD_ENTRY_BYTES = 8_192`, caps that canonical serialized content after all field
   checks. The caller never supplies a generic `body`,
   arbitrary metadata map, tags array, attachment, executable fragment, or extension bag. The
   four accepted shapes are only rules 5-7.

5. **`note` and `plan` have these exact shapes:**

   ```js
   { kind: 'note', text }

   {
     kind: 'plan',
     objective,
     steps: [{ text, state }],
     supersedes: null | {
       entryId: 'scratchpad-entry:<64 lowercase hex>',
       entryDigest: '<64 lowercase hex>'
     }
   }
   ```

   `note.text` is at most 2,048 UTF-8 bytes. `plan.objective` is at most 512 bytes.
   `plan.steps` has 1..16 exact `{text,state}` objects; each `text` is at most 512 bytes and
   `state` is exactly `todo | doing | done`. `supersedes`, when non-null, is an exact two-field
   object whose ID/digest match rule 7's grammars and resolve to that precise still-known `plan`
   entry in the same `(runId, worker scope)`; it is a citation, not an in-place edit. Entries are
   immutable, so a plan revision is a new hub-identified, content-committed entry. If that plan
   is elevated, `supersedes` remains the exact original `(entryId,entryDigest)` commitment:
   elevation does not elevate, copy, or retarget the older plan. After worker-partition reap the
   pair is historical audit provenance, not a dereferenceable shared entry, and projections
   expose no hidden target liveness/content.

6. **`doubt` has this exact shape:**

   ```js
   { kind: 'doubt', question, context: null | string }
   ```

   `question` is at most 1,024 UTF-8 bytes and `context` is null or at most 2,048 bytes. A doubt
   is not an approval/question interaction and does not park a task. It is worker-authored
   epistemic state and therefore remains untrusted candidate prose. Resolution is represented by
   a later `note` or `link`; the original doubt is never mutated into a fact.

7. **`link` has this exact discriminated shape:**

   ```js
   {
     kind: 'link',
     label,
     relation: 'reference' | 'supports' | 'contradicts' | 'depends_on',
     target:
       { type: 'url', url }
       | { type: 'repo_path', path }
       | { type: 'entry', entryId, entryDigest }
   }
   ```

   `label` is at most 256 UTF-8 bytes. A URL is an absolute `https:` URL with no user-info and at
   most 2,048 bytes. A repository path is the canonical relative path produced by rule 4 and is
   at most 512 bytes. An entry target ID and digest must
   match `^scratchpad-entry:[0-9a-f]{64}$` and `^[0-9a-f]{64}$`, respectively, and resolve as
   that exact content-addressed version within the same Run, in either the writer's own scope or
   `shared`; a worker cannot use a link to probe another worker's scope. The nested target object
   is exact for its discriminator. A durable
   `link` to an entry is an explicit citation used by the elevation qualification in rule 21;
   merely polling a projection is not a citation. Elevating a link never recursively elevates or
   rewrites its target. A private target that is later reaped remains an opaque historical
   `(entryId,entryDigest)` commitment; it grants no read of the target event/content and reports
   no target-liveness bit that could reveal a sibling/private partition.

8. **Admission and projection ceilings are independent and loud.** The store admits at most
   `MAX_SCRATCHPAD_WORKER_ENTRIES = 128` live entries per
   `(runId, taskId, worker:<workerId>)` and `MAX_SCRATCHPAD_SHARED_ENTRIES = 512` live entries per
   `(runId, shared)`; a fresh entry/elevation over the ceiling fails
   `scratchpad_partition_exhausted`. A projected viewer slice is capped by
   `MAX_SCRATCHPAD_VIEW_ITEMS = 64` and `MAX_SCRATCHPAD_VIEW_BYTES = 32_768`. It sheds trailing
   canonical-order entries until under the byte ceiling and sets
   `scratchpadViewTruncated: true`; it never silently drops rows. A truncated page also returns
   `nextBefore:{createdEvent,entryId}` for the last included row. The next pure read must echo
   both that keyset position and the exact prior `fenceTuple`; a changed tuple fails
   `scratchpad_cursor_stale` rather than mixing pages across writes. There are no numeric offsets,
   global ledger cursors, or hidden unbounded result. The containing RunView remains
   subject to the current `MAX_RUN_VIEW_BYTES = 512 * 1024`
   (application.mjs:44), so scratchpad projection cannot expand the existing northbound envelope
   ceiling. At the maximum 64-member wave roster, the scratchpad contribution to one
   `wave.progress()` result is at most 2 MiB. After building the exact return object but before
   retaining or returning it, `wave.progress()` enforces
   `MAX_WAVE_PROGRESS_BYTES = 7 * 1024 * 1024` with a short-circuiting canonical UTF-8 JSON byte
   counter that stops at limit+1. An oversized aggregate fails `wave_progress_oversize` with no
   partial result and no echoed member/worker prose; it is never handed to stream serialization
   near the 8 MiB single-frame kill boundary. The driver may then use the per-member
   `run.scratchpad` read rather than requesting the aggregate.

9. **The hub mints identity and recomputes every digest.** After validating the worker binding
   and exact input, the store assigns the next replay-derived ordinal in that worker partition
   and computes:

   ```js
   entryId = `scratchpad-entry:${canonicalDigest({
     runId, taskId, workerId, scope: `worker:${workerId}`, ordinal, mintSeq
   })}`

   contentDigest = canonicalDigest(normalizedContent)

   entryDigest = canonicalDigest({
     schemaVersion: 1, entryId, runId, taskId, workerId,
     scope: `worker:${workerId}`, ordinal, kind, contentDigest, content: normalizedContent
   })
   ```

   `mintSeq` is the prospective coordination sequence and `createdAt` is the event timestamp.
   Neither is accepted from the worker. The payload carries both digests and the full bounded
   content; `_apply` recomputes the identity/digests during live apply and replay. An idempotency
   key replay returns the prior event only when the actor, worker/task/run binding, and
   `contentDigest` match; otherwise it fails `scratchpad_write_conflict`. This mirrors board
   identity/digest ownership (coordination-store.mjs:12628-12635) and REPL binding hub digest
   recomputation (coordination-store.mjs:12940-12946).

   A shared successor is independently hub-addressed:

   ```js
   sharedEntryId = `scratchpad-entry:${canonicalDigest({
     runId, scope: 'shared', sourceEntryId, sourceEntryDigest, elevationSeq
   })}`

   sharedEntryDigest = canonicalDigest({
     schemaVersion: 1, entryId: sharedEntryId, runId, scope: 'shared',
     sourceEntryId, sourceEntryDigest, sourceEvent, kind, contentDigest, content
   })
   ```

   It preserves the source `contentDigest` byte-for-byte; elevation cannot rewrite content. The
   digest computation uses content resolved from the exact source event/live row, but the
   elevation event does not duplicate that raw content in its own payload.

## Part C — event kinds and the complete replay fold

10. **There are exactly three scratchpad event kinds.**

    - `scratchpad.entry_written` records one worker-scope entry from rule 9.
    - `scratchpad.entry_elevated` records an orchestrator-selected immutable successor in
      `scope:'shared'`, with hub-authored `entryId`/`entryDigest`, and exact
      `{sourceEntryId,sourceEntryDigest,sourceEvent}` provenance. It copies the source kind and
      content into the live shared projection by resolving that source; it never accepts or
      repeats prose in the elevation request/event.
    - `scratchpad.partition_reaped` records the settle-time removal of one exact partition
      projection. Its payload binds
      `{runId,scope,taskId|null,observedFence,dispositions,dispositionDigest,basis}`.
      `dispositions` is a canonical array of exact
      `{entryId,entryDigest,result,targetId,reasonCode}` rows; `result` is exactly
      `elevated`, `not_elevated`, `admitted`, `not_admitted`, `not_eligible`, or `stopped`, and
      `targetId` is the shared successor for `elevated`, the verified Finding for `admitted`, and
      null otherwise. `reasonCode` is exactly `selected`, `orchestrator_skipped`, `no_driver`,
      `min_readers`, `type_ineligible`, `contradiction_present`, or `run_stopped`; it contains no prose.
      `dispositionDigest = canonicalDigest(dispositions)`. `basis` is
      `task_settled`, `workflow_settled`, or `run_stopped`. It contains no free-form reason.

    The event envelope remains the ledger's existing exact
    `{schemaVersion:1,seq,ts,kind,actor,idempotencyKey,payload,batch?}` shape. `batch` is absent on
    a standalone worker write and required on every transactional group defined below;
    scratchpad payloads are closed as well:

    ```js
    // scratchpad.entry_written
    {
      schemaVersion: 1, runId, taskId, workerId, scope, ordinal,
      entryId, entryDigest, contentDigest, kind, content
    }

    // scratchpad.entry_elevated
    {
      schemaVersion: 1, runId, scope: 'shared',
      sourceEntryId, sourceEntryDigest, sourceEvent,
      entryId, entryDigest, contentDigest, kind,
      scratchFactId // hub-derived fact ID for note; null for plan/doubt/link
    }

    // scratchpad.partition_reaped
    {
      schemaVersion: 1, runId, scope, taskId,
      observedFence, dispositions, dispositionDigest, basis
    }
    ```

    Event `seq`/`ts` are the sole source of a projected row's `createdEvent`/`createdAt`;
    candidacy, liveness, sanitization, and viewer fields are fold/projection derivations and are
    never accepted in a payload. `taskId` is non-null for a worker-partition reap and exactly
    null for a shared-partition reap. For note elevation, `scratchFactId` is precomputed from the
    exact following `scratch.fact_posted` payload; for all other kinds it must be null. Unknown
    payload fields—including a caller/event-supplied `content` field on elevation—fail replay
    integrity rather than being ignored. Applying elevation requires its source worker row to be
    live at `sourceEvent`, recomputes `contentDigest` and `entryDigest` from that row, and only
    then copies the source content into the live shared projection.

    There is deliberately no `scratchpad.read`, edit, delete, candidate, worker-died, or
    arbitrary promotion event. Candidate status is an inherent durable property of every live
    entry, elevation uses the second event, and lifecycle removal uses the third.

    Transactional operations must use `_appendBatch(entries,batchKind)`—never its current null
    batch-kind mode—with these four additions to the allowlist at
    coordination-store.mjs:1196-1203:

    - `scratchpad_task_settlement`:
      canonical `[entry_elevated,(scratch.fact_posted iff note)]*`, then exactly one
      `partition_reaped {basis:'task_settled'}`; zero selected entries means the one-member reap
      batch;
    - `scratchpad_link_citation`: exactly
      `[scratchpad.entry_written,scratch.read(readerActor:'scratchpad.link')]`;
    - `scratchpad_workflow_settlement`: exactly
      `[partition_reaped {basis:'workflow_settled'},scratch.fact_expired*]`;
    - `scratchpad_stop_cleanup`: exactly
      `[partition_reaped {basis:'run_stopped'},scratch.fact_expired*]`, with expiries present only
      for shared scope.

    Within each group, selected entries/facts or expired facts follow the canonical orders in
    rules 19/23. Every member carries the existing exact
    `batch:{schemaVersion:1,kind,id,index,count}` metadata
    (coordination-store.mjs:1223-1238), where `index` is contiguous from zero, `count` is equal on
    all members, and `id` recomputes as:

    ```js
    canonicalDigest({
      schemaVersion: 1,
      kind: batchKind,
      entries: members.map(({ kind, actor, idempotencyKey, payload }) => ({
        kind, actor, idempotencyKey, payload
      }))
    })
    ```

    `MAX_SCRATCHPAD_BATCH_BYTES = 2 * 1024 * 1024` caps the complete newline-delimited event
    buffer before file append; exceeding it fails `scratchpad_batch_oversize` with no write or
    projection change. The entry/partition ceilings make valid maximum groups fit this cap, and
    the focused tests pin that arithmetic.

    The companion `scratch.fact_posted`, `scratch.read`, and `scratch.fact_expired` events are
    existing kinds, not new scratchpad kinds, and a scratchpad poll never emits any of them.

    Idempotency keys are deterministic at every hub-authored step:

    - elevation: `scratchpad.entry_elevated:${sourceEntryId}:${sourceEntryDigest}`;
    - its bridge fact: `${elevationKey}:fact`;
    - explicit-link citation read: `${workerWriteKey}:citation`;
    - task reap: `scratchpad.partition_reaped:${runId}:${taskId}:${observedFence}`;
    - shared reap: `scratchpad.partition_reaped:${runId}:shared:${observedFence}`;
    - each bridge expiry: `${sharedReapKey}:fact:${scratchFactId}`.

    A prior key must match kind, actor, and the full request/source/fence digest to be idempotent;
    otherwise it fails the operation-specific conflict code. A scope that never had an entry
    returns `{event:null,noOp:true}` and appends nothing; no empty-partition tombstone is minted
    merely because an ordinary task settled.
    Every mutator checks a prior idempotency key and validates that prior event's complete binding
    **before** checking current liveness or fence state. Consequently, an exact reap retry after
    the first reap returns the original receipt even though that reap advanced the fence and made
    the partition non-live; a same-key retry with any different entry set, disposition, basis, or
    observed fence is a conflict, not a no-op.

    Reap authority is a closed basis/actor matrix, enforced in the store:
    `task_settled` accepts hardcoded `orchestrator` after a registered-driver decision or
    hardcoded `policy` only on rule 20's no-driver path; `workflow_settled` accepts hardcoded
    `orchestrator` with the active Run lease; `run_stopped` accepts hardcoded `policy` only after
    `run.stop_admitted`. The result vocabulary is also basis-closed:
    task=`elevated|not_elevated`, workflow=`admitted|not_admitted|not_eligible`,
    stop=`stopped`. Result/reason pairs are closed: elevated/admitted=`selected`;
    not_elevated=`orchestrator_skipped|no_driver`;
    not_admitted=`orchestrator_skipped|contradiction_present`;
    not_eligible=`min_readers|type_ineligible`; stopped=`run_stopped`. No reap method accepts
    `opts.actor`.

11. **All three kinds ship their full fold surface in the same commit.** The implementation adds
    `_scratchpadEntries`, `_scratchpadEntriesByScope`, `_scratchpadFences`,
    `_scratchpadElevations`, and `_scratchpadReaps` in the constructor/checkpoint state. It then:

    - adds every field to `PROJECTION_CHECKPOINT_FIELDS`
      (coordination-store.mjs:92-118; requested anchor :89-113);
    - validates and folds every kind in `_apply` (coordination-store.mjs:7367+; requested
      anchor :7158+), with no mutable update outside `_apply`;
    - exposes a bounded, clone/freeze-safe `scratchpad` section from `snapshot()`
      (coordination-store.mjs:10883; requested anchor :9937+) containing current entries,
      live elevation bindings, bounded minimal reap receipts, and fence rows, including an empty
      section on a fresh store;
    - restores the same maps and counters from a projection checkpoint and reconstructs them
      byte-identically from a full replay;
    - includes the three kinds in the event-kind inventory test so an event cannot land without
      its validator, fold branch, checkpoint field set, snapshot exposure, and run-stop
      classification.

    The same commit extends the batch-kind inventory and adds a scratchpad transaction preflight.
    For a live append it validates the complete prospective group before the one buffered file
    append (the existing write-before-apply order is coordination-store.mjs:1239-1250). For full
    replay or a checkpoint tail it parses and validates an entire named group before `_apply`
    sees member zero: kind pattern, contiguity, indices/count, recomputed batch ID, actor/key
    bindings, payload digests, and the final reap/expiry closure must all match rule 10. A missing,
    duplicated, reordered, cross-kind, truncated, or trailing partial group fails
    `scratchpad_batch_integrity` and exposes no prefix projection. A scratchpad transactional
    event with absent/wrong batch metadata, or a standalone write carrying batch metadata, fails
    the same way. Projection checkpoints are emitted only after a complete group, never at a
    member boundary.

    `scratchpad.entry_written` inserts one immutable live entry and indexes it by the JSON tuple
    `(runId, scope)`; `entry_elevated` verifies the prior source, inserts the shared successor,
    and retains a content-free source/successor digest binding while that successor is live.
    `partition_reaped` verifies its exact fence and entry set and removes those exact-scope rows
    from the live maps/indexes; a shared reap also removes their elevation bindings, while a
    worker reap leaves bindings for still-live shared successors intact. It retains only the
    prose-free receipt binding
    `{eventSeq,runId,scope,taskId,basis,observedFence,dispositionDigest}` plus the disposition
    rows already bounded by the partition ceiling. Reaped content is not copied into checkpoint
    state or `snapshot().scratchpad`; the immutable ledger events remain the historical replay
    source. `_scratchpadReaps` exposes only the newest
    `MAX_SCRATCHPAD_SNAPSHOT_REAPS = 256` whole receipts in `(eventSeq DESC)` order and stops
    earlier at `MAX_SCRATCHPAD_SNAPSHOT_REAP_BYTES = 262_144`, setting
    `scratchpadReapsTruncated:true`; a receipt is never split. Full replay applies the same
    deterministic caps, so live replay and checkpoint restore remain byte-identical.
    Idempotency uses the ledger's existing key index, not discarded live rows. No fold scans the
    whole ledger.

12. **`scratchpadFence(runId, scope)` is replay-derived and advances on every projection-changing
    event for that exact scope.** A worker write increments only its worker-scope fence; an
    elevation increments only `shared`; a reap increments only the reaped scope. The key is a
    structured JSON tuple, never string concatenation. Like REPL bindings, every write counts
    (coordination-store.mjs:7957-7960), because every scratchpad write changes a reader-visible
    projection; there is no board-style worker-write carve-out. The fence is checkpointed, is
    reconstructed by `_apply`, and is never the worker `FenceTable` turn fence. The latter gates
    stale worker authority at write admission; the former invalidates cached reads.

    The horizon union is explicit: `taskHorizon` appends the requesting worker-scope and shared
    scratchpad fences to its existing tuple. An orchestrator `workflowHorizon` appends shared
    plus every Run-owned worker scope in canonical worker-ID order; a worker-view
    `workflowHorizon` appends only that worker's own scope plus shared and reveals neither sibling
    fence values nor sibling count. Any scratchpad rows included in a horizon therefore have a
    corresponding tuple component—no stale cache hit hidden behind `projectionInputFence()`.
    That global fence remains responsible for its existing KG/package/board inputs; scratchpad
    uses its own scoped fences rather than broadening the global counter.

13. **Run-stop classification is explicit.** In the pre-fold run-stop guard
    (coordination-store.mjs:7376-7403; requested anchor :7196-7218),
    `scratchpad.entry_written` derives `admittedRunId` from its hub-bound payload and
    `scratchpad.entry_elevated` derives it from both payload and source; either event after
    `run.stop_admitted` fails `run_stopping`. `scratchpad.partition_reaped` is cleanup, like
    resource release, and remains legal after stop; its validator requires `basis:'run_stopped'`
    when the Run is stopping/stopped. A stop can therefore prevent new assertions while still
    converging to zero live scratchpad residue.

## Part D — non-evented fenced reads and the driver-facing projection

14. **Never copy legacy `readScratch`.** `CoordinationStore.readScratch` calls
    `checkScratch` and appends `scratch.read` on every poll
    (coordination-store.mjs:12571-12587; the requested/F10 anchor is :11636-11641). That history
    is required by the legacy Scratch-fact reader qualification, but it is the wrong cost model
    for a steering surface that a wave driver may poll continuously. There is no
    `scratchpad.read` kind. The primitive is the pure indexed
    `scratchpadSnapshotBatch(runId,scopes,{expectedFenceTuple?})`, where `scopes` is a non-empty,
    duplicate-free canonical array already authorized by the coordinator. It synchronously
    captures:

    ```js
    {
      runId,
      observedSeq,
      fenceTuple: [[scope, scratchpadFence], ...],
      slices: [{ scope, entries }]
    }
    ```

    from `_scratchpadEntriesByScope` without an `await`, callback, or caller hook between scope
    reads. `observedSeq` is the ledger `lastSeq` for the whole capture, and every tuple/entry row
    is cloned/frozen from that same state. If supplied, `expectedFenceTuple` must match exactly
    before any entry slice is returned or it fails `scratchpad_cursor_stale`.
    `scratchpadSnapshot(runId,scope)` is only a single-scope convenience that delegates to this
    primitive; application/horizon code never loops over separate single-scope calls to assemble
    one view. Before/after event count, snapshot `lastSeq`, and every scope fence are
    byte-identical across either read.

15. **`projectScratchpadView` is cached by the exact viewer slice and fence tuple.** The store
    batch snapshot returns one coherent capture from rule 14. The application layer requests
    only scopes authorized by rule 2, sorts entries newest-first by
    `(createdEvent DESC,entryId ASC)`, and caches by:

    ```text
    (runId, viewerRole, viewerWorkerId|null,
     requestedWorkerId|null,
     beforeCreatedEvent|null, beforeEntryId|null,
     [scope, scratchpadFence] in canonical scope order)
    ```

    An unchanged tuple returns the same frozen object identity; a write/elevation/reap advances
    exactly one component and forces one recomputation. An orchestrator may request one member
    slice without projecting every worker; a worker request is hard-bound to self and shared.
    Cache-miss computation is indexed and subject to the item/byte ceilings in rule 8. Truncation
    therefore sheds the oldest rows first and always preserves the most recent steering state.
    A continuation applies the strict keyset predicate after `(createdEvent DESC,entryId ASC)`;
    for cursor `(c,e)` it keeps exactly
    `entry.createdEvent < c || (entry.createdEvent === c && entry.entryId > e)`. It neither
    repeats nor skips a row while the echoed fence tuple is current. Authorization and
    scope filtering happen before page construction/count/truncation, so a cursor cannot reveal a
    hidden sibling scope's cardinality.
    Cache storage is an optimization with an explicit bound, not a historical view archive.
    `MAX_SCRATCHPAD_VIEW_CACHE_KEYS = 256` caps one application instance's strict-LRU cache.
    Before inserting a recomputed first page, the application deletes every older-fence key for
    the same authorization slice
    `(runId,viewerRole,viewerWorkerId,requestedWorkerId)`; continuation pages may coexist only
    for the current exact fence tuple. LRU eviction changes object identity on a later miss but
    never authorization, content, ordering, or fences. Workflow settle, Run close, and Run stop
    delete all keys for that Run, and cache state is neither checkpointed nor serialized. At the
    view byte ceiling this bounds retained serialized values to 8 MiB plus Map/object overhead.
    The correctness rule is the
    board cache rule (`(board,workerId,boardFence)`, application.mjs:319-375) and REPL binding
    cache rule (`(runId,scope,workerId,bindingFence)`, application.mjs:378-418) applied to the new
    task-horizon write source; bounded replacement is scratchpad-specific because workers may
    write and drivers may poll throughout a workflow.

16. **The orchestrator-readable Run projection is the feature, not incidental diagnostics.**
    A single-task RunView gains:

    ```js
    scratchpad: {
      runId,
      workerId,
      scopes: ['worker:<workerId>', 'shared'],
      fenceTuple: [[scope, fence], ...],
      entries: [ScratchpadProjectionEntry, ...],
      scratchpadViewTruncated,
      nextBefore: null | { createdEvent, entryId }
    }
    ```

    `ScratchpadProjectionEntry` is a closed discriminated object, not stored content passed
    through:

    ```js
    {
      schemaVersion: 1,
      entryId, entryDigest, contentDigest,
      runId, scope,
      authorWorkerId, authorTaskId,
      ordinal, // positive integer for worker entry; null for shared successor
      kind, createdEvent, createdAt,
      candidateState: 'candidate',
      source: null | {
        entryId, entryDigest, eventSeq // non-null only for shared successor
      },
      content:
        { kind: 'note', text: Prose }
        | {
            kind: 'plan', objective: Prose,
            steps: [{ text: Prose, state: 'todo' | 'doing' | 'done' }],
            supersedes: null | { entryId: EntryId, entryDigest: Digest }
          }
        | { kind: 'doubt', question: Prose, context: null | Prose }
        | {
            kind: 'link', label: Prose,
            relation: 'reference' | 'supports' | 'contradicts' | 'depends_on',
            target:
              { type: 'url', url: Prose }
              | { type: 'repo_path', path: Prose }
              | { type: 'entry', entryId: EntryId, entryDigest: Digest }
          }
    }

    Prose = {
      worker: authorWorkerId,
      text: boundedSanitizedText,
      provenance: 'model-authored',
      untrusted: true
    }
    ```

    `authorWorkerId`/`authorTaskId` are the authenticated source coordinates for both private and
    shared entries; elevation never changes authorship. `source` is hub-derived from the
    elevation event, and a worker entry must have `source:null`. No stored raw string,
    `scratchFactId`, internal eligibility count, hidden sibling cardinality, or unrecognized
    field appears in this driver-facing object. Projection validates the stored discriminant and
    exact content shape before wrapping; malformed replay state fails integrity rather than
    falling back to a generic body.

    Horizon integration reuses this exact object—there is no second raw/internal horizon shape.
    `Coordinator.taskHorizon` supplies the requesting worker's bounded own+shared view.
    `Coordinator.workflowHorizon` supplies one globally bounded rule-2 viewer slice:
    orchestrator callers receive shared plus all Run-owned worker scopes in the rule-12 canonical
    order, while worker callers receive only own+shared. Either may truncate at the same
    64-item/32,768-byte ceiling; a driver needing a particular member uses
    `run.scratchpad({workerId})`. `projectHorizon` receives no raw scratchpad field: only Findings
    that clear rules 21-22 enter the existing project KG. Both task/workflow horizon reads use one
    rule-14 batch capture, and both remain pure/non-evented.

    The application resolves `workerId` from the Run's task/handle ownership, never from an
    unbound northbound parameter. The three RunView builders are explicit integration sites:
    `_buildView` (application.mjs:6674+) supplies the single-task projection;
    `_historicalProfileView` (:4999+) supplies it when ownership remains resolvable and otherwise
    returns null; `_buildWorkflowView` (:6300+) returns `scratchpad:null` at top level (there is no
    single member) plus bounded `attempts[].scratchpadRef` values containing only
    `{workerId,taskId,fenceTuple}`.

    The existing Run facade gains `run.scratchpad({workerId?})`, a pure read of the same
    projection, with exact input
    `{workerId?,before?,expectedFenceTuple?}`. `workerId` is optional only for a single-task Run
    and required/bound to an attempt for a workflow Run; `before` requires
    `expectedFenceTuple`. A native workflow driver uses this explicit member read.
    Invalid shapes fail `scratchpad_read_invalid`; a stale/mismatched tuple fails
    `scratchpad_cursor_stale`; unknown, cross-Run, or unauthorized member IDs all fail the same
    `scratchpad_not_available` refusal without reporting whether that worker or partition exists.
    None of these reads/refusals appends an event or echoes worker prose.
    `wave.progress()` (wave.mjs:163-181), whose roster members are individual single-task Runs,
    copies the scratchpad already present in each member's one status view into that member row;
    it does not issue a second racy read and never concatenates native-workflow attempt pads
    inside one RunView. Therefore a wave driver can observe a member's notes/plans/doubts/links
    and choose steering without filesystem access or privileged access to the worker's worktree.
    The scratchpad exists only in that bounded return object: the retained
    `state.progress` row remains the existing `{at,members:[{role,phase}]}` summary
    (wave.mjs:180-181), so `wave.evidence()` (:330-338) never accumulates or republishes scratchpad
    prose across polls. The rule-8 aggregate ceiling is checked before that summary is pushed; on
    `wave_progress_oversize`, no history row is added and the driver can read one member through
    `wave.runs.get(role).scratchpad(...)` (the existing Runs getter is :342-345).
    This is required acceptance behavior: an implementation that stores entries but leaves
    `wave.progress().members[i].scratchpad` absent has not implemented issue #33.

    This is an additive RunView field: `schemaVersion` remains `1`, the ordinary
    application/MCP status command needs no new verb or transport schema, and an owned
    single-task live Run always returns a scratchpad object (possibly `entries:[]`) rather than
    omitting it. Multi-attempt workflow and historical Runs with no uniquely resolvable worker
    return `scratchpad:null` and use the explicit member read. The field participates in
    `semanticViewDigest` (application.mjs:181-187): if scratchpad state changes between a driver
    observing an offered steering action and executing it, the old action is stale and the driver
    must refresh rather than act on superseded notes.

17. **Every worker-authored string is sanitized and provenance-marked at projection time.**
    `note.text`, `plan.objective`, every plan step text, `doubt.question/context`, and
    `link.label` plus URL/repository-path text route through the exact
    `boundedAttentionText`/`SECRET_SHAPED_TEXT` discipline
    (application.mjs:226-240; the brief's pre-drift anchor is :196-221). Each becomes
    `wrapProse(workerId, sanitizedText)`, i.e.
    `{worker,text,provenance:'model-authored',untrusted:true}`
    (messages.mjs:375-377). This is the F14 rule already used by board projections
    (application.mjs:319-325/:350-359) and context packages
    (application.mjs:242-261).

    Hub-authored IDs, ordinals, fences, event references, and digests remain plain facts. Closed
    worker-selected non-prose enums (`kind`, `relation`, plan-step `state`) remain plain enum
    values for machine use but confer no truth/authority. A plan `supersedes` or
    `target.type:'entry'` ID/digest pair stays plain only after exact hub resolution; a
    worker-submitted URL/path never receives hub-styled weight.
    Every admitted scratchpad string has a field ceiling at or below 2,048 bytes, so valid state
    never reaches `boundedAttentionText`'s 4,096-byte truncation branch; boundary multibyte text
    projects intact unless secret-shaped, and larger input is rejected before append. Redaction
    changes only the outward prose projection; `entryDigest` continues to bind the bounded
    admitted bytes and is exposed separately so a viewer never mistakes sanitized display text
    for the digest basis.

    Raw bounded strings exist only where the existing event-sourced design requires them:
    the original `entry_written` ledger payload and live internal maps/checkpoint/diagnostic store
    snapshot described in rules 11 and 23. `entry_elevated` is commitment-only and derives its
    shared live content from that source. The store snapshot is not a northbound, worker, driver,
    MCP, or horizon response; every such route must go through `projectScratchpadView`. Reap
    removes raw content from live/checkpoint/snapshot state under rule 11, while the immutable
    source-event retention boundary remains explicit in Part G.

    Elevation and promotion never create a second immutable or northbound raw-prose sink; the
    shared live/checkpoint row is the same ephemeral candidacy continuing across task reap. The
    reserved `scratch.fact_posted.value` contains only entry IDs/digests, kind, and tree-binding enum;
    the marked `scratch.read` adds only authenticated IDs/enums/envRef and that metadata fact;
    reap/settlement/error receipts contain no content. The unchanged knowledge derivation emits
    fixed bodies (`Observed Scratch fact metadata` / `Cited observed Scratch fact`,
    coordination-store.mjs:13185-13190), digest/evidence coordinates, and reader task IDs—not
    note text. The KG-2 admitted Finding likewise derives from that candidate and never copies
    scratchpad content into a project node body. A raw secret-shaped test string may remain in
    the immutable source event per Part G, but it must appear nowhere else except as the outward
    redaction marker.

## Part E — continuous candidacy, two settle points, and existing promotion gates

18. **Candidacy is continuous and ledger-backed.** Every live worker entry created by
    `entry_written` and every live shared successor created by `entry_elevated` has derived
    `candidateState:'candidate'`; that value is not worker input and needs no separate event.
    Worker-scope candidacy is for task-settle selection, while shared candidacy is for workflow
    qualification/admission subject to the kind-specific rules below. Worker transport death,
    provider crash, handle reap, session interruption, and a worker going idle do not remove or
    demote either form. The projection is reconstructed from the coordination ledger/checkpoint,
    not `_workers`, so the candidate remains readable by its Run's driver after worker death and,
    once elevated, after its source worker partition is reaped. Only the task-settle,
    workflow-settle, or run-stop authorities in rules 19-23 can end its live candidacy.

19. **End-of-task settlement elevates selected worker entries to `shared` before reaping the
    worker partition.** The terminal path already commits the terminal task/artifact batch,
    settles budget, expires claims, and records the verified outcome
    (coordinator.mjs:10878-10895). Immediately after the verified outcome is durable and before
    worker cleanup, the orchestrator calls
    `elevateTaskScratchpad(taskId, {expectedScratchpadFence,entryIds})`. The coordinator accepts
    no caller-supplied actor, hardcodes `actor:'orchestrator'`, and requires the Run's durable
    `driver.recorded {kind:'steering.registered',runId}` binding (the same binding used by the
    pause path at coordinator.mjs:1932-1933).
    The store requires:

    - the task is terminal and belongs to the supplied Run;
    - the cited steering registration predates settlement and belongs to that Run;
    - `expectedScratchpadFence` is a nonnegative safe integer and exactly matches
      `worker:<workerId>`;
    - 0..128 unique IDs, all current candidate entries in that exact task/worker partition;
    - no prior shared successor for the same source digest except the one proved by an exact
      idempotent retry of the already-completed settlement batch.

    The coordinator sorts selected sources by `entryId`, precomputes the complete decision, and
    commits exactly one `_appendBatch(entries,'scratchpad_task_settlement')`: for each selected
    source, one
    `scratchpad.entry_elevated` successor with immutable source provenance, immediately followed
    by an existing `scratch.fact_posted` only when that source is a `note`; after all selected
    sources, the batch ends with the one worker-partition reap from rule 20. An empty selection
    therefore appends only the reap. The fact is prepared exactly as the existing
    `postScratchFact` admission does
    (coordination-store.mjs:12498-12507), with hub-derived:

    ```js
    {
      grounding: 'observed',
      namespace: 'scratchpad',
      key: `scratchpad:${sharedEntryId}`,
      resource: `scratchpad:${sharedEntryId}`,
      envRef: { repoId, treeSha: settleTreeSha },
      ownerWorker: source.workerId,
      ownerTask: source.taskId,
      runId,
      value: {
        entryId: sharedEntryId, entryDigest: sharedEntryDigest, kind: source.kind,
        treeBinding: terminalCaptureSha ? 'terminal_capture' : 'task_base'
      }
    }
    ```

    `settleTreeSha` is the already-hub-captured terminal tree when available, otherwise the
    task's immutable admitted `worktreeBaseSha`; `treeBinding` states which basis was used.
    This makes failed/crashed-task settlement honest without accepting a worker-supplied tree.
    The `scratchpad` namespace and `scratchpad:` key/resource prefix are reserved to this internal
    bridge: ordinary `postScratchFact`, `claimScratch`, and `readScratch` reject caller-supplied
    use with `reserved_scratch_namespace`; only the internal elevation/link paths may write or
    check/read it. This prevents another fact/claim from aliasing the resource or a bare
    legacy read from manufacturing an explicit-link receipt.
    The resulting hub-derived fact ID is stored on the shared projection as `scratchFactId` but
    is not part of the shared entry's content digest, avoiding a circular digest basis.
    `plan`, `doubt`, and `link` may be shared for workflow steering but get
    `scratchFactId:null`: a plan is operational state, a doubt is epistemic uncertainty, and a
    link is a pointer/evidence relation—none is itself a Finding. A later qualified `note` may
    summarize a plan, resolve a doubt, or state what a link establishes. Selection is orchestrator
    judgment; the worker cannot self-promote and an empty selection is legal. The selected set is
    exact, not transitively closed: the hub never auto-adds an older plan named by `supersedes` or
    an entry-link target. A selected plan/link whose referenced private entry is unselected still
    elevates as the opaque commitment defined by rules 5/7; this creates no shared successor,
    bridge fact, read receipt, or target-liveness signal for the referenced entry.
    Every prospective elevation, optional fact, final reap payload, and idempotency key is
    completely prevalidated before the single `_appendBatch`. Validation or append failure is
    loud and leaves both the worker partition and shared partition byte-identical for retry.
    There is no per-entry commit loop, no partially elevated selection, and no finally-block reap
    that destroys candidates after a failed admit.

20. **Task reaping is the final event of the same atomic elevation-decision batch.** Its
    `scratchpad.partition_reaped` payload binds the exact worker fence and complete live entry
    set. Elevations change only the shared fence, so this observed worker fence is the same value
    checked at operation admission. Its disposition rows bind, for every source entry,
    `result:'elevated',reasonCode:'selected'` plus the shared successor ID or
    `result:'not_elevated',reasonCode:'orchestrator_skipped'` plus null; the digest binds the
    visible rows. A replay cannot invent a different selection. The live task horizon then
    loses that worker partition, while selected shared successors remain in the workflow horizon.
    Worker death by itself never invokes this event; a failed/cancelled task still passes through
    the same orchestrator settle decision before cleanup.

    `elevateTaskScratchpad` returns the exact prose-free receipt:

    ```js
    {
      ok: true,
      result: 'settled' | 'idempotent' | 'empty',
      runId, taskId, workerId, scope,
      observedFence, scratchpadFence, reapEventSeq,
      dispositionDigest,
      elevated: [{
        sourceEntryId, sharedEntryId, sharedEntryDigest, scratchFactId
      }]
    }
    ```

    `scope` is the hub-derived worker scope; `elevated` is canonical by source entry ID.
    `result:'empty'` is the rule-10 no-event case and has
    `reapEventSeq:null`, `dispositionDigest:null`, and `elevated:[]`. On retry, the coordinator
    checks the deterministic reap key first, verifies that its prior disposition digest and
    source→successor bindings equal the newly recomputed complete decision, and returns
    `idempotent`; a changed selection under the same worker fence conflicts. Because the original
    batch was atomic, a preexisting successor without its matching reap is ledger corruption,
    not a partial state that the retry silently adopts.

    Expected task-settlement refusals use this exact no-prose union:

    ```js
    { ok: false, result: 'stale_scratchpad_fence', scratchpadFence }
    | {
        ok: false,
        result:
          'scratchpad_settlement_not_authorized'
          | 'scratchpad_settlement_not_ready'
          | 'scratchpad_settlement_invalid'
          | 'scratchpad_settlement_conflict'
          | 'scratchpad_partition_exhausted'
          | 'scratchpad_batch_oversize'
          | 'run_stopping'
      }
    ```

    Missing/cross-Run steering authority is `not_authorized`; nonterminal task or non-durable
    outcome is `not_ready`; malformed fence/ID-array or a selected ID outside the exact live
    partition is `invalid`; changed retry selection/key binding is `conflict`. Only the stale
    receipt exposes the current authorized partition fence. If the exact selection would exceed
    rule 8's shared-partition ceiling, the whole operation returns
    `scratchpad_partition_exhausted` before appending any successor, fact, or reap. No refusal
    echoes selected IDs, dispositions, or content. Ledger/batch integrity failures remain thrown
    integrity errors, never expected results.

    A terminal task with no durable `steering.registered` binding has no orchestrator entitled to
    make an elevation decision. It takes the explicit degenerate policy path: zero elevations,
    every entry disposition `not_elevated/no_driver`, then the same exact task reap with
    `actor:'policy'` as a one-event batch and returns the same receipt shape. This is not
    worker-death cleanup—the trigger is durable task settlement—and prevents plain/no-driver Runs
    from leaking live scratchpad state indefinitely.

21. **End-of-workflow elevation climbs the existing Scratch→KG qualification path without
    changing its derivation algorithm.** `_deriveKnowledgePromotion`
    (coordination-store.mjs:13143-13200; the brief's `minScratchReaders` anchor was :11805+)
    remains byte-for-byte unchanged. This preserves KG-2's settled rule that
    `knowledge.promotion_batch` re-derives only from legacy Scratch facts/read receipts and is
    never stuffed with an independently assembled candidate set
    (`kg12-decisions.md` Part D rule 14).

    Rule 19's shared `note` successor already has an active, observed `scratch.fact_posted`
    bridge under unique resource `scratchpad:<sharedEntryId>`. When a worker writes a `link` whose
    `target.type === 'entry'` and exact `(entryId,entryDigest)` resolves to a shared entry with a
    non-null `scratchFactId`, link admission is one atomic
    `_appendBatch(entries,'scratchpad_link_citation')`:

    1. `scratchpad.entry_written` for the explicit citation; then
    2. the **existing** `scratch.read` kind, prepared from
       `checkScratch(target.resource, readerEnvRef)` with the authenticated link author's
       closed scratchpad citation binding.

    That existing-kind payload is exact:

    ```js
    {
      readerActor: 'scratchpad.link',
      readerWorker, taskId, runId,
      citationLinkEntryId, citationLinkEntryDigest,
      targetEntryId, targetEntryDigest,
      citationRelation,
      resource, envRef, result
    }
    ```

    The citation-link IDs/digest bind the immediately preceding `entry_written`; the target
    IDs/digest bind that link's exact shared-entry target; `resource` is exactly
    `scratchpad:<targetEntryId>`; and `citationRelation` equals the link's closed relation.
    `result` is the canonical `checkScratch` output at that event prefix: `claims:[]`,
    `clear:true`, and exactly the one active bridge fact whose ID is the target's
    `scratchFactId` (including the normal hub-derived tree warning, if any). No caller supplies
    any of these receipt fields.

    Because the current generic `scratch.read` fold only pushes payloads
    (coordination-store.mjs:7914-7915), the same implementation commit adds a marker-specific
    replay validator there: when `readerActor === 'scratchpad.link'`, keys must match the exact
    shape above; actor and idempotency key must bind the preceding link-write event; the
    authenticated worker/task/Run and link/target digests/relation must match that event; and a
    prefix-local `checkScratch(resource,envRef)` recomputation must equal `result`. Unknown fields,
    a non-adjacent/rewritten link, a missing/inactive/different bridge fact, or a forged result
    fails `scratchpad_citation_integrity`. Other legacy `scratch.read` payloads retain their
    current behavior. This validation changes no line of `_deriveKnowledgePromotion`.

    `readerEnvRef` is hub-derived from the link task's immutable admitted tree. The unique
    resource makes the read result cite the target fact exactly; the submitted entry digest is
    rechecked before the batch. This is an intentional evidence receipt for a write, not the
    evented-polling anti-pattern: `run.scratchpad`, horizon projection, and
    `scratchpadSnapshotBatch` remain pure/non-evented, and links to URL/repository-path/private
    worker entries append no `scratch.read`; ordinary callers cannot invoke legacy `readScratch`
    on the reserved resource.

    The unchanged promotion derivation then does all qualification: only active observed facts
    in the repository; only distinct reader tasks that are completed and have verified outcome
    Findings; and `readerTaskIds.length >= policy.minScratchReaders`
    (coordination-store.mjs:13176-13190). Duplicate links by one task naturally count once.
    Polling, bare authorship, links from unfinished/unverified tasks, and links to a different
    digest do not qualify. `plan`, `doubt`, and `link` have no bridge facts and cannot enter this
    path directly. A qualified note fact yields the existing ScratchFact source node, observed
    `scratch.cited_observed` Finding,
    `DerivedFrom`, and `VerifiedBy` edges through the existing `knowledge.promotion_batch`.
    Issue #33 changes how typed entries produce legitimate Scratch facts/reads; it does not
    weaken or fork Cairn's qualification algorithm.

    `minScratchReaders` is readership, not consensus: every exact entry link records a read,
    including `relation:'contradicts'`. Relation remains untrusted worker annotation on the link;
    it neither silently boosts grounding nor automatically vetoes the observed candidate. The
    settle-time orchestrator sees the relation in the bound citation receipt/link event (and in
    the shared projection when that link was itself elevated) and decides whether to invoke rule
    22; a contradiction can therefore produce an explicit not-admitted disposition instead of
    being erased or misrepresented as support.

    At workflow settle, after all task outcomes/link receipts are durable, the driver calls the
    existing `promoteKnowledgeBatch(repoId, observedSeq, policy, auth)` once at the fixed
    settlement boundary. Because that operation is repository-scoped, its batch may honestly
    include other already-qualified legacy Scratch candidates; the driver sends to rule 22 only
    returned candidates whose source fact has this scratchpad namespace and exact `runId`.
    There is no per-entry direct promotion call and no scratchpad-only reimplementation of the
    batch.

22. **The existing KG-2 settle-time orchestrator-admit gate is the final project-horizon
    boundary.** `_deriveWorkflowAdmission` currently accepts observed Findings from closed board
    items and admitted packages (coordination-store.mjs:13423-13451), and
    `admitWorkflowFinding` enforces both promotion actor and active Run-orchestrator lease
    (coordination-store.mjs:13473-13510; coordinator wrapper :9618-9631). It gains only
    `scratch.cited_observed` as a third trigger, with an additional source check against the event
    prefix strictly before `beforeEventSeq`: the candidate's `sourceSeq/sourceKind` must resolve
    to `scratch.fact_posted`; that fact must have `namespace:'scratchpad'`; its
    `{entryId,entryDigest,kind:'note'}` value must resolve to an earlier exact
    `scratchpad.entry_elevated` note successor in the same Run; and no shared-partition reap may
    precede the admission event. The derivation never consults the current mutable map for this check, so
    validating an idempotent historical admission after later reap reconstructs the same answer.
    Thus this extension does not make every legacy Scratch promotion eligible for workflow
    admission.

    The workflow driver, before revoking its lease, calls the existing gate for each qualified
    observed Finding. The gate re-derives the candidate, emits `knowledge.workflow_admitted`, and
    creates a verified project-horizon Finding plus `DerivedFrom` edge. No scratchpad entry,
    worker selection, raw prose, or unrelated legacy Scratch fact bypasses
    `minScratchReaders` or the KG-2 lease-bound admit.

23. **Workflow reaping is last, atomic with bridge expiry, and fail-closed.** It cannot begin
    until every Run task has a durable terminal outcome, every task scratchpad decision/reap has
    completed, and the store independently observes zero live worker-scope partitions for that
    Run. A terminal task whose task-settlement batch failed therefore blocks workflow settlement;
    the orchestrator must retry rule 19/20 rather than hiding the private residue under a shared
    reap. Once every selected qualified Finding also has either an idempotent
    `knowledge.workflow_admitted` receipt or an explicit bounded disposition, the orchestrator
    appends one
    `_appendBatch(entries,'scratchpad_workflow_settlement')` containing
    `scratchpad.partition_reaped {scope:'shared',basis:'workflow_settled'}` followed by one
    existing `scratch.fact_expired` per active bridge fact, all bound in canonical
    `(scratchFactId,entryId)` order. Each shared row is visibly `admitted` with its verified
    Finding ID, `not_admitted/orchestrator_skipped|contradiction_present` after orchestrator
    judgment, or `not_eligible/min_readers|type_ineligible` when it never cleared qualification;
    raw prose is never copied into the receipt. The store prevalidates
    the exact fence, entry set, every
    active fact ID, and every unique idempotency key before `_appendBatch`. Only after that batch
    succeeds does it revoke the Run lease. If promotion/admission or any preflight validation
    fails, the shared partition and every bridge fact remain live and the workflow does not claim
    scratchpad settlement.

    The named wrapper is
    `settleWorkflowScratchpad(runId,{expectedScratchpadFence,skips})`; it does not accept
    caller-built disposition rows, target IDs, fact IDs, scope, actor, or expiry keys. Its only
    judgment input, besides a nonnegative safe-integer `expectedScratchpadFence`, is an exact
    non-sparse 0..512-element `skips:[{entryId,reasonCode}]` array for qualified notes that the
    orchestrator intentionally did not admit. IDs are unique, match rule 7's grammar, and are
    canonical-sorted by the hub; caller order carries no meaning. `reasonCode` is only
    `orchestrator_skipped` or `contradiction_present`. The store reconstructs the pre-reap
    qualification/admission prefix and derives every row in canonical entry-ID order:

    - a `plan`, `doubt`, or `link` is `not_eligible/type_ineligible`;
    - a note without a qualified promoted Finding is `not_eligible/min_readers`;
    - a note with an exact Run-bound `knowledge.workflow_admitted` receipt is
      `admitted/selected`, with the hub-resolved verified Finding ID as `targetId`;
    - every remaining qualified note must occur exactly once in `skips` and becomes
      `not_admitted/<supplied closed reason>/null`.

    A skip for an ineligible or already admitted entry, a duplicate/unknown entry, an omitted
    qualified entry, or `contradiction_present` without at least one bound citation receipt whose
    relation is `contradicts` fails before append. Thus the orchestrator retains the KG-2
    admission judgment, but cannot forge eligibility, a successful target, or a receipt for an
    entry outside the fenced partition.

    Its exact prose-free return is:

    ```js
    {
      ok: true,
      result: 'settled' | 'idempotent' | 'empty',
      runId, scope: 'shared',
      observedFence, scratchpadFence, reapEventSeq, dispositionDigest,
      expiredScratchFactIds
    }
    ```

    Fact IDs are canonical-sorted and hub-derived. The empty shared-scope case appends no reap or
    expiry, returns `result:'empty'` with null event/digest fields and an empty fact-ID array, and
    permits lease revocation. An exact retry validates the prior reap, dispositions, and complete
    co-batched expiry set before returning `idempotent`; a changed skip decision or fact set under
    the deterministic key conflicts.

    Expected workflow-settlement refusals use this exact no-prose union:

    ```js
    { ok: false, result: 'stale_scratchpad_fence', scratchpadFence }
    | {
        ok: false,
        result:
          'scratchpad_settlement_not_authorized'
          | 'scratchpad_settlement_not_ready'
          | 'scratchpad_settlement_invalid'
          | 'scratchpad_settlement_incomplete'
          | 'scratchpad_settlement_conflict'
          | 'scratchpad_batch_oversize'
          | 'run_stopping'
      }
    ```

    Missing/inactive/cross-Run lease is `not_authorized`; unsettled task outcomes, any live
    worker-scope partition, an incomplete task scratchpad decision/reap, or an unrun promotion
    boundary is `not_ready`; malformed/duplicate/inapplicable skips and unsupported contradiction
    reasons are `invalid`; a qualified unadmitted note missing from `skips` is `incomplete`;
    changed retry decisions/fact set are `conflict`. Only the stale result exposes the current
    authorized shared fence. No refusal echoes entry IDs, Findings, fact IDs, dispositions, or
    content; integrity failures remain thrown.

    Run stop is the exceptional cleanup path. After `run.stop_admitted` forbids new
    writes/elevations, the policy-only
    `reapRunScratchpads(runId)` operation derives its own worklist from live indexes; it accepts
    no actor, scopes, entry IDs, dispositions, or resume cursor. Ordering is exact:

    1. worker partitions by `(taskId ASC,workerId ASC)`; then
    2. the `shared` partition last.

    Each partition is one idempotent bounded
    `_appendBatch(entries,'scratchpad_stop_cleanup')` with `basis:'run_stopped'`; every
    disposition is exactly `result:'stopped',targetId:null,reasonCode:'run_stopped'`. The shared
    append also expires every active bridge fact in `(scratchFactId,entryId)` order. Processing
    workers first preserves the shared target/bridge invariants until all private links/candidates
    are disposed, while still manufacturing no promotion or admission.

    `MAX_SCRATCHPAD_STOP_PARTITIONS_PER_PASS = 64` limits one call. After each append, interruption
    is safe: a retry re-derives the remaining worklist and starts at its first live partition, so
    a caller cannot skip cleanup with a forged cursor. The exact prose-free receipt is:

    ```js
    {
      ok: true,
      result: 'partial' | 'complete',
      runId,
      reaped: [{
        scope, taskId, reapEventSeq, dispositionDigest, expiredScratchFactIds
      }],
      nextPartition: null | { scope, taskId, workerId },
      remainingPartitions, remainingEntries, remainingBridgeFacts
    }
    ```

    `reaped` follows the worklist order; worker rows have empty expiry arrays, shared has
    `taskId:null`, and all IDs/counts are hub-derived. `nextPartition` names the next worker with
    its non-null task/worker IDs or is
    `{scope:'shared',taskId:null,workerId:null}` when only shared remains. A repeated call at zero
    residue returns `complete` with an empty `reaped` array and null next partition. Counts come
    from Run-scoped live indexes, never a full ledger scan. An active bridge fact without its
    matching live shared entry is `scratchpad_stop_integrity`, not permission to mint an unbound
    expiry.

    The coordinator continues passes until `complete`. `run.stop_completed` cannot append until
    the store independently proves
    `{remainingPartitions:0,remainingEntries:0,remainingBridgeFacts:0}` and no live elevation
    binding for the Run; only then are all Run cache keys purged. A cleanup refusal/failure leaves
    the Run durably stopping and retryable rather than falsely stopped. Stop manufactures no
    knowledge.

    After either successful workflow settlement or stop, task/workflow horizon projections
    contain zero live scratchpad entries and legacy Scratch contains zero active bridge facts;
    admitted KG nodes remain in the project horizon through the existing Cairn lifecycle.

## Part F — red tests first (`impl/test/scratchpad-33-red.test.mjs`)

Every fixture injects fixed clocks—store clock
`() => '2026-07-23T00:00:00.000Z'`, coordinator `now`
`() => Date.parse('2026-07-23T00:00:00.000Z')`—and asserts exact timestamps/digests from those
clocks. No test uses `Date.now()`, a live timer, or a wall-clock-derived id.

- **SP1 — no subsystem / worker authority.** A worker in each of `working`,
  `input_required`, and `paused` writes through `Coordinator.writeScratchpad`; the event lands in
  the existing coordination ledger and no filesystem path is touched. A terminal task, stale
  worker fence, mismatched worker/task/run, caller-supplied `scope`/`entryId`/digest/ordinal/
  provenance, negative/non-safe expected fence, empty/overlong/non-ASCII-pattern idempotency key,
  and an unregistered coordination-store method all fail typed. Success and every expected
  failure equal rule 3's exact own-key receipt union: malformed envelope is
  `scratchpad_write_invalid`, malformed content is `scratchpad_entry_invalid`, and missing versus
  terminal ownership is indistinguishable as `worker_not_active`; no receipt echoes content or an
  exception message. A worker cannot invoke the shared elevation entry point or write
  `scope:'shared'`. An exported-surface inventory proves there is no public `readScratchpad`,
  worker settlement API, or generic scratchpad append.

- **SP2 — closed grammar and bounds.** One valid boundary-value fixture for each `note`, `plan`,
  `doubt`, and each of the three `link.target` variants is admitted. Unknown/missing fields,
  sparse/overlong plan steps, bad step/relation enums, cross-Run/cross-worker entry targets,
  entry IDs without the required `scratchpad-entry:` prefix, uppercase/wrong-length digests,
  URL user-info/non-HTTPS URLs, absolute/traversing/backslash/drive-prefixed paths, empty path
  segments from doubled/trailing slashes, null bytes, per-field byte overflows, total canonical
  bytes over 8,192, and a fresh entry past the worker partition ceiling all fail
  `scratchpad_entry_invalid` or `scratchpad_partition_exhausted` before append. A raw entry over
  16,384 bytes refuses before NFKC/URL parsing; accessor, symbol-key, sparse, cyclic, non-finite,
  and non-JSON fixtures refuse without invoking a getter. Ordinary legacy Scratch cannot post,
  claim, or read the reserved `scratchpad` namespace/`scratchpad:` key-resource prefix. URL/path
  link admission and projection invoke no network or filesystem resolver.

- **SP3 — hub identity/content addressing/idempotency.** A worker cannot choose identity.
  `entryId`, `contentDigest`, and `entryDigest` equal independent test recomputation over the
  fixed prospective sequence, normalized content, and exact domains in rule 9. NFKC/trim- or
  canonical-URL-equivalent inputs resolve to the same admitted content digest; replaying the same
  idempotency key with that equivalent content returns the same event. Changing one normalized
  content byte or ownership coordinate under that key fails `scratchpad_write_conflict`. A plan
  can supersede the exact ID/digest of a same-scope plan and cannot cite a wrong digest,
  note, unknown entry, other scope, or other Run. Shared successor identity/digest independently
  recompute from the exact source/elevation domain and preserve `contentDigest`; an attempted
  elevation payload `content`/rewrite fails integrity, while the fold derives byte-identical
  shared content from the source commitment. Every hub-authored
  elevation/fact/citation/reap/expiry key matches rule 10; same-key/different-binding retries fail
  conflict.

- **SP4 — complete fold surface.** The event-kind inventory contains exactly
  `scratchpad.entry_written`, `scratchpad.entry_elevated`, and
  `scratchpad.partition_reaped`; there is no `scratchpad.read`. The batch allowlist contains the
  four exact rule-10 scratchpad transaction kinds. A plain worker write has no batch field; every
  elevation, citation receipt, settlement reap, and stop reap has the required named metadata.
  Live state, full-log replay, and a
  projection-checkpoint restore produce byte-identical entries, indexes, elevations, reaps, and
  scope fences. Deleting any scratchpad field from the checkpoint, changing an event payload
  digest/source binding/fence/disposition set, or replaying an elevation before its source fails
  integrity. Every invalid basis/actor reap pair is refused. `snapshot().scratchpad` exists and
  is empty on a fresh store, then clone-safe and
  complete after all three event kinds. Eligible note elevation proves an atomic
  `entry_elevated`+existing-`scratch.fact_posted` batch; explicit shared-entry citation proves an
  atomic `entry_written`+existing-`scratch.read` batch; shared reap proves an atomic
  `partition_reaped`+all-existing-`scratch.fact_expired` batch, with no new event names.
  The marked `scratch.read` branch rejects unknown fields, non-adjacency, actor/key/binding
  mismatch, rewritten link/target/relation, wrong hub tree, and any result differing from the
  prefix-local `checkScratch` recomputation; ordinary legacy read fixtures remain unchanged.
  A multi-entry task decision proves every canonical elevation/optional fact and its final reap
  share one append: injected failure exposes neither shared successors nor a reap.
  Deleting/reordering a member, changing batch kind/ID/index/count, splitting a group at a
  checkpoint, or loading a crash-truncated trailing group fails
  `scratchpad_batch_integrity` before member zero changes projection state.
  Maximum valid task/shared groups independently serialize below 2 MiB; a prospective group over
  that ceiling fails `scratchpad_batch_oversize` before file append.
  Exact retry of a completed reap returns its original receipt despite the advanced fence;
  same-key retry with a changed fence, basis, entry set, or disposition fails conflict. After
  reap, raw entry content is absent from live maps, checkpoint state, and snapshot output; only
  the minimal receipt remains. More than 256 historical receipts and more than 262,144 receipt
  bytes retain the newest whole receipts, set the truncation flag, and replay/checkpoint to the
  same bytes.

- **SP5 — fenced non-evented reads.** Repeated `scratchpadSnapshot`/
  `scratchpadSnapshotBatch`/`projectScratchpadView` polls leave ledger length, `lastSeq`, and all
  fences unchanged and return the same frozen cached view while the tuple is equal. A worker+
  shared or all-scope projection invokes exactly one batch capture with one `observedSeq`, never
  a loop of independently observable scope reads; a mismatched expected tuple refuses before
  returning slices. One worker write invalidates only that worker scope; one elevation
  invalidates only shared; reap invalidates only its partition.
  Reads use the per-scope index (instrumented to prove no full `_events`/all-entry scan).
  Newest-first canonical order is stable across live/replay/cache paths; item-count and byte
  ceilings discard oldest rows first and set
  `scratchpadViewTruncated:true` plus `nextBefore`. Keyset paging at one fence visits every
  authorized row exactly once using the exact rule-15 less-than/equal-plus-ID predicate; a write
  between pages makes the old tuple fail
  `scratchpad_cursor_stale`, and a cursor cannot leak a sibling scope's count. A companion test
  pins legacy `readScratch` to append
  `scratch.read`, proving scratchpad projection polling did not accidentally reuse the named
  anti-precedent; SP9 separately covers the intentional explicit-link citation receipt. Churning
  more than 256 authorization/fence/page keys never grows the application cache beyond 256;
  recomputation evicts older fences for the same slice, LRU eviction preserves byte-identical
  content, and Run close removes that Run's keys without appending an event.

- **SP6 — visibility and driver steering.** Worker A sees A + shared, worker B sees B + shared,
  neither sees the sibling scope, and a Run-bound orchestrator sees A/B/shared while an
  orchestrator bound to another Run sees none. A real two-member wave has member A write all four
  kinds; `wave.progress().members[A].scratchpad` exposes the bounded sanitized view to the driver,
  while member B's row does not leak A's private partition. The test fails if the entry is only
  visible through a direct store call: the wave-facing projection itself is required. A live
  owned single-task Run always has the additive schema-v1 field, an empty pad is `entries:[]`,
  and an unresolvable historical/multi-attempt top level yields `null`. Workflow attempt refs are
  prose-free and `run.scratchpad({workerId})` resolves only an owned attempt; missing/cross-Run
  IDs fail uniformly as `scratchpad_not_available` without leaking existence, malformed reads
  fail `scratchpad_read_invalid`, and stale cursors fail `scratchpad_cursor_stale`; none appends
  or echoes prose. Every entry equals the closed rule-16 union, with null source/integer ordinal
  for private entries and exact source/null ordinal for shared successors; extra raw/internal
  fields fail the test. A scratchpad write makes an already-offered semantic steering action
  stale through `semanticViewDigest`; refresh yields a valid action. `taskHorizon` contains the
  same closed own+shared worker view; orchestrator `workflowHorizon` contains one globally
  bounded all-scope view, while worker `workflowHorizon` remains own+shared and leaks no sibling
  fence/count. `projectHorizon` contains no raw scratchpad field; all three observations append
  nothing.

- **SP7 — F14 sanitization/provenance.** Credential-shaped text in every worker-authored string
  position, including plan steps and link URL/path display, projects as
  `[credential-shaped content redacted]`. Maximum valid multibyte fields project intact because
  every admission ceiling is below `boundedAttentionText`'s truncation threshold; an over-limit
  field refuses before append, and malformed overlong replay state fails integrity. Every
  projected prose value has
  `provenance:'model-authored',untrusted:true` and the author worker. Hub
  IDs/digests/fences remain plain; worker-selected closed enums remain plain machine values but
  are never asserted as hub truth. All four discriminated projection contents are exact—there is
  no raw fallback body, fact ID, eligibility counter, or unknown field. The outward redaction
  does not change the independently recomputed `entryDigest`. A unique secret-shaped sentinel
  appears raw only in its original `entry_written` ledger event/live internal state: elevation
  event, bridge fact/read, reaps, refusal/success receipts, Run/wave evidence, promoted KG nodes,
  and admitted Finding contain only commitments/fixed metadata or the redaction marker.

- **SP8 — continuous candidacy and task settle.** After a worker writes and its provider
  transport dies, the driver still reads the candidate from replayed ledger state. Worker death
  alone appends no reap. At task terminal settlement, a valid steering registration/fence and
  multiple selected IDs produce canonical immutable shared successors, note bridge facts, and
  the worker-partition reap in one batch, with visible exact disposition rows and matching
  digest. Each successor remains a readable `candidate` with original author/source provenance
  after its private source partition is gone. An empty selection reaps with all
  `not_elevated/orchestrator_skipped`/null targets. Elevation conflict, stale fence,
  absent/mismatched steering registration, preflight failure, or append failure leaves both
  partitions byte-identical and retryable; it never reaches a reap in a `finally`. Exact retry
  returns the closed `idempotent` receipt, while changing the selection under the same reap key
  conflicts. Nonterminal outcome, missing/cross-Run authority, stale fence, malformed/foreign
  selection, changed retry, full shared partition, and batch oversize each equal rule 19's exact
  refusal result and echo no IDs/content; shared-capacity refusal appends no
  successor/fact/reap and preserves both fences. Separately, a task that terminalizes with no
  steering registration takes the policy zero-elevation path and reaps all entries
  `not_elevated/no_driver` rather than leaking them. A selected plan that supersedes an unselected
  private plan and a selected link to an unselected private note elevate only the two selected
  rows. After reap, their shared projections retain the exact historical target IDs/digests but
  expose no target content or target-liveness field; no implicit shared successor, bridge fact,
  or explicit-link read is appended for either target.

- **SP9 — qualification and unchanged promotion path.** Elevating a shared `note` atomically
  creates its exact observed legacy Scratch fact; shared `plan`/`doubt`/`link` entries create
  none and cannot be admitted as Findings without a later note. Non-evented
  scratchpad polls append no receipt and do not qualify the fact. Each exact shared-entry link
  atomically appends one existing `scratch.read` whose exact link ID/digest, target ID/digest,
  relation, worker/task/Run, resource, hub-derived tree, and one-fact result bind that fact;
  private-entry, URL, and repository-path links append none. A colliding legacy fact or claim is
  refused and an ordinary legacy read is blocked by the reserved prefix before any can
  contaminate/forge that result. Tampering any marked receipt field fails replay integrity while
  the same event still qualifies through the byte-identical existing derivation. With fewer than
  `minScratchReaders`, the unchanged
  `promoteKnowledgeBatch` omits the fact. After the threshold number of distinct completed tasks
  with verified outcomes write exact links, the existing operation emits one
  `knowledge.promotion_batch` containing its normal ScratchFact source, observed
  `scratch.cited_observed` Finding, `DerivedFrom`, and exact `VerifiedBy` edges/evidence.
  Duplicate links by one task count once; links from unverified/non-completed tasks, links to
  another digest, and bare candidate authorship do not count. A `contradicts` link counts as a
  read but preserves its relation in the receipt and does not force KG-2 admission. A
  source-string/behavior pin proves `_deriveKnowledgePromotion` is unchanged, and existing legacy
  Scratch promotion fixtures stay byte-identical.

- **SP10 — KG-2 gate and workflow reap.** The observed scratchpad Finding is rejected without an
  active Run-orchestrator lease and accepted through the existing
  `admitWorkflowFinding` operation with one `knowledge.workflow_admitted` event, verified
  Finding, and `DerivedFrom` edge. A raw entry ID, under-qualified source, unrelated legacy
  `scratch.cited_observed` Finding, or namespace/entry-digest/Run mismatch cannot enter that gate.
  Admission validation re-derives from the historical pre-event prefix, so replay remains exact
  after later reap. Admission completes before shared reap and lease revocation. Injected
  admission failure leaves shared and its bridge facts live; success atomically reaps shared,
  expires every bridge fact, emits the exact admitted/not-admitted/not-eligible rows without raw
  prose and with valid closed reason codes, and leaves the verified project-KG node live. Replay
  derives those rows rather than trusting caller-built receipts: forged target IDs, skips for
  ineligible/admitted entries, omitted qualified entries, and contradiction reasons without a
  bound contradicting citation all fail before append. Empty, settled, and exact-retry cases
  return the closed workflow receipt; a retry with changed skips or bridge-fact expiry set
  conflicts. Zero and 512 skip boundaries pass; sparse/513/duplicate/bad-ID/bad-reason arrays,
  inactive/cross-Run lease, unsettled promotion boundary, stale fence, and an omitted qualified
  decision equal rule 23's exact refusal union without echoed IDs/content. A terminal Run with
  one failed/unreaped task-settlement partition returns `scratchpad_settlement_not_ready`,
  appends nothing, preserves shared and private fences/facts, and retains the active lease until
  rule 19/20 succeeds. Replay
  preserves the
  zero-live-entry/zero-active-bridge state and persistent KG result; immutable citation receipts
  remain in audit history as the evidence the KG nodes cite.

- **SP11 — run-stop guard and cleanup.** After `run.stop_admitted`, worker writes and entry
  elevations fail `run_stopping`; `partition_reaped` with
  `basis:'workflow_settled'` fails, while exact `basis:'run_stopped'` cleanup succeeds. A stopped
  Run with more than 64 unreaped worker scopes plus shared returns a closed `partial` receipt
  after exactly the first 64 `(taskId,workerId)` partitions; retry derives the next live worker
  without accepting a cursor, processes shared last, and returns `complete` with exact zero
  counts. Injected interruption resumes at the first live partition without duplicate events;
  every row is exactly `stopped/run_stopped` with null target, worker expiry lists are empty, and
  the shared batch carries every canonical bridge expiry. A zero-residue retry is a no-event
  `complete` receipt. `run.stop_completed` is refused until partitions, entries, bridge facts,
  and elevation bindings are all zero, then purges the Run cache. An orphan bridge fact fails
  integrity rather than receiving an invented expiry. Cleanup creates no promotion/admission
  event. A source-string/inventory pin proves both effect kinds participate in the guard and reap
  is the intentional cleanup exception.

- **SP12 — regression and envelope bounds.** Existing board/Repl visibility, caches, fences, and
  projections remain unchanged; legacy Scratch facts/claims/reads retain their current behavior.
  Single-task RunView, workflow RunView, `wave.progress`, MCP/application status serialization,
  checkpoint output, and snapshots remain below their respective byte ceilings under maximum
  admitted scratchpad data. A 64-member maximum wave proves scratchpad bytes are at most 2 MiB
  and the whole serialized progress result is at most 7 MiB. A fixture with oversized existing
  attention plus scratchpad data fails with code `wave_progress_oversize` and no echoed
  member/worker prose before stream serialization, adds no retained progress row, and still
  permits a direct `wave.runs.get(role).scratchpad()` read. Repeated successful polls prove
  `wave.evidence()` retains only role/phase summaries and no scratchpad prose. The full canonical
  suite stays green after the focused suite.

## Part G — boundaries

- **No arbitrary notes on disk.** This contract neither permits nor scans `.md` files, `/tmp`,
  worktrees, home directories, or harness session directories as scratchpad storage. Repository
  edits remain repository edits; scratchpad entries are ledger data.

- **Ephemeral means live-horizon lifetime, not secure ledger erasure.** Task/workflow reap removes
  raw entry content from live indexes, snapshots, and projection checkpoints and advances the
  fence so no stale cached view is reachable; the next slice read replaces its older-fence cache
  keys, and workflow settle/stop purges every Run cache key. The original bounded worker-write
  event (plus content-free elevation/lifecycle commitments) remains in the existing append-only
  coordination ledger under that ledger's normal retention policy so replay, integrity checks,
  and continuous candidacy survive process/worker death. Sanitization prevents outward
  secret-shaped display; it is not a promise that a worker may safely submit secrets or that
  settled bytes are cryptographically erased. Secure deletion or a different ledger-retention
  regime is outside issue #33 and must not be implied by the word “ephemeral.”

- **Links are inert references.** Writing/projecting a URL never fetches it, follows redirects,
  builds a preview, or grants network authority. A repository-path link never reads the path or
  claims the file exists; it is normalized untrusted prose until separately verified by an
  existing evidence path. An entry link compares a content-addressed commitment at admission but
  projection never dereferences it, copies target content, reports private target liveness, or
  causes cascading elevation; a later-reaped target remains historical.

- **No new KG or horizon engine.** Scratchpad state is an input to the existing task/workflow
  projections and existing Cairn promotion/admission paths. `recallKnowledge`,
  `queryKnowledge`, and KG ownership binding do not change.

- **No replacement for legacy Scratch.** `scratch.fact_posted`, `scratch.claimed`, claim CAS,
  `readScratch`, and their correction/promotion semantics stay intact. The new surface houses
  worker notes/plans/doubts/links; it does not relabel resource claims/facts or remove
  `minScratchReaders`. The only legacy-surface changes are reserving the new `scratchpad`
  namespace/`scratchpad:` key-resource prefix against ordinary fact writes, claims, and reads,
  plus replay validation for `scratch.read` payloads explicitly marked
  `readerActor:'scratchpad.link'`; ordinary unmarked read and promotion behavior is unchanged.

- **No evented observation receipt.** There is no `scratchpad.read`; a driver poll is not evidence
  that a task relied on an entry. Only an explicit durable `link` can contribute reader evidence.

- **No worker write to shared and no worker self-promotion.** Shared scope, task-settle selection,
  knowledge promotion, and workflow admission remain orchestrator authorities. A driver can read
  a member scope because it owns the Run, not because worker scope is globally visible.

- **No mutable entry lifecycle.** There is no edit/delete/resolve toggle. Plans use
  `supersedes`; notes/doubts use later links/notes; elevation creates an immutable successor; reap
  changes live projection state while preserving the event trail.

- **No secret trust upgrade.** Sanitization is an outward projection discipline, not proof that
  worker prose is true or safe. Every worker-authored string remains explicitly untrusted even
  when elevated to shared. Verified project admission requires observed evidence, reader
  qualification, and the KG-2 orchestrator gate.

- **No stop-time knowledge invention.** Run stop may reap ephemeral state but may not promote it.
  Normal workflow settlement must complete the admit gate before lease revocation; stop cleanup
  reports zero residue without claiming candidate acceptance.

- **No unbounded wave fan-out.** A driver can request a member's projection, and
  `wave.progress()` exposes each member's already-bounded single-Run view. Workflow views never
  inline every maximum-sized worker partition into one envelope.

## Part H — validation

Implementation must make the focused `impl/test/scratchpad-33-red.test.mjs` suite green, then the
canonical repository suite green. This decisions artifact itself is accepted by the dispatched
reviewer contract using exactly:

```text
node --test impl/test/wave-driver-red.test.mjs
```

No alternate command, shell wrapper, nested Baton invocation, or inferred success is a substitute
for that exact verification.
