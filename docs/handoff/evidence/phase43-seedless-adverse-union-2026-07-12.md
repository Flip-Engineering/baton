# Phase 43 seedless adverse union and fan-out — 2026-07-12

## Outcome

Commits `3c491af` and `40cf1d1` close the seedless adverse half of official provider processing.
`knowledge.reuse_provider_guarded` completes an all-adverse or mixed green/adverse processing root
as one writer-serialized append. It removes every pending coordinate fence only while recording the
complete official observation set, immutable source contributions, aggregate guards, causal graph,
live target invalidations, and contamination.

Provider contributions are keyed by repository, exact coordinate, provider/source epoch, and
official fact digest. They are independent of the replaceable manual Phase 39 guard map. The public
`reuseAdverseState` view reports both planes without allowing either to erase the other. A green
observation from another provider resolves only its own pending work and cannot clear the aggregate.

Each official observation is a verified `Source` derived from every authenticated receipt. An
adverse contribution is a derived `Finding`; the current policy-bound aggregate is another derived
`Finding` with `DerivedFrom` edges to all retained contributions and `Affects` edges to the exact
Decision targets. A later contribution supersedes the prior aggregate projection without changing
the earlier contribution nodes.

Phase 42 now targets provider aggregates explicitly. Policy A → B closes the old aggregate Finding,
adds Constraint `Affects` lineage, and marks the aggregate stale-but-blocking with the required
policy hash. Immutable contribution history remains byte-identical across transition and replay.

## Recursive Baton finding

Recursive use found a production integration defect hidden by the injected fixture: the real
PublicSupplyChainOracle/Quartermaster npm identity includes `system:"NPM"`, while the reconciler
required byte equality with the three-field hint coordinate. The corrected boundary accepts only
the exact three-field schema or those fields plus the pinned npm system alias. A regression proves
an added `registry` authority field is rejected and leaves the root pending.

## Validation

- Phase 42/43 focused: **52/52**.
- Canonical owner-managed suite: **947/947**.
- Tests cover seedless adverse processing, mixed roots, two-provider union, green non-clearance,
  live Decision/dossier fan-out, manual/provider coexistence, A → B aggregate migration, official
  identity closure, zero-network retry/replay, mutation rejection, and append-failure atomicity.

## Harness, model, effort, and reap evidence

The four-harness matrix requested exact low-effort routes for Claude `claude-opus-4-6`, Codex
`gpt-5.6-sol`, GLM `glm-4.7`, and Grok `grok-4.5`. Claude reached its exact observed model but was
not logged in; Grok rejected the projected login before a provider PID; Codex and GLM reached exact
observed models/PIDs but slightly exceeded the first 100k hard token ceiling, so Baton rejected or
cancelled their artifacts. All four task identities were killed or already dead, and every process,
worktree, runtime, branch, and writer authority was reaped.

A scoped retry raised only the GLM ceiling to 150k tokens/$1.25. Exact `glm-4.7` at low effort used
84,115 tokens/$0.55823, passed fresh verification, produced the captured review, received a normal
confirmed kill, and left no owned process/worktree/runtime/branch/writer state. The ignored
project-local credential was passed only by file path to `GlmSessionCli`; its value was never read
or written into evidence.

The requested current two-Grok concurrency rerun admitted exact `grok-4.5` and
`grok-composer-2.5-fast` routes, but `grok 0.1.216` reported unauthenticated and both failed before
native provider PIDs. Baton still reaped both worktrees, runtime scopes, branches, and writer
authority. This is an authentication-red attempt, not a live concurrency claim; the historical
Phase 21 authenticated multi-Grok kill/reap proof remains the current successful live evidence.

## Remaining Phase 43 scope

Production HTTPS route assembly, explicit full-poll/cursor reconciliation completion, poll
single-flight ownership and close/drain, durable deferred attempts, bounded authenticated
receipt/health/currentness reads, and their complete live fixture remain active. Positive clearance,
install/decision authority, extra ecosystems, and homelab integration remain explicitly absent.
