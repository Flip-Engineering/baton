# Attempt 1 — provider limit exposed turn-crash/process-reap conflation

The exact `gpt-5.4` worker established native PID `15430` and then emitted
`lifecycle.crashed` because the provider rejected the turn at its usage limit. The Codex app-server
process remained alive. Coordinator treated the turn crash as proof of process exit, removed the
runtime/worktree/branch, and a later `kill()` returned `already_dead` without calling the adapter.
The evidence summary therefore correctly failed `killConfirmed` and `processGone`. The leaked PID
was explicitly terminated after inspection.

This was a Baton control-plane defect, not an Atlas verdict. Coordinator now distinguishes failed
turn from exited transport, automatically begins confirmed two-phase kill on `lifecycle.crashed`,
retains cleanup ownership until confirmation/bounded force, and tests both a live session-shaped
turn crash and an already-exited timeout child. The recursive runner's `finally` path now waits for
process/runtime/worktree/branch reap even when the review itself fails. A fresh provider review
remains pending quota reset; no fallback model is substituted.
