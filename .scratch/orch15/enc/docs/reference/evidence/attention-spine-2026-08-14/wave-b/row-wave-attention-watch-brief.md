# ROW BRIEF — row-wave-attention-watch: waves.attention.watch (#208 item 1)

Deliverable: implementation + red-first pin suite.

## Anchors (re-verify at YOUR head)

- impl/src/application.mjs:12706 run.attention.watch — the RUN-level lane exists
  (attentionWatch, Decision 5 scope authority, :13067 the validator, :13281 the seam).
- impl/src/wave-driver.mjs — the drive loop's per-poll member status read (the place the
  wave already computes parked/attention state; the aggregate is a fold over what exists).
- #10's blocked_interaction attention class (run level) — reuse, do not re-invent.

## Contract (closed)

1. waves.attention.watch application verb: subscribe by waveId; the lane emits the AGGREGATE
   (wave X has N parked members, oldest parked at event-seq S, per-member attention kinds)
   on: member input_required entry, decision.requested uncovered by policy, member terminal
   (failed/stopped with cause), and wave settle. Scope authority mirrors Decision 5 (the
   lane's own seam; no facade narrowing).
2. NO polling semantics at the consumer: the watch delivers (callback/envelope), the caller
   never re-scans the store. Store-side: ride the event fold, no per-subscription rescan.
3. Red-first pin impl/test/wave-attention-watch-red.test.mjs: a wave member entering
   input_required delivers the aggregate to a registered watcher WITHOUT any poll call
   (RED at pre-change head: no such verb).

## Hard bounds

Additive; one new application verb (the watch); no new event kinds (the fold reads existing
attention/decision/terminal events); batteries green.
