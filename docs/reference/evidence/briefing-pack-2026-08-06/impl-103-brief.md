# #103 IMPL BRIEF — implement the briefing-pack lane (the orchestrator's L0 pack)

Implement the #103 epic: make `impl/test/briefing-pack-red.test.mjs` green with ZERO weakening
edits. Read fully, in order: (1) `briefing-pack-contract.md` (**v1.1** — the folded contract:
D9's `wave.closed` campaign-state record is the centerpiece; D1's field→store-source table; the
staleness honesty; the doctor-JSON additive field); (2) `impl/test/briefing-pack-red.test.mjs`
(31 tests: 6 green PIN rows, 25 red at named stages — every row is your target; the header
carries the invented-surface signatures); (3) `contract-fold.md` + `suite-fold-2.md` (the folded
oracles: the D9 mint site at the wave driver's guaranteed post-close window, exactly-once via
`wave_already_closed`, replay-derived, non-gating with bounded settlement.errors).

## The shape (from the contract)

- **D9 `wave.closed`** — minted exactly once per wave at the post-close window (after
  `wave.close()` + the receipt build, before the receipt write); closed canonical-JSON shape
  `{ waveId, receiptDigest, rings ≤8, lanes ≤16, parked ≤8, blockedOn ≤8, knowledge,
  settlementErrors ≤8 }`; replay-derived (the fold builds the `_waveClosures` map by waveId like
  the `context.pack_minted` fold); a second append refuses `wave_already_closed`; non-gating
  (mint failure captured into bounded errors, never blocks close); no clocks (its own event seq
  is the epoch anchor).
- **The briefing pack** — one content-backed pack per wave family at close (D1 closed schema,
  recomputable packId, the closing wave in landings, snapshot-digested sources); a field with no
  ledger source refuses by name; the staleness Δ counts ledger events since composition (never
  wall time) with the "no events since" disclosure on idle ledgers.
- **The surfaces** — the doctor JSON gains the briefing as a named additive field (never a text
  render; the serialized output is byte-stable for non-reading consumers — the P-A8b PIN);
  `context.briefing` resolves the head pack with the UNTRUSTED frame + epoch lag, refusing
  `briefing_pack_unavailable` (typed, never a bare null) when no head; the MCP initialize carries
  the briefing sentence with a head (and the honest-empty sentence without); a worker cannot mint
  the orchestrator-briefing family (`context_pack_forbidden`).
- **The N2 ordering** — the D4 content short-circuit fires BEFORE the auth-key replay check (or
  per-settlement-unique keys — whichever v1.1 states; the D4-3/D4-4 PINs pin both legs).
- **The A7 overflow seam** — the injected overflow path forces `briefing_pack_overflow` into the
  bounded settlement.errors with the pinned drop order; the wave stays closed.

## Laws + verify

Campaign law: controls eval-able/constructive/conversational, NEVER clocks or turn-limits;
scanners shape-only; `localeCompare` banned; sorted-key literals in ACTUAL sorted order; NUL
discipline (`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs` only). **The
#141 boundary-commit law: commit at natural subsystem boundaries.** If a row appears
unsatisfiable-as-written, STOP and write the contradiction to
`docs/reference/evidence/briefing-pack-2026-08-06/impl-blocker.md` (that file IS in your scope —
the #142 lesson is folded into this wave's member scope).
Verify from the repo root, ALL green, record the splits:
`node --test impl/test/briefing-pack-red.test.mjs` (31/31) ·
`node --test impl/test/workflow-surface-red.test.mjs` ·
`node --test impl/test/wave-driver-red.test.mjs` ·
`node --test impl/test/mcp-reflex-surface-red.test.mjs`.

## Scope

`impl/src/**` + `docs/reference/evidence/briefing-pack-2026-08-06/impl-blocker.md` (the evidence
exception). Do NOT edit any test file.
