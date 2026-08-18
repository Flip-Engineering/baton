# ROW BRIEF — row-spawn-window: no failed-verdict inside the spawn-confirmation window (#199 root)

Deliverable: implementation + red-first pin suite. Issue #199 is the contract.

## Anchors

- Evidence shape: member claims task (seq N), lifecycle.spawned N+2, turn_started +
  process_started N+3-4, a SECOND lifecycle.spawned N+5 (harness double-spawn), then the
  interpreter verdicts the member failed while it keeps working orphaned.
- impl/src/wave.mjs — the drive loop's member-status read that produced the instant failed.
- impl/src/coordinator.mjs — spawn/claim sequencing; find where a second spawned for the
  same worker invalidates the first claim window.

## Contract (closed)

1. The interpreter/drive treats a member as failed ONLY on terminal evidence (task failed
   transition with cause, process_closed with no successor, or startError) — never on a
   status read racing the spawn-confirmation window. Evidence-count confirmation mirrors the
   landed tri-state pattern (3794b583): a suspicious read defers to the next poll.
2. The double-spawn window itself: if the second lifecycle.spawned is a harness retry the
  coordinator owns, bind it to the same member (generation advance), not a new claim.
3. Red-first pin impl/test/spawn-window-red.test.mjs reproducing the issue's event shape
   (claim -> spawned -> process_started -> second spawned) asserting the member is NOT
   verdict-failed while evidence advances.

## Hard bounds

Additive; no clocks (evidence-count only); batteries green.
