# Native root, lead and worker run

The run at source `93b8b2f48cbbe3890178f1808e337b914e472b26` used a real
Codex root to recruit an OMP lead. The lead recruited two OMP workers,
guided the first during its task, reviewed and landed both worker branches,
and reported to the root. The root reviewed and landed the lead branch.

The repository was a shared-object scratch clone inside the assigned checkout.
The workers implemented two standalone Python text-summary utilities there:
a whitespace-token word counter and a logical-line counter, with their tests.
Those demonstration files remain in the scratch clone. The Bend2 contribution
contains the session-delivery support, its tests, the reusable run driver and
documentation.

## Implementation

The existing session record already supports parent links and nested
recruitment. Committed messages now invoke a registered recipient endpoint
at any level of that hierarchy. The OMP adapter accepts `--session ID` and
attaches through `connect` for a recruited session, retaining its parent,
workspace, branch and base. It reads that session's inbox, supplies commands
naming that session, binds its observed native ID and resumes it on later reports.

The adapter starts the lead in its recorded workspace using its recorded
model and effort, subject to the adapter's existing environment overrides.
After OMP exits, the adapter submits its final assistant text and native exit
outcome through the coordinator's existing observation path. The coordinator
saves the lead's report and invokes its parent's endpoint. Native failures
also reach the parent; unacknowledged input remains available.

The run uses one foreground turn per native session. The lead starts its
workers sequentially in background supervisors and ends each turn to receive
the next report. Both workers were recruited before the first started. This
run establishes the three-level workflow under that scheduling; concurrent
turns in one native session were not exercised.

## Native identities and delivery

| Session | Parent | Harness and model | Native session |
| --- | --- | --- | --- |
| root | none | Codex, requested `gpt-6-astra` | `01a0e360-30f1-7812-b926-4a4adf8524ae` |
| lead | root | OMP, observed `deepseek/deepseek-flash` | `01a0e360-b1e4-7000-b4be-c95716954c86` |
| child-a | lead | OMP, observed `deepseek/deepseek-flash` | `01a0e361-119f-7000-9183-156def8daed4` |
| child-b | lead | OMP, observed `deepseek/deepseek-flash` | `01a0e362-87e2-7000-a725-f080980fed6f` |

OMP's requested effort was `low`. Codex's native event stream supplied its
session ID but no observed model; its invocation records the requested model.
The root had four native invocations and the lead had three, each resuming its
recorded session. The two workers each had one invocation. All exited 0.

The lead sent guidance `token-rule`, requiring `str.split()` and a regression
where `blue-green` counts as one token. In child A's retained event stream,
the first `tool_execution_start` is at zero-based event index 11, successful
native steer acceptance at 45, and the terminal event at 244. The stored
receipt is:

```json
{"id":"token-rule","type":"response","command":"steer","success":true}
```

Child A implemented that behavior and test. Reports `child-a-turn` and
`child-b-turn` invoked the lead adapter and received the lead's review receipts.
The lead's reports `omp:lead:2`, `omp:lead:5` and `omp:lead:7` invoked the Codex
root and received its review receipts. The last report carried `LEAD_READY`.
The inspecting agent sent no continuation message during this run.

The initial `lead-task` message remained unacknowledged. This is retained in
the evidence, and the reusable task now explicitly names its acknowledgment
command. The final `hierarchy-complete` report remains in the operator inbox.
The adapters do not manufacture acknowledgments for either message.

## Review and landings

| Change | Worker commit | Checked landing |
| --- | --- | --- |
| Word counter | `d84c9231862592bf9701792eb2e142538139a114` | `71d581de855c2fc5347486d7e260e952b4b4f49c` on `hierarchy-lead` |
| Line counter | `f2a70b32c4c418431ea6a279a0883f3e2ab76686` | `4b30ef2b42d52a631688efc27756e989b2002e99` on `hierarchy-lead` |
| Composed lead branch | `4b30ef2b42d52a631688efc27756e989b2002e99` | `f85a50da917111b67c14bdca957d2139f8ccf59c` on `hierarchy-target` |

The lead detached its workspace before advancing its branch. It reviewed
each child's actual diff and selected tests before landing. The root reviewed
the parent bindings, worktree states, guidance receipt, both worker reports
and the composed diff before its own checked landing.

Each landing ran the selected Python test files through `check-added.sh`.
The adapter explicitly succeeds when a newly added test is absent on the
target; every present test must run and pass. The word counter has nine tests
and the line counter has five. The root ran both on the final landed tree.

The lead and final target trees both equal
`a2b1a482aa81a61e8acfa72c1fcb703f9c9ce360`. The root's final operator report
names those trees and the successful checks. Inspection independently read
the Git objects, message recipients and receipts, native process exits and
guidance event order. No remote ref was pushed.

## Verification and artifacts

The two new adapter tests failed on the prior source because it could not
attach a named lead. With the implementation, this focused command passed
all 33 tests:

```sh
python3 -m unittest bend2.test.omp-root bend2.test.codex-root bend2.test.turn
```

It covers nested delivery, session and workspace preservation, resumption,
failure reporting, existing root behavior and worker supervision. The final
follow-up records the native exit code in a failed lead's report and names
session delivery in its diagnostic. The failed-lead test checks exit 23.

The real run command was:

```sh
python3 bend2/scripts/accept-hierarchy.py \
  --config .scratch/bend2/architect16-hierarchy/config.json \
  --output .scratch/bend2/architect16-hierarchy/run-1
```

That directory retains `evidence.json`, `state.db`, `root-report.md`, task files,
the scratch clone and worktrees, supervisor output, and per-invocation
`*.native.jsonl` and `*.process.json` files. Existing local launch wrappers
kept native state inside the assigned checkout and used existing logins.
No live trial file or process was changed. No toolchain was installed.
The generic deployment verification command and the whole JS suite were not run.
