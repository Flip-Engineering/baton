# #69 SUITE BRIEF — red-first suite for the folded REPL-realization contract v1.1

You are drafting the **red-first acceptance suite** for the folded REPL-realization contract.
Read fully, in order: (1) `repl-realization-contract.md` (**v1.1** — source of truth, including
the folded R-pins R9/R10/R11); (2) `contract-fold.md` (the 8 blocker resolutions); (3)
`contract-redteam.md` (the attack surface); (4) idioms:
`impl/test/workflow-surface-red.test.mjs` (facade staging) and
`impl/test/bidirectional-v3-red.test.mjs` (the collaboration lane).

## Coverage (from the v1.1 acceptance pins)

- **D1/D2 the citation + cite-into-brief seam** — an orchestrator-authored object cited into a
  worker's brief renders in the `## Cited REPL objects` section inside the UNTRUSTED frame; a
  dangling citation renders a typed absence (never a crash); the byte/item bound with the
  digest-cited spill resolvable by the worker.
- **R9 (the frame escape)** — a cited cell containing `\n## Pending attention` renders INSIDE
  the bullet (the single-line-leaf sanitize), never as a new prompt section.
- **R10 (the run boundary, #143)** — a `repl.cite` with a foreign runId refuses
  `repl_citation_out_of_run` (typed, facade and MCP identically); a citation in the caller's own
  run resolves.
- **R11 (the multi-run fan-out)** — a shared object admitted at spawn resolves
  `repl:shared:<name>@<version>` in EACH member's own runId (the #94-shaped wave).
- **D4/D5 the tiers + promotion** — task-ephemeral unreachable after close (history retained,
  replay-exact); workflow-ephemeral shared across members; project-persistent only via the
  settlement-review path (never auto-promote; provenance carried).
- **D6 worker manifests** — review-by-projection (a shadow field a reviewer can't see refuses);
  approval replay-safe.
- **D7 composition** — the rendering order vs #79's pending-attention is pinned; independent
  byte bounds.
- **The no-arbitrary-code law** — a REPL object is never eval'd/imported/Function'd (a static
  row scanning the lane's module graph, the F10 idiom from the #114 suite).
- **Refusals** — every code the contract names, typed, surface-constant.

## Suite law

Red-first (every capability row fails at a NAMED stage at HEAD); namespace imports for invented
surfaces; hermetic (mock adapters, mkdtemp, test.after, no network); run TWICE from the repo
root, record the stable split; header carries the row inventory + stages + invented signatures +
verified split; sorted-key literals ACTUAL order; `localeCompare` banned; no clocks; NUL
discipline (`grep -an`/`sed -n` on the two NUL files).

## Deliverables (edit ONLY these)

`impl/test/repl-realization-red.test.mjs` ·
`docs/reference/evidence/repl-realization-2026-08-07/suite-draft-notes.md`.
