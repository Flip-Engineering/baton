# #66 BLUE-TEAM REPORT — the doubt-review red-first suite

Date: 2026-08-12 · Suite under attack: `impl/test/doubt-review-red.test.mjs` (29 rows: 24 RED / 5 PIN)
Target: NOT the contract — the SUITE's red-keeping power against `doubt-review-contract.md` v1.1
(folded) + `contract-fold.md` (the 7 blocker resolutions).
Verification HEAD: `17f7543` ("Baton private effective-tree snapshot").

## Verdict: **NEEDS-FOLD**

The suite does not yet hold its red-keeping power. Two rows of the SAME suite — **D1** and **F1** —
cannot both go green under any single correct v1.1 implementation (Finding 1), so the suite's own
promise ("each pin is RED today and the implementation makes it GREEN") is unsatisfiable as written.
Beyond that hard blocker, the suite leaves three of the brief's named shallow-greenability attacks
open (Findings 3–5) and several contract pins unasserted (Findings 6–12). The fold is the change
set below; none of it touches the contract's shape decision, the state machine, or the D7 derivations.

## Verified split (two consecutive runs from the repo root)

```
$ node --test impl/test/doubt-review-red.test.mjs   # run from repo root
ℹ tests 29
ℹ pass 5
ℹ fail 24
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

- **run 1**: `tests 29 · pass 5 · fail 24 · cancelled 0 · skipped 0 · todo 0`
- **run 2**: `tests 29 · pass 5 · fail 24 · cancelled 0 · skipped 0 · todo 0`
- Stable: the 5 passes are exactly the PIN rows (A2, G1, G2, G3, G4); the 24 failures are the RED
  rows, each failing at its NAMED stage (verified against the per-row failure messages).

## Stage honesty + hermeticity (verified, sound)

- **Named stages at HEAD.** Every RED row's first failing assertion is the named stage in the header
  row inventory AND in the row's message: A1 `coordinator.mjs:11513` note+plan-only selection, A3 no
  sub-cap prevalidation, B1/B2/B3/B4 no doubt event kind / `resolveDoubt` missing / sweep no doubt
  handling / nothing to replay, C1/C2 `knowledge.doubts` absent / no `openDoubts` field, C3/C4
  `application_command_unavailable`, C5 rows absent from `FRAME_LIMITS`, D1–D6 `resolveDoubt`
  missing, E1 no raise to order, E2 sweep no doubt handling, E3 reap-is-the-tombstone, F1
  `resolveDoubt` missing, K1/K2/K3 rows missing / refusal family absent / `resolveDoubt` missing.
  Confirmed against the emitted failure messages; nothing fails on a vacuous shape assertion.
- **Hermetic.** `MockAdapter` for the application harness; mock worktrees/capture/referee for the
  coordinator harness; `mkdtempSync` for every store/log/repo dir with `test.after` cleanup; the
  only child process is local `git init`/`git commit` in a temp dir; no network; `Date.now()`
  appears only to anchor the application-store clock base (the deployment clock, never a wall-clock
  assertion). No order dependence: each row builds a fresh harness; module-level state is frozen
  constants and the cleanup array only.
- **Fixed-clock discipline.** The direct harness drives a fixed-clock store; the application harness
  uses a real-time-anchored store clock. The exactly-once and ordering rows assert event `seq`,
  never timestamps. The `localeCompare` ban (G4) and the sorted-key literals are ACTUAL byte order.

## Citation verification (grep/sed, NUL discipline respected)

The two NUL files — `impl/src/application.mjs` and `impl/src/coordination-store.mjs` — each carry
exactly 3 NUL bytes and were touched only with `grep`/`sed` (never whole-file reads); their anchors
were verified at the verification HEAD and every anchor the suite cites reads clean:

- `coordinator.mjs:11513` — the settle selection `filter((entry) => entry.kind === 'note' || entry.kind === 'plan')` (the D1 seam).
- `coordination-store.mjs:14244-14246` — the shared-ceiling prevalidation `sharedIds.length + selected.length > MAX_SCRATCHPAD_SHARED_ENTRIES` (512; `:525`), the seam the A3 sub-cap extends.
- `coordination-store.mjs:14257-14271` — `if (source.kind === 'note')` builds the `scratch.fact_posted` bridge; `:14278` `scratchFactId: factPayload?.id ?? null` (GT2, A1's fact-null oracle).
- `coordination-store.mjs:14296-14305` — the task-settle reap: `result: 'elevated' / reasonCode: 'selected'` under `steering`, else `not_elevated / orchestrator_skipped | no_driver` (`:14304`) (A1's disposition oracle).
- `coordination-store.mjs:14360-14364` — `settleWorkflowScratchpad` dispositions notes → `not_eligible/min_readers`, everything else → `not_eligible/type_ineligible` (GT3).
- `coordination-store.mjs:12555-12600` — `sweepSettlementLeases` revokes with `review_window_expired` (event `run.orchestrator_lease_revoked`), cancels the settlement task, retires open board items; the seam the widened carry (B3/E1/E2) extends.
- `coordination-store.mjs:15901` — `_deriveKnowledgePromotion`'s `fact.grounding !== 'observed'` filter (GT5, R9 structural pin).
- `coordinator.mjs:11522-11526` — the shared-partition scan collects `entry.kind === 'note'` only (D2 raise scan seam); `:11532` `materialize` gates on `elevatedNotes.length` (D5 step-4 seam); `:11567-11576` board candidacy posts keyed `board.candidacy:${waveId}:${note.sharedEntryId}`; `:11580` `candidatesAwaitingAdmission: elevatedNotes.length` (C2's alongside-count seam).
- `coordinator.mjs:11552-11559` — the leaseId derivation (D4's server-side re-derivation seam).
- `application.mjs:726-728` / `:745-748` — `scratchpadProse` wraps doubt question/context (`{worker, text, provenance: 'model-authored', untrusted: true}`) in `projectScratchpadContent` (GT7/OQ3, G2's oracle).
- `application.mjs:12493-12495` — the settlement direct-port dispatch branch (`_settlementCommand` for `scratchpad.elevate | scratchpad.settle | knowledge.promote | knowledge.settlement_lease`) (D3's dispatch seam).
- `application-semantics.mjs:1418-1439` — `board.claim`/`board.report` embedded-only precedent (M1's corrected anchor); `:1512-1514` — `knowledge.promote`'s `serverDerived`/`authorityFields` discipline.
- `limits.mjs:65` `board.detail` (4096, admission) — the `doubt.resolution.bytes` derivation source; `:101` `view.knowledge_slice.items` (8, shed-flagged) — the `view.open_doubts.items` derivation source; `:40-42` `composeFrameLimitRefusal` — the refusal-text composer. The three D7 rows are absent from the registry today (C5 is RED as claimed).
- `mcp-northbound.mjs:108/:138/:613` — `baton_knowledge_settlement_lease` is a live MCP tool gated by the `settlement` capability class (the M1 correction's evidence).

No `knowledge.doubt_*` event kind exists in the event-kind inventory; `SCRATCHPAD_KINDS` already
admits `doubt` at the store admission grammar (`coordination-store.mjs:535`, `:612`, `:645-650` —
question ≤ 1,024 B, context ≤ 2,048 B or null), so the "no doubt event kind" seam (B1/B4) is real.

---

## Findings

### Blockers (the suite cannot go green under a correct v1.1 implementation)

**Finding 1 — D1 and F1 contradict each other on the `doubt_resolved` payload field set.**
- **Row/gap:** D1 (answered + push coordinates) and F1 (answer addresses the doubting worker).
- **Attack:** green-side oracle contradiction — the suite cannot all go green.
- **Details:** D1 asserts `Object.keys(payload).sort()` is exactly the 7-field set `['answeredBy',
  'dismissalReason', 'disposition', 'doubtId', 'pushRequested', 'resolution', 'schemaVersion']`
  (the D2 payload literal, which carries **no** `workerId`). F1 asserts `resolved.payload.workerId
  === workerId` — the D6/R6 push coordinate `{workerId, doubtId, resolution, pushRequested: true}`.
  The contract itself is internally split: D2's literal omits `workerId`, while D6 and R6 require
  the resolved event to carry it. The fold's blocker-6 fix (D6 retitle + R6 extension) updated the
  coordinates but never reconciled D2's literal. Every event in this store is
  `{schemaVersion, seq, ts, kind, actor, idempotencyKey, payload}` (`coordination-store.mjs:8875`
  `events()`), so `workerId` can only ride the payload — there is no envelope seat to hide it in.
  An implementer who follows D6/R6 (adds `workerId`) fails D1; one who follows D2's literal (7
  fields) fails F1. At least one RED row stays red forever.
- **Concrete fix:** add `workerId` to the D2 `doubt_resolved` payload literal and to D1's expected
  sorted set (8 fields: the current 7 + `workerId`). D1's own title already claims to receipt "the
  push coordinates", so the 7-field assertion is the wrong half to keep.

**Finding 2 — K1 over-pins the `knowledge.doubts` read row's `liveMethod`.**
- **Row/gap:** K1 (registry rows).
- **Attack:** green-side over-specification — a contract-faithful implementation can fail.
- **Details:** K1 asserts `read.liveMethod === 'resolveDoubt'` for the read row. The contract D3
  pins the read's embedded-only/observe shape, its direct-port dispatch branch, and its
  authorization, but never names a `liveMethod` for the read row (the registry's `liveMethod`
  convention is a dispatch seam, and D3 says the read is dispatched through a hardcoded
  if-chain, not auto-routed by `liveMethod`). A correct impl may name the observe row's gate
  differently (or omit `liveMethod` on a direct-port row) and still satisfy every D3 clause — yet
  fail K1. The `knowledge.promote_doubt` row's `liveMethod: 'resolveDoubt'` (K1's other assertion)
  is contract-pinned (D4) and sound; only the read row is over-pinned.
- **Concrete fix:** drop the `read.liveMethod` assertion, or pin the read row's `liveMethod` in the
  contract first (e.g. as the shared resolve-authority seam) and only then assert it.

### Shallow-greenability (RED rows go green under an incorrect implementation)

**Finding 3 — the elevation rows never discriminate the doubt kind from the other kinds.**
- **Row/gap:** A1/A2/G1 (D1 elevation + R9 candidacy).
- **Attack:** "could the elevation rows pass with doubt KIND not discriminated (any entry
  elevating)?" — yes.
- **Details:** A1 seeds only a `doubt`; it proves a doubt CAN elevate, not that the selection is
  exactly note/plan/doubt. An implementation whose settle selection widens to ALL scratchpad kinds
  (`note | plan | doubt | link`, i.e. simply dropping the kind filter) passes A1 (doubt elevates),
  A2 (note/plan path byte-identical), G1 (board candidacy still collects `elevatedNotes` only,
  `coordinator.mjs:11522-11525`), G3 (sweep unchanged), and — if the sub-cap is implemented — A3.
  The `link` kind's non-selection is the unasserted negative control. The contract pins the
  selection to `entry.kind === 'note' || entry.kind === 'plan' || entry.kind === 'doubt'`
  (`coordinator.mjs:11513`).
- **Concrete fix:** add a row that seeds a member with a `doubt` AND a `link` (and, say, a `note`),
  settles, and asserts the doubt elevates while the `link` is disposed `not_elevated` (never
  `elevated`, no shared successor, no board item).

**Finding 4 — the queryable surface's wave-scoping is not pinned: a cross-run read passes.**
- **Row/gap:** C3 (D3 read).
- **Attack:** "could the queryable-surface rows pass with a wave-scoped read that secretly reads
  cross-run?" — yes.
- **Details:** C3 seeds ONE wave with ONE doubt and asserts the envelope `runId`/`waveId` and
  `doubts[0]`'s 13-field shape. It never asserts every returned record's `waveId === requested
  waveId`, and with a single seeded wave a project-wide read (the `waveId` filter silently ignored)
  returns the identical record and passes. The envelope check (`outWaveId === waveId`) is
  satisfied by echoing the requested waveId while leaking cross-run records. C4 pins WHO may read
  (authority) but not WHAT the wave-scoped read returns. The brief's named attack is therefore
  open.
- **Concrete fix:** seed a second wave with a distinct doubt (its own `doubtId`), read the first
  wave, and assert the returned set is exactly the first wave's records — the second wave's
  `doubtId` absent — and that every returned record carries `waveId === requested waveId`.

**Finding 5 — E3's OR oracle is too weak: a doubt left in the worker partition passes.**
- **Row/gap:** E3 (D5 no-silent-sink).
- **Attack:** "could the settle rows pass with doubts silently dropped on the error path?" — a
  weaker cousin: the settle silently SKIPS the doubt and the row still passes.
- **Details:** E3 asserts `stillInWorker || sharedDoubt || raised`. Under a correct impl the
  worker-scope reap (`elevateTaskScratchpad` IS the reap, basis `task_settled`) removes the doubt
  from the worker partition, so `stillInWorker` is false and the row passes via `sharedDoubt`/`raised`
  — fine. But an incorrect impl that never elevates/raises the doubt and simply LEAVES it in the
  worker partition (skipping the reap) also passes via `stillInWorker`. That is a settle-skip the
  contract forbids (D1 elevates, D2 raises, the reap disposes), and E3 does not detect it.
- **Concrete fix:** tighten the oracle to the honest settle outcome — the doubt is absent from the
  worker scope AND present in (shared OR raised) — i.e. assert `!stillInWorker && (sharedDoubt ||
  raised)`, which also aligns the test with its header description ("the reap is never its
  tombstone").

### Missing-row gaps (contract pins with no red row — the implementation can be wrong and stay green)

**Finding 6 — the resolution's UNTRUSTED frame (`wrapHubDerived`) is never asserted; non-null
context framing is never asserted.**
- **Row/gap:** C3/D1 (R8/HOLE-7).
- **Attack:** "the UNTRUSTED framing assertion on rendered questions AND answers" — the answer side
  is unasserted.
- **Details:** C3 asserts the question's `wrapProse` frame (`{provenance: 'model-authored',
  untrusted: true}`) but only on a `reviewed` record whose `context` is `null` and `resolution` is
  `null`. No row reads an `answered` record and asserts `resolution` renders via `wrapHubDerived`
  (`{provenance: 'hub-derived', untrusted: true}`, never `model-authored`, never `hub-computed`),
  and no row reads a record with non-null `context` and asserts its `wrapProse` frame. The suite's
  own invented-surface list names `wrapHubDerived` but no assertion ever touches its output.
- **Concrete fix:** add a row that resolves a doubt `answered`, reads it back through
  `knowledge.doubts`, and asserts the `resolution` wrapper's exact `{worker, text, provenance:
  'hub-derived', untrusted: true}` shape and that `context` (seeded non-null) is `wrapProse`-framed.

**Finding 7 — the spill/shed behavior, the sort order, and the keyset predicate are untested.**
- **Row/gap:** C3 (D3 bounds + ordering + keyset).
- **Attack:** "the spill resolvability" — the overflow and its keyset continuation are unasserted.
- **Details:** C3 checks only `typeof openDoubtsTruncated === 'boolean'`. It never renders 9+
  doubts to flip the `view.open_doubts.items = 8` shed flag true, never renders an answered record
  inside `view.open_doubts.bytes = 8192`, never exercises `before`/`limit` (the spelled-out keyset
  `raisedSeq < c || (raisedSeq === c && doubtId > d)` for a cursor `{c, d}`), never seeds 2+ doubts
  to assert the `raisedSeq DESC, doubtId ASC` sort, and never passes the `state` input filter.
  A wrong-order, unpaginated, or unshed read passes C3 with a single record.
- **Concrete fix:** add a multi-doubt row (e.g. two waves of several doubts, one resolved) that
  asserts: descending `raisedSeq`/ascending `doubtId` order; `openDoubtsTruncated === true` when
  the item bound is exceeded; one keyset page via `before`/`limit`; and the `state` filter.

**Finding 8 — three of the nine refusal codes are surface-only, never fired in a scenario.**
- **Row/gap:** K2/K3 (refusal vocabulary).
- **Attack:** "every v1.1 refusal code" — 6 of 9 are scenario-fired.
- **Details:** K3 fires `doubt_promote_invalid`, `doubt_dismissal_invalid`, `doubt_promote_unknown`,
  `doubt_resolution_exceeded`, `doubt_promote_stale`, and the lease code
  `run_orchestrator_session_mismatch`. K2 proves the constant carries the other three, but no row
  fires them: `doubt_promote_not_authorized` (resolve for a runId holding no active lease),
  `doubt_promote_conflict` (same `knowledge.doubt_resolved:${doubtId}` key with a different request
  binding), and `doubt_carry_conflict` (a sweep carry for a doubt a resolve just closed; the resolve
  wins, the carry no-ops). An implementation that never enforces these three codes passes the suite.
- **Concrete fix:** add scenario rows — (a) `resolveDoubt` with a valid session on a settlement run
  whose lease was already revoked → `doubt_promote_not_authorized`; (b) re-issue the same resolve
  key with a different resolution through the store seam → `doubt_promote_conflict`; (c) resolve a
  doubt, then sweep its wave → the carry no-ops with `doubt_carry_conflict` surfaced (or is
  provably skipped) rather than minting a stale `doubt_carried`.

**Finding 9 — the settle-error path is not exercised (E3's header overstates the row).**
- **Row/gap:** E3 (D5).
- **Attack:** "could the settle rows pass with doubts silently dropped on the error path?" — the
  error path is untested.
- **Details:** The row inventory names E3 "settle error leaves doubts intact (batch reap loses the
  doubt)", but the test runs a SUCCESSFUL settle — no error is injected. An implementation whose
  settle step errors on a doubt's elevation/raise and drops the doubt (no raise, no carry, no
  shared successor — a silent sink) is not exercised. The named stage (reap-is-the-tombstone at
  HEAD) is real, but the error-path honesty the inventory claims is not asserted.
- **Concrete fix:** either inject a settle-step failure (e.g. a raise-refused doubt or a blocked
  elevation batch) and assert the doubt is still receipted or carried — never a bare drop — or
  rename the row to the success-path oracle it actually is (which Finding 5's tightened assertion
  already covers).

**Finding 10 — the `notes+plans ≥ 128` side of the derived sub-cap is untested.**
- **Row/gap:** A3 (D1/HOLE-5).
- **Attack:** HOLE-5 is half-pinned.
- **Details:** A3 accumulates 400 doubts and asserts the `doubts ≤ 384` side refuses
  `scratchpad_partition_exhausted`. The contract's reservation is two-sided — "within the 512,
  doubts ≤ 384 AND notes+plans ≥ 128" — and the notes+plans side has no red row: an implementation
  that enforces only the doubt ceiling (never reserving the 128 note/plan slots) passes the suite.
- **Concrete fix:** add a complementary accumulation that drives the shared partition's notes+plans
  below 128 (e.g. 300 doubts + a note batch that would leave < 128 note/plan slots) and asserts the
  same `scratchpad_partition_exhausted` refusal before any successor/fact/reap.

**Finding 11 — the `doubtId` sha256 derivation is unpinned.**
- **Row/gap:** B1/B4 (D2 replay identity).
- **Attack:** exactly-once identity without the derivation.
- **Details:** B1 asserts only `doubtId.startsWith('doubt:')`; B4 asserts the id is stable across a
  re-drive. The contract pins `doubt:${sha256({schemaVersion, runId, sharedEntryId, sourceEntryId,
  sourceEntryDigest})}`. An implementation minting `doubt:${sharedEntryId}` (or any stable-but-wrong
  id) passes both rows — the collision-resistance and scope-binding the sha256 supplies are never
  asserted.
- **Concrete fix:** in B1, recompute the pinned digest from the seeded fields and the raised
  event's own payload, and assert `payload.doubtId === 'doubt:' + sha256(...)` exactly.

**Finding 12 — the `doubt_answer:${doubtId}` durable push id is never asserted.**
- **Row/gap:** F1 (D6).
- **Attack:** answer-push addressing is half-pinned.
- **Details:** F1 asserts the resolved event's coordinates (`workerId`, `doubtId`, `pushRequested:
  true`, bounded `resolution`) but never the #79 durable id `doubt_answer:${doubtId}` that D6 pins
  as the push item's dedup key. An implementation that arms the push with a different durable id
  passes the suite.
- **Concrete fix:** in F1, assert the durable id derivation (either on the resolved event or on the
  `doubt_answer` item the resolve arms) — `doubt_answer:${doubtId}` verbatim.

---

## What held (verified sound, not folded)

- The fixture engineering: every RED row's fixture can mint its needed state under a correct v1.1
  implementation — a doubt entry (A1/B/D/E/F/K rows), a wave with a live settlement lease (E1's
  two-wave ordering, B3/E2's sweep boundary), an active review window for `resolveDoubt` (the
  fixed-clock lease is live at resolve time). No fixture dead-ends against the fold.
- The A2/G1/G2/G3/G4 PINs are the right wrong-implementation killers as designed (the D1 non-doubt
  path, R9 note-only candidacy, the OQ3 scratchpad split, the D5 sweep additions, and the byte-order
  law), and all five stay green across both runs.
- The stage labels and the sorted-key literals are ACTUAL byte order; the D7 rows' derivations
  (`view.open_doubts.items` ← `view.knowledge_slice.items` 8; `view.open_doubts.bytes` 8192 ≥
  1024+2048+4096; `doubt.resolution.bytes` ← `board.detail` 4096) match the registry's existing
  class conventions (`limits.mjs:65`, `:101`).
- The D4 forge-class closure is structurally sound: `resolveDoubt`'s signature takes no lease
  argument (D5 asserts the session-only call), so a caller-supplied lease has no seat; D3/D5 close
  the foreign-session path with the typed lease code.
