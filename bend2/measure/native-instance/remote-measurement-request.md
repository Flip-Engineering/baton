# Remote measurement request: same workload, per platform

Prepared, not executed. The operator directs compilation and CI/CD onto remote
runners, so no fixture, harness, compiler or check work runs on the laptop. This
request names the same workload as the retained laptop baseline in
`baseline-2026-10-05.md`, the exact commands and the evidence each runner returns.
Linux and Darwin results stay separate and are never compared across platforms.

## Ownership

`native-instance-measure` owns the tools under `bend2/measure/native-instance/` and
this request. `native-instance-conductor` owns `context/receive-request.bend` and
`context/retained-read.bend`. `native-instance-owner` retains the custody task module.
This request does not transfer any of those.

## Required inputs, supplied by the caller

Every path below is required. A configured path that does not resolve stops the run;
no script falls back to a recorded laptop path, and no script selects a CLI of its own.

| Input | Meaning |
| --- | --- |
| `BATON2_RELEASE` | the release `bin/baton2` built from the exact admitted candidate tree on this runner, by absolute path |
| `BATON2_GIT_SERIES` | that release's `libexec/baton2/git-series.mjs` |
| `BATON2_GIT_REGISTRY` | the series registry on the runner |
| `BATON2_MEASURE_MODEL` | the exact model key for the route under measurement |
| `OMP` | the runner's admitted OMP harness executable, by absolute path |
| `READ_CLI` | the runner's admitted read CLI executable for the capture step, by absolute path |
| `RUN` | a fresh run directory for this run; the scripts refuse an existing directory |
| `DATABASE` | the fixture database for this run, created by the fixture script below it |

The capture step records `cli` and `cli_sha256` for `READ_CLI` in its own header, and
the analysis step consumes that file. The analysis tool never runs a CLI command.

No script substitutes a path the caller did not supply. A tool that names a release,
helper, registry or model stops when that input is missing or does not resolve.
`BATON2_MEASURE_IDENTITY=historical-fca7af87-laptop` is the only way to select the
retained laptop paths; a run that sets it records `identity_mode` as that mode and is a
reproduction of the retained baseline, not a qualification of a candidate.

## Reader case suite

`reader-case-suite.py` is the prepared check for the malformed, truncated, removed and
capture-failure paths. It builds synthetic attempt directories and capture sets in a
temporary directory, runs no Baton command, touches no retained evidence, and exits
non-zero when a case differs from the documented state.

```
python3 bend2/measure/native-instance/reader-case-suite.py
```

Cases: a route parsed from an intact spool; a route followed by undecodable bytes; a
stable non-JSON line; valid non-object JSON as a number, string and array; an object
with no recognised shape; a route beyond the 4 MiB prefix with the suffix uninspected; a
spool removed after the directory listing; no spool at all; the capture refusals
`header-incomplete`, `header-invalid`, `database-mismatch` and `no-reads`; a non-zero
exit; a read without raw stderr; exit 0 with empty stdout; and the `players-failed`,
`players-empty-list`, `players-malformed` and `turns-failed` states.

## Tier 1: runtime chain without a provider request

No model credentials and no network egress. It measures the dispatch, receive
observer and keeper chain plus a failing harness child.

```
RUN=/runner/scratch/run-$(date -u +%Y%m%dT%H%M%SZ)
FIXTURE=$RUN/fixture-fail
DARWIN_OMP=/runner/admitted/toolchain/omp        # platform input
FALSE_BIN=/usr/bin/false                          # present on Darwin and Linux

python3 bend2/measure/native-instance/fixture_run.py "$FIXTURE" "$FALSE_BIN" \
  "$BATON2_MEASURE_MODEL" high \
  "Reply with the text that this harness cannot produce." fixture-fail

# capture the operational reads directly, then analyse the captured files offline
python3 bend2/measure/native-instance/attempt_exit_records.py --list-sessions \
  "$FIXTURE/fixture.db" > "$RUN/sessions.txt"
bend2/measure/native-instance/capture-cli-reads.sh "$READ_CLI" "$FIXTURE/fixture.db" \
  "$RUN/captures-fail" "$RUN/sessions.txt"
python3 bend2/measure/native-instance/attempt_exit_records.py "$FIXTURE/fixture.db" \
  "$RUN/attempts-fail.json" --captures "$RUN/captures-fail"
```

Return: `run.json`, `attempts-fail.json`, `captures-fail/` in full (header, every
`.stdout`, `.stderr`, `.exit`), the `status` and `manifest` bytes of every attempt
directory, and the actual exit status of each command. Expected shape from the laptop
baseline: one attempt, `status` = `256` (exit 1), `released` and `acknowledged`
present, and a delivered report naming the exit code. `fixture-fail` sends no model
request.

## Tier 2: full turn with the provider harness

Requires the runner to reach the recorded provider route with its own admitted
credentials. The task texts are exact and are not placeholders:

| Fixture | Task text |
| --- | --- |
| `fixture-small` | `Reply with exactly the text fixture-ok and nothing else. Do not use any tools.` |
| `fixture-big` | `Use the bash tool to run exactly: seq 1 400000 . Then reply with the total number of lines you observed.` |
| `fixture-queue` | slow task `Use the bash tool to run exactly: seq 1 400000 . Then reply with the total number of lines you observed.` followed by the follow-up `Reply with exactly the text queued-followup and nothing else.` |

```
for fixture in fixture-small fixture-big; do
  case $fixture in
    fixture-small) task="Reply with exactly the text fixture-ok and nothing else. Do not use any tools." ;;
    fixture-big) task="Use the bash tool to run exactly: seq 1 400000 . Then reply with the total number of lines you observed." ;;
  esac
  python3 bend2/measure/native-instance/fixture_run.py "$RUN/$fixture" "$OMP" \
    "$BATON2_MEASURE_MODEL" high "$task" "$fixture"
  python3 bend2/measure/native-instance/attempt_exit_records.py --list-sessions \
    "$RUN/$fixture/fixture.db" > "$RUN/sessions-$fixture.txt"
  bend2/measure/native-instance/capture-cli-reads.sh "$READ_CLI" \
    "$RUN/$fixture/fixture.db" "$RUN/captures-$fixture" "$RUN/sessions-$fixture.txt"
  python3 bend2/measure/native-instance/attempt_exit_records.py "$RUN/$fixture/fixture.db" \
    "$RUN/attempts-$fixture.json" --captures "$RUN/captures-$fixture"
done

python3 bend2/measure/native-instance/fixture_queue_probe.py "$RUN/fixture-queue" \
  "$OMP" "$BATON2_MEASURE_MODEL" high
python3 bend2/measure/native-instance/measure_startup.py \
  "$RUN/fixture-small/fixture.db" "$RUN/startup-costs.json"
```

Return: for every run the `run.json` or `queue-probe.json`, the raw dispatch logs, the
attempt `status` and `manifest` bytes, the captured CLI sets, and the delivered report
bodies with the actual exit status of every command. Report an observed route only from
that attempt's retained `stdout` spool, using the states the tool records
(`route-parsed-from-retained-spool`, `no-route-frame-in-fully-read-spool`,
`no-route-frame-in-inspected-prefix`, `spool-changed-during-read`,
`spool-removed-after-listing`, `no-retained-spool`), together with the uninterpreted
categories and the metadata comparisons that produced them.

Tier 2 numbers are comparable only with Tier 2 numbers of the same platform, route,
effort, harness build and fixture revision.

## Tool behaviour under the direct-native rule

- `attempt_exit_records.py` never invokes a CLI. It reads attempt files and consumes
  capture files; `--list-sessions` reads attempt directory names only.
- `capture-cli-reads.sh` is the only step that invokes a CLI. It runs the caller's
  `READ_CLI` directly with the caller's database, keeps `.stdout`, `.stderr` and
  `.exit` per read, and records the CLI path and hash in its own header.
- `measure_startup.py` invokes the explicit `BATON2_RELEASE` binary to time it. It
  records each exit status and the output size and parses no native JSON.
- `fixture_run.py` and `fixture_queue_probe.py` drive one fixture turn with the
  caller's harness executable and record process samples from `ps`.
- `measure_processes.py` reads `ps` and `footprint -j` only.

## Resource capture per platform

| Measure | Darwin arm64 | Linux x86_64 |
| --- | --- | --- |
| Resident set | `ps -o pid,rss` | `ps -o pid,rss` |
| Private or footprint memory | `footprint -j`, reading `footprint` and `auxiliary.phys_footprint_peak` | `/proc/<pid>/smaps_rollup` (`Pss`, `Private_Clean`, `Private_Dirty`, `Anonymous`), with cgroup `memory.peak` for the job |
| Cumulative CPU | `ps -o time` | `/proc/<pid>/stat` fields 14 and 15, or `/usr/bin/time -v` |
| Process roles | `ps -axo pid,ppid,command` classified by argv | the same |

`measure_processes.py` implements the Darwin columns and is ready to run. The Linux
adapter that reads `smaps_rollup` and cgroup `memory.peak` is **not implemented**; it is
a dependency of a Linux resource run, not a ready executable. Until it exists, a Linux
run returns Tier 1 and Tier 2 chain evidence without the private-memory column, and its
absent column is reported as unavailable rather than estimated.

RSS totals are not private memory on either platform, and a summed `phys_footprint` or
`smaps_rollup` figure is not instantaneous physical RAM use.

## Comparison rule

The candidate comparison for shared native operation needs both versions on the same
platform, workload, route, effort, harness build and fixture revision, with the same
role classification. Report per-role counts plus per-role memory and CPU for each
version, with the raw evidence above. Do not compare a Linux figure with a Darwin
figure, and do not treat a stored process identifier as liveness evidence.

## Not in this request

- No local compilation, law check, native check, test, fixture or harness run on the
  laptop, and no rerun of the retained laptop fixtures.
- No push to the protected validation branch and no workflow edit; root admits exact
  source to `codex/bend2-homelab-validation-20261005`.
- No claim of memory saving from receiver RSS alone.
