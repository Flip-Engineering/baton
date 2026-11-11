# ROW BRIEF — row-launchval: contract for issue #165 (launch-time harvest validation)

Read `foundry-brief.md` first (the shared frame binds you). Your contract:
`docs/reference/evidence/contract-foundry-2026-08-13/contract-165.md`.

## The problem (verify, then contract)

A wave launch declares deliverables (the brief) and harvest targets (`--targets` / the
spec's harvest paths) and NOTHING checks they agree: directory targets silently poisoned an
impl wave's harvest; contracts edited outside targets were silently dropped (twice, recovered
by pin-diff). Read: `docs/reference/evidence/run-task-wave.mjs` (the generic driver's
target/harvest machinery), `impl/src/workflow-interpreter.mjs` (`admitHarvest`/
`admitHarvestEntry`/`harvestOne` — the file-not-directory law's current home), and the
friction ledger App-D row 1 (`docs/reference/evidence/frontier-sweep-2026-08-03/orchestrator-friction-ledger.md`).

## Your contract must answer

- **D1 — the file-only law, everywhere.** A directory harvest target refuses AT LAUNCH with
  the typed code, on both the driver and the interpreter (the interpreter has the blob
  check at harvest time as of #74 — the launch-time refusal is the new half; the driver has
  neither).
- **D2 — the deliverable-coverage check.** When the brief/objective names deliverable paths
  and the targets don't cover them, the launch refuses naming the uncovered set. Define how
  deliverables are declared parsably (a front-matter `## Deliverables` convention? a driver
  flag? — choose the simplest honest mechanism and say why; do NOT parse prose loosely).
- **D3 — the spec-side pin.** For `waves.run` specs: the harvest paths validated at
  admission (file-shaped, contained, no escapes) with the workflow_* refusal family.
- Refusal vocabulary + red-first acceptance pins + open questions, per the frame.
