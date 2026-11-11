# Phase 86 — active-worktree liveness fix: independent review

Reviewer: `glm@claude-code-2.1.211+zai-anthropic`, model `glm-5.2`, effort `xhigh`.
Scope: a deliberately bounded review of **only** the active-worktree liveness fix.
Full suite not run, by instruction; no code path modified — only this file written.

## Scope and authority

Read: `impl/src/index.mjs`; the worktree-authority methods in `impl/src/coordinator.mjs`
(`_sweepDeadlines`, `_worktreeAuthorityAvailable`, `_failWorktreeAuthority`, the
`_handleEvent` worker gate, and the `ownedWorktreeAuthority` dispatch gate); the single
matching test `impl/test/coordinator.test.mjs` — *"active worktree authority loss fails and
kills before accepting more worker output"*; and `worktree-authority-incident.md`.

Incident authority (from the note): run `run-9ac2cebbb2bddb61c47486841606967d`, task
`baton-9edf7194ca0aaf1f8109be57-work`, worker `w-3`, route
`glm@claude-code-2.1.211+zai-anthropic`. A worker's Baton-owned checkout was removed
externally while the provider still held its cwd; the loss was only detected at terminal
capture (`worktree_cleanup_failed` → exact kill → close code 143 → kill confirmed).

## Mechanism

One canonical, metadata-bound liveness predicate, consulted at two boundaries.

- **Predicate** — `worktreeManager.worktreeAvailable` (`impl/src/index.mjs:354-367`): true only
  when `context.ownerTaskId === taskId`, `realpathSync(context.worktree) ===
  <repoRoot>/.baton/wt/<taskId>`, that expected dir **and** its `.meta.json` both exist, and the
  dir is a real directory (not a symlink) that resolves to itself. Any throw or mismatch → false.
- **Sweep boundary** — `_sweepDeadlines` (`coordinator.mjs:1609-1614`): on every `tick()`
  (i.e. every public command), for each worker in `working|blocked|idle|stopping`, if
  `!_worktreeAuthorityAvailable(handle)` then `_failWorktreeAuthority(handle)`.
- **Event boundary** — `_handleEvent` (`coordinator.mjs:7487-7493`): for any
  `actor === 'worker'` event, if authority is unavailable, fail it, then drop the event unless it
  is a process-terminal observation.
- **Ownership gate** — `ownedWorktreeAuthority` is set true only for a freshly created checkout
  (`coordinator.mjs:2065`; false for `resume`). The predicate short-circuits to "available" when
  it is false, so resumed/borrowed checkouts are correctly excluded from this check.

## Decisions

1. **Loss is sticky — yes.** `_worktreeAuthorityAvailable` returns `false` as soon as
   `handle.worktreeAuthorityLost === true` (`coordinator.mjs:1780`) *without re-querying the
   worktree*, and the flag is never cleared. Once observed lost, authority stays lost for the
   life of the handle.
2. **Fails and kills once — yes.** `_failWorktreeAuthority` is idempotent: it re-enters as a
   no-op when already lost (`coordinator.mjs:1787`), so it appends exactly one
   `worktree.authority_lost` event (`1793-1798`), transitions the task to `failed` exactly once
   (guarded by `TERMINAL_TASK_STATUSES`, `1799-1803`), and issues one stop via
   `_beginStop(handle,'kill',...)` only when the worker is not already
   `dead|stopping|exited` (`1804-1806`). The test asserts the second `tick()` adds no second
   event and no second `kill()` (`coordinator.test.mjs:363-366`).
3. **Rejects later non-terminal worker output — yes.** At the event boundary, after loss, any
   worker event whose kind is **not** in the terminal-close allowlist returns early and is never
   logged (`coordinator.mjs:7491-7492`). The test emits `content.message` post-loss and asserts
   no `content.message` is recorded (`coordinator.test.mjs:346-360`).
4. **Still permits exact terminal close evidence — yes.** The allowlist
   (`coordinator.mjs:7491-7492`) — `lifecycle.process_closed`,
   `lifecycle.process_reap_unconfirmed`, `kill.confirmed`, `lifecycle.crashed`,
   `lifecycle.exited` — passes through to normal handling, so a post-loss process close still
   closes exact ownership. This is precisely what let the live run observe close code 143 and
   confirm the kill.

The single matching test pins all four properties together (`coordinator.test.mjs:338-367`).

## Fail-fast detection is not OS containment

The fix is deterministic fail-fast **detection**, not host **containment**. The predicate is
consulted only at the sweep and the worker-event boundary. Between a passing check and the
worker's next filesystem write, an external same-UID process can remove, replace, or rewrite the
checkout (or its `.meta.json`); the coordinator cannot observe that until the next boundary. That
is exactly the live gap — the provider recovered shell access and wrote into the main checkout
before the loss surfaced at terminal capture. The slice narrows the failure window to one
sweep/event interval; it does **not** bound that interval by host policy and cannot prevent the
intervening write. Detection is exact; containment is absent by construction.

## Concrete defect

The concrete residual defect is the **TOCTOU containment gap** above: loss is detected fast and
reacted to exactly, but it is not prevented, and any same-UID process can race any single check.
This is the reason the incident note requires a second dogfood run before Phase 86 closes, and it
is the honest ceiling of this slice — not a bug in the policy logic itself, which is internally
consistent for all four pinned properties.

Two narrower observations (non-blocking):

- `_sweepDeadlines` does not re-check authority for a worker in the `verifying` status. The trust
  gate runs in a fresh sandbox independent of the worker's own checkout and the worker is not
  admitting new output while verifying, so the gap is benign in practice, but the liveness
  invariant is not literally continuous through verification.
- Authority loss during a soft-interrupt (`stopping`) window transitions the task to `failed` but
  does not itself issue an exact `kill` (the status guard at `coordinator.mjs:1804` skips it),
  relying on the in-flight interrupt / `stopDeadlineMs` forced cascade to close the process. The
  incident path (loss while `working`) issues the exact kill; only this ordering edge defers it.

## Verification

Deployment verification (narrow, `node`-based — the brief forbids the full suite, whose default
is `npm test --prefix impl` / `node scripts/run-suite.mjs`):

```
node --test impl/test/coordinator.test.mjs   # exit 0
```

The single matching test, which exercises the worktree-authority loss path end-to-end against the
real `Coordinator`, passes. No code path was modified; only this review file was written, so the
broader deployment verification is unaffected.
