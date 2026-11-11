# Phase 43 durable deferred official processing — 2026-07-12

## Shipped checkpoint

DP1–DP8 close the final Phase 43 retry gap. `createDriver({providerProcessingSchedule})` now pins an
exact deployment policy for scan interval, batch, attempts, deterministic doubled/capped backoff,
and state derivation. A store-derived due set is stable, repository-scoped, bounded by rows and
batch, and cannot spend before the durable `nextAttemptAt` time.

An ordinary official-processing failure appends one sanitized `provider.processing_deferred`
event. Its closed failure code and replay identity bind actor, idempotency key, repository,
provider/source epoch, processing version, last receipt, lifetime attempt, policy digest, event
time, delay, and next-attempt time. Messages, stacks, URLs, credentials, coordinates, provider
bytes, and capability refs are absent. Replay rejects policy, time, digest, key, and CAS mutation.

Attempt history is lifetime durable, while a new receipt starts a fresh attempt window, clears the
old due time, and makes the expanded root immediately eligible. Completion retains the historical
attempt/failure metadata but clears future scheduling. Max-attempt roots stay pending and blocking;
they do not hot-loop. Deferral append failure invents no attempt state.

`ProviderProcessingSupervisor` owns one global scheduled or active scan. It processes a bounded
batch sequentially through the existing seedless official reconciliation transaction and emits
only closed lifecycle codes and counts. Concurrent direct scans refuse. Cancellation fences sit
after every official/index await and immediately before evidence/completion writes. Async driver
close stops and awaits this supervisor before the poll supervisor, Coordinator authority, and
writer lease; hostile abort-resolving dependencies and writer loss append neither completion nor
deferral.

PF7 now includes only `attemptCount`, `lastAttemptEvent`, `lastFailureCode`, and `nextAttemptAt` in
its existing authenticated observe-only projection. There is no user/web/MCP retry trigger.

## Verification and live proof

- Phase 42 plus all Phase 43 tests pass **78/78**.
- The canonical suite passes **973/973**.
- The owned suite runner leaves zero top-level Baton temporary roots.
- `docs/reference/evidence/phase43-provider-processing-retry-2026-07-12/summary.json` passes all
  nine live checks: one injected official outage, one sanitized durable deferral, no early spend,
  writer release, restart after clock advance, one successful official retry, historical PF7
  visibility, sanitized lifecycle, and no process/worktree/runtime/branch ownership.
- `git diff --check` is clean. The user's unrelated `.gitignore` modification remains untouched.

## Recursive Baton/GLM review

`docs/reference/evidence/phase43-provider-processing-review-2026-07-12/summary.json` records exact
credentialed `glm` / `glm-4.7` / `low` routing on native PID `72783`. The worker used 99,259 tokens
and $0.616934, fresh-verified its bounded report, received a confirmed native kill, and left no
process, worktree, runtime, branch, or writer authority. Its verdict was PASS with no P0/P1 finding
and no additional required red test.

The first launch against the primary checkout failed before a native PID because Baton correctly
refused the user-dirty tree. The clean-clone rerun passed; both attempts fully cleaned ownership.
This is useful dogfood friction: recursive runners need a committed clean worktree source even when
the only primary-checkout dirt is intentionally user-owned.

## Harness and reap probes

The current harness smoke tried every wired family. GLM passed as above. Codex provider-observed
exact `gpt-5.6-sol`/low on PID `73850` and was mechanically cancelled after its 20k test budget;
Claude provider-observed exact `claude-opus-4-6`/low on PID `73845` but reported not logged in; Grok
failed authentication before a native PID. Every allocated process, worktree, runtime, branch, and
writer lease was reaped.

The explicit two-Grok runner concurrently admitted exact `grok-4.5` and
`grok-composer-2.5-fast`/low routes, but the current Grok CLI still reports unauthenticated and both
failed before native PIDs. Refusal cleanup, process absence, worktree/runtime/branch reap, and writer
release all passed. The red evidence is retained rather than misreported as a live kill test.

## Honest remaining scope

Phase 43's generic provider vertical is complete for the pinned npm hint semantics: authenticated
webhook and full-poll ingress, health recovery, official adverse/non-adverse processing, durable
retry, authenticated bounded observation, replay, and lifecycle cleanup. Additional real provider
and ecosystem adapters remain separate later contracts. Positive clearance remains a distinct
authority-bearing transaction and is not implied. Grok reauthentication is an environment gate,
not a Phase 43 product-code defect. No homelab or project-manager runtime is involved or desired.
