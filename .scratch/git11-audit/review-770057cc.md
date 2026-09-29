# Read-only review of the composed #641 tip 770057cc (bend2-git11)

Swarm contribution: seq 429570, swarm-bend2-20260924 (contribution-b612e1c1edda3d784ed2836c1e6f1ee2).
Read-only. No build, test or gate. Retained extraction: `.scratch/review-770057cc`.

Tip: `770057cc24cf28acd443ec9a4d6aba8220e236f8` = `4676778a` -> `b68ac804` (attempt-bound host
controls) -> `9e8aed36` (retained OMP questions) -> `770057cc` (receive recovery laws with question
delivery futures). Sixteen files differ from `4676778a`.

## Counts

| Item | Value |
|---|---|
| laws | 248 (240 at 4676778a + 8 native-request) |
| implementation mutations | 22 (14 + 8) |
| `bend2/test/receive.py` tests | 27 (22 + 5) |

All 22 mutation anchors occur exactly once in their named production file; all 22 named laws exist;
every `find` differs from its `replace`. The `m17-refused-conversation` control's find/replace were
re-cut to the `deliveries` arity.

## Receive-law adaptation

`deliveries` was threaded through `complete_or_restart`, `completed`, `restart_pending`, `observed`
and `observed_dispatch`, and the restart helper gained `NativeRequests.settle(deliveries)`.

Production matches the helper line for line:

- `restart_pending`: release observer -> fork recovery wake -> `again` -> join -> **settle** ->
  acknowledge; `Turn.combine(Root.wake_result(delivered), Turn.combine(questions, next))`.
- `finish_pending`: fork report delivery -> `continue_pending` -> join -> **settle** -> acknowledge ->
  `exit_status`; `Turn.combine(finished, Turn.combine(questions, Turn.combine(next, status)))`.

So a question wake settles after report delivery and pending-input continuation and before the keeper
acknowledgement.

## The three flagged holes

| Hole | Law | Control |
|---|---|---|
| actual send chain | `native_reply_send_reads_recorded_request` | `native-reply-send-bypasses-open-request` |
| failed write marker | `native_reply_failed_write_has_no_success_marker` | `native-reply-write-failure-marked-success` |
| SQL parent | `native_reply_sql_checks_parent_method_and_immutable_answer` | `native-reply-parent-predicate-removed` (+ method-bypass, conflict-accepted) |

## Mechanism

- **Storage**: `native_requests` keyed on `(attempt,native_id)`, row id from the native request id and
  turn, `foreign_keys=ON`.
- **Admission**: `response_sql` requires recorded id + parent + `closed IS NULL`, exactly one key, a
  method-appropriate value (select must match a supplied option), and immutability via
  `id=CASE WHEN reply IS NULL OR reply=(frame) THEN id ELSE NULL END`; a conflict sets id NULL, the
  NOT NULL PK fails, the C layer `ROLLBACK`s and `changes()` reads 0 -> refused, nothing written.
- **Reply**: `dispatch` refuses when unadmitted; the write targets only the attempt read from the
  stored row; `written` is set only on success.
- **Async delivery**: `observe` records the request and its question message in one `BEGIN IMMEDIATE`
  and returns the row id; `saved` forks `deliver` per id; `deliver` picks reply->`send` or
  question->parent endpoint; `settle` joins before acknowledge.
- **Host callers**: `turn.consume` recognises `extension_ui_request` and calls `observe` only for a
  non-empty attempt; `receive` threads the list through `observed_output`/`complete_or_restart`;
  `main.execute` routes `native-reply`/`native-reply-file`.

## Observations (none a defect)

1. An unsupported OMP root request **fails the receive**: the `parent=false` branch's diagnostic
   becomes the turn's error and `Turn.failed` treats a non-empty error as failure, so the receive
   exits nonzero and answers the M-17 failure text. The fixture pins it (`ok=False`); the document
   calls it a diagnostic, which understates the runtime consequence.
2. The reply's line terminator is load-bearing and implicit: `baton_sql_row` writes `\n` after the
   last column, `send` trims `attempt` but leaves the frame untrimmed, so `control_write` writes
   compact JSON + one newline.
3. The refusal context query has no parent filter, so a caller naming another parent's request id
   learns that row's worker/parent/method/closed/written/responseStored. Inside the stated trusted
   local identity boundary; recorded without proposing authentication.
4. The duplicate-write window for simultaneous identical callers while the write is pending is real
   and disclosed; the stored answer stays immutable and both transmits carry the original native id.

## Limits

No build and no gate, so the typecheck claim is the author's; the anchor check is a parse of the
mutation table, not a compiler run. SQLite execution, socket identity, byte delivery and provider
behaviour remain the runtime boundaries the document names.
