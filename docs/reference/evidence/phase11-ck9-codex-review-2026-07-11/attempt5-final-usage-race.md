# Attempt 5 — final-usage/terminal-frame race discovered

The fifth run used both native steers and reached a verified review file, but Baton's synchronous
hard-budget action killed the worker on its final cumulative usage event before Codex's adjacent
turn-completed frame. Usage was 501,069 against 500,000. The completion steer raced after the stop
and correctly returned `worker_not_active`; the artifact was discarded and cleanup passed.

This exposed a control-plane defect. GV3 now schedules the hard stop after a bounded terminal-frame
grace and cancels it only if a terminal claim arrives. The claim still must pass independent
verification. The recursive runner uses an explicit 2-second grace for this measured provider
boundary; the production default is 250ms.
