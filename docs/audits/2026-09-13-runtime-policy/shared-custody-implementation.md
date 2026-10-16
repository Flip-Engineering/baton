# shared-custody-implementation.md — deliberate shared workspaces (2026-09-13)

Participant: `shared-custody` (swarm on the `baton-swarm-next` lane, `omp` / `deepseek-flash`).
The participant was killed by the deployment's default token budget (100 M tokens, hard stop)
before it could publish its finding; its work survived as pinned checkpoint `89376f99` and was
integrated from that checkpoint after root review. Root removed one leftover debug line and one
mis-constructed error (`code` passed as an `Error` option instead of assigned).

## What landed

- `impl/src/shared-workspace-custody.mjs` — the one custody question ("is another live handle
  still working in this checkout?") answered from the controller's live worker handles. Swarm
  membership is never custody; the owner receipt stays a single-controller Git lease.
- `swarm.recruit … shareWorkspaceWith <participantId>` — the swarm resolves the named
  participant's LIVE checkout under its own authority (absent, departed, unbound, closing or
  log-disagreeing sources refuse with `swarm_workspace_unavailable` + reason) and admits a FRESH
  native session into that checkout. Attachment and native-session resume are independent axes;
  no session id is ever invented.
- Coordinator: an attached task never creates, owns, reserves capacity for, or commits into the
  shared checkout. Its captures go through the isolated-index live snapshot; contribution
  receipts describe the checkout (`workspace: {physicalOwnerId, shared, holderCount}`,
  `observedHead`) without claiming authorship.
- Stop ordering: the first holder to stop detaches (`worktree.custody_deferred`,
  `holders_remain`) and releases its handle; the last holder closes the checkout through the
  existing preserve-then-reap authority. A retained borrowed checkout releases the holder
  (`worktree.custody_content_retained`) instead of blocking every later drain.
- `worktree.reap`/`reconcile` consult the injected live-holder provider before any destructive
  effect (`WorkspaceCustodyError`, `workspace_other_holder_live_retained`), alongside content
  preservation.

## Verification

`node --test impl/test/shared-workspace-custody.test.mjs impl/test/worktree.test.mjs` → 42/42 at
the checkpoint; the swarm, preservation, capacity and resident suites stay green after
integration (287 tests in the focused set, one CLI flag pin updated for
`--share-workspace-with`).

## Follow-ups

- The default deployment budget (`DEFAULT_BUDGET.tokens = 100_000_000`, hard stop at ratio 1)
  killed a productive participant at $0.92 spent. Tokens are not a physical resource; this
  ceiling should become operator-configured or notify-only.
- Cross-controller attachment is still refused by design (same-controller only).
