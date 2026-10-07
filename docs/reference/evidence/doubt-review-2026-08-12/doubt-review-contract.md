# Issue #66 — the doubt review path contract (v1.1)

The implementation contract for issue #66: **doubts die with the task partition — the KG
settlement v1 deliberately doesn't elevate them.** It specifies behavior; it does not amend
implementation in this artifact. It is a Ring-2 contract (ground truths → decisions → refusal
vocabulary → red-first acceptance → open questions). It cross-references — it does not re-specify —
#33 (the scratchpad machinery, `docs/reference/evidence/scratchpad-2026-07-23/scratchpad-decisions.md`),
#63 (the KG settlement ritual, `kg-settlement-decisions.md`), #79 (the worker-delivery push lane,
`docs/reference/evidence/worker-delivery-push-2026-08-07/worker-delivery-push-contract.md`), the KG
taxonomy (docs/34; `kg-activation-decisions.md`; phases 49/53 handoffs), and the A6 silent-sink
ruling (`docs/reference/evidence/kg-settlement-2026-08-01/redteam-lifecycle.md` Attack 6,
`:354-400`).

**Fold note (v1.1).** This draft folds the #66 red-team report (`contract-redteam.md`, same dir —
NOT FOLD-READY, 7 numbered blockers in §E) into v1.0. The shape decision — composition of (b)
`knowledge.promote_doubt` + the durable doubt record, on the D4 selection change — survives; the
fold is in the seams: the settle-ritual ordering (raise before sweep, widened carry predicate), the
`promote_doubt` lease re-derivation (the #73 forge class), the `view.open_doubts.bytes` bound, the
queryable surface's orchestrator gate, the shared-ceiling sub-cap, the answer-push v1 honesty, and
the resolution-prose `wrapHubDerived` framing — plus the open-question re-adjudication (OQ4
qualified) and every citation fix (M1/M2/M3/M5/M7/M8). The blocker → change map is
`contract-fold.md` (same dir).

- **Date:** 2026-08-12
- **Status:** DRAFT v1.1 — implementation contract (folded from the #66 red-team report).
- **Verification HEAD:** `faf4e06d35bba2d1ea53d9d32e3c6d48ff97ee23` ("Baton private effective-tree
  snapshot"), the tree v1.0 was verified against. The red-team re-verified every `file:line`
  citation at the current HEAD (`ac92335d9d85de777edbb8cfe67af00c5f10915f`, the Baton private
  effective-tree snapshot) with `grep -an`/`sed -n`; `git diff` over `impl/src` between the two
  HEADs is **empty**, so every line number survives the snapshot bump. The brief's "two NUL files" —
  `impl/src/application.mjs` and `impl/src/coordination-store.mjs` — are cited only at
  grep/sed-verified points, never whole-file reads; every anchor in `impl/src/wave-driver.mjs`,
  `impl/src/coordinator.mjs`, `impl/src/application-semantics.mjs`, `impl/src/messages.mjs`, and
  `impl/src/limits.mjs` was likewise grep/sed-verified (with `limits.mjs` also whole-file read — it
  is 131 lines and reads clean).
- **Brief:** `contract-66-brief.md` (same dir) — read in full; the issue body (`gh issue view 66`)
  could not be fetched (`gh` is not authenticated in this worktree — the same constraint the #70
  and #105 contracts record). The requirements are carried by the brief and the read-order below.

**Read-order executed.** (1) this brief; (2) the A6 silent-sink receipt it cites
(`redteam-lifecycle.md:354-400` — verdict NEEDS-AMENDMENT, the three candidate shapes (a)/(b)/(c)
at `:388-397`); (3) the #63 settlement ritual (`kg-settlement-decisions.md` — D2 admission gate
`_activeRunOrchestratorLease`, D3 settle-window hook, D4 elevation selection); (4) the scratchpad
machinery (`scratchpad-decisions.md` — the doubt entry grammar rule 6, the shared-partition
visibility rules 2/16, the no-bridge-fact-for-doubt rules 19/21, the settled-entries disposition
rules 19-23); (5) the KG taxonomy + contradiction workspace (docs/34; `kg-activation-decisions.md`;
`docs/handoff/evidence/phase49-cairn-selective-promotion-2026-07-13.md`;
`docs/handoff/evidence/phase53-cairn-contradictions-2026-07-13.md`); (6) the #79 delivery lane
(`worker-delivery-push-contract.md` v1.1 — D3 push-qualified kinds, D4 receipts, D5 dedup keys,
D8 frames); (7) the shipped machinery at the verification HEAD (`coordinator.mjs` `settlementLease`,
`coordination-store.mjs` `elevateTaskScratchpad`/`settleWorkflowScratchpad`/`sweepSettlementLeases`,
`wave-driver.mjs` the settle-window hook, `application.mjs` the doubt projection).

Scope of the rung, in one sentence: **an elevated doubt becomes a durable, queryable, reviewed,
answerable record — a doubt raised into the review surface at the settle ritual, resolved by an
explicit orchestrator command distinct from Finding admission, carried into the project's doubt
surface if unanswered at the review boundary, and armed for push back to its worker when answered
(delivered-when-recovered) — never a silent sink and never an auto-candidate into the Finding
graph.**

---

## Ground truths (code-verified at the verification HEAD)

**GT1 — Doubts die with the task partition: the shipped ritual elevates exactly `note` and
`plan`, and doubts are dispositioned away.** `coordinator.settlementLease` derives each member's
elevation selection from the worker scope filtered to `entry.kind === 'note' || entry.kind ===
'plan'` (`coordinator.mjs:11513`). The task-settle reap then dispositions every unselected row
`not_elevated/orchestrator_skipped` (`coordination-store.mjs:14302-14304`). A doubt's content
therefore survives only in the immutable `scratchpad.entry_written` ledger event inside the reaped
worker partition; no surface queries it. This is lifecycle A6's silent sink, re-anchored at the
post-#63 tree: the v1 D4 decision (`kg-settlement-decisions.md:103-110`) skipped doubts, and the
shipped ritual keeps that skip.

**GT2 — The elevation machinery mints a scratch-fact for notes only.** In
`coordination-store.elevateTaskScratchpad`, `if (source.kind === 'note')` builds the
`scratch.fact_posted` bridge (`coordination-store.mjs:14257-14271`); every other kind carries
`scratchFactId: factPayload?.id ?? null` (`:14278`). A doubt elevated to shared is therefore
factless — no `_scratchFacts` row, no fact-based horizon/`readScratch` projection — exactly A6's
"copied to the shared partition, no scratch-fact" (`redteam-lifecycle.md:370-374`). Note: the
shared *entry itself* is still rendered to the orchestrator's scratchpad projection (GT5), so
elevating doubts is visibility-sufficient without a fact.

**GT3 — The workflow-settle disposition has no doubt state.** `settleWorkflowScratchpad`
dispositions every shared row by kind: notes → `not_eligible/min_readers`, everything else →
`not_eligible/type_ineligible` (`coordination-store.mjs:14360-14364`). There is no disposition that
records a doubt's review outcome; a doubt's honest fate would have to live elsewhere.

**GT4 — The ritual's receipt carries candidacy, not doubts.** The wave receipt/outline folds
`knowledge.candidates / admittedThisRun / candidatesAwaitingAdmission / settlementRunId`
(`wave-driver.mjs:830-837`), and the settlement command returns
`candidatesAwaitingAdmission: elevatedNotes.length` (`coordinator.mjs:11580`). There is no
`openDoubts` field anywhere on the review surface.

**GT5 — Candidacy is note-only and the taxonomy boundary is structural.** The ritual posts board
items only for elevated notes (`coordinator.mjs:11522-11525` collects notes from the shared
partition; `:11567-11576` posts `board.candidacy:<waveId>:<sharedEntryId>` items) — a doubt never
posts a board item. And `_deriveKnowledgePromotion` filters scratch facts by `fact.grounding !==
'observed'` and never sees doubt entries (`coordination-store.mjs:15901`); a doubt has no bridge
fact, so it cannot enter the Scratch→KG promotion path by construction (scratchpad rules 19/21:
rule 19 gives `plan`/`doubt`/`link` `scratchFactId: null` — "none is itself a Finding";
rule 21 keeps `_deriveKnowledgePromotion` re-deriving only from scratch facts/read receipts, never
an independently assembled candidate set). A doubt is `not_eligible/type_ineligible` at workflow
settle (`:14363`) — never auto-candidacy.

**GT6 — The #79 delivery lane is specified but not landed.** The provider-facing delivery seam
`_providerBrief` is at `coordinator.mjs:3790`; the `## Pending attention` block, the
`attention.pushed` receipt, the push-qualified-kind rules, and the `view.attention_push.*` frame
rows are specified in the #79 contract (v1.1, 2026-08-07) and are not yet in this tree (`limits.mjs`
has no `view.attention_push.*` rows; no `_pendingAttentionPush` exists). The doubt-answer push
composes with that contract: this rung pins the doubt-side coordinates; the delivery mechanism is
#79's lane.

**GT7 — Worker doubt prose is already UNTRUSTED-framed at the scratchpad projection.** Doubt
`question`/`context` render as `{worker, text, provenance: 'model-authored', untrusted: true}` via
`scratchpadProse(workerId, boundedAttentionText(text))` (`application.mjs:726-728`) in
`projectScratchpadContent` (`application.mjs:745-748`). The `Prose` shape and the F14
sanitization/provenance discipline are #33 rules 16-17. Any new doubt surface inherits the same
closed frame.

---

## The shape decision — a composition of (b) + a durable doubt record, on a D4 selection change

The brief asks for a pick among (a) a doubts board, (b) a `knowledge.promote_doubt` command
distinct from Finding admission, and (c) a non-admission scratch-fact with grounding
`open_question`, or a composition, against the honesty test: **queryable, reviewed, answerable,
never a silent sink, never auto-candidacy.**

**Chosen: (b) as the authority, plus a durable doubt record (the ledger) as the queryable/review
surface, riding a D4 selection change that elevates doubts.** This is the composition that meets
all five honesty-test clauses with the least new surface.

- **(a) — REJECTED.** The board is the candidacy substrate: board items feed
  `finding:board-close:*`, and the sweep retires open board items as un-admitted candidates
  (`coordination-store.mjs:12556+`, the `board.candidacy.retire` close). A doubts board would put
  open questions on the candidacy path — exactly the taxonomy boundary the brief forbids — or
  require a parallel "board item that never candidates" semantic that duplicates the ledger this
  rung builds. Board items post-and-close; they do not model the open → reviewed →
  answered/dismissed/carried lifecycle.
- **(c) — REJECTED as the substrate.** The shared successor entry already gives horizon
  visibility to the orchestrator (GT5; the scratchpad projection renders doubt question/context,
  `application.mjs:745-748`). A scratch-fact with `grounding: 'open_question'` would additionally
  surface the doubt in the knowledge-recall lane (`readScratch` returns recallable knowledge, not
  open questions — a semantic mismatch), and while `_deriveKnowledgePromotion`'s
  `grounding !== 'observed'` filter would already keep it out of promotion (`coordination-store.mjs:15901`),
  the fact adds nothing the shared entry does not already provide. The taxonomy boundary is
  preserved structurally by the no-bridge-fact rule (GT5) without carving an exception.
- **(b) — CHOSEN as the authority.** `knowledge.promote_doubt` is the orchestrator's explicit
  review act, distinct from `knowledge.promote`/Finding admission — the "command distinct from
  Finding admission" shape, with the same session-bound lease gate (#63 D2 XB) as the review
  window.
- **+ the durable doubt record (the ledger) — the queryable/review surface the brief demands.**
  Three new `knowledge.doubt_*` event kinds in the existing coordination ledger, replay-derived,
  project-persistent, UNTRUSTED-framed. The ledger is what makes doubts queryable ("what doubts are
  open across this wave/project?"), reviewed (the settle ritual raises and surfaces them), and
  carried (project-persistent when unanswered) — none of which a bare command or a fact provides.

---

## Decisions

### D1 — Elevation: doubts elevate to shared (the D4 selection change)

`coordinator.settlementLease`'s per-member selection gains `doubt`:
`entry.kind === 'note' || entry.kind === 'plan' || entry.kind === 'doubt'`
(`coordinator.mjs:11513`). The store's `elevateTaskScratchpad` already elevates any selected
source into a shared successor with `scratchFactId: null` for non-notes
(`coordination-store.mjs:14273-14279`) — no store change is required for the shared entry itself.
Consequences, pinned:

- A doubt's task-settle disposition is `result:'elevated', reasonCode:'selected'` with the shared
  successor as `targetId` under a driven selection — never `orchestrator_skipped`
  (`coordination-store.mjs:14296-14305`); a no-driver run dispositions it `not_elevated/no_driver`
  like every other unselected row (the rule-20 fallback, `coordination-store.mjs:14304`) — the
  same honest degenerate receipt notes/plans get, not a new sink (M8).
- The shared successor carries `scratchFactId: null` (GT2) — no bridge fact, so the taxonomy
  boundary holds structurally (GT5). A doubt is visible to the orchestrator's scratchpad
  projection as a `{kind:'doubt', question, context}` shared entry (GT7).
- The shared-partition ceiling `MAX_SCRATCHPAD_SHARED_ENTRIES` (512, scratchpad rule 8) is the
  per-wave shared resource bound. Because doubts now share the pool, the elevation batch is
  prevalidated as a whole against the ceiling (rules 19/20 — `scratchpad_partition_exhausted`
  before any successor/fact/reap), so a doubt-heavy member would starve its own notes through the
  shared ceiling. Pin a derived sub-cap that keeps the non-doubt path byte-identical to v1.0:
  within the 512, doubts ≤ **384** and notes+plans ≥ **128** (a 3:1 reservation derived from the
  existing ceiling — never a new arbitrary cap; HOLE-5).
- The direct `scratchpad.elevate` command may also select doubts; whether a doubt is *raised into
  the review surface* is a ritual act (D2), not an elevation side effect — a doubt elevated by a
  direct command is visible in shared and is raised by the ritual's raise scan (D2), which runs
  before the sweep and only for its own wave; a post-ritual direct elevation is not raised by any
  later ritual (OQ4).

### D2 — The durable doubt record + lifecycle

A doubt record is a durable, replay-derived row in the coordination store, minted by the settle
ritual (`coordinator.settlementLease`), not by generic elevation. Three new event kinds, each
folded, checkpointed, and inventory-listed exactly as #33's scratchpad kinds are
(`scratchpad-decisions.md` rules 10-11): each `knowledge.doubt_*` kind joins the folded
`knowledge` map the store exposes through `snapshot()` — the folded map + the
`PROJECTION_CHECKPOINT_FIELDS` extension + the `snapshot()` exposure + the event-kind inventory
addition, the same four seams #33 rule 11 pins for its scratchpad kinds (M5). The projection is
the folded map, never a ledger scan — rule 11 forbids a fold that scans the whole ledger.

**`knowledge.doubt_raised`** — minted for every `kind:'doubt'` entry the ritual finds in a
member's shared partition (`coordinator.mjs:11522-11526` is the scan site; it currently reads
only `note`). The full worker frame is resolved from the shared successor at raise time and
recorded verbatim (the record is self-contained and replay-derived; the source partition may be
reaped later). Payload fields, literal order:

```js
{
  schemaVersion: 1,
  doubtId,          // doubt:<sha256> derived from {schemaVersion, runId, sharedEntryId,
                    //   sourceEntryId, sourceEntryDigest} — stable across re-drive
  runId, waveId, taskId, workerId,
  sourceEntryId, sourceEntryDigest, sharedEntryId,
  question, context   // bounded worker prose (question ≤ 1,024 B, context ≤ 2,048 B — the #33
                      // rule-6 admission bounds); UNTRUSTED-framed at projection (GT7)
}
```

Idempotency key pinned to `` `knowledge.doubt_raised:${waveId}:${sharedEntryId}` `` — a re-drive
replays exactly. `waveId` is the ritual's waveId; `taskId`/`workerId` resolve from the member run
(`coordinator.mjs:11509-11511`); `question`/`context` resolve from the shared successor's content.

**`knowledge.doubt_resolved`** — minted by `knowledge.promote_doubt` (D4). Payload fields,
literal order:

```js
{
  schemaVersion: 1,
  doubtId,
  disposition: 'answered' | 'dismissed',
  resolution: null | <orchestrator hub prose, ≤ 4,096 B — the doubt.resolution.bytes row,
    wrapHubDerived-framed at projection: {worker, text, provenance: 'hub-derived', untrusted: true}
    (HOLE-7); never 'model-authored', never 'hub-computed'>,
  dismissalReason: null | 'deferred' | 'duplicate' | 'out_of_scope' | 'unfounded',
  answeredBy: 'orchestrator',
  pushRequested: boolean   // true iff answered — the #79 push seam (D6)
}
```

Idempotency key pinned to `` `knowledge.doubt_resolved:${doubtId}` `` — the same request replays
exactly; a changed request conflicts.

**`knowledge.doubt_carried`** — minted by the sweep (D5) when a wave's review window expires with
an open doubt. Payload fields, literal order:

```js
{
  schemaVersion: 1,
  doubtId,
  carriedBy: 'review_window_expired',
  carriedSeq   // the event's own seq
}
```

Idempotency key pinned to `` `knowledge.doubt_carried:${doubtId}` ``.

**The derived state machine** (each state receipted and replay-derived from the ledger; no clocks):

- `open` — a `kind:'doubt'` entry in a live worker partition, not yet raised. Visible via the
  scratchpad projection (#33 rule 16 / GT7) — the wave driver already sees these in
  `wave.progress().members[i].scratchpad`.
- `reviewed` — `knowledge.doubt_raised` exists; the doubt has been elevated into the shared review
  surface and surfaced to the orchestrator. This is the interval the settle ritual reviews.
- `answered` / `dismissed` — `knowledge.doubt_resolved` exists with the respective `disposition`.
- `carried` — `knowledge.doubt_carried` exists; the doubt is project-persistent.

The state is the latest event for the `doubtId` (raised → resolved → carried), never a caller
field. The `knowledge.doubts` projection (D3) renders `reviewed`/`answered`/`dismissed`/`carried`
records; `open` worker-partition doubts stay on the scratchpad projection.

**No stateless gap (HOLE-2).** There is no undefined state between `open` and `reviewed`: a
`kind:'doubt'` shared successor with no `doubt_raised` is a *receipted contradiction*, not a
state. The ritual ordering (D5 — elevate → raise → sweep) guarantees every elevated doubt is raised
before the sweep runs, so the only elevated-but-unraised doubts the sweep can meet are the
raise-refused/errored cases and post-ritual direct elevations — each closed by the sweep's widened
carry step, which mints `doubt_raised` (if absent) + `doubt_carried` together when the wave's
settlement lease is revoked (D5). No path leaves a doubt with only an unqueried
`scratchpad.entry_elevated` event.

### D3 — The queryable review surface: `knowledge.doubts` + `knowledge.openDoubts`

**The read.** New embedded-only, orchestrator-addressed observe row `knowledge.doubts` on the
application-semantics registry (kernel profile, observe effect, embedded surface only — the genuine
embedded-only precedent is `board.claim`/`board.report` at `application-semantics.mjs:1418-1439`;
the settlement rows are `surfaces: ['embedded', 'mcp']` and `baton_knowledge_settlement_lease` is a
live MCP tool gated by a settlement capability class, `mcp-northbound.mjs:108/:138/:613`, so they
are NOT the embedded-only precedent — the v1.0 justification is corrected here (M1); the
embedded-only design of the doubt rows is unchanged). Input `{waveId?, state?, before?, limit?}`,
output the bounded doubt records with their frames:

```js
{
  runId, waveId,
  doubts: [{
    doubtId, state,           // reviewed | answered | dismissed | carried
    runId, waveId, taskId, workerId,
    question: Prose,          // wrapProse — {worker, text, provenance: 'model-authored', untrusted: true}
    context: null | Prose,
    resolution: null | Prose, // wrapHubDerived — {worker, text, provenance: 'hub-derived', untrusted: true}
    dismissalReason: null | 'deferred' | 'duplicate' | 'out_of_scope' | 'unfounded',
    raisedSeq, resolvedSeq, carriedSeq   // null until the transition exists
  }],
  nextBefore,               // keyset continuation; the exact doubt-surface predicate is spelled out below
  openDoubtsTruncated
}
```

- Sorted by `(raisedSeq DESC, doubtId ASC)` using the existing `compareCanonicalStrings` comparator
  (the `coordination-store.mjs:17` import family) — no `localeCompare` anywhere. The keyset
  predicate for `before`/`limit` is spelled out, not deferred: `raisedSeq < c || (raisedSeq === c
  && doubtId > d)` for a cursor `{c, d}` — the doubt surface's own predicate, adapted from (not
  identical to) #33 rule 15's `(createdEvent, entryId)` keyset (M7).
- Bounded by two new `FRAME_LIMITS` rows (D7), shed-flagged, never silent truncation of a row; one
  answered record renders inside the `view.open_doubts.bytes` = 8192 bound (D7, HOLE-1).
- `waveId` absent = the project surface across waves; `state` filters the derived state.
- **Authorization (pinned, HOLE-4).** The orchestrator gate is a mechanism, not a declaration. A
  `waveId`-named read requires the caller to hold the active run-orchestrator lease for that run
  (the D4 server-side lease re-derivation, `coordinator.mjs:11552-11559`); the project surface
  (`waveId` absent) requires the deployment's top-level orchestrator principal — the same
  server-derived authority the settlement rows use. The row is dispatched through a direct-port
  branch in `application.command`'s hardcoded if-chain (the settlement-branch shape at
  `application.mjs:12493-12495` — the dispatch does not auto-route registry rows), and
  `doubt_surface_unavailable` fires exactly when neither authority holds or the wave is unknown.
- **A record's prose renders UNTRUSTED-framed (GT7, HOLE-7):** the doubting worker's `question`/
  `context` wrap via `wrapProse` — `{worker, text, provenance: 'model-authored', untrusted: true}` —
  and the orchestrator's `resolution` wraps via `wrapHubDerived` — `{worker, text, provenance:
  'hub-derived', untrusted: true}` (the #79 hub-prose constructor; a resolution is never
  `model-authored` and never `hub-computed`). Never a raw string.

**The count.** The ritual's receipt and the wave receipt/outline gain `knowledge.openDoubts` — the
count of `reviewed` doubts for the wave — zero as `0`, never missing, mirroring
`candidatesAwaitingAdmission` (`wave-driver.mjs:830-837`; `coordinator.mjs:11580`). The
`knowledge.settlement_lease` command returns `openDoubts: <count>` alongside
`candidatesAwaitingAdmission`.

### D4 — `knowledge.promote_doubt`: the answer/dismiss authority (shape (b))

New embedded-only kernel command row `knowledge.promote_doubt` on the application-semantics
registry, distinct from `knowledge.promote` (Finding admission). Input
`{runId, doubtId, disposition, resolution?, dismissalReason?}`; `serverDerived:
['actor', 'principalId', 'sessionId']`; `authorityFields: ['runId', 'doubtId', 'disposition']`;
`liveMethod: 'resolveDoubt'`. **The lease is never a caller field (HOLE-3):** the active
run-orchestrator lease for the `runId`'s settlement task is re-derived server-side from the calling
session — the same leaseId derivation `settlementLease` already pins
(`coordinator.mjs:11552-11559`) — and `principalId`/`sessionId`/`sessionAuthorityDigest` are
validated against it, mirroring `knowledge.promote`'s `serverDerived`/`authorityFields` discipline
(`application-semantics.mjs:1512-1514`).

`coordinator.resolveDoubt(runId, doubtId, disposition, session, {resolution, dismissalReason})`:

1. **The review-window gate.** Re-derives the active run-orchestrator lease for the `runId`'s
   settlement task server-side (the `settlementLease` leaseId derivation,
   `coordinator.mjs:11552-11559`) and enforces the same #63 D2 XB semantics `admitWorkflowFinding`
   pins (expiry, parent-task liveness, and the `principalId`/`sessionId`/`sessionAuthorityDigest`
   session binding; the store gate at `coordination-store.mjs:16207`, the session binding at
   `:16228-16251`, the coordinator wrapper at `coordinator.mjs:11428-11430`). A
   revoked/expired/foreign-session lease fails with the typed lease code before any effect. The
   review window is the settlement lease's active lifetime — no new clock.
2. **Closed-input validation.** `disposition: 'answered'` requires a non-empty bounded
   `resolution`; `'dismissed'` requires a `dismissalReason` from the closed enum
   `['deferred','duplicate','out_of_scope','unfounded']`. Malformed or missing fields fail typed.
   `resolution` is orchestrator-authored hub prose, bounded by the `doubt.resolution.bytes` row
   (D7), framed with `wrapHubDerived` at projection — `{worker, text, provenance: 'hub-derived',
   untrusted: true}` per #79; it is never `model-authored` and never `hub-computed` (HOLE-7).
3. **State guard.** The `doubtId` must resolve to a raised doubt in state `reviewed`. An
   already-resolved/carried doubt or an unknown `doubtId` fails typed (`doubt_promote_unknown` /
   `doubt_promote_stale`) — never a silent no-op. An expired review window is the step-1 lease
   gate's typed code, never `doubt_promote_stale` (M3).
4. **The receipted transition.** Mints `knowledge.doubt_resolved` (D2). If `answered`, sets
   `pushRequested: true` — the #79 push seam (D6). **No Finding, no KG node, no board item, no
   `knowledge.workflow_admitted`, no scratch-fact** — the taxonomy boundary is structural.

### D5 — The settle composition: elevate → raise → sweep, never silently dropped

At the settle ritual (`coordinator.settlementLease`), in order — **raise runs BEFORE the sweep**,
so an elevate-without-raise cannot escape receipt (HOLE-2):

1. **Elevate** (D1): note+plan+doubt, within the derived sub-cap (D1).
2. **Raise** (D2): scan each member's shared partition; mint `knowledge.doubt_raised` for every
   doubt shared entry (idempotent by `waveId:sharedEntryId` — re-drive-safe and
   complete-with-respect-to-elevated-doubts). Every elevated doubt is `reviewed` before any carry
   step runs.
3. **Sweep** (existing, `coordinator.mjs:11499` → `coordination-store.mjs:12556`), with the
   **widened carry predicate**: for every doubt shared entry of a revoked settlement lease's wave
   not in `answered`/`dismissed`, mint `doubt_raised` (if absent) + `doubt_carried` together in the
   one sweep (the elevated-but-unraised contradiction, D2). This is the review boundary: the
   lease's active lifetime is the review window; after the sweep revokes it, an unresolved doubt is
   carried — project-persistent, queryable via `knowledge.doubts`, never silently dropped. The
   sweep's retirement of open board items stays note-candidacy-only (GT5).
4. **Materialize** the review surface when `members === null || elevatedNotes.length >= 1 ||
   elevatedDoubts.length >= 1` (`coordinator.mjs:11532` currently gates on notes only — a
   doubts-only wave must still mint a review surface). Board candidacy stays note-only.
5. **Surface**: the command receipt and the wave receipt/outline carry `knowledge.openDoubts`
   (D3). The orchestrator reviews via `knowledge.doubts` and resolves via `knowledge.promote_doubt`
   (D4) while the lease is active.

The doubt's honest fate at the review boundary is therefore one of three receipted outcomes:
**answered** (resolution armed for push, D6), **dismissed** (named closed disposition), or
**carried** (project-persistent). There is no path where a doubt is dropped without a receipt —
including the elevated-but-unraised path, which the sweep closes by minting `doubt_raised` +
`doubt_carried` together.

### D6 — The answer push: arming #79's `doubt_answer` lane (v1 honesty)

An `answered` doubt arms the #79 push back to the worker. The doubt side composes with the #79
delivery push contract — it does not re-specify the push machinery:

- `knowledge.doubt_resolved` carries `pushRequested: true`, the doubt's `workerId`, `doubtId`, and
  the bounded `resolution` — exactly the coordinates the #79 lane needs to compose a push item
  (worker-addressed by identity, never by content — #79 D3).
- The push item is a new push-qualified kind **`doubt_answer`** added to the #79 push set: framed
  `[attention/untrusted]`, durable id `` `doubt_answer:${doubtId}` ``, still-pending predicate =
  the doubt is `answered` and the item is not yet read (the #79 D4 delivered-then-read derivation;
  the D5 dedup-by-durable-id rule applies verbatim).
- The answer rides the `## Pending attention` block at the `_providerBrief` seam
  (`coordinator.mjs:3790`) per #79 D1/D2/D8 — the provider-facing augmentation, never a mutation
  of `task.brief` (`briefDigest = canonicalDigest(activeTask.brief)` at `coordinator.mjs:5502`,
  byte-stable under the KG-3 briefing discipline, `coordinator.mjs:10512`).

**v1 honesty (HOLE-6).** The v1.0 "closes the loop back to the worker" overstates the rung: the
doubting worker's run is settled and may never respawn, and #79 composes the `## Pending attention`
block only at spawn/recovery — so the answer can sit pending indefinitely. The v1 delivery claim is
**delivered-when-recovered**: the answer is rendered only when that worker is recovered/respawned by
a later run; there is never a wire-acked delivery. The RED-to-green for this rung is the
`doubt_resolved` event carrying the push coordinates — not a delivery receipt. Because the #79 lane
is not yet landed (GT6), the `## Pending attention` render of `doubt_answer` is #79's own
implementation surface (RED under #79's pins until it lands).

### D7 — Frame bounds (frame economics #89 — one registry, no re-declare)

Three rows added to the ONE `FRAME_LIMITS` registry (`limits.mjs:53-110`; the no-re-declare law,
#89 Decision 8), each derived from an existing row of the same class:

- `view.open_doubts.items` = **8** (items), class `view`, graceful `'shed-flagged'` — derived from
  `view.knowledge_slice.items` (8, `limits.mjs:101`), the closest review-surface item bound.
- `view.open_doubts.bytes` = **8192** (bytes), class `view`, graceful `'shed-flagged'` — the honest
  sum of one answered record's prose bounds + wrapper overhead: question ≤ 1,024 B + context ≤
  2,048 B + resolution ≤ 4,096 B = 7,168 B raw, rounded up to 8,192 B for the three prose wrappers.
  The v1.0 4096 row could not render one answered record — the resolution alone consumed the whole
  bound, so the shed would drop the only row (violating never-silent-truncation-of-a-row) or
  over-run the bound: the #79 OQ1 dead-row contradiction re-encountered (HOLE-1). Derived from the
  three prose bounds it must hold, never a new arbitrary cap.
- `doubt.resolution.bytes` = **4096** (bytes), class `admission`, enforced at
  `coordinator.resolveDoubt`, refusalCode `doubt_resolution_exceeded` — derived from `board.detail`
  (4096, `limits.mjs:65`), the orchestrator-authored review-prose cap.

---

## Refusal vocabulary

The hub composes the doubt surface and the resolve act (the worker never requests them); refusals
fire on the serving/resolve path when the act cannot proceed lawfully. Codes follow the registry's
snake_case family (`scratchpad_settlement_not_authorized`, `board_title_exceeded`):

- **`doubt_promote_not_authorized`** — no active run-orchestrator settlement lease for the `runId`
  (D4 gate; the #63 XB lease-code family, never a new clock). The revoked/expired/foreign-session
  conditions fire the lease codes verbatim (`run_orchestrator_lease_not_found`,
  `run_orchestrator_session_mismatch`, expired) — one code per condition, no overlap (M3).
- **`doubt_promote_invalid`** — malformed `doubtId`/`disposition`/input; `answered` without a
  bounded `resolution`, `dismissed` without a closed `dismissalReason`.
- **`doubt_promote_unknown`** — the `doubtId` is not a raised doubt record.
- **`doubt_promote_stale`** — the doubt is not in state `reviewed` (already resolved/carried) —
  reserved for the state guard only (D4 step 3); the expired review window is the step-1 lease
  code, never this code (M3).
- **`doubt_promote_conflict`** — same idempotency key, different request binding
  (`knowledge.doubt_resolved:${doubtId}`).
- **`doubt_resolution_exceeded`** — the resolution exceeds the `doubt.resolution.bytes` row
  (D7); the coaching shape is `composeFrameLimitRefusal` output (`limits.mjs:40-42`).
- **`doubt_dismissal_invalid`** — a `dismissalReason` outside
  `['deferred','duplicate','out_of_scope','unfounded']`.
- **`doubt_surface_unavailable`** — the `knowledge.doubts` read is unauthorized — the caller holds
  neither the run's active run-orchestrator lease (for a `waveId`-named read) nor the deployment's
  top-level orchestrator principal (for the project surface) — or names an unknown wave (D3,
  HOLE-4).
- **`doubt_carry_conflict`** — a sweep carry for a doubt no longer in state `reviewed` (raced with a
  resolve); the resolve wins, the carry no-ops.

---

## Red-first acceptance

Each pin is RED today — the behavior is absent from this tree — and the implementation makes it
GREEN. The red suite is a new `impl/test/issue66-doubt-review-red.test.mjs`, mirroring the
`issue62-write-failure-red.test.mjs`/`issue79-*` harness shapes. Every fixture uses the store's
fixed-clock discipline (as #33 Part F does); no test uses `Date.now()` or a live timer.

- **R1 — elevation includes doubts, with no collateral (HOLE-5).** A wave whose member writes a
  `kind:'doubt'` completes with the doubt ELEVATED to the shared partition (a shared successor,
  `scratchFactId: null`), disposition `elevated/selected` under a driven selection, never
  `orchestrator_skipped`. The non-doubt path is byte-identical to v1.0: within the 512 shared
  ceiling, doubts ≤ 384 and notes+plans ≥ 128 (D1), so a doubt-heavy member's notes still elevate
  where the old note-only selection would have. RED: `coordinator.mjs:11513` filters note+plan only;
  doubts disposition `orchestrator_skipped` (`coordination-store.mjs:14304`).
- **R2 — the doubt record + lifecycle.** A raised doubt is durable and replay-derived:
  `knowledge.doubt_raised` → `reviewed`; `knowledge.doubt_resolved {disposition:'answered'}` →
  `answered`; `{disposition:'dismissed'}` → `dismissed`; `knowledge.doubt_carried` → `carried`;
  every transition receipted — including the elevated-but-unraised contradiction, which the sweep
  closes by minting `doubt_raised` + `doubt_carried` together (D2/D5, HOLE-2) — and
  replay-of-the-same-wave deriving identical records. The record projection is the folded
  `knowledge` map via `snapshot()` (M5), never a ledger scan. RED: no `knowledge.doubt_*` event
  kind exists in the event-kind inventory.
- **R3 — the queryable surface, bounded and gated (HOLE-1/HOLE-4).** The ritual receipt/outline
  carries `knowledge.openDoubts` (zero as 0, never missing) and `knowledge.doubts` returns the
  bounded, UNTRUSTED-framed, sorted doubt records (by `raisedSeq DESC, doubtId ASC`, no
  `localeCompare`), one answered record rendering inside `view.open_doubts.bytes` = 8192 (D7). The
  read refuses `doubt_surface_unavailable` for a caller holding neither the run's active lease nor
  the top-level orchestrator principal, and is dispatched via a direct-port branch (D3). RED:
  `wave-driver.mjs:830-837` has no `openDoubts` field; no `knowledge.doubts` row exists.
- **R4 — answer.** `knowledge.promote_doubt {disposition:'answered', resolution}` closes the doubt
  as `answered` with the resolution receipted and `pushRequested: true`; the authority is the
  server-re-derived active run-orchestrator lease for the `runId` (D4) — a caller-supplied lease is
  never accepted (the #73 forge class is closed, HOLE-3); NO Finding/KG node/board
  item/`knowledge.workflow_admitted`/scratch-fact is minted (the taxonomy boundary is structural).
  RED: no `knowledge.promote_doubt` command exists.
- **R5 — dismiss.** `knowledge.promote_doubt {disposition:'dismissed',
  dismissalReason: <closed enum>}` closes the doubt as `dismissed` with the named disposition —
  never silently dropped. RED: same as R4.
- **R6 — the answer push (v1 honesty, HOLE-6).** An answered doubt's `doubt_resolved` event carries
  `{workerId, doubtId, resolution, pushRequested: true}` — the #79 `doubt_answer` push coordinates
  (worker-addressed by identity, durable id `doubt_answer:${doubtId}`). The v1 delivery claim is
  delivered-when-recovered — the coordinates are the RED-to-green, never a wire-acked delivery.
  RED (this tree): the resolved-event coordinates are absent; the `## Pending attention` render is
  #79's own surface and stays RED under #79's pins until that lane lands.
- **R7 — carry at the review boundary (HOLE-2).** A doubt still `reviewed` when its wave's
  settlement lease is revoked is carried by the sweep (`knowledge.doubt_carried`, `carriedBy:
  'review_window_expired'`), project-persistent and queryable across waves; it is never silently
  dropped. The carry predicate is any doubt shared entry of the revoked lease's wave not in
  `answered`/`dismissed` — the sweep mints `doubt_raised` (if absent) + `doubt_carried` together,
  so an elevated-but-unraised doubt is receipted, never a silent sink. RED:
  `sweepSettlementLeases` (`coordination-store.mjs:12556`) retires candidates but has no doubt
  handling.
- **R8 — UNTRUSTED framing (HOLE-7).** Every doubt surface render wraps the doubting worker's
  `question`/`context` in `{worker, text, provenance: 'model-authored', untrusted: true}`
  (`wrapProse`) and the orchestrator's `resolution` in `{worker, text, provenance: 'hub-derived',
  untrusted: true}` (`wrapHubDerived`, #79) — a resolution is never `model-authored` and never
  `hub-computed`; no doubt prose crosses a surface unframed; the projection is shed-flagged at the
  D7 bounds, never a silent row drop. RED: no doubt surface exists to frame.
- **R9 — no auto-candidacy (structural pin).** A doubt never posts a board item, never mints a
  `finding:board-close:*`, and never enters `_deriveKnowledgePromotion`. The candidacy loop stays
  note-only (`coordinator.mjs:11522-11525`, `:11567-11576`); the `grounding !== 'observed'` filter
  (`coordination-store.mjs:15901`) and the no-bridge-fact rule keep doubts out. Asserted via
  source-scan pins (mirroring KG-A5's gate-honesty discipline).
- **R10 — replay-exactness.** Re-driving the same wave mints the same doubt records exactly-once
  (keys pinned to `waveId:sharedEntryId` and `doubtId`); no duplicate raises, resolves, or carries.
  RED: no doubt events exist to replay.

---

## Open questions (adjudicated at this draft)

- **OQ1 — Is `carried` terminal?** **Adjudicated (folded): terminal in v1 — SOUND.** A carried
  doubt belongs to a closed wave whose worker cannot receive an answer — the same settled-run
  geometry D6 pins as delivered-when-recovered. A future orchestrator re-opening a carried doubt is
  a named follow-up, not v1.
- **OQ2 — Worker self-resolution.** #33 rule 6 says a doubt's resolution is represented by a later
  `note` or `link`; a worker who self-resolves writes a note that may separately elevate and
  candidate. **Adjudicated (folded): no auto-reconcile — SOUND.** The doubt record stays `reviewed`
  until the orchestrator answers/dismisses it or it carries — the review authority is never
  bypassed, and a self-resolution note is a separate candidacy (never auto-closing the doubt).
- **OQ3 — Surface scope.** `knowledge.doubts` covers raised records (`reviewed`/`answered`/
  `dismissed`/`carried`); pre-raise `open` worker-partition doubts stay on the scratchpad
  projection (#33 rule 16). **Adjudicated (folded): this split is the honest one — SOUND.** The
  wave driver already sees open worker doubts in `wave.progress().members[i].scratchpad`, and the
  doubt surface is the review ledger.
- **OQ4 — Do elevated doubts also ride `scratchpad.elevate`?** The selection change is
  `settlementLease`-only (D1); the direct `scratchpad.elevate` command may select doubts, and the
  ritual's raise scan (D2) is over the full shared partition. **Adjudicated (folded): qualified —
  the v1.0 "complete and re-drive-exact by construction" was overstated (M4).** A direct elevation
  is raised only when it precedes the ritual — each ritual scans only its own wave's members, so a
  post-ritual direct elevation is never raised by a later ritual. A post-ritual elevated-but-unraised
  doubt is closed by the sweep's widened carry predicate (D5) as a receipted contradiction when its
  lease is revoked; a doubt elevated after its wave's lease is gone is reaped at workflow settle and
  is not a review-surface record. Direct elevation of a doubt must precede the wave's settle ritual
  to enter the review surface — that boundary is pinned, not claimed.
