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

## Measured evidence (2026-08-15 00:12Z instance, wave 99c21cd8 — red facts for this row)

Live instance traced through the ledger: members spawned clean, brief delivered, then the
interpreter stopped BOTH members 12 seconds after brief delivery with:
- stop reason = the GENERIC 'Wave driver settled.' (wave.mjs close()) — the decision BASIS
  (why INCOMPLETE, what signal classified them) rides only the settle receipt, never the
  per-member stop, and the ledger row carries reasonDigest(digest('Wave driver settled.'))
  — an opaque digest of a constant string.
- zero lifecycle.crashed/process_closed before the stop — a pure drive-loop decision on a
  non-activity signal, inside any cadence-derived window.

Pins this row adds beyond the original three:
4. Every member stop the driver issues carries its DECISION basis (verdict + the signal
   that fired it) on the stop outline — 'Wave driver settled.' is never the reason a
   member sees when the basis is 'incomplete: no-admission-signal' or equivalent.
5. The drive loop never classifies a member terminal on a signal other than member evidence
   (the 12s-brief-to-stop instance is the red case: no crash, no close, no cadence breach).

## Hard bounds

Same as the sibling row: additive, no suite edits, batteries green, no new surfaces.
