# #769 restored-owner disposition review

Status: source and evidence review by logging-deepseek (restored seat), 2026-10-19. No compiler,
build, check, CI, push or merge was executed. The method is git object inspection plus a
compiler-free SQL and fixture reproduction.

## 1. Retained worktree reconciliation

The original retained worktree
`retained/baton-account-credits-793-702-20261017T0106Z/worktrees/logging-deepseek` and the
restored worktree `home/worktrees/logging-deepseek-restored-20261019` contain no differing file
outside `.git`, `.scratch`, `node_modules` and `.bend`:

```
diff -rq --exclude=.git --exclude=.scratch --exclude=node_modules --exclude=.bend \
  <retained>/worktrees/logging-deepseek <restored>
```

returns no line. The retained worktree has no unique source work to reconcile. Branch
`logging-deepseek-769` is at `a5ecbfa8e` and carries no earlier owner commit.

## 2. Current main inventory

Main commit `7e5bc4698` (`Fix receive span retention and checkpoint flow`, 2026-10-17) contains
the #769 behavior:

- `bend2/src/coordinator/logs.bend:219-223`: `frame_id_sql_value` gives `message_start`,
  `message_update` and `message_end` frames without `toolCallId`, `messageId` or `message.id`
  the `omp-open-message` identity, then the two responseId fallbacks and the empty fallback.
- `bend2/src/coordinator/turn.bend:690`: `filter_mode_sql` classifies a `set_event_filter`
  response with `success` false and no `id` as `refused`.
- `bend2/src/coordinator/observer-checkpoint.bend:121-135`: `checkpoint_due_next` omits the
  output position from the due decision.
- `bend2/src/coordinator/turn.bend:1003-1005`: `consume` reads the next frame after
  `consume_frame` returns.

`bend2/scripts/check-issue769-baseline.py` confirms the behavior from main's own SQL. Against the
restored baseline it exits 1 with four recorded defects. Against `git show main:` copies of
`logs.bend` and `turn.bend` it exits 0: one snapshot written for an interrupted message, zero for
a closed message, `refused` for the missing-id answer, and six of six lifecycle frames carrying
an identity.

Main does not contain the following.

- **#770 status retention.** `bend2/src/host/process-spawn.c:1371-1389`
  (`br_record_native_exit`) writes `status` and returns the write error before
  `br_send(BR_EXIT)`. On ENOSPC the keeper loop exits without flushing the exit frame, and an
  attached observer reports an unknown status. The reaped status is lost. The successor branch
  changes this at `5f12e4508`; `ebc843035` is not an ancestor of main.
- **Filter marker on the read-failure path.** `bend2/src/coordinator/turn.bend:975-992` flushes
  held lines and the interrupted marker without `Omp.filter_note`. `consume_exhausted` includes
  the marker at `turn.bend:870`. The successor change is `420bf56f2`.
- **Regression tests for the two measured shapes.** `bend2/test/logs.py:902-913` covers an
  unfinished message that carries `messageId`. `bend2/test/turn.py:453-472` covers an id-matched
  refusal. Main has no test with an unidentified lifecycle frame and no test with a missing-id
  refusal. Both tests exist in unmerged `32efd84c4` and use the pre-span function signatures.

## 3. Candidate branch inventory

`runtime-deepseek-successor-769-786` (tip `5f12e4508`) descends from `a5ecbfa8e`, before the span
refactor. Its commits are `32efd84c4` (identity, refusal, frame extraction, two tests),
`ebc843035` (#770 and #787), `fd9a95f21` (#787 test), `420bf56f2` (read-failure marker),
`84b858f14` (FrameStep reshape) and `5f12e4508` (reaped status on write failure). The #769 hunks
in `32efd84c4` are superseded by main. The branch deltas that main lacks are `420bf56f2` and
`5f12e4508`.

`32efd84c4` has an approved critic review at `reviews/logging-769-wonder-fix-review.md`, commit
`8603f9b`. The review records two assumptions: one unidentified message is open at a time, and a
provider identifier equal to `omp-open-message` does not occur. The review states that it has no
build or behavioural verdict.

## 4. Findings

**F1 (main, medium). The identity and refusal branches have no regression test.** The measured
failure has two shapes, and neither is covered on main. A later change to `frame_id_sql_value` or
`filter_mode_sql` can restore the growth path without a failing test. The tests to port are
`test_unidentified_cumulative_updates_keep_only_the_latest_snapshot`,
`test_unidentified_updates_close_with_their_message_end`, and
`test_omp_filter_refusal_without_id_is_recorded_and_turn_completes`, adapted to `FrameDecoded`.

**F2 (main, medium). A status-file write failure destroys the reaped status.** The observer
records error 28 on the checkpoint commit in #769; the same ENOSPC condition also fails the
keeper's `status` write. `br_record_native_exit` returns before sending `BR_EXIT`, so the
observer reads no status and reports unknown. The fix keeps the reaped status in memory, writes
`status.tmp` and renames it, records `status-write-error`, and still sends `BR_EXIT`. Delta:
`5f12e4508`.

**F3 (main, low). The read-failure path omits the filter marker.** When the native read fails, the
public log records the interruption but not the filter outcome. The marker is a report field, not
a recovery input. Delta: `420bf56f2`.

**F4 (main, low). The refusal marker omits the provider cause.** `Omp.filter_note`
(`bend2/src/harness/omp-player.bend:190-199`) records `outcome:"refused"` and the requested
selection. The response frame with `"error":"Unknown command: set_event_filter"` is written
verbatim at the default level, so the complete cause is retained in the log. A consumer that
reads only the marker cannot distinguish an unsupported command from another refusal. The narrow
fix does not need a marker change; record the log frame as the cause carrier.

**F5 (successor, assumption). The shared identity precedes the responseId fallbacks.** Two
unidentified messages open at the same time would coalesce into one held slot. The measured OMP
17.4 stream keeps one message open. The `message_end` and terminal frames retain the complete
messages. The prior review records the same exposure as R1.

**F6 (successor). `84b858f14` removes `@unsafe` from `consume_frame`.** The commit reports
`turn.bend --check-only` passes under the pinned fork. The remote check is the authority for that
annotation. Main's loop shape differs, so this finding applies only if the FrameStep reshape is
merged.

## 5. Verdict

Do not duplicate the #769 product fix; current main implements the snapshot identity, snapshot
retention and missing-id refusal, verified from main's own SQL with the compiler-free
reproduction.

The narrow delivery still needs:

1. Regression tests F1 on main.
2. The #770 status-retention delta F2, reviewed and applied separately.
3. The read-failure marker F3, reviewed and applied separately.
4. Remote qualification of the resulting tree under the #970 queue.

## 6. Evidence and limits

Evidence: the fixture and script in this commit; the baseline exit 1 and main exit 0 outputs; the
commit and line references above.

Limits: this review is source and logic only. No compiled binary from these sources ran. The RSS
effect of the frame-loop shape, the live writer byte gain, and the restart outcome are unproven
until the remote qualification and the installation run execute.
