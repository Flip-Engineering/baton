# Answering a native question from a retained OMP child

A retained OMP child receiver routes native `input`, `select`, `confirm` and
`editor` requests to its registered parent. The coordinator retains the request
row and places a `question` message in the parent's inbox. The message body holds
the native request frame, the coordinator request ID, the reply command and the
expected response shape.

`parent` below is the session recorded as the question's recipient.

## Read the question

```sh
baton2 state.db as parent inbox
```

The agent `inbox` action returns the parent's pending complete messages. Baton
records each complete owned read against the current native turn. The read
persists if the turn later fails, and unread input remains pending.

A question body is a JSON object:

```json
{"nativeRequest":{"type":"extension_ui_request","id":"input request Ω","method":"input","title":"Which work should continue?"},
 "requestId":"t1:native:...",
 "replyCommand":["native-reply","parent","t1:native:..."],
 "replyFormat":"{\"value\":\"answer\"} or {\"cancelled\":true}",
 "completion":"stdin-written records transport completion; native continuation is observed separately"}
```

## Answer

The agent `native-reply` action answers the unique pending native request addressed
to the parent. `--to WORKER` selects a worker when several requests are pending. An
explicit `--request ID` remains available.

```sh
baton2 state.db as parent native-reply --text '{"value":"Keep the existing work.\nUse the selected branch."}'
baton2 state.db as parent native-reply --file answer.json
printf '%s' '{"value":"one line"}' | baton2 state.db as parent native-reply --file -
baton2 state.db as parent native-reply --to worker --text '{"confirmed":true}'
```

`input` and `editor` take one string `value`; `select` takes one `value` that names
a supplied option; `confirm` takes one boolean `confirmed`. Every method also
accepts `{"cancelled":true}`. `--file` reads the file it names, and `--file -` reads
standard input, which keeps a multiline answer intact.

## What a successful answer reports

A first successful answer writes
`{"request":"REQUEST_ID","status":"stdin-written"}` to standard output and exits 0.
An identical retry while the request remains open after a completed write returns
`{"status":"stdin-written"}`.

`stdin-written` reports that the coordinator handed the response frame to the
retained process's stdin pipe: `send` dispatched the stored frame and `written`
marked `written=1`. The frame is one JSON line, `extension_ui_response`, carrying
the original native request ID. Native progress is reported separately: the
retained child's later output and report establish that it consumed the frame, and
the observer continues to track native work after the write. Waiting for that
report is the parent's own decision.

## Parent message acceptance

The coordinator retains one immutable response for the request. `response_sql`
admits the supplied value only when it is a single-key object of the request
method's type, or an explicit `{"cancelled":true}`, on a non-closed request whose
worker is not stopped. The stored reply uses `coalesce(reply,...)`, so an identical
retry is idempotent and a different answer for the same request is refused.

Acceptance of the question message is a separate record from the reply. The
parent's inbox read records the complete read internally, so `delivery` reads
back the stored row with its read state, and the read persists if the turn fails.

The focused receive test
(`bend2/test/receive.py`,
`test_native_question_parent_answers_and_waits_for_full_report`) observes a fixture
rather than a native turn. Its `answering_parent` fixture reads the question
message with `baton2 state.db as root read QUESTION_ID` and the test checks the
recorded read.

The coordinator wakes the parent's registered endpoint with the retained question.
The child's later report arrives as an ordinary message in the same inbox:

```sh
baton2 state.db as parent inbox
```

## Refusals

With no pending unanswered request addressed to the parent, or several without a
`--to` worker, `native-reply` refuses and asks for `--to WORKER`; an absent or
ambiguous request is never answered.

`native-reply` exits non-zero and writes a `Native reply refused.` line to standard
error when the request is unknown, the caller is not the recorded parent, the
response shape does not match the method, the request is closed by native
cancellation or native exit, or the Player session is terminally stopped. A `stop`
on the Player refuses later native replies for that session.

## Source

- `bend2/src/coordinator/agent-domain.bend` — the `native-reply` action and its automatic request selection.
- `bend2/src/coordinator/agent-native.bend` — `reply_identity_sql` and `prepare_identity` resolve the request.
- `bend2/src/coordinator/agent-command.bend`, `bend2/src/coordinator/agent-input.bend` — the `inbox` read and automatic handling.
- `bend2/src/coordinator/native-requests.bend` — `response_sql`, `reply`, `send`, `written`.
- `bend2/src/coordinator/native-request-laws.bend` — dispatch and admission laws.
- `docs/bend2/native-interactions.md` — operator-facing description.
- `bend2/test/receive.py` — `test_native_question_parent_answers_and_waits_for_full_report`.
