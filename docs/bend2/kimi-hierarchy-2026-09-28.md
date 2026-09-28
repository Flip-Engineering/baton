# Kimi lead with concurrent DeepSeek and Muse workers

At source `512349b6eed81c019bf0cf674bd7ddef3d5f2afe`, a subscription Codex
root recruited a Kimi K3 lead through OMP. The lead recruited DeepSeek and Muse
workers, started them concurrently, guided DeepSeek during its task, reviewed
both changes and landed them onto its branch. The root landed the reviewed
composition, and the acceptance driver exited 0.

The [retained measurement](measurements/2026-09-28-kimi-hierarchy.json) contains
routes, tasks, identities, times, receipts, commits, usage and checker results.

## Runtime and native identities

Kimi used the existing OMP adapter with model `kimi-code/k3` and effort `high`.
The root and lead registered native `receive` endpoints. Recruitment, guidance,
session resumption and parent reporting used the existing coordinator paths.
The runtime required no Kimi-specific change. The executable was built from the
selected clone with Bend 2.0.25 and remained unchanged. Its SHA-256 was
`5518f42bbdddb9f56b1712a6c7998c9b242454cb2bda95430de0a4ade7befbf6`.

| Session | Parent | Harness, model and effort | Native session |
| --- | --- | --- | --- |
| root | none | Codex, requested `gpt-6-astra`, `low` | `01a0e784-904a-7172-878a-49a6acba951e` |
| lead | root | OMP, observed `kimi-code/k3`, `high` | `01a0e784-f712-7000-a735-6fbbdd84e498` |
| deepseek | lead | OMP, observed `deepseek/deepseek-flash`, `low` | `01a0e786-ad97-7000-99e2-79c66a36d497` |
| muse | lead | Muse, observed `muse-spark-1.3-contributor`, `low` | `01a0e786-a8f8-7751-ae1d-8cef043f4332` |

Effort values are requested settings. Codex supplied no observed model. The root
had three native invocations and the lead had two, retaining their native IDs.
Each worker had one invocation. All seven exited 0. Successive invocations of
the same root or lead session did not overlap.

DeepSeek and Muse native processes overlapped for **72.713 seconds**; a retained
`ps` observation records both child PIDs alive. This measures process lifetimes.

## Guidance and report delivery

Kimi observed DeepSeek's first tool event, then issued `message-file` for
`unexpected-success-guidance`. Its retained native tool-call arguments contain
that coordinator command and message ID. The requirement was to treat an
unexpectedly passing `unittest.expectedFailure` test as a stable
`unexpected-success` failure, while preserving ordinary expected failures.

| Event | Seconds after run start | DeepSeek event index |
| --- | ---: | ---: |
| First `tool_execution_start` | 142.734 | 11 |
| Lead observed that event | 146.643 | — |
| Lead issued the guidance command | 152.634 | — |
| Successful native `steer` response | 155.736 | 72 |
| Terminal `agent_end` | 265.061 | 336 |

Indexes are zero-based in the retained event stream, which omits OMP
`message_update` frames. Steer acceptance preceded terminal output by 109.326
seconds. The stored receipt is:

```json
{"id":"unexpected-success-guidance","type":"response","command":"steer","success":true}
```

DeepSeek implemented the added behavior and regression. Reports `deepseek-turn`
and `muse-turn` reached the lead. Lead reports `receive:lead:2:1` and
`receive:lead:5:2` reached the root. All four retained bodies matched their native
terminal text and received review receipts. The initial tasks were acknowledged.
The final `hierarchy-complete` report remains available in the operator inbox.

## Changes, review and landings

DeepSeek changed `bend2/scripts/check-unittest.sh` and its existing test file.
Empty and skipped selections now emit explicit unjudged markers and exit
nonzero. Unexpected successes produce stable failure identities. Muse corrected
the Codex report description in `bend2/README.md` to describe retained events
from the current invocation. Only those three files changed in the live landing.

| Change | Worker commit | Checked landing |
| --- | --- | --- |
| Muse documentation | `68abd6558abe1cbf926a83129b08bb66bf35817d` | `b5e1c3a36408f0c72d48424ec1fd9a9c137909f7` on `hierarchy-lead` |
| DeepSeek checker | `d1a6c1a22e1bfaf2cb62c1b6b9454ec45945e772` | `ceec71618bff9493b08eb8333131bdf811427be2` on `hierarchy-lead` |
| Composed lead | `ceec71618bff9493b08eb8333131bdf811427be2` | `19ec7aabe18dda423dab54094d60d3bc0f46bf25` on local `bend2-trial` |

Muse initially edited and committed in the detached shared `repo` checkout.
Its registered `hierarchy-muse` branch still pointed at the base. Kimi detected
the mismatch during review, inspected the reported commit and advanced the
registered worker branch to it before checked landing. Root review verified
the recovered branch contents. This recovery used Git and the existing landing
commands; it introduced no runtime mechanism.

The lead detached its checkout and reviewed actual diffs, checker behavior and
test output. The root independently inspected bindings, guidance acceptance,
worker changes, the composed diff and the README against the supervisor code.
Every final file blob matched its worker commit. Lead and final target trees
both equal `8a4a17edddc226d57b562145aef0bfd9054d3aaa`.

All three checked landings selected `bend2/test/check-unittest.py`, run through
`/bin/sh CHECK FILE` in both checked trees. The root separately ran the selected
file on each worker, the composed lead and final target: respectively 12, 6,
12 and 12 tests passed. The full native preflight passed 106 Python tests and
two Bend Git suites before the real run.

## Final source review

The live landing is `19ec7aab`. Later source review produced `e2bbd6b6`:
worker prompts now name their exact workspaces and branches; skipped subtests
retain an unjudged verdict without falsely claiming no test ran; the README
specifies the latest completed assistant message and documents the Kimi route.
The added diagnostic regression brings the checker suite to 13 passing tests.
These corrections were made after the live hierarchy completed.

Nine independent checker cases passed on both trees: empty selection, class
skip, mixed pass/skip, mixed failure/skip, unexpected success, expected failure,
ordinary pass, assertion failure and error. The final native suite passed
113 Python tests across 11 files and two Bend Git suites. Its rebuilt binary
matched the live binary hash. The measurement retains check output and hashes.

## Time and usage

The live run took **637.780 seconds**, excluding the coordinator build. Native
durations include model requests, tools and local work. They are elapsed wall
times and overlap across sessions.

| Session | Native seconds | Input tokens including cache | Output tokens |
| --- | ---: | ---: | ---: |
| root | 149.155 | 429,074 | 3,136 |
| lead | 472.989 | 1,755,553 | 17,371 |
| deepseek | 126.963 | 1,558,638 | 20,935 |
| muse | 72.713 | unavailable | unavailable |

Codex's counters were cumulative across resumed turns; the table uses the last
total. OMP totals sum completed assistant `message_end` usage, excluding envelope
copies. Muse emitted no usage fields. These counters do not establish billed
cost or comparative model efficiency.

## Reproduction and limits

The measurement's `routes` entries provide `codex`, `lead`, `omp` and `muse`
executables, models and effort. Its `tasks` entries retain full assignments,
allowed files, checks and guidance. Extract them and the original driver:

```sh
mkdir -p .scratch/kimi-replay
python3 - <<'PY'
import json, pathlib
record = json.loads(pathlib.Path('docs/bend2/measurements/2026-09-28-kimi-hierarchy.json').read_text())
for key in ('routes', 'tasks'):
    pathlib.Path(f'.scratch/kimi-replay/{key}.json').write_text(json.dumps(record[key], indent=2) + '\n')
PY
git show 512349b6:bend2/scripts/accept-kimi-hierarchy.py > .scratch/kimi-replay/accept-kimi-hierarchy.py
git show 512349b6:bend2/scripts/accept-native-receive.py > .scratch/kimi-replay/accept-native-receive.py
export BEND=/Users/wahargis/Development/Experiments/bend2-trial/.bend/bin/bend
python3 .scratch/kimi-replay/accept-kimi-hierarchy.py --source "$PWD" --revision 512349b6 \
  --config .scratch/kimi-replay/routes.json --tasks .scratch/kimi-replay/tasks.json \
  --output .scratch/kimi-replay/run
```

Executable paths must resolve to authenticated harnesses. `BEND` above uses the
recorded `coordinator_build.compiler.path`; adjust installed paths for another
host. The output directory must be new. Full evidence includes SQLite, tasks,
native logs, checks, Git worktrees, `root-report.md`, `evidence.json` and `usage-timeline.json`.
This run covers two concurrent workers, three agent levels and OMP steering.
It changed no resident or historical trial state and performed no remote push.
The local `bend2-trial` branch belongs to this isolated scratch clone.
