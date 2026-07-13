# Phase 43 seedless official green reconciliation — 2026-07-12

## Outcome

Commit `f58498b` adds the first coordinate-owned official processing transaction. A deployment may
configure `providerReconciliation` only with a bounded capability budget and an index authority
whose closed card binds repository and Atlas identity. Driver construction also requires an active
reuse policy matching the advertised Cartographer/Quartermaster policy and a reverifiable
`reuse.vet` operation.

`Coordinator.reconcileProviderProcessing(processingId)` accepts no caller actor, repository,
coordinate, index epoch, policy, verdict, budget, or idempotency key. It derives those from the
durable pending root and deployment configuration, snapshots active policy and index binding,
invokes and reverifies Quartermaster for every exact coordinate with `refresh:true`, then rereads
and reverifies both policy and index after the asynchronous work. Any movement leaves the complete
root pending.

Only an all-`borrow_candidate` result can append `provider.processing_checked`. The store rederives
the active policy under the writer lease, validates the full sorted coordinate/receipt set, closed
dossier refs and snapshots, mapped operational evidence, temporal bounds, identities, and event
digest, then atomically marks the root `ignored_non_adverse` and removes every pending fence. It
creates verified official `Source` nodes with `DerivedFrom` receipt lineage but no Finding, guard,
Decision, clearance, resurrection, or code authority. Any adverse coordinate returns
`provider_adverse_pending` and remains fenced for the separate monotonic guard transaction.

## Validation

- Three focused tests prove seedless green processing, zero-network exact retry, restart replay,
  verified Source lineage without Findings, multi-coordinate one-root completion, and fail-closed
  index-change/adverse outcomes with no partial completion.
- Phase 42 policy-race compatibility remains green.
- The repository-wide zero-quota suite passes 934/934.

## Recursive Baton evidence

The recursive run in
`docs/reference/evidence/phase43-green-reconciliation-dogfood-2026-07-12/` is intentionally red.
Baton requested/resolved/provider-observed exact GLM `glm-4.7`/low on PID 15860. The provider
reported 113,126 tokens/$0.800926 against the explicitly approved 100,000-token/$1 brief. Baton's
sticky hard-budget policy independently verified the worker filesystem at exit 0 but set
`accept:false`, failed the task, captured no accepted report, confirmed kill, and reaped the
process, worktree, runtime, branch, and writer authority. This is live proof that `55b93b3`
prevents a terminal-lump overrun from laundering an otherwise valid artifact into task or review
success.

The rejected worker report is not treated as review approval. Its proposed policy/index race is
already closed by pre-call snapshots, post-call rechecks, and store comparison against the active
head; its idempotency collision cannot occur because the derived request digest includes
`processingId`; and semantic aliases share a root only when their complete coordinate/advisory
identity is equal. No actionable defect was accepted from that over-budget output.

## Explicitly unshipped

Seedless adverse contribution/aggregate guards and fan-out, mixed green/adverse child completion,
durable retry/deferred attempts, cursor/full-poll reconciliation completion, poll lifetime,
production HTTPS routing, and bounded authenticated observation surfaces remain active Phase 43
work. No homelab integration is added.
