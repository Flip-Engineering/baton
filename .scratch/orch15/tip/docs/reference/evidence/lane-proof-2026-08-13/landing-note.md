# Lane-proof wave LANDING NOTE (top orchestrator, 2026-08-13)

## The verdict table (both sides reconciled — the row reports govern over the QA's row-absence claim)

| Lane | Verdict | Evidence |
|---|---|---|
| messageOnSpawn (steering→member brief) | **PROVEN** | delivered verbatim, message id cited by the coordinator |
| DECISION_REQUEST — policy answer | **PROVEN** (the campaign's first live answered decision) | row-lane-decision: policy matched, `opt-shared` returned, run continued |
| DECISION_REQUEST — defer | **PROVEN (honest defer-park)** | parked off `input_required` at its deadline, no forever-park |
| DECISION ledgering | **GAPPED** | zero `decision.*` events in the store, EVER — the round-trip is real but unrecorded (filed) |
| member-originated messages (query/inform/steer) | **GAPPED** | no reachable member-facing surface: web=`invalid_command`, CLI handshake fails in worktree, member MCP times out, waves_send silent (filed) |
| reply chain | mechanic PROVEN / thread UNEXERCISED | the query never landed, so nothing to reply to |
| note elevation (doubt/plan) | notes PROVEN worker-scoped; **elevation event did not fire** | elevateWhenNotes was configured; no elevation event observed |
| shared publish | **GAPPED by construction (#158 confirmed at code level)** | `writeScratchpad` hardcodes `worker:<id>`; silently admitted, never refused, lands worker-scoped |
| signalOnMembersDone (corrected #175 semantics) | **NOT RECEIVED by the coordinator** | the first correctly-addressed signal — and the coordinator's turn had already ended (the #181 lifecycle gap's sixth instance) |

## Reconciliation notes

- The coordinator QA's "row-lane-messages never landed" claim is wrong (its on-disk check ran
  before the seat-deferred row spawned — #181's twin); the row's own report (rescued from the
  main tree — the #185 escape class again) shows it ran and its sends were refused at the web
  capability table.
- The wave's own receipt reads WAVE-INCOMPLETE with the coordinator + row-lane-messages
  `stopped` — the coordinator wrote its QA (7.8KB) and the row wrote its report; both "stopped"
  verdicts are the wave-close teardown of already-finished members (the receipt's coarse
  terminal vocabulary — #182's class).
- lane-qa.md + lane-decision.md recovered from worktrees; lane-messages.md was found in the
  main tree (the scope-escape class — recorded).
