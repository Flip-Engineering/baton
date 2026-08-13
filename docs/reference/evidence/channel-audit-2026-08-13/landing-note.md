# Channel-audit foundry LANDING NOTE (top orchestrator, 2026-08-13)

## The headline: the day's dominant failure class has a root cause, and it's one inverted filter

row-chan settled the signal question with store-cited evidence (`channels.md` §4):
`signalOnMembersDone` **fires correctly but signals the wrong recipients** —
`workflow-interpreter.mjs:739-751` builds `recipients = [...handles.keys()].filter((role) =>
!signalRoles.has(role))`, delivering the "members done" signal to everyone EXCEPT the roles the
spec names. Across three foundry waves the coordinator never received the signal it was briefed
to wait for; already-settled rows received it instead. Every blind-coordinator incident today
(#174's instances) traces to this inversion. Filed as its own issue; HIGH priority.

## The QA's blind sections are overridden — again

The coordinator's §2e ("the row→coordinator handoff failed… no rows materialized") and §5 ("all
four rows missed everything — they produced nothing") are **false**: all four row reports exist
(18–32 KB each, harvested from member pins — three `harvest_ok`, one recovered miss). The QA's
blindness is itself the #174/#signal evidence. Its §2 gap TABLE (a coordinator-direct,
citation-verified audit done blind) stands on its own and its §2b/2c staleness corrections are
valuable: the `coordinator_authority_forbidden` refusal (#74 A5) has LANDED ahead of the seat it
coaches, and the context-pack gap is graded (orchestrator facade landed, worker verb absent).

## The row reports' load-bearing findings

- **row-suborch (the #74 remainder map):** Q1 PROVEN NO — a member cannot call `waves.run`
  today (the authority refusal works; the seat doesn't exist). Q2 PROVEN GAPPED — zero cell
  machinery; kernel `writeScratchpad` hardcodes `worker:<id>` (the #158 root cause candidate).
  Q3 GAPPED — nested escalation is flat: a suborchestrator cannot `approve`, and a nested
  DECISION_REQUEST cannot be minted. Q4 PROVEN — all seven steering lanes are interpreter-only;
  the raw verbs are NOT seat-refused on the `direct` seam (a worker `run.act approve_plan`
  executes) — blocked only by facade-absence + the recursive gate + the `waves.run` refusal.
- **row-chan:** 580 `message.sent` events in range — ALL kind brief (563) or result (17); **no
  query/steer/inform message was ever sent**, and **no `decision.*` event exists in the store at
  all**. The bidirectional lanes are unexercised end-to-end: a DECISION_REQUEST in a wave
  without an `answerDecisions` policy parks forever, never routed up.
- **row-know / row-env:** the resident's coordination store was located and cited by all three
  (the previously-undocumented path — now documented in their §0s); member-environment findings
  include the `gh`-auth and shared-publish reachability instances.

## Procedural record

- Harvest: 3/5 `harvest_ok` (auto-materialized); `audit-qa.md` + `suborchestrator.md` recovered
  from receipt bytes (attempt-marker misses — compliance 3/5 this wave).
- The QA file is kept as the honest record of what a dark-channels coordinator concludes; its
  blind-written gap table was verified citation-by-citation by the coordinator itself and is
  sound where it doesn't conflict with the row reports it never saw.
