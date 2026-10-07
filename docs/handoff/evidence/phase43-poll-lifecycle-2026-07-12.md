# Phase 43 bounded provider poll lifecycle — 2026-07-12

## Shipped checkpoint

PF6 now adds an opt-in `ProviderPollSupervisor` behind
`createDriver({providerPolling:{intervalMs,initialBackoffMs}})`. Deployment timing must fit every
pinned poll card. Each provider owns at most one scheduled or active attempt; failures use
deterministic doubling backoff capped by the card, while success resets to the deployment base.
Only sanitized provider/attempt/result/error/delay lifecycle fields enter the operational log.

Poll-enabled drivers require `await driver.closeAsync()`. Synchronous `close()` refuses before any
effect. Async close stops all timers, aborts active polls, awaits every settlement, fences the
Coordinator, and then releases writer authority. A source that ignores cancellation remains bounded
by the poll card wall-time. Abort checks also sit before every durable receipt admission and before
the recovery CAS.

The integration contracts prove automatic recovery, single-flight behavior, exact timer/backoff
state, concurrent second-driver refusal, close idempotency, hostile sources that resolve a valid
proof when aborted, direct post-close store-write refusal, and writer-lease loss while a provider
fetch is active. Health remains degraded and no receipt or recovery event appears after either close
or lease loss.

## Verification

- Phase 42 plus all Phase 43 tests pass **65/65**.
- The canonical suite passes **960/960**.
- `git diff --check` is clean. The user's unrelated `.gitignore` change remains untouched.

## Recursive Baton/GLM review

`docs/reference/evidence/phase43-poll-lifecycle-review-2026-07-12/summary.json` records an exact
credentialed `glm` / `glm-4.7` / `low` Baton task on native PID `23803`. It consumed 106,343 tokens
and $0.780737, fresh-verified its scoped report, received a confirmed kill, and left no process,
worktree, runtime, branch, or writer authority.

The report's RED verdict was not accepted. Its proposed P0 first claimed the lease preceded the
closed flag, then quoted the opposite sequence: `coordinator.closeAuthority()` synchronously sets
`Coordinator._closed` before `coordination.releaseWriterLease()`. `closeAsync()` has already awaited
all poll promises, and there is no JavaScript interleaving point between those synchronous calls.
Its operational-log race also relied on a wrapper-installation window that exists only during
constructor assembly, before the poll supervisor starts.

The suggested adversarial edge was still made explicit: the close test now makes the blocked source
resolve a complete valid poll proof from its abort callback instead of rejecting. Registry and
Coordinator cancellation checks prevent all receipt/recovery writes; after close, even a direct
coordination-store delivery append fails `coordination_writer_lost`. The preexisting supervisor unit
test already proves no timer is scheduled after close.

## Honest remaining Phase 43 scope

PF7 repo-scoped count/byte-bounded authenticated web and MCP reads remains next. PF8 still needs a
local authenticated, no-redirect HTTPS paged live fixture. Production HTTPS poll transport assembly
and durable deferred official-processing attempts also remain. No homelab or project-manager runtime
integration is involved or desired.
