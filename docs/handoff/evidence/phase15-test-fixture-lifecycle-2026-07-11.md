# Phase 15 owned test-fixture lifecycle evidence — 2026-07-11

TF1–TF4 closes the process-local fixture leak exposed by recursive Baton dogfood. The canonical
`npm test` command now creates one private `baton-suite-*` root, binds `TMPDIR`, `TMP`, and `TEMP`
to it, runs Node's real test runner as an isolated process group, and removes only that exact root
after the group is gone.

## Red/green findings

- The initial contracts failed because no owner existed.
- The first implementation exposed a detached-process bug: callback-only waiting allowed a
  failing child to disappear from the wrapper's liveness and be reported as success. Explicitly
  awaiting the child terminal event closed it.
- The nested tests initially inherited Node's private `NODE_TEST_CONTEXT`, which caused the
  wrapper process to masquerade as a test child. The contract harness now removes that test-only
  marker so it exercises the same environment as `npm test`.
- Naming the wrapper `test-runner.mjs` made Node 25 discover it as a test and recursively invoke
  `node:test`. Renaming it `run-suite.mjs` removed the accidental 661st test.
- Leader exit is not accepted as group reap. The wrapper probes the complete process group,
  sends bounded TERM then KILL if descendants remain, verifies absence, and fails if it cannot
  establish reap before deleting fixtures.

## Verification

- `node --test test/test-runner.test.mjs`: 3/3 passing.
- The pass fixture intentionally leaves a directory; the owned suite root disappears and an
  unrelated sibling survives.
- The fail fixture intentionally leaves a directory and throws; the wrapper remains nonzero and
  the suite root disappears.
- The signal fixture starts a hanging test plus a real descendant PID. `SIGTERM` to the wrapper
  returns nonzero, the descendant PID is independently absent, and the suite root disappears.
- `BATON_TEST_TMP_PARENT=/private/tmp/baton-owned-test-parent-20260711 npm test`: 660/660 passing.
  The configured parent is empty after the run.
- `git diff --check` passes.

Direct bare `node --test` remains a bypass of fixture ownership and is no longer the canonical
acceptance command. No process can catch its own `SIGKILL`; startup/supervisor reconciliation of a
stale `baton-suite-*` root after that uncatchable death remains explicit later runtime scope.

Provider-backed recursive review is still pending the Codex quota reset or Grok
reauthentication. Attempt 1 established and observed the exact `CodexAppServerCli` +
`gpt-5.6-sol` + `low` route, then received the provider usage limit before review content; Baton
confirmed kill and reaped the PID, worktree, runtime, metadata, branch, and runner log root. It is
negative lifecycle evidence, not a clean review verdict. No homelab integration was added.
