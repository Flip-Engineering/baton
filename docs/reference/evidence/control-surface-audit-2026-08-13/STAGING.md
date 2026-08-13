# #147 control-surface audit — the first #74-pattern dogfood (staging)

**Status: STAGED, not yet launched.** Launch gate: the `deepseek-v4-pro[1m]` seat must be
proven by the #67 impl wave (in flight at staging time), and this wave is ATTENDED — the top
orchestrator (kimi) answers deferred DECISION_REQUESTs live through the surface.

## What this proves

- The #74 worker-orchestrated swarm pattern, two-level shape, ONE #114 spec: a heavyweight
  coordinator member over three flash rows (heterogeneous tiers, homogeneous task family).
- Workflow-as-data as the driver-killer: no bespoke driver script — the wave is declared here
  and run through `waves run` / `baton_waves_run` / `baton.recipes.runWorkflow`.
- The collaboration lanes under real load: shared scratchpad as the row→coordinator handoff,
  `signalOnMembersDone`, `elevateWhenNotes`, DECISION_REQUEST escalation to the top
  orchestrator (NO `answerDecisions` policy is declared — every ask defers up by design),
  reply-lane (#105) steerage.
- Real output: the #147 unified control-surface audit (parity matrix, ranked frictions,
  grammar verdict, top-5 fixes).

## Files

- `audit-brief.md` — the shared frame (axes, laws, escalation posture) every member reads.
- `coordinator-brief.md` — the sub-orchestrator's synthesis instructions.
- `row-web.md` / `row-cli.md` / `row-mcp.md` — per-surface row briefs.
- `workflow.json` — the #114 spec (fresh `idempotencyKey` per launch).

## Launch (when the v4-pro seat is proven)

Through the resident bus (`waves_run` with this specPath) or CLI `waves run`. Attend loop:
watch `waves_list` on the resident, answer parked DECISION_REQUESTs via `run.answer` /
`run_act`, record every AX friction the ATTENDING itself produces — those are #147 evidence
too (the audit audits itself).

## Acceptance

Harvest green (`control-surface-audit.md` with the v1 marker through the wave receipt);
three row reports present and non-empty in `shared` + as files; every escalation answered
through the surface (none answered by editing files out-of-band); the D6 receipt's steering
trail truthful (D1.3 — post-#74-impl this is enforced; pre-impl it is audited by hand).
