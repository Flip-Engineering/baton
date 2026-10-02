# Hierarchy failure observation

[Issue #649](https://github.com/Flip-Engineering/baton/issues/649) records a failed
native hierarchy whose observer continued waiting after all owned native processes
had disappeared. The retained `hierarchy-failed` report was present, while two
interrupted wrapper records lacked completion timestamps and exit codes. The
frozen comparison driver required completion timestamps on every record. Its
failure and the operator's separate closure remain in
[the native comparison evidence](native-workflow-comparison-2026-10-02/README.md).

## Helper behavior

`bend2/scripts/accept-kimi-hierarchy.py` inspects the process table with
`/bin/ps`. It records wrapper, child, seed and worker-launcher start identities,
retains owned processes by recorded or previously observed PID and start
identity, and includes their observed descendants.
The observer excludes itself. Each selected process carries its state and an
active flag; a zombie remains present and has an inactive flag.

A failed terminal report and successfully established owned process absence
produce `failure-closure.json`. That receipt records the failed result, process
inspection, unknown native exits and hashes of the original process records.
The original records retain their missing timestamps and exit codes. A surviving
owned child or launcher prevents closure. The main observer also requires an
observed exit from its held seed process before closing the failed loop. A
present recorded PID with an unavailable start
identity remains uncertain. Failed or incomplete inspection reports an error
and cannot establish absence.

`observe_tool` requires an observed active child with the recorded or previously
observed start identity. Its inspection selects DeepSeek's recorded processes
and their descendants. An absent child with unfinished metadata reports unknown
completion. A historical tool event from that child cannot establish active
steering. Successful hierarchy verification requires completed wrapper and child
receipts with exit code zero, together with the existing native, review, steering
and checked-landing checks.

## Controlled evidence

The [before/after receipt](measurements/2026-10-02-hierarchy-observer.json) binds
the baseline helper from `e13cfb659a08e686ed87c31dbfc5586abfda5f9a` and the repaired
helper by SHA256. Its deliberately constructed interrupted-wrapper record and
historical tool event refer to two actual controlled subprocesses. The fixture
terminates its wrapper and releases its child through stdin EOF, then reaps both.
The baseline accepted the stale event and its terminal predicate remained false.
The repaired helper refused the event, established absence, retained unknown
exits and wrote a failed closure. The raw record remained byte-identical.

Run the focused checks with:

```sh
python3 bend2/test/hierarchy-observer.py -v
python3 bend2/test/hierarchy-diagnostics.py -v
```

The observer fixtures exercise interrupted-record closure, a surviving child,
failed inspection, changed and unavailable start identities, stale and active
tool events, incomplete success receipts, and ordinary native-wrapper completion
using a controlled Python child. A separate live seat leaves an absent DeepSeek
observable as absent. A command that mentions the output directory remains
unowned until a recorded identity or observed descendant establishes ownership.
Recorded seed and worker launchers prevent closure while present. Inspection
failure uses the captured result of
a real failing subprocess. These fixtures run without provider sessions or a
coordinator build. `check-native.sh` includes them through its existing Python
test-file selection.

## Boundaries

Process observations are snapshots. `ps` supplies start identities at its displayed
time resolution. The constructed records exercise observer decisions; they do
not reproduce the provider broker's process termination. The retained real run
remains failed. Its frozen driver, raw native records and missing exits are
unchanged. Worker recruitment and background native process custody require
separate qualification.
