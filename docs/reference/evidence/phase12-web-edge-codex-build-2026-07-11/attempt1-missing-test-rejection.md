# Attempt 1 — rejected missing-test pass

The Baton runner reported every lifecycle/reap check true and integrated `1f41112`, but the
candidate is not accepted as EP1–EP9 completion. It did not create
`impl/test/phase12-web-edge.test.mjs`; Node's `--test` invocation silently ignored that nonexistent
explicit path and ran only the legacy Phase 12 files. The runner now requires `test -s` before
starting Node.

Owner inspection also found proxy-derived HTTPS was not consumed by authentication, ticket quotas
were not wired, readiness was a static flag rather than dependency-grounded, and shutdown lacked
acceptance proof. The candidate is retained as a bootstrap implementation only.
