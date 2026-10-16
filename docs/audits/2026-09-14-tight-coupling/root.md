# root — auditing declared tight coupling on real work (swarm tight-271)

Author: the root orchestrator (Claude Fable 5.1), 2026-09-14 from 05:36Z. Companion: `lead.md` by the
swarm's lead, written from inside, when the lead publishes it. The swarm delivers issue #271
(guidance, refusal and workspace projections on `swarm.view`) under the coupling records the
coupling-263 lane landed hours earlier; this report says what the outside saw of those records, and
what the outside had to do when the inside stopped.

## 0. Setup

- Resident at master `53031f16` served from a fresh clone (`/private/tmp/baton-master-20260914`,
  deployment `/tmp/baton-master-deployment-20260914`); its repository identity is distinct from the
  main checkout's because identity is the git common dir path. The named wait for stop
  non-convergence (#265 item 1) is in this resident.
- Swarm `tight-271`: lead (GLM `zai/glm-5.3-flash`; recruit, organize, review, communicate,
  contribute) recruited `projections` (GLM, unit W1) and `surface` (DeepSeek `deepseek-flash`, unit
  W2, `shareWorkspaceWith: projections`). W2 `dependsOn` W1.
- Root instruments: the wake feed (`swarm watch --follow` filtered to swarm rows), a
  coordination-log tail filtered to the swarm's coupling and refusal rows, a 60 s pull journal of
  the view plus each worker log's activity counters (123 rows by 07:41Z), and the workers' logs.

## 1. Timeline as the outside saw it (UTC)

| ts | row | note |
|---|---|---|
| 05:36:14 | recruit lead | CLI; receipt `{participantId, runId, swarmId}` only |
| 05:43:48 | `work_updated W1-projections` | |
| 05:43:52 | `work_updated W2-surface` with `dependsOn: [{workId: W1-projections}]` | the wake said only `swarm.work_updated`; the dependency is in the row, not the wake |
| 05:44:52 → :53.8 | recruit `projections` | bound in 1.2 s at load ~5 (the earlier audit's 8–9 s was load) |
| 05:46:34 → :34.3 | recruit `surface`, `shareWorkspaceWith: projections` | bound in 137 ms: no new checkout |
| 05:46:56.8 | `group_updated impl` | |
| 05:46:56.9 → :57.0 | `coupling_updated` ×3: `sync-gate` (synchronization), `writer-checkout` (writer `projections`), `policy-impl` (failure `independent`) | four organization records in 250 ms; each wake named only `swarm.coupling_updated` |
| 05:47:28.1 / :28.2 | guide → projections ("cleared to edit NOW"), guide → surface ("dependency UNSETTLED: wait for my handover; read-only exploration allowed") | delivered as `control.nudge` in each worker's log within the same millisecond as the row |
| 05:54:32 | lead: `eval` tool call requested | **no further lead event for 105 minutes** (§3) |
| 05:55:53 | `surface` turn `paused` | the dependent worker waits by pausing |
| 06:31:35 | `contribution_recorded contribution-projections-1` (W1) | 47 min after cleared; body names files, the suite verdict in its checkout, the verbatim `couplings` and `waitsOn` rows |
| 06:31:42 | `coupling_updated sync-gate arrive` (projections) | arrival is the worker's own act; `projections` turn `paused` |
| 06:31 → 07:27 | nothing | the lead never reviewed; the swarm view said `lead: working/running` throughout |
| 07:27:57 | root: `swarm capture` → `contribution_revision_attached` (checkpoint `cf199d30`) | root takes over the lead's review |
| 07:34:40 | root: `contribution_reviewed accept` (reviewerId `null`) | after validating the checkpoint on master+audit in a landing worktree (11 swarm/custody files GREEN) |
| 07:34:40 | root: `writer-checkout release` (releasedBy `null`) | |
| 07:34:41 | root: guide → surface | `result: nudged`, `guide: null`; `surface` turn `running` within 50 s |
| 07:35:17 | root: `writer-checkout declare` (writer `surface`) | a second declare on an existing coupling id is admitted; the record's arrivals are unaffected because a writer record keeps none |
| 07:39:41 | lead: the `eval` call completes `ok: true` | 8 s after the root killed the bridge client process the call was waiting on (§3) |
| 07:44:12 | lead: guide → surface | the lead, back from its stall, guides on its own (it never saw the root's guide: a guide to a running participant lands at the next boundary) |
| 07:56:52 | lead: `contribution_reviewed comment` on W1: "Check run-suite-lead-1: failed for cf199d30; cleanup closed" | the lead ran its own `swarm.check`; the clone sandbox is RED for environment (§4.1), so the check fails and the lead records a comment, not a reject — then reads the root's accept and moves on |
| 07:57:48 → :49 | lead: `writer-checkout release` ("W1 accepted (root landing GREEN); handing the checkout to surface"); `writer-checkout-2 declare` (writer `surface`) | the lead minted a NEW coupling id rather than re-declaring the released one the root had already re-declared: two writer records now name `surface` |
| 08:01:37 | `sync-gate arrive` (surface) | `arrivals: [projections, surface]`, `arrived: true` — derived, not asserted |
| 08:02:06 | `contribution_recorded contribution-surface-1` (W2) | 27 min after the root's guide; body names the durable `swarm.operation_refused` row, the surface docs, 7 new tests, and the same environmental RED (33 unexpected in 13 non-swarm files) |
| 08:06:26 | root: `swarm capture` → checkpoint `7a8ed6ac` | cherry-picked onto the landing branch on one import conflict; 14 swarm/custody/bridge files GREEN (114), surface gate ok |
| 08:09:02 → :07 | root: `contribution_reviewed accept` (W2); `work_updated` W1, W2 `completed` with `basis.contributionIds`; `sync-gate release`; `writer-checkout-2 release` | all with `null` attribution (§2) |
| 08:09:08 | root: guide → lead (write `lead.md`) | `message.sent nudge from web:local-owner:…`: a guide to a RUNNING participant records a receipt; the paused case (07:34) did not |
| pending | the lead's `lead.md`; the three stops with the named wait | §5 |

## 2. What the coupling records did and did not do

- **Declared, durable, fast.** Four records in 250 ms; every later reader (the root's journal, the
  workers' views, the contribution body that quoted them verbatim) saw the same rows. The
  dependency row on W2 made "W2 waits on W1" a checkable fact: the `waitsOn` projection said
  `settled: false, evidence: []` until the root's accept.
- **The wake said which kind, not which record.** Every organization wake carried
  `swarm.coupling_updated` and nothing else; which point, which holder, which policy was in the
  coordination row only. Same gap as #272 for organization rows.
- **The writer record could not name the checkout it covered.** A participant's checkout carries no
  recorded workspace id before its first capture, so the lead's declare named `projections` with
  `workspaceId: null` — the guard swarm-b's lead later found inert for exactly this reason (audit
  #292). The root's re-declare after the handover still carries `null`.
- **Informing, not fencing.** The lead fenced by guide ("wait for my handover"); the worker fenced
  itself by pausing. The record told the root the intent; the guide told the worker; the pause told
  everyone. When the lead stopped, the fence held (surface stayed paused for 100 minutes) and only
  a guide could lift it — which is the right behaviour and also why the swarm stalled.
- **Arrival was honest and unattributed to time.** `sync-gate.arrivals: ["projections"]` after the
  worker's own arrive; no timestamp on the arrival (audit #292).
- **The root's acts have no name.** The accept landed with `reviewerId: null`, the release with
  `releasedBy: null`: the root has no participant row (task #20), so the two most consequential
  records of the run are attributed to nobody. Swarm-b's lead found the mirror case (an organizer's
  release attributed to the worker); the shape is one fact: `releasedBy`/`reviewerId` must be the
  actor, and the root must be a visible actor.

## 3. The lead stopped, and nothing said so

The lead requested an `eval` tool call at 05:54:32Z and emitted nothing for 105 minutes. The swarm
view said `state: working, turn: running` for the whole span; the stall detector re-armed on
`turnInFlight` every cycle (giants G-16); no attention row existed; the contribution the lead was
recruited to review sat unreviewed for 56 minutes before the root noticed by reading the worker log
by hand. Baton records only the tool name for a native call, so the root could not see what the
call was doing. The process tree could: `omp --mode rpc` (the lead) → `omp __omp_worker_js_eval_process`
→ `omp impl/src/swarm-native-bridge.mjs swarm.view {}` — a native bridge call to the resident,
alive for 1h44m with its socket open and no response, while the resident answered every other
caller. The bridge client has no request bound tied to the resident's liveness. The root sent the
bridge client SIGTERM at 07:39:33Z; the lead's `eval` completed `ok: true` eight seconds later and
the lead resumed (bash, grep, read calls from 07:40:03Z).

Three findings, filed: the in-flight tool call with no bound and no attention row (#265, #291); the
bridge client with no liveness-derived request bound and the server's silence on an unanswerable
request (#292); and the `eval` tool reporting `ok: true` for a call whose child was killed under it
(#291, evidence by observation).

## 4. Frictions the root paid for, in order

1. **A worker's suite verdict is machine-local** (audit R-1). `projections` reported 25 unexpected
   failures in its checkout and attributed them to the clone's missing credential file; the root's
   probe showed the credential rows are already expected-red and unaffected by the key, so the
   attribution was unproven. The clone-hosted `swarm.check` of the sibling `flaky-257` contribution
   was RED at the base too (`baseExit: 1`). Validation therefore moved to the root's machine: a
   landing worktree on master, cherry-pick of the checkpoint, the affected files and then the full
   verdict. `swarm.check` in this deployment cannot currently produce an honest verdict (#284).
2. **A long check over the CLI is reported as a network fault** (audit R-5): `cli_transport_failed:
   Baton Web connection failed; check your network and retry` on a Unix socket while the check kept
   running in the resident; the result landed as `contribution.checked` in the worker log two
   minutes later and never on the view (`checks: null`). #288.
3. **A guide to a paused participant records no receipt**: `swarm.guide` returned
   `result: nudged, guide: null` — the row W1 added is `null` for the most common case, because the
   paused path (`nudgeTurn`) writes no `message.sent` (reported by `projections`; #273).
4. **The CLI's `swarm update` takes the event kind positionally**; `--event` is refused as
   `cli_invalid: unexpected argument swarm.contribution_reviewed`, with no hint of the shape
   (audit U-F… family, #288). The coupling declare payload names the holder as `participantId`, not
   `writer`; the wrong key was silently ignored and the declare did not land — the root learned it
   from the view, not from a refusal (#283's `updates`/field naming).
5. **Every mutation returns the whole view**; the `swarm stop` of an audit participant returned
   237 KB. The root pipes everything through `jq` (#283 S-F2).
6. **Hand-tailed evidence.** The root's knowledge of the lead's hang, the check result and the
   bridge-call chain came from the worker log file, the process table and `lsof`, none of which a
   participant or an MCP client can reach. #294 (native wake delivery) is the operator's question
   answered: the feeds are native; the filtering, the deployment scope and the push path are not.

## 5. Stops, and what the named wait said

The sibling swarm on the same resident gave the first sample before `tight-271`'s own stops: the
root stopped `flaky-257`'s worker at 07:44:14Z after capturing its contribution. `kill.requested`
→ `lifecycle.process_closed` (code 0) → `kill.confirmed` in 300 ms; `worktree.progress_checkpointed`
3 s later; then, 90 s after the request, `control.stop_waiting_on`
`{waiting: [disposition, local_resources:localAuthority, local_resources:worktree,
local_resources:cleanupPending], status: dead, processState: closed}` and
`swarm.operation_unavailable code=coordinator_run_stop_incomplete`. The CLI had already answered
`cli_command_pending: Baton Web command remains admitted` at 32 s. Eleven minutes later the
worker's checkout still existed (122 MB) and its log had no further event: the cleanup was not
slow, it was abandoned when the stop gave up, and the dead worker keeps its local-resource holds
until a drain or a restart. The named wait (#265 item 1) named exactly this; the deadline that
abandons the cleanup is the defect (#265 item 3, #277). Recorded on #265.

The lead published `lead.md` at 08:13:31Z, four minutes after the root's guide (captured as
checkpoint `3d0c7a2e`, landed beside this file). The three stops at 08:30:23–27Z:

| participant | checkout | stop |
|---|---|---|
| `projections` | owner of the shared checkout, `surface` still holding it | converged in 3 s (`swarm.operation_completed`) |
| `surface` | non-owner of the shared checkout | converged in 1 s |
| `lead` | owner of its own checkout | `kill.confirmed` in 0.15 s, `worktree.progress_checkpointed` at +1 s, then `control.stop_waiting_on {disposition: null, waiting: [disposition, local_resources:localAuthority, local_resources:worktree, local_resources:cleanupPending]}` at 90 s and `coordinator_run_stop_incomplete`; the checkout is still on disk |

With the `flaky-257` sample and the `audit-a` stops on the other resident, the pattern is one
sentence: **a participant that owns its checkout never converges on stop; one that shares
another's converges in seconds.** Not load, not the git buffer (the status scan of the leaked
checkout is 46 bytes; its node_modules is the projected seven-entry toolchain). The cleanup of an
owned checkout either never starts or dies inside a swallowed catch, and `disposition: null` says
the stop never assigned a disposition to a dead worker with holds. The named wait made the pattern
legible in three lines per stop; the reproduction for the lane is "stop the sole owner of a
checkout; assert the checkout is gone and the stop converged", which fails today on both residents
(#265, #277). All three checkouts (`ws-5151…` lead, `ws-b833…` shared, `ws-2c2f…` flaky) remain
after the swarm closed; whether the resident's restart reconciles them is recorded in the
landing notes on #265.

## 6. What the coupling exercise returned

Issue #271 landed in two contributions under the declared records (`859df32c`, `abeae56a`): the
view now carries guidance rows, guide receipts, workspace custody and seq/ts on every row, and a
refused mutation is a durable, wake-capable `swarm.operation_refused` row — the runtime can now
show a lead what this audit had to read from the ledger file. Of the seventeen audit issues, six
gained live evidence from this swarm (#265, #273, #277, #284, #288, #292), and two were confirmed
by a worker's report before the root read the code (#273's paused-guide receipt, #284's
machine-local verdict). The root reviewed both contributions, completed both work items, released
the gate and the writer, and stopped the swarm — every one of those records unattributed, which is
the one line of this report the runtime should make impossible to write again.
