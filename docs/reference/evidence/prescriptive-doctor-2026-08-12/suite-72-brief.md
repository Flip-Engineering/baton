# #72 SUITE BRIEF — red-first suite for the folded prescriptive-doctor contract v1.1

You are drafting the **red-first acceptance suite** for the folded prescriptive-doctor contract.
Read fully, in order: (1) `prescriptive-doctor-contract.md` (**v1.1** — source of truth); (2)
`contract-fold.md` (the 9 detection-honesty resolutions); (3) `contract-redteam.md` (the attack
surface); (4) idioms: the doctor machinery (`application-deployment.mjs` doctorReadiness,
`application-cli.mjs`'s render) and `impl/test/phase89*`/`impl/test/*readiness*` suites.

## Coverage (from the v1.1 acceptance pins)

- **The warning catalog** — each v1 warning: the detection read fires on the planted condition
  (a ghost-worktree census, a stale writer lease, a credential TTL window, a disk floor, a stale
  pin census, the resident-startup window, an auth-failure route); each is QUIET on the healthy
  state (the precision law — a false-positive fails the row).
- **The severity/surface model** — warnings NEVER block a command (a command with warnings
  completes and receipts them); the render composes with #103's briefing field (named additive,
  byte-stable for non-reading consumers); CLI/MCP parity.
- **The action link** — every warning names its remediation verb/doc anchor; a wrong/stale
  remediation fails the row.
- **The metadata-only law** — no warning path emits token material (a planted token-shaped
  value NEVER appears in the output).
- **Refusals/observability** — every code the contract names, typed, surface-constant.

## Suite law

Red-first; namespace imports for invented surfaces; hermetic (mkdtemp, test.after, no network;
planted fixtures for every condition — no real credential reads); run TWICE from the repo root,
record the stable split; header carries the inventory + stages + invented signatures + verified
split; sorted-key literals ACTUAL order; `localeCompare` banned; no clocks; NUL discipline.

## Deliverables (edit ONLY these)

`impl/test/prescriptive-doctor-red.test.mjs` ·
`docs/reference/evidence/prescriptive-doctor-2026-08-12/suite-draft-notes.md`.
