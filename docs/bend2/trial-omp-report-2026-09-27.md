# OMP report loss in the cutover trial

The read-only inspection of the live cutover trial found a lost report in
`issue-608-reclaim-turn-1`, native OMP session
`01a0e194-40e7-7000-ad3f-ce5f0074989b`. The worker's final `message_end` carried
its full report, including commit `29ec891e26ba3a7328b20868bfe80ab8739a3856`,
changed files, checks and limitations. The subsequent native terminal frame was:

```json
{"type":"agent_end","messages":[],"isTerminal":true,"messageCount":352}
```

The coordinator had only extracted report text from `agent_end.messages`, so its
stored report body was that envelope. The root's receipt explicitly noted the
missing prose and reconstructed the evidence from the commit. The native log
still contained the full report. These two native frames are preserved in
`bend2/test/fixtures/issue608-omp-report.jsonl`.

The turn reader now retains the latest assistant `message_end` in memory. When
OMP's terminal envelope omits its messages, the reader supplies that assistant
message to the existing observation path before committing and delivering the
report. A populated terminal message list continues to supply its own report.
The output log retains the original native frames. The memory belongs to that
one supervisor; no database table or separate durable report store was added.

## Verification

The regression replays the two actual native frames through a controlled OMP
process into a private coordinator database. Before the fix it failed because
the body was the empty terminal envelope. With the fix, the full text reaches
both the inbox and the registered root endpoint. The original log stays
byte-identical, and retrying the completed turn starts no process and sends no
second root delivery.

The native coordinator build passed. `python3 -m unittest bend2.test.turn`
passed all 12 tests, covering the existing four harness turn paths and guidance.
After extending the regression to inspect the root endpoint's received body,
that test passed again. No JS suite ran.

## Live trial status and scope

The root completed #608 despite the report loss. Its landing log records
`landed` at `22f0947eb4bb2df50ea4a65c16a77b197b6e22de`; its operator report records
successful push and `ls-remote` at that same commit. The root then launched the
#379 measurement worker. The inspection found no lost wake or failed landing
in #608: the report contents were the defect.

Inspection used SQLite `mode=ro` and filesystem reads under
`/Users/wahargis/Development/Experiments/bend2-trial`. No coordinator command ran
against the live database, and no live trial file or process was modified.
Tests and builds ran only in the assigned Bend2 checkout. The fix applies to new
turn supervisors after the updated kit is built; it does not rewrite the old
stored report or change a supervisor that is already running.

## Observation after the kit rebuild

At the architect15 recovery inspection on 2026-09-27, `git ls-remote origin
refs/heads/bend2-rewrite` returned `831d25b8e2b6ad5d7fab7c56b124aebb5cef6bd1`.
That revision includes the report fallback and OMP log frame selection. The
trial executable at `state/trial.db.trial/baton2` had a modification time of
08:10:05 UTC, and the kit source contained the frame-selection change.

The subsequent `issue-370-seed-help-native.jsonl` contained 6,570,937 bytes,
324 `message_end` frames and zero `message_update` frames. Its terminal
`agent_end` had `isTerminal: true`, `messageCount: 324` and an empty message
list. The coordinator message `issue-370-seed-help-turn-1` contained 3,697 bytes
of report text, exactly equal to the text extracted from the final assistant
`message_end`. The message had a root review receipt naming worker commit
`757471287001d4d1cbdcaff94a0a607de3af0e13`.

The operator message `issue-370-landed-026a7017` recorded the checked landing
and publication at `026a70171c54ce8ba82ce03b27012b6ac8cef5ca`, with matching
remote read-back. That publication statement is the root's stored report;
this inspection compared the native frames and coordinator report directly.
It used file reads and SQLite `mode=ro` against the same live trial directory
named above. It changed no trial files or processes.

The recovered source rebuilt successfully with the existing Bend 2.0.25
compiler, and `python3 -m unittest bend2.test.turn` passed all 12 tests.
The generic deployment verification command was not run in this recovery
check; these results cover the Bend2 turn behavior described here.
