# Operator frictions of 2026-11-26: open work and faults met

Branch `fable/operator-frictions-20261126` on `7592d67fe`. The commits fix the
seven faults of the operator brief (#1477, #1217/#1488, #1461, #1059, the route
refusals, #1485 and the origin remote), the observability items of the lead's
widening, and two receive tests under the rule that an input is owed until a
model turn took it. This file keeps what the branch did not
finish and the further faults met while it was made, each with the command
that shows it. `DB` is a seat database, `SESSION` a recorded session, `BATON`
the coordinator executable and `HOME=EMPTY` an empty home directory.

## Still open

1. Status rows carry no time of the native's last output. The `silent` seat
   event reads the attempt stdout modification time itself
   (`bend2/scripts/seat-events.mjs`).
   Command: `baton DB status` lists no `lastOutputAt` field.

2. `orchestra`, `status` and `session` still build each row in one statement.
   They fit on SQLite 3.45.1 today; the `session` statement has a parser margin
   of three nested `SELECT` levels there.
   Command: `LD_LIBRARY_PATH=/usr/lib/x86_64-linux-gnu baton DB session SESSION`
   (Ubuntu 24.04 library 3.45.1). The margin was measured by preparing the
   captured statement inside added `(SELECT ...)` levels until SQLite answered
   "parser stack overflow".

3. In the Codex receive fixtures the retained output log holds only the first
   frame (`thread.started`); the attempt stdout spool holds every frame. With a
   `turn.failed` terminal the turn and its report are right, but neither the
   error frame nor `turn.failed` reaches that log. 5ec4d1794 appends a final
   provider error frame when no terminal was read; the cause of the missing
   frames is not found.
   Command: in a `NativeObservation` test of `bend2/test/native-observation.py`,
   `self.player()`, a task, `self.action(stream, native_line=json.dumps({'type':
   'error','message': 'x'}))`, `self.action(stream, fail=True, ack=False)`,
   then read the file named after `Output:` in the coordinator's report and the
   attempt directory's `stdout`.

## Other Baton faults met

1. A project pointer that ends with a newline is not read, and the error does
   not name the path.
   Command: `printf '%s\n' "$R/.git/baton2/orchestra.db" > "$R/.git/baton2/database";
   baton --project "$R" as SESSION finish 'Done.'` prints `unable to open
   database file`.

2. Fixtures inherit `HOME` and `PATH`. With the seat home's series registry
   (`~/.config/baton/github-apps/series.json`), recruitment of a fixture model
   is refused, and the release `git-series-bin` wrapper is first in a seat's
   `PATH`.
   Command: `python3 bend2/test/native-observation.py
   NativeObservation.test_a_claude_native_stdin_follows_the_latest_task_list_in_a_large_retained_stdout`
   run as the seat user fails at recruit with "Series Git operation refused:
   Select an explicitly configured model mapping or registered series."; with
   `HOME=EMPTY` and that `PATH` entry removed it passes.

3. `Control.eventually` (`bend2/test/control.py`) loops without a bound, so a
   condition that never holds hangs its test.
   Command: `grep -n "def eventually" -A6 bend2/test/control.py`.

4. d5c4bd01f fixes the cause of the untaken count: the Claude input evidence
   query took more than 900 s on a 5.2 MB current prompt, Claude Code cancelled
   the hook at 600 s, and no read was recorded. The hook still converts the
   whole current prompt to one JSON array on each call: 5.1 s and 1.4 GB of
   memory for the 11.9 MB transcript of the seat that met the fault.
   Command: in `bend2/test/stop-hook-entry.py`, `combined_lifecycle` with the
   `long` label and a larger frame count, timing each `--stop-hook` call.

5. The series identity check drops the helper's refusal from its own line:
   "The configured series identity check failed for recorded model M: helper
   exited 1: ." The helper's text appears only on the preceding stderr line,
   because the coordinator captures only the helper's stdout.
   Command: `baton dispatch --project P --new --harness claude-code --model
   sonnet --effort high --text x` with a series registry that lacks `sonnet`.

6. `bend2/test/agent-actions.py` hangs in
   `test_operator_confirms_a_worker_whose_ancestors_have_all_ended`, and fails
   at the tests with indexes 8 to 12, 19 and 44 to 46 of its sorted order, on
   `7592d67fe` and on this branch alike.
   Command: `HOME=EMPTY python3 bend2/test/agent-actions.py` (stop it at the
   hang).

7. The full `bend2/test/native-observation.py` reached its 3000 s bound after 16
   tests with failures from the third test on, on `7592d67fe` and on this branch
   alike. Those runs were concurrent with other suites, so the failures may
   depend on that load; single cases pass alone.
   Command: `HOME=EMPTY python3 bend2/test/native-observation.py`.

8. A seat started by a release in a side-by-side prefix runs the `baton` that
   its `PATH` names, which is the release that `~/.local/bin` links to. Actions
   that only the new release has fail in the seat: `baton blocked "needs X"`
   printed the general usage and exited 2 under 2.0.25-main-2684a288fe.
   Command: dispatch from
   `2.0.25-operator-frictions-ae6338e79e-20261126/bin/baton` while
   `~/.local/bin/baton` names 2.0.25-main-2684a288fe, with the task "run baton
   blocked TEXT", then read the seat transcript.

9. After a `blocked` report, the end of the seat's turn still queues a task
   continuation ("sent no completion request. Baton queued continuation"),
   which wakes the seat and asks it to request completion; the seat then sent
   a completion request that says it is blocked. The status state is `blocked`
   only while the seat's newest message is the blocked report, so the turn-end
   report that follows it gives `working` or `waiting`.
   `bend2/test/blocked-report.py` sends no turn-end report and does not show
   either case.
   Command: dispatch a Claude Code seat whose task is `baton blocked "needs X"`,
   then `baton DB status` and the seat's messages after its turn ends.

10. `status` of the four largest seat databases under the seat home took 5.6,
    2.4, 1.5 and 0.5 s (0.6 to 1.9 GB); all 53 databases took 13.8 s. A seat
    event follower evaluates every database on its interval.
    Command: time `baton DB status` for each database that `baton seats --root
    ~/worktrees` reads.

11. `bend2/test/task-start.py` against the plain `main.bend` build of
    `ae6338e79`, each test run alone with a 300 s bound: 23 of 35 pass and the
    same 10 fail on `ae6338e79` and with this branch's later commits. Three
    hang in `Control.eventually` (fault 3): two wait in `close_fixtures` for a
    fixture instance owner that `--instance-shutdown` reports `absent` and that
    keeps running, and one waits in `accept` for a native that never connects.
    `test_primary_dispatch_routes_consume_literal_flag_text_and_select_named_agents`
    is refused with "root session operator has 4 owed inputs and no attached
    channel". Three continuation tests do not find the dispatched text in the
    native's input, `test_stopped_session_and_explicit_new_assignment_leave_owned_state_unchanged`
    finds an extra `stop-result` message,
    `test_profile_append_failure_retains_applied_configuration_and_complete_unadmitted_input`
    reads the route `kimi-code/k3, low` for `gpt-6-astra, high`, and
    `test_receiver_setup_failure_retains_input_and_native_error_without_admission`
    gets `taskOperationFailed` for `taskCommandMissing`. Two other tests
    (`test_an_operator_dispatch_starts_the_notify_follower_that_runs_the_configured_command`
    and `test_non_git_nested_workspace_uses_native_prefix_membership_and_rejects_adjacent_path`)
    failed once each and passed in three reruns. The control tests read the
    coordinator only from `.scratch/bend2/baton2` and copy it alone, so a
    release `bin/baton` (the receiver router) waits there in `select`.
    Command: `HOME=EMPTY python3 bend2/test/task-start.py TaskStart.NAME` with
    `.scratch/bend2/baton2` built by `sh bend2/scripts/build-native.sh`.
