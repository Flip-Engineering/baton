# Demo v3 — the tiered knowledge loop, live end-to-end (2026-08-01)

**Verdict: TIERED-LOOP-OK** — worker scratchpad (task-ephemeral) → orchestrator elevation to the
shared workflow partition → board-close candidacy → lease-gated admission (verified Finding in the
project KG) → workflow settle → horizon digests. Every step receipted in `kg-loop-live-receipt.json`.

Worker: `glm-5.2@high` (live wire, `SCRATCHPAD_WRITE` lines admitted by the session scanner — three
`scratchpad.write_result {ok:true, result:'written'}` receipts). Orchestrator ritual: the driver
script holding `driver.coordination` inside the run's live settle window.

## The loop as landed (run `run-4562010cbb4d0b2ab187880a87c9337f`, attempt kgv20260801085320)

| Step | Receipt |
|---|---|
| Worker writes note/plan/doubt (worker scope, fence 0→3) | three `scratchpad.write_result ok:true` |
| `claim_turn` steering resolves the checkpoint park | `paused` → `work_completed`, task `completed`, run OPEN |
| `steering.registered` (rule 19/20 elevation precondition) | `driver.recorded` on the run |
| `elevateTaskScratchpad` — note+doubt selected, plan deliberately skipped | `settled`, shared fence 0→3, `scratch-fact:84c1fed5…` minted for the note |
| Orchestrator settlement run + lease | `run-orchestrator-lease:9359f8863fdbff9d0` |
| Board post + close → candidacy | `finding:board-close:board-item:031d7553…:2` |
| `admitWorkflowFinding` (lease-bound, policy-capped, idempotent) | `finding:workflow-admitted:…`, grounding `verified`, trigger `workflow.admitted`, replayed false |
| `settleWorkflowScratchpad` | `settled`, reap event 74, scratch fact expired |
| Horizons | KG nodes 4 → 7, edges 1 → 2, promoted Finding present |

The surveyor's own report (`kg-loop-surveyor-report.md`, recovered from the worker worktree)
independently derives the pre-stop invariant in its third section.

## The two findings this demo exists to receipt

### F1 — the tiered-KG ritual is unreachable in every shipped workflow path (filed as issue)

- **Zero live call sites** (grep-verified): `elevateTaskScratchpad` / `settleWorkflowScratchpad` /
  `admitWorkflowFinding` are reachable only from store-level tests. No `application.command`
  dispatch (`application_command_unavailable`), no MCP tool, no wave-driver hook.
- **The ritual is pre-stop-only by design**: `elevateTaskScratchpad` throws `run_stopping` once the
  run is stopping (v3 receipt: `coordination_projection_poisoned` after durable seq 77, cause
  `run_stopping`), and `issueRunOrchestratorLease` refuses a stopping parent run
  (`_assertRunAdmissionOpen`). The shipped wave driver always stops member runs at close (L1) —
  so as shipped, the loop can NEVER execute in a real workflow.
- This demo's manual assembly (createDriver + BatonApplication + bindBaton, ritual between
  member-resting and `wave.close()`) is the working shape production wiring must take: a
  settle-window orchestrator hook in the wave driver / application, or kernel ops wired through
  `application.command` with run-open enforcement.
- Under a mandatory goal/plan policy the settlement run's orchestrator parent task must be
  plan-dispatched (`createTask` refuses `goal_plan_required` otherwise) — wiring constraint #3.
  This demo's deployment ran `mandatory: false`.

### F2 — the turn-based no-diff trust gate kills legitimate read-heavy work (filed as issue)

Retry 4 receipt: the GLM surveyor's first turn was reads + scratchpad writes (no worktree diff);
the progress gate interrupted and killed it mid-turn (`control.interrupt_requested` →
`kill.confirmed` → `worktree.progress_unchanged {state:'no_progress'}`). Scratchpad writes are real
work the gate cannot see. Standing operator directive: programmatic steering (nudge/check), never
turn-based gating. Sibling of #61 (verdict surface).

## The manual-drive AX receipts (why the wave-driver pattern must be productized)

Nine attempts to reconstruct the shipped driver's loop by hand; each failure is a contract the
driver knows and no doc teaches:

1. `openBaton` facade hides `driver.coordination` — no embedded path to the ritual (F1).
2. Raw store reopen needs the deployment's exact policy set (`goal_plan_integrity`,
   `evidence_resolver_required` without `operationalRead`).
3. Elevation/lease are `run_stopping`-refused post-close (F1).
4. `BatonApplication` assembly wants `defaults.route`, a private-mode `exportRoot`.
5. No-diff gate killed the surveyor mid-turn (F2).
6. A parked run is not terminal — a naive 30-min poll burned (fast terminal break needed).
7. Blind `run.complete()` spam reaps a healthy worker via the quiescence contract — one-in-flight
   pumps only (matches the shipped `pumps` map).
8. `turn_checkpoint` parks clear only via `nudge_turn` / `claim_turn` steering, not pumps.
9. `issueRunOrchestratorLease` binds its key to the derived lease identity
   (`run.orchestrator_lease:<digest>`); `createTask` under mandatory policy needs plan dispatch.

Attempts 1–5 in `run-kg-loop-demo.mjs` / the retry chain; the landing drive is
`run-kg-loop-live.mjs` (v3b retry 9).
