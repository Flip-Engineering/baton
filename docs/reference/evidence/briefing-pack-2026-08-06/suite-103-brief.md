# #103 SUITE BRIEF — red-first suite for the briefing-pack contract v1.1

You are drafting the **red-first acceptance suite** for the folded briefing-pack contract. Read
fully, in order: (1) `briefing-pack-contract.md` (**v1.1** — the folded contract; your source of
truth) in this directory; (2) `contract-fold.md` (what changed v1.0 → v1.1 — the new **D9
`wave.closed` campaign-state record** is the fold's centerpiece and must be pinned); (3)
`contract-redteam.md` (the attack surface the suite must hold); (4) suite idioms:
`impl/test/workflow-surface-red.test.mjs` (facade staging) and
`impl/test/claim-preflight-red.test.mjs` (authority/projection pins).

## Coverage (derive the row inventory from the v1.1 acceptance pins A1–A7 + D9)

- **D9 record** — minted exactly once per wave at the post-close window (a second append refuses
  `wave_already_closed`); closed canonical-JSON shape `{ waveId, receiptDigest, rings ≤8,
  lanes ≤16, parked ≤8, blockedOn ≤8, knowledge, settlementErrors ≤8 }`; replay-derived (built by
  the fold like the `context.pack_minted` fold); non-gating (mint failure captured into bounded
  `settlementErrors`, never blocks close).
- **D1 schema composability** — every briefing field composes from its named ledger source
  (the field→store-source table); a field with no source refuses by name.
- **B3 staleness honesty** — the staleness age measures what v1.1 says it measures; the
  "no events since" disclosure renders on an idle ledger.
- **B5/D6 doctor render** — the briefing rides the doctor JSON as a named additive field; never a
  text render; byte-stable.
- **A7 failure-forcing (N5)** — the injected overflow path (the named seam from the fold) forces
  the bounded-truncation behavior the pin promises.
- **N2 ordering** — the D4 content short-circuit fires BEFORE the auth-key check (or
  per-settlement-unique keys — whichever v1.1 states; pin it).
- Refusal vocabulary — every new code the contract names (incl. `wave_already_closed`) refuses
  typed, by name, at the right stage.

## Suite law

Red-first: every row fails at a NAMED stage (`stage: record-mint-missing` /
`briefing-compose-missing` / `doctor-field-missing` / etc.). Namespace imports for invented
surfaces (`import * as` — a missing export must not kill the file at load). Hermetic: mock
adapters, tmp dirs, tmp git repos in `mkdtemp` only, `test.after` cleanup, no network. Run from
the repo root (`node --test impl/test/briefing-pack-red.test.mjs`) until the split is exact and
stable across two runs. The header block carries the row inventory with stages, invented-surface
names + exact signatures, the pin list, and the verified split. Sorted-key literals in ACTUAL
sorted order; `localeCompare` banned; no clocks. NUL discipline: ONLY `application.mjs` and
`coordination-store.mjs` carry NULs (`grep -an`/`sed -n` there).

## Deliverables

`impl/test/briefing-pack-red.test.mjs` +
`docs/reference/evidence/briefing-pack-2026-08-06/suite-draft-notes.md` (the split + row map +
invented surfaces). Edit ONLY those two files.
