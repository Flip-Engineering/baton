# Briefing-pack suite — blue-team review (issue #103)

Date: 2026-08-06. Target: `impl/test/briefing-pack-red.test.mjs` (19 rows) — the red-first
acceptance suite for the folded briefing-pack contract v1.1. Blue-team method per the brief:
read `briefing-pack-contract.md` (v1.1) → `contract-fold.md` → the suite → `suite-draft-notes.md`
in order; run the suite twice from the repo root and record both splits; verify citations against
the current tree (`grep -an`/`sed -n` on the two NUL files); then attack every red row on the five
axes — shallow-greenability, oracle weakness, missing-row gaps, stage honesty, hermeticity +
determinism. The suite was NOT edited; this map records what the suite must change.

Worktree HEAD: `506d8aa` (Baton private effective-tree snapshot). NUL discipline held: NUL byte
counts confirmed (`coordinator.mjs` 0, `application.mjs` 3, `coordination-store.mjs` 3); every
`coordination-store.mjs` anchor re-verified with `grep -an`/`sed -n` only. All contract anchors
resolve in this tree (G7b's re-pinned deployment anchors at :1316/:1335-1336/:1343/:1344, the
`context.pack_minted` fold at :8723-8731, `_prepareContextPackPayload` :13127-13155, spill dedupe
:13217-13220, `snapshot()` :11550, the closed `contextRead` kind switch, the MCP initialize
:1309-1319, the CLI doctor parser :1258-1264, the `baton.mjs` doctor render :79-93).

## 1. Measured split (two runs, identical)

Command (from the repo root, exactly):

```sh
node --test impl/test/briefing-pack-red.test.mjs
```

| Run | tests | pass | fail | duration |
|---|---|---|---|---|
| 1 | 19 | 3 | 16 | 13 727 ms |
| 2 | 19 | 3 | 16 | 14 142 ms |

Identical both runs: **16 fail / 3 pass of 19**. Green pins: `P-A8b`, `P-N2c`, `P-A7base`.

## 2. Stage honesty (verified against both runs)

All 16 red rows fail at their NAMED stage, with the stage marker in the failing assertion message:

| row | named stage | actual failing assertion (both runs) |
|---|---|---|
| R-D9a | `record-mint-missing` | 0 `wave.closed` events after a real wave close |
| R-D9b | `record-append-missing` | `appendWaveClosed` is `undefined` |
| R-A1 | `briefing-compose-missing` | 0 `context.pack_minted` for `orchestrator-briefing` at close |
| R-A3 | `schema-closure-missing` | seam → `wave_driver_policy_invalid` |
| R-A5a / R-A5b | `resolve-lane-missing` | `context.briefing` → `application_command_unavailable` |
| R-A8a | `doctor-field-missing` | `doctor.briefing` absent |
| R-A8c | `doctor-field-missing` | `'briefing' in local` false at `outline` |
| R-N2a | `content-short-circuit-missing` | fresh-key re-mint returns `'minted'` |
| R-N2b | `content-short-circuit-missing` | same-key re-mint throws `context_pack_conflict` |
| R-A6 | `actor-pin-missing` | worker mint does NOT throw (any actor mints) |
| R-D7a / R-D7b | `resolve-lane-missing` | `context.briefing` → `application_command_unavailable` |
| R-A7 | `overflow-path-missing` | seam → `wave_driver_policy_invalid` |
| R-A4a / R-A4b | `initialize-line-missing` | static brand line, no briefing sentence |

No row fails before its fixture checks on a wrong-reason path at HEAD. Stage honesty is clean for
the pre-implementation tree — with the caveat in Finding F1 that one PIN is a time-bomb.

## 3. Findings

### F1 — CRITICAL (broken pin): `P-A7base` contradicts `R-D9a` and flips RED under the correct implementation

- **Row:** `P-A7base` (suite :935-943).
- **Attack:** The pin's third assertion requires `events().filter(kind === 'wave.closed').length === 0`
  after a real wave close with `settlement: 'kg-ritual'` — explicitly labeled a "fixture check"
  of the pre-implementation state. But D9 mandates the wave driver append exactly one `wave.closed`
  record in the guaranteed close window for EVERY real close, and the suite's own red row `R-D9a`
  requires exactly 1 in the identical scenario. Both cannot be green after the correct
  implementation; `P-A7base` will flip to RED the moment D9 lands, misattributing a valid
  implementation as a failure. A pin is defined as green today AND green under the correct
  implementation (suite header, row inventory §I) — this one breaks that contract. The brief's
  own axis list asks "does every row fail at its NAMED stage at HEAD, or do some fail
  earlier/later"; this is the reverse direction — a row that will fail AFTER the fix.
- **Fix:** delete the third assertion (the `wave.closed`-count fixture check). The pin's purpose —
  the guaranteed-close window is unconditional with a bounded `settlement.errors` block — is fully
  carried by the first two assertions (`basis === 'completed'` and
  `Array.isArray(receipt.settlement.errors)`). Do not "fix" it by inverting the count to 1: that
  duplicates `R-D9a` and adds nothing.

### F2 — HIGH (oracle weakness): `R-D9a`/`R-A1` never pin the `wave.closed` mint's SITE — a pre-close mint passes

- **Row:** `R-D9a` (:512-545), shared by `R-A1` (:572-622).
- **Attack:** The brief's own probe — "could a wave.closed record minted at the wrong site — not
  the guaranteed post-close window — still pass?" — answers YES. `R-D9a` asserts existence, closed
  shape, bounds, `receiptDigest`, and the projection, but never that the record's event seq is the
  ledger's terminal seq. A shallow implementation that appends the record as a PRE-close ritual
  step (before `wave.close()`) passes `R-D9a` and, with the pack minted at the same wrong site,
  `R-A1` too. That violates D9's "after close" ordering AND honesty rule 3 (non-gating): a
  pre-close append that throws could abort close — a path no row currently exercises (see F12).
- **Fix:** in `R-D9a`, assert `closedEvents[0].seq === coordination.events().length` — the
  `wave.closed` event is the final ledger event of the close (the driver appends nothing
  ledger-visible after the receipt build; the file write at `wave-driver.mjs:806-809` is not a
  ledger event). Belt-and-suspenders: also assert `closedEvents[0].seq >` every closing run's
  `run.sealed` seq.

### F3 — HIGH (oracle weakness): `R-A1`'s `landings.*` values are never cross-checked against the `wave.closed` record — fabricated `closedAtEventSeq`/`gates` pass

- **Row:** `R-A1` (:572-622).
- **Attack:** The D1 field→store-source table names the landings sources: `closedAtEventSeq` = the
  record's own event seq, `gates.admitted` = the record's `knowledge.admittedThisRun`,
  `gates.refused` = the record's `settlementErrors` count, `gates.candidatesAwaitingAdmission` =
  the record's `knowledge.candidatesAwaitingAdmission`. `R-A1` asserts only that `closedAtEventSeq`
  is a positive safe integer and `gates` has the right key set — a hollow implementation can
  fabricate any positive integer and zeroed gates and still pass. The content-backing the fold
  promised (B4 resolution) is only half-pinned: the body is "not hollow" about WHICH wave landed,
  but not about the landing's SOURCE values.
- **Fix:** after locating the `wave.closed` event in `events()`, cross-assert
  `landing.closedAtEventSeq === closedEvent.seq`,
  `landing.gates.admitted === closedEvent.payload.knowledge.admittedThisRun`,
  `landing.gates.refused === closedEvent.payload.settlementErrors.length`, and
  `landing.receiptDigest === closedEvent.payload.receiptDigest`.

### F4 — HIGH (oracle weakness): `R-A8a`/`P-A8b` assert the doctor sibling's shape but never its values — a fabricated sibling passes

- **Row:** `R-A8a` (:707-724), `P-A8b` (:726-734).
- **Attack:** Both rows assert the sibling's key set, non-enumerability, and the zero-lag case
  only. A shallow implementation can attach a non-enumerable `briefing` sibling with fabricated
  values — `{packId:'fake', composedAtEventSeq:0, ledgerHeadSeq:0, epochLag:0}` — and pass both.
  Nothing checks the sibling's `packId` equals the staged head, and nothing exercises the sibling
  after the ledger has moved, so an always-zero or wall-clock lag passes.
- **Fix:** capture the staged head (the `mintHead` result is currently discarded) and assert
  `doctor.briefing.packId === head.packId`,
  `doctor.briefing.composedAtEventSeq === head.observedSeq`, and
  `doctor.briefing.ledgerHeadSeq === coordination.events().length`. Add a second scenario that
  appends K events after staging and asserts `doctor.briefing.epochLag === K`.

### F5 — HIGH (oracle weakness): `R-A8c` is greenable by a dead `briefing: null` — the CLI's positive path is never behaviorally exercised

- **Row:** `R-A8c` (:736-748).
- **Attack:** The row asserts `'briefing' in local` and `local.briefing === null` for a hermetic
  no-connection home, plus a source-text `/briefing/` match in `baton.mjs`. All three pass on a
  shallow implementation that adds a dead `briefing: null` field to `inspectBatonConnection`
  output and a stray "briefing" reference in the render path. The D6c clause's real behavior —
  the CLI reads the non-enumerable sibling by property access and renders the REAL pack in the
  remote doctor branch (`baton.mjs:87-93`, `briefing: remote.briefing`) — is never asserted with
  a real head. The local branch's `briefing` is always null by design, so the local assertion
  cannot distinguish a wired CLI from a dead field.
- **Fix:** drive the positive path — `deploymentKit` already reaches a real store; stage a head,
  point the CLI at that deployment (connection env vars or the deployment's connection file), run
  the remote doctor render, and assert the output's `briefing.packId === head.packId`. At minimum,
  add a scenario with a reachable connection and assert `briefing` is populated (non-null), not
  always null.

### F6 — HIGH (missing-row): the D4 short-circuit's VALIDITY leg is unpinned — a body-only (validity-blind) short-circuit passes all three §E rows

- **Row:** `R-N2a` (:754-773), `R-N2b` (:775-794), `P-N2c` (:796-811).
- **Attack:** All three rows re-mint with the SAME validity; `P-N2c` changes only the body. D4
  compares `{body, validity}`. A shallow implementation that short-circuits on the body alone (or
  a hash of the body alone — the brief's own probe) — ignoring validity — passes all three rows
  while breaking "same state, same address" whenever validity differs.
- **Fix:** add a row — first mint; re-mint the SAME body with a DIFFERENT validity (fresh key) and
  assert `result === 'minted'`, a new event, and the head moves. This is `P-N2c`'s twin for the
  validity leg and kills the body-only short-circuit.

### F7 — MEDIUM (oracle weakness): `R-D7a` never asserts the resolved `packId`/`body` equal the actual head — a fabricated resolve envelope passes

- **Row:** `R-D7a` (:839-861).
- **Attack:** The row asserts the envelope's key set, `composedAtEventSeq === composed`, `epochLag`,
  `ledgerHeadSeq`, the frame, and a non-empty body — but never `response.pack.packId ===
  contextPackHead().packId` nor `response.pack.body === head.body`. A resolve lane returning a
  fabricated pack with the correct `composedAtEventSeq` passes.
- **Fix:** capture the head and assert `response.pack.packId ===
  coordination.contextPackHead('orchestrator-briefing').packId` and `response.pack.body ===
  head.body`.

### F8 — MEDIUM (missing-row): D9 honesty rule 1 (replay-derived) is not actually pinned — `waveClosureRecords()` could be an in-memory map and `R-D9a` still passes

- **Row:** `R-D9a` (:512-545).
- **Attack:** The row asserts the projection returns the record in the same process. A shallow
  implementation that keeps an in-memory array of records — never a replay fold over `wave.closed`
  events — passes `R-D9a` while violating the store's replay-exactness law (G2, D9 rule 1).
- **Fix:** after the close, reload the store from the same root (`new
  CoordinationStore(kit.driver.coordination.root)` — the store exposes `root`) and assert
  `waveClosureRecords()` on the reloaded store returns the same record. That forces the projection
  to be rebuilt from the persisted `wave.closed` events.

### F9 — MEDIUM (missing-row): the D2 migration backfill (B2's resolution) has NO row

- **Row:** none.
- **Attack:** v1.1's D2 promises a one-time backfill mint at the first session start after an
  upgrade, gated on `no head AND ledger non-empty`, composed from the historical ledger with
  honest-empty campaign-state shapes and `sources.snapshotDigest` anchored to the real ledger.
  This is a headline fold resolution (B2) with zero suite coverage — a backfill that never fires,
  or mints a hollow body, passes the suite untouched.
- **Fix:** add a row that builds a non-empty ledger (a few runs/spills) with no briefing head,
  triggers the session-start backfill seam (a named invented surface per D2), and asserts exactly
  one pack mints, the body's campaign-state fields are honest-empty, and `sources.snapshotDigest`
  equals the live snapshot digest.

### F10 — MEDIUM (oracle weakness): `R-D9b`'s exactly-once dedupe is keyed trivially — a content-keyed (non-waveId) dedupe passes

- **Row:** `R-D9b` (:547-566).
- **Attack:** The row calls `appendWaveClosed` twice with the SAME record object. A shallow
  implementation that dedupes on the record's content digest (e.g., `receiptDigest`) rather than
  `waveId` passes, but wrongly allows two different records for the same waveId — violating A9's
  "one wave, one record".
- **Fix:** make the second append a DIFFERENT record (different `receiptDigest` and `knowledge`
  block) with the SAME `waveId`, and assert it still refuses `wave_already_closed` with no event.

### F11 — MEDIUM (missing-row): the D3 actor gate's operator surface is untested — an impl allowing `operator:*` to mint the briefing family passes `R-A6`

- **Row:** `R-A6` (:817-837).
- **Attack:** `R-A6` tests only `worker:*`. D3 says "operators do not mint (the campaign's own
  composition is the orchestrator's voice)". A shallow implementation that gates on `worker:`
  specifically — or forgets to gate `operator:*` — passes `R-A6` while violating D3's authority
  table.
- **Fix:** add an in-row assertion — `actor: 'operator:alice'` minting `orchestrator-briefing` must
  refuse `context_pack_forbidden` with no event, while the same operator minting an existing
  family still succeeds.

### F12 — MEDIUM (missing-row): the `wave.closed` append-failure path is unpinned — D9 honesty rule 3 applies to the RECORD, not just the pack

- **Row:** none (`P-A7base` covers the no-seam case; `R-A7` covers the pack-overflow case).
- **Attack:** D9 rule 3 promises a failed `wave.closed` append is captured into the bounded
  `settlement.errors` and never blocks close. Nothing forces that path: `P-A7base` (after F1's
  fix) proves "no seam → closes"; `R-A7` proves "pack overflow → closes"; neither proves
  "`wave.closed` append throws → still closes". Combined with F2, the record's non-gating is the
  least-pinned D9 honesty rule.
- **Fix:** add an injectable seam on the record append (e.g., a policy field that makes the driver
  attempt a duplicate append → `wave_already_closed` → captured into `settlement.errors` ≤ 8) and
  assert the wave still closes with basis `'completed'`. Name the seam in the invented-surface
  list so an implementer knows the RECORD's non-gating is a tested requirement.

### F13 — MEDIUM (oracle weakness): `R-A7`'s degradation-order pin reads the refusal's self-reported detail — a fabricated drop ledger passes

- **Row:** `R-A7` (:878-902).
- **Attack:** The row drives `overflowInject: true` so the body overflows past the full
  degradation order and the pack never mints — the only observable is the `briefing_pack_overflow`
  refusal's `detail`, which the implementation authors. The row checks string-index order inside
  that detail (`landings` before `parked` before `rings`), never a degraded body. A wrong-order
  (or no-degradation) implementation that writes the detail text in the correct order passes. The
  B4 degradation-order promise is pinned only as a self-report.
- **Fix:** add a near-miss row using a finer seam (e.g., `overflowInject` becomes a count, or the
  suite injects a known number of oversized landings) so correct degradation produces a body that
  FITS and mints; assert the minted body's exact degradation — oldest landings dropped to the
  minimum (1), `parked` detail reduced, `rings` lane summaries reduced, never
  `standingLaws`/`composedAtEventSeq`, never mid-field truncation. That gives the drop order an
  observable, behavioral anchor.

### F14 — LOW (determinism, the #7 flake class): the wave rows ride real driver timers with a 2s stall budget and a 20s hard cap

- **Row:** every `runWave` row (`R-D9a`, `R-A1`, `R-A3`, `R-A7`, `P-A7base`).
- **Attack:** `DRIVER_POLICY` sets `stallTimeoutMs: 2_000`, `hardCapMs: 20_000`. The mock adapter
  completes deterministically, but in the canonical gate (3,400+ tests, parallel files) an
  event-loop stall past 2s trips the driver's stall machinery (unproductive budget 1) and past
  20s aborts the wave — the fixture check `basis === 'completed'` then fails for the WRONG reason
  (a flake, not a contract miss). Measured per-wave-row 2.5–3.6s leaves only ~5–8× headroom.
- **Fix:** raise the wave fixture's `stallTimeoutMs` (e.g., 5_000) and `hardCapMs` (e.g., 30_000)
  so a slow CI scheduler does not trip the driver's own watchdog; keep the mock deterministic.
  The suite total (~14s for this file) is acceptable under parallel `node --test`.

### F15 — LOW (oracle weakness): `R-A3` tests a single unknown-field name and never pins the refusal code — a blanket-refuse-on-seam impl passes

- **Row:** `R-A3` (:624-645).
- **Attack:** The row injects one field name (`'ghost'`). A shallow implementation that refuses
  whenever `briefing.composeUnknownField` is set — without checking the field against the D1
  source table — passes, and the refusal code is never asserted (the contract's §3 reuses
  `context_pack_invalid` for malformed mint shape; the row only requires a briefing-step error
  that names the field).
- **Fix:** drive the seam with 2–3 different unknown names and assert each is named in the refusal
  detail (kills a hardcoded single-name impl); optionally assert the refusal code is
  `context_pack_invalid`.

### F16 — LOW (stage-honesty/UX): `R-D7b`'s "never a bare null" failure mode surfaces as a confusing code mismatch

- **Row:** `R-D7b` (:863-872).
- **Attack:** If a wrong implementation makes `context.briefing` RESOLVE (return `null`) with no
  head, `assert.fail` inside the try throws, the catch catches that AssertionError and asserts
  `error?.code === 'briefing_pack_unavailable'` — the failure reads as a code mismatch and the
  "never a bare null" intent is lost. Still red (correct direction), but a wrong-reason-looking
  failure that will confuse the implementer.
- **Fix:** use `assert.rejects(resolveBriefing(kit.application), (error) => error?.code ===
  'briefing_pack_unavailable')` so both failure modes (resolves, or rejects with the wrong code)
  produce a clean, stage-named message.

### F17 — LOW (missing assertion): the D6a initialize sentence's ≤240-byte bound is unpinned

- **Row:** `R-A4a` (:908-921).
- **Attack:** The contract bounds the briefing sentence to ≤240 bytes; the row asserts content (the
  packId, `minted at event N`, the `context.briefing` name) but not the bound. A shallow
  implementation emitting an oversized sentence passes.
- **Fix:** assert `Buffer.byteLength` of the briefing sentence (isolated from the static brand
  line) is ≤ 240.

## 4. Verdict: NEEDS-FOLD

The suite is a strong red-first skeleton — 16/16 red rows fail at their named stages, the split is
deterministic across two runs, and the fixture idioms are hermetic. But it is not implementation-
safe: **F1** is a pin that flips RED under the correct D9 implementation (a wave-blocking defect on
its own), and F2–F13 leave concrete shallow-greenability or missing-row gaps on the contract's
headline promises — the post-close mint site (F2), the D1 field-source mapping (F3), the doctor
sibling values (F4), the CLI positive path (F5), the D4 validity leg (F6), the D9 replay-derived
law (F8), the D2 backfill (F9), the D9 record non-gating (F12), and the degradation order (F13).
Fix F1–F6 before the implementation wave starts; fold the rest into the suite along the way.

Per the blue-team laws, both suite runs and the citation re-verification are recorded above (sections
1 and 2); no clocks were introduced and no NUL file was byte-read.
