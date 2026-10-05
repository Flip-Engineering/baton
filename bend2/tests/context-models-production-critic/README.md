# context-models-production-critic

Independent executable qualification fixtures for the semantic
models/catalogs production surface: catalog snapshots and joins, statement
framing, result-name origins, rootpage identity, the TypeScript constant-SQL
and model-use record boundaries, the Zod model child, JSON Schema validation,
dataset values and pointers, migration replay semantics, and the structural
environment allowlist.

Scope: review only. No production source is edited. Every run imports the
captured producer modules from a producer tree and records the SHA256 of
each imported file, so every report pins the exact bytes it exercised.

## Running

Execution boundary (2026-10-05 operator direction): this suite runs only on
admitted remote validation runners. The operator laptop is for source
editing, review and retained-evidence inspection. The one local run from
before that boundary is retained under `.scratch/` in this subtree's worktree
with its original host and source attribution.

    node bend2/tests/context-models-production-critic/run.mjs

Options:

- `CTX_PRODUCER_ROOT=<path>` pins the captured producer tree. The default is
  the sibling `semantic-impl-catalogs-models` worktree.
- `CTX_ZOD_ROOT=<path>` points at a real Zod 4.3.6 installation (defaults to
  the host path recorded at authoring time).
- `CTX_TS_RECORDS=<file>` supplies actual TypeScript producer records (a JSON
  array of facts carrying `value.record` envelopes) for the consumer-boundary
  checks. Without it, the boundary checks run on manually authored v1 records,
  which qualify boundary negatives only.
- `--only id,id` runs a subset.

Exit code 0 means every required check passed and every registered
discriminator reproduced its defect against the captured source (or reports
`fixed` once the producer corrects it). Exit code 1 is an unexpected
divergence and needs review.

    node bend2/tests/context-models-production-critic/mutation/run-mutations.mjs

runs the mutation control: deliberately defective twins of discriminated
rules must fail the same assertions. Exit 0 means every mutation was
detected.

## Remote validation package

For a runner submission the parent assembles:

1. This worktree at the recorded critic commit (owned subtree only).
2. The captured producer tree (currently uncommitted producer work; either
   its committed increment or an immutable bundle of
   `bend2/context/{catalogs,models}/**/*.mjs`). The report's `sourcePins`
   hashes whichever tree it received, so the run is self-identifying.
3. Commands, run in order:

       node bend2/tests/context-models-production-critic/run.mjs
       node bend2/tests/context-models-production-critic/mutation/run-mutations.mjs

   with `CTX_PRODUCER_ROOT` and `CTX_ZOD_ROOT` set to the staged paths.
4. Expected meaningful outcomes: exit 0 for both; `summary.requiredFailed`
   equal to 0; `discriminatorsReproduced + discriminatorsFixed` equal to the
   discriminator total (15 at this writing); mutation control reporting all
   three mutations detected. Full raw stdout/stderr/exit status retained
   with the runner's platform identity (Linux results keep Linux identity;
   Darwin acceptance stays a separate gate).

## Check layers

- **Required** checks pin behavior on the real providers (node:sqlite, Ajv
  8.17.1, Zod 4.3.6) and must pass for qualified source.
- **Discriminator** checks document known defects in captured sources
  (conductor correction rounds 14, 15 and 18). They are expected to fail on
  the pinned bytes and flip to passing when fixed; each carries the finding
  reference in its requirement text.

## Captured source references pinned at review time

- `sqlite-statement.mjs` 038116a1... (fixed framing corrections 1 and 2)
- `sql-scan.mjs` c04b2b84... (closing-quote and trailing-content fixes)
- `sql-join.mjs` f52e4dbe... (round18 capture; cache/receiver/identity defects)
- `model-use-join.mjs` 79629c3d... (round14 four unjustified-relation cases)
- `zod-model.mjs` 76cb9a18... / `zod-child.mjs` 9635abec... (stream truncation,
  maxBuffer ceiling, execution/refusal merge)

Full hashes for the exact bytes of every run appear in each JSON report under
`sourcePins`.

## Remaining acceptance gates (not satisfied by this suite)

- Real TS5.9.3 producer records flowing into the adapted consumers over one
  owned project plus database/model (joint runner owned by
  semantic-impl-catalogs-models under tests/context-models/ts-integration).
- Native linked-library SQL planner and migration replay qualification
  (EXPLAIN-only stepping, authorizer state, tail handling on the linked
  SQLite) owned by the native owners.
- Operative Bend laws over actual native parse/admission functions through
  coordinator/laws.bend, owned by native core.
- Installed/composed CLI and MCP acceptance on Node 22.15.0.
