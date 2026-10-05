# context-models-production-critic

Independent executable qualification fixtures for the semantic
models/catalogs production surface: catalog snapshots and joins, statement
framing, result-name origins, rootpage identity, the TypeScript constant-SQL
record boundary, the Zod model child, JSON Schema validation, dataset
token/pointer contract, migration replay contract, and the structural
environment allowlist.

Scope: review only. No production source is edited. Every run imports the
captured producer modules from a producer commit (default sibling worktree
of semantic-impl-catalogs-models, commit c6fc585d at this writing) and
records both the declared source pins and the actual loaded module closure
with per-file SHA256, captured through a registered ESM loader hook.

## Acceptance semantics

Every check is a required qualification assertion. There is no
expected-defect acceptance path and no checked-in expected-failure ledger.

- Exit 0: every selected check passed.
- Exit 1: at least one check failed (a real finding against the exercised
  source; for example the model-use join defects still present in producer
  bytes 53b57a18 fail here until the successor lands).
- Exit 2: at least one check is pending an admitted external artifact —
  currently the single TS joint-fixture record artifact (CTX_TS_RECORDS).
- Exit 64: command refusal (unknown argument, empty or unknown --only IDs,
  invalid CTX_TS_RECORDS), issued before any fixture or provider effect.

Exact-defect diagnostics live in diagnose/ and run only through their own
entrypoint. They assert the exact historically observed defect on captured
bytes and never count toward acceptance. A defect that no longer
reproduces reports defect-absent; that is a source observation, not an
acceptance event.

## Running (remote runners only)

Execution boundary (2026-10-05 operator direction): all checks, mutation
controls and syntax gates run only on admitted remote validation runners.
The operator laptop is for source editing, review and retained-evidence
inspection. The pre-boundary local run is retained as historical evidence
under ../../.scratch/production-critic/ with its original attribution.

    node bend2/tests/context-models-production-critic/run.mjs
    node bend2/tests/context-models-production-critic/mutation/run.mjs
    node bend2/tests/context-models-production-critic/diagnose/run.mjs

Options:

- `CTX_PRODUCER_ROOT=<path>` pins the captured producer tree (a commit of
  semantic-impl-catalogs-models).
- `CTX_ZOD_ROOT=<path>` points at a real Zod 4.3.6 installation.
- `CTX_TS_RECORDS=<path>` is the retained record artifact of the single TS
  joint fixture owned by the catalogs/models author (JSON array of facts
  carrying `value.record` envelopes). It is read, hashed and validated
  before use; the boundary positive on real records reports pending without
  it. No replacement TS producer is implemented here.
- `CTX_RETAIN_DIR=<path>` overrides the retained invocation directory
  (default `<suite>/.scratch/invocations/<ts>-<pid>`), which keeps inputs,
  full result, status, the subject workspace and the actual loaded module
  closure of the run.
- `--only id,id` selects checks; unknown or empty selections refuse with
  exit 64 before any effect.

## Remote validation package

1. This worktree at the recorded critic commit.
2. The producer tree at its commit (c6fc585d or its reviewed successor).
3. A real Zod 4.3.6 root; the TS joint-fixture artifact when the
   catalogs/models author has published it.
4. Commands: the three node invocations above, in order, with the
   environment set. Every invocation retains its unique directory with
   inputs, stdout/stderr text, result.json, status and the loaded closure.
5. Meaningful outcomes, accurately scoped:
   - run.mjs exit 0 only when the exercised producer satisfies every
     required check, including the real-record boundary positive once the
     TS joint artifact exists. Against current producer bytes the expected
     result is exit 1 with named model-use-join findings — that failure is
     the gate working, not a suite defect.
   - mutation/run.mjs exit 0: three source mutations over a captured copy
     each flip exactly their targeted check from a passing baseline, with
     the intended assertion text observed.
   - diagnose/run.mjs documents which of the four historical model-use
     defects the captured bytes still exhibit.

## Check layers

- Catalog/statement/origin/rootpage/sql-join/zod/json-schema checks
  exercise the actual captured producer functions over real node:sqlite,
  Ajv 8.17.1 and Zod 4.3.6 subjects.
- Dataset, environment and migration checks are contract oracles: they
  exercise this suite's own reference implementations and pin the semantics
  the production dataset, environment and native replay implementations
  must reproduce. They are not provider qualification; production
  assertions bind to those owners' entries when they exist.

## Remaining acceptance gates (not satisfied by this suite)

- The single real TS5.9.3 producer joint fixture into the adapted consumers
  (owned by semantic-impl-catalogs-models; this suite consumes its retained
  artifact).
- Producer successor addressing the model-use join defects and the new
  source findings in catalogs/models c6fc585d.
- Native linked-library SQL planner and migration replay qualification,
  operative Bend laws over actual native functions, and installed
  CLI/MCP acceptance on Node 22.15.0, each owned by its native owner.
