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

4. The Claude Code PostToolUse hook adds owed input to the conversation without
   recording a read, so status and the `operator-input-untaken` event count the
   input as untaken until the seat runs `baton inbox`.
   Command: send guidance to a working Claude Code seat, let it make tool
   calls, then `baton DB status`: `pending` and `inputWaitingSince` stay set.

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
