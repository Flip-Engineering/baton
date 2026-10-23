# Antigravity CLI adapter

`bend2/src/harness/agy-player.bend` launches the Google Antigravity CLI
(`agy`) in its stream-json print mode. The database harness name is
`antigravity`; the executable is `agy`.
[Harness setup](harness-setup.md#antigravity-cli) describes installation and
sign-in. This adapter is issue #721.

## Launch

```sh
agy --input-format stream-json --output-format stream-json \
  --dangerously-skip-permissions --print-timeout 0 \
  --model MODEL --effort EFFORT [--conversation CONVERSATION_ID]
```

Baton writes one `user` frame on stdin and closes stdin. The process runs that
turn and exits. A later input to the same seat starts a new process with
`--conversation` set to the recorded native identity. The task text travels only
on stdin, because with stream-json input the CLI drops a prompt given by `-p`.

## Model and effort

An `agy models` entry carries its effort tier in its id, for example
`claude-sonnet-5-5-high` or `gemini-4-argon-high`. Baton records the full id as
the model and the tier word as the effort, and passes `--model` and `--effort`
with those values. `--effort` also accepts `xhigh` and `max`. Whether the CLI
accepts an `--effort` that differs from the tier in the model id is not yet
observed.

The launch registry (`series.json`) maps each recorded model id to a Git
identity series. The agy Claude ids map to the `claude` series. The Gemini and
`gpt-oss` ids are registered with a `null` series because no GitHub App
identity is assigned to them yet; selecting one of them for a launch is refused
with `The model MODEL is registered without a GitHub identity series.`

## Verified protocol facts

Verified from the official headless documentation and from runs of agy 1.4.5
(before sign-in) and recorded agy 1.3.5 output:

- stdin takes one JSON object per line:
  `{"event":"user","message":{"content":"TEXT"}}`. `content` may also be a list
  of `{"type":"text","text":...}` blocks. A line that is not JSON, has no
  `event`, or carries another block type exits with status 1. A
  `control_request` or `control_response` event, or a CLI-handled slash command
  such as `/model`, exits with status 2. An unknown `event` name is skipped
  with a stderr warning.
- stdout carries `init`, `step_update` and `result` objects with `event`
  first. `init` carries `conversation_id` and `init.{cwd,tools,permission_mode}`.
  `step_update` carries `step_update.{conversation_id,step_index,state,step_type,
  text_delta,duration_seconds,usage,tool_info}`. `result` carries
  `result.{conversation_id,status,response,error,duration_seconds,num_turns,usage}`.
- `result.status` is one of `SUCCESS`, `ERROR`, `CANCELED`, `INTERRUPTED`,
  `INVALID`, `WAITING`, `RUNNING`. In a streaming session `response` covers the
  current turn and `num_turns`, `usage` and `duration_seconds` are cumulative.
- Before sign-in the process prints one `result` with status `ERROR`, error
  `authentication failed or timed out` and an empty `conversation_id`, writes
  `Error: authentication required. Run 'agy' to log in, then retry.` to stderr
  and exits with status 1. No `init` event precedes it. The captures are in
  `bend2/test/fixtures/agy/`.
- The 1.2.6 changelog states that exit status 3 reports an agent or model
  failure and that the default print timeout is unlimited. `--print-timeout 0`
  states that choice explicitly.

## Event projection

The coordinator already reads native identity from a `{"type":"session","id":...}`
frame and the terminal report from a `{"type":"result",...}` frame.
`Agy.event` projects `init` to the first and `result` to the second:
`is_error` is 1 for every status other than `SUCCESS`, and the result text is
`response` on `SUCCESS` and otherwise the provider `error`, or the status name
when `error` is empty. `step_update` frames are logged as received, and the
public log keeps the raw line of every frame. Observed usage is the
`result.usage` object.

## Open items

- A live call has not run: the binary was not signed in when this was written.
  Multi-turn behavior on one process, `--conversation` with an unknown id (the
  stderr text and exit status), the `--effort` and model-tier interaction, and
  whether `--print` is needed alongside stream-json input are unverified.
- The harness has no subscription-profile or account binding. Credentials come
  from the account that signed in under the batonci home.
- MCP registration of agy seats (`agy mcp`) and the MCP handling witness are
  not part of this adapter. Seats use the `baton` command line.
- Observed-usage projection (`Agy.usage` extracts the object) is not yet read
  by `usage.bend`; model discovery (`agy models`) is not wired into `models`.
- Unrecognized stderr refusal text is not mapped to the restart-with-note path
  that `dsh` and Codex have.
