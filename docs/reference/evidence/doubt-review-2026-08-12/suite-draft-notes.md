# #66 Suite Draft Notes — `doubt-review-red.test.mjs`

Date: 2026-08-12 · Contract: **doubt-review v1.2** (folded) · Suite: 35 rows (30 RED / 5 PIN)
Deliverable: `impl/test/doubt-review-red.test.mjs` (this draft's only other deliverable).
Authority: `doubt-review-contract.md` (v1.2 source of truth), `contract-fold.md` (the 7 blocker
resolutions — M3 one-code-per-condition, M5 four seams, HOLE-2/3/4/5), `suite-fold-2.md` (the v1.2
blue-team fold — 12 findings), `contract-redteam.md` (attack surface — every pin confirmed RED at
HEAD), `suite-66-brief.md` (this suite's brief), and the idiom suites
`kg-settlement-red.test.mjs` + `bidirectional-v3-red.test.mjs`.

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/doubt-review-red.test.mjs   # run from repo root
ℹ tests 35
ℹ pass 5
ℹ fail 30
ℹ cancelled 0  skipped 0  todo 0
```

Two consecutive runs of the finished suite both produced **pass 5 · fail 30** (the header records
the exact `tests 35 · pass 5 · fail 30 · cancelled 0 · skipped 0 · todo 0` line for both runs). The
5 passes are exactly the five PIN rows (A2, G1, G2, G3, G4); the 30 failures are the red rows, each
confirmed to fail at its NAMED stage (the per-row stage lives in the header row inventory AND in
each row's first-failing assertion message).

## Row map

Every red row fails at the named stage today and goes green on the v1.2 implementation ONLY.
Stages in **bold** are the current HEAD failure seam. All RED rows' first assertion is an
`assert.ok(...)` / `assert.equal(typeof …, 'function', …)` (or a behavior assertion against a real
surface) so the row fails at the stage — never on a vacuous shape assertion that a missing
projection could spuriously satisfy.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1 | D1 | | **note+plan-only selection** | the settle ritual's selection (coordinator.mjs:11513) filters `kind === 'note' \|\| kind === 'plan'`; a doubt-kind entry is never selected, so it never elevates to shared — `shared.entries.some(e => e.kind === 'doubt')` is false and the reap dispositions it `orchestrator_skipped`, not `elevated` |
| A2 | D1 | PIN | byte-identical | green today — a note+plan member elevates note+plan, the note mints its scratch fact (D4.3), the plan carries none, the note candidacy posts, `candidatesAwaitingAdmission` is 1; the doubt work must not move any of these |
| A3 | D1 | | **sub-cap-missing** | `elevateTaskScratchpad` checks ONLY the 512 shared ceiling; the derived 3:1 reservation (doubts ≤ 384, notes+plans ≥ 128 — HOLE-5) is absent, so an accumulated 400-doubt shared partition elevates instead of refusing `scratchpad_partition_exhausted` before any successor/fact/reap |
| A4 | D1 | | **selection-does-not-discriminate** | the settle selection names only note+plan, so the `link` kind's non-selection is unobservable — an impl widening the selection to ALL kinds (note\|plan\|doubt\|link) passes A1/A2/G1/G3 and the link's `not_elevated` negative control has no row to hold it (Finding 3) |
| A5 | D1 | | **sub-cap-missing** | the notes+plans side of the derived reservation is unenforced — 300 doubts + a 100-note batch (400 total, < 128 note/plan slots) elevates instead of refusing `scratchpad_partition_exhausted`; an impl enforcing only the doubt ceiling passes A3 and stays green (Finding 10) |
| B1 | D2 | | **no-doubt-event-kind** | the event inventory has no `knowledge.doubt_raised` kind, so the settle ritual never mints the raise; the durable record's provenance frame (11-field payload + the `knowledge.doubt_raised:${waveId}:${sharedEntryId}` idempotency key) is unobservable, and the pinned `doubt:${sha256(...)}` doubtId derivation has nothing to recompute against (Finding 11) |
| B2 | D2 | | **resolveDoubt-missing** | `coordinator.resolveDoubt` does not exist — the answered (push-armed) and dismissed (closed-reason) transitions are unreceiptable; no `knowledge.doubt_resolved` event can exist |
| B3 | D2 | | **sweep-no-doubt-handling** | `sweepSettlementLeases` retires board candidacies and cancels settlement tasks but mints no `knowledge.doubt_carried`; a doubt still `reviewed` at the review boundary is never carried project-persistent |
| B4 | D2 | | **nothing-to-replay** | with no `knowledge.doubt_raised` event existing, re-driving the same wave has nothing to dedup against — the exactly-once mint (same derived `doubt:sha256` doubtId) is unobservable |
| C1 | D3 | | **doubts-key-missing** | `snapshot().knowledge` has no `doubts` key (the M5 fold is absent) and the `knowledge.doubts` registry row does not exist — the folded projection and its embedded-only/observe/`serverDerived` row shape are both missing |
| C2 | D3 | | **openDoubts-field-missing** | the settle receipt has no `openDoubts` field — the explicit-integer-zero contract (a doubt-free wave receipts `openDoubts: 0`, never missing) is unenforceable |
| C3 | D3 | | **command-missing** | `application.command('knowledge.doubts', …)` is absent — the orchestrator-addressed read throws `application_command_unavailable`; the bounded, sorted, `wrapProse`-framed records and the `openDoubtsTruncated` shed flag never render |
| C4 | D3 | | **command-missing** | the same missing command — a member-worker session is refused `application_command_unavailable` instead of the contract's typed `doubt_surface_unavailable` (D3, HOLE-4); the authority boundary (orchestrator reads, worker never) has no typed refusal |
| C5 | D7 | | **frame-rows-missing** | the three D7 rows are absent from `FRAME_LIMITS`: `view.open_doubts.items`=8 (shed-flagged, derived from `view.knowledge_slice.items`), `view.open_doubts.bytes`=8192 (shed-flagged, the honest sum that renders one answered record), `doubt.resolution.bytes`=4096 (admission, enforced at `resolveDoubt`, derived from `board.detail`) |
| C6 | D3 | | **command-missing** | the wave-scoped read is absent — the cross-run doubt of a second settled wave has no read to leak into; every record's `waveId === requested` filter and the wave-A-only result set are unobservable (Finding 4) |
| C7 | D3 | | **command-missing** | an answered record never reads back — the `resolution` `wrapHubDerived` frame (`{worker, text, provenance:'hub-derived', untrusted:true}`, never `model-authored`/`hub-computed`) and the non-null `context` `wrapProse` frame have no render to assert (Finding 6) |
| C8 | D3 | | **command-missing** | the 10-doubt overflow, the `raisedSeq DESC, doubtId ASC` order law, the `before:{c,d}`/`limit` keyset pages, the `openDoubtsTruncated` shed flag, and the `state` filter are all unobservable (Finding 7) |
| D1 | D4 | | **resolveDoubt-missing** | the answered transition cannot receipt the push coordinates — no `knowledge.doubt_resolved` with the closed 8-field payload (the 7 + `workerId`, Finding 1), `pushRequested: true`, `answeredBy: 'orchestrator'` |
| D2 | D4 | | **resolveDoubt-missing** | the dismissed transition cannot receipt the closed reason — no `knowledge.doubt_resolved` with `disposition: 'dismissed'`, `dismissalReason: 'duplicate'`, `pushRequested: false` |
| D3 | D4 | | **resolveDoubt-missing** | the forge class is unclosed — a foreign session cannot be refused `run_orchestrator_session_mismatch` because the resolve act doesn't exist to re-derive the lease from the session (HOLE-3) |
| D4 | D4 | | **no-record-to-review** | at HEAD there is no `knowledge.doubts` record at all, so the row proves nothing about the state — under the contract the member's own note must never auto-close the doubt (OQ2: the review authority is never bypassed) |
| D5 | D4 | | **resolveDoubt-missing** | the server-re-derived lease has no act to exercise — the call carries only the session, and the correct session must resolve without a caller lease field; the `run_orchestrator_session_mismatch` counter-case closes the forge class |
| D6 | D4 | | **resolveDoubt-missing** | the taxonomy boundary is unenforceable — an answer/dismiss must mint NO Finding/KG node, board item, `workflow_admitted`, or scratch-fact, but without the resolve act the before/after counts cannot be measured |
| E1 | D5 | | **no-raise-to-order** | with no `knowledge.doubt_raised` event kind, the elevate → raise → sweep ordering (raise precedes the sweep's `run.orchestrator_lease_revoked` in one settle invocation) is unobservable |
| E2 | D5 | | **sweep-no-doubt-handling** | an elevated-but-unraised doubt (the OQ4 direct-elevation path) is never carried by the sweep — no `knowledge.doubt_carried` minted alongside the absent raise (HOLE-2's receipted contradiction) |
| E3 | D5 | | **reap-is-the-tombstone** | `elevateTaskScratchpad` IS the worker-scope reap (basis `task_settled`); at HEAD the coordinator selects only note+plan, so the doubt is disposed `orchestrator_skipped` and the reap deletes the whole worker scope — the doubt is silently dropped (HOLE-2). Renamed to the success-path oracle (Finding 9): `!stillInWorker && (sharedDoubt \|\| raised)` — a settle-skip that leaves the doubt in the worker partition is now detected (Finding 5) |
| F1 | D6 | | **resolveDoubt-missing** | the answer push's coordinates (`workerId` = the DOUBTING worker, `doubtId`, `pushRequested: true`, the `doubt_answer:${doubtId}` #79 lane) cannot ride a `knowledge.doubt_resolved` event that never exists; the resolve receipt's `pushId` (D4 step 5, Finding 12) is unobservable |
| K1 | refusals | | **registry-rows-missing** | `knowledge.promote_doubt` and `knowledge.doubts` rows are absent from `APPLICATION_SEMANTIC_REGISTRY.canonicalOperations` — the embedded-only/`liveMethod: 'resolveDoubt'`/`authorityFields`/`serverDerived` shapes are unenforceable; the read row's `liveMethod` is NOT pinned (Finding 2) |
| K2 | refusals | | **refusal-family-missing** | `coordinatorNs.DOUBT_REFUSAL_CODES` does not exist — the frozen 9-code family (`doubt_carry_conflict` … `doubt_surface_unavailable` in ACTUAL sorted order) is not a typed surface constant |
| K3 | refusals | | **resolveDoubt-missing** | none of the six resolve-path scenarios can fire typed — `doubt_promote_invalid` (no bounded resolution), `doubt_dismissal_invalid` (open-ended reason), `doubt_promote_unknown` (unknown doubtId), `doubt_resolution_exceeded` (over-bound), `doubt_promote_stale` (re-resolve), `run_orchestrator_session_mismatch` (foreign session) |
| K4 | refusals | | **resolveDoubt-missing** | the three surface-only codes have no scenario — `doubt_promote_not_authorized` (revoked lease, the D4 authority umbrella), `doubt_promote_conflict` (committed resolve key, changed binding, the command-seam check), `doubt_carry_conflict` (resolve then sweep — the carry no-ops, no stale `doubt_carried`) (Finding 8) |
| G1 | R9 | PIN | note-only-candidacy | green today — a doubt never posts a board item; the candidacy key is the note's shared entry (`scratchpad-entry:`), never a doubtId |
| G2 | OQ3 | PIN | scratchpad-projection | green today — an open doubt is visible on the worker scratchpad projection before any raise (application.mjs:745-748); the D3/OQ3 split keeps the pre-raise surface |
| G3 | D5 | PIN | sweep-still-retires | green today — the sweep still retires note-candidacy board items and cancels the `settlement-task:${waveId}` task; the widened doubt handling must add to this, never disturb it |
| G4 | — | PIN | canonical-byte-order | green today — no `localeCompare` in `coordination-store.mjs`, `coordinator.mjs`, `application.mjs`, `limits.mjs`, or `application-semantics.mjs`; the comparator family stays canonical byte order |

## Invented surfaces

Every invented member is absent at HEAD (the seam the red row holds). The first assertion on every
invented export is an `assert.ok(...)` / `assert.equal(typeof …, 'function', …)` so the row fails
at the named stage — never on a shape assertion that `Object.isFrozen(undefined) === true` could
spuriously satisfy.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `knowledge.doubt_raised` / `knowledge.doubt_resolved` / `knowledge.doubt_carried` — the three durable doubt event kinds (11/8/4-field payloads, folded into `snapshot().knowledge` + the event-kind inventory, M5) | `store.events()` | no such kind (B1–B4, D1–D6, E1, F1) |
| `coordinator.resolveDoubt(runId, doubtId, disposition, session, {resolution, dismissalReason})` — the D4 resolve authority; the active run-orchestrator lease is re-derived server-side from the session, never a caller field (HOLE-3); the answered receipt carries the armed push id `pushId = \`doubt_answer:${doubtId}\`` (D4 step 5) | the coordinator instance | undefined (B2, D1–D6, F1, K3, K4) |
| `application.command('knowledge.promote_doubt', …)` — the D4 command row (embedded-only, `serverDerived` + `authorityFields`, `liveMethod: 'resolveDoubt'`); the command seam surfaces `doubt_promote_conflict` for a committed resolve key with a changed request binding (D4 step 0) | real `APPLICATION_SEMANTIC_REGISTRY` | row absent (K1); command absent (K4(b)) |
| `application.command('knowledge.doubts', …)` — the D3 observe row (embedded-only, orchestrator-addressed); input `{waveId?, state?, before?, limit?}`, output `nextBefore` = the `{c, d}` keyset cursor | real `APPLICATION_SEMANTIC_REGISTRY` / real application | row absent / `application_command_unavailable` (C1/C3/C4/C6/C7/C8) |
| `store.snapshot().knowledge.doubts` — the folded doubt record projection (13-field records, state = latest event for the doubtId) | real store snapshot | `projection.doubts` undefined (C1, D4) |
| `receipt.openDoubts` — the settle receipt's reviewed-doubt count, explicit 0 on a doubt-free wave | `coordinator.settlementLease` receipt | field absent (C2) |
| `coordinatorNs.DOUBT_REFUSAL_CODES` — the frozen 9-code doubt refusal family in ACTUAL sorted order | namespace import `* as coordinatorNs` | no such export (K2) |
| `FRAME_LIMITS['view.open_doubts.items']` = 8 / `view.open_doubts.bytes` = 8192 / `doubt.resolution.bytes` = 4096 — the D7 rows, derived not re-declared | real `FRAME_LIMITS` | rows absent (C5, F1's bound) |
| `wrapHubDerived(worker, text)` — `{provenance: 'hub-derived', untrusted: true}` (the orchestrator's resolution frame) | `messages` export (implicit — the resolution rides the `doubt_resolved` payload) | no such wrapper (C7's frame law, D1) |
| the `knowledge.doubt_resolved` push coordinates — `{workerId, doubtId, resolution, pushRequested: true}`, the `doubt_answer:${doubtId}` durable id | `store.events()` / the resolve receipt's `pushId` | no resolve event (F1, C7) |
| the `knowledge.doubts` output extras — `openDoubtsTruncated` (the explicit shed flag), `nextBefore` (the `{c, d}` keyset continuation cursor), per-record `waveId`/`raisedSeq`/`state` | `application.command('knowledge.doubts', …)` | command absent (C6/C8) |

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **A2** byte-identical | an impl whose D4 selection change disturbs the note+plan elevation — the note's scratch fact (D4.3), the plan's fact-null, the note candidacy, or `candidatesAwaitingAdmission` moves |
| **G1** note-only-candidacy | an impl that lets a doubt post a board item (or keys a candidacy by a doubtId) — R9's note-only law |
| **G2** scratchpad-projection | an impl that removes the open doubt from the worker scratchpad projection pre-raise (the OQ3 split — the wave driver already sees it) |
| **G3** sweep-still-retires | an impl whose widened carry handling stops retiring note-candidacy board items or cancelling the settlement task |
| **G4** canonical-byte-order | an impl that reaches for `localeCompare` for the sorted-key literals (the comparator family is canonical byte order; the suite's own `DOUBT_REFUSAL_CODES_EXPECTED` is the ACTUAL order) |

## What makes each stage go green (implementer's checklist)

- **note+plan-only selection** → D1: the settle ritual's selection (coordinator.mjs:11513) widens to
  select `note`/`plan`/`doubt` EXACTLY — never `link` (A4's negative control); a driven doubt
  elevates to shared, the reap dispositions it `elevated`/`selected` (never `orchestrator_skipped`),
  and a doubt never mints a bridge scratch fact (GT2). A2's note+plan behavior must be byte-identical.
- **selection-does-not-discriminate** → D1: the selection is the exact 3-kind set; a `link` is never
  selected — no shared successor, no board item, disposed `not_elevated`/`orchestrator_skipped`.
- **sub-cap-missing** → D1/HOLE-5: `elevateTaskScratchpad` prevalidates the WHOLE elevation batch
  against the derived 3:1 reservation within the 512 shared ceiling — doubts ≤ 384 and notes+plans
  ≥ 128 — refusing `scratchpad_partition_exhausted` before any successor/fact/reap when the batch
  would break it. The floor is a reservation on the doubt-heavy shared partition: A1 (a single doubt,
  zero notes/plans) stays sound; A3 (400 doubts) and A5 (400 total, 100 note/plan slots) both refuse.
- **no-doubt-event-kind** → D2: the event inventory admits `knowledge.doubt_raised` (11-field
  payload, `doubtId` = `doubt:${sha256({schemaVersion, runId, sharedEntryId, sourceEntryId,
  sourceEntryDigest})}` — B1 recomputes the digest from the event's own payload and asserts it
  exactly, idempotency key `knowledge.doubt_raised:${waveId}:${sharedEntryId}`), minted at the settle
  ritual with the full worker frame (worker/task/wave/question verbatim).
- **resolveDoubt-missing** → D2/D4/D6: `coordinator.resolveDoubt` exists with the signature
  `(runId, doubtId, disposition, session, {resolution, dismissalReason})`; the active
  run-orchestrator lease is re-derived server-side from the session (never a caller field, HOLE-3);
  `answered` receipts `pushRequested: true` + the `answeredBy` + `workerId` push coordinates (the
  8-field `doubt_resolved` payload), `dismissed` receipts the closed `dismissalReason` +
  `pushRequested: false`; the answered receipt carries `pushId = \`doubt_answer:${doubtId}\`` (D4
  step 5); the transition mints `knowledge.doubt_resolved` (idempotency key
  `knowledge.doubt_resolved:${doubtId}`) and NO Finding/KG node/board item/`workflow_admitted`/
  scratch-fact (D6's taxonomy boundary).
- **sweep-no-doubt-handling** → D2/D5: `sweepSettlementLeases` carries any doubt not in
  `answered`/`dismissed` at the review boundary — minting `knowledge.doubt_carried`
  (`carriedBy: 'review_window_expired'`, `carriedSeq` = the event's own seq, idempotency key
  `knowledge.doubt_carried:${doubtId}`); a resolved doubt is NEVER carried (K4(c) — the carry
  conflict no-ops); if the doubt was elevated but never raised, the SAME sweep mints the absent
  `doubt_raised` first and closes the same doubtId (HOLE-2's receipted contradiction).
- **nothing-to-replay** → D2: the mint derives `doubtId` deterministically so a re-drive of the
  same wave replays exactly one `doubt_raised` (the idempotency key dedups the re-mint).
- **doubts-key-missing** → D3/M5: `snapshot().knowledge.doubts` folds the doubt records (state =
  latest event for the doubtId) and the `knowledge.doubts` registry row exists with the pinned shape
  (kernel, embedded-only, `effect: 'observe'`, `serverDerived` = `['actor','principalId','sessionId']`).
- **openDoubts-field-missing** → D3: the settle receipt carries `openDoubts` — the explicit integer
  zero on a doubt-free wave, never missing.
- **command-missing** → D3: `knowledge.doubts` dispatches through the embedded-only observe lane
  (application.mjs:12493-12495), returning bounded, sorted, `wrapProse`-framed records plus the
  explicit `openDoubtsTruncated` shed flag and the `{c, d}` keyset cursor `nextBefore`; a caller
  holding neither the lease nor the orchestrator authority is refused `doubt_surface_unavailable`
  (HOLE-4), never `application_command_unavailable`. The read is WAVE-SCOPED (C6): every returned
  record carries the requested `waveId`, never a cross-run leak; an `answered` record's `resolution`
  renders `wrapHubDerived` and a non-null `context` renders `wrapProse` (C7); the surface sheds at 8
  items, sorts `raisedSeq DESC, doubtId ASC`, pages by `before`/`limit`, and filters by `state` (C8).
- **frame-rows-missing** → D7: the three rows land in the ONE `FRAME_LIMITS` registry, derived not
  re-declared — `view.open_doubts.items` = 8 (shed-flagged, derived from `view.knowledge_slice.items`),
  `view.open_doubts.bytes` = 8192 (shed-flagged, the honest sum that renders one answered record),
  `doubt.resolution.bytes` = 4096 (admission, enforced at `resolveDoubt` → `doubt_resolution_exceeded`,
  derived from `board.detail`).
- **no-record-to-review** → D4/OQ2: a worker's self-resolution note elevates and candidacies
  separately but never auto-closes its doubt — the record stays `reviewed` until the orchestrator
  resolves it.
- **no-raise-to-order** → D5: one settle invocation runs elevate → raise → sweep in that order; the
  raise's seq precedes the sweep's `run.orchestrator_lease_revoked` for a concurrently-expired wave.
- **reap-is-the-tombstone** → D5/HOLE-2: the settle ritual's worker-scope reap dispositions the
  doubt `elevated` (under the D4 selection), so the shared record survives; the honest fate is
  answered / dismissed / carried — never a silent sink and never a settle-skip that leaves the doubt
  in the worker partition (E3's tightened oracle).
- **registry-rows-missing** → refusals: `knowledge.promote_doubt` (embedded-only, distinct from
  `knowledge.promote`, `authorityFields` = `['disposition','doubtId','runId']`, `serverDerived` =
  `['actor','principalId','sessionId']`, `liveMethod: 'resolveDoubt'`) and `knowledge.doubts`
  (the read row's `liveMethod` is NOT pinned — Finding 2) land in the semantic registry.
- **refusal-family-missing** → refusals: `coordinatorNs.DOUBT_REFUSAL_CODES` exports the frozen
  9-code family in ACTUAL sorted order — `doubt_carry_conflict`, `doubt_dismissal_invalid`,
  `doubt_promote_conflict`, `doubt_promote_invalid`, `doubt_promote_not_authorized`,
  `doubt_promote_stale`, `doubt_promote_unknown`, `doubt_resolution_exceeded`,
  `doubt_surface_unavailable` — reusing the snake_case refusal machinery.
- **resolveDoubt-missing (refusal scenarios)** → refusals/M3: the resolve path fires the typed
  family one-code-per-condition — `doubt_promote_invalid` (answered without a bounded resolution),
  `doubt_dismissal_invalid` (dismissalReason outside the closed `['deferred','duplicate','out_of_scope','unfounded']`
  enum), `doubt_promote_unknown` (unraised doubtId), `doubt_resolution_exceeded` (resolution over
  `doubt.resolution.bytes`; the state guard never preempts it), `doubt_promote_stale` (re-resolve of
  a closed doubt), and the lease family verbatim (`run_orchestrator_session_mismatch`) for an
  expired/foreign review window. The three surface-only codes fire in their named scenarios (K4):
  `doubt_promote_not_authorized` for no ACTIVE lease (the v1.2 authority umbrella, including
  revoked/absent), `doubt_promote_conflict` on the command seam for a committed resolve key with a
  changed binding (before the state guard), and `doubt_carry_conflict` as the sweep's no-op for a
  resolved doubt (never a stale `doubt_carried`).

## Suite-law hygiene (verified)

- **Hermetic**: `MockAdapter` (no harness, no network) for the application harness; mock worktrees /
  capture / referee for the coordinator harness; `mkdtempSync` logs and stores; global `test.after`
  cleanup; the deployment-verification stub is the brief's `true` command.
- **Red-first at named stages**: every RED row's first assertion is the named-stage failure (an
  `assert.ok`/`typeof` for invented surfaces, a behavior assertion for the real-surface rows); the
  stage names live in the header row inventory AND in each row's assertion message. 30 RED rows / 5
  PINs, stable across consecutive runs.
- **NUL discipline**: `application.mjs` and `coordination-store.mjs` (3 NUL bytes each) are never
  read whole — only their exports are imported (`BatonApplication`, `CoordinationStore`,
  `CoordinationRefusal`, `Coordinator`). `adapter.mjs`, `coordinator.mjs`, `limits.mjs`,
  `application-semantics.mjs`, `fence.mjs`, and `log.mjs` are NUL-free and read/imported for the
  anchors. The suite file itself is NUL-free.
- **No clocks as controls / no wall-clock assertion**: the direct harness drives a fixed-clock store
  (`FIXED_TS = '2026-08-01T08:00:00.000Z'`); the application harness uses a real-time-anchored store
  clock (the deployment's clock — the store's own monotonic sequencing, never a wall-clock
  assertion). `Date.now()` appears once, only to anchor the application-store clock base. The
  exactly-once and ordering rows assert event seqs, never timestamps.
- **No `localeCompare`**: the `DOUBT_REFUSAL_CODES_EXPECTED` literal and every sorted-key literal in
  the suite are ACTUAL byte order (the G4 pin enforces the same law on the source).
- **Idempotency keys asserted verbatim**: `knowledge.doubt_raised:${waveId}:${sharedEntryId}`,
  `knowledge.doubt_resolved:${doubtId}`, `knowledge.doubt_carried:${doubtId}` — the M5 fold's
  re-drive contract is pinned, not just the payload shapes.
