# Native process-owner loss

## Measured source and scope

These controlled runs used source `ea514a28e080317b223414af9a2327a6b53384e6`
and its released Darwin arm64 coordinator, SHA-256
`5511abbfa76e1f849edd8ffc76a1ea8f6bd01b4129a897725621c0ec452c6c07`.
The Codex and OMP event protocols were supplied by `bend2/test/receive.py` at
that source. The operating system and storage remained running. Model providers,
physical host restart and power loss were outside these measurements.

The [selected machine evidence](measurements/2026-10-03-owner-process-loss.json)
records source, fixture, probe and original artifact hashes. Full raw streams,
database snapshots, process observations and review receipts remain in the
original measurement worktrees identified there. The results do not qualify
later subscription-guard changes or a complete working day.

## Keeper loss

The retained-process keeper was killed while its native child survived. Both
protocol fixtures reproduced the failures tracked in
[#656](https://github.com/Flip-Engineering/baton/issues/656).

| Protocol | Native child survived | Same-session retry started another native process | Original completion recorded | Later pending input completed |
| --- | --- | --- | --- | --- |
| Codex | Yes | Yes | No | Yes |
| OMP | Yes | Yes | No | Yes |

The original child wrote progress and terminal output after keeper loss. Those
bytes remained in the attempt's stdout file. Its terminal completion was absent
from coordinator storage. The receive observer exited with status 32 and
reported a broken-pipe observation and wait failure.

A later receive continued the pending input with the saved native identity,
branch and workspace. The input received its acceptance receipt, the completion
was recorded and the parent was notified. A retry during that continuation
returned `queued` without launching another child. Both probes naturally exited
1 and all owned processes were observed closed. Keeper ownership and recovery
of the original completion remained failed. The original native child's
numeric exit status is unavailable because its keeper died before recording it.

## Complete process loss

The corrected V3 probe ran once for each protocol. Root reviewed the selected
process custody before approving signals. Each run recorded successful
`SIGSTOP` calls for observer, keeper and native child, followed by successful
`SIGKILL` calls for native child, keeper and observer. Raw `ps` observations
established that all three selected process births were absent before restart.

Both continuations resumed the saved native identity and accepted the exact
pending input. They preserved the branch, workspace and commit, recorded
completion and notified the parent. A live continuation retry returned `queued`
without another native launch. Both probes and continuations naturally exited
0; every direct command was waited and all selected owned processes were absent
at closure. The killed observer's direct wait returned -9. Keeper and native
numeric exit statuses remain unknown because they were indirect children.

The original child was killed before terminal output, so original completion
was not expected in these full-loss runs. These passes qualify controlled
complete-process-loss restart on the measured source. The keeper failures above
remain separate.

## Preserved measurement limits

Earlier full-loss runs returned 0 but recorded only the observer kill after
three stop calls. Their pre-restart identity predicate also treated a changed
command as absence, and retained no raw observation for that decision. Those
results keep their original status and limited evidence. V3 separates selected
birth existence from signal admission, records raw observations and requires
complete signal injection before restart.

Four V3 setup attempts failed before signals. Two selected a mutable build
binary and stopped at role assignment. Two selected the released binary but
their plain-pipe stdin closed before custody approval. All four retained failed
status and owned closure. The successful runs selected the immutable released
binary and kept approval input open.

## Reusable probe

[probe-owner-process-loss.py](examples/probe-owner-process-loss.py) is the exact
reviewed V3 source, SHA-256
`4d38823c2b2c02a4107bf55f6b2a4a83fe0e69a6aeca2c97a53ae5529a70dfbb`.
It imports the receive fixture from its checkout and records that fixture's
hash in each new result. A new run qualifies its selected source and binary.

Run from a checkout with an accepted coordinator binary and an unused output
directory. Keep stdin open in the foreground:

```sh
python3 docs/bend2/examples/probe-owner-process-loss.py \
  --loss all --harness codex \
  --binary /path/to/accepted/bin/baton2 --output /path/to/new-run
```

Review the emitted `custody-ready` record's PID, start, command and ancestry.
Enter its exact `custody_sha256` on stdin only after approving those owned
processes. `--harness omp` selects the other protocol. `--loss keeper`
reproduces the measured keeper boundary; its observer-wait sequence needs
review when validating a repair that keeps the observer alive after keeper loss.

An incomplete injection records `failed-injection.json` before waiting or
restarting. Natural fixture cleanup can remain blocked by a stopped survivor;
Root must inspect the checkpoint and authorize any further process action.
The earlier [observer-loss recovery record](receive-recovery-2026-09-28.md)
covers the separate boundary where the keeper survives.
