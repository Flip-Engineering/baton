# Issue #769 acceptance plan

Issue #769 covers cumulative `message_update` snapshots in the OMP 17.4 RPC path, the missing-id
`set_event_filter` refusal, and recovery replay from the durable checkpoint. This plan records
what current main already implements, what remains absent, the compiler-free baseline evidence,
the acceptance scenarios, and the remote qualification commands.

Related issues: #686, #696, #644, #716, #770, #786. The remote build runs under the shared
compilation queue tracked by #970.

## Source state on current main

Main commit `7e5bc4698` (`Fix receive span retention and checkpoint flow`) introduced:

- `Logs.frame_id_sql_value`: `message_start`, `message_update` and `message_end` frames without
  `toolCallId`, `messageId` or `message.id` share the `omp-open-message` identity; the
  `message.responseId` and `assistantMessageEvent.partial.responseId` fallbacks follow; the
  empty-string fallback stays last.
- `Turn.filter_mode_sql`: the branch
  `type='response' AND command='set_event_filter' AND coalesce(success,1)=0 THEN 'refused'`
  runs before the request-id match, so the OMP 17.4 unknown-command answer classifies as
  refused without an `id`.
- `consume` reads the next frame only after `consume_frame` returns, so a frame's line and query
  results do not stay live for the rest of the turn.
- `Observer.checkpoint_due_next` excludes the output position, so a positioned write does not
  serialize the reducer state.

Main does not contain:

- The #770 status-retention change. `br_record_native_exit` writes `status` with `br_file` and
  returns the write error before it sends `BR_EXIT`; a failed write on ENOSPC drops the exit
  frame, and an attached observer reports an unknown status. The successor branch carries the
  status.tmp/rename and in-memory-status change at `5f12e4508`.
- The filter marker on the read-failure path. `consume`'s `Fail{error}` branch flushes held
  lines and the interrupted marker; it does not append `Omp.filter_note`. The
  `consume_exhausted` path does. The successor branch adds the marker at `420bf56f2`.
- Regression tests for the two measured shapes. Main has
  `test_unfinished_assistant_message_keeps_latest_update` with an explicit `messageId`, and
  `test_omp_filter_refusal_is_recorded_and_turn_completes` with an echoed `id`. Main has no test
  for an unidentified lifecycle frame and no test for the missing-id refusal. Those tests exist
  in unmerged `32efd84c4` and target the pre-span function signatures.

Branch `runtime-deepseek-successor-769-786` (tip `5f12e4508`) predates the span refactor. Its
#769 hunks are superseded by main; merge only the #770 status change and the filter-marker change
after review.

## Compiler-free baseline and main evidence

`bend2/test/fixtures/issue769-omp-cumulative-snapshots.jsonl` holds the measured frame shapes:
the refusal answer without `id`, unidentified lifecycle frames, four cumulative thinking
snapshots with Unicode, two cumulative tool partial updates, an error `message_end`, and an
`agent_end` terminal. The companion README states the fixture provenance.

`bend2/scripts/check-issue769-baseline.py` reads `frame_id_sql` and `filter_mode_sql` from a
source tree, evaluates both expressions with sqlite3, mirrors the default-level step functions,
and reports written frames and bytes. It needs no Bend compiler.

Against the account-credit baseline tree (my restored branch), the script exits 1:

```
interrupted stream: frames=10 rawBytes=2025 publicBytes=1886
  message_update written=4 bytes=1313
closed stream: frames=12 rawBytes=2339 publicBytes=2200
  message_update written=4 bytes=1313
filter refusal classified=empty
lifecycle frames with an identity=0/6
BASELINE DEFECT REPRODUCED
```

Against the current main source (`git show main:...` for the two files), the script exits 0:

```
interrupted stream: frames=10 rawBytes=2025 publicBytes=956
  message_update written=1 bytes=383
closed stream: frames=12 rawBytes=2339 publicBytes=818
  message_update written=0 bytes=0
filter refusal classified=refused
lifecycle frames with an identity=6/6
SNAPSHOT AND REFUSAL BEHAVIOR MATCHES ISSUE #769 REQUIREMENTS
```

The same result holds for the successor branch source. Main therefore implements the #769
snapshot and refusal behavior; the remaining work is regression coverage, the #770 status
delta, and remote qualification.

## Acceptance scenarios

### 1. Missing-id filter refusal

Input: fixture line 1, answered to the `set_event_filter` request by a fixture harness.

Expected: the response with `success:false` and no `id` classifies as `refused`; the marker is
`{"type":"baton_event_filter","requested":"array+delta","active":false,"outcome":"refused"}`;
the turn completes; the delivery carries the assistant text; the player native identity is
retained; the response frame with its `error` text remains in the public log.

Coverage needed: a `turn.py` case that answers with `success:false` and no `id`. The existing
id-matched case does not exercise the new branch.

### 2. Cumulative snapshots with Unicode and interleaved error/terminal

Input: fixture lines 2 through 12.

Expected: at the default level the public log contains no repeated `message_update` snapshot for
one open message. A closed message retains the full `message_end`, the error `stopReason`, and
the `agent_end` terminal compact projection. An interrupted message retains the newest snapshot
with its Unicode text. Diagnostic level retains every frame.

Coverage needed: a `logs.py` case with `message_start`/`message_update`/`message_end` frames that
carry no identity, including Unicode content, a tool call with `toolCallId`, and an error
terminal.

### 3. Interrupted output and checkpoint recovery

Input: the fixture truncated before `message_end`; a retained attempt interrupted after a
positioned write.

Expected: after an observer interruption, the restart writes public-log bytes from the durable
checkpoint offset. The resulting log matches an uninterrupted run byte for byte, including the
newest held snapshot. A failed checkpoint commit leaves the prior checkpoint in place, records
the error, and continues draining raw output. The replay does not rewrite prior snapshots.

### 4. Same-native continuation with pending inputs

Driver: retained receive on the candidate binary.

Expected: the recorded native identity is unchanged, no second native launch occurs, pending
inputs are delivered once after replay, and the original status evidence is retained. An
indeterminate status stays unknown.

### 5. Disk-growth attribution

Driver: one default-level turn with the fixture stream and one with a captured tool stream.

Expected: report raw spool bytes and public log bytes separately. The raw spool retains every
frame. The public log retains one snapshot per open message and the completed messages, errors
and terminals. Report both sizes and the writer gain in new bytes per event in the same record.

## Remote qualification commands

Run in a candidate worktree on the shared compiler queue. The pinned toolchain is
`baton2-compiler-741-20261015/postrelease-751-761-20261015-11`.

```sh
BEND=/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/baton2-compiler-741-20261015/postrelease-751-761-20261015-11/toolchain-home/bin/bend
export BEND
sh bend2/scripts/build-native.sh
"$BEND" --check-only bend2/src/coordinator/turn.bend
"$BEND" --check-only bend2/src/coordinator/logs.bend
"$BEND" --check-only bend2/src/coordinator/observer-checkpoint-laws.bend
"$BEND" --check-only bend2/src/coordinator/laws.bend
python3 bend2/test/logs.py
python3 bend2/test/turn.py
python3 bend2/test/retained-control.py
python3 bend2/scripts/check-issue769-baseline.py \
  --logs <candidate>/bend2/src/coordinator/logs.bend \
  --turn <candidate>/bend2/src/coordinator/turn.bend
```

A candidate passes when `--check-only` exits 0 for each module, each listed test file reports no
failure, and the baseline script exits 0 against the candidate source. The RSS run records peak
resident memory for a retained stream.

## Deployment sequence

1. Add the two regression tests to main's test files and run the listed qualification on the
   shared compiler queue.
2. Apply the #770 status-retention change and the read-failure filter marker from
   `runtime-deepseek-successor-769-786` after independent review; re-run the qualification.
3. Install and adopt the built binary through the normal package path; record the installed
   identity and a live writer observation of raw bytes against public bytes for one turn.
