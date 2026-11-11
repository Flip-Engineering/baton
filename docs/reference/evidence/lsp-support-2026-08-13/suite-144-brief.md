# #144 SUITE BRIEF — red-first suite for the folded LSP-support contract v1.1

You are drafting the **red-first acceptance suite** for the folded #144 contract. Read fully,
in order: (1) `contract-fold.md` (**v1.1** — source of truth; §5 "Red-first acceptance" is
your row inventory — R1…Rn exactly as pinned there, including the named stages); (2) §3
Decisions (D1 pool, D2 diagnostic scoping, D3 environmental tier, D4 honesty/containment) and
§4 refusal vocabulary; (3) `contract-redteam.md` (the five blockers' fixes as folded — B1
honest trust posture, B2 clock-free wedged trigger, B3 clean-checkout base hygiene, B4
effective-view absence keys, B5 worker projection + advisory blast radius); (4) idioms:
`impl/test/diagnostics-red.test.mjs` (the diagnostics lane's own suite) and
`impl/test/prescriptive-doctor-red.test.mjs` (stubbed-tool discipline).

## Fixed points (from the contract — do not redesign)

- The suite file is `impl/test/issue144-lsp-pool-red.test.mjs`.
- The LSP server is a **stubbed `typescript-language-server` fixture** (a script answering the
  minimal `initialize`/`textDocument/*` envelope) — NO live providers, no network, hermetic.
- The wedged trigger is the per-server outstanding-request ceiling
  (`lsp.pool.outstanding_requests` — the named #89 registry row), never a clock.
- The absence cache keys on `{base_epoch, overlayDigest, normalized_query}` (B4); the pool
  requires a clean checkout of the base root (B3); the worker-facing projection is symbol
  names + file digests, paths NEVER crossing a worker-facing surface (B5a); the blast-radius
  projection annotates only, never feeds `coverageOfChange` (B5b).

## Suite law

Red-first (capability rows fail at NAMED stages at HEAD; PIN rows green); namespace imports
for invented surfaces; hermetic (mkdtemp, test.after); run TWICE from the repo root, record
the stable split in the header (row inventory + stages + invented signatures + verified
split); sorted-key literals ACTUAL order; `localeCompare` banned; NUL discipline (`grep -an`/
`sed -n` on `application.mjs` + `coordination-store.mjs`); no clocks as controls.

## Deliverables (edit ONLY these)

`impl/test/issue144-lsp-pool-red.test.mjs` ·
`docs/reference/evidence/lsp-support-2026-08-13/suite-draft-notes.md`.
