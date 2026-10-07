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

## Fixture map

- `bend2/test/fixtures/logging-utility-spool.jsonl`: 350 verbatim frames
  (87,212 bytes) — two complete assistant delta/end identities, one complete
  tool_execution start/update/end stream, and one turn_end frame.
- `bend2/test/fixtures/logging-utility-open-stream.jsonl`: the first 60
  message_update frames of one assistant identity (9,517 bytes) with no
  closing frame, which models an interrupted turn.
- `bend2/test/logging-utility.py`: four checks. Ends kept byte-identical,
  updates dropped at the default level, newest tool update surviving its end,
  retained bytes below half the input, and the open stream flushing exactly
  its newest update at turn end.

## Open validation

The four checks run in `bend2/scripts/check-native.sh` with the other
`bend2/test/*.py` files. They were authored against primary `5a58d1bd` and
not executed locally; all execution is remote-only. The remote run owns the
pass/fail record.
