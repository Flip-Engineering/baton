# Remote measurement request: same workload, per platform

Prepared, not executed. The operator directs compilation and CI/CD onto remote
runners, so no fixture, harness, compiler or check work runs on the laptop. This
request specifies the same workload as the retained laptop baseline in
`baseline-2026-10-05.md`, the exact commands, and the evidence each runner must
return. Linux and Darwin results stay separate and are never compared across
platforms.

## Workload identity

| Item | Value |
| --- | --- |
| Coordinator binary | the candidate release built from the exact admitted tree on the runner, recorded by path and SHA-256 |
| Fixture scripts | `bend2/measure/native-instance/fixture_run.py`, `fixture_queue_probe.py`, `measure_processes.py`, `measure_startup.py`, `attempt_exit_records.py` at the committed revision |
| Model route | `deepseek/deepseek-flash`, effort `high`, for the provider tiers |
| Harness command | OMP toolchain executable from the runner's own admitted toolchain, recorded by path and SHA-256 |
| Task text | `Reply with exactly the text fixture-ok and nothing else. Do not use any tools.` and `Use the bash tool to run exactly: seq 1 400000 . Then reply with the total number of lines you observed.` |
| Fixture databases | created by the scripts under a runner-owned directory; never the laptop baseline databases |

## Tier 1: runtime chain without a provider request

This tier needs no model credentials and no network egress. It measures the
dispatch, receive observer and keeper chain, plus a failing harness child.

```
FIXTURE=/runner/scratch/fixture-fail
python3 bend2/measure/native-instance/fixture_run.py "$FIXTURE" /usr/bin/false \
  deepseek/deepseek-flash high \
  "Reply with the text that this harness cannot produce." fixture-fail
python3 bend2/measure/native-instance/attempt_exit_records.py "$FIXTURE/fixture.db" \
  "$FIXTURE/attempts.json"
```

Return: `run.json` (chain timeline, per-process samples, session and turn rows, logs),
`attempts.json` with `evidence/cli-reads/`, the `status` file bytes for every attempt
directory, and the actual exit status of both commands. Expected shape on the laptop
baseline: one attempt, `status` = `256` (exit 1), `released` and `acknowledged`
present, and a delivered report naming the exit code. On Linux the harness path is
`/usr/bin/false`; on Darwin the laptop baseline used the same path.

## Tier 2: full turn with the provider harness

Requires the runner to reach the recorded provider route with its own admitted
credentials. Run the two baseline tasks and the busy-guard probe:

```
OMP=/runner/admitted/toolchain/omp
for fixture in fixture-small fixture-big; do
  python3 bend2/measure/native-instance/fixture_run.py "$PWD/$fixture" "$OMP" \
    deepseek/deepseek-flash high "<the task text for this fixture>" "$fixture"
done
python3 bend2/measure/native-instance/fixture_queue_probe.py "$PWD/fixture-queue" \
  "$OMP" deepseek/deepseek-flash high
python3 bend2/measure/native-instance/measure_startup.py "$PWD/fixture-small/fixture.db" startup-costs.json
```

Return: for each run the `run.json`, the raw dispatch logs, the attempt `status` and
`manifest` bytes, the delivered report bodies, and the actual exit status of every
command. Report the observed route for an attempt only from that attempt's retained
`stdout` spool, with the state names the tool records
(`route-parsed-from-retained-spool`, `no-route-frame-in-retained-spool`,
`no-route-frame-in-inspected-prefix`, `no-retained-spool`).

Tier 2 numbers are comparable only to Tier 2 numbers of the same platform, route,
effort, harness build and fixture revision.

## Resource capture per platform

| Measure | Darwin arm64 | Linux x86_64 |
| --- | --- | --- |
| Resident set | `ps -o pid,rss` | `ps -o pid,rss` |
| Private or footprint memory | `footprint -j`, reading `footprint` and `auxiliary.phys_footprint_peak` | `/proc/<pid>/smaps_rollup` (`Pss`, `Private_Clean`, `Private_Dirty`, `Anonymous`), with `cgroup` `memory.peak` for the job |
| Cumulative CPU | `ps -o time` | `/proc/<pid>/stat` fields 14 and 15, or `/usr/bin/time -v` |
| Process roles | `ps -axo pid,ppid,command` classified by argv | same |

`measure_processes.py` implements the Darwin columns. A Linux run needs a
platform-specific variant that reads the same roles from `ps` and the memory columns
from `smaps_rollup`; the shared reporting form stays the exit status, RSS, the
platform's private-memory measure, cumulative CPU and startup timing. RSS totals are
not private memory on either platform, and a summed `phys_footprint` or `smaps_rollup`
figure is not instantaneous physical RAM use.

## Comparison rule

The candidate comparison for shared native operation needs both versions on the same
platform, workload, route, effort, harness build and fixture revision, with the same
role classification. Report per-role counts and per-role memory and CPU for each
version, plus the raw evidence above. Do not compare a Linux figure with a Darwin
figure, and do not treat a stored process identifier as liveness evidence.

## Not in this request

- No local compilation, law check, native check or test run on the laptop.
- No rerun of the retained laptop fixtures; those databases stay as evidence.
- No push to the protected validation branch and no workflow edit; root admits exact
  source to `codex/bend2-homelab-validation-20261005`.
- No claim of memory saving from receiver RSS alone.
