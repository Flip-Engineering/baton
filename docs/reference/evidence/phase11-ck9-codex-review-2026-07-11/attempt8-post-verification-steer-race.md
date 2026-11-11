# Attempt 8 — post-verification steer raced the hard boundary

The exact `gpt-5.4` medium-reasoning worker wrote the review and its pinned verification command
passed at operational event 50. Cumulative usage then crossed the 450,000-token hard limit at event
52. The runner's polling loop observed the successful command too late and issued its completion
steer at event 54, after the hard-limit decision; Baton correctly killed and fully reaped the worker.

This falsified the completion-steer experiment. A steer is a new input and can extend the active
turn, so the runner now stops mutating the worker after the pinned command. The existing bounded
terminal-frame grace is solely responsible for preserving a terminal claim adjacent to the final
cumulative-usage frame. Independent verification, integration, and full cleanup remain mandatory.
