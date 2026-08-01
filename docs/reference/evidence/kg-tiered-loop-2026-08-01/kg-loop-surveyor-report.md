# KG Tiered Loop — Surveyor Report

Survey of `impl/src/run-lineage.mjs` (the run-orchestrator lease machinery) for the tiered
knowledge-loop acceptance. Author: surveyor seat.

> **Scope note.** In this deployment `run-lineage.mjs` is the policy + capability/revocation
> **taxonomy** (63 lines). The lease issuance/revocation *operations* and the
> `_assertRunAdmissionOpen` admission guard live in `impl/src/coordination-store.mjs`, which
> consumes these exports. The report is grounded in `run-lineage.mjs:1-63` with the operational
> realization cited from `coordination-store.mjs` so the cleanup truth is complete.

## Lease issuance

A run-orchestrator lease carries exactly the `RUN_ORCHESTRATOR_CAPABILITIES` set —
`run.context`, `run.start`, `run.status`, `run.stop` (`run-lineage.mjs:14-16`); that frozen
four-capability set *is* the "baton_orchestrator capability" a working parent is bound to. The
family a lease may spawn is bounded by `normalizeRunLineagePolicy`, which admits only the
5-field base policy or the 6-field REPL opt-in (`run-lineage.mjs:39-48`, with the opt-in field
added at `:5-12`) and rejects non-positive or over-ceiling values for `maxDepth`,
`maxChildrenPerRun`, `maxDescendantsPerRoot`, and `leaseTtlMs` (`run-lineage.mjs:49-60`;
defaults `maxDepth:4`, `maxChildrenPerRun:8`, `maxDescendantsPerRoot:32`, `leaseTtlMs:30 min`
at `:22-28`). Issuance is thus *shaped* here by capability and tree-depth/TTL ceilings; the
live issuance and the admission guard run in `coordination-store.mjs` (lease map at `:1671`,
admission guard `_assertRunAdmissionOpen` at `:7234`), which refuses a lease against a run that
has begun stopping — so the parent "must not be stopping when the lease is issued."

## Revocation

Revocation reasons are a frozen, closed taxonomy — `operator`, `parent_terminal`,
`parent_run_stopping`, `session_revoked`, `superseded` (`run-lineage.mjs:18-20`). The entry the
tiered loop must reason about is `parent_run_stopping`: operationally, once the parent run has
begun stopping the lease resolves to `{ state: 'inactive', reason: 'parent_run_stopping' }`
(`coordination-store.mjs:11229`), and `_assertRunAdmissionOpen` throws `run_stopping`
(`coordination-store.mjs:7234-7237`, with `runStop` checks at `:2673`, `:4236`, `:4269`) so a
stopped parent cannot be admitted for new effects or a fresh lease. `superseded` covers lease
replacement; `operator`, `session_revoked`, and `parent_terminal` cover the remaining terminal
paths. No reason outside these five is representable.

## What the orchestrator must guarantee

The orchestrator layer must keep three invariants so the tiered loop stays sound. **(1)** Keep
every admitted family within the lineage ceilings declared here (`run-lineage.mjs:22-28`,
enforced `:57-60`) and honor `leaseTtlMs` (`:27`, 24 h ceiling at `:58`). **(2)** Issue leases
only while admission is open: because `_assertRunAdmissionOpen` throws `run_stopping` for
stopping runs (`coordination-store.mjs:7234-7237`) and revocation flips a lease to
`parent_run_stopping` (`coordination-store.mjs:11229`), the settle-time knowledge-loop ritual
**must run before run stop** — otherwise the loop's effects/writes are refused at admission and
a lease can be mid-flight when stop begins. **(3)** Treat both taxonomies as closed: never
invent a revocation reason outside the five (`run-lineage.mjs:18-20`) and never extend the
capability set beyond the four (`run-lineage.mjs:14-16`).
