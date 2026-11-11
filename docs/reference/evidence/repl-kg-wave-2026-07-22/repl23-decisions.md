# REPL-2 + REPL-3 decisions contract — named bindings and cell-as-source composition (v2)

Ground truth: docs/33 §3.2/§3.3 (docs/33-shared-objects-repl-layer.md:72-114), issues #22
(REPL-2) and #23 (REPL-3). Precedent: reflex2-boards-decisions.md Part B (board fence, F9) and
Part C (cached non-evented projections, F10); repl1-decisions.md Part B (`repl.manifest_admitted`
as the sole write-authenticated authority record — this contract's binding-authority story is
built directly on it, see Part B below). Code: the landed boards family in
`impl/src/coordination-store.mjs` (`_boardFences` map and its `_apply` maintenance
:7727-7755, `boardFence` :12057-12059, `postBoardItem`/`_boardSuccessor` content-digest
discipline :12061-12111, `requestBoardClaim` fence CAS :12142-12158, `boardSnapshot` non-evented
read :12201-12208, bound constants :285-291); the wrapper-binding pattern
(`coordinator.mjs:9153-9171`, `requestBoardClaim`/`submitBoardReport` force `owner: workerId`
from the caller's own handle, never a caller-supplied owner string — precedent for identity
provenance in general, but see Part B rule 5 for why bindings deliberately do NOT copy the
force-and-silently-rewrite half of this pattern); the cached per-worker projection
(`application.mjs:307-364` `projectBoardView`, cache key
`` `${board} ${role}:${workerId ?? ''} ${boardFence}` `` at :320, byte/count ceilings
`MAX_BOARD_VIEW_BYTES`/`MAX_BOARD_ITEMS` at :54-55 with the `boardViewTruncated` story at
:333, :357-360); the Bench's `outputRef` construction (`context-program.mjs:958-960`, the
completed-cell record `:989-1001`) and artifact ref shape (`normalizeContextArtifactRef`,
context-authority.mjs:142-155); the durable cell state machine (`context.cell_admitted` →
`admitted`, coordination-store.mjs:7332-7336; `context.cell_settled` → `completed`/`failed`/
`attention`/`stopped`, :7337-7351); the attention/retryable settlement rule
(`context-program.mjs:1259-1271`, full `settleFailure` :1255-1277); the global cell projection
(`contextCell(cellId)`, coordination-store.mjs:8071); the `admitContextCell` caller-principal
pinning (coordination-store.mjs:9017-9020, the auth field set `{actor,principalId,repoId,runId}`
built at :9010-9013); the fold-surface anchors (`PROJECTION_CHECKPOINT_FIELDS` :89-110, checkpoint
field-set validation :742-751, `unsupported_event_kind` terminal throw :8007, the run-stop guard
preamble in `_apply` :7195-7218, `snapshot()` :10341); repl1-decisions.md's `repl.manifest_admitted`
payload shape (`{schemaVersion, manifestDigest, runId, replRole, principal:{actor,principalId},
requestDigest}`, repl1-decisions.md:93-101) and its fold into `this._replManifestAdmissions`
keyed by `manifestDigest` (repl1-decisions.md:188-197).

This contract does not re-litigate docs/33 v2's settled decisions: `ReplManifest` is a second
manifest shape with its own `baton.repl_manifest` digest basis; bindings are per-scope-fenced,
not board-fenced; `cell:` branch refs resolve at `ReplManifest` admission, never inside the
evaluator. Those are REPL-1's contract (repl1-decisions.md, itself already red-team-corrected).
This document is the REPL-2 (bindings) and REPL-3 (`cell:` composition) implementation surface:
exact shapes, event payloads, admission order, error codes, bounds, replay semantics, the fold
surface, and the red-test list.

## v2 revisions

v1 was returned NEEDS REVISION (repl23-redteam.md). Every numbered finding is resolved below;
none are rebutted — every citation the report made was verified against the current tree and
held up.

- **P0-1** (binding identity has no run/manifest dimension): resolved. Binding identity/fences/
  history/citations are now `(runId, scope, name)`-tupled via JSON-encoded map keys (Part A rule
  1, Part C rule 7, Part G rule 22). `runId` is never caller-supplied — it is hub-derived at
  write-admission AND at fold time from a caller-cited `manifestDigest` looked up in REPL-1's own
  `_replManifestAdmissions` map (Part B rule 4). This deliberately does **not** adopt the report's
  literal suggestion that "REPL-1 enforces a singleton shared manifest per run" — repl1-decisions.md
  rule 9 explicitly allows more than one admitted manifest per `(repoId, runId)` (bounded by
  `MAX_REPL_MANIFESTS_PER_RUN`, not 1) — so "the governing record" is redefined as "whichever
  admitted record the write cites," each independently authority-checked at its own admission time
  (repl1-decisions.md rule 6/7), never a single run-wide singleton. Rule 25's run-stop derivation
  is now a direct map lookup, no ambiguity.
- **P0-2** (rule 19 records an `art:` handle where only `ctx:sha256:` can live): resolved. Part F
  rule 19 rewritten to record `branch.digest = outputRef.digest`, `branch.ref =
  ctx:sha256:<outputRef.digest>`, and pins the previously-unspecified `itemCount` (1, the
  envelope-as-one-item stance `normalizeContextSource` already takes for any non-array JSON value,
  context-program.mjs:574), `mediaType` (the exact `context_value` media type context-program.mjs:959
  already writes), and `summary` (hub-derived, never caller-submitted for a `cell:` branch).
- **P1-3** (citation grammar non-injective): resolved. `name`'s charset now excludes `:` (Part A
  rule 1); map keys are JSON-encoded tuples, not string concatenation (Part A rule 2, Part G rule
  22); the citation grammar's regex is corrected accordingly (Part E rule 14); a `:`-containing
  name is a red test (Part H).
- **P1-4** (divergent-replay idempotency overstated): resolved. Part B rule 6 now specifies the
  exact payload-comparison block (mirroring `admitContextCell`, coordination-store.mjs:8981-9000),
  replacing the false "every other admission path refuses divergent keys" claim — verified false:
  `_append` returns the prior event blindly (coordination-store.mjs:1030-1031) and the board write
  paths (`requestBoardClaim`/`submitBoardReport`, :12062-63/:12143-44) never compare either. A
  divergent-key red test is added (Part H).
- **P2-5** (store-level caller identity channel unspecified / silent scope retargeting): resolved.
  The manifestDigest-authority redesign for P0-1 makes this moot by construction: a caller citing
  a `manifestDigest` whose `replRole` disagrees with the target `scope`, or whose admitted
  `principal` disagrees with the caller's own authenticated identity, is refused loudly
  (`repl_binding_scope_manifest_mismatch` / `repl_binding_unauthorized`) — there is no
  wrapper-level "force the scope segment" step left to silently retarget anything (Part B rule 5).
- **P2-6** (sanitization red test near-vacuous): resolved. Part E rule 16 now specifies that
  `name`/`scope` — the attacker-influenced strings — route through the
  `boundedAttentionText`/`wrapProse` discipline when rendered in a view (mirroring
  application.mjs:340-341/:346), while keeping the correct half of v1's claim: a resolved
  `cellId`/digest is a closed hub-derived token, never itself wrapped as prose.
- **Minor cite drift** (v1's "does NOT bump" comments cited at :7743-7753): corrected to
  :7741/:7744-7748, the actual comment locations (Part C rule 7).
- **Verified sound, kept unchanged**: fence re-count matches `_apply` fold; checkpoint exact-match
  refuses old checkpoints; the `cell:` admission race holds; `_contextCells` never evicted;
  lost-artifact → attention/retryable; worker wrapper-binding precedent (coordinator.mjs:9153-9171);
  `unsupported_event_kind` throw (:8007).

## Part A — binding identity: immutable versions under `(runId, scope, name)` (REPL-2 core)

**Decision: immutable versioned bindings, content-addressed by the hub, never trusted from the
caller — and, as of v2, identified by `(runId, scope, name)`, never a bare `(scope, name)` pair.**
This is the same stance Part A of reflex2-boards-decisions.md takes for board items (itemDigest is
hub-recomputed, a caller-supplied mismatch is a loud refusal, never a silent overwrite) and for the
same reason: a citation (`repl:<scope>:<name>@<version>`, Part E) must bind a version whose bytes
cannot change under it — and, critically, a version whose identity cannot be confused with another
run's identically-named binding.

1. **`ReplBinding` shape.** Caller-submitted fields: `exact{ scope, name, bindingVersion: positive
   int, state: 'bound'|'dropped', cellId, bindingDigest, manifestDigest }`. `manifestDigest` is new
   in v2 (P0-1) — it names the `repl.manifest_admitted` record (repl1-decisions.md Part B) that
   authorizes this write; it is never itself part of the binding's persisted identity (rule 2
   below), only a per-write authorization credential. `scope` matches
   `^(shared|worker:[A-Za-z0-9._:-]{1,256})$` (mirrors `SAFE_BOARD_ID`/`SAFE_BOARD_OWNER` at
   coordination-store.mjs:285-286 for the charset, but the worker segment's length bound is now
   256 bytes — the real workerId grammar coordinator.mjs:9194 enforces
   (`/^[A-Za-z0-9._:-]+$/u`, ≤256 bytes) — not the 128-byte `SAFE_BOARD_ID` bound v1 borrowed,
   which could silently make a legitimately-long real workerId unrepresentable in REPL scope
   space). `name` is a SafeId ≤128 chars but with `:` excluded from its charset —
   `^[A-Za-z0-9._-]{1,128}$` — a deliberate divergence from the generic `safeId`/`SAFE_ID`
   discipline (context-program.mjs:148-152, :18, which permits `:`) made **because** `scope`'s own
   worker segment legitimately contains `:` (a real workerId can be `w-7:b:c`); if `name` could
   too, `repl:<scope>:<name>@<version>` would be non-injective (P1-3 — verified true against
   `SAFE_ID = /^[A-Za-z0-9._:-]+$/u`, context-program.mjs:18). Excluding `:` from `name` alone
   fixes this: the grammar's trailing `:<name>@<version>` segment is then the only colon-free,
   `@digits`-terminated tail in the string, so regex backtracking always finds the one true split
   (Part E rule 14) regardless of how many colons `scope`'s worker segment contains. `cellId` is
   the exact `cell:<sha256>` identity a `DurableContextSession.evaluate` call produced
   (context-authority.mjs:125 `` `cell:${...}` ``); the store never re-derives it, only validates
   the format and (rule 3) that it resolves. `bindingDigest = H(scope, name, bindingVersion, state,
   cellId)` — unchanged from v1, still hub-recomputed with the same delete-and-recompute
   discipline as `boardItemContentDigest` (coordination-store.mjs:303-307); a caller-supplied
   `bindingDigest` that disagrees is `repl_binding_digest_mismatch`, never a silent overwrite —
   the `board_item_digest_mismatch` stance, generalized. `runId` is deliberately **not** a
   caller-submitted field (see Part B rule 4) — it is hub-derived and appears only in the
   *persisted* record (below).
   **Persisted `ReplBinding` record** (what `_replBindings`/`_replBindingHistory` actually store):
   the caller-submitted fields above, minus `manifestDigest`, plus a hub-derived `runId` — the
   `runId` of the `repl.manifest_admitted` record the write cited, looked up once at admission
   time and frozen into the stored row (the same "enrich with server-computed fields not in the
   payload" pattern `admittedEvent`/`admittedAt` already use throughout `_apply`). `manifestDigest`
   itself is not retained in the persisted record — it was a one-time authorization credential for
   this write, not part of the binding's durable content; a later write to the same `(runId, scope,
   name)` may cite a *different* `manifestDigest` (e.g. the scope's manifest was re-admitted with
   more branches since the last write, or — for a `shared`-scope promotion — the orchestrator's own
   shared manifest, distinct from the worker's original manifest) without breaking continuity,
   because identity lives in `runId`, not in whichever manifest happened to authorize a given
   write.
2. **Two event kinds, both successor-versioning under the same `(runId, scope, name)`.**
   `repl.binding_set` mints `bindingVersion+1` with `state: 'bound'` and the new `cellId` (or
   `bindingVersion: 1` for the first bind — there is no separate "creation" event, unlike boards'
   `item_posted`/`item_retitled` split, because a binding has no owner/ordinal/title fields to
   distinguish creation from edit; a bind and a rebind are the same shape). `repl.binding_dropped`
   mints `bindingVersion+1` with `state: 'dropped'` and `cellId` carried forward unchanged (the
   last-bound digest stays part of the immutable record — a citation to the dropped version must
   still resolve, rule 10). Both are stored in a version history array (`_replBindingHistory`,
   mirroring `_boardItemHistory` at coordination-store.mjs:7729-7740) keyed by the JSON-encoded
   tuple `JSON.stringify([runId, scope, name])` — never string concatenation
   (`` `${scope}:${name}` ``, v1's map key, which collides whenever either segment contains `:`,
   and additionally pooled every run's `shared:x` binding into one slot, P0-1) — so every prior
   version replays exactly and two runs' identically-named bindings never share a slot; no field
   of an existing `(runId, scope, name, bindingVersion)` is ever mutated in place.
3. **Rebind/drop target must exist and (for rebind) must resolve.** `repl.binding_set` against an
   unknown `(runId, scope, name)` is a fresh bind (`bindingVersion: 1`); against a known one it
   requires the submitted `expectedBindingVersion` to equal the current version (else
   `stale_binding_version` — see rule 8 for why this is a version CAS, not a fence CAS) and the
   new `cellId` must resolve to a **completed** cell via the same global `contextCell(cellId)`
   projection REPL-3 resolution uses (coordination-store.mjs:8071; rule 11) — an admitted-but-
   unsettled or non-completed cell is `repl_binding_cell_not_settled`, the same settled-only
   stance as REPL-3 rule 9. `repl.binding_dropped` requires the binding to currently be `state:
   'bound'` (dropping an already-dropped binding is `repl_binding_not_bound`, not idempotent —
   idempotency is the `auth.key` replay path, rule 6, not a permissive no-op).

## Part B — authority: a write is only as good as the `repl.manifest_admitted` record it cites

**v2 rewrite (P0-1, P2-5).** v1's authority story ("shared-scope writes require the ReplManifest's
admission principal... equal to the authority that admitted the governing `repl.manifest_admitted`
record") assumed a single run-wide "governing" shared manifest that repl1-decisions.md does not
guarantee exists (its rule 9 permits multiple admitted manifests per `(repoId, runId)`, bounded by
count, not by uniqueness-per-role). v2 replaces "the governing record" with "the record the write
cites" — each admitted `repl.manifest_admitted` record was independently authority-checked at its
own admission time (repl1-decisions.md rule 6 for `shared`: orchestrator-lease-authenticated; rule
7 for `worker:<id>`: coordinator-wrapper-forced to the caller's own identity), so *any* currently
admitted record for the right `(runId, replRole)` is an equally valid authorization credential —
no singleton needed.

4. **A binding write is authorized by, and inherits its `runId` from, the `repl.manifest_admitted`
   record its `manifestDigest` names.** At admission the hub: (a) looks up `record =
   this._replManifestAdmissions.get(manifestDigest)` (repl1-decisions.md rule 14's fold target);
   absent → `repl_binding_manifest_unadmitted`. (b) Requires `record.replRole === scope` exactly —
   a write targeting `scope: 'shared'` must cite a record whose own `replRole` is literally
   `'shared'`; a write targeting `worker:<id>` must cite a record whose `replRole` is literally
   `worker:<id>`. Disagreement is `repl_binding_scope_manifest_mismatch` (this alone already
   prevents a worker from writing `scope: 'shared'` by citing its own worker manifest — docs/33
   §5's "a worker binds an intermediate in its own layer... the orchestrator promotes it shared
   with one rebind" still holds: promotion is a *new* `repl.binding_set` against `scope: 'shared'`
   citing the orchestrator's own shared `manifestDigest`, carrying forward the worker-bound
   `cellId`, never a worker-authored shared write). (c) Requires the caller's own authenticated
   identity to canonical-digest-equal `record.principal` — `canonicalDigest({actor: auth?.actor,
   principalId: auth?.principalId}) !== canonicalDigest(record.principal)` → `repl_binding_
   unauthorized` (mirroring `admitContextCell`'s exact-shape refusal at coordination-
   store.mjs:9017-9020, narrowed to the 2-field `principal` repl1-decisions.md:99 defines rather
   than the 4-field `{actor,principalId,repoId,runId}` context authority tuple at
   coordination-store.mjs:9010-9013, since that is what `repl.manifest_admitted`'s payload actually
   carries). Because a `worker:<id>`-role record's `principal` was itself wrapper-forced to that
   worker's own identity at manifest-admission time (repl1-decisions.md rule 7), this single check
   transitively re-derives "the caller is that same worker" — no *separate* scope-string comparison
   or wrapper-side forcing is needed or wanted here (see rule 5). (d) On success, `runId =
   record.runId` — never a caller-supplied field, never independently validated against anything
   else, simply taken from the cited record. This is also exactly the derivation Part G rule 25
   uses at replay/fold time, so admission-time and fold-time agree by construction.
5. **No wrapper-level scope-forcing — this is a deliberate divergence from `requestBoardClaim`'s
   owner-forcing (P2-5).** `requestBoardClaim`/`submitBoardReport` force `owner: workerId` from the
   caller's handle (coordinator.mjs:9153-9171) because `owner` is caller-convenience metadata on an
   already-fenced item — silently overwriting it is harmless. `scope` for a binding is different:
   it *is* the write's own routing/identity field. v1's design implicitly needed a wrapper to force
   the scope's `worker:<id>` segment to the caller's own resolved workerId, and the red-team
   correctly flagged that "forcing" a caller-submitted `scope: worker:someone-else` into
   `scope: worker:self` — rather than refusing it — would silently retarget a confused or buggy
   caller's write without ever telling it. v2 needs no such step: rule 4(b)+4(c) above already
   refuse any write whose declared `scope` and cited `manifestDigest` don't jointly resolve to the
   caller's own authenticated identity, loudly, by construction. A worker citing `scope:
   'worker:someone-else'` fails either 4(b) (if it cites its own manifest, whose `replRole` won't
   match) or 4(c) (if it cites someone else's manifest, whose `principal` won't match its own
   identity) — there is no code path that silently coerces the scope, so there is nothing left for
   a coordinator-layer wrapper to force. The wrapper's only remaining job is the ordinary
   auth-provenance one every coordinator method does: resolving `opts.actor`/the caller's own
   identity for the `_append` auth object (mirroring `requestBoardClaim`'s `{ actor: opts.actor ??
   'worker', key: opts.idempotencyKey }`, coordinator.mjs:9160).
6. **Idempotency follows the `admitContextCell`-style explicit payload-comparison block, not the
   bare `_append` key discipline (P1-4).** v1 claimed "the caller supplies `auth.key`... a replayed
   key with an identical bound request returns the prior event... a replayed key with a divergent
   request is a conflict refusal — the same shape every other admission path in this file uses" —
   verified false: `_append` itself does no comparison at all, it returns the prior event blindly
   on any key hit (`const prior = this._byKey.get(key); if (prior) return prior;`,
   coordination-store.mjs:1030-1031), and the board write paths inherit that blind behavior
   (`postBoardItem`/`requestBoardClaim`/`submitBoardReport`, coordination-store.mjs:12062-63,
   :12143-44 — each just returns `clone(prior)` on a key hit with no field check). The
   divergence-checking behavior only exists on the `context.*` admission paths, and it must be
   specified explicitly here, not assumed: `admitReplBinding`/`dropReplBinding` look up `prior =
   this._byKey.get(auth?.key)`; if present, they require `prior.kind` to match the event kind,
   `prior.actor === auth.actor`, and `canonicalDigest(prior.payload) === canonicalDigest(payload)`
   (the exact comparison shape `admitContextCell` uses at coordination-store.mjs:8988-8991,
   generalized to the binding payload) — a mismatch on any of these is `repl_binding_conflict`
   (mirroring `context_cell_conflict`), never a silent divergent-return. A matching key returns the
   prior event/projected binding as `{ ok: true, result: 'idempotent', ... }` (the
   `admitContextCell` idempotent-return shape, coordination-store.mjs:8995-9000).

## Part C — per-`(runId, scope)` binding fence: the deliberate divergence from the board fence

7. **`bindingFence(runId, scope)` counts every write to that run's scope — worker writes
   included.** This is the load-bearing difference from `boardFence`, and it must be implemented as
   a difference, not copied: `_boardFences` bumps ONLY on the five orchestrator-authority item
   transitions and explicitly does NOT bump on `board.claim_requested`/`board.claim_migrated`/
   `board.claim_expired` or `board.report_submitted` (coordination-store.mjs:7734, :7742 bump; the
   "does NOT bump"/"never bumps" comments live at :7741 and :7744-:7748 — **v1 cited :7743-7753,
   which is wrong; verified against the current tree, corrected in v2**) — because claim/report
   traffic is ephemeral coordination layered on top of an already-fenced item, and self-invalidating
   it would livelock N workers polling one board (F9). A binding has no such split: the binding
   **is** the versioned content a reader caches against, so the writer of ANY version — shared or
   worker-authored — must invalidate every reader's cache of that run's scope, or a stale
   projection would serve a superseded digest under a citation that has already moved on. So:
   `_replBindingFences` (a `Map<string, number>` keyed by `JSON.stringify([runId, scope])`, parallel
   to `_boardFences` at coordination-store.mjs:799 but tupled per v2's P0-1 fix rather than keyed by
   bare `scope`) increments on **both** `repl.binding_set` and `repl.binding_dropped`, for **every**
   scope including `worker:<id>` ones — there is no worker-traffic carve-out here, and no cross-run
   fence sharing either.
8. **Replay-derivable, not stored mutable state.** Exactly like `boardFence` (coordination-
   store.mjs:12057-12059: `this._boardFences.get(board) ?? 0`), `bindingFence(runId, scope)` is a
   pure re-count reconstructed by replaying `repl.binding_set`/`_dropped` events for that
   `(runId, scope)` in `_apply` — never a separately durable counter that could drift from the log.
9. **Rebind/drop use a version CAS, not a fence CAS.** Because every write bumps the scope fence
   (rule 7), a `boardFence`-style "CAS against the current scope fence" (mirroring
   `requestBoardClaim`'s `expectedBoardFence` check, coordination-store.mjs:12153-12154) would
   make concurrent binds to *different names in the same scope* spuriously conflict with each
   other. Concurrency control for a rebind is therefore keyed to the binding's OWN
   `expectedBindingVersion` (Part A rule 3), the same granularity `board.item_retitled`/`_reordered`
   use against `itemVersion`, not `boardFence` — the scope fence exists purely to invalidate read
   caches (Part D), never to gate writes.

## Part D — cached, non-evented projections (the F10 rule, per-`(runId, scope)`)

10. **No `repl.read` event kind; a binding read appends nothing to the ledger** — the same F10
    stance boards take (no `board.read` kind exists; `boardSnapshot` is pure, coordination-
    store.mjs:12201-12208 comment "Non-evented board read").
11. **`ReplBindingProjection` cached keyed by `(runId, scope, workerId, bindingFence(runId,
    scope))`**, recomputed only when that run's scope fence advances — the exact caching contract
    `projectBoardView` implements for boards (application.mjs:307-321: cache key
    `` `${board} ${role}:${workerId ?? ''} ${boardFence}` ``, `if (cache && cache.has(cacheKey))
    return cache.get(cacheKey)`), extended with the `runId` dimension (v2, P0-1) so two runs'
    identically-scoped views never collide in the cache either. A `replBindingSnapshot(runId,
    scope)` store method (the `boardSnapshot(board)` shape, taking `runId` as an explicit structural
    parameter — the same idiom `goalPlanRun(repoId, runId)`/`activeBoardClaims({workerId,taskId})`
    already use for scoping reads, never encoded into a string key) returns the current
    (non-evented) per-name view — active bindings only (`state: 'bound'`), one row per `name`
    keyed to its latest version — mirroring `boardSnapshot(board)`'s per-board indexed read
    (coordination-store.mjs:12203-12208), never a full claim/fact-style scan. A caller-layer
    `projectReplBindingView(snapshot, viewer, cache)` (mirroring `projectBoardView`,
    application.mjs:315-364) applies the visibility rule (rule 12) and bounds (rule 13) and is
    the cached, viewer-shaped read; its cache key becomes
    `` `${runId} ${scope} ${role}:${workerId ?? ''} ${bindingFence}` ``.
12. **Per-scope visibility.** A worker sees its own `worker:<id>` scope's bindings plus the
    `shared` scope (read-only from the worker's side), both within its own run; the orchestrator
    sees every scope in the run — the same split `projectBoardView`'s per-worker filter implements
    for boards (application.mjs:329-332: `role === 'orchestrator' || item.owner === workerId ||
    board === workerId`).
13. **Bounds.** `MAX_REPL_BINDINGS` per `(runId, scope)` (a store-side admission ceiling on
    distinct `name`s live in one run's scope — `repl_bindings_exhausted` when a fresh bind would
    exceed it), name ≤128 chars, colon-excluded charset (Part A rule 1). The projection gets its
    own byte ceiling `MAX_REPL_VIEW_BYTES`/an item-count ceiling, mirroring `MAX_BOARD_VIEW_BYTES`/
    `MAX_BOARD_ITEMS` (application.mjs:54-55) with an explicit `replBindingViewTruncated` flag —
    shed trailing entries and re-flag until under the byte ceiling, never a silent drop
    (application.mjs:356-360's loop is the exact shape to mirror).

## Part E — citation grammar: `repl:<scope>:<name>@<version>`

14. **Grammar (v2, P1-3 fix):** `` `repl:${scope}:${name}@${bindingVersion}` `` where `scope` and
    `name` are the exact validated strings from Part A rule 1 and `bindingVersion` is the decimal
    integer version being cited — parsed by a closed regex
    `^repl:(shared|worker:[A-Za-z0-9._:-]{1,256}):([A-Za-z0-9._-]{1,128})@([1-9][0-9]*)$`. The
    grammar deliberately carries **no** `runId` segment — unlike `scope`'s worker segment or `name`
    under v1's rules, `runId` itself permits `:` (`validRunId`, coordination-store.mjs:242:
    `/^[A-Za-z0-9._:-]{1,256}$/`), so folding it into the same colon-delimited string would
    reintroduce exactly the non-injective-grammar problem this rule just fixed for `name`. Instead,
    resolution takes `runId` as an explicit structural parameter (rule 15) — the same idiom
    `boardSnapshot(board)`/`goalPlanRun(repoId, runId)` already use, never string-embedded. Because
    `name`'s charset now excludes `:` (Part A rule 1) while `scope`'s worker segment may still
    contain it, the regex is unambiguous: greedy backtracking always resolves to the one split
    where the trailing `:<name>@<version>` segment — the only colon-free, `@digits`-terminated tail
    — starts at the *last* colon in the string, regardless of how many colons `scope` contains.
15. **Resolution is a named, non-evented read path, explicitly run-scoped — the same site that
    already renders board/report detail.** `projectBoardView` (application.mjs:315-364) is the
    precedent: a pure projection function, not a new ledger read. `resolveReplCitation(runId,
    citation)` (v2: `runId` is now a required first argument, P0-1) parses the grammar (rule 14)
    and looks up the **exact** `(runId, scope, name, bindingVersion)` row from
    `_replBindingHistory` (keyed by `JSON.stringify([runId, scope, name])`, Part A rule 2) — never
    "latest" for that name, even if a newer version exists. An unparseable citation, or one naming
    a `(runId, scope, name, bindingVersion)` triple that was never written for that run, is
    `repl_binding_citation_not_found` (typed, not a silent null); the citation resolves to the
    exact `cellId` recorded at that version regardless of whether the binding is presently `bound`
    or has since been `dropped` (Part A rule 2 — dropped bindings keep their history, they do not
    forget it). A resolving caller always already knows its own `runId` from its authenticated
    context (e.g. the run whose board/report the citation appears in) — resolution never needs to
    infer it from the citation text.
16. **Citations render through the same sanitization discipline as board content — but only where
    v1 mis-identified what actually needs it (v2, P2-6).** v1 claimed "resolved cellId/digest is
    never prose — nothing resolved needs `boundedAttentionText`" and pointed instead at
    `scope`/`name` as the attacker-influenced strings; the red-team confirmed this half was correct
    but the accompanying red test never exercised it (near-vacuous). v2 keeps the correct half —
    a resolved `cellId`/digest is a closed, hub-derived, fixed-shape token
    (`^cell:[a-f0-9]{64}$`) and must never itself be wrapped as untrusted prose — and makes the
    other half concrete and testable: whenever a resolved citation (or the binding's own `scope`/
    `name`) is rendered back into a projection view (e.g. `ReplBindingProjection`, or any board/
    report view that echoes a citation's `scope`/`name` alongside its resolved `cellId`), the
    `scope`/`name` strings route through the same `boundedAttentionText`/`SECRET_SHAPED_TEXT`/
    `wrapProse` untrusted-prose provenance marking `projectBoardView` already applies to
    `title`/`detail`/report bodies (application.mjs:340-341, :346, citing the F14 discipline at
    application.mjs:307-313) — because `name` in particular is a caller-chosen identifier that
    still flows into rendered views verbatim and is exactly the kind of attacker-influenced string
    F14 exists to cover. The resolved `cellId` sitting next to it in the same view is never wrapped.

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
19. **The resolved artifact coordinate — as a `ctx:sha256:` ref, never the symbolic `cell:` ref and
    never the `art:sha256:` handle verbatim — is what gets recorded (v2 rewrite, P0-2).** v1
    recorded `result.outputRef` verbatim as the branch coordinate, i.e. the `art:sha256:<digest>`
    handle `normalizeContextArtifactRef` produces (context-authority.mjs:142-155, `handle ===
    'art:sha256:' + digest`, verified at :149). But `manifestBranch` requires `ref` to match
    `SOURCE_REF`, `^ctx:sha256:([a-f0-9]{64})$` (context-program.mjs:19), AND `match[1] ===
    branchDigest` — an `art:` handle fails that pattern outright and normalization dies at
    manifest-build time; rule 20 itself already named `ctx:sha256:` correctly, contradicting rule
    19. v2's fix: on success, the hub takes the settled cell's `result.outputRef` (the shape
    `context-program.mjs:958-960` writes and `:989-1001`'s `completed` record carries, validated
    by `normalizeContextArtifactRef`), reverifies the artifact bytes through the identical reverify
    discipline `contextCellArtifacts`/`settleContextCell`'s completion path already use
    (coordination-store.mjs:8518-8534, :9088-9098: read via the injected context-reference reader,
    throw `context_artifact_unavailable` on missing/changed bytes — verified at :9094-9096, raised
    as a `CoordinationRefusal` before any event is written), and then constructs the branch entry
    as:
    - `digest = outputRef.digest` (the CAS digest of the cell's output JSON bytes — distinct from
      `cellId`'s own digest, which digests the cell's *admission core*, not its output bytes);
    - `ref = ` `` `ctx:sha256:${outputRef.digest}` `` (passes `SOURCE_REF` and satisfies
      `manifestBranch`'s `match[1] === branchDigest` invariant by construction, context-
      program.mjs:164-165 — the resolved branch is now structurally indistinguishable from an
      ordinary caller-submitted branch once baked into the manifest);
    - `itemCount = 1` — the settled cell's full output-value envelope
      (`{schemaVersion, kind:'baton.context_value', items, sourceBranches, sourceItems,
      selectedSourceItems, chunks}`, context-program.mjs:539-549) is a plain JSON object, not an
      array, and `normalizeContextSource` already treats any non-array top-level value as exactly
      one item (`const items = Array.isArray(normalized) ? normalized : [normalized];`,
      context-program.mjs:574) whenever this ref is later read through the ordinary source-reading
      path. REPL-3 does **not** unwrap `.items` out of the envelope into per-item branch entries —
      doing so would require evaluator/reader-side special-casing of `cell:`-resolved branches,
      which rule 21 explicitly forbids ("REPL-3 touches zero evaluator code"). A downstream Program
      reading this branch sees one opaque envelope item, and must `project`/`slice` into its
      `.items` field itself if it wants the individual results — exactly how it would have to treat
      any other single-object `ctx:sha256:` source today;
    - `mediaType = 'application/vnd.baton.context-value+json'` — reusing, verbatim, the exact
      constant `context-program.mjs:959` already writes for a `context_value` artifact, never a
      new invented media type;
    - `summary` — hub-derived and bounded (e.g. `` `resolved from cell:${digest}` ``), never
      caller-submitted for a `cell:`-typed branch entry: unlike an ordinary branch (where the
      caller supplies `summary`/`mediaType`/`itemCount` and the hub only validates them,
      `manifestBranch` context-program.mjs:159-181), a `cell:`-typed branch entry in the caller's
      submitted `ReplManifest` carries **no** `summary`/`mediaType`/`itemCount`/`digest`/`ref` at
      all — those five fields are entirely hub-computed at admission for this branch kind, per
      this rule.
    The reason the bytes actually resolve under the new `ctx:sha256:` ref: `_writeArtifact` (the
    Bench method that wrote the cell's output bytes under its `art:sha256:` handle) and
    `_readSource` (what any later `ctx:sha256:` branch read goes through) both resolve their path
    via the identical `this.artifactRoot` CAS root (`_writeArtifact`, context-program.mjs:652-686,
    vs `_readSource`, :634-649 — both do `resolve(this.artifactRoot, ` `` `${digest}.json` `` `)`)
    — so the exact same physical JSON file is addressable via either the `art:sha256:` handle
    (write-time) or a `ctx:sha256:` ref of the identical digest (read-time); recording `ctx:sha256:
    <outputRef.digest>` as the branch ref is therefore not a lossy re-encoding, it is the literal
    other name for the same bytes. On success, the resolved artifact coordinate (the four fields
    above) is written into the `repl.manifest_admitted` event payload as that branch's evented
    coordinate — so replay reconstructs the identical branch bytes with no store lookup, and the
    normalized `ReplManifest`'s own digest (which covers its resolved branches, per REPL-1's
    digest-basis discipline, repl1-decisions.md rule 4) is stable forever after. If reverification
    fails at this instant, admission refuses with `context_artifact_unavailable` — the event is not
    appended (same "never poisoned, only never-happened" stance as rule 18).
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

22. **`_apply` branches (v2: JSON-tuple keys, hub-derived `runId`).** Extend the same `_apply`
    if/else chain the board events already extend (coordination-store.mjs:7727-7755) with
    `repl.binding_set`/`repl.binding_dropped` cases — landed BEFORE the terminal
    `unsupported_event_kind` throw (coordination-store.mjs:8007) so an unhandled kind still fails
    loudly, never silently no-ops. Each branch: (a) derives `runId =
    this._replManifestAdmissions.get(p.manifestDigest).runId` — guaranteed present and already
    validated (Part B rule 4) by the time this event replays, because admission required the cited
    manifest to already be folded into `_replManifestAdmissions` *before* the binding event could
    ever have been appended, and replay processes events strictly in the same `seq` order they were
    appended in; (b) upserts `_replBindings.set(JSON.stringify([runId, scope, name]), record)`
    (current row per name, `record` including the hub-derived `runId` but never the write's
    `manifestDigest`, Part A rule 1); (c) appends to `_replBindingHistory` keyed the same way
    (mirrors `_boardItemHistory`, coordination-store.mjs:7729-7740); (d) bumps
    `_replBindingFences.set(JSON.stringify([runId, scope]), (get(...) ?? 0) + 1)` for **every**
    write regardless of scope kind (Part C rule 7 — the explicit divergence from the board `_apply`
    comment "Only the five orchestrator-authority transitions advance the board fence",
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
    has no `board`/`boards` key at all — verified; the only board read surface is the dedicated
    `boardSnapshot(board)` method at :12201-12208). Bindings follow the SAME non-exposure: no
    `snapshot().repl.bindings` dump (REPL-1 does add a `snapshot().repl.manifests` block,
    repl1-decisions.md rule 16 — that is REPL-1's own admitted-manifest list, not bindings, and
    this contract does not touch it), only the dedicated `replBindingSnapshot(runId, scope)` method
    (Part D rule 11) — a full ledger dump would defeat the fence-gated, per-`(runId, scope)`
    caching story (Part D) by paging in every scope's bindings on every snapshot call regardless of
    whether anything reads them.
25. **Run-stop guard preamble extension (v2: trivially well-defined, no lookup ambiguity).** The
    `_apply` preamble that derives `admittedRunId` and refuses effects admitted after their run
    began stopping (coordination-store.mjs:7195-7218) today recognizes
    `context.session_admitted`/`context.cell_admitted`/`context.call_admitted`/
    `context.call_settled` (deriving, e.g., `context.cell_admitted`'s runId via
    `this._contextSessions.get(p?.cell?.sessionId)?.runId`, :7207-7208) plus the goal/plan/task
    kinds and (once repl1-decisions.md lands) `repl.manifest_admitted` (`admittedRunId = p?.runId
    ?? null`, repl1-decisions.md rule 14) — it does NOT currently cover `board.*` kinds at all
    (boards have no run-stop guard in this preamble today — verified, no `board.*` branch exists
    in :7195-7218). `repl.binding_set`/`_dropped` MUST be added to this list:
    `admittedRunId = this._replManifestAdmissions.get(p?.manifestDigest)?.runId ?? null` — the
    exact same lookup Part B rule 4(d) performs at admission time, so there is no separate
    "governing record" concept to define here at all (v1's version of this rule needed one and
    could not produce it, P0-1) — so a binding write admitted after its run began stopping throws
    `run_stopping` (`CoordinationIntegrityError`, mirroring :7216-7218) exactly like a context cell
    admission does — REPL writes must refuse after stop begins, they must not silently land in a
    stopping run's namespace the way today's board writes apparently can.
26. **Event-kind inventory test.** Extend REPL-1's `impl/test/repl1-kind-inventory-red.test.mjs`
    with `repl.binding_set` and `repl.binding_dropped` in the closed kind set — repl1-decisions.md
    rule 17 already anticipates this exact growth ("the test is authored in REPL-1 and grows as
    REPL-2's `repl.binding_set`/`repl.binding_dropped` land"), so REPL-2 extends that file rather
    than authoring a parallel one, so an incomplete fold (an `_apply` branch, a checkpoint field, or
    the stop guard left un-updated) fails at test time rather than at replay.

## Part H — red tests first (`impl/test/repl23-bindings-red.test.mjs`)

**REPL-2 — bindings:** a fresh `repl.binding_set` citing a valid `manifestDigest` mints
`bindingVersion: 1`; a rebind against a correct `expectedBindingVersion` mints `bindingVersion+1`
and retains the prior version in history; a rebind against a stale `expectedBindingVersion` is
`stale_binding_version`; a submitted `bindingDigest` mismatch is `repl_binding_digest_mismatch`,
never a silent overwrite; a `repl.binding_set` naming a cell that is `admitted` (not yet completed)
or `failed`/`attention`/`stopped` is `repl_binding_cell_not_settled`; a `repl.binding_dropped`
against an already-dropped binding is `repl_binding_not_bound`.
**Authority (v2, P0-1/P2-5):** an unknown/unadmitted `manifestDigest` is
`repl_binding_manifest_unadmitted`; a `scope` that disagrees with the cited record's own
`replRole` (a worker citing its own manifest but targeting `scope: 'shared'`, or vice versa) is
`repl_binding_scope_manifest_mismatch`; a caller whose own authenticated identity disagrees with
the cited record's `principal` (a worker citing another worker's admitted manifest) is
`repl_binding_unauthorized`; a worker cannot write `scope: 'shared'` directly under any manifest it
could legitimately cite (proven via the scope-manifest-mismatch path, not a bespoke check); a
shared-scope promotion (citing the orchestrator's own shared `manifestDigest`, carrying forward a
worker-bound `cellId`) succeeds.
**Idempotency (v2, P1-4):** a replayed `auth.key` with an identical payload returns the prior event
as `idempotent`; a replayed `auth.key` with a divergent payload (different `cellId`, different
`scope`, etc.) is `repl_binding_conflict`, proving the store does NOT fall back to `_append`'s
blind-return behavior (coordination-store.mjs:1030-1031) the way board writes do.
**Cross-run isolation (v2, P0-1):** two different runs each bind `shared:x` — the two bindings
never collide in `_replBindings`/`_replBindingHistory`, a rebind CAS in one run never observes or
is blocked by the other run's version, and `bindingFence` for one run's `shared` scope is
unaffected by the other run's writes to its own `shared` scope.
**Fence divergence:** a worker-scope write DOES advance that `(runId, scope)`'s `bindingFence`,
unlike a board worker report which does not advance the board fence — the two fences are proven to
behave oppositely on worker traffic in the same test file; `bindingFence(runId, scope)` replays to
the same value by re-counting; concurrent binds to two different names in the same run's scope
never spuriously conflict (proving the CAS is per-binding-version, not per-scope-fence).
**Projections:** a binding read appends no ledger event; `ReplBindingProjection` is served from
cache while the `(runId, scope)`'s fence is unchanged and recomputed only on advance; a worker's
view excludes another worker's scope while including `shared`, both scoped to its own run;
`MAX_REPL_BINDINGS`/view byte and count ceilings are honored with an explicit truncation story,
never silent.
**Citations (v2, P1-3/P2-6):** `repl:<scope>:<name>@<n>` resolves (given the resolving caller's own
`runId`) to the exact digest recorded at version `n`, never "latest"; a citation to a dropped
version still resolves; an unparseable or unknown citation is `repl_binding_citation_not_found`; a
`name` containing `:` is rejected at bind time (never reaches the citation grammar at all) — the
grammar's own regex red test attempts a crafted `scope`+`name` pair that would have collided under
v1's rules (`scope: 'worker:w-7'`, `name: 'b:c'`) and proves it now parses unambiguously and that
`name: 'b:c'` itself is rejected at bind time (`safe_id`-style refusal) rather than silently
accepted and later misparsed; a rendered view wraps `scope`/`name` through
`boundedAttentionText`/`wrapProse` while leaving a resolved `cellId`/digest unwrapped, with a test
asserting both halves (not just one, per the P2-6 near-vacuous-test finding).

**REPL-3 — `cell:` refs (v2, P0-2):** a `cell:` branch naming a `completed` cell resolves at
admission and bakes `ref = ctx:sha256:<outputRef.digest>`, `digest = outputRef.digest`, `itemCount:
1`, `mediaType: 'application/vnd.baton.context-value+json'`, and a hub-derived `summary` into the
`repl.manifest_admitted` payload — never the `art:sha256:` handle verbatim; a Program `source` op
against the resolved branch successfully reads through the ordinary `_readSource`/
`normalizeContextSource` path and recovers byte-identical content to what the source cell
originally computed (proving the CAS-sharing claim empirically, not just structurally); a `cell:`
branch naming an `admitted`(-only)/`failed`/`attention`/`stopped` cell is
`repl_manifest_cell_not_settled` and the admission event is never appended; a `cell:` branch whose
settled artifact fails reverification at the moment of admission is `context_artifact_unavailable`
and the admission event is never appended (not a poisoned manifest); replay of an admitted
`ReplManifest` reconstructs the identical resolved branch with zero store lookups; a Program can
never express a `cell:` ref (attempting one is rejected by ordinary branch-name resolution, not by
new evaluator code — proving the evaluator was never touched); a later-lost artifact behind a
resolved `cell:` branch settles a downstream reading cell to `attention` (retryable) via the
unmodified `settleFailure` path, never a hard `failed` and never an admission-time re-check.

**Fold surface:** an unknown-kind event outside this set still throws `unsupported_event_kind`;
the checkpoint field-set change and the `_apply` change are proven to land together (an old-shape
checkpoint fails to load with `checkpoint projection is invalid` rather than silently
under-populating); a `repl.binding_set` admitted after its run's stop begins throws `run_stopping`
(derived via the `_replManifestAdmissions` lookup, Part G rule 25); the event-kind inventory test
(`impl/test/repl1-kind-inventory-red.test.mjs`, extended per Part G rule 26) enumerates exactly the
closed set including the two new kinds.

## Part I — boundaries

Bindings are ledger state replayed from the log; no binding mutates content in place (immutable
versions only, Part A rules 1-2). No reuse of the board fence or `FenceTable` for binding
concurrency — `bindingFence` is its own per-`(runId, scope)` counter (Part C). No `repl.read` event
kind — reads are non-evented and cached (Part D). A worker never writes `scope: 'shared'` directly
(Part B, rule 4(b)); promotion is an orchestrator-authority rebind citing the orchestrator's own
shared `manifestDigest`. No wrapper-level "force the scope" step (Part B rule 5, a deliberate
divergence from `requestBoardClaim`'s owner-forcing — scope is identity, not caller-convenience
metadata, so a mismatch is refused, never silently coerced). No cross-run binding namespace
(docs/33 §6 non-goal — project-persistent objects ride the KG, docs/34): enforced structurally, not
by convention — binding identity, fence keys, and cache keys are all `(runId, scope, ...)`-tupled
via JSON-encoded keys, and `runId` is always hub-derived from a validated `repl.manifest_admitted`
lookup, never caller-supplied (Part A rule 1, Part B rule 4, Part G rule 22); a `worker:<workerId>`
scope and a `shared` scope both live under one run's namespace, never shared across runs. `cell:`
resolution never touches `normalizeContextProgram`, `contextProgramPure`, or any evaluator op — it
is exhaustively an admission-time concern of REPL-1's authority path (Part F). No lazy/deferred
`cell:` resolution at read time — the coordinate is baked into the admission event as an ordinary
`ctx:sha256:` branch, or the admission never happens (Part F rule 19). No new Bench operators; the
14+4 whitelist stands (Part F rule 21). No git commits, no scratch/log writes anywhere (including
/tmp).

## Part J — validation

Focused suite green, then the full suite `node impl/scripts/run-suite.mjs` green from the worktree
root; the wave-driver reviewer contract (`node --test impl/test/wave-driver-red.test.mjs`, exit 0)
stays green.
