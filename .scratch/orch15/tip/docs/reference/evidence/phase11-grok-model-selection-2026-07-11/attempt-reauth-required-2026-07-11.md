# Concurrent Grok fallback — reauthentication required

From a clean checkout, Baton allocated both exact-model tasks (`grok-4.5` and
`grok-composer-2.5-fast`) concurrently and created both isolated worktrees. Grok refused both
spawns with `Authentication required` before either child PID existed. Baton confirmed both kills
and removed both worktrees, metadata records, runtime scopes, and task branches.

The live multi-Grok/model/reap rerun remains `PENDING-LIVE-grok-reauth`. This attempt also exposed
and corrected a runner assertion that incorrectly treated “no PID was ever created” as “a process
still exists.” The run is evidence for concurrent route allocation and cleanup at the
authentication boundary, not evidence that either requested model executed.
