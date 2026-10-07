# Independent validation of the issue #686 log policy

Validator seat `logging-validation-deepseek-20261006`. This record covers
candidate `5c12fe65`, the head of `codex/logging-impl-20261006` and of draft PR
#687 at the time of the run. The implementation's own test suites and an
independent acceptance harness were built and run on the Linux validation
runner. No implementation source file was modified.

## Verdict

The candidate is not acceptable as delivered. Five acceptance checks are
blocked and one check fails.

| Check | Result | Evidence |
| --- | --- | --- |
| Retained segment count per configured `keep_segments` | FAIL | `keep_segments=3` retains 4 numbered segments; `keep_segments=4` retains 3 |
| Session with unacknowledged input rotates nothing and cleans nothing | PASS on behaviour, BLOCKED on the report | live log passed the budget with no rotation, `logs-clean` removed nothing; `logs-storage` has no `pendingBytes` |
| `keep_segments` above 4, and migration of an existing policy table | BLOCKED | `logs ... 5`, `7` and `64` exit 2; the `CHECK(keep_segments BETWEEN 1 AND 4)` constraint stays |
| Native output read failure writes held frames plus one `baton_log_interrupted` frame | BLOCKED | not reachable by an external fixture with a non-empty held set; no delivered test names the frame |
| Abrupt assistant stream keeps its latest accumulated text | BLOCKED | the log keeps an empty `message_start` and none of the `message_update` text |
| `logs-clean` removes exactly the segments `logs-storage` marks eligible | PASS | preview `[3]`, removed `[3]`, second run empty |
| Held tool update survives a turn that ends without its closing frame | PASS | one `tool_execution_update` retained, holding the last snapshot |
| Failed shift stops the chain and is reported beside the appended frame | PASS | `{"type":"baton_log_rotation","failed":true,"error":"21: Is a directory"}` |
| Two supervisors appending one log path across rotations | PASS | both exited 0, no unparsable line, no repeated frame identity |
| Coordinator killed with a frame held | PASS | no held frame written; the live log and its numbered segment remain |
| Policy and budget bounds stated in `docs/bend2/logging.md` | PASS | `0`, `65535` and `4294967296` refused; `65536` and `4294967295` accepted |

## Failing check: retained segment count

`docs/bend2/logging.md` states that at the budget "the numbered segments shift
one position up, the replacement of the highest one included", and
`logs.bend` states at `segment_at` that rotation never produces an index above
the retention count. One 16-frame turn was run for each admitted count.

| Configured | Numbered segments present | Frames retained |
| --- | --- | --- |
| 1 | `[1]` | 4 |
| 2 | `[1, 2]` | 8 |
| 3 | `[1, 2, 3, 4]` | 16 |
| 4 | `[1, 2, 3]` | 12 |

`shift_more(three, log)` in `logs.bend` sends the count 3 to `shift_four` and
the count 4 to `shift_three`. A count of 4 therefore removes `.4`, writes
`.2` over `.3`, and never produces a fourth segment, so the policy retains one
segment fewer than it names; a count of 3 writes one segment above its count.
The retained frames are a contiguous suffix of the written frames in every
case, so no frame inside the retained window is lost.

## Blocked check: policy values above four segments

`keep_segments` is bounded by a `CHECK(keep_segments BETWEEN 1 AND 4)`
constraint and by `segments_admitted` in `logs.bend`. `logs SESSION default
65536 5`, `... 7` and `... 64` each exit 2 with `invalid-log-setting`. The
documentation names the bound and the unrolled rename chain as its reason, so
documentation and behaviour agree; the bound itself is the acceptance blocker,
and the four-segment cap decides what the `>4` request can do.

The reproducer is the table the candidate creates itself:

```
CREATE TABLE log_policies (session TEXT PRIMARY KEY NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('quiet','default','diagnostic')),
  budget_bytes INTEGER NOT NULL CHECK(budget_bytes BETWEEN 65536 AND 4294967295),
  keep_segments INTEGER NOT NULL CHECK(keep_segments BETWEEN 1 AND 4))
```

A refused request leaves the stored policy row and the `log_files` registry
unchanged (verified for both). Accepting a value above 4 on a database that
already holds this table requires a migration of the constraint.

## Blocked check: the read-failure path

`consume` calls `Logs.write_lines(policy,log,Logs.flush(held),...)` and then
`Logs.write_lines(policy,log,Logs.interrupted(held),...)` when the native read
returns `Fail`. The read can return `Fail` in two ways. A direct turn reads the
child's pipe with `getline`, where only a non-EOF error fails. A retained
receive reads `<attempt>/stdout` with one descriptor held for the whole
observation, opened once per attach, so replacing that path with a directory or
an unreadable file can only fail the open or the first read. A first-read
failure occurs with an empty held set, and `interrupted` writes its frame only
when the held set is non-empty (`logs.bend:308-310`). The delivered tests name
`baton_log_interrupted` in no file under `bend2/test`, so the two lines this
candidate adds to `turn.bend` have neither a test nor an external trigger.

The graceful end of a stream was exercised for contrast: a stream whose last
frame is a `tool_execution_update` and whose work ends with `agent_end` retains
that one update, holding the final snapshot.

## Blocked check: abrupt assistant stream

A stream of `message_start` for one identity followed by two `message_update`
frames, ended without the `message_end` of that identity and without a terminal
frame, leaves the public log holding the empty `message_start` alone. The
accumulated assistant text exists only in the dropped `message_update` frames.
A default-level turn keeps the identities and the terminal frames; the text of
an assistant message whose `message_end` never arrives is not among them.

## Documentation mismatches

- The producer table in `docs/bend2/logging.md` names `stdout` and
  `observer.log` as files of an attempt directory. A retained attempt directory
  written by this candidate held `keeper.log`, `launch`, `manifest`,
  `native.birth`, `native.pid`, `native.stderr`, `status`, `released` and
  `acknowledged`; it held no `observer.log`, and its `stdout` is unlinked at
  acknowledgement. `logs-storage` reads `directory/observer.log`, a path that
  does not exist, and reports its size as zero.
- The attempt entry of that acknowledged retained attempt reports
  `"mode":"retained"`, `"bytes":0`, `"stdoutBytes":0`, `"observerBytes":0` and
  `"keeperBytes":0`, while the directory held a 7,598-byte `manifest` that the
  report does not size. The reported total measures four paths, of which the
  acknowledged attempt keeps none.
- The claim that a retained receive keeps the raw stream in its attempt
  directory holds while the attempt is unacknowledged and while the observer,
  not the keeper, is the process that is lost.

## Verified behaviour

- A session with unacknowledged input rotates nothing. A turn that wrote
  201,676 bytes against a 65,536-byte budget kept its frames in the live log,
  wrote seven `{"type":"baton_log_rotation","skipped":"pending-input",...}`
  frames, created no numbered segment, and `logs-clean` answered
  `{"removed":[],"pendingInput":1,"skipped":"pending-input"}`. The unread
  message stayed in the inbox.
- Cleanup scope. `logs-storage` marked segment 3 eligible and `logs-clean`
  removed exactly that segment; a second run removed nothing. The live log,
  `.1`, `.2`, `OUTPUT_LOG.stderr`, `OUTPUT_LOG.pending`,
  `OUTPUT_LOG.pending.tmp.1` and a directory named like an attempt all
  survived. A fixed probe of indices 1 to 4 is what the enumeration reads, so
  a checkpoint name cannot be selected by it.
- A failed shift stops the chain. With `.2` replaced by a directory, the shift
  stopped at the first rename, `.1` stayed in place, the live log kept
  appending, and each append that could not rotate wrote one
  `{"type":"baton_log_rotation","failed":true,"error":"21: Is a directory"}`
  frame beside the frames it kept. The `moved` list in a rotation frame names
  the numbered segments that held a file at the time of the rotation.
- The live log moves once per rotation. `shift_one` is an empty step and
  `rotate_shifted` performs the single `rename(log, log.1)`. The retained
  frames read across the numbered segments and the live log form a contiguous
  suffix of the written frames at every admitted count, which a second move
  would break.
- Concurrent writers. Two turns were pointed at one log path. The second ran
  to completion while the first held the same path open. The numbered segments
  were rotated three times during the overlap, no line failed to parse, no
  frame identity appeared twice, and each writer's surviving frames were a
  contiguous suffix of the frames it wrote.
- A coordinator killed with a frame held writes no held frame. An attempt
  created by a direct turn has mode `direct` and an empty directory column, so
  a direct turn holds no attempt directory and the last partial update of an
  open call is lost with the process.
- Policy validation. `quiet`, `default` and `diagnostic` are admitted; `0`,
  `65535` and `4294967296` are refused with `invalid-log-setting` on stderr at
  exit 2; `65536` and `4294967295` are admitted.

## Build, toolchain and test evidence

All commands ran on the Linux validation runner.

| Item | Value |
| --- | --- |
| Platform | Linux 6.14.0-37-generic x86_64, 64 cores |
| Compiler | bend 2.0.25, SHA-256 `d9c0dad1f77be6a13dd8dcc16aef4f59047a956a2744f25d5c220cb8de384693` |
| C compiler | Ubuntu clang 19.1.1 |
| Python | 3.12.3 |
| Source archive | `issue686-5c12fe65.tar.gz`, SHA-256 `5c28c945dc79d2bc7b4dc31f8677b28e3a17bacf8b5fe7e0b3023c8a9a1c5ebe` |
| Tree | `66a9591a6c229b51b30795588f5193769da2059a` |
| Executable | `11e47d4b7d1d70b282aabc41cc1981214616ed924de5c64a57d6d40559442bf0` |

Source file SHA-256, identical on the runner and in the local extraction:

| File | SHA-256 |
| --- | --- |
| `bend2/src/coordinator/logs.bend` | `b05dace4b1057dce3d7563a81febf7285f8c6e960839265bf33982f2746066ca` |
| `bend2/src/coordinator/turn.bend` | `db6abed4914aed6fba45c00a79db4745c13c7f1d4c358e7acc0850ec3ca5c55d` |
| `bend2/src/host/files.c` | `facf2566e8e69de862a077c856d6a52de2b51859c638df1331bb5767dde1fabb` |
| `bend2/src/host/files.bend` | `18d91e41edf18b8929ca447b320d9cd165de884bfcbac78ef787357023e47ca9` |
| `bend2/test/logs.py` | `1dccec41d0545a02a896b5e6343ee64af2b10f1f0b58a74c9b2ab81e50dfbf62` |
| `bend2/test/turn.py` | `9a56c21004ef6e72f4a153735af00a15a78d27b72d455280530f952ac7687d02` |

Results:

- `bend2/scripts/build-native.sh` completed, exit 0.
- `bend2/test/logs.py`: 15 tests, OK, 19.3 s, exit 0.
- `bend2/test/turn.py`: 17 tests, OK, 9.7 s, exit 0.
- Independent harness `issue686_acceptance.py` (SHA-256
  `5b4a0ec9f413b5f8fbd7d176a51088943eec0cbc55e5191141a6c184b466ecd7`):
  11 checks, 5 PASS, 5 BLOCKED, 1 FAIL, exit 1, 30.4 s wall, 48.9 MB peak
  resident.

## Measurement audit

`bend2/scripts/measure-omp-stream.py` was run against the candidate executable
in a fresh directory. The retained bytes per batch reproduced the recorded
figures exactly: `small` 113, `cumulative` 118, `tool` 112, and a retained
`native.jsonl` of 53,163 bytes against 26,164,540 emitted bytes for the tool
batch. The recorded measurement is reproducible on the platform it names.

The fixture starts no provider, one receiver, one database and one log path,
and it runs one 1,000-frame batch per frame type. Its numbers measure the
retention rule on a controlled batch, and they do not measure a coordination
working day or concurrent writers; the harness covers concurrency separately.
Run from a directory that is not a Git checkout, the driver completes every
measurement and then exits on `git rev-parse HEAD`, writing no result JSON.

## Scope of this validation

The candidate under test is `5c12fe65`. The implementation worktree held
further uncommitted changes to `logs.bend`, `files.bend`, `files.c`,
`logs.py` and `turn.py` at the time of the run; those changes are not part of
this record. The checks here cover the log policy, its commands and the frames
they write; they do not cover the provider's `set_event_filter` behaviour, the
`<log>.stderr` bound, the receive re-attach watermark, or the whole-repository
gates.
