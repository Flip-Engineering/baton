# agy stream fixtures

## Recorded

- `success-1.3.5.jsonl` is a stdout capture of `agy -p=... --output-format stream-json` from agy 1.3.5
  (one successful turn).
- `auth-failure-1.4.5.jsonl` and `auth-failure-1.4.5.stderr` are the stdout and
  stderr of agy 1.4.5 run with `--input-format stream-json --output-format stream-json` before sign-in;
  the process exits with status 1. Authentication failure emits no `init` event and an empty `conversation_id`.

## Constructed from the documented protocol

These files were written by hand from the stream-json protocol documented for the agy harness
(issue #721). No agy process produced them, so they are not evidence of the real CLI output.

- `resumed-success.jsonl` has the same shape as `success-1.3.5.jsonl`. Its `conversation_id`
  values are a placeholder (all zeros). `bend2/test/fake-agy` replaces each non-empty
  `conversation_id` with the value given by `--conversation`, so the replayed turn carries the resumed id.
- `provider-error.jsonl` is an `init` event followed by a `result` with `status` `ERROR`,
  an `error` string and a non-empty `conversation_id`.
- `tool-success.jsonl` has `init`, two tool steps with `tool_info`, an `agent_response` step and a
  `result` with `status` `SUCCESS`. The protocol names the `tool_info` field but does not
  describe its contents, so the `tool_info` objects and the `tool_call` step type are guesses.
  Replace them with recorded output when a capture is available.
