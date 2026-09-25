# Attempt 2 — integrated candidate, bootstrap self-check red

The second exact `gpt-5.6-sol`/low worker passed 135/135 pinned tests, Baton's detached verifier,
and fast-forward integration as captured commit `b7f2749`; kill and all native/worktree/runtime/
branch reap checks passed.

The runner's final tuple assertion remained red because the runner coordinator had been loaded from
the pre-feature main process before the worker integrated new public effort fields. Native low-effort
wire evidence was present. This one-run bootstrap limitation does not invalidate the integrated
candidate, but the candidate is not RT11-complete: it added no Phase 14 test file, dropped web
`args.effort` at dispatch, omitted effort/route fields from replay and durable task creation, and
accepted effort-like metadata from overly broad event kinds.

Attempt 3 runs under the newly integrated coordinator and is explicitly scoped to those hardening
gaps. Its live exact-tuple assertion is now meaningful.
