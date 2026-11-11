# Codex recovery after complete process loss

## Result

Codex `gpt-6-astra`, with low reasoning and the operator's ChatGPT subscription
login, resumed its recorded conversation and completed the task. This passed
on the requested runtime revision `d499a0a9` and on the combined #625/#626
revision `276b62b5baef6e6aae17f60c364957b96a08cf35`. This case required no additional
Codex runtime repair.

The driver removed `OPENAI_API_KEY` and `CODEX_API_KEY` from native launches and
passed `forced_login_method="chatgpt"`. The native login check returned
`Logged in using ChatGPT`.

## Measurements

| Reading | Runtime `d499a0a9` | Combined runtime `276b62b5` |
| --- | --- | --- |
| killed coordinator PID | 3247 | 97821 |
| killed Codex PID | 3250 | 97824 |
| coordinator exit | signal 9 | signal 9 |
| live owned processes killed | 6 | 7 |
| resumed Codex PID | 4105 | 99127 |
| restarted turn exit | 0 | 0 |
| native completion | `turn.completed` | `turn.completed` |
| journal present before kill | no | no |
| remaining owned processes | none | none |
| elapsed seconds | 40.96 | 15.06 |

The first run resumed `01a0e8b2-f1bc-7ca1-a359-e800969c9694`.
The combined run resumed `01a0e8bb-63bc-7793-a593-5001ea11a2c8`.
Each recorded `exec resume` argument and restarted `thread.started` event named
the original conversation. The coordinator's recorded identity also matched.

Both runs created only `journal.txt`, containing exactly:

```text
line one from codexsession
line two from codexsession
line three from codexsession
```

Elapsed time includes probe initialization, process loss, model execution and
verification. It excludes compilation. These individual run times do not measure
coordinator overhead.

## Probe changes

The original probe located harness processes by a database path that Codex's
argv does not carry, and checked every harness for OMP's `agent_end` event.
The probe now records each native launch's PID and complete argv in a wrapper
that execs the configured harness. Codex checks require a successful normalized
`result`, native `turn.completed`, and matching restarted `thread.started`.

`--harness codex` selects the requested half. Each run creates a new output
directory and preserves full evidence on failure. The driver verifies that the
initial coordinator and native PIDs were killed before resuming, and checks the
complete journal and the set of changed files. The OMP path retains #626's
recovery diagnostic check when a refused conversation causes a fresh launch.

The baseline run used the corrected probe with runtime source fixed at
`d499a0a9`. The combined run used the probe and runtime at `276b62b5`.
The [measurement record](measurements/2026-09-28-codex-process-loss.json)
contains both source pins, executable and driver hashes, exact native arguments,
full terminal events, and paths to retained evidence.

## Reproduce

At the combined revision:

```sh
BEND=/path/to/bend sh bend2/scripts/build-native.sh
python3 docs/bend2/examples/probe-recovery-real-models.py \
  --harness codex --codex /path/to/codex \
  --output /path/to/new-run
```

To exercise the earlier runtime, create a worktree at `d499a0a9` and copy the
current probe into it before building. The baseline probe source and its patch
are retained in
`/Users/wahargis/Development/Experiments/baton-bend2-all-process-loss-d499`,
with artifacts under `.scratch/recovery-codex/`. The combined artifacts are
under `.scratch/issue625/all-process-loss/` in
`/Users/wahargis/Development/Experiments/baton-bend2-supervisor-loss-625`.

## Recovery boundary and integration finding

This run kills all owned local coordinator and harness processes, then the
driver explicitly restarts `turn` with the recorded identity and task file.
The kill preceded the first task edit. It proves conversation resumption and
completion after that loss; partial-edit recovery and host reboot remain
unvalidated. Automatic receive-observer recovery is measured separately in
[the #625 record](receive-recovery-2026-09-28.md).

A controlled integration probe at `276b62b5` found that retained `receive`
bypasses #626's retry in `Turn.supervise`. Its only OMP launch carried
`--resume missing-omp-conversation` and was refused. Receive exited 1, recorded
failure reports, left the original input pending, and created no fresh launch
or recovery diagnostic. All owned processes exited naturally. Direct `turn`
retains #626's fallback. The evidence is
`.scratch/issue625/all-process-loss/receive-626-gap/evidence.json`.
The later [retained receive repair](receive-recovery-2026-09-28.md#retained-receive-fallback)
adds this fallback and validates observer recovery during the fresh attempt.

The combined native suite passed all 124 Python tests and both Bend Git suites.
The #625 supervisor-loss probe also passed on the combined binary. The existing
#626 regression test at that revision covers direct `turn`. The later receive
tests and composed-tree measurements are recorded with the repair above.
