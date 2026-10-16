# #66 SUITE FOLD 2 — finding → change map (the blue-team fold)

Source: `suite-blueteam.md` (2026-08-12, verdict **NEEDS-FOLD**, 12 findings — 2 blockers,
3 shallow-greenability, 7 missing-row).
Fold targets:
- `impl/test/doubt-review-red.test.mjs` — the suite (29 rows → **35 rows: 30 RED / 5 PIN**);
- `doubt-review-contract.md` — **v1.1 → v1.2** (only where a finding forces it: Findings 1, 8, 12).

Fold HEAD: the current worktree (`baton/ws-b38ca13e13294fec2ae8881f2ad0b166`), the effective-tree
snapshot the brief runs against. The suite's verified split after the fold (two consecutive runs
from the repo root):

```
$ node --test impl/test/doubt-review-red.test.mjs   # run from repo root
ℹ tests 35 · pass 5 · fail 30 · cancelled 0 · skipped 0 · todo 0   (both runs)
```

The 5 passes are exactly the PIN rows (A2, G1, G2, G3, G4); the 30 failures are the RED rows, each
confirmed to fail at its NAMED stage (the row inventory and each row's first-failing message carry
the stage).

Verdict folding: all **12 findings** resolved with the report's concrete fix. Findings 1 and 8 and
12 force contract changes (the v1.2 fold); every other finding is resolved in the suite alone. The
fold does not touch the contract's shape decision, the state machine, or the D7 derivations.

---

## Findings → changes

| # | Finding (from the blue-team) | Change in the suite | Change in the contract (v1.2) |
|---|---|---|---|
| 1 | **D1/F1 payload contradiction** — D1 pins the 7-field `doubt_resolved` set; F1 asserts `payload.workerId`. Unsatifiable: an impl following D2's literal fails F1; one following D6/R6 fails D1 | **D1** expects the 8-field sorted set `['answeredBy','dismissalReason','disposition','doubtId','pushRequested','resolution','schemaVersion','workerId']` and asserts `payload.workerId === workerId` — the D1 title already claims the push coordinates, the 7-field half was wrong to keep | **D2** `doubt_resolved` payload literal gains `workerId` (the doubting worker — the answer-push address). R6 coordinates updated |
| 2 | **K1 over-pins `read.liveMethod`** — the D3 read row's liveMethod is never contract-named; a correct impl may omit it on a direct-port row | **K1** drops the `read.liveMethod === 'resolveDoubt'` assertion (a comment records the read row's liveMethod is NOT pinned); the `knowledge.promote_doubt` row's `liveMethod: 'resolveDoubt'` stays asserted | — |
| 3 | **Elevation never discriminates doubt kind** — widening the selection to ALL kinds (`note|plan|doubt|link`) passes A1/A2/G1/G3/A3 | **A4** (new RED row): seeds a `doubt` + `link` + `note`, settles, asserts the doubt elevates to shared while the link is disposed `not_elevated`/`orchestrator_skipped` — no shared successor, no board item, no `link` in shared | — |
| 4 | **Wave-scoping unpinned** — a project-wide read (waveId filter ignored) returns the identical single record and passes C3 | **C6** (new RED row): settles wave B FIRST then wave A (the last-settled wave keeps its lease active), reads wave A, asserts wave B's doubt is absent AND every returned record carries `waveId === waveA` | — |
| 5 | **E3's OR oracle too weak** — a settle that silently SKIPS the doubt (leaves it in the worker partition) passes via `stillInWorker` | **E3** oracle tightened to `!stillInWorker && (sharedDoubt \|\| raised)` — the honest settle outcome (the reap dispositions it elevated, never its tombstone) | — |
| 6 | **UNTRUSTED frame answer side unasserted** — no row reads an `answered` record's `resolution` (`wrapHubDerived`) or a non-null `context` (`wrapProse`) | **C7** (new RED row): resolves answered through `knowledge.promote_doubt`, reads back, asserts the exact `{worker, text, provenance: 'hub-derived', untrusted: true}` resolution shape AND the non-null context's exact `wrapProse` frame (`model-authored`, untrusted, the doubting worker's identity) | — |
| 7 | **Spill/shed/sort/keyset/state untested** — `openDoubtsTruncated` only `typeof`-checked; no 9+ doubt overflow, no keyset page, no sort, no state filter | **C8** (new RED row): 10 doubts in one member; asserts `openDoubtsTruncated === true`, `doubts.length <= 8`, the `raisedSeq DESC, doubtId ASC` order law, a `limit:3` keyset page via `before: {c, d}` (disjoint continuation), and the `state: 'answered'` filter returns exactly the resolved one | — |
| 8 | **Three refusal codes surface-only** — `doubt_promote_not_authorized`, `doubt_promote_conflict`, `doubt_carry_conflict` never fire | **K4** (new RED row): (a) direct seam — settle, `sweepSettlementLeases`, resolve → `doubt_promote_not_authorized`; (b) app seam — `knowledge.promote_doubt` twice with a changed binding → `doubt_promote_conflict`; (c) direct seam — resolve answered then sweep → no `knowledge.doubt_carried` for the resolved doubtId (the carry conflict no-ops) | **D4** step 0 (the command-seam conflict check) + step 1 (the v1.2 authority umbrella: no ACTIVE lease — including revoked/absent — refuses `doubt_promote_not_authorized`; expired/foreign-session stay verbatim); **refusal vocabulary** for both codes |
| 9 | **E3's error path untested** — the inventory claims an error-path oracle but the test runs a successful settle | **E3** renamed to the success-path oracle it actually is: "the settle success path never silently drops a doubt" — Finding 5's tightened `!stillInWorker && (sharedDoubt \|\| raised)` assertion covers it; the batch-error honesty is out of scope for this row | — |
| 10 | **`notes+plans ≥ 128` side untested** — only the `doubts ≤ 384` ceiling has a red row | **A5** (new RED row): accumulates 300 doubts + a 100-note final batch (400 total, leaving < 128 note/plan slots) and asserts `scratchpad_partition_exhausted` before any successor/fact/reap. The A5 comment documents the implementable v1.2 floor interpretation: refuse when `doubts > 384` OR (`notesPlans < 128` AND `total > 384`) — A1 (1 doubt) stays sound, A3 (400 doubts) refuses, A5 (400 total, 100 note/plan) refuses | — (Finding 10 needs no v1.2 change; the reservation is already the D1/HOLE-5 contract) |
| 11 | **`doubtId` sha256 unpinned** — `doubtId.startsWith('doubt:')` accepts any stable-but-wrong id | **B1** recomputes `doubt:${digest({schemaVersion: 1, runId, sharedEntryId, sourceEntryId, sourceEntryDigest})}` from the raised event's own payload and asserts it exactly | — |
| 12 | **`doubt_answer:${doubtId}` durable id never asserted** — D6's dedup key is unobservable | **F1** captures the `coordinator.resolveDoubt` receipt and asserts `pushId === \`doubt_answer:${doubtId}\`` verbatim (the durable id rides the resolve receipt — the invented surface the suite names) | **D4** step 5 (the resolve receipt carries `pushId = \`doubt_answer:${doubtId}\``); **D6** bullet; R6 extended |

---

## The new/renamed rows

The suite grows 29 → 35 rows. New RED rows:

| Row | Pin | Named stage (RED at HEAD) | First failing assertion |
|-----|-----|---------------------------|------------------------|
| A4 | D1 selection discriminates kind | the selection does not discriminate the doubt kind | `D1 elevation: a doubt elevates` — the link's `not_elevated` negative control is unobservable because the link never enters the selection |
| A5 | D1 derived floor | no sub-cap prevalidation | `D1 floor: the note batch that leaves < 128 note/plan slots refuses` — no reservation prevalidation exists |
| C6 | D3 wave-scoped read | command missing | `the wave-scoped read dispatches (stage: command missing — got application_command_unavailable)` |
| C7 | D3 answered framing | command missing | `the answered resolve dispatches (stage: knowledge.promote_doubt missing — got application_command_unavailable)` |
| C8 | D3 shed/sort/keyset/state | command missing | `the keyset page dispatches (stage: command missing — got application_command_unavailable)` |
| K4 | refusals surface-only codes | `coordinator.resolveDoubt` missing | `assert.ok(coordinator.resolveDoubt, 'coordinator.resolveDoubt-missing')` |

Changed rows:

| Row | Change |
|-----|--------|
| B1 | `payload.doubtId` asserted as the exact `doubt:${sha256(...)}` derivation (Finding 11) |
| D1 | 8-field payload set + `workerId === workerId` (Finding 1) |
| E3 | Renamed to the success-path oracle; oracle tightened to `!stillInWorker && (sharedDoubt \|\| raised)` (Findings 5/9) |
| F1 | `resolveReceipt.pushId === \`doubt_answer:${doubtId}\`` (Finding 12) |
| K1 | `read.liveMethod` assertion dropped (Finding 2) |

---

## Contract v1.2 (only the three finding-forced seams)

- **D2** — `doubt_resolved` payload literal gains `workerId`; the idempotency-key sentence notes a
  changed request binding conflicts (`doubt_promote_conflict`, D4 step 0).
- **D4** — step 0 (the command-seam conflict check: the committed resolve key with a changed request
  binding refuses `doubt_promote_conflict` before the state guard, which stays `doubt_promote_stale`);
  step 1 (the v1.2 authority umbrella: NO ACTIVE settlement lease — including revoked/absent —
  refuses `doubt_promote_not_authorized`; expired and foreign-session conditions still fire the lease
  codes verbatim, M3 preserved); step 5 (the resolve receipt carries `pushId = \`doubt_answer:${doubtId}\``).
- **D6** — the resolve receipt's `pushId` bullet; the `doubt_resolved` coordinate list already
  carried `workerId` (now a payload field, Finding 1).
- **Refusal vocabulary** — `doubt_promote_not_authorized` re-scoped to the no-active-lease umbrella
  (never a bare store code for the resolve seam; the lease family otherwise verbatim); `doubt_promote_conflict`
  pinned as the command-seam check on the committed resolve key with a changed binding.
- **R6** — the `doubt_resolved` coordinates include `workerId` and the receipt's `pushId`.

---

## What the fold must NOT change (verified sound — preserved intact)

- The shape decision: (b) `knowledge.promote_doubt` as the authority + the durable doubt record as
  the queryable/review surface, on the D4 selection change.
- The state machine's event derivation and the no-clocks law; the idempotency keys
  `doubt_raised:${waveId}:${sharedEntryId}`, `doubt_resolved:${doubtId}`, `doubt_carried:${doubtId}`.
- The D4 taxonomy boundary (answer/dismiss mints no Finding/KG node/board item/`workflow_admitted`/
  scratch-fact); the D7 registry discipline (three rows in the ONE `FRAME_LIMITS`, each derived).
- The five PIN rows (A2, G1–G4) — green today, byte-identical after the fold. The A5 floor is
  implemented as a reservation on the doubt-heavy shared partition, so A1 (a single doubt, zero
  notes/plans) never trips an absolute floor.
- The #79 composition: the push lane is #79's surface; the doubt rung pins the `doubt_resolved`
  coordinates + the receipt's `pushId`, never a wire-acked delivery.
- Suite-law hygiene: hermetic, red-first at named stages, no clocks as controls, no `localeCompare`,
  NUL discipline on the two NUL files.
