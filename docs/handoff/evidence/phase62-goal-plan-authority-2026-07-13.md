# Phase 62 Goal/Plan authority — evidence handoff

Phase 62 was introduced at `f4b8f46` and hardened through committed checkpoint `230db8e`. It is
canonical-green and was recursively exercised by Baton under its own mandatory Goal/Plan policy.
This phase adds no homelab or project-manager runtime integration; repository-local
project-manager material remains inspiration for Baton's self-contained causal/temporal knowledge
graph only.

## Product result

- `goal_define` creates a bounded append-only goal version; `plan_propose` creates a bounded DAG
  and exact initial allocation against that version; `plan_approve` requires a distinct principal
  and fixes one exact plan digest; `goal_plan_status` folds replay-validated durable state.
- Plan nodes bind scope, risk, definition of done, dependencies, exact harness/model/effort route
  constraints, capability/effect classes, initial budget, and a closed plan-owned verification
  contract. The coordinator derives the authoritative immutable Brief rather than accepting caller
  substitutions.
- Plan node keys use locale-independent code-unit order, DAG validation is iterative and bounded,
  and all authoritative USD inputs use checked integer nano-USD. Provider telemetry that cannot be
  represented exactly is never rounded into authority; only that dimension becomes unavailable.
- In a mandatory scope, generic task creation refuses. Plan-gated spawn atomically appends
  `plan.node_dispatched` and `task.created` before capacity, worktree/runtime, process, provider,
  tool, or capability effects. Replay checks the two-entry batch and exact linkage; changed-byte
  retries, stale approvals, route substitution, verification substitution, and torn batches fail
  closed.
- A lost command response reconciles to the original admitted task and does not create a second
  task, node reservation, worker, or spawn. Goal/Plan status removes principal/session details.
- Authenticated HTTPS and MCP expose the same four operations and plan-gated spawn authority. SSE
  advances resumable cursors across hidden events while withholding Goal/Plan state from ordinary
  observers; `goal:observe` receives the sanitized projection.
- Terminal plan work durably settles consumed, released, held, and overrun tokens, USD, wall time,
  and provider turns from bounded operational evidence; unavailable dimensions remain held.

## Validation

- Canonical `node impl/scripts/run-evidence.mjs impl/scripts/run-suite.mjs`: **1470/1470**.
- Direct authority tests cover canonical goal/plan creation, distinct approval, exact gated spawn,
  immutable authoritative Brief, and reconciliation.
- Adversarial replay tests cover restart equivalence, exact idempotency, changed-byte conflict,
  torn atomic batches, self/rejected/superseded approvals, exact route mismatches, generic create
  bypass, and verification substitution before effects.
- Authenticated web, stream, and MCP tests cover closed schemas, transport-derived identity and
  powers, idempotent lost-response replay, status sanitization, and hidden-event cursor progress.

## Recursive five-route proof

`docs/reference/evidence/phase62-goal-plan-authority-review-2026-07-13/summary.json` covers commit
`45072eb` and records `goalPlanProof.pass:true`, `lifecyclePass:true`, and `matrixPass:false`.
A distinct planner and approver fixed one mandatory five-node plan with exact low-effort routes:

- Codex CLI / `gpt-5.6-sol` started and was provider-observed exactly, but produced no accepted
  report.
- Claude Code / `claude-opus-4-6` started with the exact model and reported not logged in.
- Claude Code using the ignored owner-only project GLM credential / `glm-4.7` completed its report,
  but the concurrent run's independent verifier exited 1, so the report was not accepted.
- Grok / `grok-4.5` produced a freshly verified report.
- Grok / literal `grok-build` was requested and resolved literally, but the provider observed
  `grok-4.5`; Baton rejected the exact-model mismatch.

Every node has exact Goal/Plan binding, authoritative Brief equality, status linkage, and one
two-entry dispatch/task batch. Both Grok process groups were sampled alive concurrently. All five
provider processes started; every started generation closed exactly, every requested kill was
confirmed, no reap remained uncertain, every leader/group exited, and worktree/runtime/branch/
writer/capacity/target/evidence-root ownership returned to zero. The lifecycle and mandatory-plan
proof is therefore green without relabeling the report/provider matrix.

The focused
`docs/reference/evidence/phase62-goal-plan-codex-retry-2026-07-13/summary.json` reran the approved
Codex node at `9ce83e9`. Exact `gpt-5.6-sol`/low provider observation, report verification,
Goal/Plan binding, terminal settlement, kill/reap, projection binding, and cleanup all passed. Its
explicit node/reserve allocation was raised to 650,000 after an earlier honest 450,000-token
overrun; the final proof settled 502,895 tokens without overrun.

`docs/reference/evidence/phase62-goal-plan-glm-retry-2026-07-13/summary.json` reran the approved GLM
node at `230db8e` after live dogfood exposed and repaired inexact provider-cost and token-aggregation
handling. Exact project-key `glm-4.7`/low provider observation, report verification, Goal/Plan
binding, terminal settlement, kill/reap, projection binding, and cleanup all passed
(`lifecyclePass:true`, `matrixPass:true`). These focused greens establish the Codex and project-key
GLM legs; they do not relabel the original five-provider matrix.

Here, report verification means required artifact shape plus execution of the pinned test command;
it is not a semantic endorsement of every model-authored sentence. The retained GLM report
mislabels one token-aggregation correction as provider-turn accounting even though its PASS verdict
and executable gates remain valid. [GitHub #6](https://github.com/user/baton/issues/6) tracks
source-anchored semantic report verification rather than overstating this evidence.

## Retained scope

Phase 62 ships initial immutable allocation, reservation, terminal consumed/released/held/overrun
settlement, replay, and status projection. It does not yet implement richer
verification/evidence predicates, authorized continuation/recovery nodes, amendment or migration
policy, child/refinement allocations, live budget reallocation or increase, portfolio scheduling,
richer risk/multi-principal approval, or distinct integration/publication/deploy/rollback
authorities. Provider-backed native continuation, deeper fork/rewind/checkpoint controls, and
further web authentication, WebSocket/operator, Streamable HTTP MCP/Tasks/daemon, and production
runtime depth remain open. System-wide locale-independent canonical ordering, pre-cut ledger
migration/versioning, same-task cross-controller branch namespaces, branch-only crash residue, and
fine-grained effect enforcement are also explicit remaining gates.

The full research ladder is also retained: Atlas AST/CST and lexical representation, native/live
SCIP and symbol depth, whole-repository and interprocedural CPG/CFG/SSA/PDG, compiler
IR/translation validation, semantic deltas, aliases/heap/implicit flow, R4–R7
behavioral/provenance representations, behavioral fingerprints, true semantic diff/merge, and
conditional expression/kernel e-graphs. Vantage, Evidence Ladder, Scratch Board/Bench, Skill
Forge/computer use, Skill/Playbook promotion, later Cartographer/Quartermaster and Cairn rungs,
registered evaluation, retention/compaction, and deeper self-contained project-manager-inspired
causal knowledge remain pending. Homelab integration is intentionally not part of this project.
