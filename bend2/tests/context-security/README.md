# Context security fixtures

Fixture contract for the C security profile of the semantic context feature
(`docs/bend2/semantic-context-spec.md`, Security projections). The single
`bend2/context/clang/` extractor is the consumer. This directory owns fixture
inputs, expected discrimination contracts and a runner; it owns no extractor
production code.

## Subject

The authentic subject is the qualified Fossil manifest
`32ad9a1584a16f09fff78563d789b2dbc6b4bae5`, handler `src/report.c::view_list`,
with its real build configuration (GNU89, `-g -O0 -Wall`, HTTP-only) and the
generated compiler inputs under `bld/`, as retained by
`semantic-security-fossil-qualification-verdict-6` in the shared probes
directory. The retained source is read-only. Every byte this fixture consumes
is pinned by SHA-256 in `fixture-manifest.json` and copied into a private
workdir under `.scratch/context-security/` at run time.

## Contents

- `fixture-manifest.json` — pins: retained source/generated files, the 13
  original/generated body correspondences, compiler identity, producer input
  digests (helper summary, source map, request and declaration examples,
  linked symbols), diagnostics pins, planner/dataset pins, and the open
  integration inputs.
- `expected/view_list-five-family.expected.json` — the five-family same-handler
  contract (type, calls, diagnostics, authorization, databaseAccesses) with
  per-fact classifications: `checked` for compiler type propositions and
  diagnostics, `static-possible` for resolved calls and the guarded-call and
  modeled-access relations, `declared` for security roles and the helper
  assumption, `observed` for the external planner's catalog and plan. Includes
  the separate `db_prepare` selected-definition expectation (nonempty formal
  list `Stmt *`, `const char *` plus variadic status).
- `expected/mutations.expected.json` — the discrimination contract for the
  mutation fixtures: which family refuses, with which reason, for each real
  identity/profile/mapping violation, and why the formatting control is not a
  violation.
- `security-declaration.fixture.json` — one binding requirement (authentic
  view_list selectors) and one deliberate kind-mismatch requirement that must
  report `declarationUnbound`.
- `run_checks.py` — the runner (see below).

## Mutations

Negatives run on owned copies inside the runner workdir; the retained tree is
never modified. Each negative names the concrete rule it breaks:

- `guard-noop-call` — guard operands routed through calls; guard relation
  unavailable under the supported-guard profile.
- `deny-fallthrough` — denial branch loses its return; no qualifying denial
  continuation.
- `stmt-escape` — the prepared statement escapes through an opaque call before
  the first step; step lineage refused.
- `shadowed-callee` — the `db_prepare` spelling binds to a local
  function-pointer object; no resolved FunctionDecl, no helper join.
- `helper-body-changed` — the pinned `db_prepare` body segment digest breaks;
  helper join refuses even though the literal-copy path stays semantically
  intact.
- `duplicate-original-body` — a byte-identical body region under `#if 0` in the
  original breaks unique identical-byte correspondence; the location-aware
  inputs cannot disambiguate identical bytes, so the mapping refuses with both
  candidate intervals.
- `sql-format-control` (positive control) — whitespace-only literal change:
  correspondence stays unique, all families stay useful, the producer plans the
  new literal bytes freshly instead of reusing the retained plan.

## Runner

From the repository root:

```
python3 bend2/tests/context-security/run_checks.py
```

Requires the pinned LLVM Clang 20.1.8 at
`/opt/homebrew/opt/llvm/bin/clang` (absence is reported precisely; no
substitute toolchain is used). The runner verifies every pin, materializes
private workdirs, applies the mutation edits to verified copies, checks the
AST-level discriminators with `-ast-dump=json`, compares `-Wall` diagnostics
against the retained pins (byte-exact for the authentic subject; line-number
normalized for shifted mutation copies), reproduces the retained Static
Analyzer diagnostics count for the report translation unit, validates the
declaration selectors
byte-exactly, and writes `run-evidence.json` with every invocation's argv,
exit status and stdout/stderr byte counts and digests.

## Status

The expected documents are contracts, not observed producer output. Observed
producer behavior qualifies only after the actual `bend2/context/clang`
extractor artifact handoff; `run_checks.py --extractor PATH` records the
artifact for that integration. Open integration inputs are listed in
`fixture-manifest.json` under `openIntegrationInputs`.
