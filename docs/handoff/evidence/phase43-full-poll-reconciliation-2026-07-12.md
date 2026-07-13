# Phase 43 authenticated full-poll reconciliation — 2026-07-12

## Shipped checkpoint

The manual PF1–PF5 path now restores a degraded provider source only through a deployment-pinned,
authenticated, bounded, replay-valid full poll. A poll card fixes HTTPS origin/operation, sequence
cursor semantics, redirect denial, page/item/byte/wall/backoff/clock-skew ceilings, and source
replay authority. The registry returns only sanitized proof and ordinary verified receipts.

The Coordinator admits every receipt through durable delivery dedupe, then asks the coordination
store for the sole recovery CAS. The store rederives the exact contiguous sequence window under the
writer lease, binds ordered durable receipt/raw digests, provider/card epoch, expected degraded
health event, cursor/final sequence, proof replay, actor, time, and completion digest. Recovery does
not clear pending official work, guards, Findings, Decisions, or contamination. Exact retry is
zero-effect; a delivery race stales the completion; a later gap degrades the recovered source again.

## Verification

- Phase 42 plus all Phase 43 tests pass **59/59**.
- The canonical suite passes **954/954**.
- The new causal-freshness red first demonstrated that an authenticated proof observed two hours
  before the health gap could restore health. Poll cards now carry `maxClockSkewMs`; completion
  requires the proof to cover the degraded event within that skew and remain current within
  `maxWallMs + maxClockSkewMs`.
- `git diff --check` is clean. The user's unrelated `.gitignore` modification was never staged.

## Recursive Baton/GLM review

`docs/reference/evidence/phase43-full-poll-review-2026-07-12/summary.json` records a real Baton task
through the project-local credential boundary. The orchestrator requested and resolved harness
`glm`, model `glm-4.7`, and effort `low`; the provider observed `glm-4.7` on native PID `96238`.
The worker used 93,021 tokens / $0.750956, produced a fresh-verified report, received a confirmed
kill, and left no process, worktree, runtime, branch, or writer authority.

The independent disposition of the raw report is:

- accepted: poll proof time needed a bounded causal-freshness contract; the red and fix above close
  it;
- rejected: receipt/source binding was already rederived from ordered raw digests plus exact
  provider/source epoch, while webhook/poll byte dedupe intentionally permits a receipt admitted by
  either mode;
- rejected: sequence conflicts are source-epoch scoped by design; card/key rotation creates a new
  authority epoch and old-epoch bytes cannot authenticate as the new epoch;
- rejected: every durable append calls `_assertWriterLease()` at the mutation boundary, including
  recovery after a lease loss during the asynchronous poll.

Dogfooding also exposed two runner-portability frictions before provider launch. A dependency-free
clone could not import the full capability barrel because `@ast-grep/napi` was absent; projecting
`node_modules` as a symlink then made the clean-worktree gate correctly refuse the clone because a
directory-only ignore does not ignore a symlink. Copying the already-installed ignored dependency
tree into the disposable clone preserved cleanliness and passed. A lightweight runner entrypoint or
an explicit immutable dependency projection remains a fleet-tooling improvement; the safety guard
was not weakened.

## Honest remaining Phase 43 scope

PF6 automatic single-flight scheduling, capped backoff, lease-loss handling, and asynchronous
close/abort/await still remain. PF7 repo-scoped count/byte-bounded authenticated web/MCP reads and
PF8 local authenticated no-redirect HTTPS live fixture evidence also remain, as do production poll
transport assembly and durable deferred official-processing attempts. No homelab or project-manager
runtime integration is involved or desired.
