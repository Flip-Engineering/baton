# Attempt 9 — medium reasoning wrote before the hard stop

With the post-verification steer removed, the exact `gpt-5.4` worker stopped repository reads after
the early synthesis steer and wrote the requested review. It crossed the 450,000-token hard limit
at 461,811 cumulative tokens before invoking the pinned verification command, so Baton correctly
discarded the worktree and fully reaped its process, runtime, branch, and worktree.

The rejected file-edit telemetry nevertheless supplied diagnostic leads: strengthen fail-closed and
replay proof after publication completion-write failure, input-resume failure after adapter
acceptance (including racing consumers), and recovery/follow-up refinement failure after native
advancement. These leads are not accepted review evidence; they must be independently reproduced in
tests before changing CK9's status. A future recursive rerun will use a deterministic tool-count
synthesis trigger and lower reasoning effort while retaining exact-model, verifier, integration,
and cleanup gates.
