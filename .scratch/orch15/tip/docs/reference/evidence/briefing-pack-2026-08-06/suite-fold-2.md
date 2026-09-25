# #103 suite-fold-2 — finding → resolution map (blue-team F1-F17 → the folded suite)

Date: 2026-08-06. Fold target: `impl/test/briefing-pack-red.test.mjs` (the red-first acceptance
suite for the folded briefing-pack contract v1.1). Input: `suite-blueteam.md` (verdict
NEEDS-FOLD; 17 findings F1-F17, F1 CRITICAL). This file is the resolution map for all 17
findings. Contract: **stays v1.1** — no finding required contract movement, so
`briefing-pack-contract.md` is untouched (no v1.2 bump).

## Fold-time context

The blue-team reviewed a 19-row snapshot (row names `R-*`, pins `P-*`; measured 3 pass / 16 fail).
Between that review and this fold the suite had been reworked to 26 rows (pins D4-3, A6-2, D6a-3,
A8-2) — a tree that already carried the blue-team's fixes for F3, F7, F8, F13, F17. This fold
reconciled the remaining findings against that tree, added five rows, and re-measured.

| Finding | Class | Resolution |
|---|---|---|
| F1 | CRITICAL broken pin | Rewritten: `P-A7base` → **P-CloseBase** (new PIN row), the `wave.closed`-count fixture check deleted |
| F2 | HIGH oracle | Mint SITE pinned in **A9-1** (penultimate ledger event) + **A1-1** (mint seq = closure seq + 1) |
| F3 | HIGH oracle | Already folded — **D1-1** cross-checks `landings.*` against the `wave.closed` record |
| F4 | HIGH oracle | **A8-1** now asserts sibling VALUES (`packId`, `ledgerHeadSeq`, and `epochLag === K` after the ledger moves) |
| F5 | HIGH oracle | New **A8-4**: behavioral positive drive of the CLI remote doctor render (kills a dead `briefing: null`) |
| F6 | HIGH missing-row | New **D4-4** PIN: the D4 short-circuit's validity leg (same body, different validity still mints) |
| F7 | MEDIUM oracle | Already folded — **B3-1** asserts `response.pack.packId`/`body` equal the live head |
| F8 | MEDIUM missing-row | Already folded — **D9a** reloads a fresh store over the same root and replays the fold |
| F9 | MEDIUM missing-row | New **D2-1**: the D2 one-time migration backfill (fires once, honest-empty body, real snapshotDigest) |
| F10 | MEDIUM oracle | **D9c** now appends a DIFFERENT record with the SAME waveId (kills a content-keyed dedupe) |
| F11 | MEDIUM missing-row | **A6-1** extended to `operator:*`; **A6-2** PIN keeps both `worker:*`/`operator:*` on family `spec` |
| F12 | MEDIUM missing-row | New **A9-2**: failed `wave.closed` append captured into bounded `settlement.errors`, close still completes |
| F13 | MEDIUM oracle | Already folded — **A3-1** pins the drop order on the minted BODY (never a self-reported detail) |
| F14 | LOW determinism | Resolved — `DRIVER_POLICY` timings raised (`stallTimeoutMs 2000→5000`, `hardCapMs 20000→30000`) |
| F15 | LOW oracle | **D1-2** drives 2–3 unknown names and asserts each is named + code `briefing_pack_invalid` |
| F16 | LOW stage-honesty | **B3-4** now uses `assert.rejects(..., code === 'briefing_pack_unavailable')` (both wrong modes land clean) |
| F17 | LOW missing assertion | Already folded — **D6a-1** asserts `Buffer.byteLength(sentence) <= 240` |

Resulting split (two runs from the repo root, identical on both):

```sh
node --test impl/test/briefing-pack-red.test.mjs
```

| Run | tests | pass | fail | duration |
|---|---|---|---|---|
| 1 | 31 | 6 | 25 | 7 332 ms |
| 2 | 31 | 6 | 25 | 8 260 ms |

31 rows = 25 red (each failing at its NAMED stage) + 6 pins (D4-3, A6-2, D6a-3, A8-2,
P-CloseBase, D4-4).

## F1 — CRITICAL: `P-A7base` broken pin (deleted; rewritten as `P-CloseBase`)

- **Finding:** the pin's third assertion demanded zero `wave.closed` events after a real close —
  a "fixture check" that D9's implementation contradicts. Under the correct implementation
  `R-D9a` wants exactly 1; the pin would flip RED, misattributing a valid implementation.
- **Resolution (fold):** the count assertion is gone. New PIN **P-CloseBase** (suite
  `test('P-CloseBase PIN: a real wave close is unconditional with a bounded errors block (no
  briefing seam required)')`) asserts only the close-window base contract: `receipt.basis ===
  'completed'`, `Array.isArray(receipt.settlement?.errors)`, and `errors.length <= 8`. It never
  asserts a `wave.closed` count, so it is green today AND under the implementation and cannot
  contradict D9 (the fold brief's explicit "do not invert to 1" instruction honored).

## F2 — HIGH: the mint SITE is unpinned (pin the post-close window)

- **Finding:** `R-D9a`/`R-A1` asserted existence, shape, and the digest but never the record's
  position in the ledger — a pre-close ritual append passed.
- **Resolution (fold):** two site pins added.
  - **A9-1** asserts the `wave.closed` event is the **penultimate** ledger event:
    `closures[0].seq === store.events().length - 1` and
    `store.events().at(-1).kind === 'context.pack_minted'` — the pack mint is the terminal event,
    so the record must sit immediately before it. (The blue-team proposed the record be TERMINAL;
    in the current suite the pack mint follows the record, so the site is pinned as penultimate —
    the same post-close ordering, pinned to this tree's real event flow.)
  - **A1-1** asserts `mints[0].seq === closureEvent.seq + 1` — the pack mint immediately follows
    the `wave.closed` append.
  - A pre-close append can no longer satisfy either row.

## F3 — HIGH: `landings.*` never cross-checked against the record (already folded)

- **Finding:** a hollow implementation could fabricate `closedAtEventSeq` and zeroed `gates`.
- **Resolution:** already present in the 26-row tree — **D1-1** (row-inventory note: "[F3 — already
  folded here: the landings.* values are cross-checked against the record]") derives each landing
  from the located `wave.closed` event and asserts `closedAtEventSeq === closureEvent.seq`,
  `receiptDigest === record.receiptDigest`, and `gates.*` equal the record's
  `knowledge`/`settlementErrors` values.

## F4 — HIGH: doctor sibling shape-only (values now asserted)

- **Finding:** a fabricated non-enumerable sibling `{packId:'fake', ...}` passed both rows.
- **Resolution (fold):** **A8-1** now captures the staged head (previously discarded) and asserts
  real values: `moved.briefing.ledgerHeadSeq === store.ledgerHeadSeq()`,
  `moved.briefing.packId === head.packId`, and — after K unrelated `spec` mints — `epochLag === K`
  (the sibling tracks the ledger, never a wall clock and never always-zero).

## F5 — HIGH: dead `briefing: null` greenable (behavioral CLI positive path)

- **Finding:** the local-branch `'briefing' in local`/`null` assertions and a `/briefing/` source
  match pass on a dead field; the remote doctor render with a REAL head was never driven.
- **Resolution (fold):** new **A8-4** `test('A8-4: the CLI remote doctor render carries the REAL
  briefing.packId (behavioral positive path — kills a dead briefing:null)')`. It stages a head,
  hosts the deployment resident (`openFixture` with `extraAdvanced: { resident: { env, home, now } }`),
  waits for `deployment.host()`, clears `BATON_*` env vars, and runs `baton doctor --check --depth
  outline` as a child process via the async `runCli` helper (async `spawn`, never `execFileSync` —
  a same-process resident socket server deadlocks under `execFileSync`). Asserts `code === 0`,
  `render.state === 'ready'`, `render.briefing` present, and
  `render.briefing.packId === head.packId`. A `briefing: null` cannot pass.

## F6 — HIGH: the D4 validity leg unpinned (new PIN D4-4)

- **Finding:** all three §E rows re-mint with the SAME validity; a body-only short-circuit passes.
- **Resolution (fold):** new **D4-4** PIN `test('D4-4 PIN: SAME body + DIFFERENT validity still
  mints on a fresh key — the short-circuit compares {body, validity}, never body alone')`. First
  mint `validity: '2999-12-31T23:59:59.999Z'`, then the same body with
  `validity: '2999-12-31T23:59:59.998Z'` on a fresh key → both `'minted'`, a new event, and the
  head moves (`head.packId !== first.packId`). A validity-blind short-circuit fails.

## F7 — MEDIUM: resolve-envelope equality (already folded)

- **Finding:** the resolve lane could return a fabricated pack with a matching `composedAtEventSeq`.
- **Resolution:** already present — **B3-1** asserts `response.pack.packId === minted.pack.packId`
  and `response.pack.body === minted.pack.body` (row-inventory note: "[F7 — already folded here:
  the resolved packId/body are asserted equal to the actual head, never fabricated]").

## F8 — MEDIUM: replay-derived rule unpinned (already folded)

- **Finding:** an in-memory `waveClosureRecords()` map passed; the projection must be rebuilt from
  persisted events.
- **Resolution:** already present — **D9a** constructs a fresh `CoordinationStore(store.root, ...)`
  over the same root after the close and asserts `replayed.waveClosure('wave:d9w1')` returns the
  same record (receiptDigest `'a'.repeat(64)`). A non-replay in-memory map fails the fresh store.

## F9 — MEDIUM: the D2 migration backfill had no row (new D2-1)

- **Finding:** a backfill that never fires — or mints a hollow body — passed the suite untouched.
- **Resolution (fold):** new **D2-1** `test('D2-1: the D2 migration backfill mints exactly one
  honest-empty pack from a non-empty ledger, gated on no head, and fires once')`. Builds a
  non-empty ledger (two `spec` mints, no briefing head), then drives the named invented seam
  `store.backfillBriefingPack({ family: BRIEFING_FAMILY }, { actor: 'orchestrator', key: 'd2-bf' })`
  (guarded `typeof` at stage `backfill-missing`). Asserts the result is `'minted'`; the body
  carries the D1 key set; rings/lanes/landings/parked/blockedOn are honest-empty; and
  `body.sources.snapshotDigest === digest({ ...snapshot, lastSeq: snapshot.lastSeq - 1 })` — the
  real ledger anchor (the backfill mint is the sole post-composition event, context packs are not
  in `snapshot()`). A second call returns `'idempotent'` with a null event — exactly one briefing
  mint total.

## F10 — MEDIUM: content-keyed dedupe passed (D9c now waveId-keyed)

- **Finding:** a second append with the same record object let a content-digest dedupe pass, but
  two different records for one waveId would be wrongly allowed.
- **Resolution (fold):** **D9c** now appends a DIFFERENT record for the same waveId — different
  `receiptDigest` (`'b'.repeat(64)`) and a different `knowledge` block — and still asserts the
  refusal `wave_already_closed` with no event appended. Only a waveId-keyed dedupe passes.

## F11 — MEDIUM: the operator gate surface untested (extended)

- **Finding:** `R-A6` tested only `worker:*`; an impl gating `worker:` specifically passed.
- **Resolution (fold):** **A6-1** now iterates `['worker:alpha', 'operator:alice']` — both actors
  minting family `orchestrator-briefing` refuse `context_pack_forbidden` with no event and no head
  (row-inventory note: "[F11 — the operator surface is pinned, not just worker]"). The **A6-2** PIN
  holds the family-scoped counter-side: the SAME two actors minting the existing family `spec`
  still succeed (kills a gate that locks every family).

## F12 — MEDIUM: the `wave.closed` append-failure path unpinned (new A9-2)

- **Finding:** nothing forced D9 honesty rule 3 for the RECORD (as opposed to the pack).
- **Resolution (fold):** new **A9-2** `test('A9-2: a failed wave.closed append is captured into the
  bounded errors and NEVER blocks close (D9 honesty rule 3)')`. New named seam
  `injectDuplicateWaveClosed: true` on `createWaveDriver` (documented in the invented-surface list
  with error step name `'wave-closed'`): the driver attempts a SECOND `wave.closed` append for the
  same waveId → refused `wave_already_closed`. Asserts `receipt.basis === 'completed'`; an
  `errors` entry with `step === 'wave-closed'` and `code === 'wave_already_closed'`; and exactly
  one persisted `wave.closed`. Guard: `typeof kit.baton._appendWaveClosed === 'function'` at stage
  `record-append-non-gating-missing`.

## F13 — MEDIUM: degradation order pinned on a self-report (already folded)

- **Finding:** the refusal detail's string order was implementation-authored; a fabricated order
  passed.
- **Resolution:** already present — **A3-1** drives a near-miss input through the full degradation
  order to a body that FITS and mints, then asserts the minted body's exact degradation: landings
  dropped oldest-first to the minimum 1 (`body.landings.length === 1`,
  `body.landings[0].waveId === 'wave:07'` — the newest survives), `parked` reason detail dropped
  (`body.parked[0].reasonDigest === undefined`), `rings` lane summaries dropped
  (`body.rings[0].laneSummaryDigest === undefined`), and never `standingLaws`
  (`body.standingLaws.length === 16`), never `composedAtEventSeq` (`=== 100`), never mid-field
  truncation. The drop order has an observable, behavioral anchor on the minted body.

## F14 — LOW: driver-timer flake headroom (resolved)

- **Finding:** `stallTimeoutMs: 2_000` / `hardCapMs: 20_000` left only ~5–8× headroom over the
  measured 2.5–3.6s per wave row; a slow CI scheduler could trip the driver's own watchdog for the
  wrong reason.
- **Resolution (fold):** `DRIVER_POLICY` now `pollIntervalMs: 30, stallTimeoutMs: 5000,
  hardCapMs: 30000, settleTimeoutMs: 1500` — a 2.5× stall budget and 1.5× hard cap over the old
  values, keeping the mock deterministic. (One fixture locally overrides `stallTimeoutMs: 8000`.)

## F15 — LOW: single unknown-name + no code pin (resolved)

- **Finding:** a blanket-refuse-on-seam impl and an unnamed refusal code passed.
- **Resolution (fold):** **D1-2** now loops `for (const unknown of ['mysteryField', 'ghostField',
  'novelField'])`, asserting each refusal carries `error.code === 'briefing_pack_invalid'` AND
  names the exact field in the message — a hardcoded single-name or blanket impl fails.

## F16 — LOW: "never a bare null" surfaced as a code mismatch (resolved)

- **Finding:** a resolving (returning null) wrong implementation produced a confusing
  wrong-reason-looking failure.
- **Resolution (fold):** **B3-4** now uses `await assert.rejects(resolveBriefing(...), (error) =>
  error?.code === 'briefing_pack_unavailable', 'stage: resolve-lane-unavailable-missing — the
  resolve lane refuses with no head, typed, never a bare null')` — both wrong modes (resolves, or
  rejects with the wrong code) land on the stage message cleanly.

## F17 — LOW: ≤240-byte initialize bound unpinned (already folded)

- **Finding:** the row asserted content but not the byte bound.
- **Resolution:** already present — **D6a-1** isolates the briefing sentence from the static brand
  line and asserts `Buffer.byteLength(sentence, 'utf8') <= 240`.

## Contract note

`briefing-pack-contract.md` stays **v1.1**. No finding required contract movement: every fix landed
as a suite-side pin, a new row, or a resolved implementation-side behavior (F14's timer values are
suite fixture tuning, not contract text). All new seams (`backfillBriefingPack`,
`injectDuplicateWaveClosed`, the `'wave-closed'` error step) are suite-named signatures already
documented in the suite's invented-surface list.
