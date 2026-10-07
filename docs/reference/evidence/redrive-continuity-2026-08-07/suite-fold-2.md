# #59 SUITE-FOLD-2 — blue-team findings folded into the red-first suite

Date: 2026-08-07 · Brief: `suite-fold-2-brief.md` · Report: `suite-blueteam.md` (NEEDS-FOLD,
12 numbered findings in §3, F1 CRITICAL) · Contract: **re-drive continuity v1.1** (unchanged —
no contract movement was required).
Deliverable rows land in `impl/test/redrive-continuity-red.test.mjs`; this map records how each
blue-team finding was folded into the suite.

## Result at a glance

| | Before the fold | After the fold |
|---|---|---|
| rows | 24 (19 RED / 5 PIN) | **28 (23 RED / 5 PIN)** |
| split (run 1) | tests 24 · pass 5 · fail 19 | **tests 28 · pass 5 · fail 23** |
| split (run 2) | tests 24 · pass 5 · fail 19 | **tests 28 · pass 5 · fail 23** |
| new RED rows | — | **D6 (no-evidence), D7 (unframable), D8 (oversized), D9 (spill-unavailable)** |
| PIN rows | A3, B3, E1, F4, G2 | **A3, B3, E1, F4, G2** (unchanged — the fold's "must NOT change") |

Every RED row still fails at its NAMED stage (the invented-surface probe is the first assertion);
the five PIN rows stay green on both runs. Deterministic across two consecutive runs from the repo
root.

## Finding → resolution map

F1–F7 are the brief's headline priorities (the report's §3 concrete fixes). Findings 8–12 were also
folded in full; findings 11–12 are contract-adjacent notes, recorded here rather than as new rows.

| # | Priority | Blue-team finding (§3) | Resolution in the suite | Row(s) |
|---|----------|------------------------|-------------------------|--------|
| 1 | **F1 CRITICAL** | E2's R6 no-store-write invariant is vacuous — it asserts `scratchpadSnapshotBatch(...)?.entries`, but the store returns `{runId, observedSeq, fenceTuple, slices}` and the entries ride `slices[i].entries`; `freshEntries` is always `[]`, so a "restore"-implementation sails through E2 green | E2 now reads `(freshScratch?.slices ?? []).flatMap((slice) => slice.entries ?? [])` and asserts the dead-attempt text/digest is absent there; and E2 now ARMS a steering cycle on the fresh attempt (mirroring E1's pause-admission + `scratchpad.write` flow) and asserts the carried dead digest never appears in the answered record's `steering.digestSet` — the carry-path D4/GT8 negative is live, not an empty loop | E2 |
| 2 | **F2** | D1's default-off fixture has no terminalized dead source, so default-off and default-on-when-a-source-exists are indistinguishable | D1 now terminalizes a same-role same-wave dead source with a real scratchpad write, then asserts `_redriveContinuity(handle.id, null) === null`, `undefined === null`, and `_providerBrief(task.brief, handle.id).continuity === null` — the byte-identity claim holds only if the carry is truly opt-in | D1 |
| 3 | **F3** | A6 stages only the dead member's own pin, so a raw-window-scan implementation with no `excludeShas`/report-path disambiguation passes | A6 records a SECOND (foreign) member's checkpoint pin in the same window (same `report: 'results/spec.md'`, overlapping `startedAtMs`, different runId) and asserts its sha (`foreignSha`) is ABSENT from the carried pin list — the list is `{report, startedAtMs, excludeShas}`-derived, never a raw ref scan | A6 |
| 4 | **F4** | A5 and F3 feed pre-sorted fixtures, so the within-block render order is unenforced | Both rows now ROTATE the items array before admission — `rotateItems(items, by)` (deterministic left-rotation, no `Math.random`); A5 renders `rotateItems(continuityBlock().items, 1)` and still asserts the terminal → refusals → scratchpad → pins order; F3 composes `rotateItems(nineItems, 3)` and asserts terminal + refusals re-order to `inBlock[0]`/`inBlock[1]` | A5, F3 (+ `rotateItems` helper) |
| 5 | **F5** | F3 invokes `_composeContinuity(memberId, block)` while the documented surface and D2 describe a 1-arg projection | The invented-surface table now pins the folded signature `_composeContinuity(memberId, continuity)` — the block IS the admission result; every reference (F3, D7, D8, D9, the header, and the implementer's checklist) uses the 2-arg form. No contract change: the v1.1 D2 projection is documented as consuming the admission result | F3, D7–D9, invented-surface table |
| 6 | **F6** | F3's spill resolvability is unexercised and only `scratchpad note 7` is asserted — note 6 can be silently dropped | F3 now mints the spill artifact via `coordinator._coordination.materializeSpill(spillId)`, asserts the citation RESOLVES, asserts BOTH `scratchpad note 6` AND `scratchpad note 7` ride the materialized body, and renders the resolved spill through `_renderContextRead({kind:'spill', spill})` asserting the `UNTRUSTED_READ_CONTENT` frame | F3 |
| 7 | **F7** | Four of the ten v1.1 refusal codes are surface-only: `redrive_carry_oversized`, `redrive_carry_spill_unavailable`, `redrive_carry_unframable`, `redrive_carry_no_evidence` | Four NEW behavior rows fire them: **D6** an empty named scope on the source → `redrive_carry_no_evidence`; **D7** a carried body that IS the `UNTRUSTED_RE_DRIVE` frame literal (un-framable without minting a second frame line — B2's exactly-one-frame pin forces a refusal) → `redrive_carry_unframable` at the render seam; **D8** a 50-item over-bound block with `mintSpill` stubbed to throw → `redrive_carry_oversized`; **D9** a 9-item overflow (needs the spill lane) with `mintSpill` stubbed to throw → `redrive_carry_spill_unavailable`. Each stubs/restores the real `mintSpill` | **D6, D7, D8, D9** (+ `spillLaneUnavailable` helper) |
| 8 | (folded) | The provenance-line-FIRST promise is unasserted | A1 and A2 now assert the `UNTRUSTED_RE_DRIVE` frame text renders BEFORE the first `- [carried/untrusted]` line AND immediately after the `## Re-drive continuity` header | A1, A2 |
| 9 | (folded) | A1/A2 pin the entryId form while the contract permits `${entryId\|digest}` — a 64-hex digest form is contract-compliant but fails the old regex | A1/A2 now accept both forms: `/- \[carried\/untrusted\] terminal (terminal:run:dead:1\|[a-f0-9]{64}):/u` | A1, A2 |
| 10 | (folded) | B2 omits B1's single-line-leaf assertion and counts `UNTRUSTED_` lines whole-output | B2 now asserts `!leaf.includes('\n')` (mirroring B1) and counts exactly one `UNTRUSTED_`-prefixed line in the rendered SECTION (`sectionLines.slice(sectionStart)`), not the whole output | B2 |
| 11 | (note) | C1/C2 hardcode the #69/#79 brief field shapes (`replObjects`, `attention`) — a field-name mismatch breaks both total-order rows even with a correct #59 fold | Recorded as a re-verify note in the fold map (see below): C1/C2 MUST be amended against the actual #69/#79 brief shapes when those folds land; the rows are RED at HEAD for the #59 reason (no continuity slot) and stay that way until #69/#79 ship | C1, C2 (note) |
| 12 | (note) | B1 over-pins one of D1's four neutralization mechanisms — a strip-based neutralization would fail B1 | The suite implements the acceptance reading (preserve-inside-bullet per the amended R3 / #69 B5-R9 discipline); the D1 mechanism-list tension is a contract fix, not a suite fix — recorded, no row change | B1 (note) |

## What each changed row now pins (RED rows, named stage)

- **E2 (D4/R6, no-store-write-missing)** — the R6 invariant reads the REAL store surface
  (`slices.flatMap((s) => s.entries)`, no top-level `entries` field) and is no longer vacuous; the
  fresh steering cycle's answered record must not contain the carried dead digest. First failing
  assertion: `typeof coordinator._redriveContinuity === 'function'`.
- **D1 (D3, redrive-carry-missing)** — a same-role same-wave dead source EXISTS with carried
  content, so the no-carryforward byte-identity claim is proven against something to default to.
- **A6 (D1.2, pin-digest-list-missing)** — a foreign member's same-window pin is staged and must be
  absent from the carried list; the `{report, startedAtMs, excludeShas}` re-resolution inputs ride
  the list.
- **A5 (D1, carried-per-item-frame-missing)** — rotated input; the within-block order holds only if
  the renderer re-orders, never if it preserves input order.
- **F3 (D1/R7, continuity-overflow-spill-missing)** — rotated input, 2-arg `_composeContinuity`,
  full spill round trip (mint → resolve → both overflow notes → `UNTRUSTED_READ_CONTENT` render).
- **D6–D9 (D1, the four refusal-code seams)** — each fires its typed code at the named stage; the
  first assertion on each is the invented-surface probe.

## Notes on findings 11 and 12 (recorded, not folded as rows)

- **Finding 11 (C1/C2 field-shape coupling)** — the total-order rows necessarily name the #69
  `## Cited REPL objects` and #79 `## Pending attention` brief fields before those folds ship. The
  rows are RED at HEAD for the #59 reason (no continuity slot exists), and they stay correct only
  while the #69/#79 field names hold. When those folds land, C1/C2 MUST be re-verified/amended
  against the actual brief shapes; a field-name mismatch is a fold-coordination issue, not a #59
  suite defect. This is recorded in the row map and the implementer's checklist.
- **Finding 12 (B1 mechanism over-pin)** — D1 lists "prefixed/indented/quoted, stripped or
  escaped" as neutralization mechanisms while B1 requires `## Pending attention` to be PRESERVED
  inside the single-line leaf (so a strip-based neutralization fails B1). The suite implements the
  amended R3 acceptance (preserve-inside-bullet, the #69 B5/R9 discipline); tightening the D1
  mechanism list to match is a contract fix (v1.2), not a suite fix. No contract change was made —
  the tension is explicitly documented here so a future contract edit is deliberate.

## Suite-law hygiene (unchanged, re-verified)

Hermetic (ScriptableAdapter, mkdtemp logs, `test.after` cleanup); the deployment-verification stub
is the brief's `true` command; sorted-key literals in ACTUAL order (`REDRIVE_SCOPES` =
`['scratchpad','pins','terminal','refusals']`, the 10-code `REDRIVE_REFUSAL_CODES` key set);
`localeCompare` banned; no clocks as controls (fixed microtask drain; `Date.now()` never appears);
NUL discipline (`application.mjs`/`coordination-store.mjs` never read whole — the store is 3 NUL
bytes; only its exports are imported). The `rotateItems` shuffle is a deterministic left-rotation —
no `Math.random`, the suite stays hermetic and reproducible.

## Verification record

Two consecutive runs from the repo root (`node --test impl/test/redrive-continuity-red.test.mjs`):

```
run 1: ℹ tests 28 · pass 5 · fail 23 · cancelled 0 · skipped 0 · todo 0   (≈233 ms)
run 2: ℹ tests 28 · pass 5 · fail 23 · cancelled 0 · skipped 0 · todo 0   (≈208 ms)
```

The 5 passes are exactly the PIN rows (A3, B3, E1, F4, G2); the 23 failures are the RED rows, each
confirmed to fail at its NAMED stage (the stage name is in the row header AND in the
first-failing assertion message — every row's first assertion is the invented-surface probe).
