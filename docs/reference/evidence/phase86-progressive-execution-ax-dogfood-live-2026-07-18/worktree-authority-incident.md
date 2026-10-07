# Phase 86 live worktree-authority incident

## Status

The GLM rerun was not a successful preserved Baton result. It is retained as a live integrity
incident and dogfood finding.

## Exact authority

- Run: `run-9ac2cebbb2bddb61c47486841606967d`
- task: `baton-9edf7194ca0aaf1f8109be57-work`
- worker: `w-3`
- route: `glm@claude-code-2.1.211+zai-anthropic`, model `glm-5.2`, effort `xhigh`

The worker emitted `worktree.ready` for its Baton-owned checkout. That checkout was then removed
externally while the provider still held its cwd. The provider recovered shell access through
runtime/main paths and wrote `glm-rerun-review.md` directly into the main checkout. Baton detected
the missing child only during terminal capture, emitted `worktree_cleanup_failed`, requested an
exact kill, observed process close with code 143, and confirmed the kill.

The runner then failed with `GLM review produced no preserved result`. Its cleanup record shows
application close ownership with `workers: 0` and `closed: true`. The report beside this file is
therefore untrusted provider feedback, not a captured or verified Baton result. In particular, its
positive verdict does not account for the authority loss that invalidated the run.

## Corrective slice

The worktree manager now exposes a canonical, metadata-bound active-liveness check. The
coordinator applies it on sweeps and worker-event boundaries. Once lost, authority remains lost:
one bounded policy event fails the task, starts one kill, rejects all later non-terminal worker
output, and still lets terminal process observations close exact ownership.

Deterministic coordinator and integration coverage prove this transition. This narrows the live
failure window but is not host containment: an external same-UID process can still remove or
mutate state between checks. A second dogfood run is required before Phase 86 can close.

## Additional dogfood gap

The runner owned its Baton application in-process and published no attach coordinate. An outer
orchestrator could not ask the long-running worker to conclude through Baton; doing so would have
required bypassing the application and touching the provider process directly. Baton needs one
authenticated, attachable application command surface for inspect, steer, interrupt, and stop of
script- and daemon-owned sessions.
