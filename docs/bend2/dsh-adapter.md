# DeepSeek Harness adapter

`bend2/src/harness/dsh-player.bend` launches the official `@deepseek-ai/dsh`
headless profile. [Harness setup](harness-setup.md#deepseek-harness) describes
installation, `DSH_HOME`, the launch environment and the two patch overlays.

Pinned package: `@deepseek-ai/dsh@0.2.1-rc.2`. Route: provider
`deepseek-official`, model `deepseek-flash`, `reasoningEffort: max`. This is
the official npm TypeScript harness. It is not the macOS `dsh` 0.1 Python
workflow DSL.

## Verified protocol facts

Verified against `@deepseek-ai/dsh@0.2.1-rc.2` installed from npm:

- `dsh --profile headless --json [--session-id ID]` reads the task from stdin
  when no positional task is supplied. It reads to EOF; a trailing newline is
  not required, and the bytes are the task text rather than a JSON frame.
- The launcher parses `--profile` and `--patch` before the first app token.
  `--patch` is repeatable and is accepted before `--profile`.
- A patch entry replaces the targeted row's whole `config` object. A row that
  adds `reasoningEffort` restates `provider` and `model`.
- `--json` writes compact objects with `type` first: `session`, `status`,
  `thinking`, `text`, `tool_call`, `tool_result`, `final`. A fatal boot or
  usage error is an `error` object.
- The `session` object carries `sessionId` and `cwd`; it has no model field.
- Provider usage for a completed step is in a `status` object whose `phase` is
  `step_end`, under `usage`. The `final` object does not carry usage.
- Sessions persist at
  `$DSH_HOME/sessions/WORKSPACE/SESSION_ID/session.v4.jsonl.zstd`. A resumed
  session ID is refused when the current workspace differs from the recorded
  one.
- The headless composition mounts `session-persistence-jsonl` and
  `session-query-sqlite`, so `--session-id` adoption works.
- The headless profile disables the managed credential store; API-key routes
  read the launch environment, then `.env` files.

### Context window

The OMP client catalog records `contextWindow: 1000000` for `deepseek-flash`.
The provider `/models` reports `1,048,576` tokens. The values differ. The DSH
request carries no Baton context budget, and Baton does not gate input or
continuation on either number. The provider value is the route fact; the
catalog value is a client declaration.

## Minimal tool roster

`dsh-tool-fs` in 0.2.1-rc.2 has the per-tool switches `read`, `readImage`,
`write` and `edit`. The tool patch disables every other model-facing tool
plugin, sets `read:false`, `readImage:true`, `write:false` and `edit:false`,
and inserts one persistent shell group. The composed request carries exactly
`bash`, `read_image` and `working_directory`. `bend2/test/dsh-canary.py`
prints the request tool names, the effort and the event stream.

## Canary evidence

`bend2/test/dsh-canary.py` runs one tool call, its tool result and a
`--session-id` resume. The default mode uses a local Messages-compatible stub
and prints the child argv, the request tool names, the request effort and both
event streams. The observed request carried `["bash","read_image","working_directory"]`,
`output_config.effort` `max` and model `deepseek-flash`.

`DSH_CANARY_REAL=1` runs the same sequence against `DEEPSEEK_BASE_URL` or the
provider default with `DEEPSEEK_API_KEY` from the launch environment. The
recorded run returned a real `tool_call` and `tool_result` for `bash`, a
`status`/`step_end` usage sample, a `final` frame, and a second turn with the
same session ID. The run printed no credential.

## Known limitations

### DSH-USAGE-1: the DSH store is not read

`observed-usage` reads the public log for `status` frames whose `phase` is
`step_end` and sums the samples through `Dsh.usage`. It reports
`shape: "step-usage"` with the same component names as the OMP projection. The
DSH session store (`session.v4.jsonl.zstd`) is not read; the public log keeps
the same status frames as received.

### DSH-OBSERVE-1: the event stream does not report model or effort

The `session` object carries no model. Baton records the requested model and
effort in the session row; `observedModel` and `observedEffort` stay empty for
DSH. The provider request carries `output_config.effort`, so a capture of that
request can confirm the setting, but the `--json` stream cannot.

### DSH-WORKSPACE-1: resume is workspace-scoped

DSH records the workspace with the session and refuses `--session-id` from a
different directory. Baton treats that refusal as a lost conversation and
starts a fresh turn that names the workspace state
([`refusal_kind`](../../bend2/src/coordinator/turn.bend)). A seat that moves
workspace therefore loses its native conversation unless the store is moved
with it.

### DSH-AUX-1: the session-title request is outside the event stream

The headless app issues a separate model request for the session title. Its
usage is not part of the `--json` stream, so a turn's reported usage covers the
agent step and not the title request.

### DSH-MODELS-1: model discovery is unsupported

The CLI has no `models` command. `models` reports `unsupportedHarness` for
`dsh`; the provider catalog values in the request come from the model patch and
the provider's own catalog.
