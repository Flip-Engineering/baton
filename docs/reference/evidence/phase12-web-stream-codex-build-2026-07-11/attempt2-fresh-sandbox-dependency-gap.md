# Attempt 2 — fresh verifier lacked repository dependencies

The exact `gpt-5.6-sol` low-effort worker produced captured commit `aeef931`; its new WN6 tests
passed in the worker worktree. Baton's detached trust-gate sandbox then failed before loading the
existing Phase 12 tests because `@ast-grep/napi` was installed at `impl/node_modules` in the main
checkout but absent from the detached sandbox. Baton correctly rejected integration and fully
reaped the worker.

Fresh verification now accepts only orchestrator-configured, repository-relative dependency
directories and copies them into the detached sandbox. It never symlinks or hardlinks the main
toolchain, so a verification command cannot mutate installed dependencies outside its sandbox.
The web build runner explicitly requests `impl/node_modules`; the exact worker is rerun through the
unchanged verifier/integration/reap gates.

A manual diagnostic of captured commit `aeef931` in a detached sandbox with the same copied
dependency directory passed all 18 pinned Phase 12 tests. This was diagnosis only, not an
integration bypass. The dependency materialization change itself passes the full implementation
suite (579/579), including rejection before registration, copy isolation, and forced-copy-failure
cleanup tests. The candidate must still be recreated and accepted by Baton's normal trust gate.
