# #70 SUITE BRIEF — red-first suite for the folded cross-deployment-knowledge contract v1.1

You are drafting the **red-first acceptance suite** for the folded #70 contract
(cross-deployment knowledge: one primary KG root per project). Read fully, in order: (1)
`cross-deployment-knowledge-contract.md` (**v1.1** — source of truth; the red-first acceptance
pins §"Red-first acceptance pins"); (2) `contract-fold.md` (the promotion-routing + split-brain
discriminator + cross-store replay law; OQ1/OQ5 resolutions); (3) `contract-redteam.md` (the
attack surface); (4) idioms: `impl/test/kg-activation-red.test.mjs` (knowledge lanes) and
`impl/test/doubt-review-red.test.mjs` (doubt/review machinery).

## Coverage

Derive the row set from the contract's acceptance pins — at minimum:
- **A1 the descriptor seam** — `knowledge: {primaryRoot}` closed field: unknown key refuses at
  open; escaping/symlinking path refuses; a path NOT resolving to a deployment root of this
  repo refuses at open (the `resident/deployment.json` + `state/coordination/events.jsonl`
  containment check); absent = per-root local (byte-identical to HEAD).
- **A2 promotion is primary-only on EVERY path** — `knowledge.promote`, the
  verified-task-outcome auto-promotion (`promoteKnowledgeNode`), AND `run.knowledge.seed` all
  refuse `knowledge_primary_conflict` on a non-primary deployment; the #63 gate unchanged
  (refusal at the coordinator mutator seam, never inside `admitWorkflowFinding`).
- **A3 the projection build** — a replica applying a primary projection reads honestly;
  absence reads per-root local (GT2).
- The split-brain discriminator + cross-store replay law rows the contract names.

Every refusal code the contract names, typed and surface-constant.

## Suite law

Red-first (capability rows fail at NAMED stages at HEAD; PIN rows green); namespace imports
for invented surfaces; hermetic (mkdtemp, test.after, no network, no real provider spawns);
run TWICE from the repo root, record the stable split in the header (row inventory + stages +
invented signatures + verified split); sorted-key literals ACTUAL order; `localeCompare`
banned; NUL discipline (`grep -an`/`sed -n` on `application.mjs` + `coordination-store.mjs`);
no clocks as controls.

## Deliverables (edit ONLY these)

`impl/test/cross-deployment-knowledge-red.test.mjs` ·
`docs/reference/evidence/cross-deployment-knowledge-2026-08-07/suite-draft-notes.md`.
