# Briefing-pack contract — fold of contract-redteam.md (issue #103)

Date: 2026-08-06. Source: `contract-redteam.md` (RT-103, deepseek wave — NOT FOLD-READY, 5
blockers + 5 non-blocking). Target folded: `briefing-pack-contract.md` (v1.0 → **v1.1**).
Result: **FOLD-READY** — every blocker (B1-B5) and non-blocking finding (N1-N5) resolved. The
red-team report was NOT edited; this map records what the contract now says.

---

## Blocker → change map

### B1 — D1's schema is not composable from the ledger; D8's ledger-only law is unsatisfiable
**Chosen fix: (b) add the missing ledger facts — the `wave.closed` campaign-state record.**
- **New D9** defines the record: one new event kind `wave.closed`, closed canonical-JSON shape
  `{ waveId, receiptDigest, rings ≤8, lanes ≤16, parked ≤8, blockedOn ≤8, knowledge,
  settlementErrors ≤8 }`.
- **Mint site** (D9): the wave driver's guaranteed post-close window — after `wave.close()`
  (`wave-driver.mjs:763-768`) and the receipt build (`wave-driver.mjs:773-804`), before the
  receipt file write (`wave-driver.mjs:806-809`); `receiptDigest` is the digest of the exact
  receipt object written to `policy.evidencePath`. Appended by the same embedded top-level
  principal path that runs the ritual (`baton._runSettlementRitual`,
  `application-client.mjs:1586`).
- **Honesty rules** (D9): (1) replay-derived — the fold builds a `_waveClosures` map by
  `waveId` exactly like the `context.pack_minted` fold (:8723-8731); composition reads only
  that map. (2) exactly once per wave — a second append refuses `wave_already_closed` (§3,
  new code). (3) non-gating — minted after close, captured into bounded errors on failure.
  (4) no clocks — its own event seq is the epoch anchor.
- **D1 re-scoped with a field→store-source table**: every schema field names its ledger source
  (`rings`/`lanes`/`parked`/`blockedOn` from the latest `wave.closed` record; `landings.*`
  from the `wave.closed` records — `closedAtEventSeq` = the record's own seq, `gates.refused`
  = the `settlementErrors` count, `receiptDigest` from the record; `standingLaws` = the pinned
  config, the ONE named non-ledger input; `sources` digests the live `snapshot()` (:11550) and
  the law list).
- **G11 added** (the store's durable projections stop at the campaign boundary) to record the
  factual basis.
- **D8 amended** to name `wave.closed` records as the ring/lane/parked/blocked-on source.
- **OQ1 resolved** — the bridge is now specified in-contract.

### B2 — The first pack and the mint's pre-close timing
- **D2 amended**: `briefing.mint` moves AFTER `wave.close()` (post-close, in the guaranteed
  window), so the closing wave's `wave.closed` record — hence its landing — exists before
  composition. A single-wave-then-idle campaign shows its only wave in its own pack, never one
  wave behind.
- **One migration backfill** (D2): an upgraded deployment mints one backfill pack at the first
  session start after upgrade, gated on `no head AND ledger non-empty`, composed from the
  historical ledger + `wave.closed` records + the standing-law config; honest-empty shapes
  where no record exists; `sources.snapshotDigest` anchors it to the real ledger (not a hollow
  body). It is the sole exception to the no-session-start-mint rule; it fires once.
- **`closedAtEventSeq` pinned in D1**: the `wave.closed` record's own event seq; null only for
  waves that predate this contract (honest-empty, never fabricated).

### B3 — The staleness law measures ledger activity, not campaign-content staleness
- **D5(c) rewritten**: Δ measures LEDGER-HEAD MOVEMENT ONLY (events appended since
  composition), never wall time and never campaign-content freshness; an operator reading Δ as
  content-freshness is systematically wrong on idle deployments. Every serve discloses the
  semantics verbatim (`Δ counts ledger events since composition, not wall time or campaign
  state`) and, when Δ = 0, adds the `no events since event N` disclosure (the idle case), so a
  frozen-small Δ cannot read as "verified fresh".
- **v1.0's `staleness unknown` dead branch DELETED** (the lag is always computable) rather than
  left as a shallow-greenable hole.

### B4 — Acceptance pins A1/A3/A5 are shallow-greenable
- **A1 content-backed**: `landings` must contain the closing wave's landing and
  `sources.snapshotDigest` must equal the live `snapshot()` digest at mint — a hollow body
  that parses to the closed schema fails.
- **A3 order-pinned**: the suite drives an overflow and asserts the exact drop order
  (drop-oldest-`landings` min 1 → `parked` reason detail → `rings` lane summaries; never
  `standingLaws`/`composedAtEventSeq`; never mid-field truncation) — a wrong-order degradation
  that still fits the ceiling fails.
- **A5 idle-pinned**: after mint with no further events, serve → Δ stays 0 and the `no events
  since` disclosure is present; the `staleness unknown` branch is gone.

### B5 — D6(c)'s CLI rendering surface is mis-cited and conflicts with D6(b)
- **D6(c) rewritten** (per the recommended pick): the CLI doctor adds ONE named enumerable
  `briefing` field to its JSON output at every depth, sourced from the non-enumerable sibling
  by property access, in the real render path (`impl/scripts/baton.mjs:79-93`, local branch
  :82, remote branch :93). The briefing rides the doctor JSON as a named additive field —
  NEVER a text render.
- **D6(b) restated**: byte-stability holds for consumers that do NOT read the sibling (the
  non-enumerable property is invisible to `Object.keys`/`JSON.stringify`); the CLI is a reading
  consumer and legitimately differs.
- **A8 updated** to match (named additive field at all four depths; byte-identity scoped to
  non-reading consumers).

---

## Non-blocking → change map

- **N1 — Header verification-HEAD drift.** Header bumped to v1.1; anchors re-verified at HEAD
  `fc6470a`. `impl/src/application-deployment.mjs` shifted +2 lines vs `403f539` (a
  deepseek-ceiling policy comment at ~:845); its four anchors re-pinned in G7b
  (`doctorReadiness()` :1314→:1316, `Object.defineProperty` :1333-1334→:1335-1336, `card()`
  :1341→:1343, `doctor()` :1342→:1344; comment quote :1324-1330→:1328-1332). Section 6 updated.
- **N2 — D4 ordering vs the auth-key replay.** D4 now orders the content short-circuit BEFORE
  the auth-key replay check (:13159-13163), with the reason stated (the recomputed
  `validityVersion` at :13146 makes the payload digest differ, so the auth-key check alone
  would throw `context_pack_conflict` on a stable key or append a new event on a fresh key —
  neither satisfies A2). The auth-key check then handles true replays it did not absorb.
- **N3 — Resolve-lane naming.** D6(a)'s instruction sentence now reads "resolve via the
  orchestrator's embedded context.briefing command" and names the lane as an
  orchestrator-facing embedded command, NOT an MCP tool — so the reader does not look for it
  in the MCP tool table.
- **N4 — OQ2 config exception.** D8 now states the standing-law list is the ONE named exception
  to the never-the-working-tree rule (read from pinned deployment config, not the live working
  tree, pinned by `lawListDigest`); OQ2 repeats it.
- **N5 — A7's failure-forcing gap.** A7 now requires the composition step to be a named seam
  the suite can drive to failure (an injected overflowing input forces
  `briefing_pack_overflow` into the guaranteed-close window's bounded errors, ≤8) and the wave
  stays closed — the failure clause is exercised, not dead.

---

## New surface introduced (count)

- 1 new decision (D9 — the `wave.closed` campaign-state record).
- 1 new refusal code (`wave_already_closed`).
- 1 new acceptance pin (A9 — the `wave.closed` record is durable, exactly once).
- 1 new ground truth (G11 — the store's durable projections stop at the campaign boundary).
- OQ1 resolved in-contract (the ring/lane bridge is D9); OQ2 clarified (config exception).

## Campaign law

- **No clocks**: the `wave.closed` record carries no wall-clock-derived claim (its own event
  seq is the epoch anchor); the backfill's trigger is a durable absence + durable state, never
  a clock; staleness stays epoch-only (D5c).
- **Citations verified against the current tree** (HEAD `fc6470a`) via `grep -an`/`sed -n`;
  NUL files (`application.mjs`, `coordination-store.mjs`) read via `grep`/`sed` only.
