# Native recovery qualification, 2026-10-02

Three separately frozen real-model runs passed on coordinator source
`7c32ff45edc3c0d23f4317745115f01617fa98ad`, tree
`8348b5f7ef178464935f4b55d7ae395698104292`. The native binary SHA256 was
`e9374848831ccdb233839215c84ab6d1f1ee84a39a8fd2a601d2758f55987da8`.
The recorded build compiled the imported operative laws with Bend 2.0.25.
Final source publication requires its own exact-tree build, negative controls
and native checks.

| Run | Observed result | Boundary |
| --- | --- | --- |
| Retained Codex receive | Killed receive observer; original native child survived; retry returned `queued`; pending follow-up resumed the same conversation after the first child exited. | Keeper and retained attempt survived; deterministic local parent endpoint. |
| Manual Codex direct turn | Killed owned coordinator and native process tree; explicit resume kept the recorded conversation and finished the task. | Six captured initial processes; journal absent before interruption. |
| Manual OMP direct turn | Killed owned coordinator and native process tree; recorded conversation was unavailable; recovery diagnostic and fresh conversation completed the task. | Three captured initial processes; journal absent before interruption. |

## Runtime and preparation

Codex used the standalone 0.154.0 executable with requested `gpt-6-astra` and
low effort. Both the login preflight and each launch forced the ChatGPT
subscription method and removed API-key environment variables. The actual
preflight reported `Logged in using ChatGPT`. OMP used 17.4.0 with
`deepseek/deepseek-flash` and low effort; its native state confirmed those fields.
Codex CLI output did not expose an observed model field.

The retained receive driver previously called the obsolete `worker` command.
That attempt on `08e6bf38` exited before any native launch. Its original failure,
empty timeline and frozen records remain retained. The repair creates a detached
seed, calls public `recruit` for an unused branch and workspace, validates the
returned assignment and runs against that actual workspace. Its complete
controlled entrypoint test passed before this real run. Repeated `thread.started`
frames are recorded separately from actual launches.

Recovery driver preparation also removed exercised elapsed work cutoffs and
diagnostic truncation. Twelve controlled driver checks and 28 existing receive
checks passed in the preparation lane. The production Bend sources and native
build script remained byte-identical to published `dd1de109` throughout these
qualification and document changes.

## Retained receive result

`accept-receive-recovery.py` stopped the actual inner Bend observer, PID 9260,
at Codex's first tool checkpoint. Its captured wait status was `-9`. Native PID
9262 remained alive under keeper PID 9261. A normal receive retry returned
`{"session":"worker","status":"queued"}` with one recorded native launch.
The outer Python qualification driver remained alive.

After the first native process exited, the pending follow-up launched PID 9758
with the same conversation, `01a0fd20-82c6-7862-8b39-56e1634bd186`. Exactly two
native launches completed two turns. Each full final assistant response matched
its stored parent report and the parent endpoint's received body. Both task
messages and both reports had receipts; both inboxes were empty. Output
continued after observer loss. The driver completed naturally with exit zero.

Codex created and extended the [receive usage example](../receive-recovery-example.md)
in commits `748880b6e065634256713f51f4a2c2bb63d564a3` and
`5c7ef53db24075cf8feb60998f2957606f8ba0af`. The clean worker changed only that
document. Root reviewed the commands and recovery claims against the real
parser, receive, turn and process code, retained the native branch, and imported
both commits as `712f6a44` and `5f3db06e`. The document bytes match SHA256
`9b62229dd1fa22cfc32a3593dbc0d655497cbc455d88ec28940dc449179284e7`.
The two initial source-discovery command failures and a nonterminal session-hook
warning remain in the logs; Codex corrected discovery without operator help.

This run exercised observer loss with the keeper, control endpoint and retained
attempt available. The local parent was a controlled acknowledgment process.
Keeper loss, host restart, checked landing and remote publication remain separate
boundaries.

## Direct-turn results

The real-model probe ran each selected harness separately. It stopped and killed
only its owned initial process tree after a native identity was recorded, waited
for the coordinator's `-9` exit and captured PID absence, then explicitly resumed
that identity. These trials used an isolated three-line journal task.

Codex resumed `01a0fd24-b2a1-7d03-9d2c-5df3fd7c8c82`. Actual resume argv,
native `thread.started`, recorded state and native `turn.completed` agreed.
The resumed coordinator exited zero and wrote the three expected lines exactly
once, in order, with no other worktree change.

OMP requested `01a0fd26-370f-7000-8829-8d70d8295340`. Native stderr reported
the session was unavailable. Baton2 recorded `ompsession-turn-1:recovery`,
launched again with no resume argument and recorded fresh identity
`01a0fd26-3e19-7000-9f02-42cd499ecf75`. The fallback supplied the pending task
and current Git workspace status. It reached native `agent_end`, coordinator
exit zero and the exact three journal lines. The direct probe retained the parent
diagnostic; it did not serve or acknowledge a native parent endpoint.

Both journals were absent before interruption. These runs establish initialized
conversation recovery and task completion. Preservation of a partially edited
file was not exercised. Explicit direct-turn resume, retained observer recovery
and host restart have separate acceptance boundaries.

## Measurement and closure

| Run | Native launches | Outer driver seconds | Emitted usage |
| --- | ---: | ---: | --- |
| Retained Codex | 2 | 183.170364 | Final cumulative 616,681 input and 2,601 output tokens. |
| Direct Codex | 2 | 19.722637 | Final cumulative 54,146 input and 169 output tokens. |
| Direct OMP | 3 | 9.198259 | Four completed assistant messages: 106,335 total tokens. |

Codex cumulative snapshots are selected once per native identity. The separately
derived input-plus-output counts are 619,282 and 54,315; the CLI omitted explicit
`total_tokens`. Cache and reasoning counts are retained separately. No private
Codex rollout was read or copied for these measurements.

OMP counts each fresh-session assistant `message_end` once. The interrupted
initial turn and refused resume emitted no completed assistant usage record;
their usage remains unknown. Three of four completed messages exposed reasoning
counts, totaling 126. Emitted `cost.total` summed to `0.001443660`; currency and
actual billing are unverified. Codex model observations and cost were absent.
These elapsed times describe different tasks and failure scopes and establish
no comparative speed or cost result.

All three outer drivers completed with exit zero. Root recorded absence of 13,
10 and eight captured PIDs respectively and no run-associated process paths;
independent review confirmed closure. Individual native wait statuses and exact
native end times were not captured. PID absence does not supply those values.

[Summary](summary.json), [retained receive metadata](retained-summary.json),
[direct Codex metadata](direct-codex-summary.json), [direct OMP metadata](direct-omp-summary.json)
and the [artifact manifest](artifact-manifest.json) retain source, executable,
build, freeze, native identity, counters, receipt and closure pins. Raw private
logs and prompts remain in the retained checkout. Later documentation imports
retain `7c32ff45` as the measured source.
