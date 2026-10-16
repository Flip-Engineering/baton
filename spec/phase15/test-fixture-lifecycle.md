# Phase 15 — owned test-fixture lifecycle

Recursive Baton runs repeatedly execute the full suite. A green suite that strands hundreds of
temporary repositories, logs, worktrees, and runtime homes is a fleet lifecycle failure, not test
housekeeping. This vertical makes the canonical test command own and reap its fixture namespace.

## TF1 — one private root per invocation

The canonical test runner creates one mode-0700 suite root beneath either the operating-system
temporary directory or an explicitly configured `BATON_TEST_TMP_PARENT`. It launches Node's real
test runner with `TMPDIR`, `TMP`, and `TEMP` all bound to that root. Tests may create arbitrary
children but cannot choose the directory that the runner later removes.

## TF2 — cleanup follows every observable terminal path

After a passing or failing child suite, spawn refusal, `SIGINT`, or `SIGTERM`, the runner waits for
the child process group to stop, escalates after a bounded grace period when necessary, and removes
only its exact owned suite root. Cleanup is idempotent. A cleanup failure makes an otherwise-green
run fail visibly.

No user-selected parent, ambient temporary directory, repository path, or sibling suite root is
ever recursively removed. Uncatchable host/process death such as `SIGKILL` remains supervisor
reconciliation scope rather than being falsely claimed by this process-local runner.

## TF3 — result truth is preserved

The runner streams the child test output unchanged and preserves success/failure. A signalled run
returns a nonzero status. Cleanup must never turn a failed or killed test run green.

## TF4 — canonical and recursive acceptance

`npm test` uses the owned runner. Tests spawn real nested Node test processes that intentionally
leave fixtures behind on pass, failure, and a hanging turn terminated by signal; the owned suite
root must be absent afterward in every case while an unrelated sibling survives. A full canonical
run must leave its configured parent with zero `baton-suite-*` roots.

Provider-backed recursive review uses the configured exact harness/model/effort route when quota
is available. Until then, deterministic validation may ship locally but the independent live
review gate remains recorded as pending.
