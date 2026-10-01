# Answering a native question from a retained OMP child

A retained OMP child receiver routes native `input`, `select`, `confirm` and `editor`
requests to its registered parent. The coordinator retains the request row and places a
`question` message in the parent's inbox. The message body holds the native request
frame, the coordinator request ID, the reply command and the expected response shape.

`parent` below is the session recorded as the question's recipient.

## Read the question

```sh
baton2 state.db inbox parent
```

The inbox returns unacknowledged messages in store order. A question body is a JSON
object:

```json
{"nativeRequest":{"type":"extension_ui_request","id":"input request Ω","method":"input","title":"Which work should continue?"},
 "requestId":"t1:native:...",
 "replyCommand":["native-reply","parent","t1:native:..."],
 "replyFormat":"{\"value\":\"answer\"} or {\"cancelled\":true}",
 "completion":"stdin-written records transport completion; native continuation is observed separately"}
```

## Answer

```sh
baton2 state.db native-reply parent REQUEST_ID '{"value":"Keep the existing work.\nUse the selected branch."}'
baton2 state.db native-reply-file parent REQUEST_ID answer.json
printf '%s' '{"value":"one line"}' | baton2 state.db native-reply-file parent REQUEST_ID -
```

`input` and `editor` take one string `value`; `select` takes one `value` that names a
supplied option; `confirm` takes one boolean `confirmed`. Every method also accepts
`{"cancelled":true}`. `native-reply-file` reads the file it names, and `-` reads standard
input, which keeps a multiline answer intact.

A successful answer writes `{"status":"stdin-written"}` to standard output and exits 0.
The coordinator checks the recorded parent and the recorded method before it retains one
immutable response. An identical retry answers with the recorded write result; a
different answer for the same request fails. The frame goes to the attempt directory
stored in the request row.

## What a successful answer reports

`stdin-written` reports that the coordinator handed the response frame to the retained
process's stdin pipe. The frame is one JSON line, `extension_ui_response`, carrying the
original native request ID. Native continuation is separate: the retained harness reads
that frame from its stdin and acts on it, and the coordinator observer stays alive past
the write. The retained child's own report is what shows progress after the answer.

## Accept the question and wait for the report

```sh
baton2 state.db ack QUESTION_ID parent parent-received
baton2 state.db delivery QUESTION_ID
```

An acknowledgement binds to the message ID and the named recipient and keeps the first
receipt, so `delivery` reads back the stored row:

```json
{"id":"...","sender":"child-id","recipient":"parent","kind":"question","receipt":"parent-received"}
```

The coordinator retains the child's message and wakes the parent's registered endpoint
with it. The child's later report arrives as an ordinary message in the same inbox:

```sh
baton2 state.db inbox parent
```

The keeper retains the native process and the observer while the reply commands use its
input queue; a parent wake proceeds alongside native observation, and the receiver
settles that wake after the outcome report is delivered.

## Refusals

`native-reply` exits non-zero and writes a `Native reply refused.` line to standard error
when the request is unknown, the caller is not the recorded parent, the response shape
does not match the method, the request is closed by native cancellation or native exit,
or the worker session is terminally stopped. A `stop` on the worker refuses later native
replies for that session.

## Source

- `bend2/src/coordinator/native-requests.bend` — `request_sql`, `response_sql`, `reply`, `send`, `written`.
- `bend2/src/host/text.c` — `-` reads standard input.
- `bend2/src/coordinator/main.bend` — `native-reply` and `native-reply-file` dispatch.
- `bend2/src/coordinator/commands.bend` — acknowledgment receipt binding.
- `bend2/test/receive.py` — `test_native_question_parent_answers_and_waits_for_full_report`.
