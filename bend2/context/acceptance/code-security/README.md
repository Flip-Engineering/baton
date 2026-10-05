# Code and security acceptance fixtures

Independent negative fixtures and an acceptance runner for the `code` and
`security` profiles of the native semantic context implementation specified in
`docs/bend2/semantic-context-spec.md` (revision
`8a26bc3e7f9d5355b72f1291d95620b218b5c8e2`, SHA-256
`66f1376bed70498699f6e3d4eb5b9bd7608d041a91110c5d5241997dbbc695df`).

This directory owns no production source. It contains fixture inputs, a result
checker, and a runner that drives the installed coordinator. The runner calls
the real provider; it never synthesizes a result. A provider that is absent or
that answers with a shape this checker rejects produces a failure, not a pass.

## Layout

```text
cases.json                        case catalog: fixture, request, expectation per case
run.mjs                           runner: --verify, --selftest, --auth, --list, provider run
selftest/checker-cases.json       recorded payloads for the checker mutation control
verify/authentic.mjs              read-only verification of the retained Fossil records
test_code_security_acceptance.py  gate-selectable wrapper for --verify and --selftest
lib/fixtures.mjs                  fixture tree materialization and identity helpers
lib/provider.mjs                  coordinator CLI driver (context-query-file/context-result/context-engines)
lib/assert.mjs                    expectation checker over one provider answer
lib/capture.mjs                   phase recording and the concurrent mutator
lib/artifacts.mjs                 complete child-output retention
fixtures/c/                       C translation units for guard, denial and helper analysis
fixtures/clangd/                  compilation database, configuration, response file, plugin, driver trees
fixtures/providers/               LSP stdio transport fixture and environment probe executable
fixtures/capture/                 multi-file subject for capture identity cases
fixtures/credentials/             marker names used by the environment cases
```

## Provider interface

The runner drives the installed coordinator with the command set the
specification fixes, writing request bytes to stdin so the raw UTF-8 reader and
the canonical request identity are exercised:

| Purpose | Command |
| --- | --- |
| submit | `baton2 DATABASE context-query-file SESSION QUERY_ID -` with canonical request text on stdin |
| retrieve | `baton2 DATABASE context-result QUERY_ID --pretty` |
| provider inventory | `baton2 DATABASE context-engines` (deployment selection only) |
| lifecycle control | `context-query-file` with subject `{kind:"query-control",…}` |

Answers follow the specification: exit 0 carries one JSON document, exit 2
carries `{error,command,condition,next}`. The checker reads only documented
fields.

`lib/provider.mjs` resolves each fixture provider executable in this order:

1. `--tool NAME=PATH` on the runner command line.
2. `BATON_CONTEXT_TOOL_<NAME>` in the runner's environment.
3. the deployment's own provider selection.

Fixtures that must control a provider transport (the clangd lifecycle cases) use
routes 1 or 2. Request-local `options.tools` admission requires `executeTarget`
and is exercised separately by the environment probe case.

## Execution boundary

Compilation, compiler calls, provider fixtures and every test gate run on an
admitted remote runner. The operator's laptop edits source, reviews source,
orchestrates natively and inspects retained evidence.

| Mode | Starts a child | Where it runs |
| --- | --- | --- |
| `--verify-static` | no | anywhere, including the laptop |
| `--selftest` | no | anywhere, including the laptop |
| `--auth` | `/usr/bin/sqlite3`, read-only | laptop, as retained-evidence inspection |
| `--verify` | the selected C front end | remote runner |
| catalog run | the coordinator, Node and the fixture transports | remote runner |

No mode applies a wall-time deadline or an output ceiling. Every child
invocation is written in full to the artifact directory: `<id>.stdout`,
`<id>.stderr` and `<id>.observation.json` carrying the exact argv, exit status,
signal and spawn error. When no artifact directory is supplied the complete
streams stay in the result row. A missing prerequisite is reported as
`unqualified:` in the failing row and the run does not pass.

## Running

```sh
node bend2/context/acceptance/code-security/run.mjs --verify-static
node bend2/context/acceptance/code-security/run.mjs --selftest
node bend2/context/acceptance/code-security/run.mjs --auth \
  --clang PATH --clangd PATH --sqlite3 PATH [--evidence-root PATH]
node bend2/context/acceptance/code-security/run.mjs --list
```

Remote runner, fixture compile:

```sh
node bend2/context/acceptance/code-security/run.mjs --verify \
  --clang /absolute/path/to/clang-20.1.8 \
  --artifacts /absolute/retained/artifacts
```

Remote runner, provider cases:

```sh
node bend2/context/acceptance/code-security/run.mjs \
  --baton2 /absolute/path/to/baton2 \
  --database /absolute/path/to/orchestra.db \
  --session SESSION \
  --node /absolute/path/to/node-v22.15.0/bin/node \
  --clang /absolute/path/to/clang-20.1.8 \
  --clangd /absolute/path/to/clangd-20.1.8 \
  --artifacts /absolute/retained/artifacts \
  [--case CASE_ID] [--tool NAME=PATH] [--work DIR]
```

`--verify-static` checks the corpus with no child process: every fixture
manifest is closed JSON, every symlink, response file, plugin flag, driver shim
and configuration fragment is as declared, and every case names an existing
subject, project and declaration template.

`--verify` adds a compile of every C fixture through its own recorded compile
command with the selected front end substituted for argv[0]. It requires
`--clang` naming the front end and `--artifacts` for the retained output.

`--selftest` runs the checker against recorded response payloads, one per
expectation predicate, and requires each predicate to reject a violating
payload. It proves the checker is not vacuous. It qualifies no provider.

`--auth` reads the retained authentic Fossil qualification records and
recomputes each checkable claim from the retained bytes: the
original/generated correspondence digests, the artifact manifest, the compiler
and tool identities, the catalog plan's database digest and rootpage joins, the
guard and field source spans, the `view_list` CFG successor map and the
accepted-edge cut set, the five-family composition of the joined result, the
selected `db_prepare` signature gate, and the claim-classification discipline.
It performs no build and launches no compiler. It requires `--clang`,
`--clangd` and `--sqlite3` so every recomputed identity names the installed
tool it was recomputed against; without them the mode reports `unqualified` and
exits 2.

The catalog run executes the catalog against the installed coordinator. It
requires `--node` so the provider runtime identity is explicit and recorded,
and `--artifacts` so every observation is retained. A missing binary, a missing
session or an unimplemented command is reported as `providerUnavailable` with
the exact failing command and its exit status, and the run exits 2.

## Expectation schema

Each entry in `cases.json` has this shape:

```json
{
  "id": "S1-short-circuit-and-accepted-set",
  "group": "security",
  "fixture": "fixtures/c/short_circuit_and.c",
  "request": {
    "engine": "clang-analyzer",
    "subject": {"kind": "symbol", "name": "handler"},
    "select": ["authorization"],
    "options": {"project": "compile_commands.json", "readRoots": ["."]}
  },
  "effects": [],
  "expect": {
    "outcome": "complete",
    "exitCode": 0,
    "relations": [
      {
        "kind": "guarded_call",
        "classification": "static-possible",
        "minAcceptedRoutes": 2,
        "cutSetCoversAccepted": true,
        "deniedRouteReachesReturn": true
      }
    ],
    "forbiddenRelations": [{"kind": "guarded_call", "callsite": "after_guard"}],
    "limits": [{"projection": "authorization"}],
    "mustNotMention": ["HARNESS_MARKER"]
  }
}
```

Fields:

- `outcome`: required `state` of the query envelope: `complete`, `failed`,
  `interrupted`, `running` or `refused`.
- `exitCode`: required process exit status.
- `refusalCondition` / `refusalConditionIncludes`: required condition text, or a
  required substring of it.
- `relations`: for each entry, at least one fact or relation of `kind` must
  exist; `classification` must match when given.
  - `minAcceptedRoutes`: lower bound on distinct accepted exit edges recorded by
    a `guarded_call` value.
  - `cutSetCoversAccepted`: the value's `cutEdgeSet` must contain every distinct
    accepted edge, and the accepted routes must contain no edge outside it.
  - `deniedRouteReachesReturn`: every denied route must terminate at a mapped
    return reference.
  - `count`: `{min, max}` bounds on the number of matching relations.
- `forbiddenRelations`: no relation of `kind` may exist. When `callsite` is
  given, no relation may name that callsite.
- `limits`: at least one `limits` entry with the given `projection` and, when
  given, the given `code`.
- `forbiddenLimits`: no `limits` entry with the given `projection` and `code`.
- `mustNotMention`: no listed string may appear in stdout, stderr or the
  retained result bytes.
- `sourceIdentitiesVerified`: every `source` evidence item's `sha256` must equal
  the digest this runner computes from the file at the recorded path.
- `snapshotInputs`: the snapshot must name every listed fixture-relative path.
- `phaseConsistent`: every recorded source digest must equal one of the phase
  digests the runner recorded for that file.
- `eitherOf`: at least one listed expectation must hold.
- `forbiddenOutcome`: the given state must not be observed.
- `waitingForAll`: every listed `{kind, reason}` must appear in
  `progress.waitingFor`.
- `applicability`: the required `result.applicability`.
- `ordering: "guardPrecedesCall"`: every `guarded_call` relation's call ref must
  begin at or after its guard ref ends.
- `oneGuardPerCall`: one relation per call ref.
- `evidenceRefsResolved`: every evidence item carries the identity fields its
  `kind` requires, with no null path, digest, range or object. A source range
  must carry numeric `line` and `column` on both ends.
- `second`: a complete expectation applied to the second submission of a case
  that declares `secondRequest`.
- `retainedState`: the `context-result` state of the first submission, read
  after the second submission.

Case-level fields drive the runner rather than the checker:

- `polls`: how many times to re-read `context-result` while the state is
  `accepted` or `running`, at 100 ms intervals.
- `release`: submit a `query-control` release after the poll budget.
- `scenario`: the `CLANGD_FIXTURE_SCENARIO` the generated launcher exports.
- `exportedMarkers`: environment variables the runner sets for this case only.
- `probeMarker`: the environment probe's recording path.
- `mutateAfter`: rewrite one capture file's phase after the first retrieval and
  require the stored source digests to stay unchanged.
- `mutateDuring`: record both phases of the capture tree, then run a concurrent
  mutator that rewrites all three files by atomic rename while the query runs.
  The mutator's writes are atomic, so every file on disk is at one phase; a
  published snapshot that mixes phases is the failure the case looks for.
- `sameFactsAs`: compare the relation kinds and classifications with another
  case's answer.
- `secondRequest`: a request body merged over the case request and submitted
  again under the same query ID. The retained row must keep its first result and
  the second submission must refuse.

## Case groups

### S: C guard, denial and helper analysis (`clang-analyzer`)

| Case | Fixture | Property |
| --- | --- | --- |
| S1 | `c/short_circuit_and.c` | `if (a && b)` guard: accepted edge set holds both operands' true edges |
| S2 | `c/short_circuit_or.c` | `if (a \|\| b)` guard: the accepted cut set holds both true edges, so no single short-circuit edge dominates the call |
| S3 | `c/or_denial_set.c` | `if (!a \|\| !b) return` denial: denied routes hold both operand-false edges and reach the return |
| S4 | `c/bypass_earlier_call.c` | a call before the guard carries no `guarded_call` relation |
| S5 | `c/bypass_branch_call.c` | a call on a branch that skips the guard carries no `guarded_call` relation |
| S6 | `c/denial_cycle.c` | a loop on the denial side makes the relation unavailable and leaves the other facts |
| S7 | `c/opaque_call_recorded.c` | an intervening opaque call is recorded and keeps the ordinary call/return assumption |
| S8 | `c/opaque_call_mutates.c` | passing the guard operand's address to an opaque call makes the relation unavailable |
| S9 | `c/guard_operand_call.c` | a call inside the guard expression makes the guard relation unavailable |
| S10 | `c/helper_shadowed_callee.c` | a local `db_prepare` shadowing the global helper produces no modeled access edge |
| S11 | `c/helper_body_changed.c` | a helper body outside the reviewed literal-copy summary produces no modeled access edge |
| S12 | `c/helper_step_lineage.c` | `db_step` on a different local `Stmt` produces no step lineage |
| S13 | `c/sanitizer_claim.c` | a declared filter does not establish sanitization or narrow the relation |
| S14 | `c/declaration_unbound.c` | a declared requirement with no matching code relationship reports `declarationUnbound` |
| S15 | `c/local_field_alias.c` | a resolved local record field chain yields justified `input_path` steps |

### B: root, read-root, symlink, configuration, response file, plugin and driver boundaries

| Case | Fixture | Property |
| --- | --- | --- |
| B1 | `clangd/admitted-sdk` | an absolute admitted include root resolves and enters the snapshot |
| B2 | `clangd/symlink-escape` | a symlink leaving the admitted roots contributes no bytes and no symbol |
| B3 | `clangd/symlink-inside` | a symlink onto an admitted destination resolves and records the real path |
| B4 | `clangd/unadmitted-root` | a header outside the admitted roots is unavailable |
| B5 | `clangd/response-file` | a response-file compile command resolves and is recorded; shell syntax in a response file refuses |
| B6 | `clangd/plugin-flag` | `-plugin`, `-load`, `-Xclang -load` and `-fplugin=` refuse before provider startup |
| B7 | `clangd/driver-shim` | the compilation database's compiler is not executed; target configuration cannot enable `--query-driver` |
| B8 | `clangd/project-config-control` | the control tree for the configuration comparison |
| B8b | `clangd/project-config` | a `.clangd` fragment in the subject tree changes neither the relation shape nor the marker set, and its `--query-driver` program is not executed |
| B9 | `clangd/outside-root` | a subject path outside the admitted roots refuses |

### L: clangd managed lifecycle, version and URI completion

| Case | Fixture | Property |
| --- | --- | --- |
| L1 | `providers/clangd-transport.mjs` scenario `exact` | an exact URI and version publication completes the diagnostics projection |
| L2 | scenario `no-publication` | without a publication the query stays `running` with the exact `clangdDiagnostics` waiting entry |
| L3 | scenario `idle` | a versionless `fileStatus: idle` string supplies no completion |
| L4 | scenario `wrong-version` | a publication for another version supplies no completion; the exact version later does |
| L5 | scenario `wrong-uri` | a publication for another URI supplies no completion |
| L6 | scenario `no-publication` then release | release retains `{projection:"diagnostics",code:"diagnosticsUnobserved"}` and the retained response artifacts |
| L7 | scenario `failure` | a structured protocol error or a provider exit produces its own failure evidence |
| L8 | scenario `wrong-version` then release then exact | a publication after a committed terminal state cannot complete the query |

### C: capture identity and consistency

| Case | Fixture | Property |
| --- | --- | --- |
| C1 | `capture/three-file` | every recorded source digest equals the digest of the bytes on disk |
| C2 | `capture/three-file` | after an input change, `context-result` reports `stale` and keeps the original facts |
| C3 | `capture/three-file` | under continuous mutation, no published snapshot mixes phases, or the query refuses `changedDuringCapture` |

### E: adapter environment and credentials

| Case | Fixture | Property |
| --- | --- | --- |
| E1a | `providers/env-probe.mjs` | a tool override without `executeTarget` refuses and leaves no marker |
| E1b | `providers/env-probe.mjs` | with the grant the probe runs and its recorded environment holds no harness credential name |
| E2 | any completed query | no marker value from the runner's own environment appears in stdout, stderr or the retained result |

### P: cross-module provenance and record identity

| Case | Property |
| --- | --- |
| P1 | a second submission under the same query ID with a different canonical request refuses; the retained row keeps its first completed result |
| P2 | every evidence item on a guard result carries the identity fields its kind requires, with no null path, digest, range or object |
| P3 | the same evidence identity requirement holds on a type and call result |

## Ownership boundary

The authentic Fossil subjects and their guard, helper, alias and mapping
discriminator fixtures live in the `bend2/tests/context-security` set owned by
`semantic-impl-security-fixtures`. This directory holds synthetic negative
controls for provider lifecycle, capture and security-claim discipline. Where a
case needs a C subject it uses its own fixture; where a case verifies an
authentic-subject result, the case catalog takes the fixture path as input and
the checker reads the provider's answer for that path.

## Dependencies

The implementation at revision `8a26bc3e7f9d5355b72f1291d95620b218b5c8e2`
contains no `context-query` command, so every provider case reports
`providerUnavailable`. The corpus and the checker stand alone; only the run
waits. Two interface points need an owner decision before the L and E groups can
run:

1. A supported, non-request route for pointing the clangd transport at a fixture
   server. Request-local `options.tools` admission is specified for environment
   projections only.
2. The message kind of the managed admission and waiting notice, so L2 can check
   owner delivery rather than progress alone.
3. The settled source record and reference contract of the single TypeScript
   producer. The Node SQL-join consumer negatives recorded at
   `.scratch/source-review/models-floor-14` — a plan cached under a call-site key
   alone and reused for changed SQL, a missing database receiver, a declaration
   identity hashed from empty objects, and null-valued source references — become
   function cases here once the record carries full statement, declaration and
   source-snapshot identity. Case P1 already covers the query-ID half of that
   boundary, because a conflicting submission under one ID must refuse regardless
   of provider.

## Limits

The checker reads only the documented result schema. Where the specification
does not fix a limit code, the case asserts the absence of the relation plus a
populated `authorization` limit entry instead of a code spelling. S1 to S15
qualify `clang-analyzer` behavior on the pinned LLVM 20.1.8 front end; they make
no claim about other versions. C3 depends on a mutation window that the runner
widens with a three-file subject; a query that finishes before the first
mutation reports `unobserved` and the case does not pass.
