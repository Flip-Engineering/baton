# Logging utility fixtures and real-trace measurements

Issue 686 (practical logging) and issue 696 (retained replay). This document
records the provenance of the fixtures in `bend2/test/fixtures/` and the
measured utility figures behind them. Fixture assertions live in
`bend2/test/logging-utility.py`.

## Source evidence

All byte counts below come from closed, retained provider output that was
read but not modified:

- Keeper spool: `orchestra.db.attempt-726563656976653a61756469742d6e61746976653a3933353a6362323738326433633266306565386563386332653736626633393332616137/stdout`
  (receive attempt of `audit-native`, exited, acknowledged). SHA-256
  `d38a60c4…9a07a283b`. 28,040 lines, 5,484,418 bytes.
- Native session store: `orchestra.db.sessions/2026-10-06T18-46-28-589Z_01a11289-e1ed-767b-80fb-5ead5cb35ae2.jsonl`
  (session of `logging-impl-20261006`, closed). 1,675 lines, 5,381,378 bytes.
- Retained turn events: the shared `turns` table (2008 OMP, 957 Codex,
  403 Muse turns).

Local filesystem paths in the fixtures were rewritten from
`/Users/wahargis` to `/fixture-home`. Frame structure, order, and counts are
unchanged. The fixtures carry no credentials: a pattern scan found only
usage-accounting fields (`totalTokens`, `cost`) and path strings.

## Measured composition

Keeper spool (5,461,251 bytes over the JSON lines):

| Frame type | Frames | Bytes | Share |
| --- | --- | --- | --- |
| message_update | 27,813 | 4,556,341 | 83.4% |
| message_end | 42 | 211,731 | 3.9% |
| turn_end | 18 | 185,050 | 3.4% |
| agent_end | 2 | 163,300 | 3.0% |
| message_start | 42 | 81,993 | 1.5% |
| tool_stream_update | 38 | 63,918 | 1.2% |
| tool_execution_update | 11 | 63,374 | 1.2% |
| tool_execution_end | 16 | 51,450 | 0.9% |
| response, starts, misc | 58 | ~95,000 | 1.7% |

Sub-event split inside message_update: thinking_delta 20,340 frames
(3,247,404 bytes), text_delta 1,989 frames (310,841 bytes), toolcall_delta
5,378 frames (856,730 bytes, mostly empty deltas), start/end markers
(~180,000 bytes).

Utility pairing on the same spool: all 19 update-bearing message identities
have a matching message_end; 53 delta streams pair with their end frames, 36
with byte-identical reassembled content. The retained ~17% (ends, starts,
terminal frames) carries turn outcome, tool results, token usage, and cost
fields; the dropped 83% carries only intermediate deltas whose streams all
terminate in a retained end frame.

Native session store file (5,381,378 bytes): `message` records 93.1%
(assistant 420 frames with usage, model, provider, stopReason, timing;
toolResult 592 frames), `custom` 4.4%, `custom_message` 2.5%. Content fields
hold 3,515,516 bytes and tool details 1,123,668 bytes; usage totals 99,028
bytes and context snapshots 30,214 bytes. These are per-message records, not
cumulative snapshots.

Codex retained turns (max 1,673 bytes) keep a result envelope with the report
text, token usage (input, cached input, output, reasoning), and the terminal
event, plus an artifact path reference instead of inlined content. Muse
retained turns total 424,678 bytes across 403 turns (max 28,710 bytes).

Muse provider log (`logging-muse-20261006-provider.jsonl`, 1,112 lines /
1,280,011 bytes, uniform envelope keyed by `payload_type`):

| Payload type | Frames | Bytes | Share |
| --- | --- | --- | --- |
| task.lifecycle.output | 33 | 269,280 | 21.0% |
| tool.result | 33 | 265,276 | 20.7% |
| run.output.delta | 314 | 167,438 | 13.1% |
| task lifecycle rest (proposed/accepted/scheduled/started/status/completed/rejected/failed/intent) | 616 | 495,313 | 38.7% |

The 314 output deltas reassemble byte-exactly into the run.terminal.completed
text, and one `task.lifecycle.tool_output_ref` frame carries an output_ref id:
the provider already uses artifact references. No cumulative snapshots occur
in this vocabulary; repetition is per-task lifecycle restatement.

Codex provider log (`ui682-codex-luna-backend` run, 1,311 lines /
12,375,784 bytes): item.completed 97.2% (676 frames, all unique ids;
command_execution 536 frames averaging 22,341 bytes and peaking at 1,073,872
bytes; agent_message 43; file_change 96), item.started 2.8%. Amplification
here is full per-command outputs, not duplication: the remedy is
size-bounding with artifact references, not deduplication.

## Fixture map

- `bend2/test/fixtures/logging-utility-spool.jsonl`: 350 verbatim frames
  (87,212 bytes) — two complete assistant delta/end identities, one complete
  tool_execution start/update/end stream, and one turn_end frame.
- `bend2/test/fixtures/logging-utility-open-stream.jsonl`: the first 60
  message_update frames of one assistant identity (9,517 bytes) with no
  closing frame, which models an interrupted turn.
- `bend2/test/fixtures/logging-utility-open-tool.jsonl`: one real
  tool_execution_start plus three tool_execution_update frames (26,149 bytes)
  with the end removed, which models a tool call that dies before its end.
- `bend2/test/fixtures/logging-utility-cumulative.jsonl`: three consecutive
  tool_execution_update frames (61,515 bytes) from a 5,514-frame chain that
  totals 277,410,614 bytes for one tool call. The full chain grows 8.4x from
  first to last frame; `args` (7,686 bytes) are byte-identical across every
  frame while the `details` object accumulates progress.
- `bend2/test/fixtures/logging-utility-muse.jsonl`: 50 contiguous frames
  (54,245 bytes) from a real Muse provider log covering session setup, task
  lifecycle envelopes, output deltas, and a tool result.
- `bend2/test/fixtures/logging-utility-codex.jsonl`: 15 frames (24,692 bytes)
  from a real Codex provider log: turn/thread markers, agent messages, small
  command_execution items, and the turn.completed frame.
- `bend2/test/logging-utility.py`: executable turn-level checks (ends kept
  byte-identical, updates dropped at default, newest updates surviving ends,
  retention ratio, open-stream and open-tool flush) plus executable-free shape
  pins (cumulative args repetition, Muse envelope and tool result presence,
  Codex item uniqueness with terminal).

## Interrupted-work sufficiency

- An assistant stream that dies before message_end leaves its newest
  message_update flushed at turn end plus the per-frame checkpoint. The
  retained text is the last partial output, not a final record: it suffices
  to resume the work with context in a follow-up turn, and the outcome names
  the interruption on the read-failure path.
- A tool call that dies before tool_execution_end leaves its start frame
  (tool name and arguments) and its newest update (last partial result). That
  pair suffices to retry or continue the call without re-reading the dropped
  intermediate updates.

## Open validation

The four checks run in `bend2/scripts/check-native.sh` with the other
`bend2/test/*.py` files. They were authored against primary `5a58d1bd` and
not executed locally; all execution is remote-only. The remote run owns the
pass/fail record.
