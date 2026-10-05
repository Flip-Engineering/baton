# Local host crash investigation

The retained kernel panic records a watchdog timeout during severe compressor
and swap stress. Four concurrent Bend compiler processes belong to native
Orchestra tasks. One Player started the same fixture build twice while its
first build remained active. These executions establish a validation placement
and duplicate-execution defect.

The operator requires compilation and CI/CD on remote homelab runners. The
laptop remains available for orchestration, source edits and evidence review.

## Evidence

The original report is
`/Library/Logs/DiagnosticReports/panic-full-2026-10-05-095727.0002.panic`,
SHA256 `49d32de152b22e759f7267eb5da60470d336d6bc7056a3547a6c43130dae65f6`.
Its metadata date is 09:57:27 Pacific. Its internal panic wall time and
Calendar decode to 06:37:12 Pacific. Retained native process birth times match
the internal time. The date discrepancy remains unexplained.

The panic reports no `watchdogd` check-in for 94 seconds, compressor segment
capacity at 100 percent, eleven swapfiles and low swap space. The separate
`memoryPressure` field is false. The panicked task is `kernel_task`, with an
AppleARMWatchdogTimer backtrace.

| Compiler PID | Recorded residentMemoryBytes | Native Player and execution |
| --- | ---: | --- |
| 23761 | 12950204200 | `semantic-controls-structure-research`: build `land-reviewed-commit.bend` to `/tmp/lrc-repro` |
| 26085 | 3485748656 | Same Player: starts the same build again with the first build active |
| 24252 | 12648166744 | `semantic-controls-interfaces-research`: full coordinator build |
| 25951 | 1802324032 | `audit-native`: full law-control run |

The recorded memory fields total 30886443632 bytes. Their sum does not measure
physical RAM use. The report lacks the separate private and compressed fields
needed to reconstruct that breakdown. Eighteen Baton runtimes have a recorded
total of 1436821440 bytes. Eight Codex processes and other applications also
contributed to the host workload.

The preserved attribution note is
`.scratch/root-crash-evidence-20261005/assessment.md`. It binds each compiler
to native attempt directories, `native.pid`, process ancestry, manifest hashes
and actual harness tool commands. The original attempts and streams remain
preserved. Source and toolchain receipts for the interrupted executions are
incomplete.

## Interpretation and scope

Concurrent compiler allocations and the duplicate build coincide with explicit
compressor and swap exhaustion. They are the strongest identified contributors
to the watchdog stall. The report establishes neither an underlying kernel
defect nor the cause of later reboots. The latest verified boot is 11:56:29
Pacific; its crash has no retained panic report in this investigation.

Shared native operation in #676 reduces coordinator and custody overhead.
Compilers launched through provider shell tools also require correct placement
and execution custody at the validation entry points. Those effects enter
through `build-native.sh`, `laws-check.mjs`, `check-native.sh` and direct
compiler calls in qualification fixtures.

## Remote validation requirements

Homelab inspection on 2026-10-05 found Linux x86_64, 64 CPU cores, 251 GiB
of RAM with approximately 228 GiB available, and approximately 2.2 TiB free
on its NVMe filesystem. Existing Flip runners retain their current assignments
and access restrictions. Baton requires its own admitted validation assignment.

Every remote result must retain exact source, compiler and library identity,
complete output, actual process completion and discovered control coverage.
The existing Darwin arm64 package requires remote Darwin build, native checks
and extracted-artifact qualification. Linux results carry their actual platform
identity.

Acceptance for the duplicate execution defect uses the observed repeated
fixture request: both requesters receive one retained execution and completion.
Loss of a requester or coordinator must preserve the active execution's
ownership and final result. Large Ensembles remain supported; heavy-effect
placement uses admitted remote capacity.
