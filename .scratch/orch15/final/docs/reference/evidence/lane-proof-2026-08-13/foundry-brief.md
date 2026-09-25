# LANE-PROOF FOUNDRY — shared frame (bidirectional-lanes dogfood wave, 2026-08-13)

Every member reads this first. The store's evidence to date: **580 `message.sent` events, all
kind `brief`/`result`; zero `query`/`steer`/`inform`; zero `decision.*` events ever** (channel
audit, row-chan). The bidirectional lanes exist in code and have never been exercised
end-to-end. This wave exists to USE them and produce the evidence — every lane either PROVEN
(with the cited event/message id) or GAPPED (with the exact refusal or absence).

## The lane laws (bind every member)

- **Use the lanes, don't describe them.** Your evidence is events and message ids from YOUR OWN
  run, not code citations about what should happen. Where a lane refuses or is absent, record
  the verbatim refusal / the exact absence — that IS the finding.
- **Record as you go:** your report file lists every lane you exercised: the lane, what you
  sent/asked, the messageId/eventSeq (or refusal), and what came back (or didn't).
- **THE ATTEMPT-ECHO LAW (#171):** your `[attempt: <salt> <role>]` line VERBATIM in your
  report's first five lines.
- Judgment calls are yours — record them. Authority-class ambiguity BEYOND your scripted
  questions → a REAL DECISION_REQUEST (that too is evidence).

## Row assignments

- `row-lane-decision` → the DECISION_REQUEST lanes (scripted policy-answer + scripted defer)
  → `lane-decision.md`
- `row-lane-messages` → the message-kind lanes (`query`/`inform`/`steer` to the coordinator),
  the reply chain, and the note-elevation lane → `lane-messages.md`
- `coordinator` → receives and replies, then writes `lane-qa.md` (the lane-by-lane verdict
  table from BOTH sides' evidence — a message the row sent but you never received is a GAP).
