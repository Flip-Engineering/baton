# Checked landing and native worker validation, 2026-09-28

The checked landing now keeps one candidate and one target basis throughout an
attempt. A changed target returns a retry instruction. The next invocation
prepares and checks a new candidate against the current target. The correction
removes the post-check rebase state, its second publication path and its
attempt flag.

## Failure and correction

At `2bd4af0b`, two worker changes passed their selected check independently.
The check required the sum of two files to be at most ten. Both files started
at four; each worker changed a different file to six. A socket barrier held
worker B after its candidate passed. Worker A then landed, and B continued.

B's gate checked tree `593772aa` with values four and six. Its publication
rebased onto A and landed tree `15d0f726`, whose values were six and six. That
combined tree failed the same selected check. No gate check ran on that tree.
The target ref and both worker refs were recorded before and after the run.

The corrected runtime is `f30c41c9`, built with Bend 2.0.25. The executable's
SHA-256 is `c1fc3aa2c1396989cd79bb214d93cf786aeae22370ad6d1532d363899c82aed4`.
The repeated scenario returned `blocked` after A moved the target and kept B's
checked candidate and target worktrees. An explicit retry checked the combined
six-plus-six tree against A's six-plus-four tree, blocked on the new failure,
and preserved A's target and both original worker worktrees. The failing
candidate remained available for review. The target's selected check passed.

[The measurement artifact](measurements/2026-09-28-checked-landing.json) records
source commits, tree IDs, binary and evidence hashes, every checked tree,
command results, preservation assertions and independent final checks. The
before and after runs took approximately four seconds each. They establish
this ordering and its outcomes; they do not measure landing throughput.

## Operative laws

The entry imports the Git laws. The laws bind the actual passing gate to its
candidate and target basis, bind those values to the actual `update-ref`
arguments and invocation. A changed basis skips publication; a failed ref
update returns a command failure. Three production-source mutations were
rejected by the corresponding laws: publishing after detected movement, changing the basis at
the gate, and changing the basis passed to the actual Git effect.

The proof-removal control passed for all 205 laws imported by the entry:
206 compiles, zero failures. The Python law check passed all 30 checks,
including the receive/session ownership laws and their negative controls.
Git's atomic old-value comparison and correct host exit reporting remain host
assumptions. The runtime scenario moves the target during checks; it does not
force a change between the final target read and `update-ref`.

## Real worker and review

The Codex root recruited an OMP worker using `deepseek/deepseek-flash`, requested
effort `low`, through the native coordinator. The worker's native session was
`01a0ea07-6a9e-7000-af1e-b004c520a1f8`. The coordinator retained the report and
forwarded a mid-task guidance message; OMP returned a successful `steer` receipt.
The root read the retained report and acknowledged it after review. The root's
endpoint was empty in this run, so the run measures manual report consumption.

The worker committed the behavioral regression as `cc1c8984`, then resumed
the same conversation to address review as `9710be22`. The reviewed regression
failed on the preserved old binary at the unsafe `landed` result and passed
on the corrected binary. It verifies the held candidate's actual passing
check, preserved candidate contents, the freshly checked failing combination,
and the passing unchanged target. Its socket barrier determines event order.
Timeouts bound fixture observation and cleanup.

Bend2's first landing attempt reported an import conflict and retained its
scratch tree. The root merged the integration target into the worker branch,
kept the combined imports and updated the fixture to use the selected Python
interpreter. Commit `f5b883ca` preserves the worker commits and that resolution.
All 19 tests in the composed landing file passed. The subsequent checked
landing built and checked both trees, returned `landed` and advanced the
integration branch to `4f31f8dc` in 69.276 seconds. The worker branch and worktree
remained available. The measurement artifact records the complete result.

## Recovery composition and checks

The integration starts with the retained receive/session repair composed onto
`origin/bend2-rewrite` at `2bd4af0b`; its composition commit is `9107256b`.
Controlled supervisor-loss probes passed for Codex and OMP. Both kept one native
session owner, retained output and completion, drained pending input and
notified the parent. The updated host-restart probe killed retained owners as
well as supervisors and native processes, then resumed the recorded identities.
The retained missing-conversation fallback preserved a preexisting workspace
edit, completed the pending input and delivered the recovery and final reports.
No probe-owned process remained. The landing correction changes none of those
receive, session or harness functions.

The final `check-native.sh` run at `4f31f8dc` passed both Bend suites and all
128 Python tests in 11 files. It took 384.627 seconds and rebuilt
the same executable hash. Its log contains pipe-cleanup `ResourceWarning`
messages from the MCP test fixture; that file passed. The measurement artifact
retains the result, counts and log hash. The earlier check exposed two Bend cases with the previous automatic-rebase
expectation and one Python assertion expecting a target scratch tree before
conflict preparation reached that stage. The corrected tests require the
explicit retry and inspect the actual retained conflict and worker work.

## Reproduce

```sh
BEND=/path/to/bend sh bend2/scripts/check-native.sh
BEND_NO_TELEMETRY=1 node bend2/scripts/laws-check.mjs /path/to/bend
python3 docs/bend2/laws-check.py /path/to/bend
python3 bend2/test/land.py Land.test_target_moving_under_a_held_candidate_blocks_and_keeps_it
```

The regression uses the built coordinator and creates private fixture
repositories. On the previous runtime it fails at the first blocked-result
assertion. Worker branches, evidence worktrees and earlier review tips remain
available. Publication of this integration branch is a separate root action.
