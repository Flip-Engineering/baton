# ROW BRIEF — row-cadence: leg-b activity honesty + settle pacing

Deliverable: implementation + red-first pin suite. Two smaller #163 follow-ons in one row
(they touch the same files; the handoff lists them as items 2-3).

## Anchors (re-verify at YOUR head)

- impl/src/application.mjs:8092 — the wave driver's stall clock reads the cursor-stripped
  status view; :8128 documents the grok no-resource-events case (BD-A3 wave stall-died on
  exactly this class).
- impl/src/wave-driver.mjs:43 — settleTimeoutMs = 5_000 FIXED; find every use.
- The quiescence leg-b: progressClass 'silent' is computed from checkpoint/message evidence;
  a member that only makes tool calls (content.tool_call events, NO checkpoints) reads as
  silent.

## The contract (closed)

1. leg-b catatonia refinement: the per-member liveness/progress classification takes
   lastActivityAt from ANY member-originated evidence event (tool calls included), not only
   checkpoints/messages — a tool-calling member must never classify 'silent' while its events
   advance. If a store projection already carries this, pin it; if not, thread the latest
   member-event ts into the classification the driver folds.
2. settleTimeoutMs: pacing only — audit that it never terminates fate (it must not appear on
   any terminal path); if it does on some path, that use becomes cadence-derived like
   row-stall-break's window. If pacing-only: document + pin THAT (a test asserting settle
   timeout never produces a terminal basis).
3. Red-first pins: a tool-call-only member (no checkpoints) classifies non-silent (RED at
   pre-change head); the settle-timeout pin.

## Hard bounds

Same as the sibling row: additive, no suite edits, batteries green, no new surfaces.
