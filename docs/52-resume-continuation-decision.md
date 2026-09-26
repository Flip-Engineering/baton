# 52 — A recovered seat continues in the recovery act (issue #525, withdrawn by #572)

Status: WITHDRAWN, 2026-09-26. The mechanism this document designed and the runtime landed — a
resume-from recruit that recorded a continuation question and parked the recovered seat until its
orchestrator answered — was removed from the runtime by #572.
Related: #306/docs/48 (reincarnation — the interruption side), #364 (`participant_runtime_lost`),
#385/#452/#453 (the resume-from carry), #337 (parked guidance), #443 (the reroute decision and its
policy row), #273 (guidance delivery semantics), #332/#350/#353 (seat settlement).

## What the removed mechanism did

A `swarm.recruit --resume-from <old-id>` under the default `resumeContinuation: 'manual'` policy
stopped after the join: it recorded `swarm.resume_decision_requested` with the carry plan and the
admitted run selection, parked the seat, and asked the orchestrator whether to continue. A guide
answered it, and the deferred half — host admission, run start, worker binding, scope claim,
context-package attach and the physical workspace carry — ran under that guide. A stop answered it
the other way. The `resume_decision_required` attention row named the party that answers.

## Why it was removed

Baton never leaves live work waiting on a party it does not wake (#572, AGENTS.md "No pausing,
idling or truncating agents"). The recovery decision made the recovered seat wait for an external
act before it could work at all, and the seat's own recovery was split across two operations whose
second half depended on the first being answered. The rule states the behavior instead: a turn end
wakes the agent's orchestrator, and an agent stops when it declares itself done or its orchestrator
stops it. A recovered seat is work the runtime can perform, so it performs it.

## What happens now

- A `--resume-from` recruit performs the whole recovery in that one command: the brief, the host
  admission, the run start, the binding, the scope claim, the package attach and the workspace
  carry. The successor is working when the command returns.
- Nothing records a continuation question, and no seat waits on one. The `resumeContinuation`
  policy field is gone: `swarm.policy_updated` carries only `rerouteOnProviderFault` and
  `reroutePreferApi`.
- A recovery that cannot complete — a snapshot that will not apply, a route that cannot serve —
  refuses the recruit itself with the typed refusal it already named, and the #308 rollback
  withdraws the seat so no half-joined member remains.
- A carry that fails no longer leaves the seat decision-pending for a later answer. The recovery is
  attempted once, in the act that asks for it.
- The orchestrator's levers over a recovered seat are the ordinary ones: `swarm.guide` continues it,
  `swarm.stop` settles it without work.

## What stays

- The resume-from carry itself (#385/#452/#453): the snapshot apply, the `bound` case, the
  `workspace.carried_from` row, and the refusal classes for a carry that cannot run.
- The parked-guidance carry into a successor brief (#337): a resume-from recruit still composes the
  predecessor's parked guidance into the brief and marks each message delivered.
- `swarm.resume_decision_requested` and `swarm.resume_decision_answered` remain in the event fold,
  so the ledgers of deployments that ran the mechanism still replay. No writer emits them.
- The `resume_decision_required` wake class and its status word leave the projection tables (issue
  #572 remainder): the class named a state the runtime does not produce. The two event kinds stay
  in the fold so those ledgers replay, and a row of either kind derives no wake row.

## Design sections withdrawn

The decisions in §2, the vocabulary in §3, the pins in §5 and the verification plan in §6 described
the removed mechanism and are not part of the runtime. This file remains as the record of what was
designed, what landed, and what replaced it.
