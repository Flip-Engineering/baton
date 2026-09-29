# Read-only review of a97be005, native replies + terminal stop + Git-stage laws (bend2-git11)

Swarm contribution: seq 431321, swarm-bend2-20260924 (contribution-10a99382d8270b8e03cd938c71853c5b).
Read-only. No build, test or gate. Retained extraction: `.scratch/review-a97be005`.

Tip: `a97be0053504d673f6f0b7d16da1aacf68a7f9bb` = `770057cc` -> `a14e1d4e` (terminal stop) ->
`e7ecde14` (stop admission + reply boundaries) -> `2f2bd0ce` (installed OMP acceptance) ->
`43d04b11` (trace scope) -> `6042324a`/`c344592a`/`a97be005` (checked-landing composition and
answer, recruit-parent refusal).

| Item | Value |
|---|---|
| laws | 280 (248 + 32: 9 stop, the ld_go stage and pass-through, m3c composition, 2 recruit-parent) |
| implementation mutations | 38 (22 + 16) |
| `bend2/test/stop.py` tests | 9 |
| receive tests | 27 |

All 38 anchors occur exactly once in their named production file, all 38 named laws exist, and every
`find` differs from its `replace`.

## Stop feature, verified from source

- **Admission** — `session_stops` keys on the session (one stop per session); `admit_sql` inserts the
  execution only `WHERE NOT EXISTS(session_stops)` and returns `NOT EXISTS`; `Receive.available`
  refuses before taking the lock; `start_admitted` releases the lock and fails; `pending_count_sql`,
  `wake_sql`, `Guidance.pending` all exclude a stopped session; the `Message` arm refuses task,
  guidance and recovery inserts for a stopped recipient and `Store.accepted` turns that into an
  exit-2 refusal; `recovery_input` refuses for a stopped session.
- **Signal** — `session_stops.signal` defaults to 15 (TERM); `force-stop` sets 9 (KILL).
  `reconcile` selects the signal only where `applied_signal<>signal`, so a success is not repeated
  and a failure is retried. The owner reconciles after launch (`Stop.started`) and on recovery
  (`observe_attached`).
- **Exit** — `Turn.record_exit` -> `Stop.exited` marks the execution exited, records native status and
  outcome, and writes one `stop-result:` report under `message_upsert`; `worker_finished` delivers it.
  `observed` makes the restart condition `Bool.and(gone, Bool.not(closed))`, so a stopped session
  completes instead of restarting.
- **Escalation** — `force-stop` requires the exact existing stop id and re-signals only while the
  recorded execution is live (the TERM-resistant case after observer loss).
- **Direct turns** — `choose` admits with `mode='direct'`, so a live direct turn is refused and left
  unchanged (`supported_sql` enforces it).
- **Handoff** — `root.deliver` routes a stopped recipient's report or question up one level as one
  `stopped-input` report; if no higher parent can be woken it returns an explicit failure naming the
  retained inbox.
- **Reply guard** — `send` and `response_sql` both require the worker not be stopped; the reply
  transaction now runs `C.schema()`, and `Turn.run`/`Receive.run` commit the session first, so
  `admit` always runs with the stop tables present.

## Laws and controls

16 new controls: `stop-reconcile-forces-every-request`, `stop-reconcile-compares-signal-numbers`,
`stop-admission-ignores-terminal-state`, `ordinary-stop-submits-force`,
`force-stop-selects-another-attempt`, `stopped-receive-reports-success`, the two reply/stop guards,
four checked-landing composition controls, three m3c answer controls, and the recruit-parent control.

The new git laws bind each `ld_go` entry to the stage it runs and to its pass-through arms; the m3c
laws bind `ld_answer` for landed, failed and the three pre-outcome states.

## Observations (non-blocking)

1. **Idle-stop presentation** (the root has this queued): `signal` defaults to 15 for every stop, so
   an idle stop reports `requestedSignal: 15` with `attempt: null` although `reconcile` submits
   nothing (no live execution joins). Behaviour correct; only the reported value misleads.
2. **The stopped-input refusal is detected by a JSON prefix**:
   `Store.accepted` tests `starts_with(saved, "{\"error\":\"session-stopped\"")`. Correct today and
   asserted for all three input kinds; if the prefix changed, the path would answer exit 0 with the
   error JSON rather than refusing.

## Evidence

`docs/bend2/native-interactions-2026-09-28.md` pins the reply run at runtime source `770057cc`, tree
`7915a7ef`, binary `6b655a0a` — the reply source and evidence keep their own pin. Its limits name
native-model parent judgment, spontaneous model questions, live observer loss, checked landing and
publication as outside the real run, and it states the stronger root-request consequence raised in
the 770057cc review ("makes receive fail after native exit").

## Limits

No build and no gate, so acceptance and gate figures belong to the author and the root; the anchor
check is a parse of the mutation table. The laws restate the functions they bind, so their independent
force is the 38 production mutations, verified to apply but not run.
