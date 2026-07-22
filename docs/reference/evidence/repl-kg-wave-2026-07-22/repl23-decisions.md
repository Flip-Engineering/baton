# REPL-2 + REPL-3 decisions contract — named bindings and cell-as-source composition

Ground truth: docs/33 §3.2/§3.3 (docs/33-shared-objects-repl-layer.md:72-114), issues #22
(REPL-2) and #23 (REPL-3). Precedent: reflex2-boards-decisions.md Part B (board fence, F9) and
Part C (cached non-evented projections, F10). Code: the landed boards family in
`impl/src/coordination-store.mjs` (`_boardFences` map and its `_apply` maintenance
:7727-7755, `boardFence` :12057-12059, `postBoardItem`/`_boardSuccessor` content-digest
discipline :12061-12111, `requestBoardClaim` fence CAS :12142-12158, `boardSnapshot` non-evented
read :12201-12208, bound constants :285-291); the wrapper-binding pattern
(`coordinator.mjs:9153-9171`, `requestBoardClaim`/`submitBoardReport` force `owner: workerId`
from the caller's own handle, never a caller-supplied owner string); the cached per-worker
projection (`application.mjs:307-364` `projectBoardView`, cache key
`` `${board} ${role}:${workerId ?? ''} ${boardFence}` `` at :320, byte/count ceilings
`MAX_BOARD_VIEW_BYTES`/`MAX_BOARD_ITEMS` at :54-55 with the `boardViewTruncated` story at
:333, :357-360); the Bench's `outputRef` construction (`context-program.mjs:958-960`, the
completed-cell record `:989-1001`) and artifact ref shape (`normalizeContextArtifactRef`,
context-authority.mjs:142-155); the durable cell state machine (`context.cell_admitted` →
`admitted`, coordination-store.mjs:7332-7336; `context.cell_settled` → `completed`/`failed`/
`attention`/`stopped`, :7337-7351); the attention/retryable settlement rule
(`context-program.mjs:1259-1271`); the global cell projection (`contextCell(cellId)`,
coordination-store.mjs:8071); the `admitContextCell` caller-principal pinning
(coordination-store.mjs:9017-9020); the fold-surface anchors (`PROJECTION_CHECKPOINT_FIELDS`
:89-110, checkpoint field-set validation :744-751, `unsupported_event_kind` terminal throw
:8007, the run-stop guard preamble in `_apply` :7195-7218, `snapshot()` :10341).

This contract does not re-litigate docs/33 v2's settled decisions: `ReplManifest` is a second
manifest shape with its own `baton.repl_manifest` digest basis; bindings are per-scope-fenced,
not board-fenced; `cell:` branch refs resolve at `ReplManifest` admission, never inside the
evaluator. Those are REPL-1's contract. This document is the REPL-2 (bindings) and REPL-3
(`cell:` composition) implementation surface: exact shapes, event payloads, admission order,
error codes, bounds, replay semantics, the fold surface, and the red-test list.

## Part A — binding identity: immutable versions under `(scope, name)` (REPL-2 core)

**Decision: immutable versioned bindings, content-addressed by the hub, never trusted from the
caller.** This is the same stance Part A of reflex2-boards-decisions.md takes for board items
(itemDigest is hub-recomputed, a caller-supplied mismatch is a loud refusal, never a silent
overwrite) and for the same reason: a citation (`repl:<scope>:<name>@<version>`, Part E) must
bind a version whose bytes cannot change under it.

1. **`ReplBinding` shape.** `exact{ scope, name, bindingVersion: positive int, state: 'bound'|
   'dropped', cellId, bindingDigest }`. `scope` matches `^(shared|worker:[A-Za-z0-9._:-]{1,128})$`
   (mirrors `SAFE_BOARD_ID`/`SAFE_BOARD_OWNER` at coordination-store.mjs:285-286, which already
   allow the `:` byte the `worker:<workerId>` grammar needs). `name` is a SafeId ≤128 chars —
   the same `safeId`/`SAFE_ID` discipline as `context-program.mjs:148-152`, bounded to 128 the
   way `SAFE_BOARD_ID`/`SAFE_BOARD_OWNER` bound to 128 (coordination-store.mjs:285-286), not the
   generic 512-byte `safeId` default. `cellId` is the exact `cell:<sha256>` identity a
   `DurableContextSession.evaluate` call produced (context-authority.mjs:125 `` `cell:${...}` ``);
   the store never re-derives it, only validates the format and (rule 3) that it resolves.
   `bindingDigest = H(scope, name, bindingVersion, state, cellId)`, hub-recomputed with the same
   delete-and-recompute discipline as `boardItemContentDigest` (coordination-store.mjs:303-307);
   a caller-supplied `bindingDigest` that disagrees is `repl_binding_digest_mismatch`, never a
   silent overwrite — the `board_item_digest_mismatch` stance, generalized.
2. **Two event kinds, both successor-versioning under the same `(scope, name)`.**
   `repl.binding_set` mints `bindingVersion+1` with `state: 'bound'` and the new `cellId` (or
   `bindingVersion: 1` for the first bind — there is no separate "creation" event, unlike boards'
   `item_posted`/`item_retitled` split, because a binding has no owner/ordinal/title fields to
   distinguish creation from edit; a bind and a rebind are the same shape). `repl.binding_dropped`
   mints `bindingVersion+1` with `state: 'dropped'` and `cellId` carried forward unchanged (the
   last-bound digest stays part of the immutable record — a citation to the dropped version must
   still resolve, rule 10). Both are stored per `(scope, name)` in a version history array
   (`_replBindingHistory`, mirroring `_boardItemHistory` at coordination-store.mjs:7729-7740) so
   every prior version replays exactly; no field of an existing `(scope, name, bindingVersion)`
   is ever mutated in place.
3. **Rebind/drop target must exist and (for rebind) must resolve.** `repl.binding_set` against an
   unknown `(scope, name)` is a fresh bind (`bindingVersion: 1`); against a known one it requires
   the submitted `expectedBindingVersion` to equal the current version (else
   `stale_binding_version` — see rule 7 for why this is a version CAS, not a fence CAS) and the
   new `cellId` must resolve to a **completed** cell via the same global `contextCell(cellId)`
   projection REPL-3 resolution uses (coordination-store.mjs:8071; rule 11) — an admitted-but-
   unsettled or non-completed cell is `repl_binding_cell_not_settled`, the same settled-only
   stance as REPL-3 rule 9. `repl.binding_dropped` requires the binding to currently be `state:
   'bound'` (dropping an already-dropped binding is `repl_binding_not_bound`, not idempotent —
   idempotency is the `auth.key` replay path, rule 6, not a permissive no-op).

## Part B — authority: shared is orchestrator-only, worker scope is wrapper-bound

4. **Shared-scope writes require the ReplManifest's admission principal.** A `repl.binding_set`/
   `_dropped` targeting `scope: 'shared'` is admitted only if the caller's normalized authority
   equals the authority that admitted the governing `repl.manifest_admitted` record for
   `replRole: 'shared'` — the exact `admitContextCell` stance ("Context cell principal differs
   from session admission", coordination-store.mjs:9017-9020: `canonicalDigest(authority) !==
   canonicalDigest(session.authority)` → refusal), applied to the binding's owning ReplManifest
   session instead of a cell. Mismatch is `repl_binding_unauthorized`.
5. **Worker-scope writes are wrapper-bound, never a caller-supplied owner.** A worker can write
   only into its own `worker:<workerId>` scope. The coordinator-layer entry point forces the
   scope's `<workerId>` segment from the caller's own resolved identity exactly the way
   `requestBoardClaim`/`submitBoardReport` force `owner: workerId` from the handle rather than
   trusting `fields.owner` (coordinator.mjs:9153-9171: `{ ...fields, owner: workerId, ... }`). A
   caller cannot mint `repl.binding_set` into `worker:someone-else`; the store-level check mirrors
   rule 4 but against `` `worker:${callerWorkerId}` ``. A worker also cannot write `scope:
   'shared'` directly — promotion is a rebind performed with orchestrator authority (docs/33 §5:
   "a worker binds an intermediate in its own layer... the orchestrator promotes it shared with
   one rebind"), never a worker-authored shared write.
6. **Idempotency follows the standard `_append` key discipline**, not a bespoke one: the caller
   supplies `auth.key` (e.g. `` `repl.binding_set:${scope}:${name}:${expectedBindingVersion}` ``,
   mirroring `board.claim_migrated`'s key shape at coordination-store.mjs:12108); a replayed key
   with an identical bound request returns the prior event (`_byKey` lookup, coordination-
   store.mjs:1030-1031), a replayed key with a divergent request is a conflict refusal — the same
   shape every other admission path in this file uses (e.g. `admitContextCell`,
   coordination-store.mjs:8981-9000).

## Part C — per-scope binding fence: the deliberate divergence from the board fence

7. **`bindingFence(scope)` counts every write to that scope — worker writes included.** This is
   the load-bearing difference from `boardFence`, and it must be implemented as a difference, not
   copied: `_boardFences` bumps ONLY on the five orchestrator-authority item transitions and
   explicitly does NOT bump on `board.claim_requested`/`board.claim_migrated`/`board.claim_expired`
   or `board.report_submitted` (coordination-store.mjs:7734, :7742 bump; :7743-7753 comment "does
   NOT bump the board fence") — because claim/report traffic is ephemeral coordination layered on
   top of an already-fenced item, and self-invalidating it would livelock N workers polling one
   board (F9). A binding has no such split: the binding **is** the versioned content a reader
   caches against, so the writer of ANY version — shared or worker-authored — must invalidate
   every reader's cache of that scope, or a stale projection would serve a superseded digest under
   a citation that has already moved on. So: `_replBindingFences` (a `Map<scope, count>`, parallel
   to `_boardFences` at coordination-store.mjs:799) increments on **both** `repl.binding_set` and
   `repl.binding_dropped`, for **every** scope including `worker:<id>` ones — there is no
   worker-traffic carve-out here.
8. **Replay-derivable, not stored mutable state.** Exactly like `boardFence` (coordination-
   store.mjs:12057-12059: `this._boardFences.get(board) ?? 0`), `bindingFence(scope)` is a pure
   re-count reconstructed by replaying `repl.binding_set`/`_dropped` events for that scope in
   `_apply` — never a separately durable counter that could drift from the log.
9. **Rebind/drop use a version CAS, not a fence CAS.** Because every write bumps the scope fence
   (rule 7), a `boardFence`-style "CAS against the current scope fence" (mirroring
   `requestBoardClaim`'s `expectedBoardFence` check, coordination-store.mjs:12153-12154) would
   make concurrent binds to *different names in the same scope* spuriously conflict with each
   other. Concurrency control for a rebind is therefore keyed to the binding's OWN
   `expectedBindingVersion` (rule 3), the same granularity `board.item_retitled`/`_reordered` use
   against `itemVersion`, not `boardFence` — the scope fence exists purely to invalidate read
   caches (Part D), never to gate writes.

## Part D — cached, non-evented projections (the F10 rule, per-scope)

10. **No `repl.read` event kind; a binding read appends nothing to the ledger** — the same F10
    stance boards take (no `board.read` kind exists; `boardSnapshot` is pure, coordination-
    store.mjs:12201-12208 comment "Non-evented board read").
11. **`ReplBindingProjection` cached keyed by `(scope, workerId, bindingFence(scope))`**,
    recomputed only when that scope's fence advances — the exact caching contract
    `projectBoardView` implements for boards (application.mjs:307-321: cache key
    `` `${board} ${role}:${workerId ?? ''} ${boardFence}` ``, `if (cache && cache.has(cacheKey))
    return cache.get(cacheKey)`). A `replBindingSnapshot(scope)` store method returns the current
    (non-evented) per-name view — active bindings only (`state: 'bound'`), one row per `name`
    keyed to its latest version — mirroring `boardSnapshot(board)`'s per-board indexed read
    (coordination-store.mjs:12203-12208), never a full claim/fact-style scan. A caller-layer
    `projectReplBindingView(snapshot, viewer, cache)` (mirroring `projectBoardView`,
    application.mjs:315-364) applies the visibility rule (rule 12) and bounds (rule 13) and is
    the cached, viewer-shaped read.
12. **Per-scope visibility.** A worker sees its own `worker:<id>` scope's bindings plus the
    `shared` scope (read-only from the worker's side); the orchestrator sees every scope — the
    same split `projectBoardView`'s per-worker filter implements for boards (application.mjs:
    329-332: `role === 'orchestrator' || item.owner === workerId || board === workerId`).
13. **Bounds.** `MAX_REPL_BINDINGS` per scope (a store-side admission ceiling on distinct `name`s
    live in one scope — `repl_bindings_exhausted` when a fresh bind would exceed it), name ≤128
    chars SafeId (rule 1). The projection gets its own byte ceiling
    `MAX_REPL_VIEW_BYTES`/an item-count ceiling, mirroring `MAX_BOARD_VIEW_BYTES`/`MAX_BOARD_ITEMS`
    (application.mjs:54-55) with an explicit `replBindingViewTruncated` flag — shed trailing
    entries and re-flag until under the byte ceiling, never a silent drop (application.mjs:
    356-360's loop is the exact shape to mirror).

## Part E — citation grammar: `repl:<scope>:<name>@<version>`

14. **Grammar:** `` `repl:${scope}:${name}@${bindingVersion}` `` where `scope` and `name` are the
    exact validated strings from rule 1 and `bindingVersion` is the decimal integer version being
    cited — parsed by a closed regex
    `^repl:(shared|worker:[A-Za-z0-9._:-]{1,128}):([A-Za-z0-9._:-]{1,128})@([1-9][0-9]*)$`.
15. **Resolution is a named, non-evented read path — the same site that already renders
    board/report detail.** `projectBoardView` (application.mjs:315-364) is the precedent: a pure
    projection function, not a new ledger read. A `resolveReplCitation(citation)` helper parses
    the grammar (rule 14) and looks up the **exact** `(scope, name, bindingVersion)` row from
    `_replBindingHistory` (rule 2) — never "latest" for that name, even if a newer version exists.
    An unparseable citation or one naming a `(scope, name, bindingVersion)` triple that was never
    written is `repl_binding_citation_not_found` (typed, not a silent null); the citation resolves
    to the exact `cellId` recorded at that version regardless of whether the binding is presently
    `bound` or has since been `dropped` (rule 2 — dropped bindings keep their history, they do not
    forget it).
16. **Citations render through the same sanitization discipline as board content.** Because a
    citation can appear inside a worker-authored report/decision-request body,
    `resolveReplCitation`'s output is subject to the same
    `boundedAttentionText`/`SECRET_SHAPED_TEXT`/`wrapProse` untrusted-prose provenance marking
    `projectBoardView` already applies to `title`/`detail`/report bodies (application.mjs:340-341,
    :346, citing the F14 discipline at application.mjs:307-313) when the resolved value is
    rendered back into a view — the resolved `cellId`/digest itself is a closed, safe token and
    is never itself treated as prose.

## Part F — REPL-3: `cell:` branch refs, resolved at manifest admission

17. **New branch ref form, admission-time only.** A `ReplManifest` branch gains exactly one new
    form beyond the existing `ctx:sha256:<digest>` source ref (`SOURCE_REF`, context-program.mjs:
    19, matched in `manifestBranch` at :164-165): `cell: { digest }` where `digest` matches the
    `DIGEST` pattern (context-program.mjs:16, `^[a-f0-9]{64}$`) and `` `cell:${digest}` `` is a
    real `cellId`. This ref form is recognized **only** during `repl.manifest_admitted`
    construction (REPL-1's admission path) — it is never a value `normalizeContextProgram`,
    `contextProgramInputRefs` (context-authority.mjs:59-78), or any Program `source` op
    (context-program.mjs:342-345, which only names manifest branches, never a raw ref kind) ever
    sees; a Program cannot express `cell:` at all, so purity checking
    (`contextProgramPure`/`contextProgramIsPure`, context-program.mjs:27-35 and
    context-authority.mjs:54-57) is completely unchanged — REPL-3 touches zero evaluator code.
18. **Settled-only resolution (the F12 rule).** At admission, the hub looks up
    `contextCell(` `` `cell:${digest}` `` `)` — the SAME global, content-addressed projection
    every durable cell lookup uses (coordination-store.mjs:8071:
    `return clone(this._contextCells.get(cellId) ?? null);`), not scoped to the admitting
    ReplManifest's own session. If the cell is absent, or present but not `state: 'completed'`
    (the only settled-success state in the `admitted → completed|failed|attention|stopped`
    machine, coordination-store.mjs:7332-7351), admission is a typed refusal —
    `repl_manifest_cell_not_settled` — and the event is never appended (an admission that never
    happened, never a poisoned one). `failed`/`stopped`/`attention` cells refuse exactly like an
    absent one; there is no partial-credit resolution.
19. **The resolved artifact coordinate — not the symbolic `cell:` ref — is what gets recorded.**
    On success, the hub takes the settled cell's `result.outputRef`
    (the shape `context-program.mjs:958-960` writes and `:989-1001`'s `completed` record carries,
    validated by `normalizeContextArtifactRef`: `exact{bytes, digest, handle, kind, mediaType}`
    with `handle === 'art:sha256:' + digest`, context-authority.mjs:142-155) and, at the same
    instant, reverifies the artifact bytes through the identical reverify discipline
    `contextCellArtifacts`/`settleContextCell`'s completion path already use
    (coordination-store.mjs:8518-8534, :9088-9098: read via the injected context-reference
    reader, throw `context_artifact_unavailable` on missing/changed bytes). If reverification
    fails at this instant, admission refuses with `context_artifact_unavailable` — the event is
    not appended (same "never poisoned, only never-happened" stance as rule 18) — mirroring
    `settleContextCell`'s own stance at coordination-store.mjs:9094-9096, where the identical
    error is raised as a `CoordinationRefusal` before any event is written. On success, the
    resolved artifact coordinate is written into the `repl.manifest_admitted` event payload as
    that branch's evented coordinate (parallel to how an ordinary branch already carries its own
    `ref`/`digest` pair rather than a lazy pointer, `manifestBranch`, context-program.mjs:159-180)
    — so replay reconstructs the identical branch bytes with no store lookup, and the normalized
    `ReplManifest`'s own digest (which covers its resolved branches, per REPL-1's mold sharing
    `normalizeContextManifest`'s exact-field discipline, context-program.mjs:183-192) is stable
    forever after.
20. **Post-admission artifact loss is a live re-evaluation concern, never a re-litigation of
    admission.** Once admitted, the branch's resolved coordinate is baked in (rule 19) — nothing
    at read time re-walks `cell:` resolution. If that artifact is later lost and some downstream
    Program cell reads through the branch (an ordinary `source` op against the resolved
    `ctx:sha256:` coordinate, unrelated to `cell:` machinery), that cell's OWN evaluation fails and
    settles through the existing, unmodified rule: `DurableContextSession.evaluate`'s
    `settleFailure` path (context-program.mjs:1255-1277) treats `context_source_unavailable`/
    `context_artifact_unavailable` as retryable — settling that cell to `state: 'attention'` with
    `termination.retryable: true` (context-program.mjs:1259-1271) — while any other error settles
    `failed`. This is exactly the "§93.5 resolve-time revalidation" and "attention read semantics"
    docs/33 rule 9 names; REPL-3 changes nothing about it — it is the ordinary cell-settlement
    contract, now reachable transitively through a `cell:`-resolved branch the same way it is
    reachable through any other branch.
21. **No new operators, no evaluator changes, effects stay Workflow-gated.** The 14 pure ops + 4
    predicates whitelist (context-program.mjs:341-441, `EFFECT_OPS` at :25) is unchanged;
    `map`/`reduce`/`review`/`verify` still require Workflow authority
    (`context_program_effect_requires_workflow`, context-program.mjs:917-920, and the durable
    equivalent `context_cell_effect_requires_workflow`, coordination-store.mjs:8977-8980). `cell:`
    composition is entirely a manifest-admission-time concept (rules 17-19); it adds no Program
    surface at all.

## Part G — the fold surface (REPL-2 event kinds; REPL-3 rides REPL-1's kind)

REPL-3 mints no event kind of its own — the resolved coordinate rides inside REPL-1's
`repl.manifest_admitted` payload (rule 19). REPL-2 adds exactly two: `repl.binding_set`,
`repl.binding_dropped`. Each ships, in the same commit, with:

22. **`_apply` branches.** Extend the same `_apply` if/else chain the board events already extend
    (coordination-store.mjs:7727-7755) with `repl.binding_set`/`repl.binding_dropped` cases —
    landed BEFORE the terminal `unsupported_event_kind` throw (coordination-store.mjs:8007) so an
    unhandled kind still fails loudly, never silently no-ops. Each branch: (a) upserts
    `_replBindings.set('${scope}:${name}', record)` (current row per name); (b) appends to
    `_replBindingHistory` keyed the same way (mirrors `_boardItemHistory`, coordination-
    store.mjs:7729-7740); (c) bumps `_replBindingFences.set(scope, (get(scope) ?? 0) + 1)` for
    **every** write regardless of scope kind (rule 7 — the explicit divergence from the board
    `_apply` comment "Only the five orchestrator-authority transitions advance the board fence",
    coordination-store.mjs:7741).
23. **`PROJECTION_CHECKPOINT_FIELDS` gains `_replBindings`, `_replBindingHistory`,
    `_replBindingFences`.** The frozen array at coordination-store.mjs:89-110 is exact-matched on
    checkpoint load (`Object.keys(projection).sort().join(',') !==
    [...PROJECTION_CHECKPOINT_FIELDS].sort().join(',')`, :742-744, throwing `checkpoint
    projection is invalid` at :751) — the field-set change and the `_apply` change land in the
    SAME commit, or an old checkpoint format silently mismatches a newer field list. This is a
    deliberate fail-closed bump, not a migration: an old checkpoint written before this field set
    existed is refused at load (correct — it is missing state the projection now requires), never
    coerced into a partially-populated projection.
24. **No `snapshot()` exposure — follow the board precedent, not the context-session precedent.**
    Boards are notably absent from the top-level `snapshot()` dump (coordination-store.mjs:10341
    has no `board`/`boards` key at all; the only board read surface is the dedicated
    `boardSnapshot(board)` method at :12201-12208). Bindings follow the SAME non-exposure: no
    `snapshot().repl` dump, only the dedicated `replBindingSnapshot(scope)` method (rule 11) — a
    full ledger dump would defeat the fence-gated, per-scope caching story (Part D) by paging in
    every scope's bindings on every snapshot call regardless of whether anything reads them.
25. **Run-stop guard preamble extension.** The `_apply` preamble that derives `admittedRunId` and
    refuses effects admitted after their run began stopping (coordination-store.mjs:7195-7218)
    today recognizes `context.session_admitted`/`context.cell_admitted`/`context.call_admitted`/
    `context.call_settled` (deriving, e.g., `context.cell_admitted`'s runId via
    `this._contextSessions.get(p?.cell?.sessionId)?.runId`, :7207-7208) plus the goal/plan/task
    kinds — it does NOT currently cover `board.*` kinds at all (boards have no run-stop guard in
    this preamble today). `repl.binding_set`/`_dropped` MUST be added to this list, deriving
    `admittedRunId` from the binding's owning `ReplManifest`'s `runId` (resolved via the same
    session/manifest lookup pattern as the `context.cell_admitted` case) so a binding write
    admitted after its run began stopping throws `run_stopping`
    (`CoordinationIntegrityError`, mirroring :7216-7218) exactly like a context cell admission
    does — REPL writes must refuse after stop begins, they must not silently land in a stopping
    run's namespace the way today's board writes apparently can.
26. **Event-kind inventory test.** Extend (or add alongside) the docs/33 §4 kind-inventory test
    with `repl.binding_set` and `repl.binding_dropped` in the closed kind set, so an incomplete
    fold (an `_apply` branch, a checkpoint field, or the stop guard left un-updated) fails at test
    time rather than at replay.

## Part H — red tests first (`impl/test/repl23-bindings-red.test.mjs`)

**REPL-2 — bindings:** a fresh `repl.binding_set` mints `bindingVersion: 1`; a rebind against a
correct `expectedBindingVersion` mints `bindingVersion+1` and retains the prior version in
history; a rebind against a stale `expectedBindingVersion` is `stale_binding_version`; a
submitted `bindingDigest` mismatch is `repl_binding_digest_mismatch`, never a silent overwrite; a
`repl.binding_set` naming a cell that is `admitted` (not yet completed) or `failed`/`attention`/
`stopped` is `repl_binding_cell_not_settled`; a `repl.binding_dropped` against an already-dropped
binding is `repl_binding_not_bound`; a shared-scope write from a non-admission principal is
`repl_binding_unauthorized`; a worker-scope write is wrapper-bound to the caller's own workerId
(cannot target another worker's scope); a worker cannot write `scope: 'shared'` directly.
**Fence divergence:** a worker-scope write DOES advance that scope's `bindingFence`, unlike a
board worker report which does not advance the board fence — the two fences are proven to behave
oppositely on worker traffic in the same test file; `bindingFence(scope)` replays to the same
value by re-counting; concurrent binds to two different names in the same scope never spuriously
conflict (proving the CAS is per-binding-version, not per-scope-fence). **Projections:** a
binding read appends no ledger event; `ReplBindingProjection` is served from cache while the
scope's fence is unchanged and recomputed only on advance; a worker's view excludes another
worker's scope while including `shared`; `MAX_REPL_BINDINGS`/view byte and count ceilings are
honored with an explicit truncation story, never silent. **Citations:** `repl:<scope>:<name>@<n>`
resolves to the exact digest recorded at version `n`, never "latest"; a citation to a dropped
version still resolves; an unparseable or unknown citation is
`repl_binding_citation_not_found`; resolved citation content routes through the same
sanitization/provenance-marking discipline as board projections.

**REPL-3 — `cell:` refs:** a `cell:` branch naming a `completed` cell resolves at admission and
bakes the resolved `outputRef` coordinate into the `repl.manifest_admitted` payload; a `cell:`
branch naming an `admitted`(-only)/`failed`/`attention`/`stopped` cell is
`repl_manifest_cell_not_settled` and the admission event is never appended; a `cell:` branch
whose settled artifact fails reverification at the moment of admission is
`context_artifact_unavailable` and the admission event is never appended (not a poisoned
manifest); replay of an admitted `ReplManifest` reconstructs the identical resolved branch with
zero store lookups; a Program can never express a `cell:` ref (attempting one is rejected by
ordinary branch-name resolution, not by new evaluator code — proving the evaluator was never
touched); a later-lost artifact behind a resolved `cell:` branch settles a downstream reading cell
to `attention` (retryable) via the unmodified `settleFailure` path, never a hard `failed` and
never an admission-time re-check.

**Fold surface:** an unknown-kind event outside this set still throws `unsupported_event_kind`;
the checkpoint field-set change and the `_apply` change are proven to land together (an old-shape
checkpoint fails to load with `checkpoint projection is invalid` rather than silently
under-populating); a `repl.binding_set` admitted after its run's stop begins throws
`run_stopping`; the event-kind inventory test enumerates exactly the closed set including the two
new kinds.

## Part I — boundaries

Bindings are ledger state replayed from the log; no binding mutates content in place (immutable
versions only, rule 1-2). No reuse of the board fence or `FenceTable` for binding concurrency —
`bindingFence` is its own per-scope counter (Part C). No `repl.read` event kind — reads are
non-evented and cached (Part D). A worker never writes `scope: 'shared'` directly (Part B, rule
5); promotion is an orchestrator-authority rebind. `cell:` resolution never touches
`normalizeContextProgram`, `contextProgramPure`, or any evaluator op — it is exhaustively an
admission-time concern of REPL-1's authority path (Part F). No lazy/deferred `cell:` resolution
at read time — the coordinate is baked into the admission event or the admission never happens
(rule 19). No cross-run binding namespace (docs/33 §6 non-goal — project-persistent objects ride
the KG, docs/34); a `worker:<workerId>` scope and a `shared` scope both live under one
`ReplManifest`'s `runId`. No new Bench operators; the 14+4 whitelist stands (rule 21). No git
commits, no scratch/log writes anywhere (including /tmp).

## Part J — validation

Focused suite green, then the full suite `node impl/scripts/run-suite.mjs` green from the worktree
root; the wave-driver reviewer contract (`node --test impl/test/wave-driver-red.test.mjs`, exit 0)
stays green.
