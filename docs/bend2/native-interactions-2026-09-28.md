# Native OMP request acceptance

[Issue #641](https://github.com/Flip-Engineering/baton/issues/641) was reproduced
with installed OMP 17.4.0: an `input` request reached the retained native log,
the parent inbox stayed empty, and Bend2 had no native answer command. The
provider-free probe retained the blocked state before its own socket supplied
the answer. The native process and coordinator then exited normally.

The repair routes retained OMP child `input`, `select`, `confirm` and `editor`
requests through the registered parent's inbox. `native-reply` validates and
stores one immutable logical answer, then writes the recorded native response
to the same attempt's keeper. The keeper shares its existing input queue and
retains the sole observer. The [interface documentation](native-interactions.md)
describes response shapes, replay and completion semantics.

## Source and evidence

The real acceptance used clean source
`770057cc24cf28acd443ec9a4d6aba8220e236f8`, tree
`7915a7ef2c3e2fc713e57f6a6d9614445a35fc22`, composed onto published
`4676778a64ca1c8652f7f8c743bd007502292b30`. Bend 2.0.25 built coordinator SHA256
`6b655a0a24c9b43d0d0358e8cf8aad05a58283a01c3976a84c5252a8fac1c8ec`.
The [machine record](measurements/2026-09-28-native-interactions.json) contains
executable, driver, wrapper and extension hashes; native IDs; request and
receipt records; process identities; usage; and hashes of the retained raw
artifacts. Raw logs, SQLite state and attempt records remain under
`.scratch/issue641/real-omp-current` in the native-replies worktree named there.
The original defect evidence remains in the separately named hierarchy worktree.

## Installed OMP result

One retained native invocation passed in 12.879 seconds with requested and
observed model `deepseek/deepseek-flash`, requested effort `low`, and OMP 17.4.0.
A local `before_agent_start` extension called all four real native UI methods.
A deterministic parent endpoint answered through Bend2. DeepSeek then read the
seed file, acknowledged its task and reported the returned answers.

| Method | Native result |
| --- | --- |
| `input` | `Continue from the preserved seed file.` |
| `select` | `preserve` |
| `confirm` | `false` |
| `editor` | Two lines: `Preserve this work.` and `Keep the native answer Ω.` |

All four replies used their original native request IDs and one attempt. The
native conversation remained `01a0eaba-6a37-7000-85e7-e86761e6a13d`; observer
36569, keeper 36573 and native process 36575 completed naturally. Captured owned
descendant identities were absent after completion. The task, four questions
and report all had receipts; both inboxes were empty. The seed and worker tree
were unchanged. The parent report exactly matched the 520-byte native terminal
body, SHA256
`5b1ca53088cf771be40373498334d3a0c24d11698185a6673c68826b5ced2933`.

The duration covers the receive invocation, four question deliveries, model
work, report delivery and cleanup. Build, repository setup, recruitment and
task insertion occurred before that interval. This run used one native
invocation with four completed assistant-message usage records. Their native
counters sum to 13,447 input tokens, 765 output tokens, 40,576 cached input
tokens and 54,788 total tokens. OMP reported 87 reasoning tokens separately
and cost `0.005195556`; reasoning tokens were not added again to the total.
These are native-reported counters. Single command timings are retained in the
machine record; this run establishes no matched performance comparison.

## Controlled validation

The composed source built with its operative entry laws and passed all 27
receive tests in 40.495 seconds. These cover a parent that answers and then
waits for actual report delivery, observer loss before and after a reply,
recovery of a stored response whose first transport failed, multiline editor
text, invalid or conflicting responses, cancellation, input closure and the
unsupported root case. Existing receive recovery and missing-conversation
continuation tests passed in the same run.

The unchanged host control implementation passed six existing process tests
and six retained-control tests in 1.770 seconds. The tests exercise complete
queued frames, original observer identity, attempt binding, group signals and
exit-gated release. A compiled-host probe calls the actual native waiter and
observes the exited PID with `WNOWAIT` before keeper-style `waitpid` reaping.

Eight request proof removals and eight production mutations produced their
required failures; the baseline passed. The tested request module and law
hashes equal the real-run source. Seven preserved receive recovery proof
removals and three production mutations also produced their required failures
on the composed source. The laws constrain called Bend functions and SQL
construction. SQLite execution, socket binding, byte delivery, native PID
ownership and provider behavior remain runtime boundaries. Root composition
owns the complete final gate.

## Acceptance limits

The real run exercised an extension's `before_agent_start` requests and a
deterministic parent responder. Native-model parent judgment, spontaneous
model questions, live observer loss, checked landing and publication were
outside this run. Controlled fixtures cover observer recovery. Keeper loss and
host reboot remain outside this acceptance. Harness approval settings were
unchanged; `confirm` was an extension UI request.

`stdin-written` records complete pipe delivery. Subsequent native output
establishes continuation. Concurrent identical callers can send duplicate
frames while the write result is pending; a controlled probe observed this.
The installed OMP handler deletes a resolved request ID before resolving its
promise and ignores later responses for that ID. Transport errors can follow
partial or completed writes, so replay retains the same native ID and answer.

This implementation supports retained OMP children. An OMP root request with
no parent retains its frame and records an observation error that makes receive
fail after native exit. A native process awaiting that unanswered request may
remain waiting until explicitly stopped. Direct `turn`, Codex `exec`, Claude
and Muse native reply mappings remain unsupported.
