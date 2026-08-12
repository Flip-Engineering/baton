# Issue #66 — the doubt review path contract (v1.0 DRAFT)

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

- **Date:** 2026-08-12
- **Status:** DRAFT v1.0 — implementation contract.
- **Verification HEAD:** `faf4e06d35bba2d1ea53d9d32e3c6d48ff97ee23` ("Baton private effective-tree
  snapshot"), the tree this v1.0 draft was verified against. Every `file:line` citation below was
  re-verified with `grep -an`/`sed -n` at this HEAD. The brief's "two NUL files" —
  `impl/src/coordination-store.mjs` and `impl/src/coordinator.mjs` — are cited only at
  grep/sed-verified points, never whole-file reads; every anchor in `impl/src/wave-driver.mjs`,
  `impl/src/application.mjs`, `impl/src/application-semantics.mjs`, `impl/src/messages.mjs`, and
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
surface if unanswered at the review boundary, and pushed back to its worker when answered — never
a silent sink and never an auto-candidate into the Finding graph.**

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
  successor as `targetId` — never `orchestrator_skipped` (`coordination-store.mjs:14296-14305`).
- The shared successor carries `scratchFactId: null` (GT2) — no bridge fact, so the taxonomy
  boundary holds structurally (GT5). A doubt is visible to the orchestrator's scratchpad
  projection as a `{kind:'doubt', question, context}` shared entry (GT7).
- The shared-partition ceiling `MAX_SCRATCHPAD_SHARED_ENTRIES` (512, scratchpad rule 8) is the
  per-wave doubt-count resource bound — the natural throttle, not a new numeric cap.
- The direct `scratchpad.elevate` command may also select doubts; whether a doubt is *raised into
  the review surface* is a ritual act (D2), not an elevation side effect — a doubt elevated by a
  direct command is visible in shared and is raised by the next ritual scan.

### D2 — The durable doubt record + lifecycle

A doubt record is a durable, replay-derived row in the coordination store, minted by the settle
ritual (`coordinator.settlementLease`), not by generic elevation. Three new event kinds, each
folded, checkpointed, and inventory-listed exactly as #33's scratchpad kinds are
(`scratchpad-decisions.md` rules 10-11):

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
  resolution: null | <orchestrator answer prose, ≤ 4,096 B — the doubt.resolution.bytes row>,
  dismissalReason: null | 'out_of_scope' | 'duplicate' | 'unfounded' | 'deferred',
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

### D3 — The queryable review surface: `knowledge.doubts` + `knowledge.openDoubts`

**The read.** New embedded-only, orchestrator-addressed observe row `knowledge.doubts` on the
application-semantics registry (kernel profile, observe effect, embedded surface only — the same
embedded-only posture as the settlement rows, `application-semantics.mjs:1520-1527`). Input
`{waveId?, state?, before?, limit?}`, output the bounded doubt records with their frames:

```js
{
  runId, waveId,
  doubts: [{
    doubtId, state,           // reviewed | answered | dismissed | carried
    runId, waveId, taskId, workerId,
    question: Prose,          // {worker, text, provenance: 'model-authored', untrusted: true}
    context: null | Prose,
    resolution: null | Prose,
    dismissalReason: null | 'out_of_scope' | 'duplicate' | 'unfounded' | 'deferred',
    raisedSeq, resolvedSeq, carriedSeq   // null until the transition exists
  }],
  nextBefore,               // keyset continuation, exact #33 rule-15 predicate discipline
  openDoubtsTruncated
}
```

- Sorted by `(raisedSeq DESC, doubtId ASC)` using the existing `compareCanonicalStrings` comparator
  (the `coordination-store.mjs:17` import family) — no `localeCompare` anywhere.
- Bounded by two new `FRAME_LIMITS` rows (D7), shed-flagged, never silent truncation of a row.
- `waveId` absent = the project surface across waves; `state` filters the derived state; `before`/
  `limit` page exactly as the #33 keyset predicate (scratchpad rule 15).
- **A record's prose renders UNTRUSTED-framed (GT7):** `question`, `context`, and `resolution`
  are wrapped `{worker, text, provenance: 'model-authored', untrusted: true}` — never a raw string.

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
`liveMethod: 'resolveDoubt'`.

`coordinator.resolveDoubt(runId, doubtId, disposition, session, {resolution, dismissalReason})`:

1. **The review-window gate.** Enforces the same active run-orchestrator lease semantics #63 D2 XB
   pins for `admitWorkflowFinding` (expiry, parent-task liveness, and the
   `principalId`/`sessionId`/`sessionAuthorityDigest` session binding; the store gate at
   `coordination-store.mjs:16207`, the coordinator wrapper at `coordinator.mjs:11428-11430`). A
   revoked/expired/foreign-session lease fails with the typed code before any effect. The review
   window is the settlement lease's active lifetime — no new clock.
2. **Closed-input validation.** `disposition: 'answered'` requires a non-empty bounded
   `resolution`; `'dismissed'` requires a `dismissalReason` from the closed enum. Malformed or
   missing fields fail typed. `resolution` is orchestrator-authored prose, bounded by the
   `doubt.resolution.bytes` row (D7), framed UNTRUSTED at projection.
3. **State guard.** The `doubtId` must resolve to a raised doubt in state `reviewed`. An
   already-resolved/carried doubt, an unknown `doubtId`, or a doubt whose lease has expired all
   fail typed — never a silent no-op.
4. **The receipted transition.** Mints `knowledge.doubt_resolved` (D2). If `answered`, sets
   `pushRequested: true` — the #79 push seam (D6). **No Finding, no KG node, no board item, no
   `knowledge.workflow_admitted`, no scratch-fact** — the taxonomy boundary is structural.

### D5 — The settle composition: surface → resolve → carry, never silently dropped

At the settle ritual (`coordinator.settlementLease`), in order:

1. **Sweep** (existing, `coordinator.mjs:11499` → `coordination-store.mjs:12556`). The sweep's
   per-revoked-lease step now also **carries** the wave's open doubts: for every doubt of a revoked
   settlement lease's wave still in state `reviewed`, mint `knowledge.doubt_carried` with the
   pinned key. This is the review boundary: the lease's active lifetime is the review window; after
   the sweep revokes it, an unresolved doubt is carried — project-persistent, queryable via
   `knowledge.doubts`, never silently dropped. The sweep's retirement of open board items stays
   note-candidacy-only (GT5).
2. **Elevate** (D1): note+plan+doubt.
3. **Raise** (D2): scan each member's shared partition; mint `knowledge.doubt_raised` for every
   doubt shared entry (idempotent by `waveId:sharedEntryId` — re-drive-safe and
   complete-with-respect-to-elevated-doubts).
4. **Materialize** the review surface when `members === null || elevatedNotes.length >= 1 ||
   elevatedDoubts.length >= 1` (`coordinator.mjs:11532` currently gates on notes only — a
   doubts-only wave must still mint a review surface). Board candidacy stays note-only.
5. **Surface**: the command receipt and the wave receipt/outline carry `knowledge.openDoubts`
   (D3). The orchestrator reviews via `knowledge.doubts` and resolves via `knowledge.promote_doubt`
   (D4) while the lease is active.

The doubt's honest fate at the review boundary is therefore one of three receipted outcomes:
**answered** (resolution pushed to the worker, D6), **dismissed** (named closed disposition), or
**carried** (project-persistent). There is no path where a doubt is dropped without a receipt.

### D6 — The answer push: composing #79's delivery lane (the closed loop)

An `answered` doubt closes the loop back to the worker. The doubt side composes with the #79
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

Because the #79 lane is not yet landed (GT6), the doubt rung's RED-to-green is the
`doubt_resolved` event carrying the push coordinates; the `## Pending attention` render of
`doubt_answer` is #79's own implementation surface (RED under #79's pins until it lands).

### D7 — Frame bounds (frame economics #89 — one registry, no re-declare)

Three rows added to the ONE `FRAME_LIMITS` registry (`limits.mjs:53-110`; the no-re-declare law,
#89 Decision 8), each derived from an existing row of the same class:

- `view.open_doubts.items` = **8** (items), class `view`, graceful `'shed-flagged'` — derived from
  `view.knowledge_slice.items` (8, `limits.mjs:101`), the closest review-surface item bound.
- `view.open_doubts.bytes` = **4096** (bytes), class `view`, graceful `'shed-flagged'` — derived
  from `view.attention_text.bytes` (4096, `limits.mjs:99`); a single doubt's full frame (question
  ≤ 1,024 B + context ≤ 2,048 B + prose wrapper) renders inside it, and the item bound then governs
  how many render.
- `doubt.resolution.bytes` = **4096** (bytes), class `admission`, enforced at
  `coordinator.resolveDoubt`, refusalCode `doubt_resolution_exceeded` — derived from `board.detail`
  (4096, `limits.mjs:65`), the orchestrator-authored review-prose cap.

---

## Refusal vocabulary

The hub composes the doubt surface and the resolve act (the worker never requests them); refusals
fire on the serving/resolve path when the act cannot proceed lawfully. Codes follow the registry's
snake_case family (`scratchpad_settlement_not_authorized`, `board_title_exceeded`):

- **`doubt_promote_not_authorized`** — no active run-orchestrator settlement lease, or a
  revoked/expired/foreign-session lease (D4 gate; the #63 XB typed codes — reuse the lease codes,
  never a new clock).
- **`doubt_promote_invalid`** — malformed `doubtId`/`disposition`/input; `answered` without a
  bounded `resolution`, `dismissed` without a closed `dismissalReason`.
- **`doubt_promote_unknown`** — the `doubtId` is not a raised doubt record.
- **`doubt_promote_stale`** — the doubt is not in state `reviewed` (already resolved/carried), or
  its review window has expired.
- **`doubt_promote_conflict`** — same idempotency key, different request binding
  (`knowledge.doubt_resolved:${doubtId}`).
- **`doubt_resolution_exceeded`** — the resolution exceeds the `doubt.resolution.bytes` row
  (D7); the coaching shape is `composeFrameLimitRefusal` output (`limits.mjs:40-42`).
- **`doubt_dismissal_invalid`** — a `dismissalReason` outside
  `['out_of_scope','duplicate','unfounded','deferred']`.
- **`doubt_surface_unavailable`** — the `knowledge.doubts` read is unauthorized (non-orchestrator)
  or names an unknown wave.
- **`doubt_carry_conflict`** — a sweep carry for a doubt no longer in state `reviewed` (raced with a
  resolve); the resolve wins, the carry no-ops.

---

## Red-first acceptance

Each pin is RED today — the behavior is absent from this tree — and the implementation makes it
GREEN. The red suite is a new `impl/test/issue66-doubt-review-red.test.mjs`, mirroring the
`issue62-write-failure-red.test.mjs`/`issue79-*` harness shapes. Every fixture uses the store's
fixed-clock discipline (as #33 Part F does); no test uses `Date.now()` or a live timer.

- **R1 — elevation includes doubts.** A wave whose member writes a `kind:'doubt'` completes with
  the doubt ELEVATED to the shared partition (a shared successor, `scratchFactId: null`),
  disposition `elevated/selected`, never `orchestrator_skipped`. RED: `coordinator.mjs:11513`
  filters note+plan only; doubts disposition `orchestrator_skipped`
  (`coordination-store.mjs:14304`).
- **R2 — the doubt record + lifecycle.** A raised doubt is durable and replay-derived:
  `knowledge.doubt_raised` → `reviewed`; `knowledge.doubt_resolved {disposition:'answered'}` →
  `answered`; `{disposition:'dismissed'}` → `dismissed`; `knowledge.doubt_carried` → `carried`;
  every transition receipted, replay-of-the-same-wave deriving identical records. RED: no
  `knowledge.doubt_*` event kind exists in the event-kind inventory.
- **R3 — the queryable surface.** The ritual receipt/outline carries `knowledge.openDoubts`
  (zero as 0, never missing) and `knowledge.doubts` returns the bounded, UNTRUSTED-framed,
  sorted doubt records (by `raisedSeq DESC, doubtId ASC`, no `localeCompare`). RED:
  `wave-driver.mjs:830-837` has no `openDoubts` field; no `knowledge.doubts` row exists.
- **R4 — answer.** `knowledge.promote_doubt {disposition:'answered', resolution}` closes the doubt
  as `answered` with the resolution receipted and `pushRequested: true`; NO Finding/KG node/board
  item/`knowledge.workflow_admitted`/scratch-fact is minted (the taxonomy boundary is structural).
  RED: no `knowledge.promote_doubt` command exists.
- **R5 — dismiss.** `knowledge.promote_doubt {disposition:'dismissed',
  dismissalReason: <closed enum>}` closes the doubt as `dismissed` with the named disposition —
  never silently dropped. RED: same as R4.
- **R6 — the answer push (closed loop).** An answered doubt's `doubt_resolved` event carries
  `{workerId, doubtId, resolution, pushRequested: true}` — the #79 `doubt_answer` push coordinates
  (worker-addressed by identity, durable id `doubt_answer:${doubtId}`). RED (this tree): the
  resolved-event coordinates are absent; the `## Pending attention` render is #79's own surface and
  stays RED under #79's pins until that lane lands.
- **R7 — carry at the review boundary.** A doubt still `reviewed` when its wave's settlement lease
  is revoked is carried by the sweep (`knowledge.doubt_carried`, `carriedBy:
  'review_window_expired'`), project-persistent and queryable across waves; it is never silently
  dropped. RED: `sweepSettlementLeases` (`coordination-store.mjs:12556`) retires candidates but
  has no doubt handling.
- **R8 — UNTRUSTED framing.** Every doubt surface render wraps `question`/`context`/`resolution`
  in `{worker, text, provenance: 'model-authored', untrusted: true}`; no doubt prose crosses a
  surface unframed; the projection is shed-flagged at the D7 bounds, never a silent row drop. RED:
  no doubt surface exists to frame.
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

- **OQ1 — Is `carried` terminal?** **Adjudicated: terminal in v1.** The closed loop requires a
  live worker; a carried doubt belongs to a closed wave whose worker cannot receive an answer. A
  future orchestrator re-opening a carried doubt is a named follow-up, not v1.
- **OQ2 — Worker self-resolution.** #33 rule 6 says a doubt's resolution is represented by a later
  `note` or `link`; a worker who self-resolves writes a note that may separately elevate and
  candidate. **Adjudicated: no auto-reconcile.** The doubt record stays `reviewed` until the
  orchestrator answers/dismisses it or it carries — the review authority is never bypassed, and a
  self-resolution note is a separate candidacy (never auto-closing the doubt).
- **OQ3 — Surface scope.** `knowledge.doubts` covers raised records (`reviewed`/`answered`/
  `dismissed`/`carried`); pre-raise `open` worker-partition doubts stay on the scratchpad
  projection (#33 rule 16). **Adjudicated: this split is the honest one** — the wave driver already
  sees open worker doubts in `wave.progress().members[i].scratchpad`, and the doubt surface is the
  review ledger.
- **OQ4 — Do elevated doubts also ride `scratchpad.elevate`?** The selection change is
  `settlementLease`-only (D1); the direct `scratchpad.elevate` command may select doubts, and the
  ritual's raise scan (D2) is over the full shared partition, so such doubts are raised by the next
  ritual. **Adjudicated: complete and re-drive-exact by construction.**
