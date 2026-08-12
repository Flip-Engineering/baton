# Issue #66 — the doubt review path: doubts outlive the task partition

- **Issue:** #66 — "doubts die with the task partition — the KG settlement v1 deliberately doesn't
  elevate them" (filed from the #63 bring-up receipts; see `docs/PROGRESS.md:448`).
- **Date:** 2026-08-12
- **Status:** v1.0 DRAFT — implementation contract (Ring-2 form, acceptance pins red-first)
- **Verification HEAD:** `640877dc67336d07815341058c296d1357243882` (this worktree's effective-tree
  snapshot). Every `file:line` citation below was re-verified with `grep -an`/`sed -n` at the
  verification HEAD. The two NUL-bearing files are `impl/src/coordination-store.mjs` and
  `impl/src/coordinator.mjs` — both were read by grep/sed only, per campaign discipline.
- **Brief:** `contract-66-brief.md` (this directory) — read in full. The issue body was unavailable
  at drafting time (`gh` is not authenticated in this worktree), so the brief's own decisions carry
  the requirements — the same precedent noted in `orchestrator-wake-contract.md`.
- **Seed.** A6's red-team verdict (`redteam-lifecycle.md:354-397`) names the exact defect: an
  elevated doubt was copied to the shared partition, minted **no** scratch-fact, was given **no**
  board item / candidate, and was then **deleted** at settle — "the worst of both: it pays the
  elevation cost and then discards the result with no path to act on it." The folded #63 v1.1 took
  amendment **(a)** — doubts are no longer elevated at all; the settle selection skips them
  (`coordinator.mjs:11513`), the worker-partition reap receipts them `orchestrator_skipped`
  (`coordination-store.mjs:14304`), and they die with the task partition. That is the silent
  sink #66 exists to close: an open question is **lost**, not deferred. This contract adopts the
  A6 amendment **(b)** — a review path — as a **composition**: shape (a) a **doubts board**
  (queryable, reviewed, project-persistent) composed with **#79's push lane** for the answer loop
  (the brief's honesty test: QUERYABLE + REVIEWED + ANSWERABLE, never a silent sink, never
  auto-candidacy into the Finding graph). Shapes (b) `knowledge.promote_doubt` and (c)
  `open_question` scratch-facts are explicitly **not** adopted in v1 (§2).

**Cross-references (not re-specified here):** #33 (`scratchpad-decisions.md` — the doubt entry
shape, the shared-partition model, the elevation/settle machinery), #63
(`kg-settlement-decisions.md` D1–D5 — the settle ritual, the candidacy board, the receipt block),
#79 (`worker-delivery-push-contract.md` v1.1 — the `## Pending attention` delivery seam at
`_providerBrief`, the push-qualified kinds, the dedup law), the KG taxonomy
(`spec/phase49/cairn-selective-promotion.md` SP3 — the closed source taxonomy), and A6's silent-sink
ruling (`redteam-lifecycle.md:354-397`). Each is cited at the decision it touches. This contract
owns only the doubt surface, its lifecycle, and its resolution lane.

---

## 1. Ground truths (re-verified at HEAD `640877d`)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | The settle ritual selects **note+plan only**; `doubt` and `link` are skipped. The worker-partition reap then receipts unselected entries `not_elevated` (`orchestrator_skipped` under steering), so a doubt's active-state footprint is **zero** after the task settles — the #66 defect. | `coordinator.mjs:11513` (`.filter((entry) => entry.kind === 'note' \|\| entry.kind === 'plan')`); `coordination-store.mjs:14304` (reap disposition `orchestrator_skipped`) |
| G2 | The doubt entry grammar is closed: `{kind:'doubt', question ≤1024B, context null\|≤2048B}`. The question is a `Prose` string; the context is worker-authored and optional. A doubt is never mutated into a fact (a later `note`/`link` supersedes, the original doubt is never rewritten). | `coordination-store.mjs:645-650`; `scratchpad-decisions.md:206-216` (rule 6) |
| G3 | Elevation copies a note's content to the shared partition and mints an **observed scratch-fact for notes only**; `plan`/`doubt`/`link` elevate with `scratchFactId: null` — a doubt has no fact, hence no horizon/scratch query surface. The shared successor's `content` is the source content verbatim. | `coordination-store.mjs:14258` (`if (source.kind === 'note')` fact mint), `:14278` (`scratchFactId: factPayload?.id ?? null`), `:14257` (`content: source.content`) |
| G4 | The shared-partition settle (`settleWorkflowScratchpad`) reaps **every** shared entry: notes → `min_readers`, everything else (doubts) → `type_ineligible`. A doubt's shared successor is deleted from active state at settle; its content survives only in the durable `scratchpad.entry_elevated` event, which nothing queries (the A6 sink). | `coordination-store.mjs:14363` |
| G5 | Board machinery: `closeBoardItem` **mints a Finding** — `finding:board-close:${itemId}:${itemVersion}` with `promotion: {kind:'Finding', trigger:'board.item_closed'}`, appended atomically with the close in one batch (auto-candidacy; **forbidden for doubts**). `dropBoardItem` does **not** mint any Finding — the `board.item_dropped` path is the only resolution-legal state change. | `coordination-store.mjs:14734-14756` (close + `knowledge.node_added` batch), `:14791` (close), `:14797` (drop), `:14768-14775` (drop batch, no mint) |
| G6 | `postBoardItem` is atomic, keyed (idempotency via the auth key), rejects caller-supplied `itemId` (identity is hub-derived), and validates `board`/`title`(160B)/`detail`(4096B)/`owner`/`evidence`. `evidence` accepts only `{coordinationSeq}` or `{artifactId}` refs (max 8). Item states are the closed `{open, closed, dropped}`. | `coordination-store.mjs:14669-14715`, `:418-420` (`SAFE_BOARD_ID`, `SAFE_BOARD_OWNER`, `BOARD_ITEM_STATES`), `:432` (`validBoardEvidenceRef`), `:423-426` (byte limits, `MAX_STORE_BOARD_EVIDENCE`) |
| G7 | Board reads serve **unbound boards with items** to an authorized reader; the read is a read-only snapshot. The item surface frames every item title with the closed `UNTRUSTED_WORKER_TITLE` mark — worker-authored text, not an instruction. | `application.mjs:13168-13190` (`boardRead`, unbound-with-items serves); `coordination-store.mjs:14911` (`boardSnapshot` framing) |
| G8 | The settlement ritual rides the embedded-only `knowledge.settlement_lease` command (a direct port, never an `APPLICATION_COMMAND_DEFINITIONS` key). Server-side it sweeps stale leases, elevates each member's selected entries, materializes the settlement run/task/lease, and posts one candidacy item per elevated note. `materialize` is gated on ≥1 note. | `application.mjs:12493-12500` (embedded-only ports), `:12667-12690` (dispatch); `coordinator.mjs:11532` (`materialize` gate), `:11566-11577` (candidacy loop); `application-client.mjs:1593-1594` (driver facade) |
| G9 | The wave receipt carries a `knowledge` block with `candidates`, `admittedThisRun`, `candidatesAwaitingAdmission`, `settlementRunId` — zero surfaces as `0`, never a missing field. The post-close campaign record (`_appendWaveClosed`) mirrors the same block. | `wave-driver.mjs:832-837` (receipt block), `:852-859` (campaign record block) |
| G10 | The knowledge plane already knows `Question` as a node type and `knowledgeSeed` admits it with a closed grounding set — but the **promotion** taxonomy admits only `Decision`/`Counterexample`/`Finding` (SP3), and `_deriveWorkflowAdmission` requires `candidate.type === 'Finding'`, so a `Question` node can never auto-candidate. A `Question`-node surface is therefore the safe v1.1 successor (§8 OQ2). | `coordination-store.mjs:148` (`KNOWLEDGE_NODE_TYPES`), `:150` (`KNOWLEDGE_GROUNDINGS`); `application.mjs:12914-12917` (seed normalization accepts `Question`, refuses `Decision`); `cairn-selective-promotion.md` SP3; `coordination-store.mjs:16152-16165` (`_deriveWorkflowAdmission`) |
| G11 | #79's push lane is the delivery seam for the answer loop: a `## Pending attention` block composed at `_providerBrief`, worker-addressed by durable `workerId`, deduped by each item's durable id, with the still-pending predicate replay-derived from the event log (no clock). The lane is a **draft contract at this HEAD** — `wrapHubDerived` and `_pendingAttentionPush` do not exist yet. | `worker-delivery-push-contract.md` D1/D3/D4/D5; `_providerBrief` at `coordinator.mjs:3790`; `wrapHubDerived`/`_pendingAttentionPush` absent at HEAD (grep-verified) |
| G12 | The A6 ruling is the honest bar this contract is measured against: a doubt must be queryable, must be seen by the settle ritual, must have a resolution path, must never be silently dropped, and must never auto-candidate. | `redteam-lifecycle.md:354-397` |

---

## 2. The shape decision — (a) the doubts board, composed with #79's push lane

The brief's honesty test has three legs: **QUERYABLE** (orchestrator: "what doubts are open across
this wave/project?"), **REVIEWED** (the settle ritual sees them), **ANSWERABLE** (a resolution path
that pushes the answer back to the worker's brief). The chosen shape satisfies all three with one
new persistent surface and one new resolution lane:

- **QUERYABLE** — a durable doubts board `project-doubts:${repoId}`, one item per elevated doubt,
  served by the existing unbound board read (G7). It is the project's doubt surface: open doubts
  persist on it past the wave, across waves, until resolved or dismissed.
- **REVIEWED** — the settle ritual itself is the review: every doubt a settling member partition
  holds is elevated and posted to the doubts board in the same ritual window that posts note
  candidacy, and the wave receipt counts them (`doubtsAwaitingReview`, zero as `0`). Nothing is
  deleted from the review lane; the only thing reaped at settle is the transient shared successor,
  whose content has already been captured by the board item.
- **ANSWERABLE** — a new embedded resolution command `knowledge.doubt_resolve` (D5) records a
  durable disposition, drops the doubt from the open set **without** minting a Finding (G5), and —
  for `answered` — registers the sanitized answer for delivery on #79's push lane (D6).

Shapes **(b)** and **(c)** are not adopted in v1:

- **(c) `open_question` scratch-facts** would mint a doubt fact at elevation. The scratch-fact
  grounding is a closed set — `['observed','derived']` only (`coordination-store.mjs:13925`) —
  so `open_question` is not a legal grounding at this HEAD. Introducing it is a taxonomy change
  (new grounding, new fact semantics, new projection rules) that #66 should not smuggle in, and it
  buys no query surface that the board does not already provide more cheaply. **Deferred** (§8 OQ3).
- **(b) `knowledge.promote_doubt`** minting a `Question` node would touch the promotion taxonomy:
  the source taxonomy (SP3) admits only `Decision`/`Counterexample`/`Finding`, and a `Question`
  node has no defined promotion trigger or edge. The board already provides project persistence
  and queryable visibility without a node mint. The name `promote_doubt` is **deliberately not
  used** — a doubt is never promoted into the Finding graph; it is surfaced (board) and resolved
  (answer/dismiss). A `Question`-node surface remains the safe v1.1 successor if a knowledge-plane
  projection is wanted (§8 OQ2).

The composition is complete: board = persistence + query + review; resolution command = disposition
+ drop + answer register; #79 lane = the answer's ride to the worker's brief.

---

## 3. Numbered contract

### D1 — Elevation: `doubt` joins the settle selection; the doubt's provenance anchors to its elevation event

**Change:** in `settlementLease` (`coordinator.mjs:11487`), the member selection filter at
`:11513` changes from `entry.kind === 'note' || entry.kind === 'plan'` to also include
`entry.kind === 'doubt'`. Every doubt a settling member's worker partition holds is elevated.

- The doubt elevates exactly like today's notes/plans: `elevateTaskScratchpad` copies the content
  verbatim into the shared partition (`scratchpad.entry_elevated`, `scratchFactId: null`, G3) and
  the worker-partition reap receipts the entry `result: 'elevated'` (G1's `orchestrator_skipped`
  no longer applies to a doubt).
- **Provenance anchor.** Each elevated doubt's `sharedEntryId` is the doubt's durable id for this
  contract. Its elevation event — the `scratchpad.entry_elevated` whose `payload.entryId` equals
  the `sharedEntryId`, matched by the elevation key `scratchpad.entry_elevated:${sourceEntryId}:${sourceEntryDigest}`
  — is the doubt's authoritative provenance record: it carries the member run, the source entry,
  the content digest, and `scratchFactId: null`. Worker, task, and wave are replay-derived from it.
- **`materialize` gate.** The lease materializes when a doubt is elevated even if no note is:
  `materialize = members === null || elevatedNotes.length >= 1 || elevatedDoubts.length >= 1`
  (`:11532`). A wave whose members raised only doubts still gets its settlement run and its doubts
  surfaced.
- **`link` stays skipped.** Links are relations, not open questions; #66 is about doubts only.
- **Ceilings.** The worker-partition entry bound (`MAX_SCRATCHPAD_WORKER_ENTRIES`) and the shared
  bound (`MAX_SCRATCHPAD_SHARED_ENTRIES`) are unchanged and remain the natural throttle: a wave
  that exceeds the shared cap at elevation refuses with a typed refusal recorded in the ritual's
  `errors` block (the settlementLease step-refusal discipline) — never a silent partial elevation.
- **Non-goal.** A doubt in a worker partition reaped outside the settle ritual (a task terminating
  with `basis: 'task_settled'` but no settling wave, or a non-steered reap) is out of #66's scope:
  the review surface is the settle ritual, and only the ritual's selection is extended. Stated
  honestly in §8 OQ6.

### D2 — The doubts board: `project-doubts:${repoId}`, one item per elevated doubt

The ritual posts exactly one board item per elevated doubt, in the same window that posts note
candidacy — **inside `settlementLease`, before the settlement worker's shared settle runs** (the
shared successor is reaped at settle, G4; the board item is the surviving surface, so the post must
precede the reap):

| Field | Value | Rationale |
|-------|-------|-----------|
| `board` | `project-doubts:${repoId}` | The project's doubt surface (G6 `SAFE_BOARD_ID`; repoId's charset `[A-Za-z0-9._:-]` is SAFE_BOARD_ID-compatible, and `project-doubts:${repoId}` must fit the 128-byte bound — a deployment with a longer repoId derives a bounded board id, an edge case noted in §8 OQ4) |
| `title` | `settlementCandidacyTitle(doubt.question)` — the same 120-byte, C0/C1-stripped bounded head used for note candidacy (`coordinator.mjs:341`) | The question's display head; injection-safe, UNTRUSTED-framed at read (G7) |
| `detail` | the doubt's full content, verbatim: `doubt.context === null ? doubt.question : \`${doubt.question}\n\n${doubt.context}\`` | "the question verbatim, the worker's own framing" — bounded (question ≤1024B + context ≤2048B < `board.detail` 4096B, so no truncation is possible) |
| `owner` | the member's worker id (`task.assignee ?? task.reservedWorkerId`) | the doubt's author; the answer lane addresses this worker (D6) |
| `evidence` | `[{ coordinationSeq: <elevation seq> }]` | the elevation event seq (G6 accepts `{coordinationSeq}`); provenance is replay-derived from it |
| post key | `board.doubt:${waveId}:${doubtId}` (`doubtId` = the `sharedEntryId`) | content-identity keyed, exactly-once; re-drive of the ritual replays the post idempotently (mirrors the candidacy post key `board.candidacy:${waveId}:${sharedEntryId}`, `coordinator.mjs:11571`) |

- The elevation seq for the evidence is derived from the store event log — the `scratchpad.entry_elevated`
  event whose `payload.entryId` equals the `sharedEntryId`. A post whose elevation event cannot be
  matched is **not** posted; the ritual records a settlement error `doubt_elevation_seq_missing`
  (honest — no orphan item with unverifiable provenance). The post is keyed, so a later re-drive
  completes it exactly once.
- **No Finding, ever.** A doubt board item is posted with `postBoardItem` only — it is never
  `closeBoardItem`d (G5), so no `finding:board-close` is ever minted for a doubt, and no doubt item
  is a candidate to `_deriveWorkflowAdmission` (G10). The taxonomy boundary is preserved: doubts are
  open questions, not facts.

### D3 — The lifecycle: `open → reviewed → answered/dismissed`, each receipted and replay-derived

A doubt's state is a pure function of the durable event log — no clocks, no mutable projection:

| State | Meaning | Receipt(s) | Replay derivation |
|-------|---------|------------|-------------------|
| `open` | The doubt is a live question in its author's worker partition (written, not yet surfaced) | `scratchpad.entry_written` (kind `doubt`) | the entry exists in the worker scope and no elevation event references it |
| `reviewed` | The settle ritual has surfaced the doubt onto the project board; it is queryable and counted | `scratchpad.entry_elevated` + `board.item_posted` (on `project-doubts:${repoId}`) | the board item exists with `state: 'open'` |
| `answered` / `dismissed` | Terminal; the doubt is resolved with a named disposition | `doubt.resolved` + `board.item_dropped` | the `doubt.resolved` event exists for the doubt; the board item carries `state: 'dropped'` |

Because every settling wave elevates every doubt (D1) and posts it (D2), the `open` state is the
worker-partition state only; no doubt a settle ritual touched is left un-surfaced. The `reviewed`
state is exactly the post-elevation, pre-resolution state — the board's open set, which is what the
settle review and the "what doubts are open across this project?" query see.

### D4 — The settle review composition: seen, counted, never dropped

- **Seen.** Every elevated doubt is on `project-doubts:${repoId}` before the shared settle reaps the
  transient successor (D2's post window). The board read is the review surface (G7).
- **Counted.** The wave receipt's `knowledge` block gains two fields, zero as `0` never missing
  (G9): `doubtsAwaitingReview` (the number of doubts this wave elevated + posted) and `doubtBoard`
  (`'project-doubts:${repoId}'`). The post-close campaign record (`_appendWaveClosed`) mirrors both
  fields so campaign state carries the same doubt surface (G9).
- **Honesty invariant.** `doubtsAwaitingReview` must equal the number of doubt board items posted
  for this wave. Every post refusal or elevation error is recorded in the ritual's `errors` block
  and the count reflects only successfully posted items — a silent shortfall (a doubt reaped with no
  board item and no error) is a red-test failure (§7 R5).
- **Project-persistent.** An unanswered doubt stays `open` on the project board past the wave,
  across waves, until resolved. The `scratchpad.entry_elevated` event (the provenance) and the board
  item (the question) both persist; nothing deletes a doubt item. The only entry deleted at settle
  is the transient shared successor, whose content the board item already captured verbatim — this
  is the A6 sink being closed, not reopened: the content is now queried and acted on.

### D5 — Resolution: the embedded command `knowledge.doubt_resolve`

The answerable half. A new embedded-only command (same direct-port discipline as the four
settlement commands, `application.mjs:12493-12500`; never an `APPLICATION_COMMAND_DEFINITIONS` key)
resolves a `reviewed` doubt:

```
knowledge.doubt_resolve {
  waveId,            // the wave that elevated the doubt
  doubtId,           // the doubt's sharedEntryId (D1 provenance anchor)
  disposition,       // 'answered' | 'dismissed'   (closed two)
  reasonCode,        // dismissed only, closed four: 'duplicate' | 'invalid' | 'out_of_scope' | 'resolved_elsewhere'
  answer,            // answered only, ≤4096 bytes (the boundedAttentionText bound)
}
```

Server-side it is a store primitive `resolveDoubtItem(doubtId, fields, auth)` that:

1. **Verifies the doubt.** The elevation event for `doubtId` exists (provenance anchor) and the
   doubt board item is found via the post key `board.doubt:${waveId}:${doubtId}` (the store's
   idempotency map) with `state: 'open'`. Any miss → `doubt_not_found` / `doubt_board_item_not_open`.
2. **Validates the disposition.** `disposition` is in `{answered, dismissed}`; an `answered` doubt
   requires a bounded `answer`; a `dismissed` doubt requires a `reasonCode` from the closed four
   (listed in canonical order). Violations refuse — the resolution never mints an ambiguous record.
3. **Appends one atomic batch** — `doubt.resolved` + `board.item_dropped` (+ `board.claim_expired`
   sibling if the item held an active claim, mirroring the close/drop claim-terminator at
   `coordination-store.mjs:14728-14733`). The item successor is built by the same `_boardSuccessor`
   core (version bump, digest recompute, `state: 'dropped'`) **minus the Finding mint** — the drop
   path never mints (G5), so the resolution is legally disjoint from Finding admission.
4. **Receipts the disposition.** The `doubt.resolved` event carries `{schemaVersion, repoId,
   doubtId, waveId, itemId, disposition, reasonCode?, answer?, evidence: [{coordinationSeq:
   <elevation seq>}], resolvedBy}`. The event is the durable, replay-derived receipt; the dropped
   board item (retained with `state: 'dropped'`) shows the disposition on the board.
5. **Registers the answer push** for `answered` dispositions (D6) — the sanitized answer is queued
   for delivery on the #79 lane.

The resolution command is exactly-once: the auth key `doubt.resolved:${doubtId}` makes a re-drive
replay the prior receipt, and a second resolve of the same doubt refuses `doubt_already_resolved`.

### D6 — The answer loop (compose #79): `doubt_answer` rides the push lane

When a doubt is `answered`, the answer must reach the worker who raised it (the brief's
ANSWERABLE leg). It rides #79's `## Pending attention` delivery seam — the push lane composed at
`_providerBrief` (`coordinator.mjs:3790`, G11). This contract adds **one** push-qualified kind to
#79's D3 set and pins its predicate; it does not re-specify the lane:

- **Kind:** `doubt_answer`, addressed by the doubt item's `owner` (D2) — worker-addressed by worker
  identity, never content (G11 D3).
- **Durable id / dedup key:** `doubt:${waveId}:${doubtId}` — the doubt's durable id. The lane's D5
  dedup law applies verbatim: a re-push is idempotent and the block never double-serves the item.
- **Content:** the sanitized answer — `wrapHubDerived(worker, answer)` → `{worker, text,
  provenance: 'hub-derived', untrusted: true}` (explicitly NOT the trusted `wrapFact`, G11 D1);
  bounded by the lane's per-item mint bound. Rendered `- [attention/untrusted] doubt_answer
  ${waveId}/${doubtId}: …` under the closed `UNTRUSTED_ATTENTION` frame. The doubt's **question** is
  never re-rendered into the answer item — the answer is the hub's text; the worker's framing stays
  on the board.
- **Still-pending predicate (replay-derived, no clock):** the item is pending until the receiving
  worker's first `lifecycle.turn_started` at `seq ≥ <the item's push seq>` with no
  `lifecycle.process_closed` in `(push.seq, turn.seq)` between them — #79 D4's `read` derivation
  verbatim (a respawned process does not inherit reads; the block re-serves the still-pending
  answer). No clocks; the pending set is a pure function of the durable event log.
- **Dependency / honesty.** #79 is a draft at this HEAD (G11). The doubt contract does **not**
  block on it: the `doubt.resolved` event is the authoritative answer receipt, readable from the
  board and the log, so an unanswered-in-the-lane answer is still a recorded answer. When #79
  lands, `doubt_answer` is its first doubt-sourced kind. The red pin is R4 — a `doubt.resolved`
  with `disposition: 'answered'` must have a push-registered `doubt_answer` item for the doubt's
  author, whether or not the lane has shipped.

---

## 4. Refusal vocabulary (typed, red-first)

| Code | Raised by | Meaning |
|------|-----------|---------|
| `doubt_not_found` | resolve | no elevation event for `doubtId`, or no board item via the post key |
| `doubt_board_item_not_open` | resolve | the doubt board item is not `open` (already dropped) |
| `doubt_already_resolved` | resolve | a `doubt.resolved` receipt already exists for the doubt (exactly-once) |
| `doubt_resolution_invalid` | resolve | `disposition` outside the closed two, or an answered doubt without a bounded `answer` |
| `doubt_reason_unknown` | resolve | a `dismissed` doubt's `reasonCode` is outside the closed four |
| `doubt_answer_exceeded` | resolve | `answer` exceeds the 4096-byte bound |
| `doubt_elevation_seq_missing` | ritual (recorded, never thrown) | a doubt's elevation event cannot be matched for the board evidence; the item is not posted |
| `settlement_doubt_post_failed` | ritual (recorded, never thrown) | the doubt board post refused (e.g. `board_title_exceeded`, `board_detail_exceeded`, `invalid_board_evidence`); the doubt is not surfaced this pass |
| `board_title_exceeded` / `board_detail_exceeded` / `invalid_board_evidence` | store | existing board frame refusals reused by the doubt post (G6) |

The ritual's step-refusal discipline (record, never throw — the `settlementLease` pattern) is
preserved: a doubt post failure is captured in the `errors` block and the wave still closes. But it
is **never silent**: the receipt's `doubtsAwaitingReview` counts only posted items, so a failed
post is visible as a shortfall plus an error row.

---

## 5. Red-first acceptance pins

The acceptance gate is red-first: each pin states the behavior that must **fail** before the
landed change may be called compliant.

- **R1 (no auto-candidacy).** RED: closing a doubt board item via `closeBoardItem`, or any path
  that mints `finding:board-close:<itemId>:<itemVersion>` for a doubt item, or a doubt item ever
  entering `_deriveWorkflowAdmission` (G10). The only legal doubt transitions are `postBoardItem`
  (open) → `resolveDoubtItem`'s atomic `board.item_dropped` (dropped).
- **R2 (silent sink closed).** RED: any doubt in a settling member partition that ends the ritual
  with neither a board item nor a recorded error — i.e. `doubtsAwaitingReview` (posted count) plus
  error rows is ever less than the number of doubts the wave held. The count must reconcile
  exactly, replayed.
- **R3 (question verbatim).** RED: a doubt board item whose `detail` does not contain the doubt's
  question byte-for-byte (and its context when present). The worker's framing is preserved, never
  hub-summarized; only the display `title` is a bounded head.
- **R4 (answer deliverable).** RED: a `doubt.resolved` with `disposition: 'answered'` whose answer
  is not registered as a `doubt_answer` push item addressed to the doubt's author (D6). The durable
  receipt and the push registration are minted together; an answered doubt with no push registration
  is a defect even if the lane has not shipped.
- **R5 (unanswered persists).** RED: an unanswered (open) doubt board item that disappears from
  `project-doubts:${repoId}` for any reason other than a `doubt.resolved` + drop. Nothing at settle
  deletes a doubt item.
- **R6 (framing).** RED: a doubt question rendered without the `UNTRUSTED_WORKER_TITLE` mark (G7),
  or a doubt answer rendered without the `[attention/untrusted]` frame and `wrapHubDerived`
  untrusted provenance (G11 D1). A doubt is untrusted-framed everywhere it renders.
- **R7 (receipted transitions).** RED: a doubt whose state cannot be derived as a pure function of
  the durable event log (D3) — e.g. an `answered`/`dismissed` doubt with no `doubt.resolved` event,
  or a `reviewed` doubt with no `board.item_posted`.
- **R8 (zero-as-zero).** RED: a wave receipt whose `knowledge` block omits `doubtsAwaitingReview`
  or `doubtBoard`, or reports a count of zero when the wave held doubts. Zero surfaces as `0`,
  never missing (G9).

---

## 6. Implementation surface (change envelope, not a re-spec)

1. `impl/src/coordinator.mjs` — `settlementLease`: extend the selection filter (D1), collect
   `elevatedDoubts` from the shared partition, widen `materialize`, post doubt items to
   `project-doubts:${repoId}` (D2), return `doubtsAwaitingReview`/`doubtBoard`; add the
   `knowledge.doubt_resolve` coordinator handler (D5).
2. `impl/src/coordination-store.mjs` — new `resolveDoubtItem` primitive + `doubt.resolved` event
   kind + its apply/replay/validation (D5); the doubt board post needs no store change (D2 reuses
   `postBoardItem`).
3. `impl/src/application.mjs` — register `knowledge.doubt_resolve` in the embedded-only settlement
   dispatch (`:12493-12500`), composed with the resolve coordinator handler.
4. `impl/src/wave-driver.mjs` — carry `doubtsAwaitingReview`/`doubtBoard` through the receipt and
   the post-close campaign record (D4).
5. #79 delivery (when it lands) — add `doubt_answer` to the push-qualified set (D6). The doubt
   contract does not gate on it.

---

## 7. Proof scope (red-to-green)

Focused red tests must cover: R1–R8 above; the closed disposition/reason sets; the atomic
resolve+drop batch (a failed append leaves no partial receipt); resolve idempotency and
`doubt_already_resolved`; the reconcile invariant of R2 replayed after a crash mid-ritual; the
frame/injection bounds (control characters stripped from the title head, verbatim question in the
detail); the elevation-seq provenance match and `doubt_elevation_seq_missing`; board read of
`project-doubts:${repoId}` before/after resolution (open → dropped, question always present);
zero-as-zero receipt fields; and the answer push registration (present, addressed to the doubt's
author, bounded, untrusted-framed). Canonical `npm test` must pass.

---

## 8. Open questions (adjudicated)

- **OQ1 — per-wave vs project board.** Resolved: the project board `project-doubts:${repoId}`.
  The brief's "carries into the project's doubt surface (project-persistent, honest)" is a project
  surface, and doubts outlive waves by nature. Per-wave attribution rides each item's evidence
  (the elevation seq carries the wave), and the receipt names the board.
- **OQ2 — `knowledge.promote_doubt` (shape b).** Not adopted in v1 (a `Question`-node mint touches
  the promotion taxonomy; the board already persists and queries). The safe v1.1 successor is a
  `Question` node minted on resolution (G10) if a knowledge-plane doubt projection is wanted.
- **OQ3 — `open_question` grounding (shape c).** Not adopted in v1 (the scratch-fact grounding is
  the closed `['observed','derived']`, `coordination-store.mjs:13925`; introducing a third grounding
  is a taxonomy change #66 should not smuggle in). The board's horizon visibility is the v1 answer.
- **OQ4 — board id bound.** `project-doubts:${repoId}` must satisfy `SAFE_BOARD_ID` (128 bytes).
  Real repoIds are short slugs; a deployment whose repoId exceeds the bound derives a bounded board
  id (an explicitly pinned edge case, not a design fork).
- **OQ5 — resolution authority.** The orchestrator only (`actor: 'orchestrator'`), mirroring the
  settlement-lease authority. Operator resolution is the v1.1 extension.
- **OQ6 — reaps outside the settle ritual.** A doubt in a partition reaped with `basis:
  'task_settled'` but outside a settling wave is out of #66's v1 scope; the review surface is the
  settle ritual (D1 non-goal). Honest deferral, stated.
