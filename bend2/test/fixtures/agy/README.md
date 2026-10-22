# agy stream fixtures

`success-1.3.5.jsonl` is a stdout capture of `agy -p=... --output-format stream-json` from agy 1.3.5
(one successful turn). `auth-failure-1.4.5.jsonl` and `auth-failure-1.4.5.stderr` are the stdout and
stderr of agy 1.4.5 run with `--input-format stream-json --output-format stream-json` before sign-in;
the process exits with status 1. Authentication failure emits no `init` event and an empty `conversation_id`.
