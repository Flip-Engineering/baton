# Independent re-qualification of the issue #686 log policy at `ecfbdd0b`

Validator seat `logging-validation-deepseek-20261006`, tight ensemble
`logging-maintenance-20261006`. This record re-runs the acceptance matrix from
`VALIDATION.md` (candidate `5c12fe65`) against the landed primary
`bend2-rewrite` at `ecfbdd0b`. Builds and tests ran on the Linux validation
runner. No implementation source file was modified.

## Verdict

| # | Item | Result |
| --- | --- | --- |
| 1 | `keep_segments` 1, 2, 3, 4 each retain exactly that many numbered segments; retained frames stay a contiguous suffix | ACCEPTED |
| 2 | `keep_segments` 5, 7 and 64 admitted; the legacy 1..4 constraint migrates with rows preserved, including the failure path | ACCEPTED |
| 3 | `logs-storage` reports `pendingBytes` and `pendingPath`; the checkpoint survives storage, inspection and cleanup | ACCEPTED |
| 4 | The read-failure path writes held frames plus one `baton_log_interrupted` frame | NOT ACCEPTED |
| 5 | An abrupt assistant stream retains the newest held snapshot per message identity | ACCEPTED |
| 6 | Regression set: pending-input gate, cleanup scope, failed shift chain stop, concurrent writers, single live-log move, SIGKILL with a frame held, policy validation bounds | ACCEPTED |
| 7a | Attempt-directory file naming in `docs/bend2/logging.md` | PERSISTS |
| 7b | `measure-omp-stream.py` exits on `git rev-parse` outside a checkout | PERSISTS |

Eleven of twelve acceptance checks pass; `interrupted_read_failure` is blocked.

## Identity

| Item | Value |
| --- | --- |
| Commit | `ecfbdd0b7ec6b5e83cad62ba3477edd31b12a52f` (`refs/heads/bend2-rewrite`) |
| Tree | `88da37c4550c7fa2fb8c2a08d7940ff81da9feed` |
| Source archive | `issue686-ecfbdd0b.tar.gz`, SHA-256 `6887d8475c7615fac435f00119575f26acb05941873f6219c13388b6d8a3bc37` |
| Platform | Linux 6.14.0-37-generic x86_64, 64 cores |
| Compiler | bend 2.0.25, SHA-256 `d9c0dad1f77be6a13dd8dcc16aef4f59047a956a2744f25d5c220cb8de384693` |
| C compiler | Ubuntu clang 19.1.1 |
| Python | 3.12.3 |
| Executable | `af11778c7b57119387d0787faed0c965173b86ebf2306c2a380025c6ba097615` |
| Harness | `issue686_acceptance.py`, SHA-256 `dd7473a54eb8dc2f885cabb05bd16acbdb392852835b2f7fef1d7cd33c1de4d6` (see *Corrections*) |

Source file SHA-256, identical on the runner and in the local extraction:

| File | SHA-256 |
| --- | --- |
| `bend2/src/coordinator/logs.bend` | `b1b74fdadc380582b24f8b3ee92932119e68108c6302664d463234fd922d0a3e` |
| `bend2/src/coordinator/log-schema.bend` | `bebf1a348760320abade634b61600663022ca71912f2c310fe591e0d008e3ad5` |
| `bend2/src/coordinator/turn.bend` | `0ac6f090285d8c69cf911747dff88131c04720b0dc02904adec01bd1fa69a43a` |
| `bend2/src/host/files.c` | `bd072694643ea08d8d6caf85f203ddc3cd56dcd3b756dc06e1297f7e2e930813` |
| `bend2/src/host/files.bend` | `70f325de0ffc21e309baf429f165958e9779a82718c5a1feb4bb5f7ec3fd1c0e` |
| `bend2/src/host/log-checkpoint.bend` | `98cb833253ae00a03698a566d76ed5ca3d26593f9c290dda9017b921faf814de` |
| `bend2/src/host/log-checkpoint.c` | `3a9430e3e74b4f4ffbd400d6f93fa64e5d0518eb76f01d7f0cb68ac9cae61520` |
| `bend2/test/logs.py` | `185f1b90801f234b9159d5b7b7623d948e87aded6cacf2a01137c9df26025655` |
| `bend2/test/turn.py` | `1cd9005051d1bbbc120ef5703aa9352d2b5c06f90f7c7dd8629567f0abaea879` |
| `docs/bend2/logging.md` | `755a221db2139e82f3842c91d82e11d7e8bcb25b7b57ac8ce41514d6d3330b08` |
| `bend2/scripts/measure-omp-stream.py` | `065de95d433347b2f2548d446ffdc8526823b152288f18cc337f154a1343d6ab` |

Delivered suites: `bend2/test/logs.py` 23 tests, OK, 29.0 s, exit 0;
`bend2/test/turn.py` 17 tests, OK, 9.9 s, exit 0; `build-native.sh` exit 0 in
about 160 s. Acceptance harness: 12 checks, 11 PASS, 1 BLOCKED, exit 0, 25.4 s
wall, 49.6 MB peak resident.

## 1. Retained segment count — accepted

One 16-frame turn per configured count, reading the numbered segments and the
live log in the reader's order.

| Configured | Segments present | Frames retained | Count matches | Contiguous suffix |
| --- | --- | --- | --- | --- |
| 1 | `[1]` | 4 | yes | yes |
| 2 | `[1, 2]` | 8 | yes | yes |
| 3 | `[1, 2, 3]` | 12 | yes | yes |
| 4 | `[1, 2, 3, 4]` | 16 | yes | yes |

The count 3 to `shift_four` and 4 to `shift_three` inversion of `5c12fe65` is
gone. `shift` now walks the indices the directory holds and moves each index
below the count up one, highest first, so the count is what the policy names
and no index above it is produced.

## 2. Retention above four and the policy table — accepted

`logs SESSION default 65536 N` exits 0 for N in 5, 7, 64, 101 and 4294967295,
and exits 2 with `invalid-log-setting` for 0 and 4294967296. The conditions in
the refusal message name the U32 bound alone.

The migration was exercised against a database holding the legacy table and
its rows:

```
CREATE TABLE log_policies(session TEXT PRIMARY KEY NOT NULL,level TEXT NOT NULL,
  budget_bytes INTEGER NOT NULL,
  keep_segments INTEGER NOT NULL CHECK(keep_segments BETWEEN 1 AND 4));
```

| Observation | Result |
| --- | --- |
| Read of the stored row before any write | `diagnostic`, 1048576 bytes, 3 segments, 1 registered log |
| `logs SESSION diagnostic '' 101` | accepted, stored `keepSegments` 101 |
| Policy row after | `('legacy-worker', 'diagnostic', 1048576, 101)` |
| `log_files` row after | unchanged |
| `log_policies` schema after | carries `BETWEEN 1 AND 4294967295` |
| `log_policies_legacy` remaining | none |

Failure path: with a stored level the new constraint refuses, the command exits
19 with `CHECK constraint failed: level IN ('quiet','default','diagnostic')` on
stderr and no policy answer on stdout. The original row is still present with
its original values, the table still carries the legacy 1..4 constraint, and no
`log_policies_legacy` remains. The migration returns the database to its prior
state.

## 3. Checkpoint reporting and survival — accepted

`logs-storage` reports one entry per registered log with `pendingBytes`,
`pendingPath`, `pendingInput`, `stderrBytes` and the numbered segments.

| Observation | Result |
| --- | --- |
| `pendingBytes` | 53, equal to the checkpoint file's size |
| `pendingPath` | `<log>.pending` |
| Reported segment indices | `[65, 101, 4294967295]` |
| Eligible after lowering the count to 2 | `[65, 101, 4294967295]` |
| Removed by `logs-clean` | `[65, 101, 4294967295]` |
| Checkpoint after storage, inspection and cleanup | present, content unchanged |
| Ignored names | `<log>.pending`, `<log>.pending.tmp.owner`, `<log>.01`, `<log>.+9`, `<log>. 9`, `<log>.9.stderr`, `<log>.4294967296`, `<log>.z` all present after cleanup |

The enumeration reads the directory and admits an entry only when the text
after the final dot is all digits, starts with 1 to 9, and fits a U32
(`files.c`, `baton_segments_call`). A checkpoint name, a temporary name, a
zero-padded index, a signed index, a suffixed index and an index above the U32
bound are all outside that set.

## 4. The read-failure arm — not accepted

`Logs.interrupted` writes its frame only when the held set is non-empty
(`logs.bend:325-327`), and no file under `bend2/test` names
`baton_log_interrupted`: the string appears only in `logs.bend:327` and in
`docs/bend2/logging.md:135`.

The arm runs when the native read returns `Fail`. A direct turn reads the
child's pipe with `getline`, where only a non-EOF error fails. A retained
receive reads `<attempt>/stdout` through one descriptor opened once per attach
and held for the whole observation, so replacing that path cannot fail a later
read; a first-read failure leaves the held set empty and writes no frame. The
fixture added by this series, `test_abrupt_observer_exit_preserves_latest_incomplete_frame`,
exercises the checkpoint under an abrupt observer exit, which is a different
path.

The frames the arm would flush are now durable in `<log>.pending`, and that is
verified independently in check 6. The frame itself remains unverified, and
the acceptance item is not met as stated.

## 5. Abrupt assistant stream — accepted

A stream of `message_start` and three `message_update` frames for one identity,
ended with no `message_end` and no terminal frame, retains exactly one
`message_update`: the newest. The log holds `half an answer 2` and does not
hold `half an answer 0`. The tool case is unchanged: three
`tool_execution_update` frames for one open call retain one, holding the last
snapshot.

`step_snapshot` now holds the newest `message_update` per message identity
(`logs.bend:271-274`), and `step_message_end` drops the held start and update
when the completed message arrives.

## 6. Regression set — accepted

- Pending-input gate. A turn wrote 201,676 bytes against a 65,536-byte budget
  with no rotation, wrote seven `{"skipped":"pending-input"}` frames, created no
  numbered segment, and `logs-clean` answered `{"removed":[],"pendingInput":1,
  "skipped":"pending-input"}`. The unread message stayed in the inbox, and
  `pendingBytes` was 0 with `pendingPath` naming the checkpoint.
- Cleanup scope. `logs-storage` marked `[3, 4]` eligible and `logs-clean`
  removed exactly those; the live log, `.1`, `.2`, `.stderr`, `.pending`,
  `.pending.tmp.1` and a directory named like an attempt all survived; a second
  run removed nothing.
- Failed shift. With `.2` replaced by a directory the chain stopped at the
  first failed rename, `.1` stayed, appends continued, and each append that
  could not rotate wrote `{"failed":true,"error":"1: 21: Is a directory"}`
  beside the frames it kept.
- Concurrent writers. Two turns against one log path, the second completing
  while the first held it open, three rotations during the overlap, no
  unparsable line, no repeated frame identity, and each writer's surviving
  frames a contiguous suffix of its own.
- Single live-log move. The retained frames read across the numbered segments
  and the live log form a contiguous suffix at every admitted count, and
  `shift_one` remains an empty step with the single rename in
  `rotate_shifted`.
- SIGKILL with a frame held. The newest held frame of each of two open tool
  calls was on disk in `<log>.pending` before the kill and after it, with no
  `.pending.tmp.*` residue, and the public log held neither. The next turn for
  the same log restored both frames into the retained view and removed the
  checkpoint.
- Policy bounds. `0`, `4294967296`, a 65,535-byte budget, an over-large budget
  and an unknown level are refused with exit 2; 65,536 bytes, 4,294,967,295
  bytes and every tested count are admitted. A stored row of another session
  survived every write in the check.

## 7. Documentation recheck

- `docs/bend2/logging.md:17` and `:109-110` still name `stdout` and
  `observer.log` as files of `<database>.attempt-*/`. The acknowledged retained
  attempt directory written by this build held `acknowledged`, `keeper.log`,
  `launch`, `manifest` (7,124 bytes), `native.birth`, `native.pid`,
  `native.stderr`, `released` and `status`. It held no `observer.log`, and its
  `stdout` is unlinked at acknowledgement. The `logs-storage` entry for that
  attempt reports `bytes` 0, `stdoutBytes` 0, `stderrBytes` 0, `observerBytes`
  0 and `keeperBytes` 0, so an attempt directory holding a 7,124-byte manifest
  is reported as holding no bytes. This discrepancy is unchanged from the
  `5c12fe65` record.
- `bend2/scripts/measure-omp-stream.py:180` still calls
  `subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT)`. Against the
  candidate executable in a directory that is not a Git checkout the driver
  completed every batch, wrote `native.jsonl` of 53,217 bytes, and then exited
  1 with `CalledProcessError` before writing its result JSON. This is unchanged
  from the `5c12fe65` record.

## Corrections to this validation

The first pass of `held_frame_durability` reported FAIL because the check read
only the live log. `checkpoint_restore` appends the checkpoint to the live log
outside the rotation check, so the next append rotates that log and the
restored frames move into a numbered segment. Reading the whole retained view
resolves it: `restored_alpha_2_in_live_log` false and
`restored_alpha_2_in_retained_view` true on the same run. The check now reads
the segments and the live log in the reader's order. No implementation defect
is involved.

## Limits

This record covers the log policy, its commands and the frames they write at
`ecfbdd0b`. It does not cover the provider's `set_event_filter` behaviour, the
`<log>.stderr` bound, the receive re-attach watermark, or the whole-repository
gates. The acceptance harness drives the CLI; it is not a substitute for the
delivered suites, which were also run.
