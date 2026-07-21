# Phase 93a.2 control-grammar review — live Baton-on-Baton evidence (2026-07-20/21)

Drivers: `run.mjs` (wave 1, v1→v2), `run-wave2.mjs` (wave 2, v3→v4). Target branch:
`phase-93a.2-program-ir`. All runs were ordinary Runs over the resident application
(`openBaton`), with exact routes, scoped paths, pinned re-verification, and stop/reap receipts.

## Review outcomes

| Seat | Route | Result | Artifact |
| --- | --- | --- | --- |
| spec-redteam | `glm/glm-5.2/xhigh` | completed; trust gate `verify.reverified` passed in fresh sandbox (exit 0) | `spec-redteam.md` (5 spec defects) |
| tests-redteam | `kimi-code/kimi-code/k3/high` | completed; trust gate passed | `tests-redteam.md` (systemic digest circularity + ~15 unpinned rows) |
| impl-review | `kimi-code/kimi-code/k3/high` | **scope-killed** mid-analysis (`health.scope_violation` — edited a fixture outside scope; correct guard, brief defect) | none (re-run in wave 3 with corrected brief) |
| implementer | `claude-code/claude-sonnet-5/high` | wave 2 | code corrections (this branch) |
| redraft-redteam | `glm/glm-5.2/xhigh` | wave 2 | `redraft-redteam.md` |

Wave-1 reports were recovered from preserved `refs/baton/results/*` commits after the v1/v2
drivers aborted the waves before materialization — the preservation refs survived full
stop/reap, as designed.

## Route truth at run time

- Codex `gpt-5.6-sol`: **rate-limited** (usage credits 0, resets 2026-07-26). Not usable this session.
- Claude Code `claude-opus-4-8`, `claude-sonnet-5`, `claude-opus-4-6`: ready after owner-approved
  Keychain→file credential provisioning (issue #11).
- GLM `glm-5.2`, Kimi `kimi-code/k3`: ready. One transient Z.ai 529 overload observed; honest
  `provider_turn_failed`, retryable.
- Grok `grok-4.5`: static-ready only (not exercised this wave).

## Orchestrator/driver findings (dogfood AX, all receipted)

1. **Passive observation advances nothing.** `run.status()` polling leaves a Run parked at
   `awaiting_plan_approval` forever; plan approval is distinct recorded authority
   (`run.approve()` or the `drive()`/`complete()` pump). Wave-1.5 lost 90 minutes to this.
2. **`run.complete()` returns on RunView quiescence; it is not a terminal wait.** Treating pump
   settlement as terminal made the v3 driver kill a healthy implementer mid-read (w-88, SIGTERM,
   $1.35 turn). Pumps must re-arm and only push through client-action gates.
3. **`BatonRunGroup.complete()`/fail-fast cascade.** In wave-1 v1, one seat's provider crash
   resolved `group.complete()` early; the driver's materialize-then-stop order then killed two
   healthy reviewers. Per-member start/settle/outcome isolation is required for heterogeneous
   waves.
4. **Terminal-phase taxonomy traps.** `work_completed` is non-terminal (verification/acceptance
   follow); `cancelled` is terminal. Driver predicates must use `outline.terminal` or the closed
   terminal-phase set.
5. **Rate-limit truth exists in the event stream but not terminal classification.**
   `resource.tokens` carried credits:0 while the RunView reported `provider_crashed`
   (unclassified). Live instance of issue #10's `rate_limited` classification gap.
6. **Small schema frictions.** `run.start` `exact` rejects `provider` though the deployment
   route table carries it; `advanced.routes` rejects duplicate exact tuples.
7. **Scope guards work.** The impl-review worker was killed by `health.scope_violation` when it
   edited outside its declared scope — the failure was in my brief ("mutate a fixture"), not
   the guard.

## Reflexive steering proof (wave 2)

At 03:10:53Z the orchestrator sent a priority steer to the running implementer through the
`/tmp/baton-wave2-steer` lane (`run.send`, delivery `now`). Worker log w-90 records
`control.delivery_requested {mode:"steer"}` → `control.steer {midTurn:true}` (native mid-turn
injection, fenced). The implementer's next message re-sequenced its work exactly as directed:
"Starting with the P0 core: adding red rows for the three settlement-domain exploits before
touching implementation." Steering request → durable receipt → observable behavior change.

## Evidence files

- `spec-redteam.md`, `tests-redteam.md` — wave-1 adversarial reports (heading contract:
  `## Verdict`, `## P0-P1 findings`, `## Required corrections`).
- `redraft-redteam.md` — wave-2 re-draft attack (materialized by the wave-2 driver).
- `evidence.json` (wave 1), `evidence-wave2.json` (wave 2) — outcomes, steering, stops, ownership
  receipts.
