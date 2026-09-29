# Native OMP questions

Retained OMP child receivers route native `input`, `select`, `confirm` and
`editor` requests to their registered parent. The parent inbox contains a
`question` message with the complete native request, its coordinator request ID,
the reply command and the expected response shape.

```sh
baton2 state.db native-reply PARENT REQUEST '{"value":"chosen answer"}'
baton2 state.db native-reply-file PARENT REQUEST response.json
```

Input and editor responses contain one string `value`. Select responses contain
one `value` matching a supplied option. Confirm responses contain one boolean
`confirmed`. Every supported method also accepts `{"cancelled":true}`. The file
form preserves multiline responses and accepts `-` for stdin. A `confirm` request
is an OMP extension UI interaction. Harness approval settings remain unchanged.

The coordinator checks the recorded parent and request before retaining an
immutable response. A conflicting response fails. An identical retry returns
the recorded write result or attempts the original pending write. The native
request ID and attempt directory come from the retained request. The parent
cannot select another attempt through this command.

`stdin-written` means that all response bytes reached the retained process's
stdin pipe. The SQL query's row framing supplies the JSON-line terminator.
OMP supplies no separate UI-response acknowledgment. Native output
and the eventual report establish subsequent progress. Transport failure can
follow a partial or completed write; retry uses the same stored native request
ID. OMP ignores responses for requests that have already resolved.
Simultaneous identical callers can write the same response more than once while
the write result is pending. The stored logical answer remains immutable, and
every transmitted response carries the original native request ID.

Parent message acceptance remains separate from a native reply. The keeper
retains the existing native process and observer while external reply commands
use its input queue. A parent wake runs concurrently with native observation.
The receiver settles that wake after outcome/report delivery and pending-input
continuation, before acknowledging keeper completion. This permits a parent to
answer and then wait for the child's report. Delivery failure remains distinct
from native completion.

Observer recovery replays the request log and the durable response record.
Completed writes are retained; an unwritten stored response can continue through
the original keeper. A terminal session stop refuses new native replies and
stored-response replay. Native cancellation, accepted stdin closure and actual
process exit prevent a late response from entering a later attempt. Full request
frames, responses, cancellation/exit state, messages and reports remain readable
in the coordinator database and retained native log.

This path supports retained OMP children. OMP root requests with no registered
parent retain their raw frame and record an unsupported-interaction error. That
error makes `receive` fail after the native process exits. A native process
waiting for the unanswered request can remain waiting until explicitly stopped.
Direct `turn`, Codex `exec`, Claude and Muse have no native reply mapping here.
Keeper loss and host restart remain outside the surviving-owner recovery proof.

The operative [request laws](../../bend2/src/coordinator/native-request-laws.bend)
constrain response admission, recorded attempt/frame selection, dispatch,
failed persistence and failed writes in the called functions. SQLite validation,
socket identity, byte delivery, native PID ownership and provider behavior are
runtime boundaries. [Receive tests](../../bend2/test/receive.py) exercise parent
routing, matched replies and observer recovery;
[host tests](../../bend2/test/retained-control.py) exercise the shared input queue,
attempt identity, signaling and native reaping.

## Terminal session stop

```sh
baton2 state.db stop WORKER stop-review-1 'The parent ended this task.'
baton2 state.db session WORKER
baton2 state.db inbox WORKER
baton2 state.db force-stop WORKER stop-review-1
```

`stop` records a terminal state for a retained OMP or Codex session. Current
execution receives TERM through its recorded keeper and native process group.
Queued task, guidance and recovery input keeps its original body and receipt,
with a stopped execution disposition. New execution input is refused. An exact
stop retry reads the recorded operation; a different stop ID or reason refuses.
There is no reopen command. Recruit a new session for new work.

The answer reports `requested` while the native process remains owned, the
requested signal, submitted signal and any control error. Actual wait status
sets `stopped` and `nativeStatus`. An idle stop reports `stopped` with no native
status, requested signal or completion report. `stoppedInputs` counts its
unacknowledged task, guidance and recovery input. `force-stop` submits KILL only to the same recorded
attempt while it remains current and has not exited. The operator chooses when
to force; the runtime has no escalation timer.

Native output, conversation identity, workspace and branch remain available.
After actual native exit, the observer records a stop report, releases session
ownership and delivers the report to the parent. The stop command returns
without waiting for native completion or the parent's endpoint. Observer loss
reattaches to the retained attempt and reconciles its accepted stop. An active
direct `turn` is unsupported and returns a refusal with its work unchanged.

Preexisting unacknowledged reports and questions remain in a stopped session's
inbox; `pendingReports` names their count in the stop result. A new or retried
report or question creates one ordinary notice for that session's recorded
parent. The notice identifies the original recipient, message and retained work.
The original body and receipt stay unchanged. With no higher parent, the
original input remains pending. If the higher parent is stopped or has no usable
endpoint, its notice remains pending too. Both cases expose an explicit delivery
condition. Endpoint failure is reported through ordinary delivery.
These notices do not record acceptance or review by the stopped session.

The process boundary is the retained native harness and descendants still in
its process group. Keeper loss, host restart and descendants that leave that
process group remain outside the stop proof. Stopping one session does not stop
its recruited children.
