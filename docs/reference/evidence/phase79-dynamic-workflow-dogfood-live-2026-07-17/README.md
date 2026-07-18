# Phase 79 dynamic Workflow dogfood

This evidence runner uses the concise `openBaton({ repo, advanced })` surface and the new
`baton.workflow(...)` composition directly. It dispatches one Codex Attempt and two concurrent
Grok Attempts over the same WorkItem in isolated worktrees, then exercises typed feedback,
operator selection, aggregate Workflow evidence, exact Run stop, and fleet close.

It intentionally has no caller-managed token, dollar, export-byte, or file-count controls. The
deployment owns bounded safety policy and the orchestrator supplies only the repository, exact
routes, verification command, shared objective, scope, and role-labeled team.

The retained Candidates are evidence only; the runner does not apply any Candidate to the caller
checkout.

Run it with:

```sh
node docs/reference/evidence/phase79-dynamic-workflow-dogfood-live-2026-07-17/run.mjs
```

The exact Grok run fails closed before provider effects when local Grok OAuth is unavailable or
expired. `run-codex.mjs` exercises the same Workflow with two exact Codex effort routes so the new
composition can still be validated without weakening route or authentication truth:

```sh
node docs/reference/evidence/phase79-dynamic-workflow-dogfood-live-2026-07-17/run-codex.mjs
```

`run-recursion-design.mjs` snapshots the current dirty workspace into a temporary Git repository
without copying ignored credentials, then dispatches two independent exact Codex routes against the
actual in-progress implementation. Both Attempts write only the same report path in their own
isolated worktrees. Baton freshly verifies and retains both commits, attaches immutable feedback,
selects one Candidate, stops, and proves zero final ownership:

```sh
npm ci --prefix impl
node docs/reference/evidence/phase79-dynamic-workflow-dogfood-live-2026-07-17/run-recursion-design.mjs
```

Live result on 2026-07-18:

- Run `run-36cd1da7e48f8768df4415f032206fdb` admitted high- and medium-effort
  `gpt-5.6-sol` workers concurrently through `codex-cli 0.144.5`.
- Both requested/resolved/model-observed identities matched. Provider-native harness and effort
  observation remained honestly unavailable.
- Retained Candidate refs were
  `refs/baton/results/ab104cd59f5d8a23c23b7269eae956f6120e989a` and
  `refs/baton/results/c1107e7e81bf91e18422b01d18690cac16eb9b15`.
- The high-effort authority design was selected after both passed the hub verification, and close
  returned `{ workers: 0, workerIds: [], closed: true }`.
- Both designs rejected shared multiwriter/review/resume/recovery shortcuts and independently
  converged on an append-only successor Plan whose fresh revision worktree is based at the exact
  still-resolving retained Candidate SHA.

`run-recursive-loop.mjs` executes that design through the ordinary Workflow facade: two parallel
Candidates, anchored feedback, explicit selection, successor-Plan proposal, separate approval,
fresh exact-Candidate-base revision, final selection, and exact stop/close. It deliberately omits
historical captured provider streams from the temporary implementation snapshot so each worker and
verifier receives useful implementation context instead of hundreds of megabytes of old wire data.

```sh
node docs/reference/evidence/phase79-dynamic-workflow-dogfood-live-2026-07-17/run-recursive-loop.mjs
```

Live result on 2026-07-18:

- Two earlier attempts failed honestly and were reaped: the first exposed an internal 2.5M-token
  per-member circuit breaker that was too small for a tool-heavy Codex audit; the second reached
  verification and exhausted the host volume while cloning bulky historical evidence.
- An interrupted recovery then exposed two exact-stop defects. Baton now durably proves an old
  process group absent without signaling a possibly reused PID, replays that observation, and does
  not checkpoint a historical worktree path already removed by startup reconciliation.
- Final Run `run-acc9289f98a1de7e2f878583f42b66c9` admitted exact low- and medium-effort
  `gpt-5.6-sol` Attempts. Initial retained commits were
  `443463f1e2cb687761cb4325fdb299861acf4399` and
  `c9ca52c2690e800b07c75ec9b88bc4b7999de490`.
- One exact feedback packet selected the low-effort Candidate. Successor Plan
  `f5770f3d897c91f514fe1bf87e3599054a79d39946bcc021de1d580f4d7bcd01`
  names predecessor `fa06d3d8e4267ad1f688610aff2ff7c382d8ce092dc5c4e1d8b17e7fc108e65c`.
  Its fresh revision Candidate is `6d249ceab5ef0838bc28757f9b4d4b4cec8563dc`.
- Both rounds paused at `selection_required`; revision proposal paused at
  `awaiting_plan_approval`; close returned `{ workers: 0, workerIds: [], closed: true }` and no
  worker worktree remained.
- The selected feedback-revised engineering output is retained as
  [`recursive-workflow-audit.md`](recursive-workflow-audit.md).

The retained worker audit calls the store primitive `createPlanGatedRevisionTask()`; that was a
report naming error. The implemented and specified API is `createPlanRevisionTask()`. The raw
Candidate evidence is intentionally preserved rather than silently rewritten.

Post-fix validation on 2026-07-18:

- a combined CLI, authenticated Web, MCP, progressive AX, recursive transport, Phase 79, and Phase
  80 slice passed `140/140`;
- the complete implementation suite passed `2002/2002` with zero failures, skips, cancellations,
  or todos; and
- the repository retained only its main checkout and `.baton/wt` contained zero directories.

`recover-recursive-loop.mjs SNAPSHOT RUN_ID` is the exact replay/stop utility used to diagnose the
interrupted-run gap. It is evidence tooling, not another operator control surface.
