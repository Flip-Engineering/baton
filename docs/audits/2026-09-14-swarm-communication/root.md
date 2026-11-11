# root — auditing a suborchestrated swarm's bidirectional communication from outside

Author: the root orchestrator (a Claude Code session driving the resident through the CLI, the
MCP bridge, and the coordination log), 2026-09-14 04:33Z–04:56Z. Companion reports by the swarm
itself: `suborchestrator.md`, `probe-see.md`, `probe-say.md` (with their evidence directories).
The swarm's reports were written from inside and are quoted, not paraphrased; this report says what
the outside saw, where the two views disagree, and what each disagreement means for the harness.
Agentic experience — what an agent has to know, guess, or read logs for — is the first-class lens.

## 0. Setup

- Resident: `baton serve` over `/private/tmp/baton-resident-20260914` (a linked worktree of the
  main repository at `dd81a14a`; deployment root `/tmp/baton-resident-deployment-20260914`;
  verification = `node impl/scripts/run-suite.mjs`). The resident ran the code of `dd81a14a`, so
  the named wait for stop non-convergence (`af6fc036`, landed later on master) was not in it.
- Swarm `audit-comm`, created and recruited through the CLI: `suborchestrator`
  (GLM, `read communicate contribute review organize recruit`) with an objective that told it to
  recruit two probes itself and coordinate only through the swarm. It recruited `probe-see`
  (DeepSeek) and `probe-say` (GLM) through its participant bridge.
- Root-side instruments, all started before the first recruit: `baton swarm watch audit-comm
  --follow` (the wake feed, one line per wake); a `tail -F` of
  `state/coordination/events.jsonl` filtered to this swarm, guides, messages and refusals; a 60 s
  journal of `swarm view` plus each worker log's activity counters; the resident's own log.
- Two other swarms (`coupling-263`, `dangling-260`) were working on the same resident throughout,
  each with its own wake feed. Their presence matters for §6.

## 1. Timeline as the outside saw it

| ts (UTC) | channel | what the outside saw |
|---|---|---|
| 04:33:37 | CLI | `swarm create audit-comm` (view echoed, 2 KB) |
| 04:33:46 | CLI | `swarm recruit suborchestrator` → `{participantId, runId, swarmId}` |
| 04:34:56–04:35:05 | coordination log, wake feed | `swarm.operation_requested swarm.recruit` → `participant_joined probe-see` → goal/plan/task rows → `participant_bound` → `operation_completed`; 8.2 s request to binding. The first wake carried an `operation_unconfirmed` attention row holding the probe's **entire objective text** |
| 04:35:15–04:35:24 | same | `probe-say` recruited the same way, 8.4 s |
| 04:36:01–04:36:04 | same | `work_updated` ×2, `assignment_updated` ×2, `context_updated` (protocol note): five wakes, each within 1 s of the row |
| 04:36:16 | same | `context_updated` — the wake said only `swarm.context_updated`; that it was probe-see's `"guide me"` note was visible only by re-reading the view |
| 04:37:10 | coordination log | probe-see `swarm.guide` **to its parent**: recorded as `message.sent` kind `nudge` from `swarm-native:audit-comm:probe-see` to worker `w-3`; the wake feed reported it as `driver.recorded / swarm.operation_requested` with the message text inside the attention row |
| 04:37:25.835 | worker log `w-4` | the suborchestrator's reply guide arrived as `control.nudge` — 4 ms **before** its coordination row (`message.sent` at 04:37:25.839): the frame is pushed, then the ledger is written |
| 04:39:04 | MCP bridge | root `baton_swarm_guide` with `idempotencyKey` → `{"ok":false,"error":{"code":"invalid_arguments"}}`, nothing else |
| 04:39:35 | MCP bridge | root `baton_swarm_guide` without the key → `{"code":"forbidden"}`; `baton_swarm_capture`, `baton_swarm_view`, `baton_swarm_list` → the same bare `forbidden` |
| 04:40:39 → 04:41:48 | wake feed | probe-see `contribution_recorded` → suborchestrator `contribution_reviewed accept` (69 s) |
| 04:40:49 | CLI | root `swarm capture coupling-263 …` succeeded in 2 s (the same verb the bridge refused) |
| 04:42:10, 04:42:33 | wake feed | probe-say contributed twice (the first without `workId`), reviewed 04:43:04 and 04:43:24 |
| 04:42:28 → 04:42:30.620 | CLI, worker log `w-4` | root guide sent through the CLI; delivered as `control.nudge` 2.3 s later; the coordination row names the sender `web:local-owner:<session>` |
| 04:47:00 → 04:47:10 | wake feed | suborchestrator `contribution_recorded`, then **captured and checked its own contribution** (`contribution.captured` by `swarm-native:audit-comm:suborchestrator`, `contribution.check_started`): a full-suite verification for a docs-only change |
| 04:52:28 → 04:53:01 | CLI | root `swarm stop probe-see` → after 33 s `cli_command_pending: Baton Web command remains admitted` |
| 04:52:31.4 → 04:52:31.6 | worker log `w-4` | `kill.requested` → `lifecycle.process_closed` (code 143, 136 ms) → `kill.confirmed` (29 ms later) → a text `content.message` **4 s after the process closed** → `worktree.progress_checkpointed` |
| 04:53:01 → 04:53:23 | CLI | root `swarm stop probe-say` → after 22 s `cli_transport_failed: Baton Web connection failed; check your network and retry` (a Unix socket on the same machine; the resident had recorded the request at 04:53:05) |
| 04:54:01, 04:54:35 | coordination log | both stops ended `swarm.operation_unavailable coordinator_run_stop_incomplete`; the view kept two `operation_unconfirmed` rows (`state: unconfirmed`, code named) plus `participant_runtime_dead` for each probe |
| 04:55:33 | wake feed | the self-check came back `failed` (the root had killed its process group, §6) |

## 2. Push versus pull: what the wake feed knew and what it did not

The feed fired on every swarm-level row and on much else; the count over the audit was dominated
by `evidence.mapped / content.message` and `lifecycle.process_ready` wakes — a participant's
`agent_start` notices and OMP UI notifications woke the root as often as the swarm's own events.
Three properties of the feed shaped what the root could do without reading state:

- **A wake names the row, not the fact.** `swarm.context_updated` never said which key changed or
  who wrote it; `swarm.contribution_recorded` never said whose. The suborchestrator diffed whole
  views after every wake for the same reason (its §5). The outside had the coordination log tail to
  fill the gap; a participant does not.
- **A guide is two wakes and a leak.** Every `swarm.guide` and `swarm.recruit` produced a wake on
  `operation_requested` and another on `operation_completed`. The first carried an
  `operation_unconfirmed` attention row containing the **full request** — guide bodies, recruit
  objectives, idempotency keys — visible to every watcher of the swarm, including third-party
  participants (probe-see's finding, confirmed from outside at 04:34:56, 04:37:09, 04:37:25,
  04:37:36, 04:39:04, 04:40:00, 04:42:30, 04:52:30). The semantic row (`message.sent nudge`) never
  woke anything.
- **The feed had no notion of the root.** The root's own guide (04:42:30) surfaced to the feed the
  same way as any participant's; nothing distinguishes the orchestrator's voice, and the swarm's
  reports confirm the root is invisible to participants except as a phrase in a brief.

The 60 s pull journal saw nothing the feed had not already delivered, at a cost of one 30–60 KB
view per minute. Pull added exactly one thing: the participants' **activity** (event counts, last
event kind, token totals) — which lives only in worker logs (#268), so it was read from files.

## 3. The MCP surface, which is supposed to be the primary agentic surface

The resident-attached MCP bridge (`baton-mcp-web`, discovered through the same connection the
CLI uses) advertised 72 tools, the ten `baton_swarm_*` tools among them, and refused **every**
tool call — read-only `list` and `view` included — with a bare `{"code":"forbidden"}`.
`initialize` took ~1 s and `tools/list` 6 ms; the calls themselves ~30 ms; the refusals were fast
and empty.

Cause, found with a direct facade probe: the principal was the local owner with `observe`,
`control`, `approve`, … but `BatonWebApplicationFacade.command()` forwarded only a hand-kept
`ORDINARY_COMMANDS` list (41 `run.*`/`waves.*` verbs) although #227's comment in the same file
names the resident's wire card as the authority and the live card advertised 86 commands including
every `swarm.*`. Everything advertised but not on the list — the whole swarm family — was refused
`application_unauthorized`, flattened to `forbidden` on the wire with its message dropped. The
surface gate did not catch it because its dispatch probe runs the in-process server, not the
bridge.

Two further agentic-interface defects on the same path:

- `invalid_arguments` named neither field nor rule. The bound bridge derives `idempotencyKey`
  and `repoId` itself and refuses them when supplied; the CLI's usage text says the key is
  "accepted globally when the verb is effectful". The tool schema (fetched afterwards) was the
  only way to learn which field was wrong.
- `cli_transport_failed: … check your network and retry` for a local Unix-socket call that
  the resident had in fact received and recorded (04:53:05) while under a load average above 100.
  The advice is wrong and the elapsed time, socket path and pending operation key are absent.

The fix is on `fix/mcp-bridge-surface`: the facade admits every command the wire card advertises,
refuses the rest by name with `detail.command`, bridge-composed refusals are marked wire-safe so
the northbound forwards their message and detail, a supplied bound field is refused by field name,
and a missing capability is named with `required`/`held`/`missing`. Until it lands, an agent
whose only surface is the resident MCP bridge cannot run a swarm at all.

## 4. Where inside and outside disagree

| inside (the swarm's reports) | outside (this report) | meaning |
|---|---|---|
| "Guidance has no domain existence": no sender, id, timestamp, delivery state in any view | The coordination row **has** `from`, `messageId`, `ts`, kind `nudge`; the worker log has `control.nudge` with the text | The facts exist on the ledger and are projected to nobody. `swarm.view` should show a participant's received guidance (sender, seq, ts) and `swarm.guide` should return the row it wrote |
| "Refusals emit no event" | Confirmed: no coordination row for `swarm_command_invalid`, `swarm_permission_required`, `version_conflict`, `swarm_holder_live` | A refused mutation is invisible to every watcher, including the parent who asked for it |
| "Recruit returns only ids; we learned the probe was up ~9 s later by re-reading the view" | The feed saw `participant_joined` → `participant_bound` 8–9 s apart | Bind is a real state; the recruit receipt should carry it or the feed should name it as the probe's first turn |
| "The probes wrote to different worktrees; nothing said so" | `contribution.captured` rows name `ws-…` workspaces; the swarm view does not | Workspace topology is ledger truth that the view hides |
| "Attention is `[]` almost always; one leaky row in a watch window" | The root saw the same row on every guide/recruit/stop; after the stops, `operation_unconfirmed` rows persisted with `state: unconfirmed` and the code named | Attention rows are the right idea with the wrong lifecycle: in-flight rows leak requests, terminal rows have no acknowledgement |
| Timing "cannot be reconstructed after the fact" (probe-say's watch return before the guide it reports) | The ledger orders everything by `seq` and stamps `ts`; the worker log stamps delivery | The truth exists once; the views should carry `seq` and `ts` on every row they project |

## 5. Stop: the channel that did not converge

Both probes were stopped after their contributions were accepted. Both worker logs show the
same shape, at normal speed: `kill.requested` → `lifecycle.process_closed` (exit 143, 136 ms and
434 ms) → `kill.confirmed` → a checkpoint pinned within 4–18 s. Then nothing until the resident
gave up 90 s after the request: `coordinator_run_stop_incomplete` for both. This is the third and
fourth data point for #265, with two differences from the first: neither probe had observed native
subagents, and the machine was under a load average of 100–145 (§6). The resident was running
`dd81a14a`, before the named wait landed, so the hold is again unknown; the next run of this audit
on a resident at master will name it.

Two observations that are independent of the hold:

- A `content.message` text update arrived 4 s **after** `lifecycle.process_closed` on `w-4` (and
  18 s after on `w-5`). The transport keeps delivering frames from a process that has exited; the
  coordinator's stop loop may be waiting on a turn that a dead process is still "speaking".
- The CLI's own 30 s wait (`cli_command_pending`) is shorter than the resident's 90 s stop deadline,
  so the CLI reports "remains admitted" while the resident is still trying; the operator has to
  know to `swarm view` for the outcome. The pending attention row (`state: unconfirmed`, `code:
  coordinator_run_stop_incomplete`) is where the outcome finally appeared — with no `next` action.

## 6. Verification concurrency turned a communication audit into a load test

Within ten minutes the machine ran three full-suite verifications (the coupling lane's check, the
suborchestrator's self-check of a docs-only contribution, the dangling lane's own per-file verdict)
plus the audit swarm and the root's test runs; the load average reached 145 on a suite that uses
`availableParallelism() - 1` workers per run. Every deadline-bounded test flipped (#257), the CLI
timed out against a local socket (§3), both stops missed their deadline (§5), and the root killed
two of the three suites to recover. Filed as #269: verification needs a resource-derived
concurrency authority at the deployment, a participant should not be able to check itself, and a
docs-only capture should not run the code suite.

## 7. Consolidated findings (root side; the swarm's own ten gaps stand as written)

Gaps
1. The resident MCP bridge cannot dispatch the swarm family, or anything newer than its hand-kept
   list, and says `forbidden` without a reason (§3; fix in flight).
2. MCP refusals do not name the field, the rule, or the missing capability (§3; fix in flight).
3. Guidance is projected nowhere: the ledger knows sender/id/ts, no view shows it, and the sender's
   receipt says only `ok` (§4).
4. Refused mutations leave no trace visible to a watcher (§4).
5. Wakes name rows, not facts: no actor, subject, key, or contribution id in the wake summary (§2).
6. In-flight `operation_unconfirmed` rows leak full request bodies to every reader; terminal rows
   have no acknowledgement and no `next` (§2, §5).
7. Workspace topology (who shares which checkout) is ledger truth the swarm view hides (§4).
8. Participant activity and cost are invisible on every view (#268; §2).
9. Stop does not converge after a clean process exit, now four times, twice without native
   subagents (§5; #265).
10. No verification concurrency authority; participants can check themselves; docs-only captures
    run the code suite (§6; #269).

Frictions
- The wake feed wakes on participant chatter (`content.message`, `lifecycle.process_ready`); a
  follower cannot choose wake classes.
- Two wakes per guide/recruit/stop (requested, completed) instead of one on the semantic row.
- Every successful `swarm.update` and every wake returns the whole view (~60 KB here).
- `cli_transport_failed` advises checking the network for a local socket timeout under load.
- The wire card lists each swarm command twice (canonical row and transport twin).
- The native-access guidance text still says "the permitted event kinds shown by inspect" after the
  verb became `view`.
- The recruit receipt has no bind signal; the parent polls.

Insights
- **Propagation is sub-second; everything slow is an agent turn or a full suite.** Guide → wake
  < 1 s, recruit → bind 8–9 s (process spawn), review latency 69 s (thinking), stop 90 s (deadline).
- **The ledger already holds every fact the participants said they lacked** — sender, seq, ts,
  workspace ids, refusal codes. The gap is projection, not recording. That is cheap to close and
  should be closed before any new channel is added.
- **The frame beats the ledger by milliseconds.** Guides are delivered before their rows land,
  and a dead process's frames arrive after its close. Ordering by `seq` is the only truth; every
  projected row should carry it.
- **Suborchestration worked as agency, not as plumbing.** Given the recruit permission and a
  purpose, a GLM participant recruited, organised, guided, reviewed and reported on two peers
  through the swarm alone, corrected a peer's attribution gap through the domain (derived
  completion), and produced a report the outside could diff against. The harness's job is to make
  what it could see match what the ledger knows.
