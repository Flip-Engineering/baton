# Independent validation of issue #686 at 31f261ff (budget-free logging)

Validator seat `logging-validation-deepseek-20261006`, tight ensemble
`logging-maintenance-20261006`. Exact-source validation of
`origin/bend2-rewrite` at 31f261ff, the merge that removes the log byte and
segment budgets. All builds and tests ran on the Linux validation runner. No
implementation source file was modified.

## Verdict

Fourteen of the fifteen acceptance checks pass. The read-failure frame remains
unobservable and is reported blocked.

| Item from the assignment | Checks | Result |
| --- | --- | --- |
| 1. Level-only frame policy, including held frames and abrupt-end retention | `level_default_policy`, `level_quiet_policy`, `level_diagnostic_policy`, `level_read_and_set`, `abrupt_end_retention` | ACCEPTED |
| 2. Checkpoint durability and restore | `checkpoint_durability_and_restore` | ACCEPTED |
| 3. Pending-message recovery | `pending_message_recovery` | ACCEPTED |
| 4. Provider error reporting (output failures) | `output_failure_reporting` | ACCEPTED |
| 5. Report extraction | `report_extraction` | ACCEPTED |
| 6. The owed `only_copy_evidence` assertion | `only_copy_evidence` | ACCEPTED |
| 7. Legacy-schema migration to the level-only schema | `legacy_schema_migration`, `failed_migration_preserves_rows` | ACCEPTED |
| 8. Concurrent append writers | `concurrent_append_writers` | ACCEPTED |
| 9. `interrupted_read_failure` | `interrupted_read_failure` | NOT ACCEPTED (BLOCKED) |
| Supporting: storage report and cleanup scope | `storage_and_cleanup_scope` | ACCEPTED |

Every assertion that required a budget, a rotation depth, a retention count or
a truncation was dropped from the matrix. A budget or retention argument now
has no argument position at all, and the parser refuses it, which the level
check records.

## Identity

| Item | Value |
| --- | --- |
| Commit | `31f261ff1dd9535ac0fda9cf60e9940d14ae3b52` (`refs/heads/bend2-rewrite`) |
| Tree | `745763833b721c905db1cdca0d7059cb9dbdf839` |
| Source archive | `issue686-31f261ff.tar.gz`, SHA-256 `579192e465d309f2d7428092572b0d36acfea2fd121f2eb725c3ffccc5a85984` |
| Platform | Linux 6.14.0-37-generic x86_64, 64 cores (`acp-compute-cluster-001`) |
| Compiler | bend 2.0.25, SHA-256 `d9c0dad1f77be6a13dd8dcc16aef4f59047a956a2744f25d5c220cb8de384693` |
| C compiler | Ubuntu clang 19.1.1 |
| Python | 3.12.3 |
| Executable | `9ce8b5b5ca8a8358d36c095a14d40e9b6da17242f685300d774efa27f003e988` |
| Harness | `issue686_acceptance_31f261ff.py`, SHA-256 `0cef31e2ffdb44e04641b394ec4996908eea1051cb177e077ff13433904ee2b1` |

Source file SHA-256, identical on the runner and in the local extraction:

| File | SHA-256 |
| --- | --- |
| `bend2/src/coordinator/logs.bend` | `52ed3d67bc1a99d5807f5d27c0d51a72166879d7312e4c1405958718fd3e2134` |
| `bend2/src/coordinator/log-schema.bend` | `09518f7fc12e2c6fb4ccf5b75b1dcbf004f1613323d0a26afbfa474ef8995ccb` |
| `bend2/src/coordinator/turn.bend` | `8fa72a11db27216dae0855d2741c0fca09872d3a0cd523954fc294e9de63a837` |
| `bend2/src/coordinator/commands.bend` | `40d6f37955256e19aecbc900c8714dc6196054c25ad07a8e57f644fbb88da6cf` |
| `bend2/test/logs.py` | `63738585ba4ec7a41e57df4397e00345ead1d13e5fbd5a7baba21c805b310ae6` |
| `bend2/test/turn.py` | `278d61b5b781cd788d1b50e117f5b00aea32ec9cfa6b88c71c8a506224175402` |
| `docs/bend2/logging.md` | `df63656f14c119a8385d313b634b9bcff33e13b6edf501821da26429de3eb185` |

Hosted records for this source:

| Run | Scope | Conclusion |
| --- | --- | --- |
| [37722977278](https://github.com/Flip-Engineering/baton/actions/runs/37722977278) | Primary Logs hotfix qualification, `codex/primary-logs-no-budgets-qualification-20261008` | success |
| job 113134655086 | `logs-and-turn` on 5e434c39, tree `745763833b721c905db1cdca0d7059cb9dbdf839` | success, 03:29:43Z to 03:32:07Z |
| job 113134655282 | `logs-and-turn` on 53a2356a, tree `797661732f302eee07c4847905b46...` | success, 03:29:43Z to 03:33:28Z |
| [37723350468](https://github.com/Flip-Engineering/baton/actions/runs/37723350468) | `bend2-native-development`, `bend2-rewrite` at 31f261ff | cancelled at cleanup after the darwin-arm64 job uploaded artifact 11528878132 |

The hosted job 113134655086 ran the same tree I built locally from the archive.
My independent build is a second, separate construction of that tree; its
executable hash is the one recorded above.

Runner execution: build from the extracted archive completed in about 165 s;
the delivered suites and the acceptance harness ran in one driver pass that
ended at 2026-10-08T04:58:37Z, with the harness taking 25.8 s wall and 49 MB
peak resident. `bend2/test/logs.py` ran 19 tests, OK, exit 0, 7.7 s;
`bend2/test/turn.py` ran 17 tests, OK, exit 0, 15.5 s.

## 1. Level-only frame policy — accepted

One stream of fourteen frames exercises every classification branch: a
`response`, two `message_update` frames for one open identity, a
`message_start` and its `message_update` closed by a `message_end`, a tool
`start`, two tool `update` frames and a tool `end`, a second `message_start`
left open, a provider `error` frame, an `agent_end`, and one frame outside the
classification.

- `default` retained kinds: `response`, `message_end`,
  `tool_execution_start`, `tool_execution_update`, `tool_execution_end`,
  `error`, `agent_end`, the unclassified frame, the closing
  `baton_event_filter` note, one `message_start` and one `message_update`. The
  held update for the open tool call is the newest one (`p2`), the
  `message_end` superseded both the `message_start` and the `message_update` of
  its identity, and the still-open `message_start` was written when the turn
  ended. The newest `message_update` of the identity that never closed is
  retained (`u2`) and the earlier one is not.
- `quiet` retained kinds: `error`, `agent_end`, the unclassified frame and the
  filter note. Every classified running frame, including `message_end`, was
  dropped.
- `diagnostic` retained all fourteen emitted frames plus the filter note; three
  `message_update` and two `tool_execution_update` frames survived verbatim.
- The policy command is level-only. `logs SESSION` answers
  `{session, level, registeredLogs}`; `logs SESSION quiet` stores it; an
  unknown level exits 2 with `invalid-log-setting`; `logs SESSION default 65536`
  and `logs SESSION default 65536 2` both exit 2 with the usage text, which is
  the parser refusing an argument that no longer exists.
- Abrupt end. A stream of `message_start` and three `message_update` frames for
  one identity, ended with no `message_end` and no terminal frame, retains
  exactly one `message_update` holding the newest text and not the first. The
  tool case retains one `tool_execution_update` holding the last snapshot.

## 2. Checkpoint durability and restore — accepted

A turn was killed with three prefix frames held across two open tool calls.
Before the kill, `<log>.pending` held the newest frame of each identity
(`("tool-a","alpha 2")` and `("tool-b","bravo 1")`), no `.pending.tmp.*`
remained, and neither frame was in the public log. After the kill the
checkpoint was still present. The next turn for the same log appended both
frames to the public log and removed the checkpoint.

## 3. Pending-message recovery — accepted

One unanswered `guidance` message stayed in the session's inbox across two
turns, `logs-storage` reported `pendingInput` 1, and `logs-clean` answered
`{"removed":[],"attemptFiles":[],"skipped":"pending-input"}`. A checkpoint
written while that input was unanswered survived a second cleanup, and the
public log remained present.

## 4. Provider error reporting (output failures) — accepted

With the public log pointed at a directory, the turn completed and the parent
inbox held exactly one report reading
`Native output observation failed: 21: Log <path> ...`. The terminal text still
reached the delivery (`Answer despite an unwritable log`), so a lost log does
not lose the report.

## 5. Report extraction — accepted

`delivery TURN` returned the terminal assistant text, `turns PLAYER` listed the
turn, the `turns` row carried the `agent_end` event, and the terminal frame was
present in the public log.

## 6. The owed only-copy evidence assertion — accepted

A turn wrote thirty frames and a terminal frame. All thirty identities were
still present in the public log afterward, no identity was missing, the
terminal frame was in the log, the `turns` row existed, and `delivery` returned
the text. With no retention pruning, the log is the complete record and the
database holds the terminal evidence independently.

## 7. Legacy-schema migration to the level-only schema — accepted

Against a database holding the budget-era shape (`level` with its domain check,
`budget_bytes`, `keep_segments`) plus a stored row and a registered log path:
the first policy read migrated the table to `(session, level)`, preserved the
stored level `diagnostic` and the registry row, left no `log_policies_legacy`,
and a subsequent `logs SESSION quiet` was accepted.

Failure path: a legacy table without the level domain accepted a stored level
the new table refuses. The command exited 19 with
`CHECK constraint failed: level IN ('quiet','default','diagnostic')`, wrote no
policy answer, left the original row `('legacy-broken',
'invalid-legacy-level')` in place, left the four-column schema unchanged, and
left no `log_policies_legacy`. The failure path is defensive: the budget-era
table enforced the same level domain, so this reproducer needs a legacy table
that did not.

## 8. Concurrent append writers — accepted

Two turns, one public log path, two players, one writer paused mid-stream while
the other ran to completion. Both exited 0. The log held all forty identities
of the first writer and all forty of the second, with two terminal frames, no
unparsable line, and no repeated identity. Nothing was pruned and no write
interleaved into another write.

## 9. `interrupted_read_failure` — not accepted (blocked)

`baton_log_interrupted` appears once in the source (`logs.bend:295`) and no file
under `bend2/test` names it. The frame is written only when the held set is
non-empty, and no fixture reaches the read-failure arm with a non-empty held
set, so the frame cannot be observed. The held frames the arm would flush are
durable in the checkpoint instead, which check 2 verifies. No coverage is
claimed.

## Supporting: storage report and cleanup scope — accepted

`logs-storage` reports `session`, `path`, `level`, `pendingInput`, `bytes`,
`stderrBytes`, `pendingBytes` and `pendingPath`; it carries no `budgetBytes`,
`keepSegments` or `rotated` field. `logs-clean` answers
`{session, removed, attemptFiles}` and removed nothing. The public log, its
`.stderr`, a `.pending` checkpoint, a rotated-looking `.1` name and a
generation-looking `.attempt-x` name all survived cleanup.

## Matrix disposal

The `351c9aba` matrix was authored and never executed. The runner was
unreachable when the run was attempted, and the follow-up launch failed before
building. There is no build log and no executable for that candidate in the
runner staging area, so no measurement of `351c9aba` exists and none is
reported. Everything in this record describes `31f261ff` alone. The authored
`351c9aba` harness (`issue686_acceptance_351.py`, SHA-256
`05d55bc24227fdb125914672f44b86c4ee408a5fc12dcd4c7f7356b7802d1b23`) is retained
unchanged beside this record, together with the earlier `5c12fe65` and
`ecfbdd0b` records.

## Limits

This record covers the log policy, its commands, the frames they write and the
checkpoint at `31f261ff`. It does not cover the provider's `set_event_filter`
behaviour, retained-receive reconstruction, the receive re-attach watermark, or
the whole-repository gates. The acceptance harness drives the CLI; the
delivered suites were run separately on the same executable.
