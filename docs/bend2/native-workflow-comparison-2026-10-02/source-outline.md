# Architecture comparison outline

This read-only source comparison covers original Baton `6ccb2a6daf396fb9ce050cc91476ac49791b64c9` and Bend2 `ec0e144d921ac98d9b4698923ef50f6df27db5de`. The accompanying manifest hashes the cited source files from those Git objects. The current deployment binding pins tree `bb789f7b5e9a8568ea7b543b9f49458174ccddfd` and native binary SHA256 `19f503a1bfc08f94a0f00492da1987347eae16aea99322710903dd17329b629a`.

Bend2 paths below are relative to `bend2/src`; original paths are relative to the original repository.

The common task repositories begin at `2264ebc2055a5fd756f3b505d7bd7be6b5e65e3e`. Runtime source and task source have separate identities. This outline records source responsibilities and measurement boundaries; the active native workflow's completion remains a separate result.

## Session ownership and caller authority

**Original.** `impl/src/application.mjs::_swarmRuntime` supplies application authority to `SwarmRuntime`. `impl/src/swarm-native-bridge.mjs` binds an issued worker bridge to its run, swarm and participant; the host supplies the principal. The external Codex root uses the ordinary authenticated root client. `impl/src/omp-rpc.mjs::OmpRpcCli.spawn` admits one pending/live process per adapter session key, validates the route and workspace, and connects native process lifecycle tracking. Deployment, swarm, worker and adapter responsibilities cross these module boundaries.

**Bend2.** `coordinator/commands.bend::schema` retains session identity, parent, native identity and route. `host/session-lock.bend::SessionLock.acquire_session` canonicalizes the database path and acquires the per-session lock used by both `Receive` and direct `Turn`. `coordinator/receive.bend::{available,acquired,selected}` admit pending input and create a retained attempt. `host/process-spawn.c::{br_keeper,br_waiter,br_disconnected,br_recover}` own the native process, stdin queue, output spool and observer replacement. The waiter observes exit with `WNOWAIT`; the keeper reaps the actual child. `br_command` releases the copied session lock only after native exit, and acknowledges completion after delivery/continuation settlement. `Receive.recover` attaches to the retained attempt. Recognized missing native conversation state follows the durable recovery-input continuation in `Receive.restart_pending`.

Bend2's local actor/session arguments are declared caller context. Kernel locks, process identity, filesystem persistence and SQLite execution are host assumptions. The prepared Bend2 workflow uses retained receive for root/lead and direct turns for its leaves; it cannot establish retained observer recovery for every seat. The original workflow's external Codex root is a separately launched native process; original recruited-seat Codex app-server support is a different transport boundary.

## Parent messaging, questions and reports

**Original.** `application.mjs` forwards native turn completion to `swarm-runtime.mjs::reportTurnEnd`, retaining the participant, parent and report relationships. `_reconcileTurnReportedRows` and `_reconcileReviewerLossRows` account for root attention. `_notify`'s implementation calls `coordinator.guideParticipant` and retains delivery evidence. `web-northbound.mjs` resolves automatic attention through its registered root attachment; the exposed attachment is Claude Code. The prepared external Codex root and an ended Kimi seat therefore require explicit continuation through supported clients. Each initiator, native ID and continuation is part of the measurement.

**Bend2.** `Store.apply` commits message facts before `Root.after`. `commands.bend::{message_route,message_sql}` bind ordinary routing to recorded relationships and preserve exact accepted retries. `Root.deliver` invokes the recipient's registered endpoint with the retained message ID. `Root.result` distinguishes committed storage from endpoint failure. `Turn.consume` records native identity and full terminal report bodies. `Receive.finish_pending` accounts for report delivery, further pending input and native question delivery before keeper acknowledgement. Reports/questions addressed to a stopped recipient can produce the explicit one-hop handoff implemented in `Root.handoff_sql`.

A message receipt establishes recipient acknowledgement. Actual review decisions, check outcomes and Git landing/publication require their own evidence. Native protocols and provider session stores remain external dependencies in both systems.

## Worker, check, landing and publication path

**Original.** `swarm-runtime.mjs::_integrate` resolves a recorded contribution tip and supplies deployment integration authority to `worktree.mjs::landContribution`. Its ordinary gate callback derives selected files through `selectFromRepository`, invokes `defaultIntegrationGates`, and records the selected set and verdict. Integration also runs configured/default surface regeneration. A target movement can trigger the existing rebase and affected-check selection path. `landContribution` compares the target ref, performs the configured remote push and checks the advertised tip; failed publication attempts local rollback. The original workflow uses this ordinary implementation, including its generated artifacts and selection decisions.

**Bend2.** `coordinator/recruit.bend::{recruit,register}` create a Git worktree and store its branch/base with the session. `coordinator/land.bend::{land_checked_worker,run_checked}` pass the declared check and selected files to `git/land.bend::land_checked`. The check judges target and candidate trees. `ld_judged_news` advances an accepted pair; `ld_adv_same` blocks an observed target movement with an instruction to rerun `land-checked`. `ld_update_argv` binds the exact candidate and basis to Git's compare-and-swap update. `ld_settle` preserves blocked/conflicted work. `coordinator/land.bend::push_branch` performs explicit publication separately.

The common workflow must retain both executed check sets and actual private remote advertisements. Original docs-only selection can return `no_affected_tests`. Direct Node/Python checks, whitespace checks and model-authored source/document review have distinct meanings. Git execution, check programs and remote advertisement are runtime boundaries; a local ref receipt alone does not establish publication.

## Knowledge scope and promotion

**Original.** `application.mjs::knowledgeSeed` authorizes a run-scoped content-addressed node and passes evidence admission to the coordination store. `coordination-ledger.mjs::promoteKnowledgeBatch` derives candidates and graph changes using a configured policy and observed sequence, retaining request/policy/projection receipts. `cairn-run-scorecard.mjs` exposes this promotion path when its knowledge promotion policy is configured. This source capability does not establish that the matched original deployment enables or exercises it.

**Bend2.** `coordinator/knowledge.bend::{record,read,promote}` implement explicit finding and promotion commands. `evidence_ok` requires an existing retained `message:<ID>` involving the author. `authored_visible` admits the author and immediate parent; `membership` and `promoted_visible` admit the shared scope owner, its immediate parent and subtree. `read_sql` returns the complete visible finding list with original attribution, evidence and promotion provenance. `promotion_admitted` requires the destination owner; `source_carries` binds the exact finding to the declared source. Record/promotion notices use ordinary message delivery. Agents author claims, limits and promotion decisions. Declared actor context is not a secrecy or authentication guarantee.

Knowledge is an additional Bend2 exercise in the prepared plan. It has no matched timing or feature-equivalence claim within the common original task.

## Maintenance implications to evaluate

Bend2 reuses session relationships, SQLite transactions and ordinary message delivery across reports, questions and knowledge notices. The source makes these shared dependencies inspectable through the named functions. Check selection and publication are explicit caller responsibilities. These choices support a narrower change-review path; easier maintenance remains an inference requiring actual change/review evidence.

The retained C keeper still has substantive process, descriptor, queue and recovery responsibilities. Its boundary needs runtime tests. `coordinator/main.bend` imports operative laws through `coordinator/laws.bend`; those proofs constrain the imported Bend functions and program/SQL construction. SQLite, POSIX process behavior, Git and providers remain outside that pure proof boundary.

Original Baton also supplies authenticated clients, worker credential projection, configured route admission, integration selection/regeneration and broader knowledge policy. Their implementation/configuration responsibilities must be included when comparing operation or change cost. Neither source size nor law/test counts quantify maintainability.

## What the prepared native workflow can establish

On completion, the retained run evidence can establish actual cross-harness recruitment, native identity/model observations, child overlap, Kimi-authored mid-task guidance, useful before/after subprocess behavior, reviewed contributions, checked landings and exact private publication. It can account for explicit continuation/correction actions, selected-check and regeneration work, native invocation durations, exposed native usage fields and coordinator command timings.

The one-second process samples provide observed resource usage and process ancestry; they can miss short processes and do not establish exact peak memory. Wrapper spawn/wait receipts have a different timing boundary. Native token/cost fields require their harness-specific aggregation rules. Original OMP evidence retains normalized stdout frames and a bounded stderr tail; the external Codex and task-command recordings retain full raw streams. Compare only fields actually retained in both runs.

One sequential workflow per implementation gives observed task outcomes and costs under that host/provider state. It cannot establish latency distributions, universal speedups, long-term maintenance cost, host reboot recovery or complete feature coverage. Controlled coordinator benchmarks and additional Bend2 capability exercises require separate results. A release or version decision requires the operator's own acceptance decision.
