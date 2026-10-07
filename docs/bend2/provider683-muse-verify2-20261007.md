# Provider683/694 verification, usage commit d0891a7d (2026-10-07)

Reviewer seat `provider683-muse-review-20261006`, ensemble
`provider683-completion-20261006`. This note verifies
`d0891a7dfc7bc2f9c534b36b1718d2803ad576a6` (parent `f7877106`, tip of
`codex/provider683-deepseek-impl-20261006`): the OpenCode Go usage
read through the omp adapter. No candidate source was modified.

## Usage read

The omp probe answers `omp usage --json` in the same explicit action
as the catalog. `metadata.usage` carries per-provider windows,
labelled limits with window, reset instant, used and remaining
amounts and status, and the provider's credential refusals. Account
identifiers and endpoints stay out of the parsed answer and are named
in `absent`. A parsed report without windows answers `unknown`; an
unparsable one answers `error` with cause. The law
`m8_a_usage_read_names_the_provider_windows` and the adapter law
`m8_omp_usage_read_names_the_account_usage_limits` state the exact
equations, each with a mutation control. Two maintained tests cover
the known report with identity exclusion and the missing-report
unknown case. Direct binary checks confirm the known answer, the
unparsable-report error branch, and the F1 caller-stated regression.
The fix adds no model identifiers to runtime source; every amount is
extracted from provider output, and no credit value is invented.

The commit also corrects the `json_valid` wrapping on the access
report path, so an unparsable access report answers `error` through
the normal branch. Existing access tests pass unchanged.

## F5 closure

The `discovery-refusal-guidance-names-no-harness` control now carries
a find string that matches its source exactly once. The scoped
negative gate applies all three committed controls of this commit and
each fails closed naming its law. The implementer's full gate had not
reached mutation lines at verification time. F5 is closed.

## Live usage observation (operator laptop, 2026-10-07)

`omp usage --json` exits 0 with per-provider windows: reports for
`zai`, `google-antigravity`, and `opencode-go` with labelled limits
carrying window, reset instant, used, limit, remaining, unit, and
status; `capacity` keyed by provider; `disabledCredentials` carrying
provider, type, and cause; `accountsWithoutUsage` empty. Report-level
metadata holds account email and endpoint fields, which the
implementation leaves out of the parsed answer. Shapes only were
recorded; no secret or account values are repeated here. The parsed
field paths in the implementation match every observed shape,
including windows without reset instants.

## Acceptance table update

- 694 account surface: PROVED at mechanism level. The read, the two
  laws, the controls, the tests, and the live shape match above
  establish it. A live end-to-end run of the built binary against the
  laptop harness is UNOBSERVED: the Linux binary cannot run there.
- F5: CLOSED, per the applied scoped controls.
- Six 683 items: unchanged, except item 5 now covers eighteen laws
  (sixteen plus two new), all compiling with the entry.

## Remote receipts (atari-homelab)

Own tree `/home/atari2036/provider683-muse-verify2-20261007`,
archived from the usage commit. Pinned `bend` 2.0.25 with
`CC=clang-19` and the newer SQLite path.

- `build-native.sh`: exit 0, binary 5,946,448 bytes.
- `bend2/test/models.py`: 22 tests, OK, 0 skipped.
- Scoped negative gate, 3/3 failing closed naming their law: the F5
  corrected control and both usage controls.
- Direct binary checks: usage known answer with identity exclusion,
  unparsable usage error with cause, F1 no-echo regression green.
- Implementer full gate: running at verification time, still in
  early proof lines. Implementer source hashes matched the prior fix
  commit exactly; the same archive path was used here. Reviewer and
  implementer build in separate directories.

## Remaining live evidence

- End-to-end binary runs against live harnesses: UNOBSERVED, for the
  stated platform reason. Attempted commands were metadata reads
  only.
- Live account usage values through the built binary: UNOBSERVED for
  the same reason; the fixture shape replicates the observed live
  shape field for field.
- Same-Player failover with operator-authorized credits: UNOBSERVED.
  No exercise is on record, and none was attempted here.

## Recommendation

Land the discovery and usage surface after the F5-corrected full
gate completes. Route application and its record stay with the
`configure` and #681 verb work.
